// ============================================================
// resonance-tamer-widget.js — Supresor dinámico de resonancias
// Endpoint: /dsp/resonance-tamer (sensitivity, depth_db, n_bands)
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  let _rtUid = 0;

  class resonanceTamerWidget {
    constructor() {
      this.root = null;
      this._uid = ++_rtUid;
      this.state = { sensitivity: 0.5, depth_db: -6, n_bands: 64, bypass: false };
      this._listeners = [];
      this._spectrumRaf = 0;
      this._reduction = 0;
      this._hasSpectrumData = false;
      this._spectrumBands = null;
    }

    init(canvas, options = {}) {
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;
      if (Number.isFinite(options.sensitivity)) this.state.sensitivity = options.sensitivity;
      if (Number.isFinite(options.depth_db)) this.state.depth_db = options.depth_db;
      if (Number.isFinite(options.n_bands)) this.state.n_bands = options.n_bands;
      if (typeof options.bypass === 'boolean') this.state.bypass = options.bypass;

      const u = this._uid;
      const card = document.createElement('div');
      card.className = 'pro-meter-card resonance-tamer-widget';
      card.dataset.insertId = 'resonance-tamer';
      card.dataset.endpoint = '/dsp/resonance-tamer';
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
    }

    update(data = {}) {
      if (Number.isFinite(data.reduction_db)) this._reduction = data.reduction_db;
      if (Array.isArray(data.spectrum) && data.spectrum.length) {
        this._hasSpectrumData = true;
        this._spectrumBands = data.spectrum;
        // Si el RAF estaba pausado por falta de datos, reiniciarlo.
        if (!this._spectrumRaf) this._startSpectrum();
      }
      if (this.cardEl) {
        const red = this.cardEl.querySelector('[data-role="reduction"]');
        if (red) red.textContent = `Reduction: ${this._reduction.toFixed(1)} dB`;
      }
    }

    destroy() {
      this._listeners.forEach(({ el, type, fn }) => el.removeEventListener(type, fn));
      this._listeners = [];
      cancelAnimationFrame(this._spectrumRaf);
    }

    _wire() {
      const bind = (sel, type, fn) => {
        const el = this.cardEl.querySelector(sel);
        if (el) {
          el.addEventListener(type, fn);
          this._listeners.push({ el, type, fn });
        }
      };
      bind('[data-role="sensitivity"]', 'input', (e) => {
        this.state.sensitivity = Number(e.target.value) / 100;
        const out = this.cardEl.querySelector('[data-role="sensitivityVal"]');
        if (out) out.textContent = `${e.target.value}%`;
      });
      bind('[data-role="depth"]', 'input', (e) => {
        this.state.depth_db = Number(e.target.value);
        const out = this.cardEl.querySelector('[data-role="depthVal"]');
        if (out) out.textContent = `${e.target.value} dB`;
      });
      bind('[data-role="nBands"]', 'change', (e) => {
        this.state.n_bands = Number(e.target.value);
      });
      bind('[data-role="bypass"]', 'change', (e) => {
        this.state.bypass = !e.target.checked;
      });
    }

    _startSpectrum() {
      const cv = this.cardEl?.querySelector('[data-role="spectrum"]');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const tick = () => {
        this._spectrumRaf = 0;
        if (window.LGMDM.utils.prefersReducedMotion()) return;
        const w = cv.width, h = cv.height;
        ctx.fillStyle = '#070912';
        ctx.fillRect(0, 0, w, h);
        // Si NO hay datos espectrales reales, pintar 1 frame estático "Esperando…"
        // y salir del RAF (reducir CPU/GPU). update() reiniciará el loop.
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
      };
      tick();
    }
  }

  LG.proFeatures.resonanceTamerWidget = resonanceTamerWidget;
})(typeof window !== 'undefined' ? window : globalThis);
