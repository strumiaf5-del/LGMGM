// multiband-transient.ts — pro widget. Port of aporte/js/pro-features/multiband-transient-widget.js.

import { clamp01, getPrefersReducedMotion } from '../../../core/utils';

type Band = 'low' | 'mid' | 'high';

const BAND_LABELS: Record<Band, string> = { low: 'Low', mid: 'Mid', high: 'High' };
const LED_THRESHOLDS = [0.55, 0.82]; // green / yellow / red transitions

let _mtwUid = 0;

function ledColor(level: number): string {
  if (!Number.isFinite(level)) return '#52f2bd';
  if (level < LED_THRESHOLDS[0]) return '#52f2bd';
  if (level < LED_THRESHOLDS[1]) return '#ffd84d';
  return '#ff5f72';
}

function clampPct(n: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-100, Math.min(100, v));
}

// ── Public state ──────────────────────────────────────────────
export interface MultibandTransientState {
  bands: Band[];
  attack_ms: number[];
  release_ms: number[];
  amount: number;
}

export interface MultibandTransientPayload {
  bands: Band[];
  attack_pct: number[];
  release_pct: number[];
  amount: number;
  attack_ms: number[];
  release_ms: number[];
}

export interface MultibandTransientUpdate {
  bands?: Band[];
  attack_ms?: number[];
  release_ms?: number[];
  amount?: number;
  levels?: number[];
}

export interface MultibandTransientInitOptions {
  amount?: number;
  attack_ms?: number[];
  release_ms?: number[];
  bands?: Band[];
  onApply?: (payload: MultibandTransientPayload) => void;
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

interface LgmdmUi {
  showToast?: (msg: string, kind: string, ms?: number) => void;
}
interface ProFeaturesNS {
  multibandTransientWidget?: unknown;
  widgets?: Record<string, unknown>;
}
interface LgmdmGlobal {
  proFeatures?: ProFeaturesNS;
  proInsertRack?: ProInsertRack;
  ui?: LgmdmUi;
}

function lg(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

// ── Widget ────────────────────────────────────────────────────
export class MultibandTransientWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  canvas: HTMLCanvasElement | null = null;
  root: HTMLElement | null = null;

  /** Public widget state — band params + amount. */
  state: MultibandTransientState = {
    bands: ['low', 'mid', 'high'],
    attack_ms: [10, 10, 10],
    release_ms: [100, 100, 100],
    amount: 0.5,
  };

  private _uid = ++_mtwUid;
  private controlsEl: HTMLElement | null = null;
  private rafId: number | null = null;
  private levels: [number, number, number] = [0, 0, 0];
  /** Internal user-set values for faders; scaled by Amount on output. */
  private _user: { attack: number[]; release: number[] } = {
    attack: [0, 0, 0],
    release: [0, 0, 0],
  };
  private _amount = 0.5;
  private ro: ResizeObserver | null = null;
  private ac: AbortController | null = null;
  private _onApply: ((payload: MultibandTransientPayload) => void) | null = null;
  private _destroyed = false;

  constructor() {
    // Standalone class; fields initialised above.
  }

  init(canvas: HTMLCanvasElement | null, options?: MultibandTransientInitOptions): void {
    this.canvas = canvas;
    this.root = canvas && canvas.parentElement ? canvas.parentElement : null;
    if (!this.root) return;

    const opts = options || {};
    this._amount = clamp01(opts.amount != null ? opts.amount : 0.5);
    if (Array.isArray(opts.attack_ms) && opts.attack_ms.length >= 3) {
      this.state.attack_ms = opts.attack_ms.slice(0, 3).map(Number);
    }
    if (Array.isArray(opts.release_ms) && opts.release_ms.length >= 3) {
      this.state.release_ms = opts.release_ms.slice(0, 3).map(Number);
    }
    if (Array.isArray(opts.bands) && opts.bands.length >= 3) {
      this.state.bands = opts.bands.slice(0, 3) as Band[];
    }

    const controls = document.createElement('div');
    controls.className = 'pro-meter-card pro-multiband-transient-controls';
    controls.style.cssText = 'display:flex;flex-direction:column;gap:.9rem;';
    controls.innerHTML = this.getControls();
    this.controlsEl = controls;

    if (this.canvas && this.canvas.parentElement === this.root) {
      this.canvas.insertAdjacentElement('afterend', controls);
    } else {
      this.root.appendChild(controls);
    }

    this._wireEvents();
    this._renderLedSnapshot();
    this._bindResize();
    this._startRaf();

    if (typeof opts.onApply === 'function') this._onApply = opts.onApply;

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: MultibandTransientUpdate | null): void {
    if (!data) return;
    if (Array.isArray(data.bands) && data.bands.length >= 3) {
      this.state.bands = data.bands.slice(0, 3) as Band[];
    }
    if (Array.isArray(data.attack_ms) && data.attack_ms.length >= 3) {
      this.state.attack_ms = data.attack_ms.slice(0, 3).map(Number);
    }
    if (Array.isArray(data.release_ms) && data.release_ms.length >= 3) {
      this.state.release_ms = data.release_ms.slice(0, 3).map(Number);
    }
    if (Number.isFinite(Number(data.amount))) {
      this._amount = clamp01(Number(data.amount));
      const root = this.root;
      if (root) {
        const amtEl = root.querySelector(`#mtw-amount-${this._uid}`) as HTMLInputElement | null;
        if (amtEl) amtEl.value = String(Math.round(this._amount * 100));
        const amtOut = root.querySelector(`#mtw-amount-val-${this._uid}`);
        if (amtOut) amtOut.textContent = `${Math.round(this._amount * 100)}%`;
      }
    }
    // Pulse meters if backend provides per-band levels
    if (Array.isArray(data.levels)) {
      for (let i = 0; i < 3 && i < data.levels.length; i++) {
        const v = clamp01(data.levels[i]);
        if (v > this.levels[i]) this.levels[i] = v;
      }
      if (this.rafId === null && this.levels.some((v) => v >= 0.01)) {
        this._startRaf();
      }
    }
    this._syncControlsFromState();
  }

  getControls(): string {
    const bands = (this.state.bands || ['low', 'mid', 'high']).slice(0, 3) as Band[];
    const amountPct = Math.round(this._amount * 100);
    const u = this._uid;
    const cols = bands
      .map((b, i) => {
        const label = BAND_LABELS[b] || b;
        const initA = clampPct(this._user.attack[i] != null ? this._user.attack[i] : 0);
        const initR = clampPct(this._user.release[i] != null ? this._user.release[i] : 0);
        return `
          <div class="pro-mtw-col" data-band-idx="${i}" data-band="${b}">
            <div class="pro-mtw-col__head">
              <strong>${label}</strong>
              <span>band ${i + 1}</span>
            </div>
            <div>
              <label for="mtw-attack-${u}-${i}">
                Attack
              </label>
              <input id="mtw-attack-${u}-${i}" type="range" class="mtw-fader-attack" data-idx="${i}"
                     min="-100" max="100" step="1" value="${initA}" aria-label="Attack (${label} band)">
              <output class="mtw-attack-out" data-idx="${i}">
                ${initA > 0 ? '+' : ''}${initA}%
              </output>
            </div>
            <div>
              <label for="mtw-release-${u}-${i}">
                Release
              </label>
              <input id="mtw-release-${u}-${i}" type="range" class="mtw-fader-release" data-idx="${i}"
                     min="-100" max="100" step="1" value="${initR}" aria-label="Release (${label} band)">
              <output class="mtw-release-out" data-idx="${i}">
                ${initR > 0 ? '+' : ''}${initR}%
              </output>
            </div>
            <div class="mtw-led-wrap" data-idx="${i}">
              <span class="mtw-led" data-idx="${i}"></span>
              <span class="mtw-led-bar" data-idx="${i}"
                    style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.06);
                           overflow:hidden;position:relative;">
                <span class="mtw-led-fill" data-idx="${i}"
                      style="display:block;height:100%;width:0%;background:#52f2bd;
                             transition:width .12s, background-color .12s;"></span>
              </span>
            </div>
          </div>
        `;
      })
      .join('');

    return `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
          <strong class="pro-card-title" style="font-size:.78rem;">
            ⚡ Multiband Transient Designer
          </strong>
          <span style="font-size:.6rem;color:var(--ui-muted,#9ba6c4);">
            Per-band envelope shaping · 3 bandas
          </span>
        </div>

        <div class="pro-mtw-cols"
             style="display:flex;gap:.7rem;align-items:stretch;flex-wrap:wrap;">
          ${cols}
        </div>

        <div class="pro-control-row" style="display:grid;grid-template-columns:140px 1fr 90px;
                                            align-items:center;gap:.8rem;margin:.4rem 0 0;">
          <label for="mtw-amount-${u}" style="font-size:.72rem;color:var(--ui-muted,#9ba6c4);">Amount</label>
          <input type="range" id="mtw-amount-${u}" min="0" max="100" step="1" value="${amountPct}"
                 style="width:100%;" aria-label="Amount">
          <output id="mtw-amount-val-${u}"
                  style="text-align:right;color:#bdf8ff;font-size:.72rem;">
            ${amountPct}%
          </output>
        </div>

        <div style="display:flex;justify-content:flex-end;gap:.5rem;">
          <button id="mtw-apply-${u}" class="pro-primary"
                  style="border-radius:10px;padding:.6rem 1.1rem;cursor:pointer;
                         border:1px solid rgba(92,232,255,.35);
                         background:linear-gradient(135deg,#42d9ff,#9b59ff);
                         color:#071018;font-weight:750;"
                  aria-label="Apply transient designer">
            ⚡ Apply Transient
          </button>
        </div>
      </div>
    `;
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ro) {
      try { this.ro.disconnect(); } catch { /* ignore */ }
      this.ro = null;
    }
    if (this.ac) {
      try { this.ac.abort(); } catch { /* ignore */ }
      this.ac = null;
    }
    if (this.controlsEl && this.controlsEl.parentElement) {
      this.controlsEl.parentElement.removeChild(this.controlsEl);
    }
    this.controlsEl = null;
    this.canvas = null;
    this.root = null;
    this._onApply = null;
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  // ── internals ───────────────────────────────────────────────
  private _wireEvents(): void {
    if (!this.root || !this.controlsEl) return;
    const root = this.controlsEl;
    this.ac = new AbortController();
    const signal = this.ac.signal;

    // Attack faders
    root.querySelectorAll<HTMLInputElement>('.mtw-fader-attack').forEach((el) => {
      el.addEventListener(
        'input',
        (e: Event) => {
          try {
            const target = e.target as HTMLInputElement;
            const idx = Number(target.dataset.idx);
            if (!Number.isInteger(idx)) return;
            const v = clampPct(Number(target.value));
            this._user.attack[idx] = v;
            const out = root.querySelector(`.mtw-attack-out[data-idx="${idx}"]`);
            if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`;
          } catch {
            /* defensive */
          }
        },
        { signal },
      );
    });

    // Release faders
    root.querySelectorAll<HTMLInputElement>('.mtw-fader-release').forEach((el) => {
      el.addEventListener(
        'input',
        (e: Event) => {
          try {
            const target = e.target as HTMLInputElement;
            const idx = Number(target.dataset.idx);
            if (!Number.isInteger(idx)) return;
            const v = clampPct(Number(target.value));
            this._user.release[idx] = v;
            const out = root.querySelector(`.mtw-release-out[data-idx="${idx}"]`);
            if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`;
          } catch {
            /* defensive */
          }
        },
        { signal },
      );
    });

    // Amount slider
    const amtEl = root.querySelector(`#mtw-amount-${this._uid}`) as HTMLInputElement | null;
    if (amtEl) {
      amtEl.addEventListener(
        'input',
        (e: Event) => {
          try {
            const target = e.target as HTMLInputElement;
            this._amount = clamp01(Number(target.value) / 100);
            const out = root.querySelector(`#mtw-amount-val-${this._uid}`);
            if (out) out.textContent = `${Math.round(this._amount * 100)}%`;
          } catch {
            /* defensive */
          }
        },
        { signal },
      );
    }

    // Apply button
    const applyBtn = root.querySelector(`#mtw-apply-${this._uid}`) as HTMLButtonElement | null;
    if (applyBtn) {
      applyBtn.addEventListener(
        'click',
        () => {
          try {
            this._emitApply();
          } catch {
            /* defensive */
          }
        },
        { signal },
      );
    }
  }

  private _emitApply(): void {
    const scaledAttack = this._user.attack.map((v) => clampPct(v * this._amount));
    const scaledRelease = this._user.release.map((v) => clampPct(v * this._amount));
    const payload: MultibandTransientPayload = {
      bands: this.state.bands.slice(0, 3) as Band[],
      attack_pct: scaledAttack,
      release_pct: scaledRelease,
      amount: this._amount,
      // Mapeo aproximado a ms (rangos razonables de transient designer)
      attack_ms: scaledAttack.map((p) => Math.max(0.5, 10 * Math.pow(10, p / 100))),
      release_ms: scaledRelease.map((p) => Math.max(5, 100 * Math.pow(10, p / 100))),
    };
    // Pulse LEDs to acknowledge apply
    for (let i = 0; i < 3; i++) this.levels[i] = 1.0;
    if (typeof this._onApply === 'function') {
      try {
        this._onApply(payload);
      } catch {
        /* noop */
      }
    }
    const ui = lg().ui;
    if (ui && typeof ui.showToast === 'function') {
      ui.showToast('Transient Designer: parámetros aplicados.', 'success', 2500);
    }
  }

  private _syncControlsFromState(): void {
    if (!this.controlsEl) return;
    // Reflect attack_ms/release_ms as percentages (log scale vs 10ms/100ms)
    for (let i = 0; i < 3; i++) {
      const aIn = this.controlsEl.querySelector(`.mtw-fader-attack[data-idx="${i}"]`) as HTMLInputElement | null;
      const rIn = this.controlsEl.querySelector(`.mtw-fader-release[data-idx="${i}"]`) as HTMLInputElement | null;
      if (aIn && Number.isFinite(this.state.attack_ms[i])) {
        const ms = Math.max(0.001, Number(this.state.attack_ms[i]));
        const pct = clampPct(Math.log10(ms / 10) * 100);
        aIn.value = String(Math.round(pct));
        this._user.attack[i] = pct;
        const out = this.controlsEl.querySelector(`.mtw-attack-out[data-idx="${i}"]`);
        if (out) out.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
      }
      if (rIn && Number.isFinite(this.state.release_ms[i])) {
        const ms = Math.max(0.001, Number(this.state.release_ms[i]));
        const pct = clampPct(Math.log10(ms / 100) * 100);
        rIn.value = String(Math.round(pct));
        this._user.release[i] = pct;
        const out = this.controlsEl.querySelector(`.mtw-release-out[data-idx="${i}"]`);
        if (out) out.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
      }
    }
  }

  private _bindResize(): void {
    if (typeof ResizeObserver === 'undefined' || !this.controlsEl) return;
    this.ro = new ResizeObserver(() => {
      try {
        this._renderLedSnapshot();
      } catch {
        /* ignore */
      }
    });
    this.ro.observe(this.controlsEl);
  }

  private _renderLedSnapshot(): void {
    if (!this.controlsEl) return;
    for (let i = 0; i < 3; i++) {
      const led = this.controlsEl.querySelector(`.mtw-led[data-idx="${i}"]`) as HTMLElement | null;
      const fill = this.controlsEl.querySelector(`.mtw-led-fill[data-idx="${i}"]`) as HTMLElement | null;
      const level = this.levels[i] || 0;
      const color = ledColor(level);
      if (led) {
        led.style.backgroundColor = color;
        led.style.boxShadow =
          level > 0 ? `0 0 ${6 + level * 14}px ${color}` : '0 0 6px rgba(82,242,189,.45)';
      }
      if (fill) {
        fill.style.width = `${Math.round(level * 100)}%`;
        fill.style.backgroundColor = color;
      }
    }
  }

  private _startRaf(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (getPrefersReducedMotion()) {
      // Static meters; no decay animation.
      this._renderLedSnapshot();
      return;
    }
    const FRAME_INTERVAL = 1000 / 60;
    let last = 0;
    const tick = (now: number): void => {
      this.rafId = null;
      if (!this.controlsEl) return;
      if (now - last < FRAME_INTERVAL) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      last = now;
      // Decay meters (peak-hold style)
      for (let i = 0; i < 3; i++) {
        this.levels[i] = Math.max(0, this.levels[i] * 0.93 - 0.005);
      }
      // Detener RAF cuando todos los levels cayeron a ~0 (evita idle 60fps).
      // update() lo reactiva automáticamente seteando levels[i] > 0.
      if (this.levels.every((v) => v < 0.01)) {
        this._renderLedSnapshot();
        return;
      }
      this._renderLedSnapshot();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.multibandTransientWidget = MultibandTransientWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['multiband-transient'] = MultibandTransientWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Frontend-only: attack/release por banda + amount, sin /dsp/* directo.
// Backward-compat: si NS.create falla, la clase sigue funcionando standalone.
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
      rack.CATALOG['multiband-transient']
    ) {
      const inst = rack.create({
        id: 'multiband-transient',
        title: '🥁 Multiband Transient',
        widget: MultibandTransientWidget,
      });
      if (inst) {
        MultibandTransientWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['multiband-transient'] = inst;
      }
    }
  } catch (e) {
    console.debug('[insert-migration] multiband-transient', e);
  }
}
bootstrap();
