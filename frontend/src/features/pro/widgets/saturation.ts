// saturation.ts — pro widget. Port of aporte/js/pro-features/saturation-widget.js.

import { xFromFreq, yFromDb, logFreq, getPrefersReducedMotion } from '../../../core/utils';

// ── Theme palette (themeColors() global with CSS-var fallback) ──
interface ThemePalette {
  good: string;
  warn: string;
  danger: string;
  accent: string;
  text: string;
  muted: string;
  bg: string;
}

function readPalette(): ThemePalette | null {
  const tc = (window as Window & { LGMDM?: { themeColors?: () => ThemePalette | null } })
    .LGMDM?.themeColors?.();
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

const PALETTE = readPalette();
const COLOR_BG = (PALETTE && PALETTE.bg) || '#0d1020';
const COLOR_GRID = 'rgba(147,164,255,0.10)';
const COLOR_AXIS = 'rgba(147,164,255,0.35)';
const COLOR_ORIG = (PALETTE && PALETTE.muted) || '#9ba6c4';
const COLOR_SAT = (PALETTE && PALETTE.danger) || '#ff5f72';
const COLOR_HARM = (PALETTE && PALETTE.warn) || '#ffcc66';
const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
const COLOR_PILL_BG = 'rgba(255,255,255,0.04)';
const COLOR_PILL_ACTIVE = 'rgba(92,232,255,0.18)';

const FMIN = 20;
const FMAX = 20000;
const DMIN = -60;
const DMAX = 0;

const LOG_FMIN = logFreq(FMIN);
const LOG_FMAX = logFreq(FMAX);

function _xFreq(f: number, left: number, width: number): number {
  return xFromFreq(f, left, width, LOG_FMIN, LOG_FMAX);
}
function _yDb(db: number, top: number, height: number): number {
  return yFromDb(db, top, height, DMIN, DMAX);
}

// ── Public state ──────────────────────────────────────────────
export interface SaturationSpectrumPoint {
  freq: number;
  db: number;
}

export type SaturationCurveType = 'I' | 'II' | 'III';

export interface SaturationState {
  drive: number;
  type: SaturationCurveType;
  orig_spectrum: SaturationSpectrumPoint[];
  saturated_spectrum: SaturationSpectrumPoint[];
  harmonics_added_db: number[];
  mix?: number;
}

export type SaturationInitOptions = Partial<SaturationState> & {
  onTypeChange?: (t: SaturationCurveType) => void;
  onDriveChange?: (drive: number) => void;
};

// ── Rack + LGMDM typing (minimal slice) ───────────────────────
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
  saturationWidget?: unknown;
  widgets?: Record<string, unknown>;
}
interface LgmdmGlobal {
  proFeatures?: ProFeaturesNS;
  proInsertRack?: ProInsertRack;
}

// ── Widget ────────────────────────────────────────────────────
export class SaturationWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  canvas: HTMLCanvasElement | null = null;

  /** Public widget state — drive, curve type, spectra, harmonics. */
  state: SaturationState = {
    drive: 50,
    type: 'II',
    orig_spectrum: [],
    saturated_spectrum: [],
    harmonics_added_db: [0, 0, 0],
  };

  /** Mapping I/II/III (UI Softube-style) → sigmoid/tanh/chebyshev (backend). */
  static CURVE_MAP: Record<SaturationCurveType, string> = {
    I: 'sigmoid',
    II: 'tanh',
    III: 'chebyshev',
  };

  private ctx: CanvasRenderingContext2D | null = null;
  private cssWidth = 800;
  private cssHeight = 400;
  private dpr = 1;
  private rafId: number | null = null;
  private hover: { x: number; y: number } | null = null;
  private ac: AbortController | null = null;
  private options: SaturationInitOptions = {};
  private _destroyed = false;

  constructor() {
    // Standalone class; fields initialised above.
  }

  static toBackendCurve(typeUI: string): string {
    return SaturationWidget.CURVE_MAP[typeUI as SaturationCurveType] || 'sigmoid';
  }

  static toBackendParams(data: { drive?: number; mix?: number; type?: string }): {
    drive: number;
    mix: number;
    curve: string;
  } {
    return {
      drive: (data.drive || 0) / 100,
      mix: data.mix != null ? data.mix : 1.0,
      curve: SaturationWidget.toBackendCurve(data.type || ''),
    };
  }

  init(canvas: HTMLCanvasElement | null, options?: SaturationInitOptions): void {
    this.canvas = canvas;
    if (!canvas) return;
    this.ctx = canvas.getContext('2d');
    this.options = options || {};
    this._size();
    canvas.setAttribute('tabindex', '0');
    canvas.setAttribute('role', 'application');
    canvas.setAttribute(
      'aria-label',
      'Saturation spectrum — clic para ajustar drive o cambiar tipo de curva (I/II/III)',
    );
    this._bindEvents();
    this._startRaf();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  update(data: Partial<SaturationState> | null): void {
    const defaults: SaturationState = {
      drive: 50,
      type: 'II',
      orig_spectrum: [],
      saturated_spectrum: [],
      harmonics_added_db: [0, 0, 0],
    };
    this.state = { ...defaults, ...(data || {}) };
    this._render();
  }

  resize(): void {
    this._size();
    this._render();
  }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.ac) {
      try { this.ac.abort(); } catch { /* ignore */ }
      this.ac = null;
    }
    this.canvas = null;
    this.ctx = null;
    this.hover = null;
  }

  /** Alias kept for legacy callers (premium-suite.teardownProFeatures). */
  destroy(): void {
    this.teardown();
  }

  // ── internals ───────────────────────────────────────────────
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

  private _plotRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number } {
    const left = 56;
    const right = this.cssWidth - 16;
    const top = 16;
    const bottom = this.cssHeight - 70;
    return { left, right, top, bottom, width: right - left, height: bottom - top };
  }

  private _bindEvents(): void {
    if (!this.canvas) return;
    this.ac = new AbortController();
    const signal = this.ac.signal;
    this.canvas.addEventListener(
      'mousemove',
      (e: MouseEvent) => {
        try {
          if (!this.canvas) return;
          const rect = this.canvas.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          const r = this._plotRect();
          this.hover =
            x < r.left || x > r.right || y < r.top || y > r.bottom ? null : { x, y };
          this._render();
        } catch {
          /* defensive */
        }
      },
      { signal },
    );
    this.canvas.addEventListener(
      'mouseleave',
      () => {
        this.hover = null;
        this._render();
      },
      { signal },
    );
    this.canvas.addEventListener(
      'click',
      (e: MouseEvent) => {
        try {
          this._handleClick(e);
        } catch {
          /* defensive */
        }
      },
      { signal },
    );
  }

  private _handleClick(e: MouseEvent): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const segY = this.cssHeight - 50;
    const segX = this.cssWidth - 200;
    const segW = 56;
    const segH = 24;
    const types: SaturationCurveType[] = ['I', 'II', 'III'];
    types.forEach((t, i) => {
      const tx = segX + i * (segW + 6);
      if (x >= tx && x <= tx + segW && y >= segY && y <= segY + segH) {
        this.state.type = t;
        if (this.options.onTypeChange) this.options.onTypeChange(t);
      }
    });
    const slX = 70;
    const slY = this.cssHeight - 50;
    const slW = 240;
    const slH = 14;
    if (x >= slX && x <= slX + slW && y >= slY - 8 && y <= slY + slH + 8) {
      const drive = Math.round(((x - slX) / slW) * 100);
      this.state.drive = Math.max(0, Math.min(100, drive));
      if (this.options.onDriveChange) this.options.onDriveChange(this.state.drive);
    }
    this._render();
  }

  private _startRaf(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (getPrefersReducedMotion()) {
      this._render();
      return;
    }
    const loop = (): void => {
      this.rafId = requestAnimationFrame(loop);
      this._render();
    };
    this.rafId = requestAnimationFrame(loop);
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
    this._drawGrid(r);

    const drawCurve = (
      points: SaturationSpectrumPoint[] | undefined,
      color: string,
      width: number,
      alpha = 1,
    ): void => {
      if (!points || points.length < 2) return;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.shadowColor = color;
      ctx.shadowBlur = 5;
      ctx.beginPath();
      const sorted = points
        .filter((p) => p && isFinite(p.freq) && isFinite(p.db))
        .slice()
        .sort((a, b) => a.freq - b.freq);
      for (let i = 0; i < sorted.length; i++) {
        const f = Math.max(FMIN, Math.min(FMAX, sorted[i].freq));
        const db = Math.max(DMIN, Math.min(DMAX, sorted[i].db));
        const x = _xFreq(f, r.left, r.width);
        const y = _yDb(db, r.top, r.height);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.globalAlpha = 1;
    };

    drawCurve(this.state.orig_spectrum, COLOR_ORIG, 1.4, 0.6);
    drawCurve(this.state.saturated_spectrum, COLOR_SAT, 2.0, 1.0);

    const harmonics = this.state.harmonics_added_db || [];
    const baseF = this._detectFundamental(this.state.orig_spectrum);
    if (baseF > 0) {
      for (let n = 2; n <= 4; n++) {
        const f = baseF * n;
        if (f < FMIN || f > FMAX) continue;
        const x = _xFreq(f, r.left, r.width);
        const gain = harmonics[n - 2] || 0;
        const yT = _yDb(-10 + gain * 4, r.top, r.height);
        ctx.strokeStyle = COLOR_HARM;
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x, r.top);
        ctx.lineTo(x, r.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = COLOR_HARM;
        ctx.beginPath();
        ctx.arc(x, yT, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = COLOR_MUTED;
        ctx.font = '10px system-ui, -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(`${n}nd harmonic +${gain.toFixed(1)}dB`, x, Math.max(r.top + 10, yT - 12));
        ctx.textAlign = 'left';
      }
    }

    this._drawControls();
  }

  private _detectFundamental(spec: SaturationSpectrumPoint[] | undefined): number {
    if (!spec || spec.length === 0) return 0;
    let best: SaturationSpectrumPoint = spec[0];
    spec.forEach((p) => {
      if (isFinite(p.db) && p.db > best.db) best = p;
    });
    return Math.max(1, best.freq || 0);
  }

  private _drawGrid(r: { left: number; right: number; top: number; bottom: number; width: number; height: number }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = COLOR_MUTED;
    ctx.textBaseline = 'middle';

    const yTicks = [-60, -48, -36, -24, -12, 0];
    yTicks.forEach((db) => {
      const y = _yDb(db, r.top, r.height);
      ctx.strokeStyle = db === 0 ? COLOR_AXIS : COLOR_GRID;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(r.left, y);
      ctx.lineTo(r.right, y);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(db + ' dB', r.left - 6, y);
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
      const label = f >= 1000 ? f / 1000 + 'k' : String(f);
      ctx.fillText(label, x, r.bottom + 6);
    });

    ctx.textAlign = 'left';
  }

  private _drawControls(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const y = this.cssHeight - 50;

    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('Drive', 16, y + 7);
    ctx.fillText('Type', this.cssWidth - 250, y + 7);

    const slX = 70;
    const slW = 240;
    ctx.fillStyle = 'rgba(147,164,255,0.18)';
    ctx.fillRect(slX, y, slW, 8);
    const driveVal = Math.max(0, Math.min(100, this.state.drive || 0));
    const driveW = (driveVal / 100) * slW;
    const grd = ctx.createLinearGradient(slX, 0, slX + driveW, 0);
    grd.addColorStop(0, '#42e8ff');
    grd.addColorStop(1, '#ff5f72');
    ctx.fillStyle = grd;
    ctx.fillRect(slX, y, driveW, 8);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(slX + driveW, y + 4, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_TEXT;
    ctx.font = '700 12px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(driveVal + '%', slX + slW + 10, y + 4);

    const segX = this.cssWidth - 200;
    const segW = 56;
    const segH = 24;
    (['I', 'II', 'III'] as SaturationCurveType[]).forEach((t, i) => {
      const tx = segX + i * (segW + 6);
      const active = this.state.type === t;
      ctx.fillStyle = active ? COLOR_PILL_ACTIVE : COLOR_PILL_BG;
      ctx.strokeStyle = active ? 'rgba(92,232,255,0.55)' : 'rgba(255,255,255,0.10)';
      ctx.lineWidth = 1;
      this._roundRect(ctx, tx, y - 6, segW, segH, 8);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? '#dffcff' : COLOR_MUTED;
      ctx.font = '700 12px system-ui, -apple-system, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(t, tx + segW / 2, y + 6);
    });

    ctx.fillStyle = COLOR_MUTED;
    ctx.font = '10px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Drive ${driveVal}% · Curve type ${this.state.type}`, 16, y + 24);
    let lx = this.cssWidth / 2;
    ctx.fillStyle = COLOR_ORIG;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(lx, y + 20, 12, 3);
    ctx.globalAlpha = 1;
    ctx.fillStyle = COLOR_MUTED;
    ctx.fillText('Original', lx + 16, y + 22);
    lx += 86;
    ctx.fillStyle = COLOR_SAT;
    ctx.fillRect(lx, y + 20, 12, 3);
    ctx.fillStyle = COLOR_MUTED;
    ctx.fillText('Saturated', lx + 16, y + 22);
    lx += 86;
    ctx.fillStyle = COLOR_HARM;
    ctx.beginPath();
    ctx.arc(lx + 6, y + 22, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = COLOR_MUTED;
    ctx.fillText('Harmonics', lx + 16, y + 22);
  }

  private _roundRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void {
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

// ── Registration on the LGMDM namespace (legacy compat) ──────────
const win = window as Window & { LGMDM?: LgmdmGlobal };
const LG = win.LGMDM = win.LGMDM || {};
LG.proFeatures = LG.proFeatures || {};
LG.proFeatures.saturationWidget = SaturationWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['saturation'] = SaturationWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// Mapea al CATALOG key 'inflator' (la UI usa I/II/III; el backend recibe
// sigmoid/tanh/chebyshev — el mapping vive en SaturationWidget.CURVE_MAP).
// Backward-compat: si rack.create falla, la clase sigue funcionando standalone.
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
      rack.CATALOG['inflator']
    ) {
      const inst = rack.create({
        id: 'inflator',
        title: 'Saturation',
        endpoint: '/dsp/inflator',
        widget: SaturationWidget,
      });
      if (inst) {
        SaturationWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['inflator'] = inst;
      }
    }
  } catch (e) {
    console.debug('[insert-migration] saturation', e);
  }
}
bootstrap();
