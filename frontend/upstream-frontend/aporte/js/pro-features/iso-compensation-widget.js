// ============================================================
// iso-compensation-widget.js — Compensación curvas isosónicas ISO 226
// Endpoint: /dsp/iso-compensation (playback_phon, reference_phon, strength)
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  const PHON_PRESETS = [
    { value: 40, label: '40 phon (silencio)' },
    { value: 60, label: '60 phon (oficina)' },
    { value: 80, label: '80 phon (referencia)' },
    { value: 100, label: '100 phon (fuerte)' }
  ];

  let _isoUid = 0;

  class isoCompensationWidget {
    constructor() {
      this.root = null;
      this._uid = ++_isoUid;
      this.state = { playback_phon: 80, reference_phon: 80, strength: 0.5, bypass: false };
      this._listeners = [];
      this._raf = 0;
    }

    init(canvas, options = {}) {
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;
      if (Number.isFinite(options.playback_phon)) this.state.playback_phon = options.playback_phon;
      if (Number.isFinite(options.reference_phon)) this.state.reference_phon = options.reference_phon;
      if (Number.isFinite(options.strength)) this.state.strength = options.strength;
      if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

      const u = this._uid;
      const card = document.createElement('div');
      card.className = 'pro-meter-card iso-compensation-widget';
      card.dataset.insertId = 'iso-compensation';
      card.dataset.endpoint = '/dsp/iso-compensation';
      card.innerHTML = `
        <div class="pro-flex-between-center">
          <strong>🔉 ISO 226 Compensation</strong>
          <label class="ic-bypass" for="ic-bypass-${u}"><input id="ic-bypass-${u}" type="checkbox" data-role="bypass" ${this.state.bypass ? '' : 'checked'}/> Bypass</label>
        </div>
        <div class="ic-grid">
          <div>
            <label for="ic-playback-phon-${u}">Playback (phon)</label>
            <select id="ic-playback-phon-${u}" data-role="playbackPhon" class="ic-select" aria-label="Playback phon">
              ${PHON_PRESETS.map(p => `<option value="${p.value}" ${p.value === this.state.playback_phon ? 'selected' : ''}>${p.label}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="ic-reference-phon-${u}">Reference (phon)</label>
            <select id="ic-reference-phon-${u}" data-role="referencePhon" class="ic-select" aria-label="Reference phon">
              ${PHON_PRESETS.map(p => `<option value="${p.value}" ${p.value === this.state.reference_phon ? 'selected' : ''}>${p.label}</option>`).join('')}
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
    }

    update(data = {}) {
      if (Number.isFinite(data.delta_db)) {
        const out = this.cardEl.querySelector('[data-role="delta"]');
        if (out) out.textContent = `Δ: ${data.delta_db >= 0 ? '+' : ''}${data.delta_db.toFixed(1)} dB`;
      }
    }

    destroy() {
      this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
      this._listeners = [];
      cancelAnimationFrame(this._raf);
    }

    _wire() {
      const bind = (sel, type, fn) => {
        const el = this.cardEl.querySelector(sel);
        if (el) {
          el.addEventListener(type, fn);
          this._listeners.push({ el, type, fn });
        }
      };
      bind('[data-role="playbackPhon"]', 'change', (e) => {
        this.state.playback_phon = Number(e.target.value);
        this._drawCurve();
      });
      bind('[data-role="referencePhon"]', 'change', (e) => {
        this.state.reference_phon = Number(e.target.value);
        this._drawCurve();
      });
      bind('[data-role="strength"]', 'input', (e) => {
        this.state.strength = Number(e.target.value) / 100;
        const out = this.cardEl.querySelector('[data-role="strengthVal"]');
        if (out) out.textContent = `${e.target.value}%`;
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        this.state.bypass = !e.target.checked;
      });
    }

    _drawCurve() {
      const cv = this.cardEl?.querySelector('[data-role="isoCurve"]');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const w = cv.width, h = cv.height;
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
        const spl = phon + 30 * Math.exp(-0.05 * Math.pow(f - 1000, 2) / 10000) - 10 * Math.exp(-Math.pow(fl - 1.5, 2));
        ctx.lineTo(x, h - (Math.max(0, Math.min(1, spl / 120))) * h);
      }
      ctx.stroke();
    }
  }

  LG.proFeatures.isoCompensationWidget = isoCompensationWidget;

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Mapea al CATALOG key 'iso-compensation' (la UI usa playback_phon/reference_phon/strength;
  // el backend recibe los mismos nombres — mapping idéntico).
  // Backward-compat: si NS.create falla, la clase sigue funcionando standalone.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['iso-compensation']) {
      const inst = rack.create({
        id: 'iso-compensation', title: 'ISO 226 Compensation', endpoint: '/dsp/iso-compensation', widget: isoCompensationWidget
      });
      if (inst) {
        isoCompensationWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['iso-compensation'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'iso-compensation', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
