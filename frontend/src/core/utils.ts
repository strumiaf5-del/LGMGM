// utils.ts — math + canvas helpers
// `safeApiBase()` reads API_BASE from ./api-config; prefersReducedMotion is cached.
import { API_BASE } from './api-config';

// ── Math helpers ─────────────────────────────────────────────

/** Clamp numérico con fallback seguro. */
export function clamp(n: number, lo: number, hi: number): number {
  const v = Number(n);
  if (!Number.isFinite(v)) return lo;
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/** Clamp específico para rango [0, 1]. */
export function clamp01(v: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

/** Escala logarítmica para frecuencia audible (Hz → log10). */
export function logFreq(f: number): number {
  return Math.log10(Math.max(1, f));
}

/**
 * Convierte Hz → coordenada X en un canvas (escala log).
 * @param f        - Frecuencia en Hz
 * @param left     - Coordenada X inicial del área de dibujo
 * @param width    - Ancho del área de dibujo
 * @param LOG_FMIN - log10(FMIN)
 * @param LOG_FMAX - log10(FMAX)
 */
export function xFromFreq(
  f: number,
  left: number,
  width: number,
  LOG_FMIN: number,
  LOG_FMAX: number,
): number {
  const t = (logFreq(f) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN);
  return left + t * width;
}

/** Convierte X → Hz (inversa de xFromFreq). */
export function freqFromX(
  x: number,
  left: number,
  width: number,
  LOG_FMIN: number,
  LOG_FMAX: number,
): number {
  const t = (x - left) / width;
  return Math.pow(10, LOG_FMIN + t * (LOG_FMAX - LOG_FMIN));
}

/**
 * Convierte dB → coordenada Y en un canvas.
 * @param db     - Valor en dB
 * @param top    - Coordenada Y inicial del área de dibujo
 * @param height - Alto del área de dibujo
 * @param DMIN   - dB mínimo (e.g., -80)
 * @param DMAX   - dB máximo (e.g., 0)
 */
export function yFromDb(
  db: number,
  top: number,
  height: number,
  DMIN: number,
  DMAX: number,
): number {
  const t = (db - DMIN) / (DMAX - DMIN);
  return top + (1 - t) * height;
}

// ── API base ──────────────────────────────────────────────────

/**
 * Devuelve la base de la API. En TS+Vite se sirve de `API_BASE`
 * (./api-config), que ya resuelve el override manual, el dev fallback
 * (`http://127.0.0.1:8000`) y el reverse-proxy de producción (relativo).
 *
 * Se conserva el nombre `safeApiBase` por compatibilidad con widgets legacy
 * que invocan `window.safeApiBase()` / `LGMDM.utils.safeApiBase()`.
 */
export function safeApiBase(): string {
  return API_BASE;
}

// ── prefers-reduced-motion (cached) ───────────────────────────

let reducedMotionCache = false;

if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reducedMotionCache = mq.matches;
  // Keep the cache in sync if the user toggles the preference at runtime.
  mq.addEventListener('change', (e: MediaQueryListEvent) => {
    reducedMotionCache = e.matches;
  });
}

/**
 * Valor cacheado de `prefers-reduced-motion: reduce`.
 * No invoca `matchMedia` en cada llamada — seguro para hot loops (rAF).
 */
export function getPrefersReducedMotion(): boolean {
  return reducedMotionCache;
}

/**
 * Alias legacy de `getPrefersReducedMotion()`. Devuelve el cache.
 * Honra la preferencia de accesibilidad WCAG 2.3.3 / WIG §2.5.
 */
export function prefersReducedMotion(): boolean {
  return reducedMotionCache;
}

// ── Canvas resize (DPR-aware ResizeObserver) ──────────────────

/**
 * `setupCanvasResize(canvas, onResize)` — ResizeObserver con soporte de DPR.
 *
 * Ajusta el buffer interno del canvas (canvas.width/height) cuando el CSS
 * cambia su tamaño visible. Llama `onResize(w, h, dpr)` para que el
 * consumidor pueda redibujar con las nuevas dimensiones.
 *
 * Devuelve una función `cleanup()` idempotente que aborta el controller,
 * desconecta el observer y cancela el rAF pendiente. Llamarla 2× (o llamar a
 * setup varias veces y limpiar cada instancia) no acumula observers.
 */
export function setupCanvasResize(
  canvas: HTMLCanvasElement | null,
  onResize: (w: number, h: number, dpr: number) => void,
): () => void {
  if (!canvas || typeof ResizeObserver === 'undefined') return () => {};

  const ac = new AbortController();
  let raf = 0;
  let disposed = false;

  const apply = (): void => {
    if (disposed) return;
    raf = 0;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    try {
      onResize(w, h, dpr);
    } catch {
      // Swallow consumer errors so a bad redraw doesn't break resize.
    }
  };

  const ro = new ResizeObserver(() => {
    if (disposed || raf) return;
    raf = requestAnimationFrame(apply);
  });
  ro.observe(canvas);
  // Initial sizing — do not wait for the first resize event.
  apply();

  // Single disposal path: aborting the controller tears down the observer
  // and cancels any pending rAF. This coordinates RAF + ResizeObserver
  // through one signal.
  ac.signal.addEventListener('abort', () => {
    disposed = true;
    ro.disconnect();
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });

  return () => {
    if (disposed) return;
    ac.abort();
  };
}

// ── Namespace `LGMDM.utils` (legacy compat) ───────────────────
// Same pattern as master-console.ts: read window.LGMDM, create if missing,
// attach `.utils`. Typed via a local LgmdmGlobal slice.

const utilsNamespace = Object.freeze({
  clamp,
  clamp01,
  logFreq,
  xFromFreq,
  freqFromX,
  yFromDb,
  safeApiBase,
  prefersReducedMotion,
  getPrefersReducedMotion,
  setupCanvasResize,
});

interface LgmdmUtilsGlobal {
  utils?: typeof utilsNamespace;
}

const lg = (window as Window & { LGMDM?: LgmdmUtilsGlobal }).LGMDM || {};
(window as Window & { LGMDM?: LgmdmUtilsGlobal }).LGMDM = lg;
lg.utils = utilsNamespace;

// ── Bare global aliases (legacy compat, type-safe) ───────────

declare global {
  interface Window {
    clamp: typeof clamp;
    clamp01: typeof clamp01;
    logFreq: typeof logFreq;
    xFromFreq: typeof xFromFreq;
    freqFromX: typeof freqFromX;
    yFromDb: typeof yFromDb;
    safeApiBase: typeof safeApiBase;
    prefersReducedMotion: typeof prefersReducedMotion;
    getPrefersReducedMotion: typeof getPrefersReducedMotion;
    setupCanvasResize: typeof setupCanvasResize;
  }
}

window.clamp = clamp;
window.clamp01 = clamp01;
window.logFreq = logFreq;
window.xFromFreq = xFromFreq;
window.freqFromX = freqFromX;
window.yFromDb = yFromDb;
window.safeApiBase = safeApiBase;
window.prefersReducedMotion = prefersReducedMotion;
window.getPrefersReducedMotion = getPrefersReducedMotion;
window.setupCanvasResize = setupCanvasResize;
