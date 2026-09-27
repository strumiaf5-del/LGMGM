// spectral-tilt.ts — pro widget

import {
  clamp,
  freqFromX,
  getPrefersReducedMotion,
  logFreq,
  xFromFreq,
  yFromDb,
} from '../../../core/utils';

// ── Palette (theme-aware) ──────────────────────────────────────
interface ThemePalette {
  good: string;
  warn: string;
  danger: string;
  accent: string;
  text: string;
  muted: string;
  bg: string;
}

function resolvePalette(): ThemePalette | null {
  const w = window as Window & { LGMDM?: { themeColors?: () => ThemePalette | null } };
  const tc = w.LGMDM?.themeColors?.();
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
    bg: s.getPropertyValue('--ui-surface').trim() || '#0d1220',
  };
}

const PALETTE = resolvePalette();

const COLOR_BG = PALETTE?.bg ?? '#0d1020';
const COLOR_GRID = 'rgba(147,164,255,0.10)';
const COLOR_AXIS = 'rgba(147,164,255,0.35)';
const COLOR_TEXT = PALETTE?.text ?? '#f7f8ff';
const COLOR_MUTED = PALETTE?.muted ?? '#9ba6c4';
const COLOR_TARGET = PALETTE?.accent ?? '#42e8ff';
const COLOR_CURRENT = PALETTE?.warn ?? '#ff9f43';
const COLOR_PIVOT = PALETTE?.warn ?? '#ffcc66';

const FMIN = 20;
const FMAX = 20000;
const DMIN = -12;
const DMAX = 12;
const LOG_FMIN = logFreq(FMIN);
const LOG_FMAX = logFreq(FMAX);

function xFreq(f: number, left: number, width: number): number {
  return xFromFreq(f, left, width, LOG_FMIN, LOG_FMAX);
}
function yDb(db: number, top: number, height: number): number {
  return yFromDb(db, top, height, DMIN, DMAX);
}
function freqFromPx(x: number, left: number, width: number): number {
  return freqFromX(x, left, width, LOG_FMIN, LOG_FMAX);
}

// ── Types ──────────────────────────────────────────────────────
export interface SpectralTiltData {
  tilt_db: number;
  pivot_hz: number;
  current_spectrum: SpectralPoint[];
}
export interface SpectralPoint { freq: number; db: number; }

export interface SpectralTiltOptions {
  onPivotChange?: (hz: number) => void;
}

interface HoverState { x: number; y: number; freq: number; }

interface PlotRect {
  left: number; right: number; top: number; bottom: number;
  width: number; height: number;
}

// ── Widget ─────────────────────────────────────────────────────
export class SpectralTiltWidget {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  dpr = 1;
  cssWidth = 800;
  cssHeight = 400;
  data: SpectralTiltData = { tilt_db: 3, pivot_hz: 1000, current_spectrum: [] };
  options: SpectralTiltOptions = {};

  private _rafId = 0;
  private _lastFrame = 0;
  private _frameInterval = 1000 / 60;
  private _running = false;
  private _destroyed = false;
  private _hover: HoverState | null = null;
  private _ro: ResizeObserver | null = null;
  private _ac: AbortController | null = null;
  private _beforeUnload: (() => void) | null = null;
  private _draggingPivot = false; // FIX cleanup: este campo SÍ se usa (líneas 241, 247) — el comentario 'vestigial' era incorrecto.

  static Insert?: unknown;

  constructor() { /* noop */ }

  init(canvas: HTMLCanvasElement, options: SpectralTiltOptions = {}): void {
    if (!canvas) throw new Error('[spectralTiltWidget] canvas required');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};

    this._ac = new AbortController();
    const signal = this._ac.signal;

    this._size();
    this._bindResize(signal);
    this._bind(signal);
    this._updateAria();
    this._render(); // static frame always
    this._running = true;
    if (!getPrefersReducedMotion()) {
      this._tick(performance.now());
    }

    this._beforeUnload = () => { try { this.teardown(); } catch (_) { /* noop */ } };
    window.addEventListener('beforeunload', this._beforeUnload, { once: true, signal });
  }

  private _bindResize(signal: AbortSignal): void {
    if (typeof ResizeObserver === 'undefined' || !this.canvas) return;
    this._ro = new ResizeObserver(() => this._size());
    this._ro.observe(this.canvas);
    signal.addEventListener('abort', () => {
      try { this._ro?.disconnect(); } catch (_) { /* noop */ }
      this._ro = null;
    });
  }

  private _size(): void {
    if (!this.canvas || !this.ctx) return;
    const rect = this.canvas.getBoundingClientRect();
    this.cssWidth = Math.max(rect.width, 320);
    this.cssHeight = Math.max(rect.height, 180);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.cssWidth * this.dpr);
    this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private _bind(signal: AbortSignal): void {
    if (!this.canvas) return;
    const onMove = (e: MouseEvent): void => this._onMouseMove(e);
    const onLeave = (): void => { this._hover = null; };
    const onDown = (e: MouseEvent): void => this._onClick(e);
    const onKey = (e: KeyboardEvent): void => this._onKeydown(e);
    this.canvas.addEventListener('mousemove', onMove, { signal });
    this.canvas.addEventListener('mouseleave', onLeave, { signal });
    this.canvas.addEventListener('mousedown', onDown, { signal });
    this.canvas.addEventListener('keydown', onKey, { signal });
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'slider');
    this.canvas.setAttribute('aria-label', 'Pivote del tilt espectral (Hz)');
  }

  private _updateAria(): void {
    if (!this.canvas) return;
    this.canvas.setAttribute('aria-valuemin', String(FMIN));
    this.canvas.setAttribute('aria-valuemax', String(FMAX));
    this.canvas.setAttribute('aria-valuenow', String(Math.round(this.data.pivot_hz)));
    this.canvas.setAttribute('aria-valuetext', `${Math.round(this.data.pivot_hz)} Hz`);
  }

  private _onKeydown(e: KeyboardEvent): void {
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
      this.options.onPivotChange?.(this.data.pivot_hz);
      e.preventDefault();
      return;
    } else if (e.key === 'End') {
      this.data.pivot_hz = FMAX;
      this._updateAria();
      this.options.onPivotChange?.(this.data.pivot_hz);
      e.preventDefault();
      return;
    } else {
      return;
    }
    e.preventDefault();
    const currentLog = Math.log10(this.data.pivot_hz);
    const nextLog = clamp(currentLog + delta, 0, range);
    this.data.pivot_hz = Math.pow(10, nextLog);
    this._updateAria();
    this.options.onPivotChange?.(this.data.pivot_hz);
  }

  private _plotRect(): PlotRect {
    const left = 56;
    const right = this.cssWidth - 16;
    const top = 16;
    const bottom = this.cssHeight - 38;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  private _onMouseMove(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = this._plotRect();
    if (x < r.left || x > r.right || y < r.top || y > r.bottom) {
      this._hover = null;
      return;
    }
    this._hover = { x, y, freq: freqFromPx(x, r.left, r.width) };
  }

  private _onClick(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const r = this._plotRect();
    const px = xFreq(this.data.pivot_hz, r.left, r.width);
    const py = yDb(0, r.top, r.height);
    if (Math.hypot(x - px, y - py) < 18) {
      this._draggingPivot = true;
    } else if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      const newPivot = freqFromPx(x, r.left, r.width);
      this.data.pivot_hz = clamp(newPivot, FMIN, FMAX);
      this.options.onPivotChange?.(this.data.pivot_hz);
    }
    this._draggingPivot = false;
  }

  update(data: Partial<SpectralTiltData> = {}): void {
    this.data = {
      tilt_db: data?.tilt_db ?? 3,
      pivot_hz: data?.pivot_hz ?? 1000,
      current_spectrum: data?.current_spectrum ?? [],
    };
    this._updateAria();
    if (this._destroyed) return;
    this._render();
  }

  resize(): void { this._size(); this._render(); }

  destroy(): void { this.teardown(); }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    this._running = false;
    if (this._rafId) { cancelAnimationFrame(this._rafId); this._rafId = 0; }
    try { this._ac?.abort(); } catch (_) { /* noop */ }
    this._ac = null;
    this._ro = null;
    this._beforeUnload = null;
    this._hover = null;
    this.canvas = null;
    this.ctx = null;
  }

  private _tick(now: number): void {
    if (this._destroyed || !this._running) return;
    if (getPrefersReducedMotion()) return;
    if (now - this._lastFrame < this._frameInterval) {
      this._rafId = requestAnimationFrame((t) => this._tick(t));
      return;
    }
    this._lastFrame = now;
    this._render();
    this._rafId = requestAnimationFrame((t) => this._tick(t));
  }

  private _render(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const w = this.cssWidth;
    const h = this.cssHeight;
    const r = this._plotRect();
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    this._drawGrid(ctx, r);

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
      const db = clamp(-logRatio * shelf, DMIN, DMAX);
      const x = xFreq(f, r.left, r.width);
      const y = yDb(db, r.top, r.height);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    const cur = (this.data.current_spectrum || [])
      .filter((p) => Number.isFinite(p.freq) && Number.isFinite(p.db));
    if (cur.length > 1) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = COLOR_CURRENT;
      ctx.shadowColor = COLOR_CURRENT;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      const sorted = cur.slice().sort((a, b) => a.freq - b.freq);
      for (let i = 0; i < sorted.length; i++) {
        const f = clamp(sorted[i].freq, FMIN, FMAX);
        const db = clamp(sorted[i].db, DMIN, DMAX);
        const x = xFreq(f, r.left, r.width);
        const y = yDb(db, r.top, r.height);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    const px = xFreq(pivotF, r.left, r.width);
    const py = yDb(0, r.top, r.height);
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

    this._drawLegend(ctx, r);

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

  private _drawGrid(ctx: CanvasRenderingContext2D, r: PlotRect): void {
    ctx.strokeStyle = COLOR_GRID;
    ctx.lineWidth = 1;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textBaseline = 'middle';

    const yTicks = [-12, -6, 0, 6, 12];
    yTicks.forEach((db) => {
      const y = yDb(db, r.top, r.height);
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
      const x = xFreq(f, r.left, r.width);
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

  private _drawLegend(ctx: CanvasRenderingContext2D, r: PlotRect): void {
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
    ctx.fillText(
      `Pivot ${this.data.pivot_hz.toFixed(0)} Hz · Tilt ${(this.data.tilt_db > 0 ? '+' : '') + this.data.tilt_db.toFixed(1)} dB`,
      x + 16,
      y - 3,
    );
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
  spectralTiltWidget?: typeof SpectralTiltWidget;
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
    if (!rack || typeof rack.create !== 'function' || !rack.CATALOG || !rack.CATALOG['spectral-tilt']) return;
    const inst = rack.create({
      id: 'spectral-tilt',
      title: '📈 Spectral Tilt',
      endpoint: '/dsp/spectral-tilt',
      widget: SpectralTiltWidget,
    });
    if (inst) {
      SpectralTiltWidget.Insert = inst;
      rack.registry = rack.registry || {};
      rack.registry['spectral-tilt'] = inst;
    }
  } catch { /* insert-migration ya ejecutado */ }
}

let _registered = false;
function bootstrap(): void {
  if (_registered) return;
  _registered = true;
  try {
    const ns = ensureLgmdm();
    ns.proFeatures = ns.proFeatures || ({} as ProFeaturesNs);
    ns.proFeatures.widgets = ns.proFeatures.widgets || {};
    ns.proFeatures.widgets['spectral-tilt'] = SpectralTiltWidget;
    // Legacy camelCase key — 34-premium-suite reads `proFeatures.spectralTiltWidget`.
    ns.proFeatures.spectralTiltWidget = SpectralTiltWidget;
    registerInRack();
  } catch (e) {
    _registered = false;
  }
}

bootstrap();
