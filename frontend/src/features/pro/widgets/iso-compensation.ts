// iso-compensation.ts — pro widget. Port of aporte/js/pro-features/iso-compensation-widget.js.

interface IsoCompensationState {
  playback_phon: number;
  reference_phon: number;
  strength: number;
  bypass: boolean;
}

interface IsoCompensationUpdate {
  delta_db?: number;
}

interface IsoCompensationOptions extends Partial<IsoCompensationState> {}

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
    isoCompensationWidget?: typeof IsoCompensationWidget;
    widgets?: Record<string, unknown>;
  };
  proInsertRack?: ProInsertRack;
}

const PHON_PRESETS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 40, label: '40 phon (silencio)' },
  { value: 60, label: '60 phon (oficina)' },
  { value: 80, label: '80 phon (referencia)' },
  { value: 100, label: '100 phon (fuerte)' },
];

/** Type guard: true iff `v` is a finite number (narrows `unknown` → `number`). */
function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v);
}

let _isoUid = 0;

export class IsoCompensationWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  state: IsoCompensationState = {
    playback_phon: 80,
    reference_phon: 80,
    strength: 0.5,
    bypass: false,
  };

  private readonly _uid = ++_isoUid;
  private _listeners: BoundListener[] = [];
  private _raf = 0;
  private _destroyed = false;

  constructor() {
    /* noop — state initialised in field defaults. */
  }

  init(canvas: HTMLCanvasElement | null, options: IsoCompensationOptions = {}): void {
    this.root = (canvas && canvas.parentElement) || null;
    if (!this.root) return;
    if (isFiniteNumber(options.playback_phon)) this.state.playback_phon = options.playback_phon;
    if (isFiniteNumber(options.reference_phon)) this.state.reference_phon = options.reference_phon;
    if (isFiniteNumber(options.strength)) this.state.strength = options.strength;
    if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

    const u = this._uid;
    const card = document.createElement('div');
    card.className = 'pro-meter-card iso-compensation-widget';
    card.dataset.insertId = 'iso-compensation';
    card.dataset.endpoint = '/iso-compensation';
    card.innerHTML = `
      <div class="pro-flex-between-center">
        <strong>🔉 ISO 226 Compensation</strong>
        <label class="ic-bypass" for="ic-bypass-${u}"><input id="ic-bypass-${u}" type="checkbox" data-role="bypass" ${this.state.bypass ? '' : 'checked'}/> Bypass</label>
      </div>
      <div class="ic-grid">
        <div>
          <label for="ic-playback-phon-${u}">Playback (phon)</label>
          <select id="ic-playback-phon-${u}" data-role="playbackPhon" class="ic-select" aria-label="Playback phon">
            ${PHON_PRESETS.map((p) => `<option value="${p.value}" ${p.value === this.state.playback_phon ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="ic-reference-phon-${u}">Reference (phon)</label>
          <select id="ic-reference-phon-${u}" data-role="referencePhon" class="ic-select" aria-label="Reference phon">
            ${PHON_PRESETS.map((p) => `<option value="${p.value}" ${p.value === this.state.reference_phon ? 'selected' : ''}>${p.label}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="ic-strength-${u}">Strength</label>
          <input id="ic-strength-${u}" type="range" min="0" max="100" step="1" value="${Math.round(this.state.strength * 100)}" data-role="strength" aria-label="Strength"/>
          <output data-role="strengthVal">${Math.round(this.state.strength * 100)}%</output>
        </div>
      </div>
      <canvas data-role="isoCurve" width="320" height="120" class="ic-curve" tabindex="0" role="img" aria-label="ISO 226 equal-loudness curve preview"></canvas>
      <div class="ic-footer">
        <span data-role="delta">Δ: +0.0 dB</span>
        <span data-role="status">Ready</span>
      </div>
    `;
    if (canvas && canvas.parentElement === this.root) {
      canvas.insertAdjacentElement('afterend', card);
    } else {
      this.root.appendChild(card);
    }
    this.cardEl = card;
    this._wire();
    this._drawCurve();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: IsoCompensationUpdate = {}): void {
    if (!this.cardEl) return;
    if (isFiniteNumber(data.delta_db)) {
      const out = this.cardEl.querySelector<HTMLElement>('[data-role="delta"]');
      if (out) out.textContent = `Δ: ${data.delta_db >= 0 ? '+' : ''}${data.delta_db.toFixed(1)} dB`;
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
    if (this._raf) {
      cancelAnimationFrame(this._raf);
      this._raf = 0;
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
      bind('[data-role="playbackPhon"]', 'change', (e) => {
        const sel = e.target as HTMLSelectElement;
        this.state.playback_phon = Number(sel.value);
        this._drawCurve();
      });
      bind('[data-role="referencePhon"]', 'change', (e) => {
        const sel = e.target as HTMLSelectElement;
        this.state.reference_phon = Number(sel.value);
        this._drawCurve();
      });
      bind('[data-role="strength"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.strength = Number(input.value) / 100;
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="strengthVal"]');
        if (out) out.textContent = `${input.value}%`;
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.bypass = !input.checked;
      });
    } catch (err) {
      console.error('[iso-compensation] _wire failed:', err);
    }
  }

  private _drawCurve(): void {
    const cv = this.cardEl?.querySelector<HTMLCanvasElement>('[data-role="isoCurve"]');
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    try {
      const w = cv.width;
      const h = cv.height;
      ctx.fillStyle = '#070912';
      ctx.fillRect(0, 0, w, h);
      // Curva ISO 226 simplificada
      ctx.strokeStyle = 'rgba(125,232,255,0.6)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x < w; x++) {
        const f = 20 * Math.pow(1000, x / w);
        const phon = this.state.playback_phon;
        const fl = Math.log10(Math.max(f, 1));
        const spl =
          phon +
          (30 * Math.exp(-0.05 * Math.pow(f - 1000, 2)) / 10000) -
          10 * Math.exp(-Math.pow(fl - 1.5, 2));
        ctx.lineTo(x, h - Math.max(0, Math.min(1, spl / 120)) * h);
      }
      ctx.stroke();
    } catch (err) {
      console.error('[iso-compensation] _drawCurve failed:', err);
    }
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.isoCompensationWidget = IsoCompensationWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['iso-compensation'] = IsoCompensationWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Mapea al CATALOG key 'iso-compensation' (la UI usa
// playback_phon/reference_phon/strength; el backend recibe los mismos
// nombres — mapping idéntico). Backward-compat: si NS.create falla, la clase
// sigue funcionando standalone.
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
      rack.CATALOG['iso-compensation']
    ) {
      const inst = rack.create({
        id: 'iso-compensation',
        title: 'ISO 226 Compensation',
        endpoint: '/dsp/iso-compensation',
        widget: IsoCompensationWidget,
      });
      if (inst) {
        IsoCompensationWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['iso-compensation'] = inst;
      }
    }
  } catch (e) {
    console.debug('[insert-migration] iso-compensation', e);
  }
}
bootstrap();
