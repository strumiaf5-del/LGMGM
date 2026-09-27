// loudness-war.ts — pro widget

import { clamp, getPrefersReducedMotion } from '../../../core/utils';

const DR_MIN = -2;
const DR_MAX = 20;

interface Zone {
  from: number;
  to: number;
  color: string;
  border: string;
}
const ZONES: Zone[] = [
  { from: -2, to: 6, color: 'rgba(255,95,114,0.22)', border: 'rgba(255,95,114,0.5)' },
  { from: 6, to: 10, color: 'rgba(255,216,77,0.18)', border: 'rgba(255,216,77,0.45)' },
  { from: 10, to: 20, color: 'rgba(82,242,189,0.18)', border: 'rgba(82,242,189,0.5)' },
];

type Verdict = 'Dynamic Friendly' | 'Balanced' | 'Loudness War Victim';

interface VerdictStyle {
  label: string;
  tone: string;
  bg: string;
}
const VERDICTS: Record<Verdict, VerdictStyle> = {
  'Dynamic Friendly': { label: 'Dynamic Friendly', tone: '#52f2bd', bg: 'rgba(82,242,189,.18)' },
  Balanced: { label: 'Balanced', tone: '#ffd84d', bg: 'rgba(255,216,77,.18)' },
  'Loudness War Victim': { label: 'Loudness War Victim', tone: '#ff5f72', bg: 'rgba(255,95,114,.18)' },
};

function drToY(dr: number, h: number, padTop: number, padBot: number): number {
  const usable = h - padTop - padBot;
  const t = (clamp(dr, DR_MIN, DR_MAX) - DR_MIN) / (DR_MAX - DR_MIN);
  return padTop + (1 - t) * usable;
}

function timeToX(t: number, totalT: number, w: number, padLeft: number, padRight: number): number {
  const usable = w - padLeft - padRight;
  if (!Number.isFinite(totalT) || totalT <= 0) return padLeft;
  return padLeft + (clamp(t, 0, totalT) / totalT) * usable;
}

function classifyVerdict(avgDr: number): Verdict {
  if (!Number.isFinite(avgDr)) return 'Balanced';
  if (avgDr >= 10) return 'Dynamic Friendly';
  if (avgDr >= 6) return 'Balanced';
  return 'Loudness War Victim';
}

// ── Public state ──────────────────────────────────────────────
export interface LoudnessWarTimelinePoint {
  time_sec: number;
  dr_score: number;
}

export interface LoudnessWarState {
  duration_sec: number;
  timeline: LoudnessWarTimelinePoint[];
  verdict: Verdict;
}

/** Shape aceptada por `update` (permissive — acepta raw del backend). */
export interface LoudnessWarUpdate {
  duration_sec?: number;
  timeline?: Array<{ time_sec?: number; dr_score?: number } | null | undefined>;
  verdict?: string;
}

export type LoudnessWarInitOptions = {
  duration_sec?: number;
  timeline?: LoudnessWarTimelinePoint[];
  verdict?: Verdict;
};

// ── Rack typing (minimal slice) ───────────────────────────────
interface ProInsertRack {
  create?: (spec: {
    id: string;
    title: string;
    endpoint?: string;
    widget: unknown;
  }) => unknown;
  CATALOG?: Record<string, unknown>;
  registry?: Record<string, unknown>;
}

interface ProFeaturesNS {
  loudnessWarWidget?: unknown;
  widgets?: Record<string, unknown>;
}

interface LgmdmGlobal {
  proFeatures?: ProFeaturesNS;
  proInsertRack?: ProInsertRack;
}

// ── Widget ────────────────────────────────────────────────────
export class LoudnessWarWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  canvas: HTMLCanvasElement | null = null;
  root: HTMLElement | null = null;

  /** Public widget state — DR timeline + verdict. */
  state: LoudnessWarState = {
    duration_sec: 180,
    timeline: [],
    verdict: 'Balanced',
  };

  private cardEl: HTMLElement | null = null;
  private timelineCanvas: HTMLCanvasElement | null = null;
  private timelineCtx: CanvasRenderingContext2D | null = null;
  private progress = 0;
  private rafId: number | null = null;
  private ro: ResizeObserver | null = null;
  private _destroyed = false;

  constructor() {
    // Standalone class; fields initialised above.
  }

  init(canvas: HTMLCanvasElement | null, options?: LoudnessWarInitOptions): void {
    // BaseCanvasWidget required a canvas; the real timeline canvas is built
    // inside the card HTML below. Use the host canvas as a positional anchor.
    this.canvas = canvas;
    if (!canvas) return;
    this.root = canvas.parentElement;
    if (!this.root) return;

    if (options) this._applyOptions(options);

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

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: LoudnessWarUpdate | null): void {
    if (!data) return;
    if (Number.isFinite(Number(data.duration_sec))) {
      this.state.duration_sec = Math.max(0, Number(data.duration_sec));
    }
    if (Array.isArray(data.timeline)) {
      this.state.timeline = data.timeline
        .map((pt) => ({
          time_sec: Number(pt && pt.time_sec),
          dr_score: Number(pt && pt.dr_score),
        }))
        .filter(
          (pt) => Number.isFinite(pt.time_sec) && Number.isFinite(pt.dr_score),
        );
    }
    if (typeof data.verdict === 'string') {
      this.state.verdict = this._coerceVerdict(data.verdict);
    }
    this._updateReadouts();
    this._animateProgress();
  }

  /** Loudness War no expone controles interactivos (vista de timeline). */
  getControls(): string {
    return `
      <div style="font-size:.72rem;color:var(--ui-muted,#9ba6c4);text-align:center;">
        Visualización de timeline DR — sin controles interactivos.
      </div>
    `;
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ro) {
      try { this.ro.disconnect(); } catch { /* ignore */ }
      this.ro = null;
    }
    if (this.cardEl && this.cardEl.parentElement) {
      this.cardEl.parentElement.removeChild(this.cardEl);
    }
    this.cardEl = null;
    this.timelineCanvas = null;
    this.timelineCtx = null;
    this.canvas = null;
    this.root = null;
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  // ── internals ───────────────────────────────────────────────
  private _coerceVerdict(v: string): Verdict {
    return v in VERDICTS ? (v as Verdict) : 'Balanced';
  }

  private _applyOptions(options: LoudnessWarInitOptions): void {
    if (Number.isFinite(Number(options.duration_sec))) {
      this.state.duration_sec = Math.max(0, Number(options.duration_sec));
    }
    if (Array.isArray(options.timeline)) {
      this.state.timeline = options.timeline.slice();
    }
    if (options.verdict) {
      this.state.verdict = options.verdict;
    }
  }

  private _setupCanvas(): void {
    const c = this.cardEl?.querySelector('#lwTimeline') as HTMLCanvasElement | null;
    this.timelineCanvas = c;
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

  private _bindTimelineResize(): void {
    if (typeof ResizeObserver === 'undefined' || !this.timelineCanvas) return;
    this.ro = new ResizeObserver(() => {
      try {
        this._setupCanvas();
        this._drawTimeline();
      } catch {
        /* ignore */
      }
    });
    this.ro.observe(this.timelineCanvas);
  }

  private _updateReadouts(): void {
    if (!this.cardEl) return;

    const verdict: Verdict = this.state.verdict || classifyVerdict(this._avgDr());
    const klass = VERDICTS[verdict] || VERDICTS['Balanced'];
    const badge = this.cardEl.querySelector('#lwBadge') as HTMLElement | null;
    if (badge) {
      badge.textContent = klass.label;
      badge.style.color = klass.tone;
      badge.style.background = klass.bg;
      badge.style.border = `1px solid ${klass.tone}77`;
    }

    const avg = this._avgDr();
    const avgEl = this.cardEl.querySelector('#lwAvg');
    if (avgEl)
      avgEl.textContent = `Avg DR: ${Number.isFinite(avg) ? avg.toFixed(1) : '—'}`;

    const explain = this.cardEl.querySelector('#lwExplain');
    if (explain) {
      explain.textContent = this._explain(avg, verdict);
    }

    const durEl = this.cardEl.querySelector('#lwDuration');
    if (durEl) {
      const secs = this.state.duration_sec;
      const m = Math.floor(secs / 60);
      const s = Math.floor(secs % 60);
      const sections = this.state.timeline.length;
      durEl.textContent = `${m}:${String(s).padStart(2, '0')} · ${sections} secciones`;
    }
  }

  private _avgDr(): number {
    const tl = this.state.timeline;
    if (!Array.isArray(tl) || tl.length === 0) return NaN;
    let sum = 0;
    let n = 0;
    for (const pt of tl) {
      if (Number.isFinite(pt.dr_score)) {
        sum += pt.dr_score;
        n++;
      }
    }
    return n > 0 ? sum / n : NaN;
  }

  private _explain(avg: number, verdict: Verdict): string {
    const tl = this.state.timeline;
    if (!Array.isArray(tl) || tl.length === 0) {
      return 'Esperando análisis de timeline. La curva mostrará la evolución del rango dinámico cada 3 segundos.';
    }
    let peak = -Infinity;
    let valley = Infinity;
    let peakAt = 0;
    let valleyAt = 0;
    for (const pt of tl) {
      if (pt.dr_score > peak) {
        peak = pt.dr_score;
        peakAt = pt.time_sec;
      }
      if (pt.dr_score < valley) {
        valley = pt.dr_score;
        valleyAt = pt.time_sec;
      }
    }
    const fmtT = (sec: number): string => {
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
    const verdictPhrases: Record<Verdict, string> = {
      'Dynamic Friendly': 'Master con headroom generoso. Mantiene la dinámica musical original sin écrasement.',
      Balanced: 'Mezcla competitiva con compresión moderada. Adecuada para streaming.',
      'Loudness War Victim': 'Compresión excesiva. Posible pérdida de micro-dinámica y fatiga auditiva.',
    };
    return `${verdictPhrases[verdict] || ''} ${peakLine}${valleyLine}`.trim();
  }

  private _animateProgress(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    this.progress = 0;
    if (getPrefersReducedMotion()) {
      this.progress = 1;
      this._drawTimeline();
      return;
    }
    const start = performance.now();
    const durationMs = 600;
    const tick = (now: number): void => {
      this.rafId = null;
      if (!this.cardEl || !this.timelineCtx) return;
      const elapsed = now - start;
      const p = Math.min(1, elapsed / durationMs);
      this.progress = p;
      this._drawTimeline();
      if (p < 1) {
        this.rafId = requestAnimationFrame(tick);
      }
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _drawTimeline(): void {
    if (!this.timelineCtx || !this.timelineCanvas) return;
    const cssW = this.timelineCanvas.clientWidth || this.timelineCanvas.width;
    const cssH = this.timelineCanvas.clientHeight || this.timelineCanvas.height;
    const ctx = this.timelineCtx;

    const padLeft = 44;
    const padRight = 14;
    const padTop = 16;
    const padBot = 28;
    const totalT = Math.max(0.001, this.state.duration_sec);

    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, cssW, cssH);

    // ── Background zones ──
    ZONES.forEach((z) => {
      const y1 = drToY(z.to, cssH, padTop, padBot);
      const y2 = drToY(z.from, cssH, padTop, padBot);
      ctx.fillStyle = z.color;
      ctx.fillRect(padLeft, y1, cssW - padLeft - padRight, y2 - y1);
    });

    // ── Grid lines (horizontal DR scale) ──
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

    // ── Vertical grid (time axis) ──
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const xTickStep = totalT > 600 ? 60 : totalT > 120 ? 30 : 15;
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

    // ── Polyline DR por sección ──
    const tl = this.state.timeline;
    if (Array.isArray(tl) && tl.length > 0) {
      const verdict: Verdict = this.state.verdict || classifyVerdict(this._avgDr());
      const klass = VERDICTS[verdict] || VERDICTS['Balanced'];
      const visibleCount = Math.max(1, Math.floor(tl.length * this.progress));
      const points = tl.slice(0, visibleCount + 1).map((pt) => ({
        x: timeToX(pt.time_sec, totalT, cssW, padLeft, padRight),
        y: drToY(pt.dr_score, cssH, padTop, padBot),
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

    // ── Ejes labels ──
    ctx.fillStyle = 'rgba(220,251,255,.65)';
    ctx.font = `${Math.max(10, cssW * 0.016)}px monospace`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('DR score', 4, padTop);
    ctx.textAlign = 'right';
    ctx.fillText('time', cssW - padRight, cssH - 12);
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.loudnessWarWidget = LoudnessWarWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['loudness-war'] = LoudnessWarWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Frontend-only: no tiene /dsp/* endpoint. La entry en CATALOG sólo
// permite al rack snapshotear su state (serialize/restore). Backward-
// compat: si NS.create falla, la clase sigue funcionando standalone.
let _registered = false;
function bootstrap(): void {
  if (_registered) return;
  _registered = true;
  try {
    const rack = LG.proInsertRack;
    if (
      rack &&
      typeof rack.create === 'function' &&
      rack.CATALOG &&
      rack.CATALOG['loudness-war']
    ) {
      const inst = rack.create({
        id: 'loudness-war',
        title: '📉 Loudness War',
        widget: LoudnessWarWidget,
      });
      if (inst) {
        LoudnessWarWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['loudness-war'] = inst;
      }
    }
  } catch { /* insert-migration ya ejecutado */ }
}
bootstrap();
