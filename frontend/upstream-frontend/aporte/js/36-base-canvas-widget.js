// ============================================================
// 36-base-canvas-widget.js — Mixin para widgets canvas Pro
// ============================================================
// Extraído del audit 2026-09-18: 6+ widgets Pro duplicaban el
// mismo boilerplate (_rafId, _lastFrame, _frameInterval, _running,
// _destroyed, init/destroy/teardown). Este mixin centraliza:
//
//   class MyWidget extends BaseCanvasWidget { ... }
//   const w = new MyWidget();
//   w.init(canvas, { onTick(t) { ... }, fps: 60 });
//   w.destroy();   // limpia rAF + listeners + ResizeObserver
//
// API:
//   - start() / stop()        control de rAF
//   - resize()                manual resize
//   - destroy()               cleanup completo
// ============================================================

(function (global) {
  "use strict";

  class BaseCanvasWidget {
    constructor() {
      this._rafId = 0;
      this._lastFrame = 0;
      this._frameInterval = 1000 / 60;
      this._running = false;
      this._destroyed = false;
      this._ro = null;
      this._canvas = null;
      this._ctx = null;
      this._dpr = 1;
      this._cssWidth = 0;
      this._cssHeight = 0;
      this._onTick = null;
      this._cleanupResize = null;
    }

    _size(canvas) {
      const rect = canvas.getBoundingClientRect();
      this._cssWidth = Math.max(rect.width, 320);
      this._cssHeight = Math.max(rect.height, 180);
      this._dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.floor(this._cssWidth * this._dpr);
      canvas.height = Math.floor(this._cssHeight * this._dpr);
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(this._dpr, 0, 0, this._dpr, 0, 0);
      return ctx;
    }

    _bindResize(canvas) {
      if (typeof ResizeObserver === "undefined" || !canvas) return;
      let raf = 0;
      const apply = () => {
        raf = 0;
        if (this._destroyed) return;
        this._ctx = this._size(canvas);
        if (typeof this.onResize === "function") this.onResize(this._cssWidth, this._cssHeight, this._dpr);
      };
      this._ro = new ResizeObserver(() => {
        if (!raf) raf = requestAnimationFrame(apply);
      });
      this._ro.observe(canvas);
      this._cleanupResize = () => {
        if (raf) cancelAnimationFrame(raf);
      };
    }

    _tick(now) {
      if (this._destroyed || !this._running) return;
      if (now - this._lastFrame < this._frameInterval) {
        this._rafId = requestAnimationFrame((t) => this._tick(t));
        return;
      }
      this._lastFrame = now;
      try {
        if (typeof this.onTick === "function") this.onTick(now);
      } catch (e) {
        console.error(`[BaseCanvasWidget] onTick error in ${this.constructor.name}:`, e);
      }
      this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    init(canvas, options = {}) {
      if (!canvas) throw new Error("[BaseCanvasWidget] canvas required");
      this._canvas = canvas;
      this._ctx = this._size(canvas);
      this._onTick = options.onTick || null;
      if (typeof this.onResize === "function") this.onResize(this._cssWidth, this._cssHeight, this._dpr);
      this._bindResize(canvas);
      if (typeof this.onInit === "function") this.onInit(options);
      this._running = true;
      this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    start() {
      if (this._destroyed || this._running) return;
      this._running = true;
      this._rafId = requestAnimationFrame((t) => this._tick(t));
    }

    stop() {
      this._running = false;
      if (this._rafId) {
        cancelAnimationFrame(this._rafId);
        this._rafId = 0;
      }
    }

    resize() {
      if (!this._canvas) return;
      this._ctx = this._size(this._canvas);
      if (typeof this.onResize === "function") this.onResize(this._cssWidth, this._cssHeight, this._dpr);
    }

    destroy() {
      this._destroyed = true;
      this._running = false;
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = 0;
      if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
      if (typeof this._cleanupResize === "function") { this._cleanupResize(); this._cleanupResize = null; }
      if (typeof this.onDestroy === "function") this.onDestroy();
      this._canvas = null;
      this._ctx = null;
    }

    teardown() { this.destroy(); }

    get themeColors() {
      return (global.LGMDM?.themeColors && global.LGMDM.themeColors()) || null;
    }

    static freqToX(freq, width) {
      return (Math.log10(Math.max(20, freq) / 20) / Math.log10(1000)) * width;
    }

    static dbToY(db, height, minDb = -18, maxDb = 18) {
      return height - ((db - minDb) / (maxDb - minDb)) * height;
    }

    static xToFreq(x, width) {
      return 20 * Math.pow(1000, x / width);
    }
  }

  global.BaseCanvasWidget = BaseCanvasWidget;
})(window);
