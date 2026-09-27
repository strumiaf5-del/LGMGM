// resonance-tamer.ts — pro widget

import { getPrefersReducedMotion } from '../../../core/utils';

interface ResonanceTamerState {
  sensitivity: number;
  depth_db: number;
  n_bands: number;
  bypass: boolean;
}

interface ResonanceTamerUpdate {
  reduction_db?: number;
  spectrum?: number[];
}

interface ResonanceTamerOptions extends Partial<ResonanceTamerState> {}

interface BoundListener {
  el: EventTarget;
  type: string;
  fn: EventListenerOrEventListenerObject;
}

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

interface LgmdmGlobal {
  proFeatures?: {
    resonanceTamerWidget?: typeof ResonanceTamerWidget;
    widgets?: Record<string, unknown>;
  };
  proInsertRack?: ProInsertRack;
}

/** Type guard: true iff `v` is a finite number (narrows `unknown` → `number`). */
function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v);
}

let _rtUid = 0;

export class ResonanceTamerWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;
  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  state: ResonanceTamerState = {
    sensitivity: 0.5,
    depth_db: -6,
    n_bands: 64,
    bypass: false,
  };

  private readonly _uid = ++_rtUid;
  private _listeners: BoundListener[] = [];
  private _spectrumRaf = 0;
  private _reduction = 0;
  private _hasSpectrumData = false;
  private _spectrumBands: number[] | null = null;
  private _destroyed = false;

  constructor() {
    /* noop — state initialised in field defaults. */
  }

  init(canvas: HTMLCanvasElement | null, options: ResonanceTamerOptions = {}): void {
    this.root = (canvas && canvas.parentElement) || null;
    if (!this.root) return;
    if (isFiniteNumber(options.sensitivity)) this.state.sensitivity = options.sensitivity;
    if (isFiniteNumber(options.depth_db)) this.state.depth_db = options.depth_db;
    if (isFiniteNumber(options.n_bands)) this.state.n_bands = options.n_bands;
    if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

    const u = this._uid;
    const card = document.createElement('div');
    card.className = 'pro-meter-card resonance-tamer-widget';
    card.dataset.insertId = 'resonance-tamer';
    card.dataset.endpoint = '/resonance-tamer';
    card.innerHTML = `
      <div class="pro-flex-between-center">
        <strong>🎯 Resonance Tamer</strong>
        <label class="rt-bypass" for="rt-bypass-${u}"><input id="rt-bypass-${u}" type="checkbox" data-role="bypass" ${this.state.bypass ? '' : 'checked'}/> Bypass</label>
      </div>
      <div class="rt-row">
        <div>
          <label for="rt-sensitivity-${u}">Sensitivity</label>
          <input id="rt-sensitivity-${u}" type="range" min="0" max="100" step="1" value="${Math.round(this.state.sensitivity * 100)}" data-role="sensitivity" aria-label="Sensitivity"/>
          <output data-role="sensitivityVal">${Math.round(this.state.sensitivity * 100)}%</output>
        </div>
        <div>
          <label for="rt-depth-${u}">Depth</label>
          <input id="rt-depth-${u}" type="range" min="-24" max="0" step="0.5" value="${this.state.depth_db}" data-role="depth" aria-label="Depth (dB)"/>
          <output data-role="depthVal">${this.state.depth_db.toFixed(1)} dB</output>
        </div>
        <div>
          <label for="rt-bands-${u}">Bands</label>
          <select id="rt-bands-${u}" data-role="nBands" aria-label="Number of bands">
            <option value="32">32 (broad)</option>
            <option value="48">48</option>
            <option value="64" selected>64 (default)</option>
            <option value="96">96 (precise)</option>
            <option value="128">128 (surgical)</option>
          </select>
        </div>
      </div>
      <canvas data-role="spectrum" width="320" height="80" class="rt-spectrum" tabindex="0" role="img" aria-label="Live spectrum analyzer"></canvas>
      <div class="rt-footer">
        <span data-role="status">Ready</span>
        <span data-role="reduction">Reduction: 0.0 dB</span>
      </div>
    `;
    if (canvas && canvas.parentElement === this.root) {
      canvas.insertAdjacentElement('afterend', card);
    } else {
      this.root.appendChild(card);
    }
    this.cardEl = card;
    this._wire();
    this._startSpectrum();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: ResonanceTamerUpdate = {}): void {
    if (isFiniteNumber(data.reduction_db)) this._reduction = data.reduction_db;
    if (Array.isArray(data.spectrum) && data.spectrum.length) {
      this._hasSpectrumData = true;
      this._spectrumBands = data.spectrum;
      // Si el RAF estaba pausado por falta de datos, reiniciarlo.
      if (!this._spectrumRaf) this._startSpectrum();
    }
    if (this.cardEl) {
      const red = this.cardEl.querySelector<HTMLElement>('[data-role="reduction"]');
      if (red) red.textContent = `Reduction: ${this._reduction.toFixed(1)} dB`;
    }
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
    this._listeners = [];
    if (this._spectrumRaf) {
      cancelAnimationFrame(this._spectrumRaf);
      this._spectrumRaf = 0;
    }
    if (this.cardEl && this.cardEl.parentNode) {
      this.cardEl.parentNode.removeChild(this.cardEl);
    }
    this.cardEl = null;
  }

  private _wire(): void {
    if (!this.cardEl) return;
    const bind = (sel: string, type: string, fn: EventListener): void => {
      const el = this.cardEl?.querySelector<HTMLElement>(sel);
      if (el) {
        el.addEventListener(type, fn);
        this._listeners.push({ el, type, fn });
      }
    };
    try {
      bind('[data-role="sensitivity"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.sensitivity = Number(input.value) / 100;
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="sensitivityVal"]');
        if (out) out.textContent = `${input.value}%`;
      });
      bind('[data-role="depth"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.depth_db = Number(input.value);
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="depthVal"]');
        if (out) out.textContent = `${input.value} dB`;
      });
      bind('[data-role="nBands"]', 'change', (e) => {
        const sel = e.target as HTMLSelectElement;
        this.state.n_bands = Number(sel.value);
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.bypass = !input.checked;
      });
    } catch (err) {
      console.error('[resonance-tamer] _wire failed:', err);
    }
  }

  private _startSpectrum(): void {
    const cv = this.cardEl?.querySelector<HTMLCanvasElement>('[data-role="spectrum"]');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const tick = (): void => {
      if (this._destroyed) return;
      this._spectrumRaf = 0;
      // Honra prefers-reduced-motion: bajo esta preferencia no animamos el
      // espectro (deja el canvas en reposo). update() puede forzar un único
      // redibujado si hace falta reiniciar el loop más adelante.
      if (getPrefersReducedMotion()) return;
      try {
        const w = cv.width;
        const h = cv.height;
        ctx.fillStyle = '#070912';
        ctx.fillRect(0, 0, w, h);
        // Si NO hay datos espectrales reales, pintar 1 frame estático
        // "Esperando…" y salir del RAF (reducir CPU/GPU). update() reinicia.
        if (!this._hasSpectrumData) {
          ctx.fillStyle = 'rgba(125,232,255,0.55)';
          ctx.font = '11px ui-monospace, monospace';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('Esperando señal…', w / 2, h / 2);
          return;
        }
        const bands = this._spectrumBands || [];
        const bars = Math.min(48, Math.max(8, bands.length || 48));
        const scale = h;
        for (let i = 0; i < bars; i++) {
          const raw = bands[i];
          const v = Number.isFinite(raw)
            ? Math.max(0, Math.min(1, (raw + 80) / 80))
            : 0.3 + 0.5 * Math.abs(Math.sin(Date.now() / 200 + i * 0.3)) * (1 - this._reduction / 24);
          ctx.fillStyle = `rgba(125,232,255,${0.4 + 0.4 * v})`;
          const bw = w / bars - 1;
          ctx.fillRect(i * (bw + 1), h - v * scale, bw, v * scale);
        }
        this._spectrumRaf = requestAnimationFrame(tick);
      } catch (err) {
        console.error('[resonance-tamer] spectrum tick failed:', err);
      }
    };
    tick();
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.resonanceTamerWidget = ResonanceTamerWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['resonance-tamer'] = ResonanceTamerWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Mapea al CATALOG key 'resonance-tamer' (la UI usa sensitivity/depth_db/
// n_bands; el backend recibe los mismos nombres — mapping idéntico).
// Backward-compat: si rack.create falla, la clase sigue funcionando standalone.
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
      rack.CATALOG['resonance-tamer']
    ) {
      const inst = rack.create({
        id: 'resonance-tamer',
        title: '🎯 Resonance Tamer',
        endpoint: '/dsp/resonance-tamer',
        widget: ResonanceTamerWidget,
      });
      if (inst) {
        ResonanceTamerWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['resonance-tamer'] = inst;
      }
    }
  } catch { /* insert-migration ya ejecutado */ }
}
bootstrap();
