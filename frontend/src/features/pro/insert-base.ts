// insert-base.ts — ProInsertBase class + CATALOG. Port of aporte/js/insert-base.js.

import { apiUrl } from '../../core/api';
import { getPrefersReducedMotion } from '../../core/utils';

// ── Types ─────────────────────────────────────────────────────

/** Snapshot of an insert's state for rack persistence. */
export interface InsertSnapshot {
  id: string;
  bypass: boolean;
  params: Record<string, unknown>;
}

/** Visual widget contract that inserts may reference. */
export interface WidgetInstance {
  init?(canvas: HTMLCanvasElement | null, opts?: Record<string, unknown>): void;
  destroy?(): void;
  [key: string]: unknown;
}

/** Constructor signature of a visual widget class. */
export type WidgetClass = new () => WidgetInstance;

/** Spec accepted by `createInsert` and `ProInsertBase`'s constructor. */
export interface InsertSpec {
  id: string;
  title?: string;
  endpoint?: string;
  type?: string;
  widget?: WidgetClass | null;
  defaults?: Record<string, unknown>;
}

/**
 * Per-insert backend param mapper. Invoked with `this` bound to the
 * owning `ProInsertBase` (so `this.params` resolves). Returns the form
 * params sent to `/*`.
 */
export type BackendParamsFn = (
  this: { params: Record<string, unknown> },
) => Record<string, string>;

/** A catalog entry: default params + backend param mapping. */
export interface CatalogEntry {
  defaults: Record<string, unknown>;
  toBackendParams: BackendParamsFn;
}

/** The insert catalog keyed by insert id. */
export type Catalog = Readonly<Record<string, CatalogEntry>>;

/** Slice of `window.LGMDM.api` consumed for auth headers. */
interface LgmdmApiSlice {
  authHeaders?: (extra?: HeadersInit, method?: string) => Record<string, string>;
}

interface LgmdmGlobal {
  api?: LgmdmApiSlice;
}

function lgmdm(): LgmdmGlobal {
  return (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM || {};
}

/** Type guard that narrows to `unknown[]` without leaking `any`. */
function isUnknownArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
}

/**
 * Auth headers (token + CSRF) with the JSON `Content-Type` stripped so
 * the browser can set the multipart boundary for `FormData` bodies.
 * Mirrors the pattern in `features/analysis/view.ts`.
 */
export function buildAuthHeaders(method: 'POST'): Record<string, string> {
  const api = lgmdm().api;
  const headers: Record<string, string> = api?.authHeaders
    ? api.authHeaders({}, method)
    : {};
  delete headers['Content-Type'];
  delete headers['content-type'];
  return headers;
}

// ── ProInsertBase ─────────────────────────────────────────────

/**
 * `ProInsertBase` — unified abstraction for a premium chain insert.
 *
 * Subclasses override:
 *   - `render(root, options)` to build the widget DOM.
 *   - `update(data)` to consume backend telemetry.
 *   - `toBackendParams()` is patched per-catalog by `createInsert`.
 *
 * Lifecycle:
 *   - `init(root, options)` mounts (stores root/options, calls render).
 *   - `teardown()` (or legacy `destroy()`) cleans up.
 */
export class ProInsertBase {
  readonly id: string;
  title: string;
  type: string;
  endpoint: string;
  widget: WidgetClass | null;
  params: Record<string, unknown>;
  bypass = false;

  protected _root: HTMLElement | null = null;
  protected _options: Record<string, unknown> = {};
  protected _abort = new AbortController();
  protected _rafId = 0;
  protected _timerIds = new Set<ReturnType<typeof setTimeout>>();
  private _teardownDone = false;

  constructor(spec: InsertSpec) {
    this.id = spec.id;
    this.title = spec.title || spec.id;
    this.type = spec.type || spec.id;
    this.endpoint = spec.endpoint || `/${spec.id}`;
    this.widget = spec.widget ?? null;
    this.params = { ...(spec.defaults || {}) };
  }

  /** Live state shape (`id`, `bypass`, `params` reference). */
  get state(): InsertSnapshot {
    return { id: this.id, bypass: this.bypass, params: this.params };
  }

  /** Public lifecycle entry: store root + options, then `render()`. */
  init(root: HTMLElement | null, options: Record<string, unknown> = {}): void {
    this._root = root;
    this._options = options;
    try {
      this.render(root, options);
    } catch (err) {
      console.error(`[insert-base] ${this.id}: render() threw`, err);
    }
  }

  /** Override in subclass to build the widget DOM. */
  render(root: HTMLElement | null, options: Record<string, unknown> = {}): void {
    this._root = root;
    this._options = options;
  }

  /** Override in subclass to consume backend data. */
  update(_data: unknown): void {
    // base no-op
  }

  getEndpoint(): string {
    return this.endpoint;
  }

  /** Convert internal params to backend form params. Patched per-catalog. */
  toBackendParams(): Record<string, string> {
    const out: Record<string, string> = {};
    Object.entries(this.params).forEach(([k, v]) => {
      const snake = k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      out[snake] = String(v);
    });
    return out;
  }

  /**
   * POST to the endpoint with `file` + params. Returns a `Blob` (audio) or
   * a JSON object (metrics). Returns `null` when bypassed or aborted.
   */
  async fetch(file: Blob): Promise<Blob | Record<string, unknown> | null> {
    if (this.bypass) return null;
    const fd = new FormData();
    fd.append('file', file);
    Object.entries(this.toBackendParams()).forEach(([k, v]) => fd.append(k, v));
    try {
      const res = await fetch(apiUrl(this.getEndpoint()), {
        method: 'POST',
        body: fd,
        headers: buildAuthHeaders('POST'),
        credentials: 'include',
        signal: this._abort.signal,
      });
      if (!res.ok) throw new Error(`${this.id}: HTTP ${res.status}`);
      const ct = res.headers.get('content-type') || '';
      return ct.includes('application/json')
        ? ((await res.json()) as Record<string, unknown>)
        : await res.blob();
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return null;
      throw err;
    }
  }

  /** Snapshot of state for rack persistence (defensive copy of params). */
  serialize(): InsertSnapshot {
    return { id: this.id, bypass: this.bypass, params: { ...this.params } };
  }

  /** Restore state from a snapshot. */
  restore(snapshot: InsertSnapshot | null): void {
    if (!snapshot) return;
    if (typeof snapshot.bypass === 'boolean') this.bypass = snapshot.bypass;
    if (snapshot.params) Object.assign(this.params, snapshot.params);
  }

  /** Register a listener tracked for teardown (signal-based). */
  protected bind(
    target: EventTarget,
    type: string,
    fn: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void {
    const opts: AddEventListenerOptions =
      typeof options === 'boolean'
        ? { capture: options, signal: this._abort.signal }
        : { ...(options || {}), signal: this._abort.signal };
    target.addEventListener(type, fn, opts);
  }

  /** `requestAnimationFrame` tracked for teardown. */
  protected raf(fn: FrameRequestCallback): number {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = requestAnimationFrame((ts: number) => {
      this._rafId = 0;
      try {
        fn(ts);
      } catch (err) {
        console.error(`[insert-base] ${this.id}: raf cb threw`, err);
      }
    });
    return this._rafId;
  }

  /** `setTimeout` tracked for teardown. */
  protected timeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
    const id = setTimeout(() => {
      this._timerIds.delete(id);
      try {
        fn();
      } catch (err) {
        console.error(`[insert-base] ${this.id}: timeout cb threw`, err);
      }
    }, ms);
    this._timerIds.add(id);
    return id;
  }

  /** Cleanup: abort listeners, cancel rAF, clear timers, drop root. */
  teardown(): void {
    if (this._teardownDone) return;
    this._teardownDone = true;
    try {
      this._abort.abort();
    } catch {
      /* ignore */
    }
    if (this._rafId) {
      cancelAnimationFrame(this._rafId);
      this._rafId = 0;
    }
    this._timerIds.forEach((id) => clearTimeout(id));
    this._timerIds.clear();
    this._root = null;
    this._options = {};
  }

  /** Legacy alias for `teardown()` (widgets may call `destroy()`). */
  destroy(): void {
    this.teardown();
  }

  /** Honored by subclasses that animate. */
  protected prefersReducedMotion(): boolean {
    return getPrefersReducedMotion();
  }
}

// ── Catálogo de inserts ───────────────────────────────────────
// Defaults + mapping helpers por insert. Los 10 inserts DSP premium
// (+ 4 inserts MX-01 frontend-only) comparten la misma superficie vía
// `ProInsertBase`; el mapping específico a params del backend Pydantic
// vive acá.

const toStr = (v: unknown): string => String(v);

export const CATALOG: Catalog = {
  'resonance-tamer': {
    defaults: { sensitivity: 0.5, depth_db: -6, n_bands: 64 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        sensitivity: toStr(this.params.sensitivity),
        depth_db: toStr(this.params.depth_db),
        n_bands: toStr(this.params.n_bands),
      };
    },
  },
  inflator: {
    defaults: { drive: 0.5, mix: 1.0, curve: 'sigmoid' },
    toBackendParams(this: { params: Record<string, unknown> }) {
      const curveMap: Record<string, string> = {
        I: 'sigmoid',
        II: 'tanh',
        III: 'chebyshev',
      };
      const backendCurves = ['sigmoid', 'chebyshev', 'tanh'];
      const raw = this.params.curve;
      const rawStr = typeof raw === 'string' ? raw : 'sigmoid';
      const mapped = curveMap[rawStr];
      const curve = backendCurves.includes(rawStr)
        ? rawStr
        : mapped || 'sigmoid';
      return {
        drive: toStr(this.params.drive),
        mix: toStr(this.params.mix),
        curve,
      };
    },
  },
  'phantom-sub': {
    defaults: { crossover_hz: 80, mix: 0.5, harmonic_mode: 'octave' },
    toBackendParams(this: { params: Record<string, unknown> }) {
      const mode = this.params.harmonic_mode;
      return {
        crossover_hz: toStr(this.params.crossover_hz),
        mix: toStr(this.params.mix),
        harmonic_mode: typeof mode === 'string' ? mode : 'octave',
      };
    },
  },
  'iso-compensation': {
    defaults: { playback_phon: 80, reference_phon: 80, strength: 0.5 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        playback_phon: toStr(this.params.playback_phon),
        reference_phon: toStr(this.params.reference_phon),
        strength: toStr(this.params.strength),
      };
    },
  },
  // FIX A12: este widget NO se procesa via el fetch genérico de insert-base
  // (que manda un solo `file`). El backend pide `target_file`+`reference_file`
  // (advanced_dsp.py:378). El handler especial en insert-rack.ts:848-859
  // arma el FormData con ambos archivos. Este CATALOG solo provee defaults.
  'match-eq': {
    defaults: { match_amount: 0.7, smoothing: 0.3 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        match_amount: toStr(this.params.match_amount),
        smoothing: toStr(this.params.smoothing),
      };
    },
  },
  // FIX A12: este widget NO se procesa via el fetch genérico de insert-base.
  // El backend pide `target_stem`+`masking_stem` (advanced_dsp.py:440). El
  // insert-rack.ts:900-902 lo skipea con "Requiere 2 stems — usar standalone".
  // El camino funcional real es el tab Demask en premium-suite (btnRunDemask).
  'cross-demask': {
    defaults: { depth_db: -4, sensitivity: 0.5 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        depth_db: toStr(this.params.depth_db),
        sensitivity: toStr(this.params.sensitivity),
      };
    },
  },
  'loudness-penalty': {
    defaults: {},
    toBackendParams() {
      return {};
    },
  },
  'phase-rotation': {
    defaults: { freq_hz: 1000, angle_deg: 0, q: 1.0 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        freq_hz: toStr(this.params.freq_hz),
        angle_deg: toStr(this.params.angle_deg),
        q: toStr(this.params.q),
      };
    },
  },
  'spectral-tilt': {
    defaults: { tilt_db: 0, pivot_hz: 1000 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        tilt_db: toStr(this.params.tilt_db),
        pivot_hz: toStr(this.params.pivot_hz),
      };
    },
  },
  'dr-meter': {
    defaults: {},
    toBackendParams() {
      return {};
    },
  },
  // ── MX-01 entries — frontend-only widgets (sin /dsp/* endpoint) ──
  // Sólo usan serialize/restore + estado local. Entran en CATALOG para
  // que el rack pueda snapshotear su state vía ProInsertBase.
  'loudness-war': {
    defaults: {},
    toBackendParams() {
      return {};
    },
  },
  'ms-imager': {
    defaults: { width: 1.0, correlation: 0.5 },
    toBackendParams(this: { params: Record<string, unknown> }) {
      return {
        width: toStr(this.params.width),
        correlation: toStr(this.params.correlation),
      };
    },
  },
  'multiband-transient': {
    defaults: {
      amount: 0.5,
      attack_ms: [10, 10, 10],
      release_ms: [100, 100, 100],
    },
    toBackendParams(this: { params: Record<string, unknown> }) {
      const a = this.params.attack_ms;
      const r = this.params.release_ms;
      const attack = isUnknownArray(a) ? a.map(toStr).join(',') : '';
      const release = isUnknownArray(r) ? r.map(toStr).join(',') : '';
      return {
        amount: toStr(this.params.amount),
        attack_ms: attack,
        release_ms: release,
      };
    },
  },
  reverb: {
    defaults: {
      room_size: 0.7,
      pre_delay_ms: 30,
      decay_sec: 2.5,
      wet: 0.3,
      reverb_type: 'Hall',
    },
    toBackendParams(this: { params: Record<string, unknown> }) {
      const t = this.params.reverb_type;
      return {
        room_size: toStr(this.params.room_size),
        pre_delay_ms: toStr(this.params.pre_delay_ms),
        decay_sec: toStr(this.params.decay_sec),
        wet: toStr(this.params.wet),
        reverb_type: typeof t === 'string' ? t : 'Hall',
      };
    },
  },
};

// ── Factory ──────────────────────────────────────────────────

/**
 * Crea un `ProInsertBase` del catálogo, patcheando `toBackendParams` con
 * el mapping específico del insert. Lanza si el `id` no está en CATALOG.
 */
export function createInsert(spec: InsertSpec): ProInsertBase {
  const cat = CATALOG[spec.id];
  if (!cat) throw new Error(`unknown insert: ${spec.id}`);
  const inst = new ProInsertBase({
    id: spec.id,
    title: spec.title,
    endpoint: spec.endpoint,
    defaults: cat.defaults,
    widget: spec.widget ?? null,
  });
  // Patch con toBackendParams específico del catálogo (como el aporte).
  inst.toBackendParams = cat.toBackendParams.bind(inst);
  return inst;
}
