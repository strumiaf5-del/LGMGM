/* LGMDM — Server Preview Controller
 * Contract:
 *   1) Preview is enabled only by #s-livepreview.
 *   2) The server creates ONE immutable 25 s source snapshot from the ORIGINAL file.
 *   3) Every render uses that immutable snapshot; never the previous rendered preview.
 *   4) Parameter changes cancel the active render immediately, then debounce 1500 ms.
 *   5) After 1500 ms without changes, the COMPLETE current parameter snapshot is sent.
 *   6) The server renders the complete 25 s preview and returns the finished audio.
 *   7) Playback is allowed only after the complete preview is received.
 *   8) No WebSocket / PCM chunk playback / client-side preview processing.
 */
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  const DEBOUNCE_MS = 1500;
  const DEFAULT_PREVIEW_DURATION_SEC = 25;

  let running = false;
  let activePromise = null;
  let renderSession = null;
  let sourceSession = null;
  let sessionSeq = 0;
  let sourceSeq = 0;
  let requestTimer = null;
  let ready = false;
  let previewUrl = null;
  let previewSourceId = null;
  let previewSourceMeta = null;
  let previewTelemetry = null;
  let metricsPollTimer = null;
  let wired = false;

  const METRICS_POLL_MS = 2000;

  const checkbox = () => document.getElementById('s-livepreview');
  const audioWrap = () => document.getElementById('previewAudioWrap');
  const chainPane = () => document.getElementById('pasoCadena');
  const outputPane = () => document.getElementById('pasoSalida');

  function setState(state, text, progress = null) {
    global.dispatchEvent(new CustomEvent('lgmdm:preview-state', {
      detail: { state, text, progress }
    }));
  }

  function isEnabled() {
    return checkbox()?.checked === true;
  }

  function getPreviewDurationSec() {
    const configured = Number(LG.config?.previewDurationSec);
    if (Number.isFinite(configured) && configured > 0) {
      return Math.min(configured, DEFAULT_PREVIEW_DURATION_SEC);
    }
    return DEFAULT_PREVIEW_DURATION_SEC;
  }

  function clearPreviewAudio() {
    const wrap = audioWrap();
    if (wrap) {
      wrap.querySelectorAll('audio').forEach((audio) => {
        try { audio.pause(); } catch (_) {}
        try {
          audio.removeAttribute('src');
          audio.load();
        } catch (_) {}
      });
      wrap.replaceChildren();
    }
    if (previewUrl) {
      try { URL.revokeObjectURL(previewUrl); } catch (_) {}
      previewUrl = null;
    }
    ready = false;
    global.dispatchEvent(new CustomEvent('lgmdm:preview-ready', {
      detail: { ready: false }
    }));
  }

  function clearSourceSnapshot() {
    previewSourceId = null;
    previewSourceMeta = null;
    global.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
      detail: { state: 'empty', sourceId: null, meta: null }
    }));
  }

  function renderAudio(blob) {
    if (!(blob instanceof Blob) || blob.size === 0) {
      throw new Error('El servidor devolvió un Preview vacío');
    }
    const wrap = audioWrap();
    if (!wrap) {
      throw new Error('Contrato DOM roto: #previewAudioWrap no existe');
    }

    clearPreviewAudio();
    previewUrl = URL.createObjectURL(blob);

    const audio = document.createElement('audio');
    audio.controls = true;
    audio.preload = 'metadata';
    audio.src = previewUrl;
    audio.dataset.previewReady = 'true';
    audio.setAttribute('aria-label', `Preview de ${getPreviewDurationSec()} segundos renderizado por el servidor`);
    wrap.appendChild(audio);

    ready = true;
    global.dispatchEvent(new CustomEvent('lgmdm:preview-ready', {
      detail: { ready: true, audio, sourceId: previewSourceId }
    }));
  }

  function isRenderActive(candidate) {
    return candidate && renderSession === candidate && !candidate.cancelled;
  }

  function isSourceActive(candidate) {
    return candidate && sourceSession === candidate && !candidate.cancelled;
  }

  function cancelRender() {
    const current = renderSession;
    if (current) {
      current.cancelled = true;
      try { current.controller.abort(); } catch (_) {}
    }
    renderSession = null;
    running = false;
    activePromise = null;
  }

  function cancelSource() {
    const current = sourceSession;
    if (current) {
      current.cancelled = true;
      try { current.controller.abort(); } catch (_) {}
    }
    sourceSession = null;
  }

  function stop(options = {}) {
    clearTimeout(requestTimer);
    requestTimer = null;
    cancelRender();
    stopMetricsPolling();
    if (options.cancelSource) cancelSource();
    clearPreviewAudio();
    if (!options.keepSource) clearSourceSnapshot();
    if (!options.silent) setState('disabled', 'Preview detenido');
  }

  // ── FIX 1: Live metrics polling (GR + LUFS bars) ─────────────────────────
  // Polls /preview/telemetry/{source_id} every METRICS_POLL_MS while preview
  // is active. Publishes to LGMDM.metrics so 10-meters-dashboard shows
  // multiband GR / comp / glue / parallel GR bars + LUFS meter.
  async function pollMetrics() {
    if (!isEnabled() || !previewSourceId) {
      stopMetricsPolling();
      return;
    }
    try {
      const res = await LG.api.apiFetch(`${LG.api.apiBase()}/preview/telemetry/${encodeURIComponent(previewSourceId)}`, {
        method: 'GET',
        timeout: 5000,
        maxRetries: 0
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data && typeof LG.metrics?.publish === 'function') {
        const flat = data.meters ? Object.assign({}, data, data.meters) : data;
        try { LG.metrics.publish(flat, { source: 'preview-live-poll' }); } catch (_) {}
      }
    } catch (_) { /* telemetría opcional — no bloquear el ciclo */ }
  }

  function startMetricsPolling() {
    if (metricsPollTimer) return;
    if (!isEnabled() || !previewSourceId) return;
    pollMetrics();
    metricsPollTimer = setInterval(pollMetrics, METRICS_POLL_MS);
  }

  function stopMetricsPolling() {
    if (metricsPollTimer) {
      clearInterval(metricsPollTimer);
      metricsPollTimer = null;
    }
  }

  async function createOriginalSnapshot() {
    if (!isEnabled() || !window.LGMDM.state.selectedFile) {
      return false;
    }

    if (previewSourceId) return true;
    if (sourceSession?.promise) return sourceSession.promise;

    cancelSource();
    const current = {
      id: ++sourceSeq,
      cancelled: false,
      controller: new AbortController(),
      promise: null,
    };
    sourceSession = current;

    setState('source-processing', `Preparando muestra original de ${getPreviewDurationSec()} s en el servidor…`, 0);
    global.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
      detail: { state: 'processing', sourceId: null, meta: null }
    }));

    current.promise = (async () => {
      try {
        const body = new FormData();
        body.append('file', window.LGMDM.state.selectedFile);
        body.append('duration_sec', String(getPreviewDurationSec()));
        body.append('output_format', 'wav');
        body.append('output_bit_depth', '24');

        if (global._previewLibraryId) body.append('library_id', global._previewLibraryId);

        const res = await LG.api.apiFetch(`${LG.api.apiBase()}/preview/source`, {
          method: 'POST',
          body,
          signal: current.controller.signal,
          timeout: 90000,
          maxRetries: 1,
        });

        if (!isSourceActive(current)) return false;
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const text = await res.text();
            if (text) detail += `: ${text}`;
          } catch (_) {}
          throw new Error(`No se pudo crear el snapshot original del Preview: ${detail}`);
        }

        const data = await res.json();
        if (!isSourceActive(current)) return false;
        if (!data?.source_id || typeof data.source_id !== 'string') {
          throw new Error('El servidor no devolvió un source_id válido para el snapshot original');
        }
        const duration = Number(data.duration_sec ?? getPreviewDurationSec());
        if (!Number.isFinite(duration) || duration <= 0 || duration > getPreviewDurationSec()) {
          throw new Error(`Snapshot original inválido: duración ${String(data.duration_sec)}`);
        }

        previewSourceId = data.source_id;
        previewSourceMeta = { duration_sec: duration, source_sha256: data.source_sha256 || null };
        global.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
          detail: { state: 'ready', sourceId: previewSourceId, meta: previewSourceMeta }
        }));
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || !isSourceActive(current)) return false;
        clearSourceSnapshot();
        setState('error', `Error preparando el snapshot original: ${error.message}`);
        throw error;
      } finally {
        if (sourceSession === current) sourceSession = null;
      }
    })();

    return current.promise;
  }

  async function start() {
    if (!isEnabled()) {
      setState('disabled', 'Preview deshabilitado');
      return false;
    }
    if (!window.LGMDM.state.selectedFile) {
      setState('error', 'Cargá un archivo para generar el Preview');
      return false;
    }
    if (running && activePromise) return activePromise;

    const sourceReady = await createOriginalSnapshot();
    if (!sourceReady || !previewSourceId) return false;

    clearPreviewAudio();

    const current = {
      id: ++sessionSeq,
      cancelled: false,
      controller: new AbortController(),
      startedAt: performance.now(),
      sourceId: previewSourceId,
    };
    renderSession = current;
    running = true;
    setState('processing', `Procesando Preview de ${getPreviewDurationSec()} s en el servidor…`, 0);

    activePromise = (async () => {
      try {
        const collected = typeof LG.params?.collect === 'function'
          ? LG.params.collect()
          : null;
        if (!collected || typeof collected !== 'object') {
          throw new Error('No se pudo construir el snapshot de parámetros del Preview');
        }

        const payload = {
          preview_source_id: current.sourceId,
          preview_duration_sec: getPreviewDurationSec(),
          params: collected,
        };

        const res = await LG.api.apiFetch(`${LG.api.apiBase()}/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify(payload),
          signal: current.controller.signal,
          timeout: 90000,
          maxRetries: 1,
        });

        if (!isRenderActive(current)) return false;
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try {
            const text = await res.text();
            if (text) detail += `: ${text}`;
          } catch (_) {}
          throw new Error(detail);
        }

        const blob = await res.blob();
        if (!isRenderActive(current)) return false;

        const previewId = res.headers.get('X-Preview-ID');
        let telemetry = null;
        if (previewId) {
          try {
            const telemetryRes = await LG.api.apiFetch(`${LG.api.apiBase()}/preview/telemetry/${encodeURIComponent(previewId)}`, {
              method:'GET', signal:current.controller.signal, timeout:10000, maxRetries:0
            });
            if (telemetryRes.ok) telemetry = await telemetryRes.json();
          } catch (_) { /* telemetría opcional — el audio ya está listo */ }
        } else {
          console.debug('[preview] X-Preview-ID ausente — telemetría omitida (audio se reproduce igual)');
        }
        renderAudio(blob);
        previewTelemetry = telemetry;
        // FIX BUG #2: publish telemetry to metrics store so dashboard (mb GR,
        // comp/gr, glue/gr, parallel/gr) updates after preview render.
        if (typeof LG.metrics?.publish === 'function' && telemetry) {
          const flat = telemetry.meters ? Object.assign({}, telemetry, telemetry.meters) : telemetry;
          try { LG.metrics.publish(flat, { source: 'preview-telemetry' }); }
          catch (_) { /* telemetría opcional */ }
        }
        // FIX 1: arrancar polling live de metrics cada 2s — alimenta GR/LUFS
        // bars en tiempo real (no solo al final del render).
        startMetricsPolling();
        const audio = audioWrap()?.querySelector('audio');
        global.dispatchEvent(new CustomEvent('lgmdm:preview-telemetry', { detail:{ telemetry, audio, previewId: previewId || null } }));
        setState('ready', `Preview de ${getPreviewDurationSec()} s listo para reproducir`, 100);
        return true;
      } catch (error) {
        if (error?.name === 'AbortError' || !isRenderActive(current)) return false;
        clearPreviewAudio();
        setState('error', `Error de Preview: ${error.message}`);
        throw error;
      } finally {
        if (renderSession === current) {
          renderSession = null;
          running = false;
          activePromise = null;
        }
      }
    })();

    return activePromise;
  }

  function scheduleRender(reason = 'parameter-change') {
    clearTimeout(requestTimer);
    requestTimer = null;

    if (!isEnabled() || !window.LGMDM.state.selectedFile) return;

    requestTimer = setTimeout(() => {
      requestTimer = null;
      start().catch((error) => {
        console.debug(`[preview] render failed (${reason})`, error);
      });
    }, DEBOUNCE_MS);

    setState('waiting', `Esperando ${DEBOUNCE_MS / 1000} s sin cambios…`);
  }

  function teardown() {
    clearTimeout(requestTimer);
    requestTimer = null;
    cancelRender();
    cancelSource();
    clearPreviewAudio();
  }

  function handleParameterChange() {
    if (!isEnabled() || !window.LGMDM.state.selectedFile) return;
    clearTimeout(requestTimer);
    requestTimer = null;
    cancelRender();
    clearPreviewAudio();
    scheduleRender('parameter-change');
  }

  function handleToggle(event) {
    if (event && event.isTrusted === false) return;
    if (!isEnabled()) {
      stop({ cancelSource: true });
      return;
    }
    cancelRender();
    clearPreviewAudio();
    scheduleRender('preview-enabled');
    // FIX 1: si ya hay source_id (preview habilitado en toggle anterior),
    // arrancar polling inmediatamente sin esperar al render completo.
    if (previewSourceId) startMetricsPolling();
  }

  function handleFileSelected() {
    clearTimeout(requestTimer);
    requestTimer = null;
    cancelRender();
    stopMetricsPolling();
    cancelSource();
    clearPreviewAudio();
    clearSourceSnapshot();
    if (isEnabled()) {
      createOriginalSnapshot().then((ok) => {
        if (ok && isEnabled() && window.LGMDM.state.selectedFile) scheduleRender('file-selected');
      }).catch((error) => {
        console.debug('[preview] original snapshot failed', error);
      });
    } else {
      setState('disabled', 'Preview deshabilitado');
    }
  }

  function isParameterControl(target) {
    if (!(target instanceof Element)) return false;
    if (!target.matches('input, select, textarea')) return false;
    if (target.id === 's-livepreview') return false;
    return Boolean(target.closest('#pasoCadena, #pasoSalida'));
  }

  function onParameterEvent(event) {
    if (!isParameterControl(event.target)) return;
    handleParameterChange();
  }

  function bindWorkspace() {
    if (wired) return;
    wired = true;
    const toggle = checkbox();
    const bind = LG.ui?.bindOnce;
    if (typeof bind !== 'function') throw new Error('Preview Controller requiere LGMDM.ui.bindOnce');
    if (!toggle) throw new Error('Contrato DOM roto: #s-livepreview no existe');
    if (!audioWrap()) throw new Error('Contrato DOM roto: #previewAudioWrap no existe');

    bind(toggle, 'change', handleToggle, 'server-preview-toggle');
    bind(global, 'lgmdm:file-selected', handleFileSelected, 'server-preview-file-selected');

    const chain = chainPane();
    const output = outputPane();
    [chain, output].forEach((pane, index) => {
      if (!pane) {
        throw new Error(`Contrato DOM roto: panel de parámetros #${index === 0 ? 'pasoCadena' : 'pasoSalida'} no existe`);
      }
      bind(pane, 'input', onParameterEvent, `server-preview-param-input-${index}`);
      bind(pane, 'change', onParameterEvent, `server-preview-param-change-${index}`);
    });
  }

  LG.previewController = Object.assign(LG.previewController || {}, {
    start,
    stop,
    teardown,
    request: scheduleRender,
    isEnabled,
    isRunning: () => running,
    isReady: () => ready,
    getAudio: () => audioWrap()?.querySelector('audio[data-preview-ready="true"]') || null,
    setServerState: setState,
    getDurationSec: getPreviewDurationSec,
    getSourceId: () => previewSourceId,
    getSourceMeta: () => previewSourceMeta,
    debounceMs: DEBOUNCE_MS,
  });

  LG.previewWorkspace = { startPreview: start, stopPreview: stop };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindWorkspace, { once: true });
  } else {
    bindWorkspace();
  }
})(window);
