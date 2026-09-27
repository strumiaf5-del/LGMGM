// ============================================================
// pro-features/phase-rotation-widget.js
// F3.6 — Phase Rotation phase plot (heatmap phase × freq)
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
  const COLOR_BAND_RING = (PALETTE && PALETTE.warn) || '#ffcc66';
  const COLOR_KNOB_BG = 'rgba(13,16,32,0.85)';
  const FMIN = 20;
  const FMAX = 20000;
  const BANDS_DEFAULT = [
    { name: 'low',      freq_hz: 80,    angle_deg: 0,   q: 1.0 },
    { name: 'mid-low',  freq_hz: 400,   angle_deg: 30,  q: 1.0 },
    { name: 'mid-high', freq_hz: 2000,  angle_deg: -20, q: 1.0 },
    { name: 'high',     freq_hz: 10000, angle_deg: 0,   q: 1.0 }
  ];

  const LOG_FMIN = logFreq(FMIN);
  const LOG_FMAX = logFreq(FMAX);
  function xFromAngle(deg, left, width) {
    const t = ((deg % 360) + 360) % 360 / 360;
    return left + t * width;
  }
  function yFromFreq(f, top, height) {
    const t = (logFreq(f) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN);
    return top + (1 - t) * height;
  }

  function viridis(t) {
    t = Math.max(0, Math.min(1, t));
    const stops = [
      [0.000, 68, 1, 84],
      [0.250, 59, 82, 139],
      [0.500, 33, 145, 140],
      [0.750, 94, 201, 98],
      [1.000, 253, 231, 37]
    ];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t <= stops[i + 1][0]) {
        const u = (t - stops[i][0]) / (stops[i + 1][0] - stops[i][0]);
        const r = stops[i][1] + (stops[i + 1][1] - stops[i][1]) * u;
        const g = stops[i][2] + (stops[i + 1][2] - stops[i][2]) * u;
        const b = stops[i][3] + (stops[i + 1][3] - stops[i][3]) * u;
        return [r | 0, g | 0, b | 0];
      }
    }
    return [stops[stops.length - 1][1], stops[stops.length - 1][2], stops[stops.length - 1][3]];
  }

  class Widget extends globalThis.BaseCanvasWidget {
    constructor() {
      super();
      this.cssWidth = 800;
      this.cssHeight = 400;
      this.data = { bands: BANDS_DEFAULT.slice() };
      this._mouseMove = null;
      this._mouseLeave = null;
      this._mouseDown = null;
      this._dragIdx = -1;
      this._heatmap = null;
      this._heatmapCache = null;
      this._reducedMotion = false;
    }

    onInit(options) {
      this.options = options || {};
      this._reducedMotion = window.matchMedia &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(rect.width, 320);
      this.cssHeight = Math.max(rect.height, 200);
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.cssWidth * this._dpr);
      this.canvas.height = Math.floor(this.cssHeight * this._dpr);
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._bind();
      this._buildHeatmap();
    }

    onResize(_w, _h, _dpr) {
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(rect.width, 320);
      this.cssHeight = Math.max(rect.height, 200);
      this.canvas.width = Math.floor(this.cssWidth * this._dpr);
      this.canvas.height = Math.floor(this.cssHeight * this._dpr);
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._heatmap = null;
      this._buildHeatmap();
    }

    onTick(_now) {
      if (this._reducedMotion || window.LGMDM.utils.prefersReducedMotion()) return;
      this._render();
    }

    onDestroy() {
      if (this.canvas) {
        if (this._mouseMove) this.canvas.removeEventListener('mousemove', this._mouseMove);
        if (this._mouseLeave) this.canvas.removeEventListener('mouseleave', this._mouseLeave);
        if (this._mouseDown) this.canvas.removeEventListener('mousedown', this._mouseDown);
      }
      if (this._onUp) window.removeEventListener('mouseup', this._onUp);
      this._mouseMove = this._mouseLeave = this._mouseDown = this._onUp = null;
      this._heatmap = null;
    }

    _buildHeatmap() {
      const W = 360;
      const H = 180;
      const img = this.ctx.createImageData(W, H);
      const data = img.data;
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const phaseT = x / W;
          const freqT = y / H;
          const base = phaseT * 2 * Math.PI;
          const swirl = Math.sin(freqT * 6 + phaseT * 2) * 0.18;
          const t = (Math.sin(base + freqT * 4 + swirl) + 1) / 2;
          const [r, g, b] = viridis(t);
          const idx = (y * W + x) * 4;
          data[idx] = r;
          data[idx + 1] = g;
          data[idx + 2] = b;
          data[idx + 3] = 80;
        }
      }
      const off = document.createElement('canvas');
      off.width = W; off.height = H;
      off.getContext('2d').putImageData(img, 0, 0);
      this._heatmap = off;
    }

    _bind() {
      this._mouseMove = (e) => this._onMove(e);
      this._mouseLeave = () => { this._dragIdx = -1; };
      this._mouseDown = (e) => this._onDown(e);
      this.canvas.addEventListener('mousemove', this._mouseMove);
      this.canvas.addEventListener('mouseleave', this._mouseLeave);
      this.canvas.addEventListener('mousedown', this._mouseDown);
      if (this._onUp) window.removeEventListener('mouseup', this._onUp);
      this._onUp = () => { this._dragIdx = -1; };
      window.addEventListener('mouseup', this._onUp);
    }

    _plotRect() {
      const left = 56;
      const right = this.cssWidth - 16;
      const top = 16;
      const bottom = this.cssHeight - 110;
      return { left, right, top, bottom, width: right - left, height: bottom - top };
    }

    _knobRect(i) {
      const W = 130, H = 80;
      const padX = 16;
      const totalW = this.cssWidth - padX * 2;
      const col = (totalW - W * 4) / 3;
      const x = padX + i * (W + col);
      const y = this.cssHeight - 100;
      return { x, y, w: W, h: H };
    }

    _onDown(e) {
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      for (let i = 0; i < (this.data.bands || []).length; i++) {
        const k = this._knobRect(i);
        const cx = k.x + k.w / 2;
        const cy = k.y + k.h / 2;
        if (Math.hypot(x - cx, y - cy) < 22) {
          this._dragIdx = i;
          return;
        }
        if (x >= k.x && x <= k.x + k.w && y >= k.y + k.h - 8 && y <= k.y + k.h + 12) {
          const ratio = (x - k.x) / k.w;
          this.data.bands[i].q = Math.max(0.3, Math.min(3, 0.3 + ratio * 2.7));
          if (this.options.onBandChange) this.options.onBandChange(i, this.data.bands[i]);
        }
      }
    }

    _onUp() { this._dragIdx = -1; }
    _onMove(e) {
      if (this._dragIdx < 0) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const k = this._knobRect(this._dragIdx);
      const cx = k.x + k.w / 2;
      const cy = k.y + k.h / 2;
      const ang = Math.atan2(y - cy, x - cx) * 180 / Math.PI;
      const norm = (((ang % 360) + 360) % 360);
      const half = norm > 180 ? norm - 360 : norm;
      this.data.bands[this._dragIdx].angle_deg = half;
      if (this.options.onBandChange) this.options.onBandChange(this._dragIdx, this.data.bands[this._dragIdx]);
    }

    update(data) {
      this.data = Object.assign({ bands: BANDS_DEFAULT.slice() }, data || {});
      if (!this.data.bands || this.data.bands.length === 0) {
        this.data.bands = BANDS_DEFAULT.slice();
      }
    }

    resize() { this.onResize(); this._buildHeatmap(); }

    destroy() { super.destroy(); }

    teardown() { this.destroy(); }

    _render() {
      const ctx = this.ctx;
      const w = this.cssWidth;
      const h = this.cssHeight;
      const r = this._plotRect();
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, w, h);

      if (this._heatmap) {
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 0.85;
        ctx.drawImage(this._heatmap, r.left, r.top, r.width, r.height);
        ctx.globalAlpha = 1;
      }

      this._drawGrid(r);

      const bands = this.data.bands || [];
      bands.forEach((b, i) => {
        if (!b || !isFinite(b.freq_hz)) return;
        const x = xFromAngle(b.angle_deg, r.left, r.width);
        const y = yFromFreq(b.freq_hz, r.top, r.height);
        ctx.fillStyle = COLOR_BAND_RING;
        ctx.shadowColor = COLOR_BAND_RING;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(7,8,18,0.85)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = COLOR_TEXT;
        ctx.font = '700 10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(b.name, x, y - 12);
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '9px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${b.freq_hz >= 1000 ? (b.freq_hz / 1000).toFixed(1) + 'k' : b.freq_hz.toFixed(0)}Hz · ${b.angle_deg >= 0 ? '+' : ''}${b.angle_deg.toFixed(0)}°`, x, y + 16);
        ctx.textAlign = 'left';
      });

      this._drawKnobs();
    }

    _drawGrid(r) {
      const ctx = this.ctx;
      ctx.font = '10px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = COLOR_MUTED;
      ctx.textBaseline = 'middle';
      ctx.strokeStyle = COLOR_GRID;
      ctx.lineWidth = 1;

      const xTicks = [0, 90, 180, 270, 360];
      ctx.textAlign = 'center';
      xTicks.forEach((deg) => {
        const x = xFromAngle(deg, r.left, r.width);
        ctx.beginPath();
        ctx.moveTo(x, r.top);
        ctx.lineTo(x, r.bottom);
        ctx.stroke();
        ctx.fillStyle = deg === 0 ? COLOR_AXIS : COLOR_MUTED;
        ctx.fillText(deg + '°', x, r.bottom + 8);
      });

      const yTicks = [20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000];
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      yTicks.forEach((f) => {
        const y = yFromFreq(f, r.top, r.height);
        ctx.strokeStyle = COLOR_GRID;
        ctx.beginPath();
        ctx.moveTo(r.left, y);
        ctx.lineTo(r.right, y);
        ctx.stroke();
        ctx.fillStyle = COLOR_MUTED;
        ctx.fillText(f >= 1000 ? (f / 1000) + 'k' : String(f), r.left - 6, y);
      });

      ctx.textAlign = 'left';
    }

    _drawKnobs() {
      const ctx = this.ctx;
      const bands = this.data.bands || [];
      bands.forEach((b, i) => {
        const k = this._knobRect(i);
        const cx = k.x + k.w / 2;
        const cy = k.y + k.h / 2;

        ctx.fillStyle = 'rgba(13,16,32,0.55)';
        ctx.strokeStyle = 'rgba(147,164,255,0.18)';
        ctx.lineWidth = 1;
        this._roundRect(ctx, k.x, k.y, k.w, k.h, 10);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '700 10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillText(b.name, k.x + 10, k.y + 6);

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = '600 11px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${b.angle_deg >= 0 ? '+' : ''}${b.angle_deg.toFixed(0)}°`, k.x + k.w - 42, k.y + 6);

        ctx.strokeStyle = 'rgba(147,164,255,0.25)';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, 20, 0, Math.PI * 2);
        ctx.stroke();

        const arcStart = -Math.PI / 2;
        const arcEnd = arcStart + (b.angle_deg / 180) * Math.PI;
        ctx.strokeStyle = COLOR_BAND_RING;
        ctx.shadowColor = COLOR_BAND_RING;
        ctx.shadowBlur = 8;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(cx, cy, 20, arcStart, arcEnd);
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '9px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        const qX = k.x + 8;
        const qY = k.y + k.h - 6;
        ctx.fillText(`Q ${(b.q || 1).toFixed(2)}`, qX, qY - 6);
        const qBarX = k.x + 8;
        const qBarW = k.w - 16;
        ctx.fillStyle = 'rgba(147,164,255,0.18)';
        ctx.fillRect(qBarX, qY, qBarW, 4);
        const qT = Math.max(0, Math.min(1, ((b.q || 1) - 0.3) / 2.7));
        ctx.fillStyle = COLOR_BAND_RING;
        ctx.fillRect(qBarX, qY, qBarW * qT, 4);
      });
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

  // ── Orquestador: backend procesa 1 banda por request; widget modela 4 ──
  // FIX (defensive) — usar LGMDM.api.apiFetch (maneja JWT, apiBase, retry) en vez
  // de `fetch` directo. El parámetro `token` se conserva por backward-compat pero
  // apiFetch resuelve la auth vía sessionStorage; el header manual anterior queda
  // obsoleto. El 404 sigue manejándose aquí para marcar cada banda como
  // `unavailable: true` y permitir que el caller pinte "endpoint no disponible".
  Widget.processAllBands = async function (file, bands, _token) {
    if (!Array.isArray(bands)) bands = (Widget.prototype.constructor.prototype.data && Widget.prototype.constructor.prototype.data.bands) || [];
    const results = [];
    const apiFetchFn = (typeof LGMDM !== 'undefined' && LGMDM.api && typeof LGMDM.api.apiFetch === 'function')
      ? LGMDM.api.apiFetch
      : null;
    for (const b of bands) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('freq_hz', String(b.freq_hz));
      fd.append('angle_deg', String(b.angle_deg));
      fd.append('q', String(b.q));
      try {
        const res = apiFetchFn
          ? await apiFetchFn('/dsp/phase-rotation', { method: 'POST', body: fd })
          : await LG.api.apiFetch('/dsp/phase-rotation', { method: 'POST', body: fd });
        if (res.status === 404) {
          results.push({ ...b, ok: false, unavailable: true, reason: 'DSP endpoint no disponible — se habilitará pronto' });
        } else if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch (_) {}
          results.push({ ...b, ok: false, status: res.status, reason: `HTTP ${res.status}: ${errText || res.statusText}` });
        } else {
          const blob = await res.blob();
          results.push({ ...b, ok: true, blob });
        }
      } catch (err) {
        results.push({ ...b, ok: false, reason: (err && err.message) || 'network error' });
      }
    }
    return results;
  };

  NS.proFeatures.phaseRotationWidget = Widget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Widget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Backward-compat: si NS.create falla, la clase sigue funcionando standalone
  // y `Widget.processAllBands(file, bands, token)` permanece accesible.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['phase-rotation']) {
      const inst = rack.create({
        id: 'phase-rotation', title: '🔄 Phase Rotation', endpoint: '/dsp/phase-rotation', widget: Widget
      });
      if (inst) {
        Widget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['phase-rotation'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'phase-rotation', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
