// ============================================================
// pro-features/loudness-penalty-widget.js
// F3.1 — Loudness Penalty badges (Spotify / Apple Music / YouTube)
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

  const COLOR_GOOD = (PALETTE && PALETTE.good) || '#35f2a3';
  const COLOR_WARN = (PALETTE && PALETTE.warn) || '#ffd84d';
  const COLOR_BAD = (PALETTE && PALETTE.danger) || '#ff5f72';
  const COLOR_ORIG = (PALETTE && PALETTE.accent) || '#42e8ff';
  const COLOR_POST = (PALETTE && PALETTE.danger) || '#ff5f72';
  const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
  const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
  const COLOR_BG = 'rgba(13,16,32,0.6)';

  function colorForPenalty(p) {
    const v = Math.abs(p);
    if (v < 1) return COLOR_GOOD;
    if (v <= 2) return COLOR_WARN;
    return COLOR_BAD;
  }

  class Widget extends globalThis.BaseCanvasWidget {
    constructor() {
      super();
      this.cssWidth = 0;
      this.cssHeight = 0;
      this.data = null;
      this._hoverIdx = -1;
      this._mouseHandler = null;
    }

    onInit(options) {
      this.options = options || {};
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(rect.width, 320);
      this.cssHeight = Math.max(rect.height, 200);
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas.width = Math.floor(this.cssWidth * this._dpr);
      this.canvas.height = Math.floor(this.cssHeight * this._dpr);
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this._bindMouse();
    }

    onResize(_w, _h, _dpr) {
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = this.canvas.getBoundingClientRect();
      this.cssWidth = Math.max(rect.width, 320);
      this.cssHeight = Math.max(rect.height, 200);
      this.canvas.width = Math.floor(this.cssWidth * this._dpr);
      this.canvas.height = Math.floor(this.cssHeight * this._dpr);
      this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    }

    onTick(_now) {
      this._render();
    }

    onDestroy() {
      if (this._mouseHandler && this.canvas) {
        this.canvas.removeEventListener('mousemove', this._mouseHandler);
      }
      if (this._mouseLeave && this.canvas) {
        this.canvas.removeEventListener('mouseleave', this._mouseLeave);
      }
      this._mouseHandler = null;
      this._mouseLeave = null;
    }

    _bindMouse() {
      this._mouseHandler = (e) => {
        const rect = this.canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const padX = 16;
        const padY = 14;
        const innerW = this.cssWidth - padX * 2;
        const colW = innerW / 3;
        const badgeY = padY + 4;
        const badgeH = 56;
        if (y >= badgeY && y <= badgeY + badgeH && this.data && this.data.platforms) {
          const idx = Math.max(0, Math.min(2, Math.floor((x - padX) / colW)));
          this._hoverIdx = idx;
        } else {
          this._hoverIdx = -1;
        }
      };
      this.canvas.addEventListener('mousemove', this._mouseHandler);
      this._mouseLeave = () => { this._hoverIdx = -1; };
      this.canvas.addEventListener('mouseleave', this._mouseLeave);
    }

    update(data) {
      this.data = data || { platforms: [] };
    }

    resize() {
      if (!this.canvas) return;
      this.onResize();
    }

    _render() {
      const ctx = this.ctx;
      const w = this.cssWidth;
      const h = this.cssHeight;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = COLOR_BG;
      ctx.fillRect(0, 0, w, h);

      const padX = 16;
      const padY = 14;
      const innerW = w - padX * 2;
      const colW = innerW / 3;

      const platforms = (this.data && this.data.platforms) || [];

      for (let i = 0; i < 3; i++) {
        const p = platforms[i] || { name: ['Spotify', 'Apple Music', 'YouTube'][i], penalty_db: 0, orig_lufs: -14, post_lufs: -14 };
        const x = padX + i * colW + 6;
        const y = padY + 4;
        const bw = colW - 12;
        const bh = 56;
        const color = colorForPenalty(p.penalty_db);
        const hovered = this._hoverIdx === i;

        ctx.save();
        ctx.shadowBlur = hovered ? 18 : 8;
        ctx.shadowColor = color;
        const grd = ctx.createLinearGradient(x, y, x, y + bh);
        grd.addColorStop(0, `${color}22`);
        grd.addColorStop(1, `${color}05`);
        ctx.fillStyle = grd;
        this._roundRect(ctx, x, y, bw, bh, 10);
        ctx.fill();
        ctx.shadowBlur = 0;

        ctx.strokeStyle = `${color}55`;
        ctx.lineWidth = 1;
        this._roundRect(ctx, x + 0.5, y + 0.5, bw - 1, bh - 1, 10);
        ctx.stroke();

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = '600 12px system-ui, -apple-system, sans-serif';
        ctx.textBaseline = 'top';
        ctx.fillText(p.name, x + 10, y + 8, bw - 20);

        ctx.fillStyle = color;
        ctx.font = '700 18px system-ui, -apple-system, sans-serif';
        const penaltyStr = (p.penalty_db > 0 ? '+' : '') + p.penalty_db.toFixed(1) + ' dB';
        ctx.fillText(penaltyStr, x + 10, y + 26);

        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.fillText('LUFS penalty', x + 10, y + 46);
        ctx.restore();
      }

      const compareY = padY + 4 + 56 + 18;
      const compareH = 44;
      const cmpX = padX;
      const cmpW = innerW;

      if (platforms.length > 0) {
        const p = platforms[this._hoverIdx >= 0 ? this._hoverIdx : 0];
        const maxAbs = Math.max(Math.abs(p.orig_lufs), Math.abs(p.post_lufs), 18);

        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '11px system-ui, -apple-system, sans-serif';
        ctx.fillText(`${p.name} — LUFS comparison (pre vs post)`, cmpX, compareY - 14);

        ctx.fillStyle = 'rgba(255,255,255,0.04)';
        this._roundRect(ctx, cmpX, compareY, cmpW, compareH, 8);
        ctx.fill();

        const cx0 = cmpX + 10;
        const cw = cmpW - 20;

        ctx.fillStyle = COLOR_ORIG;
        const origW = Math.max(2, (Math.abs(p.orig_lufs) / maxAbs) * cw * 0.45);
        ctx.fillRect(cx0, compareY + 8, origW, 12);

        ctx.fillStyle = COLOR_POST;
        const postW = Math.max(2, (Math.abs(p.post_lufs) / maxAbs) * cw * 0.45);
        ctx.fillRect(cx0, compareY + 24, postW, 12);

        ctx.fillStyle = COLOR_TEXT;
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.fillText(`orig ${p.orig_lufs.toFixed(1)}`, cx0 + origW + 6, compareY + 10);
        ctx.fillText(`post ${p.post_lufs.toFixed(1)}`, cx0 + postW + 6, compareY + 26);

        const legendX = cx0 + cw - 90;
        ctx.fillStyle = COLOR_ORIG; ctx.fillRect(legendX, compareY + 8, 8, 8);
        ctx.fillStyle = COLOR_MUTED; ctx.fillText('orig', legendX + 12, compareY + 8);
        ctx.fillStyle = COLOR_POST; ctx.fillRect(legendX, compareY + 24, 8, 8);
        ctx.fillStyle = COLOR_MUTED; ctx.fillText('post', legendX + 12, compareY + 24);
      }
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

  // ── Mapping plataformas → codec/bitrate del backend ──
  Widget.PLATFORM_PARAMS = {
    'Spotify':   { codec: 'opus', bitrate: 96  },
    'Apple Music':{ codec: 'aac',  bitrate: 128 },
    'YouTube':   { codec: 'mp3',  bitrate: 128 }
  };

  Widget.fetchPlatforms = async function (file, token) {
    const results = [];
    for (const [name, p] of Object.entries(Widget.PLATFORM_PARAMS)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('codec', p.codec);
      fd.append('bitrate', String(p.bitrate));
      try {
        const res = await LG.api.apiFetch('/dsp/loudness-penalty', {
          method: 'POST',
          body: fd
        });
        if (res.status === 404) {
          results.push({ name, unavailable: true, reason: 'DSP endpoint no disponible — se habilitará pronto', penalty_db: 0, orig_lufs: -14, post_lufs: -14 });
        } else {
          const data = await res.json();
          results.push({
            name,
            penalty_db: data.penalty_db ?? data.X_Penalty_DB ?? 0,
            orig_lufs: data.orig_lufs ?? data.X_Orig_LUFS ?? -14,
            post_lufs: data.post_lufs ?? data.X_Post_LUFS ?? -14
          });
        }
      } catch (_) {
        results.push({ name, penalty_db: 0, orig_lufs: -14, post_lufs: -14 });
      }
    }
    return { platforms: results };
  };

  NS.proFeatures.loudnessPenaltyWidget = Widget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { Widget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // CATALOG key = 'loudness-penalty' (entries vacío — backend
  // infiere codec/bitrate desde los headers de la request).
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['loudness-penalty']) {
      const inst = rack.create({
        id: 'loudness-penalty', title: '🎧 Loudness Penalty', endpoint: '/dsp/loudness-penalty', widget: Widget
      });
      if (inst) {
        Widget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['loudness-penalty'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'loudness-penalty', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);
