// ms-imager.ts — pro widget. Port of aporte/js/pro-features/ms-imager-widget.js.

import { getPrefersReducedMotion } from '../../../core/utils';

interface MsImagerData {
  width: number;
  correlation: number;
}

interface MsImagerUpdate {
  width?: number;
  correlation?: number;
}

interface MsImagerOptions {
  [key: string]: unknown;
}

interface ThemeColors {
  good?: string;
  warn?: string;
  danger?: string;
  accent?: string;
  text?: string;
  muted?: string;
  bg?: string;
}

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

interface LgmdmGlobal {
  proFeatures?: {
    msImagerWidget?: typeof MsImagerWidget;
    widgets?: Record<string, unknown>;
  };
  proInsertRack?: ProInsertRack;
  themeColors?: () => ThemeColors | null;
}

function readThemeColors(): ThemeColors | null {
  const lg = (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM;
  if (lg && typeof lg.themeColors === 'function') {
    const tc = lg.themeColors();
    if (tc) return tc;
  }
  if (typeof document === 'undefined') return null;
  const s = getComputedStyle(document.documentElement);
  return {
    good: s.getPropertyValue('--ui-good').trim() || '#45f6b2',
    warn: s.getPropertyValue('--ui-warn').trim() || '#ffbd4a',
    danger: s.getPropertyValue('--ui-danger').trim() || '#ff4264',
    accent: s.getPropertyValue('--ui-accent').trim() || '#23e7ff',
    text: s.getPropertyValue('--ui-text').trim() || '#f4f7ff',
    muted: s.getPropertyValue('--ui-muted').trim() || '#8995b0',
    bg: s.getPropertyValue('--ui-surface').trim() || '#0d1220',
  };
}

const PALETTE = readThemeColors();

const COLOR_BG = (PALETTE && PALETTE.bg) || '#0d1020';
const COLOR_ARC = 'rgba(147,164,255,0.25)';
const COLOR_NEEDLE_GOOD = (PALETTE && PALETTE.good) || '#35f2a3';
const COLOR_NEEDLE_WARN = (PALETTE && PALETTE.warn) || '#ffd84d';
const COLOR_NEEDLE_BAD = (PALETTE && PALETTE.danger) || '#ff5f72';
const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
const COLOR_TICK = 'rgba(147,164,255,0.45)';

function colorForCorrelation(c: number): string {
  if (c >= 0) return COLOR_NEEDLE_GOOD;
  if (c >= -0.3) return COLOR_NEEDLE_WARN;
  return COLOR_NEEDLE_BAD;
}

export class MsImagerWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  options: MsImagerOptions = {};
  cssSize = 400;
  data: MsImagerData = { width: 1.0, correlation: 0.5 };

  private _dpr = 1;
  private _needleAngle = 0;
  private _raf = 0;
  private _ro: ResizeObserver | null = null;
  private _abort: AbortController | null = null;
  private _destroyed = false;

  constructor() {
    /* noop — fields initialised above. */
  }

  init(canvas: HTMLCanvasElement | null, options: MsImagerOptions = {}): void {
    if (!canvas) return;
    this.canvas = canvas;
    this.options = options || {};
    this._abort = new AbortController();

    // Canvas cuadrado (min(width, height)), DPR-aware.
    const rect = canvas.getBoundingClientRect();
    const side = Math.max(Math.min(rect.width, rect.height), 240);
    this.cssSize = side;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(side * this._dpr);
    canvas.height = Math.floor(side * this._dpr);
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      this.ctx = ctx;
    }
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'img');
    canvas.setAttribute('aria-label', 'Mid/Side correlation meter (−1 anti-phase to +1 mono)');

    this._render();

    // ResizeObserver — re-dimensiona y redibuja cuando el CSS cambia.
    if (typeof ResizeObserver !== 'undefined') {
      this._ro = new ResizeObserver(() => this.onResize());
      this._ro.observe(canvas);
    }

    // rAF loop sólo cuando NO hay preferencia de reducción de movimiento.
    if (!getPrefersReducedMotion()) {
      this._startTick();
    }

    // Coordinated disposal: aborting tears down the rAF + ResizeObserver.
    this._abort.signal.addEventListener('abort', () => {
      if (this._raf) {
        cancelAnimationFrame(this._raf);
        this._raf = 0;
      }
      if (this._ro) {
        try {
          this._ro.disconnect();
        } catch {
          /* noop */
        }
        this._ro = null;
      }
    });

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  onResize(): void {
    if (!this.canvas || this._destroyed) return;
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const side = Math.max(Math.min(rect.width, rect.height), 240);
    this.cssSize = side;
    this.canvas.width = Math.floor(side * this._dpr);
    this.canvas.height = Math.floor(side * this._dpr);
    this.canvas.style.width = `${side}px`;
    this.canvas.style.height = `${side}px`;
    if (this.ctx) this.ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
    this._render();
  }

  onTick(): void {
    this._render();
  }

  update(data: MsImagerUpdate | null = null): void {
    const d = data || {};
    this.data = {
      width: typeof d.width === 'number' ? d.width : 1.0,
      correlation: typeof d.correlation === 'number' ? d.correlation : 0.5,
    };
    // Bajo prefers-reduced-motion no hay rAF loop: renderizamos una vez
    // sincrónicamente para reflejar el nuevo dato.
    if (getPrefersReducedMotion()) this._render();
  }

  resize(): void {
    this.onResize();
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this._abort) {
      this._abort.abort();
      this._abort = null;
    }
    this.canvas = null;
    this.ctx = null;
  }

  private _startTick(): void {
    const tick = (): void => {
      if (this._destroyed) return;
      this._raf = 0;
      try {
        this.onTick();
      } catch (err) {
        console.error(`[ms-imager] onTick error:`, err);
      }
      if (!this._destroyed) {
        this._raf = requestAnimationFrame(tick);
      }
    };
    this._raf = requestAnimationFrame(tick);
  }

  private _render(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const sz = this.cssSize;
    ctx.clearRect(0, 0, sz, sz);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, sz, sz);

    const cx = sz / 2;
    const cy = sz * 0.55;
    const r = sz * 0.42;

    const startA = Math.PI;
    const endA = 2 * Math.PI;

    ctx.lineWidth = 14;
    ctx.strokeStyle = COLOR_ARC;
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, endA);
    ctx.stroke();

    const stops: ReadonlyArray<{ t: number; c: string }> = [
      { t: 0.0, c: COLOR_NEEDLE_BAD },
      { t: 0.3, c: COLOR_NEEDLE_WARN },
      { t: 0.5, c: COLOR_NEEDLE_GOOD },
      { t: 1.0, c: COLOR_NEEDLE_GOOD },
    ];
    const grad =
      typeof ctx.createConicGradient === 'function'
        ? ctx.createConicGradient(startA, cx, cy)
        : null;
    if (grad) {
      stops.forEach((s) => grad.addColorStop(s.t, s.c));
      ctx.lineWidth = 6;
      ctx.strokeStyle = grad;
    } else {
      ctx.lineWidth = 6;
      ctx.strokeStyle = COLOR_NEEDLE_GOOD;
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, startA, endA);
    ctx.stroke();

    const corr = Math.max(-1, Math.min(1, this.data.correlation || 0));
    const target = startA + ((corr + 1) / 2) * (endA - startA);
    // Bajo prefers-reduced-motion: snap (sin easing). Sino, easing suave.
    if (getPrefersReducedMotion()) {
      this._needleAngle = target;
    } else {
      this._needleAngle += (target - this._needleAngle) * 0.15;
    }
    const a = this._needleAngle;
    const nx = cx + Math.cos(a) * (r - 4);
    const ny = cy + Math.sin(a) * (r - 4);

    const ncol = colorForCorrelation(corr);
    ctx.lineCap = 'round';
    ctx.strokeStyle = ncol;
    ctx.shadowColor = ncol;
    ctx.shadowBlur = 10;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(nx, ny);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.fillStyle = ncol;
    ctx.beginPath();
    ctx.arc(cx, cy, 8, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLOR_TEXT;
    ctx.font = '700 26px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(corr.toFixed(2), cx, sz * 0.42);

    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.fillText('Pearson correlation', cx, sz * 0.42 + 22);

    ctx.font = '600 12px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textAlign = 'left';
    ctx.fillText('−1 anti-phase', cx - r, cy + 20);
    ctx.textAlign = 'right';
    ctx.fillText('+1 mono', cx + r, cy + 20);
    ctx.textAlign = 'center';

    const tickY = cy + 26;
    for (let i = -5; i <= 5; i++) {
      const tt = (i + 5) / 10;
      const tx = cx - r + tt * 2 * r;
      ctx.strokeStyle = COLOR_TICK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(tx, tickY);
      ctx.lineTo(tx, tickY + (i % 5 === 0 ? 8 : 4));
      ctx.stroke();
      if (i % 5 === 0) {
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '9px system-ui, -apple-system, sans-serif';
        ctx.fillText((i / 5).toFixed(1), tx, tickY + 16);
      }
    }

    const sliderY = sz - 18;
    const sliderW = sz - 40;
    const sliderX = 20;
    const wVal = Math.max(0, Math.min(2, this.data.width || 1));
    const wT = wVal / 2;

    ctx.fillStyle = 'rgba(147,164,255,0.18)';
    ctx.fillRect(sliderX, sliderY - 2, sliderW, 4);
    const fillW = sliderW * wT;
    const fillGrd = ctx.createLinearGradient(sliderX, 0, sliderX + fillW, 0);
    fillGrd.addColorStop(0, '#42e8ff');
    fillGrd.addColorStop(1, '#a78bff');
    ctx.fillStyle = fillGrd;
    ctx.fillRect(sliderX, sliderY - 2, fillW, 4);

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(sliderX + fillW, sliderY, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Width', sliderX, sliderY - 10);
    ctx.textAlign = 'right';
    ctx.fillText(`${Math.round(wVal * 100)}%`, sliderX + sliderW, sliderY - 10);
    ctx.textAlign = 'center';
  }
}

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.msImagerWidget = MsImagerWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['ms-imager'] = MsImagerWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Frontend-only: correlación M/S + width slider local, sin /dsp/*.
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
      rack.CATALOG['ms-imager']
    ) {
      const inst = rack.create({
        id: 'ms-imager',
        title: '📐 M/S Imager',
        widget: MsImagerWidget,
      });
      if (inst) {
        MsImagerWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['ms-imager'] = inst;
      }
    }
  } catch (e) {
    console.debug('[insert-migration] ms-imager', e);
  }
}
bootstrap();
