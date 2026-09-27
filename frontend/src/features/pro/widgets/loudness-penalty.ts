// loudness-penalty.ts — pro widget

import { apiUrl, type ApiError } from '../../../core/api';
import { getPrefersReducedMotion } from '../../../core/utils';

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
const COLOR_GOOD = (PALETTE && PALETTE.good) || '#35f2a3';
const COLOR_WARN = (PALETTE && PALETTE.warn) || '#ffd84d';
const COLOR_BAD = (PALETTE && PALETTE.danger) || '#ff5f72';
const COLOR_ORIG = (PALETTE && PALETTE.accent) || '#42e8ff';
const COLOR_POST = (PALETTE && PALETTE.danger) || '#ff5f72';
const COLOR_TEXT = (PALETTE && PALETTE.text) || '#f7f8ff';
const COLOR_MUTED = (PALETTE && PALETTE.muted) || '#9ba6c4';
const COLOR_BG = 'rgba(13,16,32,0.6)';

function colorForPenalty(p: number): string {
  const v = Math.abs(p);
  if (v < 1) return COLOR_GOOD;
  if (v <= 2) return COLOR_WARN;
  return COLOR_BAD;
}

// ── Public state ──────────────────────────────────────────────
export interface LoudnessPenaltyPlatform {
  name: string;
  penalty_db: number;
  orig_lufs: number;
  post_lufs: number;
  unavailable?: boolean;
  reason?: string;
}

export interface LoudnessPenaltyState {
  platforms: LoudnessPenaltyPlatform[];
}

export type LoudnessPenaltyInitOptions = Partial<LoudnessPenaltyState>;

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
  loudnessPenaltyWidget?: unknown;
  widgets?: Record<string, unknown>;
}

interface LgmdmGlobal {
  proFeatures?: ProFeaturesNS;
  proInsertRack?: ProInsertRack;
  api?: {
    authHeaders?: (extra?: HeadersInit, method?: string) => Record<string, string>;
  };
}

function lg(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

function buildAuthHeaders(method: 'POST'): Record<string, string> {
  const api = lg().api;
  const headers: Record<string, string> =
    api && api.authHeaders ? api.authHeaders({}, method) : {};
  delete headers['Content-Type'];
  delete headers['content-type'];
  return headers;
}

// ── Widget ────────────────────────────────────────────────────
export class LoudnessPenaltyWidget {
  /** Insert instance (set by proInsertRack.create, MX-01). */
  static Insert: unknown = null;

  /** Active canvas (set by `init`). */
  canvas: HTMLCanvasElement | null = null;

  /** Public widget state — drives the badges + LUFS comparison bars. */
  state: LoudnessPenaltyState = { platforms: [] };

  private ctx: CanvasRenderingContext2D | null = null;
  private root: HTMLElement | null = null;
  private cssWidth = 0;
  private cssHeight = 0;
  private dpr = 1;
  private rafId: number | null = null;
  private hoverIdx = -1;
  private ac: AbortController | null = null;
  private _destroyed = false;

  /** Mapping plataformas → codec/bitrate del backend. */
  static PLATFORM_PARAMS: Record<string, { codec: string; bitrate: number }> = {
    Spotify: { codec: 'opus', bitrate: 96 },
    'Apple Music': { codec: 'aac', bitrate: 128 },
    YouTube: { codec: 'mp3', bitrate: 128 },
  };

  constructor() {
    // Fields initialised above; no base-class super() needed (standalone class).
  }

  init(canvas: HTMLCanvasElement | null, options?: LoudnessPenaltyInitOptions): void {
    this.canvas = canvas;
    if (!canvas) return;
    this.root = canvas.parentElement;
    this.ctx = canvas.getContext('2d');
    if (options && options.platforms) this.state.platforms = options.platforms;
    this._size();
    this._bindMouse();
    this._startRaf();

    window.addEventListener('beforeunload', () => this.teardown(), { once: true });
  }

  /**
   * Recorre las 3 plataformas de streaming y consulta `/loudness-penalty`
   * por cada una. Un 404 marca la plataforma como `unavailable` (el DSP aún
   * no está desplegado); otros errores caen a valores neutros.
   */
  static async fetchPlatforms(
    file: File,
    _token?: string,
  ): Promise<LoudnessPenaltyState> {
    const results: LoudnessPenaltyPlatform[] = [];
    for (const [name, p] of Object.entries(LoudnessPenaltyWidget.PLATFORM_PARAMS)) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('codec', p.codec);
      fd.append('bitrate', String(p.bitrate));
      try {
        const res = await fetch(apiUrl('/dsp/loudness-penalty'), {
          method: 'POST',
          body: fd,
          headers: buildAuthHeaders('POST'),
          credentials: 'include',
        });
        if (res.status === 404) {
          results.push({
            name,
            unavailable: true,
            reason: 'DSP endpoint no disponible — se habilitará pronto',
            penalty_db: 0,
            orig_lufs: -14,
            post_lufs: -14,
          });
        } else if (!res.ok) {
          // Non-404 error: surface as neutral values.
          results.push({ name, penalty_db: 0, orig_lufs: -14, post_lufs: -14 });
        } else {
          const data = (await res.json()) as {
            penalty_db?: number;
            X_Penalty_DB?: number;
            orig_lufs?: number;
            X_Orig_LUFS?: number;
            post_lufs?: number;
            X_Post_LUFS?: number;
          };
          results.push({
            name,
            penalty_db: data.penalty_db ?? data.X_Penalty_DB ?? 0,
            orig_lufs: data.orig_lufs ?? data.X_Orig_LUFS ?? -14,
            post_lufs: data.post_lufs ?? data.X_Post_LUFS ?? -14,
          });
        }
      } catch (err) {
        // `fetch`/parse failure (network, abort, 404-via-apiError). If the
        // wrapper translated a 404 into an ApiError, still mark unavailable.
        if (err && typeof err === 'object' && (err as ApiError).status === 404) {
          results.push({
            name,
            unavailable: true,
            reason: 'DSP endpoint no disponible — se habilitará pronto',
            penalty_db: 0,
            orig_lufs: -14,
            post_lufs: -14,
          });
        } else {
          results.push({ name, penalty_db: 0, orig_lufs: -14, post_lufs: -14 });
        }
      }
    }
    return { platforms: results };
  }

  update(data: Partial<LoudnessPenaltyState> | null): void {
    this.state = { platforms: (data && data.platforms) || [] };
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
    this.root = null;
    this.hoverIdx = -1;
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

  private _bindMouse(): void {
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
          const padX = 16;
          const padY = 14;
          const innerW = this.cssWidth - padX * 2;
          const colW = innerW / 3;
          const badgeY = padY + 4;
          const badgeH = 56;
          if (y >= badgeY && y <= badgeY + badgeH && this.state.platforms.length > 0) {
            const idx = Math.max(0, Math.min(2, Math.floor((x - padX) / colW)));
            this.hoverIdx = idx;
          } else {
            this.hoverIdx = -1;
          }
          // Repaint so hover updates even when the rAF loop is gated by
          // prefers-reduced-motion.
          this._render();
        } catch {
          /* defensive: swallow listener errors */
        }
      },
      { signal },
    );
    this.canvas.addEventListener(
      'mouseleave',
      () => {
        this.hoverIdx = -1;
        this._render();
      },
      { signal },
    );
  }

  private _startRaf(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (getPrefersReducedMotion()) {
      // Static single frame; further repaints driven by interaction/update.
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
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, w, h);

    const padX = 16;
    const padY = 14;
    const innerW = w - padX * 2;
    const colW = innerW / 3;

    const platforms = this.state.platforms;

    for (let i = 0; i < 3; i++) {
      const p: LoudnessPenaltyPlatform = platforms[i] || {
        name: ['Spotify', 'Apple Music', 'YouTube'][i] as string,
        penalty_db: 0,
        orig_lufs: -14,
        post_lufs: -14,
      };
      const x = padX + i * colW + 6;
      const y = padY + 4;
      const bw = colW - 12;
      const bh = 56;
      const color = colorForPenalty(p.penalty_db);
      const hovered = this.hoverIdx === i;

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
      const penaltyStr = `${p.penalty_db > 0 ? '+' : ''}${p.penalty_db.toFixed(1)} dB`;
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
      const p = platforms[this.hoverIdx >= 0 ? this.hoverIdx : 0];
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
      ctx.fillStyle = COLOR_ORIG;
      ctx.fillRect(legendX, compareY + 8, 8, 8);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('orig', legendX + 12, compareY + 8);
      ctx.fillStyle = COLOR_POST;
      ctx.fillRect(legendX, compareY + 24, 8, 8);
      ctx.fillStyle = COLOR_MUTED;
      ctx.fillText('post', legendX + 12, compareY + 24);
    }
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
LG.proFeatures.loudnessPenaltyWidget = LoudnessPenaltyWidget;
LG.proFeatures.widgets = LG.proFeatures.widgets || {};
LG.proFeatures.widgets['loudness-penalty'] = LoudnessPenaltyWidget;

// ── MX-01 — Migrate to Insert abstraction (HMR-safe) ─────────────
// CATALOG key = 'loudness-penalty' (entries vacío — backend infiere
// codec/bitrate desde los headers de la request). Backward-compat: si
// NS.create falla, la clase sigue funcionando standalone.
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
      rack.CATALOG['loudness-penalty']
    ) {
      const inst = rack.create({
        id: 'loudness-penalty',
        title: '🎧 Loudness Penalty',
        endpoint: '/dsp/loudness-penalty',
        widget: LoudnessPenaltyWidget,
      });
      if (inst) {
        LoudnessPenaltyWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['loudness-penalty'] = inst;
      }
    }
  } catch { /* insert-migration ya ejecutado */ }
}
bootstrap();
