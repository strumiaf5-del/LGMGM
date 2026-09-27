// 20-pro-upgrades.js — Pitch Pro, Pro Metering, AI Actions, Reference Compare, UX
(function () {
  'use strict';

  const qs = (s, root = document) => root.querySelector(s);
  const el = (id) => document.getElementById(id);
  const getSelectedFile = () => window.LGMDM?.state?.getSelectedFile?.() ?? null;
  const getLastAnalysis = () => window.LGMDM?.state?.getLastAnalysis?.() ?? null;
  const bindOnce = window.LGMDM?.ui?.bindOnce || ((el, ev, fn, key, opts) => el?.addEventListener(ev, fn, opts));




  function improveHistory() {
    const mgr = window.LGMDM?.undo?.manager;
    if (!mgr) return;
    const applyProPatches = (target) => {
      const originalSave = target.saveState.bind(target);
      // Keep the public contract but make snapshots represent the state BEFORE a change.
      target.saveState = function (state, label = 'Change') {
        const next = JSON.parse(JSON.stringify(state));
        if (this.currentState !== null) {
          this.undoStack.push({ state: JSON.parse(JSON.stringify(this.currentState)), label, timestamp: Date.now() });
          if (this.undoStack.length > this.maxStates) this.undoStack.shift();
        }
        this.redoStack = [];
        this.currentState = next;
        this.notifyListeners();
      };
      target.undo = function () {
        if (!this.undoStack.length) return null;
        this.redoStack.push({ state: JSON.parse(JSON.stringify(this.currentState)), label: 'Redo', timestamp: Date.now() });
        const prev = this.undoStack.pop(); this.currentState = JSON.parse(JSON.stringify(prev.state)); this.notifyListeners(); return prev;
      };
      target.redo = function () {
        if (!this.redoStack.length) return null;
        this.undoStack.push({ state: JSON.parse(JSON.stringify(this.currentState)), label: 'Undo', timestamp: Date.now() });
        const next = this.redoStack.pop(); this.currentState = JSON.parse(JSON.stringify(next.state)); this.notifyListeners(); return next;
      };
    };
    if (mgr.__proFixed) {
      // already patched; ensure saveState is in the expected form
      if (typeof mgr.saveState !== 'function' || !mgr.__proSavePatched) {
        applyProPatches(mgr);
        mgr.__proSavePatched = true;
      }
      return;
    }
    mgr.__proFixed = true;
    mgr.__proSavePatched = false;
    applyProPatches(mgr);
    mgr.__proSavePatched = true;
  }

  function renderMini(analysis) {
    const target = qs('#proMiniMetrics');
    if (!target) return;
    if (!analysis || typeof analysis !== 'object') {
      target.replaceChildren();
      return;
    }
    const fields = [
      ['LUFS-I', analysis.integrated_lufs ?? analysis.lufs_i],
      ['LUFS-S', analysis.short_term_lufs ?? analysis.lufs_s],
      ['True Peak', analysis.true_peak_db ?? analysis.true_peak],
      ['DR', analysis.dynamic_range ?? analysis.dr],
    ].filter(([, v]) => v != null && Number.isFinite(v));
    if (!fields.length) {
      target.replaceChildren();
      return;
    }
    target.replaceChildren(...fields.map(([k, v]) => {
      const span = document.createElement('span');
      const label = document.createElement('b');
      label.textContent = k + ' ';
      const val = document.createElement('em');
      val.textContent = typeof v === 'number' ? v.toFixed(2) : String(v);
      span.append(label, val);
      return span;
    }));
  }
  window.LGMDM.pro = window.LGMDM.pro || {};
  window.LGMDM.pro.renderMini = renderMini;

  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    improveHistory();
    bindOnce(window, "analysis-updated", (event) => {
      // detail=null también es significativo: limpia las métricas del track anterior.
      renderMini(event.detail || null);
    }, 'pro-analysis-updated');
    const initialAnalysis = getLastAnalysis();
    if (initialAnalysis) renderMini(initialAnalysis);
  }

  bindOnce(document, 'DOMContentLoaded', boot, 'pro-upgrades-dom-ready', { once: true });

  if (document.readyState !== 'loading') boot();
})();
