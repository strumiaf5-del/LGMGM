// dr-meter.ts — pro widget. Port of aporte/js/pro-features/dr-meter-widget.js.

import { clamp, getPrefersReducedMotion } from '../../../core/utils';

const DR_MIN = 2;
const DR_MAX = 20;
const LRA_MIN = 0;
const LRA_MAX = 20;

interface GenreClass { genre: string; label: string; tone: string; }

function classifyGenre(dr: number): GenreClass {
  if (!Number.isFinite(dr)) return { genre: 'Unknown', label: 'Unknown', tone: '#9ba6c4' };
  if (dr > 12) return { genre: 'Heavy', label: 'Heavy / Dinámico', tone: '#52f2bd' };
  if (dr >= 8) return { genre: 'Pop', label: 'Pop / Balanced', tone: '#7de8ff' };
  return { genre: 'Loud', label: 'Loud / Loudness War', tone: '#ff5f72' };
}

// Mapea DR (2..20) → ángulo del arco semicircular (π izq → 0 der).
function drToAngle(dr: number): number {
  const t = (clamp(dr, DR_MIN, DR_MAX) - DR_MIN) / (DR_MAX - DR_MIN);
  return Math.PI * (1 - t);
}

function lraToAngle(lra: number): number {
  const t = (clamp(lra, LRA_MIN, LRA_MAX) - LRA_MIN) / (LRA_MAX - LRA_MIN);
  return Math.PI * (1 - t);
}

// ── Types ──────────────────────────────────────────────────────
export interface DrMeterState {
  dr_score: number;
  lra: number;
  crest_factor: number;
  genre_classification: string;
}

interface NeedlePair { dr: number; lra: number; }

// ── Widget ─────────────────────────────────────────────────────
export class DrMeterWidget {
  canvas: HTMLCanvasElement | null = null;
  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  state: DrMeterState = {
    dr_score: 12,
    lra: 8,
    crest_factor: 14,
    genre_classification: 'Heavy',
  };

  // Animated target for smooth needle motion.
  private _target: NeedlePair = { dr: 12, lra: 8 };
  private _current: NeedlePair = { dr: 12, lra: 8 };

  rafId: number | null = null;
  private _ro: ResizeObserver | null = null;
  private _ac: AbortController | null = null;
  private _beforeUnload: (() => void) | null = null;

  // Canvases/contexts built in init().
  private _gaugeCanvas: HTMLCanvasElement | null = null;
  private _gaugeCtx: CanvasRenderingContext2D | null = null;
  private _lraCanvas: HTMLCanvasElement | null = null;
  private _lraCtx: CanvasRenderingContext2D | null = null;
  private _destroyed = false;

  static Insert?: unknown;

  constructor() { /* noop */ }

  init(canvas: HTMLCanvasElement, options: Partial<DrMeterState> = {}): void {
    this.canvas = canvas;
    this.root = canvas.parentElement;
    if (!this.root) return;

    this._ac = new AbortController();
    const signal = this._ac.signal;

    this._applyOptions(options);
    this._applyData({});

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

    if (this.canvas.parentElement === this.root) {
      this.canvas.insertAdjacentElement('afterend', card);
    } else {
      this.root.appendChild(card);
    }

    this._setupCanvases();
    this._renderStatic();
    this._bindResize(signal);
    this._startRaf();

    this._beforeUnload = () => { try { this.teardown(); } catch (_) { /* noop */ } };
    window.addEventListener('beforeunload', this._beforeUnload, { once: true, signal });
  }

  private _bindResize(signal: AbortSignal): void {
    if (typeof ResizeObserver === 'undefined' || !this.cardEl) return;
    this._ro = new ResizeObserver(() => this._setupCanvases());
    this._ro.observe(this.cardEl);
    signal.addEventListener('abort', () => {
      try { this._ro?.disconnect(); } catch (_) { /* noop */ }
      this._ro = null;
    });
  }

  update(data: Partial<DrMeterState> = {}): void {
    if (!data) return;
    this._applyData(data);
  }

  destroy(): void { this.teardown(); }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    try { this._ac?.abort(); } catch (_) { /* noop */ }
    this._ac = null;
    this._ro = null;
    this._beforeUnload = null;
    if (this.cardEl && this.cardEl.parentElement) {
      try { this.cardEl.parentElement.removeChild(this.cardEl); } catch (_) { /* noop */ }
    }
    this.cardEl = null;
    this._gaugeCanvas = null;
    this._gaugeCtx = null;
    this._lraCanvas = null;
    this._lraCtx = null;
    this.canvas = null;
    this.root = null;
  }

  getControls(): string {
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

  // ── internals ───────────────────────────────────────────────────
  private _applyOptions(options: Partial<DrMeterState>): void {
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

  private _applyData(data: Partial<DrMeterState>): void {
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
    if (getPrefersReducedMotion()) {
      // No rAF loop in reduced-motion mode → snap and draw immediately.
      this._current.dr = this._target.dr;
      this._current.lra = this._target.lra;
      this._drawGauge(this._current.dr);
      this._drawLraGauge(this._current.lra);
    }
  }

  private _setupCanvases(): void {
    const gauge = this.cardEl?.querySelector<HTMLCanvasElement>('#drwGauge') ?? null;
    const lraGauge = this.cardEl?.querySelector<HTMLCanvasElement>('#drwLraGauge') ?? null;
    this._gaugeCanvas = gauge;
    this._gaugeCtx = gauge ? gauge.getContext('2d') : null;
    this._lraCanvas = lraGauge;
    this._lraCtx = lraGauge ? lraGauge.getContext('2d') : null;
    const pairs: { c: HTMLCanvasElement | null; ctx: CanvasRenderingContext2D | null }[] = [
      { c: this._gaugeCanvas, ctx: this._gaugeCtx },
      { c: this._lraCanvas, ctx: this._lraCtx },
    ];
    pairs.forEach(({ c, ctx }) => {
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

  private _startRaf(): void {
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (getPrefersReducedMotion()) {
      // Snap to target, draw once, no animation loop.
      this._current.dr = this._target.dr;
      this._current.lra = this._target.lra;
      this._drawGauge(this._current.dr);
      this._drawLraGauge(this._current.lra);
      return;
    }
    const FRAME_INTERVAL = 1000 / 60;
    let last = 0;
    const tick = (now: number): void => {
      this.rafId = null;
      if (this._destroyed) return;
      if (getPrefersReducedMotion()) {
        // preference toggled at runtime → snap and stop the loop.
        this._current.dr = this._target.dr;
        this._current.lra = this._target.lra;
        this._drawGauge(this._current.dr);
        this._drawLraGauge(this._current.lra);
        return;
      }
      if (!this.cardEl || !this._gaugeCtx || !this._lraCtx) return;
      if (now - last < FRAME_INTERVAL) {
        this.rafId = requestAnimationFrame(tick);
        return;
      }
      last = now;
      const ease = 0.18;
      this._current.dr += (this._target.dr - this._current.dr) * ease;
      this._current.lra += (this._target.lra - this._current.lra) * ease;
      this._drawGauge(this._current.dr);
      this._drawLraGauge(this._current.lra);
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private _renderStatic(): void {
    this._updateReadouts();
    this._drawGauge(this._current.dr);
    this._drawLraGauge(this._current.lra);
  }

  private _updateReadouts(): void {
    if (!this.cardEl) return;
    const dr = Number.isFinite(this.state.dr_score) ? this.state.dr_score : 0;
    const lra = Number.isFinite(this.state.lra) ? this.state.lra : 0;
    const crest = Number.isFinite(this.state.crest_factor) ? this.state.crest_factor : null;
    const klass = classifyGenre(dr);

    const readout = this.cardEl.querySelector<HTMLElement>('#drwReadout');
    if (readout) readout.textContent = `DR-${dr.toFixed(1)}`;

    const badge = this.cardEl.querySelector<HTMLElement>('#drwBadge');
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

    const desc = this.cardEl.querySelector<HTMLElement>('#drwDesc');
    if (desc) {
      let dynamicLabel: string;
      if (dr >= 14) dynamicLabel = 'Ultra-dinámico';
      else if (dr >= 10) dynamicLabel = 'Dinámico';
      else if (dr >= 6) dynamicLabel = 'Moderado';
      else dynamicLabel = 'Comprimido';
      desc.textContent = `DR-${dr.toFixed(1)} — ${klass.label} / ${dynamicLabel} / Competition-ready`;
    }

    const lraReadout = this.cardEl.querySelector<HTMLElement>('#drwLraReadout');
    if (lraReadout) lraReadout.textContent = `${lra.toFixed(1)} LU`;

    const crestBig = this.cardEl.querySelector<HTMLElement>('#drwCrestBig');
    const crestSmall = this.cardEl.querySelector<HTMLElement>('#drwCrest');
    if (crestBig && crest != null) crestBig.textContent = `${crest.toFixed(1)} dB`;
    if (crestSmall && crest != null) {
      crestSmall.textContent = `Crest Factor: ${crest.toFixed(1)} dB`;
    }
  }

  private _drawGauge(dr: number): void {
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
    const drawSegment = (fromDr: number, toDr: number, color: string): void => {
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

  private _drawLraGauge(lra: number): void {
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
    const drawSeg = (fromLra: number, toLra: number, color: string): void => {
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

// ── LGMDM namespace registration ───────────────────────────────
interface ProInsertRack {
  create?: (spec: { id: string; title: string; endpoint?: string; widget: unknown }) => unknown;
  CATALOG?: Record<string, unknown>;
  registry?: Record<string, unknown>;
}

interface ProFeaturesNs {
  widgets?: Record<string, unknown>;
  drMeterWidget?: typeof DrMeterWidget;
}

interface LgmdmGlobal {
  proFeatures?: ProFeaturesNs;
  proInsertRack?: ProInsertRack;
}

function ensureLgmdm(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {} as LgmdmGlobal;
  return w.LGMDM;
}

function registerInRack(): void {
  try {
    const rack = ensureLgmdm().proInsertRack;
    if (!rack || typeof rack.create !== 'function' || !rack.CATALOG || !rack.CATALOG['dr-meter']) return;
    const inst = rack.create({
      id: 'dr-meter',
      title: '📊 DR Meter',
      endpoint: '/dsp/dr-meter',
      widget: DrMeterWidget,
    });
    if (inst) {
      DrMeterWidget.Insert = inst;
      rack.registry = rack.registry || {};
      rack.registry['dr-meter'] = inst;
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'dr-meter', e);
  }
}

let _registered = false;
function bootstrap(): void {
  if (_registered) return;
  _registered = true;
  try {
    const ns = ensureLgmdm();
    ns.proFeatures = ns.proFeatures || ({} as ProFeaturesNs);
    ns.proFeatures.widgets = ns.proFeatures.widgets || {};
    ns.proFeatures.widgets['dr-meter'] = DrMeterWidget;
    // Legacy camelCase key — 34-premium-suite reads `proFeatures.drMeterWidget`.
    ns.proFeatures.drMeterWidget = DrMeterWidget;
    registerInRack();
  } catch (e) {
    _registered = false;
    if (typeof console !== 'undefined') console.debug('[dr-meter] bootstrap', e);
  }
}

bootstrap();
