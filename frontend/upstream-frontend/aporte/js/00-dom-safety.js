// ============================================================
// 00-dom-safety.js — Acceso seguro al DOM bajo LGMDM.dom
// ============================================================
(function (global) {
  'use strict';
  const LG = global.LGMDM = global.LGMDM || {};
  const dom = LG.dom = LG.dom || {};

  const api = {
    byId(id) { return typeof id === 'string' && id ? document.getElementById(id) : null; },
    requireById(id, owner = 'LGMDM') {
      const el = this.byId(id);
      if (!el) {
        console.warn(`[LGMDM DOM WARNING] ${owner}: required element #${id} is missing; fallback stub created.`);
        const fallback = document.createElement('div');
        fallback.id = id;
        fallback.setAttribute('data-fallback', 'true');
        return fallback;
      }
      return el;
    },
    query(selector, parent = document) {
      if (!selector || !parent) return null;
      try { return parent.querySelector(selector); } catch (_) { return null; }
    },
    queryAll(selector, parent = document) {
      if (!selector || !parent) return [];
      try { return Array.from(parent.querySelectorAll(selector)); } catch (_) { return []; }
    },
    setValue(selector, value, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.value = value; return true; },
    getText(selector, parent = document) { return this.query(selector, parent)?.textContent || ''; },
    setText(selector, text, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.textContent = text; return true; },
    addClass(selector, className, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.classList.add(className); return true; },
    removeClass(selector, className, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.classList.remove(className); return true; },
    toggleClass(selector, className, force, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.classList.toggle(className, force); return true; },
    getAttribute(selector, attr, parent = document) { return this.query(selector, parent)?.getAttribute(attr) || ''; },
    setAttribute(selector, attr, value, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.setAttribute(attr, value); return true; },
    on(selector, event, handler, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.addEventListener(event, handler); return true; },
    off(selector, event, handler, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.removeEventListener(event, handler); return true; },
    click(selector, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.click(); return true; },
    focus(selector, parent = document) { const el = this.query(selector, parent); if (!el) return false; el.focus(); return true; },
    batch(fn) {
      if (typeof fn !== 'function') return undefined;
      return document.startViewTransition ? document.startViewTransition(fn) : fn();
    },
  };
  Object.assign(dom, api);
})(window);
