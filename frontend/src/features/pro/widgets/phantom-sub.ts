// phantom-sub.ts — pro widget

type HarmonicMode = 'octave' | 'fifth' | 'rich';

interface PhantomSubState {
  crossover_hz: number;
  mix: number;
  harmonic_mode: HarmonicMode;
  bypass: boolean;
}

interface PhantomSubUpdate {
  f0_hz?: number;
}

interface PhantomSubOptions extends Partial<PhantomSubState> {}

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
    phantomSubWidget?: typeof PhantomSubWidget;
    widgets?: Record<string, unknown>;
  };
  proInsertRack?: ProInsertRack;
}

const HARMONIC_MODES: ReadonlyArray<{ value: HarmonicMode; label: string }> = [
  { value: 'octave', label: 'Octave' },
  { value: 'fifth', label: 'Fifth' },
  { value: 'rich', label: 'Rich' },
];

/** Type guard: true iff `v` is a finite number (narrows `unknown` → `number`). */
function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v);
}

let _psUid = 0;

export class PhantomSubWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  state: PhantomSubState = {
    crossover_hz: 80,
    mix: 0.5,
    harmonic_mode: 'octave',
    bypass: false,
  };

  private readonly _uid = ++_psUid;
  private _listeners: BoundListener[] = [];
  private _destroyed = false;

  constructor() {
    /* noop — state initialised in field defaults. */
  }

  init(canvas: HTMLCanvasElement | null, options: PhantomSubOptions = {}): void {
    this.root = (canvas && canvas.parentElement) || null;
    if (!this.root) return;
    if (isFiniteNumber(options.crossover_hz)) this.state.crossover_hz = options.crossover_hz;
    if (isFiniteNumber(options.mix)) this.state.mix = options.mix;
    if (options.harmonic_mode) this.state.harmonic_mode = options.harmonic_mode;
    if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

    const u = this._uid;
    const card = document.createElement('div');
    card.className = 'pro-meter-card phantom-sub-widget';
    card.dataset.insertId = 'phantom-sub';
    card.dataset.endpoint = '/phantom-sub';
    card.innerHTML = `
      <div class="pro-flex-between-center">
        <strong>🔊 Phantom Sub</strong>
        <label class="ps-bypass" for="ps-bypass-${u}"><input id="ps-bypass-${u}" type="checkbox" data-role="bypass" ${this.state.bypass ? '' : 'checked'}/> Bypass</label>
      </div>
      <div class="ps-grid">
        <div>
          <label for="ps-crossover-${u}">Crossover (Hz)</label>
          <input id="ps-crossover-${u}" type="range" min="30" max="160" step="1" value="${this.state.crossover_hz}" data-role="crossover" aria-label="Crossover frequency (Hz)"/>
          <output data-role="crossoverVal">${this.state.crossover_hz} Hz</output>
        </div>
        <div>
          <label for="ps-mix-${u}">Mix</label>
          <input id="ps-mix-${u}" type="range" min="0" max="100" step="1" value="${Math.round(this.state.mix * 100)}" data-role="mix" aria-label="Mix amount"/>
          <output data-role="mixVal">${Math.round(this.state.mix * 100)}%</output>
        </div>
      </div>
      <div class="ps-harmonics">
        <label id="ps-harmonic-label-${u}">Harmonic Mode</label>
        <div id="ps-harmonics-${u}" data-role="harmonics" class="ps-harmonic-pills" role="radiogroup" aria-labelledby="ps-harmonic-label-${u}">
          ${HARMONIC_MODES.map((m) => `
            <button type="button" data-value="${m.value}" class="ps-pill ${m.value === this.state.harmonic_mode ? 'active' : ''}" role="radio" aria-checked="${m.value === this.state.harmonic_mode}" aria-label="Harmonic mode ${m.label}">${m.label}</button>
          `).join('')}
        </div>
      </div>
      <div class="ps-footer">
        <span data-role="f0">f₀: ${this.state.crossover_hz} Hz</span>
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

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: PhantomSubUpdate = {}): void {
    if (!this.cardEl) return;
    if (Number.isFinite(data.f0_hz)) {
      const f0 = this.cardEl.querySelector<HTMLElement>('[data-role="f0"]');
      if (f0) f0.textContent = `f₀: ${data.f0_hz} Hz`;
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
      bind('[data-role="crossover"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.crossover_hz = Number(input.value);
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="crossoverVal"]');
        if (out) out.textContent = `${input.value} Hz`;
        const f0 = this.cardEl?.querySelector<HTMLElement>('[data-role="f0"]');
        if (f0) f0.textContent = `f₀: ${input.value} Hz`;
      });
      bind('[data-role="mix"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.mix = Number(input.value) / 100;
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="mixVal"]');
        if (out) out.textContent = `${input.value}%`;
      });
      const pills = this.cardEl.querySelectorAll<HTMLButtonElement>('.ps-pill');
      pills.forEach((p) => {
        const fn: EventListener = () => {
          pills.forEach((x) => {
            x.classList.remove('active');
            x.setAttribute('aria-checked', 'false');
          });
          p.classList.add('active');
          p.setAttribute('aria-checked', 'true');
          this.state.harmonic_mode = p.dataset.value as HarmonicMode;
        };
        p.addEventListener('click', fn);
        this._listeners.push({ el: p, type: 'click', fn });
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.bypass = !input.checked;
      });
    } catch (err) {
      console.error('[phantom-sub] _wire failed:', err);
    }
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
// `premium-suite.ts` looks up the class by name on `LGMDM.proFeatures`
// (PRO_FEATURES['phantom-sub'].cls === 'phantomSubWidget'). We also expose
// it on the typed `proFeatures.widgets` map under the catalog key.
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.phantomSubWidget = PhantomSubWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['phantom-sub'] = PhantomSubWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Mapea al CATALOG key 'phantom-sub' (la UI usa crossover/mix/harmonic_mode;
// el backend recibe crossover_hz/mix/harmonic_mode — mapping idéntico).
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
      rack.CATALOG['phantom-sub']
    ) {
      const inst = rack.create({
        id: 'phantom-sub',
        title: 'Phantom Sub',
        endpoint: '/dsp/phantom-sub',
        widget: PhantomSubWidget,
      });
      if (inst) {
        PhantomSubWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['phantom-sub'] = inst;
      }
    }
  } catch { /* insert-migration ya ejecutado */ }
}
bootstrap();
