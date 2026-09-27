// phase-rotation.ts — pro widget. Port of aporte/js/pro-features/phase-rotation-widget.js.

import { apiUrl } from '../../../core/api';
import { logFreq, getPrefersReducedMotion } from '../../../core/utils';

// ── Theme palette (themeColors() global with CSS-var fallback) ──
interface ThemePalette {
  good: string;
  warn: string;
  danger: string;
  accent: string;
  text: string;
  muted: string;
  bg: string;
}

function readPalette(): ThemePalette | null {
  const tc = (window as Window & { LGMDM?: { themeColors?: () => ThemePalette | null } })
    .LGMDM?.themeColors?.();
  if (tc) return tc;
  if (typeof document === 'undefined') return null;
  const s = getComputedStyle(document.documentElement);
  return {
    good: s.getPropertyValue('--ui-good').trim() || '#45f6b2',
    warn: s.getPropertyValue('--ui-warn').trim() || '#ffbd4a',
    danger: s.getPropertyValue('--ui-danger').trim() || '#ff4264',
    accent: s.getPropertyValue('--ui-accent').trim() || '#23e7ff',
    text: s.getPropertyValue('--ui-text').trim() || '#f4f7ff',
    muted: s.getPropertyValue('--ui-muted').trim() || '#8995b0',
    bg: s.getPropertyValue('--ui-surface').trim() || '#0d1220',
  };
}

const PALETTE = readPalette();
const COLOR_BG = (PALETTE && PALETTE.bg) || '#0d1020';
const COLOR_GRID = 'rgba(147,164,255,0.10)';
const COLOR_AXIS = 'rgba(147,164,255,0.35)';
const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
const COLOR_BAND_RING = (PALETTE && PALETTE.warn) || '#ffcc66';

const FMIN = 20;
const FMAX = 20000;

interface DefaultBand {
  name: string;
  freq_hz: number;
  angle_deg: number;
  q: number;
}
const BANDS_DEFAULT: DefaultBand[] = [
  { name: 'low', freq_hz: 80, angle_deg: 0, q: 1.0 },
  { name: 'mid-low', freq_hz: 400, angle_deg: 30, q: 1.0 },
  { name: 'mid-high', freq_hz: 2000, angle_deg: -20, q: 1.0 },
  { name: 'high', freq_hz: 10000, angle_deg: 0, q: 1.0 },
];

const LOG_FMIN = logFreq(FMIN);
const LOG_FMAX = logFreq(FMAX);

function xFromAngle(deg: number, left: number, width: number): number {
  const t = ((((deg % 360) + 360) % 360) / 360);
  return left + t * width;
}

function yFromFreq(f: number, top: number, height: number): number {
  const t = (logFreq(f) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN);
  return top + (1 - t) * height;
}

function viridis(t: number): [number, number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  const stops: Array<[number, number, number, number]> = [
    [0.0, 68, 1, 84],
    [0.25, 59, 82, 139],
    [0.5, 33, 145, 140],
    [0.75, 94, 201, 98],
    [1.0, 253, 231, 37],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    if (clamped <= stops[i + 1][0]) {
      const u = (clamped - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
      const r = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * u;
      const g = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * u;
      const b = stops[i][3] + (stops[i + 1][3] - stops[i][3]) * u;
      return [r | 0, g | 0, b | 0];
    }
  }
  const last = stops[stops.length - 1];
  return [last[1], last[2], last[3]];
}

// ── Public state ──────────────────────────────────────────────
export interface PhaseRotationBand {
  name: string;
  freq_hz: number;
  angle_deg: number;
  q: number;
}

export interface PhaseRotationState {
  bands: PhaseRotationBand[];
}

export type PhaseRotationInitOptions = Partial<PhaseRotationState> & {
  onBandChange?: (idx: number, band: PhaseRotationBand) => void;
};

export interface PhaseRotationProcessResult extends PhaseRotationBand {
  ok: boolean;
  unavailable?: boolean;
  reason?: string;
  status?: number;
  blob?: Blob;
}

// ── Rack + LGMDM typing (minimal slice) ───────────────────────
interface ProInsertRack {
  create?: (spec: {
    id: string;
    title: string;
    endpoint?: string;
    widget: unknown;
  }) => unknown;
  CATALOG?: Record<string, unknown>;
  registry?: Record<string, unknown>;
}
interface ProFeaturesNS {
  phaseRotationWidget?: unknown;
  widgets?: Record<string, unknown>;
}
interface LgmdmGlobal {
  proFeatures?: ProFeaturesNS;
  proInsertRack?: ProInsertRack;
  api?: {
    authHeaders?: (extra?: HeadersInit, method?: string) => Record<string, string>;
  };
}

function lg(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

function buildAuthHeaders(method: 'POST'): Record<string, string> {
  const api = lg().api;
  const headers: Record<string, string> =
    api && api.authHeaders ? api.authHeaders({}, method) : {};
  delete headers['Content-Type'];
  delete headers['content-type'];
  return headers;
}

// ── Widget ────────────────────────────────────────────────────
export class PhaseRotationWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  canvas: HTMLCanvasElement | null = null;

  /** Public widget state — the 4 phase-rotation bands. */
  state: PhaseRotationState = {
    bands: BANDS_DEFAULT.map((b) => ({ ...b })),
  };

  /**
   * Alias over `state` kept for backward-compat with the legacy
   * `setupProFeatures` orchestrator, which reads `inst.data.bands`.
   */
  get data(): PhaseRotationState {
    return this.state;
  }

  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 800;
  private cssHeight = 400;
  private dpr = 1;
  private rafId: number | null = null;
  private dragIdx = -1;
  private heatmap: HTMLCanvasElement | null = null;
  private ac: AbortController | null = null;
  private options: PhaseRotationInitOptions = {};
  private _destroyed = false;

  constructor() {
    // Standalone class; fields initialised above.
  }

  init(canvas: HTMLCanvasElement | null, options?: PhaseRotationInitOptions): void {
    this.canvas = canvas;
    if (!canvas) return;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    this._size();
    this._bind();
    this._buildHeatmap();
    this._startRaf();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: Partial<PhaseRotationState> | null): void {
    const merged: PhaseRotationState = {
      bands: BANDS_DEFAULT.map((b) => ({ ...b })),
    };
    if (data && data.bands) {
      merged.bands = data.bands;
    }
    this.state = merged;
    if (!this.state.bands || this.state.bands.length === 0) {
      this.state.bands = BANDS_DEFAULT.map((b) => ({ ...b }));
    }
    this._render();
  }

  resize(): void {
    this._size();
    this.heatmap = null;
    this._buildHeatmap();
    this._render();
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ac) {
      try { this.ac.abort(); } catch { /* ignore */ }
      this.ac = null;
    }
    this.heatmap = null;
    this.canvas = null;
    this.ctx = null;
    this.dragIdx = -1;
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  // ── Orquestador: backend procesa 1 banda por request; widget modela 4 ──
  // FIX (defensive): usa fetch directo con auth headers (maneja JWT, apiBase,
  // CSRF via `LGMDM.api.authHeaders`). El 404 se maneja acá para marcar cada
  // banda como `unavailable: true` y permitir que el caller pinte "endpoint
  // no disponible".
  static async processAllBands(
    file: File,
    bands: PhaseRotationBand[],
    _token?: string,
  ): Promise<PhaseRotationProcessResult[]> {
    if (!Array.isArray(bands)) return [];
    const results: PhaseRotationProcessResult[] = [];
    for (const b of bands) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('freq_hz', String(b.freq_hz));
      fd.append('angle_deg', String(b.angle_deg));
      fd.append('q', String(b.q));
      try {
        const res = await fetch(apiUrl('/phase-rotation'), {
          method: 'POST',
          body: fd,
          headers: buildAuthHeaders('POST'),
          credentials: 'include',
        });
        if (res.status === 404) {
          results.push({
            ...b,
            ok: false,
            unavailable: true,
            reason: 'DSP endpoint no disponible — se habilitará pronto',
          });
        } else if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch { /* ignore */ }
          results.push({
            ...b,
            ok: false,
            status: res.status,
            reason: `HTTP ${res.status}: ${errText || res.statusText}`,
          });
        } else {
          const blob = await res.blob();
          results.push({ ...b, ok: true, blob });
        }
      } catch (err) {
        const message = err && typeof err === 'object' && 'message' in err
          ? String((err as Error).message)
          : 'network error';
        results.push({ ...b, ok: false, reason: message });
      }
    }
    return results;
  }

  // ── internals ───────────────────────────────────────────────
  private _size(): void {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(rect.width, 320);
    this.cssHeight = Math.max(rect.height, 200);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.cssWidth * this.dpr);
    this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private _buildHeatmap(): void {
    if (!this.ctx) return;
    const W = 360;
    const H = 180;
    const img = this.ctx.createImageData(W, H);
    const data = img.data;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const phaseT = x / W;
        const freqT = y / H;
        const base = phaseT * 2 * Math.PI;
        const swirl = Math.sin(freqT * 6 + phaseT * 2) * 0.18;
        const t = (Math.sin(base + freqT * 4 + swirl) + 1) / 2;
        const [r, g, b] = viridis(t);
        const idx = (y * W + x) * 4;
        data[idx] = r;
        data[idx + 1] = g;
        data[idx + 2] = b;
        data[idx + 3] = 80;
      }
    }
    const off = document.createElement('canvas');
    off.width = W;
    off.height = H;
    const offCtx = off.getContext('2d');
    if (offCtx) {
      offCtx.putImageData(img, 0, 0);
      this.heatmap = off;
    }
  }

  private _bind(): void {
    if (!this.canvas) return;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    this.canvas.addEventListener(
      'mousedown',
      (e: MouseEvent) => {
        try {
          this._onDown(e);
        } catch {
          /* defensive */
        }
      },
      { signal },
    );
    this.canvas.addEventListener(
      'mousemove',
      (e: MouseEvent) => {
        try {
          this._onMove(e);
        } catch {
          /* defensive */
        }
      },
      { signal },
    );
    this.canvas.addEventListener(
      'mouseleave',
      () => {
        this.dragIdx = -1;
      },
      { signal },
    );
    // mouseup lives on window so dragging keeps working outside the canvas.
    window.addEventListener(
      'mouseup',
      () => {
        this.dragIdx = -1;
      },
      { signal },
    );
  }

  private _plotRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
    const left = 56;
    const right = this.cssWidth - 16;
    const top = 16;
    const bottom = this.cssHeight - 110;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  private _knobRect(i: number): { x: number; y: number; w: number; h: number } {
    const W = 130;
    const H = 80;
    const padX = 16;
    const totalW = this.cssWidth - padX * 2;
    const col = (totalW - W * 4) / 3;
    const x = padX + i * (W + col);
    const y = this.cssHeight - 100;
    return { x, y, w: W, h: H };
  }

  private _onDown(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const bands = this.state.bands || [];
    for (let i = 0; i < bands.length; i++) {
      const k = this._knobRect(i);
      const cx = k.x + k.w / 2;
      const cy = k.y + k.h / 2;
      if (Math.hypot(x - cx, y - cy) < 22) {
        this.dragIdx = i;
        return;
      }
      if (x >= k.x && x <= k.x + k.w && y >= k.y + k.h - 8 && y <= k.y + k.h + 12) {
        const ratio = (x - k.x) / k.w;
        bands[i].q = Math.max(0.3, Math.min(3, 0.3 + ratio * 2.7));
        if (this.options.onBandChange) this.options.onBandChange(i, bands[i]);
        this._render();
      }
    }
  }

  private _onMove(e: MouseEvent): void {
    if (this.dragIdx < 0 || !this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const k = this._knobRect(this.dragIdx);
    const cx = k.x + k.w / 2;
    const cy = k.y + k.h / 2;
    const ang = (Math.atan2(y - cy, x - cx) * 180) / Math.PI;
    const norm = (ang % 360 + 360) % 360;
    const half = norm > 180 ? norm - 360 : norm;
    const bands = this.state.bands;
    if (bands[this.dragIdx]) {
      bands[this.dragIdx].angle_deg = half;
      if (this.options.onBandChange)
        this.options.onBandChange(this.dragIdx, bands[this.dragIdx]);
    }
    this._render();
  }

  private _startRaf(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (getPrefersReducedMotion()) {
      this._render();
      return;
    }
    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop);
      this._render();
    };
    this.rafId = requestAnimationFrame(loop);
  }

  private _render(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const r = this._plotRect();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    if (this.heatmap) {
      ctx.imageSmoothingEnabled = true;
      ctx.globalAlpha = 0.85;
      ctx.drawImage(this.heatmap, r.left, r.top, r.width, r.height);
      ctx.globalAlpha = 1;
    }

    this._drawGrid(r);

    const bands = this.state.bands || [];
    bands.forEach((b, i) => {
      if (!b || !isFinite(b.freq_hz)) return;
      const x = xFromAngle(b.angle_deg, r.left, r.width);
      const y = yFromFreq(b.freq_hz, r.top, r.height);
      ctx.fillStyle = COLOR_BAND_RING;
      ctx.shadowColor = COLOR_BAND_RING;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(7,8,18,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = COLOR_TEXT;
      ctx.font = '700 10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(b.name, x, y - 12);
      ctx.fillStyle = COLOR_MUTED;
      ctx.font = '9px system-ui, -apple-system, sans-serif';
      ctx.fillText(
        `${b.freq_hz >= 1000 ? (b.freq_hz / 1000).toFixed(1) + 'k' : b.freq_hz.toFixed(0)}Hz · ${b.angle_deg >= 0 ? '+' : ''}${b.angle_deg.toFixed(0)}°`,
        x,
        y + 16,
      );
      ctx.textAlign = 'left';
    });

    this._drawKnobs();
  }

  private _drawGrid(r: { left: number; right: number; top: number; bottom: number; width: number; height: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;

    const xTicks = [0, 90, 180, 270, 360];
    ctx.textAlign = 'center';
    xTicks.forEach((deg) => {
      const x = xFromAngle(deg, r.left, r.width);
      ctx.beginPath();
      ctx.moveTo(x, r.top);
      ctx.lineTo(x, r.bottom);
      ctx.stroke();
      ctx.fillStyle = deg === 0 ? COLOR_AXIS : COLOR_MUTED;
      ctx.fillText(deg + '°', x, r.bottom + 8);
    });

    const yTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    yTicks.forEach((f) => {
      const y = yFromFreq(f, r.top, r.height);
      ctx.strokeStyle = COLOR_GRID;
      ctx.beginPath();
      ctx.moveTo(r.left, y);
      ctx.lineTo(r.right, y);
      ctx.stroke();
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText(f >= 1000 ? f / 1000 + 'k' : String(f), r.left - 6, y);
    });

    ctx.textAlign = 'left';
  }

  private _drawKnobs(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const bands = this.state.bands || [];
    bands.forEach((b, i) => {
      const k = this._knobRect(i);
      const cx = k.x + k.w / 2;
      const cy = k.y + k.h / 2;

      ctx.fillStyle = 'rgba(13,16,32,0.55)';
      ctx.strokeStyle = 'rgba(147,164,255,0.18)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, k.x, k.y, k.w, k.h, 10);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = COLOR_MUTED;
      ctx.font = '700 10px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText(b.name, k.x + 10, k.y + 6);

      ctx.fillStyle = COLOR_TEXT;
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.fillText(`${b.angle_deg >= 0 ? '+' : ''}${b.angle_deg.toFixed(0)}°`, k.x + k.w - 42, k.y + 6);

      ctx.strokeStyle = 'rgba(147,164,255,0.25)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, 0, Math.PI * 2);
      ctx.stroke();

      const arcStart = -Math.PI / 2;
      const arcEnd = arcStart + (b.angle_deg / 180) * Math.PI;
      ctx.strokeStyle = COLOR_BAND_RING;
      ctx.shadowColor = COLOR_BAND_RING;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(cx, cy, 20, arcStart, arcEnd);
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = COLOR_MUTED;
      ctx.font = '9px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      const qY = k.y + k.h - 6;
      ctx.fillText(`Q ${(b.q || 1).toFixed(2)}`, k.x + 8, qY - 6);
      const qBarX = k.x + 8;
      const qBarW = k.w - 16;
      ctx.fillStyle = 'rgba(147,164,255,0.18)';
      ctx.fillRect(qBarX, qY, qBarW, 4);
      const qT = Math.max(0, Math.min(1, ((b.q || 1) - 0.3) / 2.7));
      ctx.fillStyle = COLOR_BAND_RING;
      ctx.fillRect(qBarX, qY, qBarW * qT, 4);
    });
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.phaseRotationWidget = PhaseRotationWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['phase-rotation'] = PhaseRotationWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Backward-compat: si rack.create falla, la clase sigue funcionando
// standalone y `PhaseRotationWidget.processAllBands(file, bands, token)`
// permanece accesible.
let _registered = false;
function bootstrap(): void {
  if (_registered) return;
  _registered = true;
  try {
    const rack = LG.proInsertRack;
    if (
      rack &&
      typeof rack.create === 'function' &&
      rack.CATALOG &&
      rack.CATALOG['phase-rotation']
    ) {
      const inst = rack.create({
        id: 'phase-rotation',
        title: '🔄 Phase Rotation',
        endpoint: '/dsp/phase-rotation',
        widget: PhaseRotationWidget,
      });
      if (inst) {
        PhaseRotationWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['phase-rotation'] = inst;
      }
    }
  } catch (e) {
    console.debug('[insert-migration] phase-rotation', e);
  }
}
bootstrap();
