// ============================================================
// phantom-sub-widget.js — Sintetizador psicoacústico de graves
// Endpoint: /dsp/phantom-sub (crossover_hz, mix, harmonic_mode)
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  const HARMONIC_MODES = [
    { value: 'octave', label: 'Octave' },
    { value: 'fifth', label: 'Fifth' },
    { value: 'rich', label: 'Rich' }
  ];

  let _psUid = 0;

  class phantomSubWidget {
    constructor() {
      this.root = null;
      this._uid = ++_psUid;
      this.state = { crossover_hz: 80, mix: 0.5, harmonic_mode: 'octave', bypass: false };
      this._listeners = [];
    }

    init(canvas, options = {}) {
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;
      if (Number.isFinite(options.crossover_hz)) this.state.crossover_hz = options.crossover_hz;
      if (Number.isFinite(options.mix)) this.state.mix = options.mix;
      if (options.harmonic_mode) this.state.harmonic_mode = options.harmonic_mode;
      if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

      const u = this._uid;
      const card = document.createElement('div');
      card.className = 'pro-meter-card phantom-sub-widget';
      card.dataset.insertId = 'phantom-sub';
      card.dataset.endpoint = '/dsp/phantom-sub';
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
            ${HARMONIC_MODES.map(m => `
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
    }

    update(data = {}) {
      if (Number.isFinite(data.f0_hz)) {
        const f0 = this.cardEl.querySelector('[data-role="f0"]');
        if (f0) f0.textContent = `f₀: ${data.f0_hz} Hz`;
      }
    }

    destroy() {
      this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
      this._listeners = [];
    }

    _wire() {
      const bind = (sel, type, fn) => {
        const el = this.cardEl.querySelector(sel);
        if (el) {
          el.addEventListener(type, fn);
          this._listeners.push({ el, type, fn });
        }
      };
      bind('[data-role="crossover"]', 'input', (e) => {
        this.state.crossover_hz = Number(e.target.value);
        const out = this.cardEl.querySelector('[data-role="crossoverVal"]');
        if (out) out.textContent = `${e.target.value} Hz`;
        const f0 = this.cardEl.querySelector('[data-role="f0"]');
        if (f0) f0.textContent = `f₀: ${e.target.value} Hz`;
      });
      bind('[data-role="mix"]', 'input', (e) => {
        this.state.mix = Number(e.target.value) / 100;
        const out = this.cardEl.querySelector('[data-role="mixVal"]');
        if (out) out.textContent = `${e.target.value}%`;
      });
      const pills = this.cardEl.querySelectorAll('.ps-pill');
      pills.forEach(p => {
        const fn = () => {
          pills.forEach(x => { x.classList.remove('active'); x.setAttribute('aria-checked', 'false'); });
          p.classList.add('active');
          p.setAttribute('aria-checked', 'true');
          this.state.harmonic_mode = p.dataset.value;
        };
        p.addEventListener('click', fn);
        this._listeners.push({ el: p, type: 'click', fn });
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        this.state.bypass = !e.target.checked;
      });
    }
  }

  LG.proFeatures.phantomSubWidget = phantomSubWidget;

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Mapea al CATALOG key 'phantom-sub' (la UI usa crossover/mix/harmonic_mode;
  // el backend recibe crossover_hz/mix/harmonic_mode — mapping idéntico).
  // Backward-compat: si NS.create falla, la clase sigue funcionando standalone.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['phantom-sub']) {
      const inst = rack.create({
        id: 'phantom-sub', title: 'Phantom Sub', endpoint: '/dsp/phantom-sub', widget: phantomSubWidget
      });
      if (inst) {
        phantomSubWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['phantom-sub'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'phantom-sub', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
