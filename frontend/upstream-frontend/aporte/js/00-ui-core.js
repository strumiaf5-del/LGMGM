
(function(global){
  "use strict";
  const LG = global.LGMDM = global.LGMDM || {};
  const bound = new WeakMap();
  function bindOnce(el, type, handler, key = type, options){
    if (!el || typeof el.addEventListener !== "function") return false;
    let map = bound.get(el);
    if (!map){ map = new Set(); bound.set(el, map); }
    const token = `${type}:${key}`;
    if (map.has(token)) return false;
    el.addEventListener(type, handler, options);
    map.add(token);
    return true;
  }
  function escapeHtml(value){
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function safeAudioSrc(value){
    try {
      const raw = String(value ?? '').trim();
      if (!raw) return '';
      const u = new URL(raw, global.location.href);
      if (['http:','https:','blob:'].includes(u.protocol)) return u.href;
    } catch (_) {}
    return '';
  }

  function formatDisplay(value, format) {
    const n = Number(value);
    switch (format) {
      case 'percent': return `${value}%`;
      case 'fixed1': return Number.isFinite(n) ? n.toFixed(1) : String(value);
      case 'fixed2': return Number.isFinite(n) ? n.toFixed(2) : String(value);
      case 'fixed1s': return Number.isFinite(n) ? `${n.toFixed(1)}s` : String(value);
      default: return String(value);
    }
  }

  function syncRangeDisplay(input) {
    if (!input?.dataset?.displayTarget) return;
    const target = document.getElementById(input.dataset.displayTarget);
    if (!target) return;
    target.textContent = formatDisplay(input.value, input.dataset.displayFormat || 'raw');
  }

  function clearResults() {
    // BUGFIX: #analysisDynamicContent no estaba en esta lista — cada click
    // en Analizar/Consejos hacía appendChild() de un grid nuevo ARRIBA de
    // los anteriores (ver renderAnalysisSingle/renderAnalysisComparison en
    // 09-visualizers.js, que siempre usan appendChild, nunca replaceChildren).
    // El contenedor crecía sin límite con cada análisis, lo que rompía el
    // layout de la pestaña Analysis (contenido superpuesto, sin scroll
    // consistente) hasta refrescar la página.
    const selectors = [
      '#results', '#result', '#analysisResults', '#analysis-results',
      '#masteringResults', '#mastering-results', '#resultPanel', '.results-panel',
      '#analysisDynamicContent'
    ];
    selectors.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if ('value' in node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) node.value = '';
        else node.replaceChildren();
      });
    });
    const statusNodes = [
      '#consoleStatus', '#previewPanelStatus', '#previewStatus', '#previewActionStatus'
    ];
    statusNodes.forEach((selector) => {
      document.querySelectorAll(selector).forEach((node) => {
        if (node.id === 'consoleStatus') node.textContent = 'Listo para recibir audio';
        else if (node.id === 'previewPanelStatus') node.textContent = 'Listo para procesar';
        else if (node.id === 'previewActionStatus') node.textContent = 'Esperando archivo';
        else node.textContent = '';
      });
    });
  }

  function showStatus(target, message, type = 'info', progress = null, stage = null) {
    const text = message == null ? '' : String(message);
    const targeted = typeof target === 'string' ? document.getElementById(target) : target;
    if (targeted) {
      targeted.textContent = text;
      targeted.dataset.statusType = String(type || 'info');
      if (progress != null) targeted.dataset.progress = String(progress);
      else delete targeted.dataset.progress;
      if (stage != null) targeted.dataset.stage = String(stage);
      else delete targeted.dataset.stage;
    }
    const status = document.getElementById('consoleStatus');
    const previewStatus = document.getElementById('previewPanelStatus');
    const compactStatus = document.getElementById('previewActionStatus');
    if (status) status.textContent = text;
    if (previewStatus) previewStatus.textContent = text;
    if (compactStatus) compactStatus.textContent = text;
    document.querySelectorAll('[data-lgmdm-status]').forEach((node) => {
      node.textContent = text;
      node.dataset.statusType = String(type || 'info');
      if (progress != null) node.dataset.progress = String(progress);
      else delete node.dataset.progress;
      if (stage != null) node.dataset.stage = String(stage);
      else delete node.dataset.stage;
    });
  }

  function getContent() {
    // BUGFIX: antes devolvía #content (el shell exterior que envuelve TODO
    // el workspace de pestañas), así que cualquier cosa insertada acá
    // (waveform, resultados de análisis, panel perceptual) quedaba fuera de
    // las pestañas, siempre visible, y desacomodaba el layout entero.
    // Ahora prioriza el contenedor que vive DENTRO de la pestaña "Analysis".
    return document.getElementById('analysisDynamicContent')
      || document.getElementById('content')
      || document.querySelector('.content')
      || document.body;
  }

  function syncParallelBypass(input) {
    if (!input?.matches?.('[data-parallel-bypass]')) return;
    const off = !!input.checked;
    ['parallelMix','parallelThresh','parallelRatio','parallelAttack','parallelRelease'].forEach((id) => {
      const control = document.getElementById(id);
      if (!control) return;
      control.disabled = off;
      const row = control.closest('.param');
      if (row) row.classList.toggle('is-disabled-by-bypass', off);
    });
  }

  function initDeclarativeControls() {
    bindOnce(document, 'input', (event) => syncRangeDisplay(event.target), 'ui-declarative-range');
    bindOnce(document, 'change', (event) => {
      syncRangeDisplay(event.target);
      syncParallelBypass(event.target);
    }, 'ui-declarative-change');
    document.querySelectorAll('[data-parallel-bypass]').forEach(syncParallelBypass);
  }

  // ── Toast notifications (migrado desde 16-error-handling.js) ─────────
  function createToastContainer() {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.setAttribute('role', 'region');
      container.setAttribute('aria-live', 'polite');
      container.setAttribute('aria-label', 'Notificaciones');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    return container;
  }

  function showToast(message, type = 'info', duration = 4000) {
    const container = createToastContainer();
    const toast = document.createElement('lgmdm-toast');
    toast.setAttribute('type', type);
    toast.setAttribute('message', String(message));
    container.appendChild(toast);
    toast.scheduleRemove?.(duration);
    return toast;
  }

  LG.ui = Object.assign(LG.ui || {}, { bindOnce, initDeclarativeControls, escapeHtml, safeAudioSrc, getContent, clearResults, showStatus, showToast });

  function handleClientError(error, fallbackMessage, context) {
    const msg = (error && error.message) || fallbackMessage || 'Error desconocido';
    showToast(msg, 'error');
    console.debug('[client-error]', msg, context, error);
  }
  LG.errors = Object.assign(LG.errors || {}, { handleClientError });

  // ── Global Playback Arbiter ──────────────────────────────────────────────
  // Coordinates playback across preview controller, HTML5 <audio>, and Web Audio
  // to avoid overlapping audio streams and double-playback collisions.
  let _stoppingPlayback = false;
  function stopAllPlayback(exceptElement) {
    if (_stoppingPlayback) return;
    _stoppingPlayback = true;
    try {
      // 1. Pause HTML5 audio elements
      document.querySelectorAll('audio').forEach((a) => {
        if (a !== exceptElement && !a.paused) {
          try { a.pause(); } catch (_) {}
        }
      });
      // 2. Stop visualizers Web Audio A/B player
      try {
        LG.visualizers?.stopAB?.();
      } catch (_) {}
      // 3. Reset console play button if console preview is not the playing element
      const previewAudio = document.querySelector('#previewAudioWrap audio');
      if (exceptElement !== previewAudio) {
        const consolePb = document.getElementById('consolePlayBtn');
        if (consolePb) {
          consolePb.textContent = '▶';
          consolePb.setAttribute('aria-pressed', 'false');
        }
        if (LG.console?.state) LG.console.state.playing = false;
      }
      global.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { except: exceptElement || null } }));
    } finally {
      _stoppingPlayback = false;
    }
  }

  // Intercept any <audio> play event in capture phase to stop competing players
  document.addEventListener('play', (e) => {
    if (e.target && e.target.tagName === 'AUDIO') {
      stopAllPlayback(e.target);
    }
  }, true);

  LG.playback = Object.assign(LG.playback || {}, { stopAll: stopAllPlayback });

  window.bindOnce = bindOnce;
  if (document.readyState === 'loading') bindOnce(document, 'DOMContentLoaded', initDeclarativeControls, 'ui-declarative-dom-ready', { once: true });
  else initDeclarativeControls();
})(window);
