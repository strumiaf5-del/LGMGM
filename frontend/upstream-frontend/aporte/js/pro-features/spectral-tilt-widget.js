// ============================================================
// pro-features/spectral-tilt-widget.js
// F3.2 — Spectral Tilt EQ curva objetivo (HVAC)
// ============================================================
(function (global) {
  'use strict';

  const NS = (global.LGMDM = global.LGMDM || {});
  NS.proFeatures = NS.proFeatures || {};

  const PALETTE = (() => {
    const tc = window.LGMDM?.themeColors?.();
    if (tc) return tc;
    if (typeof document === 'undefined') return null;
    const s = getComputedStyle(document.documentElement);
    return {
      good: s.getPropertyValue('--ui-good').trim() || '#45f6b2',
      warn: s.getPropertyValue('--ui-warn').trim() || '#ffbd4a',
      danger: s.getPropertyValue('--ui-danger').trim() || '#ff4264',
      accent: s.getPropertyValue('--ui-accent').trim() || '#23e7ff',
      text: s.getPropertyValue('--ui-text').trim() || '#f4f7ff',
      muted: s.getPropertyValue('--ui-muted').trim() || '#8995b0',
      bg: s.getPropertyValue('--ui-surface').trim() || '#0d1220'
    };
  })();

  const COLOR_BG = (PALETTE && PALETTE.bg) || '#0d1020';
  const COLOR_GRID = 'rgba(147,164,255,0.10)';
  const COLOR_AXIS = 'rgba(147,164,255,0.35)';
  const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
  const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
  const COLOR_TARGET = (PALETTE && PALETTE.accent) || '#42e8ff';
  const COLOR_CURRENT = (PALETTE && PALETTE.warn) || '#ff9f43';
  const COLOR_PIVOT = (PALETTE && PALETTE.warn) || '#ffcc66';
  const FMIN = 20;
  const FMAX = 20000;
  const DMIN = -12;
  const DMAX = 12;

  const LOG_FMIN = logFreq(FMIN);
  const LOG_FMAX = logFreq(FMAX);

  function _xFreq(f, left, width) { return window.xFromFreq(f, left, width, LOG_FMIN, LOG_FMAX); }
  function _yDb(db, top, height) { return window.yFromDb(db, top, height, DMIN, DMAX); }
  function _freqFromX(x, left, width) { return window.freqFromX(x, left, width, LOG_FMIN, LOG_FMAX); }

  class Widget {
    constructor() {
      this.canvas = null;
      this.ctx = null;
      this.dpr = 1;
      this.cssWidth = 800;
      this.cssHeight = 400;
      this.data = { tilt_db: 3, pivot_hz: 1000, current_spectrum: [] };
      this._rafId = 0;
      this._lastFrame = 0;
      this._frameInterval = 1000 / 60;
      this._running = false;
      this._destroyed = false;
      this._hover = null;
      this._mouseMove = null;
      this._mouseLeave = null;
      this._click = null;
      this._draggingPivot = false;
    }

    init(canvas, options = {}) {
      if (!canvas) throw new Error('[spectralTiltWidget] canvas required');
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = options || {};
      this._size();
      this._bindResize();
      this._bind();
      this._running = true;
      this._tick(performance.now());
    }

    _bindResize() {
      if (typeof ResizeObserver === 'undefined' || !this.canvas) return;
      this._ro = new ResizeObserver(() => this._size());
      this._ro.observe(this.canvas);
    }

    _size() {
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(rect.width, 320);
      this.cssHeight = Math.max(rect.height, 180);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.cssWidth * this.dpr);
      this.canvas.height = Math.floor(this.cssHeight * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _bind() {
      this._mouseMove = (e) => this._onMouseMove(e);
      this._mouseLeave = () => { this._hover = null; };
      this._click = (e) => this._onClick(e);
      this._keydown = (e) => this._onKeydown(e);
      this.canvas.addEventListener('mousemove', this._mouseMove);
      this.canvas.addEventListener('mouseleave', this._mouseLeave);
      this.canvas.addEventListener('mousedown', this._click);
      this.canvas.addEventListener('keydown', this._keydown);
      this.canvas.setAttribute('tabindex', '0');
      this.canvas.setAttribute('role', 'slider');
      this.canvas.setAttribute('aria-label', 'Pivote del tilt espectral (Hz)');
      this._updateAria();
    }

    _updateAria() {
      if (!this.canvas) return;
      this.canvas.setAttribute('aria-valuemin', String(FMIN));
      this.canvas.setAttribute('aria-valuemax', String(FMAX));
      this.canvas.setAttribute('aria-valuenow', String(Math.round(this.data.pivot_hz)));
      this.canvas.setAttribute('aria-valuetext', `${Math.round(this.data.pivot_hz)} Hz`);
    }

    _onKeydown(e) {
      let delta = 0;
      const STEP_FINE = 1;     // 1% del rango log
      const STEP_COARSE = 5;   // 5% del rango log
      const range = Math.log10(FMAX / FMIN);
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
        delta = e.shiftKey ? STEP_COARSE : STEP_FINE;
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
        delta = -STEP_FINE * (e.shiftKey ? STEP_COARSE / STEP_FINE : 1);
      } else if (e.key === 'Home') {
        this.data.pivot_hz = FMIN;
        this._updateAria();
        if (this.options.onPivotChange) this.options.onPivotChange(this.data.pivot_hz);
        e.preventDefault();
        return;
      } else if (e.key === 'End') {
        this.data.pivot_hz = FMAX;
        this._updateAria();
        if (this.options.onPivotChange) this.options.onPivotChange(this.data.pivot_hz);
        e.preventDefault();
        return;
      } else {
        return;
      }
      e.preventDefault();
      const currentLog = Math.log10(this.data.pivot_hz);
      const nextLog = Math.max(0, Math.min(range, currentLog + delta));
      this.data.pivot_hz = Math.pow(10, nextLog);
      this._updateAria();
      if (this.options.onPivotChange) this.options.onPivotChange(this.data.pivot_hz);
    }

    _plotRect() {
      const left = 56;
      const right = this.cssWidth - 16;
      const top = 16;
      const bottom = this.cssHeight - 38;
      return { left, right, top, bottom, width: right - left, height: bottom - top };
    }

    _onMouseMove(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const r = this._plotRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
        this._hover = null;
        return;
      }
      this._hover = { x, y, freq: _freqFromX(x, r.left, r.width) };
    }

    _onClick(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const r = this._plotRect();
      const px = _xFreq(this.data.pivot_hz, r.left, r.width);
      const py = _yDb(0, r.top, r.height);
      if (Math.hypot(x - px, y - py) < 18) {
        this._draggingPivot = true;
      } else if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        const newPivot = _freqFromX(x, r.left, r.width);
        this.data.pivot_hz = Math.max(FMIN, Math.min(FMAX, newPivot));
        if (this.options.onPivotChange) this.options.onPivotChange(this.data.pivot_hz);
      }
      this._draggingPivot = false;
    }

    update(data) {
      this.data = Object.assign({ tilt_db: 3, pivot_hz: 1000, current_spectrum: [] }, data || {});
      this._updateAria();
    }

    resize() { this._size(); }

    destroy() {
      this._destroyed = true;
      this._running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = 0;
      if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
      if (this.canvas) {
        if (this._mouseMove) this.canvas.removeEventListener('mousemove', this._mouseMove);
        if (this._mouseLeave) this.canvas.removeEventListener('mouseleave', this._mouseLeave);
        if (this._click) this.canvas.removeEventListener('mousedown', this._click);
        if (this._keydown) this.canvas.removeEventListener('keydown', this._keydown);
      }
      this._mouseMove = this._mouseLeave = this._click = this._keydown = null;
      this.canvas = null;
      this.ctx = null;
    }

    teardown() { this.destroy(); }

    _tick(now) {
      if (this._destroyed || !this._running) return;
      if (window.LGMDM.utils.prefersReducedMotion()) return;
      if (now - this._lastFrame < this._frameInterval) {
        this._rafId = requestAnimationFrame((t) => this._tick(t));
        return;
      }
      this._lastFrame = now;
      this._render();
      this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    _render() {
      const ctx = this.ctx;
      const w = this.cssWidth;
      const h = this.cssHeight;
      const r = this._plotRect();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, w, h);

      this._drawGrid(r);

      const pivotF = this.data.pivot_hz || 1000;
      const tilt = this.data.tilt_db || 0;
      const shelf = tilt / 2;

      ctx.lineWidth = 2.4;
      ctx.strokeStyle = COLOR_TARGET;
      ctx.shadowColor = COLOR_TARGET;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const f = Math.pow(10, LOG_FMIN + t * (LOG_FMAX - LOG_FMIN));
        const logRatio = Math.log2(f / pivotF);
        const db = Math.max(-12, Math.min(12, -logRatio * shelf));
        const x = _xFreq(f, r.left, r.width);
        const y = _yDb(db, r.top, r.height);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      const cur = (this.data.current_spectrum || []).filter(p => p && isFinite(p.freq) && isFinite(p.db));
      if (cur.length > 1) {
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = COLOR_CURRENT;
        ctx.shadowColor = COLOR_CURRENT;
        ctx.shadowBlur = 6;
        ctx.beginPath();
        const sorted = cur.slice().sort((a, b) => a.freq - b.freq);
        for (let i = 0; i < sorted.length; i++) {
          const f = Math.max(FMIN, Math.min(FMAX, sorted[i].freq));
          const db = Math.max(DMIN, Math.min(DMAX, sorted[i].db));
          const x = _xFreq(f, r.left, r.width);
          const y = _yDb(db, r.top, r.height);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;
      }

      const px = _xFreq(pivotF, r.left, r.width);
      const py = _yDb(0, r.top, r.height);
      ctx.fillStyle = COLOR_PIVOT;
      ctx.shadowColor = COLOR_PIVOT;
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(px, py, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#070812';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px - 14, py);
      ctx.lineTo(px + 14, py);
      ctx.stroke();

      this._drawLegend(r);

      if (this._hover) {
        ctx.fillStyle = 'rgba(7,8,18,0.85)';
        ctx.strokeStyle = 'rgba(147,164,255,0.35)';
        ctx.lineWidth = 1;
        const label = `${this._hover.freq.toFixed(0)} Hz`;
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        const tw = ctx.measureText(label).width + 12;
        const tx = Math.min(w - tw - 8, this._hover.x + 12);
        const ty = Math.max(8, this._hover.y - 22);
        ctx.fillRect(tx, ty, tw, 18);
        ctx.fillStyle = COLOR_TEXT;
        ctx.fillText(label, tx + 6, ty + 4);
      }
    }

    _drawGrid(r) {
      const ctx = this.ctx;
      ctx.strokeStyle = COLOR_GRID;
      ctx.lineWidth = 1;
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = COLOR_MUTED;
      ctx.textBaseline = 'middle';

      const yTicks = [-12, -6, 0, 6, 12];
      yTicks.forEach((db) => {
        const y = _yDb(db, r.top, r.height);
        ctx.beginPath();
        ctx.moveTo(r.left, y);
        ctx.lineTo(r.right, y);
        ctx.strokeStyle = db === 0 ? COLOR_AXIS : COLOR_GRID;
        ctx.stroke();
        ctx.textAlign = 'right';
        ctx.fillText((db > 0 ? '+' : '') + db + ' dB', r.left - 6, y);
      });

      const xTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ctx.textBaseline = 'top';
      ctx.textAlign = 'center';
      xTicks.forEach((f) => {
        const x = _xFreq(f, r.left, r.width);
        ctx.beginPath();
        ctx.moveTo(x, r.top);
        ctx.lineTo(x, r.bottom);
        ctx.strokeStyle = COLOR_GRID;
        ctx.stroke();
        const label = f >= 1000 ? (f / 1000) + 'k' : String(f);
        ctx.fillText(label, x, r.bottom + 6);
      });

      ctx.textAlign = 'left';
    }

    _drawLegend(r) {
      const ctx = this.ctx;
      const y = this.cssHeight - 12;
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      let x = r.left;
      ctx.fillStyle = COLOR_TARGET;
      ctx.fillRect(x, y - 4, 12, 2);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('Target HVAC', x + 16, y - 3);
      x += 96;
      ctx.fillStyle = COLOR_CURRENT;
      ctx.fillRect(x, y - 4, 12, 2);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('Current FFT', x + 16, y - 3);
      x += 96;
      ctx.fillStyle = COLOR_PIVOT;
      ctx.beginPath(); ctx.arc(x + 6, y - 3, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText(`Pivot ${this.data.pivot_hz.toFixed(0)} Hz · Tilt ${(this.data.tilt_db > 0 ? '+' : '') + this.data.tilt_db.toFixed(1)} dB`, x + 16, y - 3);
    }
  }

  NS.proFeatures.spectralTiltWidget = Widget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Widget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // CATALOG key = 'spectral-tilt'. Widget modela curva HVAC objetivo.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['spectral-tilt']) {
      const inst = rack.create({
        id: 'spectral-tilt', title: '📈 Spectral Tilt', endpoint: '/dsp/spectral-tilt', widget: Widget
      });
      if (inst) {
        Widget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['spectral-tilt'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'spectral-tilt', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
