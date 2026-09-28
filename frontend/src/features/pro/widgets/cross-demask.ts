// cross-demask.ts — pro widget

import { escapeHtml, showToast } from '../../../core/ui';

interface CrossDemaskState {
  target_stem: string | null;
  masking_stem: string | null;
  depth_db: number;
  sensitivity: number;
  bypass: boolean;
}

interface CrossDemaskUpdate {}

interface CrossDemaskOptions extends Partial<CrossDemaskState> {}

interface BoundListener {
  el: EventTarget;
  type: string;
  fn: EventListenerOrEventListenerObject;
}

interface StemsState {
  available?: string[];
  stems?: Record<string, unknown>;
}

interface LgmdmGlobal {
  proFeatures?: {
    crossDemaskWidget?: typeof CrossDemaskWidget;
    widgets?: Record<string, unknown>;
  };
  state?: { stems?: StemsState };
}

// FIX MX-12 — fallback si state.stems aún no existe (estado pre-evento).
// Mantener la lista hardcoded evita romper visualmente cuando los stems
// aún no están separados; el guard impide aplicar de todos modos.
const FALLBACK_STEMS = ['vocals', 'drums', 'bass', 'guitars', 'keys', 'lead'];

/** Type guard: true iff `v` is a finite number (narrows `unknown` → `number`). */
function isFiniteNumber(v: unknown): v is number {
  return Number.isFinite(v);
}

function getAvailableStems(): string[] {
  const lg = (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM;
  const s = lg && lg.state && lg.state.stems;
  if (!s) return [];
  if (Array.isArray(s.available) && s.available.length >= 2) return s.available.slice();
  if (s.stems && typeof s.stems === 'object') {
    const keys = Object.keys(s.stems);
    if (keys.length >= 2) return keys;
  }
  return [];
}

let _uidCounter = 0;

/**
 * Widget visual del insert "Cross Demasking" — resta una copia del stem
 * masking (e.g. vocals) del espectro del target (e.g. drums) para exponer
 * componentes enmascarados. State: target_stem, masking_stem, depth_db,
 * sensitivity, bypass.
 *
 * Lifecycle: `init(rootEl)` monta el DOM y registra listeners con
 * `bindOnce` para evitar duplicados en HMR; `teardown()` libera todo.
 */
export class CrossDemaskWidget {
  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  state: CrossDemaskState = {
    target_stem: null,
    masking_stem: null,
    depth_db: -4,
    sensitivity: 0.5,
    bypass: false,
  };

  private readonly id = ++_uidCounter;
  private _listeners: BoundListener[] = [];
  private _abort: AbortController | null = null;
  private _destroyed = false;

  constructor() {
    /* noop — state initialised in field defaults. */
  }

  init(canvas: HTMLCanvasElement | null, options: CrossDemaskOptions = {}): void {
    this.root = (canvas && canvas.parentElement) || null;
    if (!this.root) return;
    if (options.target_stem) this.state.target_stem = options.target_stem;
    if (options.masking_stem) this.state.masking_stem = options.masking_stem;
    if (isFiniteNumber(options.depth_db)) this.state.depth_db = options.depth_db;
    if (isFiniteNumber(options.sensitivity)) this.state.sensitivity = options.sensitivity;
    if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

    // FIX MX-12 — capturamos stems disponibles al momento del init para
    // pintar selects coherentes. Si no hay stems, mostramos hint y dejamos
    // Apply deshabilitado.
    const initialStems = getAvailableStems();
    const stemOptionsHtml = (initialStems.length >= 2 ? initialStems : FALLBACK_STEMS)
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join('');

    const card = document.createElement('div');
    card.className = 'pro-meter-card cross-demask-widget';
    card.dataset.insertId = 'cross-demask';
    card.dataset.endpoint = '/cross-demask';
    card.innerHTML = `
      <div class="pro-flex-between-center">
        <strong>🎭 Cross Demask</strong>
        <label class="cd-bypass"><input type="checkbox" data-role="bypass" ${this.state.bypass ? '' : 'checked'}/> Bypass</label>
      </div>
      <div class="cd-stem-hint" data-role="stemHint" hidden></div>
      <div class="cd-stems">
        <div>
          <label for="cd-target-stem-${this.id}">Target stem (a liberar)</label>
          <select id="cd-target-stem-${this.id}" data-role="targetStem" class="cd-select" ${initialStems.length >= 2 ? '' : 'disabled'} aria-label="Target stem a liberar">
            <option value="">— No seleccionado —</option>
            ${stemOptionsHtml}
          </select>
        </div>
        <div>
          <label for="cd-masking-stem-${this.id}">Masking stem (a reducir)</label>
          <select id="cd-masking-stem-${this.id}" data-role="maskingStem" class="cd-select" ${initialStems.length >= 2 ? '' : 'disabled'} aria-label="Masking stem a reducir">
            <option value="">— No seleccionado —</option>
            ${stemOptionsHtml}
          </select>
        </div>
      </div>
      <div class="cd-controls">
        <div>
          <label for="cd-depth-${this.id}">Depth</label>
          <input type="range" id="cd-depth-${this.id}" min="-30" max="0" step="0.5" value="${this.state.depth_db}" data-role="depth" aria-label="Depth"/>
          <output data-role="depthVal">${this.state.depth_db.toFixed(1)} dB</output>
        </div>
        <div>
          <label for="cd-sensitivity-${this.id}">Sensitivity</label>
          <input type="range" id="cd-sensitivity-${this.id}" min="0" max="100" step="1" value="${Math.round(this.state.sensitivity * 100)}" data-role="sensitivity" aria-label="Sensitivity"/>
          <output data-role="sensitivityVal">${Math.round(this.state.sensitivity * 100)}%</output>
        </div>
      </div>
      <div class="cd-sidechain">
        <span data-role="sidechain" class="cd-sidechain-status">Sidechain: ${this.state.masking_stem ? this.state.masking_stem : '—'} → ${this.state.target_stem ? this.state.target_stem : '—'}</span>
      </div>
      <div class="cd-footer">
        <button type="button" class="cd-apply" data-role="apply" disabled title="Load stems first" aria-label="Apply cross-demasking">⚡ Apply</button>
        <span data-role="stemsStatus" class="cd-stems-status" data-state="warning">Stems: not loaded</span>
        <span data-role="status">${this._ready() ? 'Ready' : 'Selecciona target + masking'}</span>
      </div>
    `;
    if (canvas && canvas.parentElement === this.root) {
      canvas.insertAdjacentElement('afterend', card);
    } else {
      this.root.appendChild(card);
    }
    this.cardEl = card;
    this._wire();
    this._refreshStemsUI();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(_data: CrossDemaskUpdate = {}): void {
    /* No-op: cross-demask is fully client-driven; kept for API parity. */
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
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    if (this.cardEl && this.cardEl.parentNode) {
      this.cardEl.parentNode.removeChild(this.cardEl);
    }
    this.cardEl = null;
  }

  private _ready(): boolean {
    return !!(this.state.target_stem && this.state.masking_stem);
  }

  // FIX MX-12 — ¿hay stems separados en el state?
  private _hasStems(): boolean {
    return getAvailableStems().length >= 2;
  }

  // FIX MX-12 — refresca selects + Apply según stems disponibles.
  // Llamar en init y cuando llegue el evento `stems-loaded`.
  private _refreshStemsUI(): void {
    if (!this.cardEl) return;
    const available = getAvailableStems();
    const stems = available.length >= 2 ? available : FALLBACK_STEMS;
    const has = available.length >= 2;
    const optionsHtml = stems
      .map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`)
      .join('');

    // Reconstruir options de ambos selects preservando el placeholder.
    (['targetStem', 'maskingStem'] as const).forEach((role) => {
      const sel = this.cardEl?.querySelector<HTMLSelectElement>(`[data-role="${role}"]`);
      if (!sel) return;
      const previous = sel.value;
      sel.innerHTML = `<option value="">— No seleccionado —</option>${optionsHtml}`;
      // Si el valor anterior sigue siendo válido, restaurarlo; si no, resetear.
      sel.value = stems.includes(previous) ? previous : '';
      sel.disabled = !has;
    });

    // Limpiar selección si los stems previos ya no están disponibles.
    if (this.state.target_stem != null && !stems.includes(this.state.target_stem)) {
      this.state.target_stem = null;
    }
    if (this.state.masking_stem != null && !stems.includes(this.state.masking_stem)) {
      this.state.masking_stem = null;
    }

    // Hint visual cuando NO hay stems.
    const hint = this.cardEl.querySelector<HTMLElement>('[data-role="stemHint"]');
    if (hint) {
      if (!has) {
        hint.hidden = false;
        hint.textContent = 'Necesitás separar los stems primero (botón "Separar Stems" en la barra de herramientas).';
        hint.dataset.state = 'warning';
      } else {
        hint.hidden = true;
        hint.textContent = '';
        delete hint.dataset.state;
      }
    }

    const stemsStatus = this.cardEl.querySelector<HTMLElement>('[data-role="stemsStatus"]');
    if (stemsStatus) {
      stemsStatus.textContent = has
        ? `Stems: loaded (${available.length})`
        : 'Stems: not loaded';
      stemsStatus.dataset.state = has ? 'ok' : 'warning';
    }

    this._updateSidechain();
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
      bind('[data-role="targetStem"]', 'change', (e) => {
        const sel = e.target as HTMLSelectElement;
        this.state.target_stem = sel.value || null;
        this._updateSidechain();
      });
      bind('[data-role="maskingStem"]', 'change', (e) => {
        const sel = e.target as HTMLSelectElement;
        this.state.masking_stem = sel.value || null;
        this._updateSidechain();
      });
      bind('[data-role="depth"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.depth_db = Number(input.value);
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="depthVal"]');
        if (out) out.textContent = `${input.value} dB`;
      });
      bind('[data-role="sensitivity"]', 'input', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.sensitivity = Number(input.value) / 100;
        const out = this.cardEl?.querySelector<HTMLElement>('[data-role="sensitivityVal"]');
        if (out) out.textContent = `${input.value}%`;
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        const input = e.target as HTMLInputElement;
        this.state.bypass = !input.checked;
      });
      bind('[data-role="apply"]', 'click', () => {
        if (!this._ready()) return;
        if (!this._hasStems()) {
          // Guard defensivo: si por race condition el botón quedara habilitado,
          // bloqueamos el apply y avisamos sin dispatch.
          showToast(
            'Necesitás separar los stems primero para aplicar Cross-Demask.',
            'warning',
            4000,
          );
          const status = this.cardEl?.querySelector<HTMLElement>('[data-role="status"]');
          if (status) status.textContent = 'Separar stems primero';
          return;
        }
        const evt = new CustomEvent('cross-demask-apply', { detail: { ...this.state } });
        this.cardEl?.dispatchEvent(evt);
      });

      // FIX MX-12 — escuchar stems-loaded para re-pintar selects sin polling.
      // 01-state.js dispara este evento tanto en load como en unload (con
      // `detail.loaded` para distinguir); basta refrescar la UI ante ambos.
      // AbortController: el listener se remueve automáticamente en teardown.
      this._abort = this._abort || new AbortController();
      window.addEventListener(
        'stems-loaded',
        () => this._refreshStemsUI(),
        { signal: this._abort.signal },
      );
    } catch (err) {
      console.error('[cross-demask] _wire failed:', err);
    }
  }

  private _updateSidechain(): void {
    if (!this.cardEl) return;
    const sc = this.cardEl.querySelector<HTMLElement>('[data-role="sidechain"]');
    if (sc) {
      sc.textContent = `Sidechain: ${this.state.masking_stem || '—'} → ${this.state.target_stem || '—'}`;
    }
    // FIX MX-12 — Apply deshabilitado si NO hay stems, aunque los selects
    // parezcan tener valor. Prioridad: stems-gate > selectores listos.
    const apply = this.cardEl.querySelector<HTMLButtonElement>('[data-role="apply"]');
    if (apply) {
      const has = this._hasStems();
      const ready = this._ready();
      apply.disabled = !has || !ready;
      apply.title = !has
        ? 'Load stems first'
        : !ready
          ? 'Select target and masking stems'
          : 'Apply cross-demasking';
    }
    const status = this.cardEl.querySelector<HTMLElement>('[data-role="status"]');
    if (status) {
      if (!this._hasStems()) status.textContent = 'Separar stems primero';
      else status.textContent = this._ready() ? 'Ready' : 'Selecciona target + masking';
    }
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.crossDemaskWidget = CrossDemaskWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['cross-demask'] = CrossDemaskWidget;
