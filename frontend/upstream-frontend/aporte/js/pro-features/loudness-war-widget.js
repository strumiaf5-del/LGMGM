// ============================================================
// loudness-war-widget.js — F4.4 Loudness War Detector Timeline
// ============================================================
// UI lógica: canvas 800×300 con timeline horizontal, eje X tiempo,
// eje Y DR score (-2 a +20), polyline DR por sección (cada 3s),
// fondo coloreado por zonas (verde/amarillo/rojo), badge y texto.
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  const DR_MIN = -2;
  const DR_MAX = 20;
  const ZONES = [
    { from: -2, to: 6,  color: 'rgba(255,95,114,0.22)',   border: 'rgba(255,95,114,0.5)' },   // Loudness War Victim
    { from: 6,  to: 10, color: 'rgba(255,216,77,0.18)',   border: 'rgba(255,216,77,0.45)' },  // Balanced
    { from: 10, to: 20, color: 'rgba(82,242,189,0.18)',   border: 'rgba(82,242,189,0.5)' }    // Dynamic Friendly
  ];

  const VERDICTS = {
    'Dynamic Friendly':        { label: 'Dynamic Friendly',        tone: '#52f2bd', bg: 'rgba(82,242,189,.18)' },
    'Balanced':                { label: 'Balanced',                tone: '#ffd84d', bg: 'rgba(255,216,77,.18)' },
    'Loudness War Victim':     { label: 'Loudness War Victim',     tone: '#ff5f72', bg: 'rgba(255,95,114,.18)' }
  };

  function drToY(dr, h, padTop, padBot) {
    const usable = h - padTop - padBot;
    const t = (window.clamp(dr, DR_MIN, DR_MAX) - DR_MIN) / (DR_MAX - DR_MIN);
    return padTop + (1 - t) * usable; // Y invertido (mayor DR = más arriba)
  }

  function timeToX(t, totalT, w, padLeft, padRight) {
    const usable = w - padLeft - padRight;
    if (!Number.isFinite(totalT) || totalT <= 0) return padLeft;
    return padLeft + (window.clamp(t, 0, totalT) / totalT) * usable;
  }

  function classifyVerdict(avgDr) {
    if (!Number.isFinite(avgDr)) return 'Balanced';
    if (avgDr >= 10) return 'Dynamic Friendly';
    if (avgDr >= 6)  return 'Balanced';
    return 'Loudness War Victim';
  }

  class loudnessWarWidget extends globalThis.BaseCanvasWidget {
    constructor() {
      super();
      this.canvas = null;
      this.root = null;
      this.cardEl = null;
      this.timelineCanvas = null;
      this.timelineCtx = null;
      this.state = {
        duration_sec: 180,
        timeline: [],
        verdict: 'Balanced'
      };
      // Animated drawing progress for a nicer first paint
      this._progress = 0;
      this._listeners = [];
    }

    onInit(options) {
      this.options = options || {};
      // canvas is required by BaseCanvasWidget — pass a dummy placeholder.
      // The real canvas (`timelineCanvas`) is built in the card HTML below.
      this.canvas = this.canvas || document.createElement('canvas');
      this.root = (this.canvas && this.canvas.parentElement) || null;
      if (!this.root) return;

      this._applyOptions(options);

      const card = document.createElement('div');
      card.className = 'pro-meter-card lw-widget';
      card.innerHTML = `
        <div class="lw-widget__head">
          <strong class="pro-card-title" style="font-size:.78rem;">
            ⚔ Loudness War Detector Timeline
          </strong>
          <span class="lw-widget__head-meta">
            DR score por sección de 3 segundos
          </span>
        </div>

        <div class="lw-widget__main">
          <div class="lw-widget__chart-col">
            <canvas id="lwTimeline" class="lw-widget__canvas" width="800" height="300"
                    style="border:1px solid var(--ui-border);"></canvas>
            <div class="lw-widget__scale">
              <span>🟢 DR &gt; 10 · Dynamic Friendly</span>
              <span>🟡 DR 6–10 · Balanced</span>
              <span>🔴 DR &lt; 6 · Loudness War</span>
            </div>
          </div>

          <div class="lw-widget__side">
            <div class="pro-meter-card lw-widget__sub-card">
              <span>
                Verdict
              </span>
              <div id="lwBadge"
                   style="display:inline-block;margin-top:.4rem;padding:.4rem .8rem;
                          border-radius:999px;font-size:.85rem;font-weight:800;
                          background:rgba(255,216,77,.18);color:#ffd84d;
                          border:1px solid rgba(255,216,77,.45);">
                Balanced
              </div>
              <div id="lwAvg"
                   style="font-size:1.1rem;font-weight:800;color:#dcfbff;margin-top:.4rem;">
                Avg DR: —
              </div>
            </div>
            <div class="pro-meter-card"
                 style="padding:.7rem;border-radius:12px;background:rgba(255,255,255,.025);
                        border:1px solid rgba(255,255,255,.06);">
              <span style="font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;
                           color:var(--ui-muted,#9ba6c4);">
                Análisis
              </span>
              <div id="lwExplain"
                   style="font-size:.72rem;color:#dcfbff;margin-top:.4rem;line-height:1.4;">
                Esperando análisis de timeline…
              </div>
            </div>
            <div class="pro-meter-card"
                 style="padding:.7rem;border-radius:12px;background:rgba(255,255,255,.025);
                        border:1px solid rgba(255,255,255,.06);">
              <span style="font-size:.6rem;text-transform:uppercase;letter-spacing:.06em;
                           color:var(--ui-muted,#9ba6c4);">
                Duración total
              </span>
              <div id="lwDuration"
                   style="font-size:1.1rem;font-weight:800;color:#dcfbff;margin-top:.3rem;">
                — s · — secciones
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

      this._setupCanvas();
      this._bindTimelineResize();
      this._updateReadouts();
      this._animateProgress();
    }

    onResize(_w, _h, _dpr) {
      this._setupCanvas();
      this._drawTimeline();
    }

    onTick(_now) {
      this._drawTimeline();
    }

    onDestroy() {
      this._listeners.forEach((rec) => {
        try { rec.target.removeEventListener(rec.type, rec.handler, rec.options); }
        catch (_) { /* noop */ }
      });
      this._listeners = [];
      if (this.cardEl && this.cardEl.parentElement) {
        this.cardEl.parentElement.removeChild(this.cardEl);
      }
      this.cardEl = null;
      this.timelineCanvas = null;
      this.timelineCtx = null;
      this.canvas = null;
    }

    _bindTimelineResize() {
      if (typeof ResizeObserver === 'undefined' || !this.timelineCanvas) return;
      const _ro = new ResizeObserver(() => this._setupCanvas());
      _ro.observe(this.timelineCanvas);
      this._listeners.push({ target: _ro, type: 'disconnect', handler: null, options: null });
    }

    _bindResize() {
      // Migrated to _bindTimelineResize (onDestroy cleanup via _listeners)
    }


    update(data = {}) {
      if (!data) return;
      if (Number.isFinite(Number(data.duration_sec))) {
        this.state.duration_sec = Math.max(0, Number(data.duration_sec));
      }
      if (Array.isArray(data.timeline)) {
        this.state.timeline = data.timeline
          .map((pt) => ({
            time_sec: Number(pt && pt.time_sec),
            dr_score: Number(pt && pt.dr_score)
          }))
          .filter((pt) => Number.isFinite(pt.time_sec) && Number.isFinite(pt.dr_score));
      }
      if (typeof data.verdict === 'string') {
        this.state.verdict = data.verdict;
      }
      this._updateReadouts();
      // Restart animated draw
      this._animateProgress();
    }

    destroy() {
      super.destroy();
    }

    getControls() {
      // Loudness War no expone controles interactivos (es vista de timeline).
      return `
        <div style="font-size:.72rem;color:var(--ui-muted,#9ba6c4);text-align:center;">
          Visualización de timeline DR — sin controles interactivos.
        </div>
      `;
    }

    // ── internals ───────────────────────────────────────────────────────
    _applyOptions(options) {
      if (Number.isFinite(Number(options.duration_sec))) {
        this.state.duration_sec = Math.max(0, Number(options.duration_sec));
      }
      if (Array.isArray(options.timeline)) {
        this.state.timeline = options.timeline.slice();
      }
      if (typeof options.verdict === 'string') {
        this.state.verdict = options.verdict;
      }
    }

    _setupCanvas() {
      const c = this.cardEl?.querySelector('#lwTimeline');
      this.timelineCanvas = c || null;
      this.timelineCtx = c ? c.getContext('2d') : null;
      if (!c || !this.timelineCtx) return;
      const cssW = c.clientWidth || c.width;
      const cssH = c.clientHeight || c.height;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
        c.width = Math.max(1, Math.floor(cssW * dpr));
        c.height = Math.max(1, Math.floor(cssH * dpr));
        this.timelineCtx.setTransform(1, 0, 0, 1, 0, 0);
        this.timelineCtx.scale(dpr, dpr);
      }
    }

    _updateReadouts() {
      if (!this.cardEl) return;

      // Verdict badge
      const verdict = this.state.verdict || classifyVerdict(this._avgDr());
      const klass = VERDICTS[verdict] || VERDICTS['Balanced'];
      const badge = this.cardEl.querySelector('#lwBadge');
      if (badge) {
        badge.textContent = klass.label;
        badge.style.color = klass.tone;
        badge.style.background = klass.bg;
        badge.style.border = `1px solid ${klass.tone}77`;
      }

      // Avg DR
      const avg = this._avgDr();
      const avgEl = this.cardEl.querySelector('#lwAvg');
      if (avgEl) avgEl.textContent = `Avg DR: ${Number.isFinite(avg) ? avg.toFixed(1) : '—'}`;

      // Explanation
      const explain = this.cardEl.querySelector('#lwExplain');
      if (explain) {
        explain.textContent = this._explain(avg, verdict);
      }

      // Duration
      const durEl = this.cardEl.querySelector('#lwDuration');
      if (durEl) {
        const secs = this.state.duration_sec;
        const m = Math.floor(secs / 60);
        const s = Math.floor(secs % 60);
        const sections = this.state.timeline.length;
        durEl.textContent = `${m}:${String(s).padStart(2, '0')} · ${sections} secciones`;
      }
    }

    _avgDr() {
      const tl = this.state.timeline;
      if (!Array.isArray(tl) || tl.length === 0) return NaN;
      let sum = 0, n = 0;
      for (const pt of tl) {
        if (Number.isFinite(pt.dr_score)) { sum += pt.dr_score; n++; }
      }
      return n > 0 ? sum / n : NaN;
    }

    _explain(avg, verdict) {
      const tl = this.state.timeline;
      if (!Array.isArray(tl) || tl.length === 0) {
        return 'Esperando análisis de timeline. La curva mostrará la evolución del rango dinámico cada 3 segundos.';
      }
      // Peak / valley DR
      let peak = -Infinity, valley = Infinity;
      let peakAt = 0, valleyAt = 0;
      for (const pt of tl) {
        if (pt.dr_score > peak) { peak = pt.dr_score; peakAt = pt.time_sec; }
        if (pt.dr_score < valley) { valley = pt.dr_score; valleyAt = pt.time_sec; }
      }
      const fmtT = (sec) => {
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return `${m}:${String(s).padStart(2, '0')}`;
      };
      const peakLine = Number.isFinite(peak)
        ? `Pico DR ${peak.toFixed(1)} @ ${fmtT(peakAt)}. `
        : '';
      const valleyLine = Number.isFinite(valley)
        ? `Valle DR ${valley.toFixed(1)} @ ${fmtT(valleyAt)}.`
        : '';
      const verdictPhrases = {
        'Dynamic Friendly':    'Master con headroom generoso. Mantiene la dinámica musical original sin écrasement.',
        'Balanced':            'Mezcla competitiva con compresión moderada. Adecuada para streaming.',
        'Loudness War Victim': 'Compresión excesiva. Posible pérdida de micro-dinámica y fatiga auditiva.'
      };
      return `${verdictPhrases[verdict] || ''} ${peakLine}${valleyLine}`.trim();
    }

    _animateProgress() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      this._progress = 0;
      const start = performance.now();
      const durationMs = 600;
      const tick = (now) => {
        this.rafId = null;
        if (window.LGMDM.utils.prefersReducedMotion()) {
          this._progress = 1;
          this._drawTimeline();
          return;
        }
        if (!this.cardEl || !this.timelineCtx) return;
        const elapsed = now - start;
        const p = Math.min(1, elapsed / durationMs);
        this._progress = p;
        this._drawTimeline();
        if (p < 1) {
          this.rafId = requestAnimationFrame(tick);
        }
      };
      this.rafId = requestAnimationFrame(tick);
    }

    _drawTimeline() {
      if (!this.timelineCtx || !this.timelineCanvas) return;
      const cssW = this.timelineCanvas.clientWidth || this.timelineCanvas.width;
      const cssH = this.timelineCanvas.clientHeight || this.timelineCanvas.height;
      const ctx = this.timelineCtx;

      const padLeft = 44, padRight = 14, padTop = 16, padBot = 28;
      const totalT = Math.max(0.001, this.state.duration_sec);

      ctx.fillStyle = '#070912';
      ctx.fillRect(0, 0, cssW, cssH);

      // ── Background zones ──────────────────────────────────────────────
      const usableTop = padTop;
      const usableBot = cssH - padBot;
      ZONES.forEach((z) => {
        const y1 = drToY(z.to, cssH, padTop, padBot);
        const y2 = drToY(z.from, cssH, padTop, padBot);
        ctx.fillStyle = z.color;
        ctx.fillRect(padLeft, y1, cssW - padLeft - padRight, y2 - y1);
      });

      // ── Grid lines (horizontal DR scale) ──────────────────────────────
      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      ctx.fillStyle = 'rgba(220,251,255,.55)';
      ctx.font = `${Math.max(9, cssW * 0.018)}px monospace`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (let v = DR_MIN; v <= DR_MAX; v += 2) {
        const y = drToY(v, cssH, padTop, padBot);
        ctx.beginPath();
        ctx.moveTo(padLeft, y);
        ctx.lineTo(cssW - padRight, y);
        ctx.stroke();
        ctx.fillText(String(v), padLeft - 6, y);
      }

      // ── Vertical grid (time axis) ─────────────────────────────────────
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const xTickStep = totalT > 600 ? 60 : (totalT > 120 ? 30 : 15);
      for (let t = 0; t <= totalT; t += xTickStep) {
        const x = timeToX(t, totalT, cssW, padLeft, padRight);
        ctx.strokeStyle = 'rgba(255,255,255,.04)';
        ctx.beginPath();
        ctx.moveTo(x, padTop);
        ctx.lineTo(x, cssH - padBot);
        ctx.stroke();
        const m = Math.floor(t / 60);
        const s = Math.floor(t % 60);
        ctx.fillStyle = 'rgba(220,251,255,.55)';
        ctx.fillText(`${m}:${String(s).padStart(2, '0')}`, x, cssH - padBot + 6);
      }

      // ── Polyline DR por sección ───────────────────────────────────────
      const tl = this.state.timeline;
      if (Array.isArray(tl) && tl.length > 0) {
        // Gradiente bajo la polyline
        const verdict = this.state.verdict || classifyVerdict(this._avgDr());
        const klass = VERDICTS[verdict] || VERDICTS['Balanced'];
        const visibleCount = Math.max(1, Math.floor(tl.length * this._progress));
        const points = tl.slice(0, visibleCount + 1).map((pt) => ({
          x: timeToX(pt.time_sec, totalT, cssW, padLeft, padRight),
          y: drToY(pt.dr_score, cssH, padTop, padBot)
        }));

        if (points.length >= 1) {
          // Fill bajo la curva
          ctx.beginPath();
          ctx.moveTo(points[0].x, cssH - padBot);
          points.forEach((p) => ctx.lineTo(p.x, p.y));
          if (points.length >= 2) {
            ctx.lineTo(points[points.length - 1].x, cssH - padBot);
          }
          ctx.closePath();
          const grd = ctx.createLinearGradient(0, padTop, 0, cssH - padBot);
          grd.addColorStop(0, `${klass.tone}55`);
          grd.addColorStop(1, `${klass.tone}00`);
          ctx.fillStyle = grd;
          ctx.fill();

          // Polyline principal
          ctx.strokeStyle = klass.tone;
          ctx.lineWidth = 2.5;
          ctx.shadowBlur = 8;
          ctx.shadowColor = klass.tone;
          ctx.beginPath();
          points.forEach((p, i) => {
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
          ctx.shadowBlur = 0;

          // Puntos
          ctx.fillStyle = klass.tone;
          for (const p of points) {
            ctx.beginPath();
            ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2);
            ctx.fill();
          }
        }
      } else {
        // Placeholder: línea recta en DR=8
        ctx.strokeStyle = 'rgba(220,251,255,.25)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(padLeft, drToY(8, cssH, padTop, padBot));
        ctx.lineTo(cssW - padRight, drToY(8, cssH, padTop, padBot));
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(220,251,255,.4)';
        ctx.font = '11px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('Esperando timeline…', cssW / 2, cssH / 2);
      }

      // ── Ejes labels ───────────────────────────────────────────────────
      ctx.fillStyle = 'rgba(220,251,255,.65)';
      ctx.font = `${Math.max(10, cssW * 0.016)}px monospace`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      ctx.fillText('DR score', 4, padTop);
      ctx.textAlign = 'right';
      ctx.fillText('time', cssW - padRight, cssH - 12);
    }
  }

  LG.proFeatures.loudnessWarWidget = loudnessWarWidget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { loudnessWarWidget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Frontend-only: no tiene /dsp/* endpoint. La entry en CATALOG sólo
  // permite al rack snapshotear su state (serialize/restore).
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['loudness-war']) {
      const inst = rack.create({
        id: 'loudness-war', title: '📉 Loudness War', widget: loudnessWarWidget
      });
      if (inst) {
        loudnessWarWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['loudness-war'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'loudness-war', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);

