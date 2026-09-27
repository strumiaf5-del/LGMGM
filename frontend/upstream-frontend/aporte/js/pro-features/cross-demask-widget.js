// ============================================================
// cross-demask-widget.js — Desmascaramiento espectral entre stems
// Endpoint: /dsp/cross-demask (target_stem, masking_stem, depth_db, sensitivity)
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  // FIX MX-12 — fallback si state.stems aún no existe (estado pre-evento).
  // Mantener la lista hardcoded evita romper visualmente cuando los stems
  // aún no están separados; el guard impide aplicar de todos modos.
  const FALLBACK_STEMS = ['vocals', 'drums', 'bass', 'guitars', 'keys', 'lead'];

  function getAvailableStems() {
    const s = LG.state && LG.state.stems;
    if (!s) return [];
    if (Array.isArray(s.available) && s.available.length >= 2) return s.available.slice();
    if (s.stems && typeof s.stems === 'object') {
      const keys = Object.keys(s.stems);
      if (keys.length >= 2) return keys;
    }
    return [];
  }

  let _uidCounter = 0;

  class crossDemaskWidget {
    constructor() {
      this.root = null;
      this.id = ++_uidCounter;
      this.state = { target_stem: null, masking_stem: null, depth_db: -4, sensitivity: 0.5, bypass: false };
      this._listeners = [];
    }

    init(canvas, options = {}) {
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;
      if (options.target_stem) this.state.target_stem = options.target_stem;
      if (options.masking_stem) this.state.masking_stem = options.masking_stem;
      if (Number.isFinite(options.depth_db)) this.state.depth_db = options.depth_db;
      if (Number.isFinite(options.sensitivity)) this.state.sensitivity = options.sensitivity;
      if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

      // FIX MX-12 — capturamos stems disponibles al momento del init
      // para pintar selects coherentes. Si no hay stems, mostramos hint
      // y dejamos Apply deshabilitado.
      const initialStems = getAvailableStems();
      const stemOptionsHtml = (initialStems.length >= 2 ? initialStems : FALLBACK_STEMS)
        .map((s) => `<option value="${(global.LGMDM?.ui?.escapeHtml || String)(s)}">${(global.LGMDM?.ui?.escapeHtml || String)(s)}</option>`)
        .join('');

      const card = document.createElement('div');
      card.className = 'pro-meter-card cross-demask-widget';
      card.dataset.insertId = 'cross-demask';
      card.dataset.endpoint = '/dsp/cross-demask';
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
    }

    update(data = {}) {}

    destroy() {
      this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
      this._listeners = [];
      if (this._onStemsLoaded) {
        global.removeEventListener('stems-loaded', this._onStemsLoaded);
        this._onStemsLoaded = null;
      }
    }

    _ready() {
      return !!(this.state.target_stem && this.state.masking_stem);
    }

    // FIX MX-12 — ¿hay stems separados en el state?
    _hasStems() {
      return getAvailableStems().length >= 2;
    }

    // FIX MX-12 — refresca selects + Apply según stems disponibles.
    // Llamar en init y cuando llegue el evento `stems-loaded`.
    _refreshStemsUI() {
      if (!this.cardEl) return;
      const available = getAvailableStems();
      const stems = available.length >= 2 ? available : FALLBACK_STEMS;
      const has = available.length >= 2;
      const esc = (v) => (global.LGMDM?.ui?.escapeHtml || String)(v);
      const optionsHtml = stems.map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');

      // Reconstruir options de ambos selects preservando el placeholder.
      ['targetStem', 'maskingStem'].forEach((role) => {
        const sel = this.cardEl.querySelector(`[data-role="${role}"]`);
        if (!sel) return;
        const previous = sel.value;
        sel.innerHTML = `<option value="">— No seleccionado —</option>${optionsHtml}`;
        // Si el valor anterior sigue siendo válido, restaurarlo; si no, resetear.
        sel.value = stems.includes(previous) ? previous : '';
        sel.disabled = !has;
      });

      // Limpiar selección si los stems previos ya no están disponibles.
      if (!stems.includes(this.state.target_stem)) this.state.target_stem = null;
      if (!stems.includes(this.state.masking_stem)) this.state.masking_stem = null;

      // Hint visual cuando NO hay stems.
      const hint = this.cardEl.querySelector('[data-role="stemHint"]');
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

      const stemsStatus = this.cardEl.querySelector('[data-role="stemsStatus"]');
      if (stemsStatus) {
        stemsStatus.textContent = has
          ? `Stems: loaded (${available.length})`
          : 'Stems: not loaded';
        stemsStatus.dataset.state = has ? 'ok' : 'warning';
      }

      this._updateSidechain();
    }

    _wire() {
      const bind = (sel, type, fn) => {
        const el = this.cardEl.querySelector(sel);
        if (el) {
          el.addEventListener(type, fn);
          this._listeners.push({ el, type, fn });
        }
      };
      bind('[data-role="targetStem"]', 'change', (e) => {
        this.state.target_stem = e.target.value || null;
        this._updateSidechain();
      });
      bind('[data-role="maskingStem"]', 'change', (e) => {
        this.state.masking_stem = e.target.value || null;
        this._updateSidechain();
      });
      bind('[data-role="depth"]', 'input', (e) => {
        this.state.depth_db = Number(e.target.value);
        const out = this.cardEl.querySelector('[data-role="depthVal"]');
        if (out) out.textContent = `${e.target.value} dB`;
      });
      bind('[data-role="sensitivity"]', 'input', (e) => {
        this.state.sensitivity = Number(e.target.value) / 100;
        const out = this.cardEl.querySelector('[data-role="sensitivityVal"]');
        if (out) out.textContent = `${e.target.value}%`;
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        this.state.bypass = !e.target.checked;
      });
      bind('[data-role="apply"]', 'click', () => {
        if (!this._ready()) return;
        if (!this._hasStems()) {
          // Guard defensivo: si por race condition el botón quedara habilitado,
          // bloqueamos el apply y avisamos sin dispatch.
          if (global.LGMDM?.ui?.showToast) {
            global.LGMDM.ui.showToast('Necesitás separar los stems primero para aplicar Cross-Demask.', 'warning', 4000);
          }
          const status = this.cardEl.querySelector('[data-role="status"]');
          if (status) status.textContent = 'Separar stems primero';
          return;
        }
        const evt = new CustomEvent('cross-demask-apply', { detail: { ...this.state } });
        this.cardEl.dispatchEvent(evt);
      });

      // FIX MX-12 — escuchar stems-loaded para re-pintar selects sin polling.
      // 01-state.js dispara este evento tanto en load como en unload (con
      // `detail.loaded` para distinguir); basta refrescar la UI ante ambos.
      this._onStemsLoaded = () => this._refreshStemsUI();
      global.addEventListener('stems-loaded', this._onStemsLoaded);
    }

    _updateSidechain() {
      const sc = this.cardEl.querySelector('[data-role="sidechain"]');
      if (sc) sc.textContent = `Sidechain: ${this.state.masking_stem || '—'} → ${this.state.target_stem || '—'}`;
      // FIX MX-12 — Apply deshabilitado si NO hay stems, aunque los selects
      // parezcan tener valor. Prioridad: stems-gate > selectores listos.
      const apply = this.cardEl.querySelector('[data-role="apply"]');
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
      const status = this.cardEl.querySelector('[data-role="status"]');
      if (status) {
        if (!this._hasStems()) status.textContent = 'Separar stems primero';
        else status.textContent = this._ready() ? 'Ready' : 'Selecciona target + masking';
      }
    }
  }

  LG.proFeatures.crossDemaskWidget = crossDemaskWidget;
})(typeof window !== 'undefined' ? window : globalThis);
