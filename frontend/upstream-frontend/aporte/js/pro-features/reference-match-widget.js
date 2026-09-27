// ============================================================
// pro-features/reference-match-widget.js
// F3.4 — Reference EQ Matching curva dual
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
  const COLOR_TARGET = (PALETTE && PALETTE.accent) || '#42e8ff';
  const COLOR_CURRENT = (PALETTE && PALETTE.danger) || '#ff5f72';
  const COLOR_BAND = (PALETTE && PALETTE.warn) || '#ffcc66';
  const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
  const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
  const FMIN = 20;
  const FMAX = 20000;
  const DMIN = -24;
  const DMAX = 24;

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
      this.data = { target: [], current: [], applied_eq_bands: [] };
      this._rafId = 0;
      this._lastFrame = 0;
      this._frameInterval = 1000 / 60;
      this._running = false;
      this._destroyed = false;
      this._hover = null;
      this._mouseMove = null;
      this._mouseLeave = null;
      this._matchClick = null;
    }

    init(canvas, options = {}) {
      if (!canvas) throw new Error('[referenceMatchWidget] canvas required');
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.options = options || {};
      canvas.setAttribute('tabindex', '0');
      canvas.setAttribute('role', 'application');
      canvas.setAttribute('aria-label', 'Match EQ curve — clic en "Match EQ" para aplicar EQ de referencia');
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
      this.cssHeight = Math.max(rect.height, 200);
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.cssWidth * this.dpr);
      this.canvas.height = Math.floor(this.cssHeight * this.dpr);
      this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    }

    _bind() {
      this._mouseMove = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const r = this._plotRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) { this._hover = null; return; }
        this._hover = { x, y, freq: _freqFromX(x, r.left, r.width) };
      };
      this._mouseLeave = () => { this._hover = null; };
      this._matchClick = (e) => {
        if (e.target && e.target.dataset && e.target.dataset.action === 'match') {
          if (this.options.onMatchRequest) this.options.onMatchRequest();
        }
      };
      this.canvas.addEventListener('mousemove', this._mouseMove);
      this.canvas.addEventListener('mouseleave', this._mouseLeave);
      this.canvas.addEventListener('click', this._matchClick);
    }

    _plotRect() {
      const left = 56;
      const right = this.cssWidth - 16;
      const top = 16;
      const bottom = this.cssHeight - 56;
      return { left, right, top, bottom, width: right - left, height: bottom - top };
    }

    update(data) {
      this.data = Object.assign({ target: [], current: [], applied_eq_bands: [] }, data || {});
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
        if (this._matchClick) this.canvas.removeEventListener('click', this._matchClick);
      }
      this._mouseMove = this._mouseLeave = this._matchClick = null;
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

    _drawCurve(points, color, r, width = 2.0) {
      if (!points || points.length < 2) return;
      const ctx = this.ctx;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      const sorted = points.filter(p => p && isFinite(p.freq) && isFinite(p.db))
        .slice().sort((a, b) => a.freq - b.freq);
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

    _render() {
      const ctx = this.ctx;
      const w = this.cssWidth;
      const h = this.cssHeight;
      const r = this._plotRect();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, w, h);

      this._drawGrid(r);

      this._drawCurve(this.data.target, COLOR_TARGET, r, 2.2);
      this._drawCurve(this.data.current, COLOR_CURRENT, r, 1.8);

      const bands = this.data.applied_eq_bands || [];
      bands.forEach((b) => {
        if (!b || !isFinite(b.freq) || !isFinite(b.gain_db)) return;
        const f = Math.max(FMIN, Math.min(FMAX, b.freq));
        const x = _xFreq(f, r.left, r.width);
        const y0 = _yDb(0, r.top, r.height);
        const y = _yDb(Math.max(DMIN, Math.min(DMAX, b.gain_db)), r.top, r.height);
        ctx.strokeStyle = COLOR_BAND;
        ctx.fillStyle = COLOR_BAND;
        ctx.lineWidth = 1.4;
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(x, r.top);
        ctx.lineTo(x, r.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.4;
        ctx.beginPath();
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(x, y, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        const label = `${f >= 1000 ? (f / 1000).toFixed(1) + 'k' : f.toFixed(0)} ${b.gain_db > 0 ? '+' : ''}${b.gain_db.toFixed(1)}dB`;
        ctx.fillText(label, x, y - 10);
        ctx.textAlign = 'left';
      });

      const btnX = r.left;
      const btnY = h - 32;
      const btnW = 90;
      const btnH = 26;
      const grd = ctx.createLinearGradient(btnX, btnY, btnX + btnW, btnY);
      grd.addColorStop(0, '#42d9ff');
      grd.addColorStop(1, '#9b59ff');
      ctx.fillStyle = grd;
      this._roundRect(ctx, btnX, btnY, btnW, btnH, 8);
      ctx.fill();
      ctx.fillStyle = '#070812';
      ctx.font = '700 12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('⚡ Match EQ', btnX + btnW / 2, btnY + btnH / 2);

      ctx.fillStyle = COLOR_MUTED;
      ctx.font = '11px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      let lx = btnX + btnW + 16;
      ctx.fillStyle = COLOR_TARGET;
      ctx.fillRect(lx, btnY + 8, 10, 10);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('Target / Reference', lx + 14, btnY + btnH / 2);
      lx += 130;
      ctx.fillStyle = COLOR_CURRENT;
      ctx.fillRect(lx, btnY + 8, 10, 10);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('Current / Source', lx + 14, btnY + btnH / 2);
      lx += 120;
      ctx.fillStyle = COLOR_BAND;
      ctx.beginPath(); ctx.arc(lx + 5, btnY + btnH / 2, 5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText(`Applied bands (${bands.length})`, lx + 14, btnY + btnH / 2);

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
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = COLOR_MUTED;
      ctx.textBaseline = 'middle';

      const yTicks = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
      yTicks.forEach((db) => {
        const y = _yDb(db, r.top, r.height);
        ctx.strokeStyle = db === 0 ? COLOR_AXIS : COLOR_GRID;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(r.left, y);
        ctx.lineTo(r.right, y);
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

    _roundRect(ctx, x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + w - r, y);
      ctx.quadraticCurveTo(x + w, y, x + w, y + r);
      ctx.lineTo(x + w, y + h - r);
      ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      ctx.lineTo(x + r, y + h);
      ctx.quadraticCurveTo(x, y + h, x, y + h - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }
  }

  // ── Backend devuelve `applied_eq_bands` en header `X-Reference-Match` ──
  Widget.parseReferenceMatchHeader = function (res) {
    const header = res.headers.get('X-Reference-Match') || res.headers.get('x-reference-match');
    if (!header) return [];
    try {
      const arr = JSON.parse(header);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return header.split(',').map(s => {
        const [freq, gain] = s.split(':').map(Number);
        return { freq, gain_db: gain };
      });
    }
  };

  Widget.fetchMatch = async function (targetFile, referenceFile, opts = {}) {
    const fd = new FormData();
    fd.append('target_file', targetFile);
    fd.append('reference_file', referenceFile);
    if (Number.isFinite(opts.match_amount)) fd.append('match_amount', String(opts.match_amount));
    if (Number.isFinite(opts.smoothing)) fd.append('smoothing', String(opts.smoothing));
    const token = opts.token || '';
    const res = await LG.api.apiFetch('/dsp/match-eq', {
      method: 'POST',
      body: fd
    });
    if (res.status === 404) {
      const err = new Error('DSP endpoint /dsp/match-eq no disponible en este despliegue — se habilitará pronto');
      err.code = 'DSP_UNAVAILABLE';
      throw err;
    }
    const blob = await res.blob();
    const applied_eq_bands = Widget.parseReferenceMatchHeader(res);
    return { blob, applied_eq_bands };
  };

  NS.proFeatures.referenceMatchWidget = Widget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Widget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Mapea al CATALOG key 'match-eq'. `Widget.fetchMatch(...)` parsea el
  // header `X-Reference-Match` para extraer EQ bands aplicadas.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['match-eq']) {
      const inst = rack.create({
        id: 'match-eq', title: '🎚 Reference Match', endpoint: '/dsp/match-eq', widget: Widget
      });
      if (inst) {
        Widget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['match-eq'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'reference-match', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
