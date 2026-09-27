// ============================================================
// dr-meter-widget.js — F4.2 DR Meter + Genre Classifier
// ============================================================
// UI lógica: gauge analógico semicircular 180° (DR-2 a DR-20),
// aguja indicando el DR score actual, badge de género dinámico,
// texto descriptivo y mini gauge de LRA.
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  // DR: rango visible de 2 a 20 (180° semicírculo)
  const DR_MIN = 2;
  const DR_MAX = 20;
  // LRA mini gauge: 0 a 20 LU
  const LRA_MIN = 0;
  const LRA_MAX = 20;

  function classifyGenre(dr) {
    if (!Number.isFinite(dr)) return { genre: 'Unknown', label: 'Unknown', tone: '#9ba6c4' };
    if (dr > 12) return { genre: 'Heavy', label: 'Heavy / Dinámico', tone: '#52f2bd' };
    if (dr >= 8) return { genre: 'Pop', label: 'Pop / Balanced', tone: '#7de8ff' };
    return { genre: 'Loud', label: 'Loud / Loudness War', tone: '#ff5f72' };
  }

  // Mapea valor DR (2..20) a ángulo del arco semicircular.
  // Semicírculo va de π (izquierda) a 0 (derecha), "needle pivot" arriba.
  function drToAngle(dr) {
    const t = (window.clamp(dr, DR_MIN, DR_MAX) - DR_MIN) / (DR_MAX - DR_MIN);
    return Math.PI * (1 - t); // [π..0]
  }

  function lraToAngle(lra) {
    const t = (window.clamp(lra, LRA_MIN, LRA_MAX) - LRA_MIN) / (LRA_MAX - LRA_MIN);
    return Math.PI * (1 - t);
  }

  class drMeterWidget {
    constructor() {
      this.canvas = null;
      this.root = null;
      this.cardEl = null;
      this.rafId = null;
      this.lastDraw = 0;
      this.state = {
        dr_score: 12,
        lra: 8,
        crest_factor: 14,
        genre_classification: 'Heavy'
      };
      // Animated target for smooth needle motion
      this._target = { dr: 12, lra: 8 };
      this._current = { dr: 12, lra: 8 };
      this._listeners = [];
    }

    init(canvas, options = {}) {
      this.canvas = canvas || null;
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;

      this._applyOptions(options);
      this._applyData({});

      // Build the UI card (gauge + LRA mini + badges)
      const card = document.createElement('div');
      card.className = 'pro-meter-card dr-meter-widget';
      card.innerHTML = `
        <div class="dr-meter-widget__head">
          <strong class="pro-card-title" style="font-size:.78rem;">
            📊 Dynamic Range (DR) Meter
          </strong>
          <span id="drwCrest" class="dr-meter-widget__head-meta">
            Crest Factor: — dB
          </span>
        </div>

        <div class="dr-meter-widget__main">
          <div class="dr-meter-widget__gauge-col">
            <canvas id="drwGauge" class="dr-meter-widget__gauge" width="360" height="200" tabindex="0" role="img" aria-label="DR (Dynamic Range) gauge"></canvas>
            <div id="drwReadout" class="dr-meter-widget__readout">
              DR-12
            </div>
            <div class="dr-meter-widget__badge-row">
              <span id="drwBadge" class="pro-badge-good pro-badge-status dr-meter-widget__badge">
                Heavy
              </span>
            </div>
            <div id="drwDesc" class="dr-meter-widget__desc">
              DR-12 — Heavy / Dinámico / Competition-ready
            </div>
          </div>

          <div class="dr-meter-widget__side">
            <div class="pro-meter-card dr-meter-widget__sub-card">
              <span>
                Loudness Range (LRA)
              </span>
              <div class="dr-meter-widget__lra-position">
                <canvas id="drwLraGauge" class="dr-meter-widget__lra-canvas" width="180" height="110" tabindex="0" role="img" aria-label="Loudness Range (LRA) gauge"></canvas>
                <div id="drwLraReadout" class="dr-meter-widget__lra-readout">
                  — LU
                </div>
              </div>
              <div id="drwLraHint" class="dr-meter-widget__hint">
                EBU R128 LRA target: 4–12 LU
              </div>
            </div>
            <div class="pro-meter-card dr-meter-widget__sub-card">
              <span>
                Crest Factor
              </span>
              <div id="drwCrestBig" class="dr-meter-widget__crest-big">
                — dB
              </div>
              <div class="dr-meter-widget__hint">
                Peak / RMS ratio (dB). Higher = más dinámica.
              </div>
            </div>
          </div>
        </div>
      `;
      this.cardEl = card;

      if (this.canvas && this.canvas.parentElement === this.root) {
        this.canvas.insertAdjacentElement('afterend', card);
      } else {
        this.root.appendChild(card);
      }

      this._setupCanvases();
      this._renderStatic();
      this._bindResize();
      this._startRaf();
    }

    _bindResize() {
      if (typeof ResizeObserver === 'undefined' || !this.cardEl) return;
      this._ro = new ResizeObserver(() => this._setupCanvases());
      this._ro.observe(this.cardEl);
    }

    update(data = {}) {
      if (!data) return;
      this._applyData(data);
    }

    destroy() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
      this._listeners.forEach((rec) => {
        try { rec.target.removeEventListener(rec.type, rec.handler, rec.options); }
        catch (_) { /* noop */ }
      });
      this._listeners = [];
      if (this.cardEl && this.cardEl.parentElement) {
        this.cardEl.parentElement.removeChild(this.cardEl);
      }
      this.cardEl = null;
      this.canvas = null;
      this.root = null;
    }

    getControls() {
      // DR meter expone sólo gauge + readouts (no hay knobs configurables);
      // los "controles" son los badges descriptivos.
      return `
        <div class="dr-meter-widget__controls-col">
          <div class="dr-meter-widget__badge-row">
            <span class="pro-badge-good pro-badge-status dr-meter-widget__badge">
              Heavy
            </span>
          </div>
          <div class="dr-meter-widget__desc">
            Clasificación de género basada en rango dinámico.
          </div>
        </div>
      `;
    }

    // ── internals ───────────────────────────────────────────────────────
    _applyOptions(options) {
      if (Number.isFinite(Number(options.dr_score))) {
        this.state.dr_score = Number(options.dr_score);
      }
      if (Number.isFinite(Number(options.lra))) {
        this.state.lra = Number(options.lra);
      }
      if (Number.isFinite(Number(options.crest_factor))) {
        this.state.crest_factor = Number(options.crest_factor);
      }
      if (typeof options.genre_classification === 'string') {
        this.state.genre_classification = options.genre_classification;
      }
    }

    _applyData(data) {
      if (Number.isFinite(Number(data.dr_score))) {
        const n = Number(data.dr_score);
        this.state.dr_score = n;
        this._target.dr = n;
      }
      if (Number.isFinite(Number(data.lra))) {
        const n = Number(data.lra);
        this.state.lra = n;
        this._target.lra = n;
      }
      if (Number.isFinite(Number(data.crest_factor))) {
        this.state.crest_factor = Number(data.crest_factor);
      }
      if (typeof data.genre_classification === 'string') {
        this.state.genre_classification = data.genre_classification;
      }
      this._updateReadouts();
    }

    _setupCanvases() {
      const gauge = this.cardEl?.querySelector('#drwGauge');
      const lraGauge = this.cardEl?.querySelector('#drwLraGauge');
      this._gaugeCanvas = gauge || null;
      this._gaugeCtx = gauge ? gauge.getContext('2d') : null;
      this._lraCanvas = lraGauge || null;
      this._lraCtx = lraGauge ? lraGauge.getContext('2d') : null;
      // DPR-aware setup
      [
        { c: this._gaugeCanvas, ctx: this._gaugeCtx },
        { c: this._lraCanvas, ctx: this._lraCtx }
      ].forEach(({ c, ctx }) => {
        if (!c || !ctx) return;
        const cssW = c.clientWidth || c.width;
        const cssH = c.clientHeight || c.height;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
          c.width = Math.max(1, Math.floor(cssW * dpr));
          c.height = Math.max(1, Math.floor(cssH * dpr));
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.scale(dpr, dpr);
        }
      });
    }

    _startRaf() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const FRAME_INTERVAL = 1000 / 60;
      let last = 0;
      const tick = (now) => {
        this.rafId = null;
        if (window.LGMDM.utils.prefersReducedMotion()) return;
        if (!this.cardEl || !this._gaugeCtx || !this._lraCtx) return;
        if (now - last < FRAME_INTERVAL) {
          this.rafId = requestAnimationFrame(tick);
          return;
        }
        last = now;
        // Smooth interpolation hacia el target (crítico-ease)
        const ease = 0.18;
        this._current.dr += (this._target.dr - this._current.dr) * ease;
        this._current.lra += (this._target.lra - this._current.lra) * ease;
        this._drawGauge(this._current.dr);
        this._drawLraGauge(this._current.lra);
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }

    _renderStatic() {
      this._updateReadouts();
      this._drawGauge(this._current.dr);
      this._drawLraGauge(this._current.lra);
    }

    _updateReadouts() {
      if (!this.cardEl) return;
      const dr = Number.isFinite(this.state.dr_score) ? this.state.dr_score : 0;
      const lra = Number.isFinite(this.state.lra) ? this.state.lra : 0;
      const crest = Number.isFinite(this.state.crest_factor) ? this.state.crest_factor : null;
      const klass = classifyGenre(dr);

      const readout = this.cardEl.querySelector('#drwReadout');
      if (readout) readout.textContent = `DR-${dr.toFixed(1)}`;

      const badge = this.cardEl.querySelector('#drwBadge');
      if (badge) {
        badge.textContent = klass.genre;
        badge.style.background = `${klass.tone}33`;
        badge.style.color = klass.tone;
        badge.style.border = `1px solid ${klass.tone}55`;
        badge.classList.remove('pro-badge-good', 'pro-badge-warning', 'pro-badge-danger');
        if (klass.genre === 'Heavy') badge.classList.add('pro-badge-good');
        else if (klass.genre === 'Pop') badge.classList.add('pro-badge-warning');
        else badge.classList.add('pro-badge-danger');
      }

      const desc = this.cardEl.querySelector('#drwDesc');
      if (desc) {
        let dynamicLabel;
        if (dr >= 14) dynamicLabel = 'Ultra-dinámico';
        else if (dr >= 10) dynamicLabel = 'Dinámico';
        else if (dr >= 6) dynamicLabel = 'Moderado';
        else dynamicLabel = 'Comprimido';
        desc.textContent = `DR-${dr.toFixed(1)} — ${klass.label} / ${dynamicLabel} / Competition-ready`;
      }

      const lraReadout = this.cardEl.querySelector('#drwLraReadout');
      if (lraReadout) lraReadout.textContent = `${lra.toFixed(1)} LU`;

      const crestBig = this.cardEl.querySelector('#drwCrestBig');
      const crestSmall = this.cardEl.querySelector('#drwCrest');
      if (crestBig && crest != null) crestBig.textContent = `${crest.toFixed(1)} dB`;
      if (crestSmall && crest != null) {
        crestSmall.textContent = `Crest Factor: ${crest.toFixed(1)} dB`;
      }
    }

    _drawGauge(dr) {
      const ctx = this._gaugeCtx;
      const canvas = this._gaugeCanvas;
      if (!ctx || !canvas) return;
      const cssW = canvas.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;

      ctx.clearRect(0, 0, cssW, cssH);

      const cx = cssW / 2;
      const cy = cssH * 0.92; // pivot abajo
      const radius = Math.min(cssW * 0.46, cssH * 0.88);

      // Background arc (gris oscuro)
      ctx.lineCap = 'round';
      ctx.lineWidth = 14;
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI, 0, false);
      ctx.stroke();

      // Colored arc segment — segmenta según zonas
      // Verde DR>12 (Heavy), Amarillo 8-12 (Pop), Rojo <8 (Loud)
      const drawSegment = (fromDr, toDr, color) => {
        const a0 = drToAngle(fromDr);
        const a1 = drToAngle(toDr);
        if (a1 >= a0) return; // semicírculo decreciente de π a 0
        ctx.strokeStyle = color;
        ctx.lineWidth = 14;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, a0, a1, false);
        ctx.stroke();
      };
      drawSegment(2, 8, '#ff5f72aa');
      drawSegment(8, 12, '#ffd84daa');
      drawSegment(12, 20, '#52f2bdaa');

      // Tick marks cada 2 unidades DR
      ctx.strokeStyle = 'rgba(220,251,255,.55)';
      ctx.lineWidth = 1.5;
      ctx.fillStyle = 'rgba(220,251,255,.75)';
      ctx.font = `${Math.max(9, cssW * 0.028)}px monospace`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (let v = DR_MIN; v <= DR_MAX; v += 2) {
        const ang = drToAngle(v);
        const r0 = radius - 16;
        const r1 = radius - 4;
        const x0 = cx + r0 * Math.cos(ang);
        const y0 = cy - r0 * Math.sin(ang);
        const x1 = cx + r1 * Math.cos(ang);
        const y1 = cy - r1 * Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const lx = cx + (radius + 14) * Math.cos(ang);
        const ly = cy - (radius + 14) * Math.sin(ang);
        ctx.fillText(String(v), lx, ly);
      }

      // Aguja
      const needleAngle = drToAngle(dr);
      const needleLen = radius - 8;
      const needleColor = classifyGenre(dr).tone;
      ctx.strokeStyle = needleColor;
      ctx.lineWidth = 3;
      ctx.shadowBlur = 12;
      ctx.shadowColor = needleColor;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + needleLen * Math.cos(needleAngle), cy - needleLen * Math.sin(needleAngle));
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Pivot dot
      ctx.fillStyle = needleColor;
      ctx.beginPath();
      ctx.arc(cx, cy, 6, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(7, 9, 18, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    _drawLraGauge(lra) {
      const ctx = this._lraCtx;
      const canvas = this._lraCanvas;
      if (!ctx || !canvas) return;
      const cssW = canvas.clientWidth || canvas.width;
      const cssH = canvas.clientHeight || canvas.height;

      ctx.clearRect(0, 0, cssW, cssH);

      const cx = cssW / 2;
      const cy = cssH * 0.95;
      const radius = Math.min(cssW * 0.46, cssH * 0.85);

      // Background arc
      ctx.lineCap = 'round';
      ctx.lineWidth = 8;
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.beginPath();
      ctx.arc(cx, cy, radius, Math.PI, 0, false);
      ctx.stroke();

      // LRA zones: 0-4 compressed (yellow), 4-12 target (green), >12 wide (cyan)
      const drawSeg = (fromLra, toLra, color) => {
        const a0 = lraToAngle(fromLra);
        const a1 = lraToAngle(toLra);
        if (a1 >= a0) return;
        ctx.strokeStyle = color;
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, a0, a1, false);
        ctx.stroke();
      };
      drawSeg(0, 4, '#ffd84daa');
      drawSeg(4, 12, '#52f2bdaa');
      drawSeg(12, 20, '#7de8ffaa');

      // Ticks cada 4 LU
      ctx.strokeStyle = 'rgba(220,251,255,.5)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(220,251,255,.7)';
      ctx.font = `${Math.max(8, cssW * 0.034)}px monospace`;
      ctx.textAlign = 'center';
      for (let v = LRA_MIN; v <= LRA_MAX; v += 4) {
        const ang = lraToAngle(v);
        const x0 = cx + (radius - 8) * Math.cos(ang);
        const y0 = cy - (radius - 8) * Math.sin(ang);
        const x1 = cx + (radius - 2) * Math.cos(ang);
        const y1 = cy - (radius - 2) * Math.sin(ang);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
        const lx = cx + (radius + 8) * Math.cos(ang);
        const ly = cy - (radius + 8) * Math.sin(ang);
        ctx.fillText(String(v), lx, ly);
      }

      // Aguja LRA
      const ang = lraToAngle(lra);
      const len = radius - 4;
      const tone = lra >= 4 && lra <= 12 ? '#52f2bd'
                  : lra < 4 ? '#ffd84d'
                  : '#7de8ff';
      ctx.strokeStyle = tone;
      ctx.lineWidth = 2;
      ctx.shadowBlur = 6;
      ctx.shadowColor = tone;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + len * Math.cos(ang), cy - len * Math.sin(ang));
      ctx.stroke();
      ctx.shadowBlur = 0;

      ctx.fillStyle = tone;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(7, 9, 18, 0.85)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  LG.proFeatures.drMeterWidget = drMeterWidget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { drMeterWidget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // CATALOG key = 'dr-meter'. La entry actual no define defaults (defaults
  // vienen de `_applyOptions`); la usamos para serialize/restore.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['dr-meter']) {
      const inst = rack.create({
        id: 'dr-meter', title: '📊 DR Meter', endpoint: '/dsp/dr-meter', widget: drMeterWidget
      });
      if (inst) {
        drMeterWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['dr-meter'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'dr-meter', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);

