// ============================================================
// 00-utils.js — Funciones matemáticas compartidas entre widgets
// ============================================================
// Fuente autoritativa para: clamp, clamp01, logFreq, xFromFreq,
// yFromDb, freqFromX. Cualquier widget debe consumir
// LGMDM.utils.* o los aliases globales window.* (ver final).

(function () {
  "use strict";

  /** Clamp numérico con fallback seguro. */
  function clamp(n, lo, hi) {
    n = Number(n);
    if (!Number.isFinite(n)) return lo;
    if (n < lo) return lo;
    if (n > hi) return hi;
    return n;
  }

  /** Clamp específico para rango [0, 1]. */
  function clamp01(v) {
    return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
  }

  /** Escala logarítmica para frecuencia audible (Hz → log10). */
  function logFreq(f) {
    return Math.log10(Math.max(1, f));
  }

  /** Convierte Hz → coordenada X en un canvas (rango log).
   *  @param {number} f  - Frecuencia en Hz
   *  @param {number} left - Coordenada X inicial del área de dibujo
   *  @param {number} width - Ancho del área de dibujo
   *  @param {number} LOG_FMIN - log10(FMIN)
   *  @param {number} LOG_FMAX - log10(FMAX)
   */
  function xFromFreq(f, left, width, LOG_FMIN, LOG_FMAX) {
    const t = (logFreq(f) - LOG_FMIN) / (LOG_FMAX - LOG_FMIN);
    return left + t * width;
  }

  /** Convierte X → Hz (inversa de xFromFreq). */
  function freqFromX(x, left, width, LOG_FMIN, LOG_FMAX) {
    const t = (x - left) / width;
    return Math.pow(10, LOG_FMIN + t * (LOG_FMAX - LOG_FMIN));
  }

  /** Convierte dB → coordenada Y en un canvas.
   *  @param {number} db - Valor en dB
   *  @param {number} top - Coordenada Y inicial del área de dibujo
   *  @param {number} height - Alto del área de dibujo
   *  @param {number} DMIN - dB mínimo (e.g., -80)
   *  @param {number} DMAX - dB máximo (e.g., 0)
   */
  function yFromDb(db, top, height, DMIN, DMAX) {
    const t = (db - DMIN) / (DMAX - DMIN);
    return top + (1 - t) * height;
  }

  /** Acceso defensivo a LG.api.apiBase() — fallback a localhost si LG aún no cargó.
   *  Reemplaza el boilerplate repetido en 6 lugares del codebase.
   */
  function safeApiBase() {
    if (typeof LGMDM !== 'undefined' && LGMDM.api && typeof LGMDM.api.apiBase === 'function')
      return LGMDM.api.apiBase();
    return 'http://127.0.0.1:8000';
  }

  /** Devuelve true si el usuario configuró prefers-reduced-motion: reduce.
   *  Consumido por todos los rAF loops / setInterval de visualizadores
   *  para honrar la preferencia de accesibilidad WCAG 2.3.3 / WIG §2.5.
   */
  function prefersReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  // ── Exposición pública ──
  window.LGMDM = window.LGMDM || {};
  window.LGMDM.utils = { clamp, clamp01, logFreq, xFromFreq, freqFromX, yFromDb, safeApiBase, prefersReducedMotion };

  // Aliases globales para retrocompatibilidad con widgets legacy
  // que invocan las funciones sin prefijo.
  window.clamp = clamp;
  window.clamp01 = clamp01;
  window.logFreq = logFreq;
  window.xFromFreq = xFromFreq;
  window.freqFromX = freqFromX;
  window.yFromDb = yFromDb;
  window.safeApiBase = safeApiBase;
  window.prefersReducedMotion = prefersReducedMotion;

  /**
   * setupCanvasResize(canvas, onResize) — DPR-aware ResizeObserver.
   * Ajusta el buffer interno del canvas (canvas.width/height) cuando CSS
   * cambia su tamaño visible. Llama onResize(newW, newH, dpr) para que el
   * consumidor pueda redibujar con las nuevas dimensiones.
   *
   * Devuelve una función cleanup() que desconecta el observer.
   */
  function setupCanvasResize(canvas, onResize) {
    if (!canvas || typeof ResizeObserver === 'undefined') return () => {};
    let raf = 0;
    const apply = () => {
      raf = 0;
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try { onResize(w, h, dpr); } catch (_) {}
    };
    const ro = new ResizeObserver(() => {
      if (!raf) raf = requestAnimationFrame(apply);
    });
    ro.observe(canvas);
    apply();
    return () => { ro.disconnect(); if (raf) cancelAnimationFrame(raf); };
  }
  window.setupCanvasResize = setupCanvasResize;
})();
