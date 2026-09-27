// reference-match.ts — pro widget

import { TOKEN_KEY } from '../../../core/api';
import {
  clamp,
  freqFromX,
  getPrefersReducedMotion,
  logFreq,
  safeApiBase,
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
const COLOR_TARGET = PALETTE?.accent ?? '#42e8ff';
const COLOR_CURRENT = PALETTE?.danger ?? '#ff5f72';
const COLOR_BAND = PALETTE?.warn ?? '#ffcc66';
const COLOR_TEXT = PALETTE?.text ?? '#f7f8ff';
const COLOR_MUTED = PALETTE?.muted ?? '#9ba6c4';

const FMIN = 20;
const FMAX = 20000;
const DMIN = -24;
const DMAX = 24;
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
export interface EqPoint { freq: number; db: number; }
export interface EqBand { freq: number; gain_db: number; }

export interface ReferenceMatchData {
  target: EqPoint[];
  current: EqPoint[];
  applied_eq_bands: EqBand[];
}

export interface ReferenceMatchOptions {
  onMatchRequest?: () => void;
}

interface HoverState { x: number; y: number; freq: number; }

interface PlotRect {
  left: number; right: number; top: number; bottom: number;
  width: number; height: number;
}

// ── Auth helper (manual fetch preserves 404 → DSP_UNAVAILABLE) ──
function getAuthToken(): string {
  try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; }
}

// ── Widget ─────────────────────────────────────────────────────
export class ReferenceMatchWidget {
  canvas: HTMLCanvasElement | null = null;
  ctx: CanvasRenderingContext2D | null = null;
  dpr = 1;
  cssWidth = 800;
  cssHeight = 400;
  data: ReferenceMatchData = { target: [], current: [], applied_eq_bands: [] };
  options: ReferenceMatchOptions = {};

  private _rafId = 0;
  private _lastFrame = 0;
  private _frameInterval = 1000 / 60;
  private _running = false;
  private _destroyed = false;
  private _hover: HoverState | null = null;
  private _ro: ResizeObserver | null = null;
  private _ac: AbortController | null = null;
  private _beforeUnload: (() => void) | null = null;

  static Insert?: unknown;

  constructor() { /* noop — stateful fields initialised above */ }

  init(canvas: HTMLCanvasElement, options: ReferenceMatchOptions = {}): void {
    if (!canvas) throw new Error('[referenceMatchWidget] canvas required');
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute('aria-label', 'Match EQ curve — clic en "Match EQ" para aplicar EQ de referencia');

    this._ac = new AbortController();
    const signal = this._ac.signal;

    this._size();
    this._bindResize(signal);
    this._bind(signal);
    this._render(); // static frame always (so reduced-motion users see the curve)
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
    this.cssHeight = Math.max(rect.height, 200);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.cssWidth * this.dpr);
    this.canvas.height = Math.floor(this.cssHeight * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  private _bind(signal: AbortSignal): void {
    if (!this.canvas) return;
    const onMove = (e: MouseEvent): void => {
      if (!this.canvas) return;
      const rect = this.canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      const r = this._plotRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) { this._hover = null; return; }
      this._hover = { x, y, freq: freqFromPx(x, r.left, r.width) };
    };
    const onLeave = (): void => { this._hover = null; };
    const onClick = (e: MouseEvent): void => {
      try {
        if (e.target instanceof HTMLElement && e.target.dataset.action === 'match') {
          this.options.onMatchRequest?.();
        }
      } catch (_) { /* noop */ }
    };
    this.canvas.addEventListener('mousemove', onMove, { signal });
    this.canvas.addEventListener('mouseleave', onLeave, { signal });
    this.canvas.addEventListener('click', onClick, { signal });
  }

  private _plotRect(): PlotRect {
    const left = 56;
    const right = this.cssWidth - 16;
    const top = 16;
    const bottom = this.cssHeight - 56;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  update(data: Partial<ReferenceMatchData> = {}): void {
    this.data = {
      target: data?.target ?? [],
      current: data?.current ?? [],
      applied_eq_bands: data?.applied_eq_bands ?? [],
    };
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

  private _drawCurve(
    ctx: CanvasRenderingContext2D,
    points: EqPoint[] | undefined,
    color: string,
    r: PlotRect,
    width = 2.0,
  ): void {
    if (!points || points.length < 2) return;
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    const sorted = points
      .filter((p): p is EqPoint => Number.isFinite(p.freq) && Number.isFinite(p.db))
      .slice()
      .sort((a, b) => a.freq - b.freq);
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

    this._drawCurve(ctx, this.data.target, COLOR_TARGET, r, 2.2);
    this._drawCurve(ctx, this.data.current, COLOR_CURRENT, r, 1.8);

    const bands = this.data.applied_eq_bands || [];
    bands.forEach((b) => {
      if (!b || !Number.isFinite(b.freq) || !Number.isFinite(b.gain_db)) return;
      const f = clamp(b.freq, FMIN, FMAX);
      const x = xFreq(f, r.left, r.width);
      const y0 = yDb(0, r.top, r.height);
      const y = yDb(clamp(b.gain_db, DMIN, DMAX), r.top, r.height);
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

  private _drawGrid(ctx: CanvasRenderingContext2D, r: PlotRect): void {
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textBaseline = 'middle';

    const yTicks = [-24, -18, -12, -6, 0, 6, 12, 18, 24];
    yTicks.forEach((db) => {
      const y = yDb(db, r.top, r.height);
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

  private _roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
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

  // ── Backend: `applied_eq_bands` via `X-Reference-Match` header ──
  static parseReferenceMatchHeader(res: Response): EqBand[] {
    const header = res.headers.get('X-Reference-Match') || res.headers.get('x-reference-match');
    if (!header) return [];
    try {
      const parsed: unknown = JSON.parse(header);
      if (Array.isArray(parsed)) return parsed as EqBand[];
      return [];
    } catch {
      return header.split(',').map((s) => {
        const parts = s.split(':').map(Number);
        return { freq: parts[0], gain_db: parts[1] } as EqBand;
      });
    }
  }

  static async fetchMatch(
    targetFile: Blob,
    referenceFile: Blob,
    opts: { match_amount?: number; smoothing?: number } = {},
  ): Promise<{ blob: Blob; applied_eq_bands: EqBand[] }> {
    const fd = new FormData();
    fd.append('target_file', targetFile);
    fd.append('reference_file', referenceFile);
    if (Number.isFinite(opts.match_amount)) fd.append('match_amount', String(opts.match_amount));
    if (Number.isFinite(opts.smoothing)) fd.append('smoothing', String(opts.smoothing));

    // Manual fetch (mirrors apiPostDsp) so 404 → DSP_UNAVAILABLE survives.
    // The typed `apiFetch`/`client.post` throw on !ok, which would mask 404.
    const apiBase = safeApiBase();
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiBase}/match-eq`, {
      method: 'POST',
      headers,
      body: fd,
    });
    if (res.status === 404) {
      const err = new Error('DSP endpoint /match-eq no disponible en este despliegue — se habilitará pronto') as Error & { code: string };
      err.code = 'DSP_UNAVAILABLE';
      throw err;
    }
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch { /* noop */ }
      throw new Error(`HTTP ${res.status}: ${errText || res.statusText}`);
    }
    const blob = await res.blob();
    const applied_eq_bands = ReferenceMatchWidget.parseReferenceMatchHeader(res);
    return { blob, applied_eq_bands };
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
  referenceMatchWidget?: typeof ReferenceMatchWidget;
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
    if (!rack || typeof rack.create !== 'function' || !rack.CATALOG || !rack.CATALOG['match-eq']) return;
    const inst = rack.create({
      id: 'match-eq',
      title: '🎚 Reference Match',
      endpoint: '/dsp/match-eq',
      widget: ReferenceMatchWidget,
    });
    if (inst) {
      ReferenceMatchWidget.Insert = inst;
      rack.registry = rack.registry || {};
      rack.registry['match-eq'] = inst;
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
    ns.proFeatures.widgets['reference-match'] = ReferenceMatchWidget;
    // Legacy camelCase key — 34-premium-suite reads `proFeatures.referenceMatchWidget`.
    ns.proFeatures.referenceMatchWidget = ReferenceMatchWidget;
    registerInRack();
  } catch (e) {
    _registered = false;
  }
}

bootstrap();
