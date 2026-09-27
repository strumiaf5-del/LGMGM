/* LGMDM — Server Analysis View
 * The Analysis workspace is a pure renderer of backend results.
 * No client-side audio metrics, FFT or preview streaming are produced here.
 */
(function () {
  'use strict';
  const LG = window.LGMDM = window.LGMDM || {};
  const qs = (id) => document.getElementById(id);

  function setStatus(state, text, progress = null) {
    const status = qs('analysisStatus');
    if (!status) return;
    status.textContent = progress != null
      ? `${String(state).toUpperCase()} ${Number(progress).toFixed(0)}%`
      : String(state).toUpperCase();
    status.classList.toggle('processing', state === 'processing');
    status.classList.toggle('ready', state === 'ready');
    status.classList.toggle('error', state === 'error');
    status.title = text || '';

    // Skeleton loader mientras el server-side procesa.
    const container = qs('analysisDynamicContent');
    if (container && state === 'processing' && container.dataset.skeleton !== '1') {
      container.dataset.skeleton = '1';
      container.innerHTML = `
        <div class="skeleton-loader" aria-busy="true" aria-label="Analizando audio">
          <div class="skeleton-line skeleton-line--lg"></div>
          <div class="skeleton-line skeleton-line--md"></div>
          <div class="skeleton-line skeleton-line--sm"></div>
          <div class="skeleton-line skeleton-line--md"></div>
          <div class="skeleton-line skeleton-line--sm"></div>
        </div>`;
    } else if (container && state !== 'processing') {
      delete container.dataset.skeleton;
    }
  }

  function renderServerAnalysis(data) {
    if (!data || typeof data !== 'object') {
      throw new Error('El servidor devolvió un análisis inválido');
    }
    const dynamic = qs('analysisDynamicContent');
    if (!dynamic) throw new Error('Contrato DOM roto: #analysisDynamicContent no existe');
    if (typeof window.renderAnalysisSingle === 'function') {
      window.renderAnalysisSingle(data);
    } else {
      throw new Error('Renderizador server-analysis no disponible');
    }
    if (data.fft_spectrum && typeof window.renderFFT === 'function') {
      window.renderFFT([{ label: 'Espectro del servidor', data: data.fft_spectrum }]);
    }
  }

  function clear() {
    const target = qs('analysisDynamicContent');
    if (target) target.replaceChildren();
    setStatus('idle', 'Esperando análisis del servidor');
  }

  LG.analysis = Object.assign(LG.analysis || {}, {
    update: renderServerAnalysis,
    render: renderServerAnalysis,
    request: requestAnalysis,
    clear: () => { lastData = null; requestedFile = null; requestSeq += 1; clear(); },
    redraw: () => { if (lastData) renderServerAnalysis(lastData); },
  });

  const bind = (el, type, fn, key) => {
    if (LG.ui?.bindOnce) return LG.ui.bindOnce(el, type, fn, key);
    if (el) el.addEventListener(type, fn);
    return true;
  };

  let _analysisRaf = null;
  document.querySelectorAll('.lg-workspace-workspace-tab').forEach((tab) => {
    bind(tab, 'click', () => {
      if (tab.dataset.workspace === 'analysis') {
        if (_analysisRaf != null) cancelAnimationFrame(_analysisRaf);
        _analysisRaf = requestAnimationFrame(() => {
          _analysisRaf = null;
          window.LGMDM?.analysis?.request?.({ clear: false }).catch((error) => { console.debug('[analysis] workspace request failed', error); });
        });
      }
    }, 'analysis-view-tab');
  });

  window.addEventListener('lgmdm:analysis-state', (event) => {
    const detail = event.detail || {};
    setStatus(detail.state || 'idle', detail.text || '', detail.progress ?? null);
  });

  let requestSeq = 0;
  let requestedFile = null;
  let lastData = null;
  const getSelectedFile = () => LG.state?.getSelectedFile?.() ?? null;

  async function requestAnalysis(options = {}) {
    const file = getSelectedFile();
    if (!(file instanceof File)) {
      throw new Error('No existe archivo seleccionado para el análisis server-side');
    }
    const seq = ++requestSeq;
    requestedFile = file;
    if (options.clear !== false) clear();
    setStatus('processing', 'Análisis completo en servidor…');
    try {
      const body = new FormData();
      body.append('file', file, file.name);
      const res = await LG.api.apiFetch(`${LG.api.apiBase()}/analysis`, {
        method: 'POST', body, timeout: 60000, maxRetries: 1,
      });
      if (seq !== requestSeq || requestedFile !== getSelectedFile()) return null;
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try { const text = await res.text(); if (text) detail += `: ${text}`; } catch (_) {}
        throw new Error(`Análisis server-side rechazado: ${detail}`);
      }
      const data = await res.json();
      if (seq !== requestSeq || requestedFile !== getSelectedFile()) return null;
      lastData = data;
      renderServerAnalysis(data);
      setStatus('ready', 'Análisis completo del servidor disponible');
      window.dispatchEvent(new CustomEvent('lgmdm:analysis-state', { detail: { state: 'ready', text: 'Análisis completo del servidor disponible', progress: 100 } }));
      window.dispatchEvent(new CustomEvent('analysis-updated', { detail: data }));
      return data;
    } catch (err) {
      if (seq === requestSeq) {
        setStatus('error', err.message || 'Error desconocido');
        // F5.11 — Empty state con retry.
        const container = qs('analysisDynamicContent');
        if (container) {
          container.innerHTML = `
            <div class="empty-state" role="alert">
              <div class="empty-state-icon" aria-hidden="true">⚠</div>
              <h3>No se pudo analizar el audio</h3>
              <p>${LG.ui?.escapeHtml?.(err.message ?? 'Error desconocido') ?? 'Error desconocido'}</p>
              <button class="btn btn-primary" type="button" id="analysisRetryBtn">Reintentar análisis</button>
            </div>`;
          container.querySelector('#analysisRetryBtn')?.addEventListener('click', () => requestAnalysis({ clear: true }));
        }
      }
      throw err;
    }
  }
  window.addEventListener('lgmdm:file-selected', () => { requestSeq += 1; lastData = null; requestedFile = null; clear(); });

  window.requestAnalysis = requestAnalysis;
})();
