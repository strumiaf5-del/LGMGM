// features/audio/preview-controller.ts — Server Preview Controller.
// Port de /root/nuevito/frontend/upstream-frontend/dist/js/30-preview-controller.js
// (PRODUCTION reference, no del aporte experimental).
//
// FIX vs dist: tipos TS en todo el port.
// FIX vs dist: HMR-safe (`window.LGMDM.previewControllerBound`).
// FIX vs dist: AbortController para render + source sessions.
// FIX vs dist: AbortController + cleanup para metrics polling.
// FIX vs dist: `_spectrumToArray()` portada del dist (backend devuelve 7 bandas,
// dashboard espera 6 — upper_mid + presence → highmid).

import { config } from '../../core/config';

const DEBOUNCE_MS = 1500;
const DEFAULT_PREVIEW_DURATION_SEC = 25;
const METRICS_POLL_MS = 10000;

// ── Tipos ──────────────────────────────────────────────────────────────

interface ApiShape {
  apiBase: () => string;
  apiFetch: <T>(endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<T>;
  // FIX K4: client.* retorna Promise<Response> real (para res.ok/.json/.blob).
  // Acepta timeoutMs/maxRetries (RequestOptions internos de api.ts) igual que apiFetch.
  client: {
    get: (endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<Response>;
    post: (endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<Response>;
    put: (endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<Response>;
    patch: (endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<Response>;
    delete: (endpoint: string, options?: RequestInit & { timeoutMs?: number; maxRetries?: number }) => Promise<Response>;
  };
}

interface MetricsShape {
  publish?: (data: Record<string, unknown>, opts: { source: string }) => void;
}

interface StateShape {
  selectedFile?: File | null;
  _previewLibraryId?: string | null;
}

interface PreviewRenderSession {
  id: number;
  cancelled: boolean;
  controller: AbortController;
  startedAt: number;
  sourceId: string;
}

interface PreviewSourceSession {
  id: number;
  cancelled: boolean;
  controller: AbortController;
  promise: Promise<boolean>;
}

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  state?: StateShape;
  api?: ApiShape;
  metrics?: MetricsShape;
  params?: { collect?: () => Record<string, unknown> };
  ui?: { bindOnce?: (el: HTMLElement | Window | Document, type: string, fn: EventListener, key: string) => void };
  config?: { previewDurationSec?: number };
};

function checkbox(): HTMLInputElement | null { return document.getElementById('s-livepreview') as HTMLInputElement | null; }
function audioWrap(): HTMLElement | null { return document.getElementById('previewAudioWrap'); }
function chainPane(): HTMLElement | null { return document.getElementById('pasoCadena'); }
function outputPane(): HTMLElement | null { return document.getElementById('pasoSalida'); }

function setState(state: string, text: string, progress: number | null = null): void {
  window.dispatchEvent(new CustomEvent('lgmdm:preview-state', { detail: { state, text, progress } }));
}

function isEnabled(): boolean {
  return checkbox()?.checked === true;
}

function getPreviewDurationSec(): number {
  const configured = Number(lg().config?.previewDurationSec);
  if (Number.isFinite(configured) && configured > 0) {
    return Math.min(configured, DEFAULT_PREVIEW_DURATION_SEC);
  }
  return DEFAULT_PREVIEW_DURATION_SEC;
}

/**
 * Convierte spectrum dict del backend ({sub_bass, bass, low_mid, mid, upper_mid,
 * presence, air}) al array de 6 bandas que espera el dashboard (sub, bass,
 * lowmid, mid, highmid, air). Agrupa upper_mid+presence en highmid.
 */
function spectrumToArray(spec: unknown): number[] | null {
  if (Array.isArray(spec)) return spec as number[];
  if (!spec || typeof spec !== 'object') return null;
  const s = spec as Record<string, unknown>;
  const sub = Number(s.sub_bass);
  const bass = Number(s.bass);
  const lowmid = Number(s.low_mid);
  const mid = Number(s.mid);
  const umid = Number(s.upper_mid);
  const pres = Number(s.presence);
  const air = Number(s.air);
  const highmid = (Number.isFinite(umid) && Number.isFinite(pres))
    ? (umid + pres) / 2
    : (Number.isFinite(umid) ? umid : pres);
  const arr = [sub, bass, lowmid, mid, highmid, air];
  if (arr.every((v) => Number.isFinite(v))) return arr;
  return null;
}

// ── Estado del módulo ──────────────────────────────────────────────

let running = false;
let activePromise: Promise<boolean> | null = null;
let renderSession: PreviewRenderSession | null = null;
let sourceSession: PreviewSourceSession | null = null;
let sessionSeq = 0;
let sourceSeq = 0;
let requestTimer: number | null = null;
let ready = false;
let previewUrl: string | null = null;
let previewSourceId: string | null = null;
let previewSourceMeta: { duration_sec: number; source_sha256: string | null } | null = null;
let previewTelemetry: Record<string, unknown> | null = null;
let metricsPollTimer: number | null = null;
let wired = false;

const controller = new AbortController();
const { signal } = controller;

// ── Audio lifecycle ──────────────────────────────────────────────────

function clearPreviewAudio(): void {
  const wrap = audioWrap();
  if (wrap) {
    wrap.querySelectorAll('audio').forEach((audio) => {
      try { audio.pause(); } catch (_) { /* ignore */ }
      try {
        audio.removeAttribute('src');
        audio.load();
      } catch (_) { /* ignore */ }
    });
    wrap.replaceChildren();
  }
  if (previewUrl) {
    try { URL.revokeObjectURL(previewUrl); } catch (_) { /* ignore */ }
    previewUrl = null;
  }
  ready = false;
  window.dispatchEvent(new CustomEvent('lgmdm:preview-ready', { detail: { ready: false } }));
}

function clearSourceSnapshot(): void {
  previewSourceId = null;
  previewSourceMeta = null;
  window.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
    detail: { state: 'empty', sourceId: null, meta: null },
  }));
}

function renderAudio(blob: Blob): void {
  if (!(blob instanceof Blob) || blob.size === 0) {
    throw new Error('El servidor devolvió un Preview vacío');
  }
  const wrap = audioWrap();
  if (!wrap) throw new Error('Contrato DOM roto: #previewAudioWrap no existe');

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
  window.dispatchEvent(new CustomEvent('lgmdm:preview-ready', {
    detail: { ready: true, audio, sourceId: previewSourceId },
  }));
}

function isRenderActive(candidate: PreviewRenderSession | null): boolean {
  return !!candidate && renderSession === candidate && !candidate.cancelled;
}

function isSourceActive(candidate: PreviewSourceSession | null): boolean {
  return !!candidate && sourceSession === candidate && !candidate.cancelled;
}

function cancelRender(): void {
  const current = renderSession;
  if (current) {
    current.cancelled = true;
    try { current.controller.abort(); } catch (_) { /* ignore */ }
  }
  renderSession = null;
  running = false;
  activePromise = null;
}

function cancelSource(): void {
  const current = sourceSession;
  if (current) {
    current.cancelled = true;
    try { current.controller.abort(); } catch (_) { /* ignore */ }
  }
  sourceSession = null;
}

function stop(options: { silent?: boolean; cancelSource?: boolean; keepSource?: boolean } = {}): void {
  if (requestTimer) clearTimeout(requestTimer);
  requestTimer = null;
  cancelRender();
  stopMetricsPolling();
  if (options.cancelSource) cancelSource();
  clearPreviewAudio();
  if (!options.keepSource) clearSourceSnapshot();
  if (!options.silent) setState('disabled', 'Preview detenido');
}

// ── FIX 1: Live metrics polling (GR + LUFS bars) ─────────────────────

function flattenTelemetry(telemetry: Record<string, unknown>): Record<string, unknown> {
  let flat = telemetry;
  if (telemetry.meters) flat = Object.assign({}, telemetry, telemetry.meters);
  const post = (flat.post_limiter as Record<string, unknown> | undefined) ||
    ((flat.chain_meters as Record<string, unknown> | undefined) &&
      ((flat.chain_meters as Record<string, unknown>).post_limiter as Record<string, unknown>));
  if (post) {
    if (post.peak_db != null && flat.peak_db == null) flat.peak_db = post.peak_db;
    if (post.rms_db != null && flat.rms_db == null) flat.rms_db = post.rms_db;
    if (post.lufs != null && flat.lufs == null) flat.lufs = post.lufs;
    if (post.stereo_correlation != null && flat.stereo_correlation == null) flat.stereo_correlation = post.stereo_correlation;
  }
  const aa = flat.analysis_after as Record<string, unknown> | undefined;
  if (aa) {
    if (aa.true_peak_db != null && flat.true_peak_db == null) flat.true_peak_db = aa.true_peak_db;
    if (aa.mono_compatibility_db != null && flat.mono_compatibility_db == null) flat.mono_compatibility_db = aa.mono_compatibility_db;
    if (aa.spectrum && flat.spectrum == null) flat.spectrum = spectrumToArray(aa.spectrum);
  }
  if (flat.spectrum && !Array.isArray(flat.spectrum)) flat.spectrum = spectrumToArray(flat.spectrum);
  return flat;
}

async function pollMetrics(): Promise<void> {
  if (!isEnabled() || !previewSourceId) {
    stopMetricsPolling();
    return;
  }
  const api = lg().api;
  if (!api) return;
  try {
    const res = await api.client.get(
      `${api.apiBase()}/preview/meters/${encodeURIComponent(previewSourceId)}`,
      { timeoutMs: 5000, maxRetries: 0 }
    );
    if (!res.ok) return;
    const data = await res.json() as Record<string, unknown>;
    if (data && typeof lg().metrics?.publish === 'function') {
      const flat = flattenTelemetry(data);
      try { lg().metrics!.publish!(flat, { source: 'preview-live-poll' }); } catch (_) { /* ignore */ }
    }
  } catch (_) {
    /* telemetría opcional — no bloquear el ciclo */
  }
}

function startMetricsPolling(): void {
  if (metricsPollTimer) return;
  if (!isEnabled() || !previewSourceId) return;
  void pollMetrics();
  metricsPollTimer = window.setInterval(() => { void pollMetrics(); }, METRICS_POLL_MS);
}

function stopMetricsPolling(): void {
  if (metricsPollTimer) {
    clearInterval(metricsPollTimer);
    metricsPollTimer = null;
  }
}

// ── createOriginalSnapshot ────────────────────────────────────────────

async function createOriginalSnapshot(): Promise<boolean> {
  if (!isEnabled() || !lg().state?.selectedFile) return false;
  if (previewSourceId) return true;
  if (sourceSession?.promise) return sourceSession.promise;

  cancelSource();
  const current: PreviewSourceSession = {
    id: ++sourceSeq,
    cancelled: false,
    controller: new AbortController(),
    promise: Promise.resolve(false),
  };
  sourceSession = current;

  setState('source-processing', `Preparando muestra original de ${getPreviewDurationSec()} s en el servidor…`, 0);
  window.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
    detail: { state: 'processing', sourceId: null, meta: null },
  }));

  current.promise = (async (): Promise<boolean> => {
    try {
      const body = new FormData();
      const selectedFile = lg().state?.selectedFile;
      if (selectedFile) body.append('file', selectedFile);
      body.append('duration_sec', String(getPreviewDurationSec()));
      body.append('output_format', 'wav');
      body.append('output_bit_depth', '24');
      const libraryId = lg().state?._previewLibraryId;
      if (libraryId) body.append('library_id', libraryId);

      const api = lg().api;
      if (!api) throw new Error('API bridge no inicializada');
      const res = await api.client.post(
        `${api.apiBase()}/preview/source`,
        {
          body,
          signal: current.controller.signal,
          timeoutMs: 90000,
          maxRetries: 1,
        }
      );

      if (!isSourceActive(current)) return false;
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const text = await res.text();
          if (text) detail += `: ${text}`;
        } catch (_) { /* ignore */ }
        throw new Error(`No se pudo crear el snapshot original del Preview: ${detail}`);
      }

      const data = await res.json() as { source_id?: string; duration_sec?: number; source_sha256?: string };
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
      window.dispatchEvent(new CustomEvent('lgmdm:preview-source-state', {
        detail: { state: 'ready', sourceId: previewSourceId, meta: previewSourceMeta },
      }));
      return true;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError' || !isSourceActive(current)) return false;
      clearSourceSnapshot();
      setState('error', `Error preparando el snapshot original: ${(error as Error).message}`);
      throw error;
    } finally {
      if (sourceSession === current) sourceSession = null;
    }
  })();

  return current.promise;
}

// ── start() ────────────────────────────────────────────────────────────

async function start(): Promise<boolean> {
  if (!isEnabled()) {
    setState('disabled', 'Preview deshabilitado');
    return false;
  }
  if (!lg().state?.selectedFile) {
    setState('error', 'Cargá un archivo para generar el Preview');
    return false;
  }
  if (running && activePromise) return activePromise;

  const sourceReady = await createOriginalSnapshot();
  if (!sourceReady || !previewSourceId) return false;

  clearPreviewAudio();

  const current: PreviewRenderSession = {
    id: ++sessionSeq,
    cancelled: false,
    controller: new AbortController(),
    startedAt: performance.now(),
    sourceId: previewSourceId,
  };
  renderSession = current;
  running = true;
  setState('processing', `Procesando Preview de ${getPreviewDurationSec()} s en el servidor…`, 0);

  activePromise = (async (): Promise<boolean> => {
    try {
      const collected = typeof lg().params?.collect === 'function' ? lg().params!.collect!() : null;
      if (!collected || typeof collected !== 'object') {
        throw new Error('No se pudo construir el snapshot de parámetros del Preview');
      }

      const payload = {
        preview_source_id: current.sourceId,
        preview_duration_sec: getPreviewDurationSec(),
        params: collected,
      };

      const api = lg().api;
      if (!api) throw new Error('API bridge no inicializada');
      const res = await api.client.post(
        `${api.apiBase()}/preview`,
        {
          headers: { 'Content-Type': 'application/json;charset=UTF-8' },
          body: JSON.stringify(payload),
          signal: current.controller.signal,
          timeoutMs: 90000,
          maxRetries: 1,
        }
      );

      if (!isRenderActive(current)) return false;
      if (!res.ok) {
        let detail = `HTTP ${res.status}`;
        try {
          const text = await res.text();
          if (text) detail += `: ${text}`;
        } catch (_) { /* ignore */ }
        throw new Error(detail);
      }

      let blob: Blob;
      try {
        blob = await res.blob();
      } catch (e) {
        throw new Error(`No se pudo leer el body del preview: ${(e as Error).message}`);
      }
      if (!isRenderActive(current)) return false;

      // FIX BUG: leer preview ID con fallback a source ID.
      const previewId = res.headers.get('X-Preview-ID')
        || res.headers.get('X-Preview-Source-Id')
        || previewSourceId;

      let telemetry: Record<string, unknown> | null = null;
      if (previewId) {
        try {
          const telemetryRes = await api.client.get(
            `${api.apiBase()}/preview/meters/${encodeURIComponent(previewId)}`,
            { signal: current.controller.signal, timeoutMs: 10000, maxRetries: 0 }
          );
          if (telemetryRes.ok) telemetry = await telemetryRes.json();
        } catch (e) {
          console.warn('[preview] telemetry fetch failed:', (e as Error).message);
        }
      } else {
        console.debug('[preview] X-Preview-ID ausente — telemetría omitida (audio se reproduce igual)');
      }

      renderAudio(blob);
      previewTelemetry = telemetry;
      if (typeof lg().metrics?.publish === 'function' && telemetry) {
        const flat = flattenTelemetry(telemetry);
        try { lg().metrics!.publish!(flat, { source: 'preview-telemetry' }); }
        catch (e) { console.warn('[preview] telemetry publish failed:', (e as Error).message); }
      }
      // FIX 1: arrancar polling live de metrics cada 10s (respaldo lento) —
      // los medidores en vivo los alimenta el metering client-side (~30fps);
      // el polling solo refresca campos backend-only.
      startMetricsPolling();
      const audio = audioWrap()?.querySelector('audio');
      window.dispatchEvent(new CustomEvent('lgmdm:preview-telemetry', { detail: { telemetry, audio, previewId: previewId || null } }));
      setState('ready', `Preview de ${getPreviewDurationSec()} s listo para reproducir`, 100);
      return true;
    } catch (error) {
      if ((error as { name?: string })?.name === 'AbortError' || !isRenderActive(current)) return false;
      clearPreviewAudio();
      setState('error', `Error de Preview: ${(error as Error).message}`);
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

// ── scheduleRender / handleParameterChange / handleToggle ─────────────

function scheduleRender(reason = 'parameter-change'): void {
  if (requestTimer) clearTimeout(requestTimer);
  requestTimer = null;
  if (!isEnabled() || !lg().state?.selectedFile) return;

  requestTimer = window.setTimeout(() => {
    requestTimer = null;
    void start().catch((error) => {
      console.debug(`[preview] render failed (${reason})`, error);
    });
  }, DEBOUNCE_MS);

  setState('waiting', `Esperando ${DEBOUNCE_MS / 1000} s sin cambios…`);
}

function teardown(): void {
  if (requestTimer) clearTimeout(requestTimer);
  requestTimer = null;
  // FIX A12: el metricsPollTimer (setInterval de 10s que pollea
  // /preview/meters) no se cancelaba en teardown → seguía polleando
  // después de cambiar de tab (teardown se invoca desde tabs-handler:52).
  stopMetricsPolling();
  cancelRender();
  cancelSource();
  clearPreviewAudio();
}

function handleParameterChange(): void {
  if (!isEnabled() || !lg().state?.selectedFile) return;
  if (requestTimer) clearTimeout(requestTimer);
  requestTimer = null;
  cancelRender();
  scheduleRender('parameter-change');
}

function handleToggle(event: Event): void {
  const ev = event as Event & { isTrusted?: boolean };
  if (ev.isTrusted === false) return;
  if (!isEnabled()) {
    stop({ cancelSource: true });
    return;
  }
  cancelRender();
  clearPreviewAudio();
  scheduleRender('preview-enabled');
  if (previewSourceId) startMetricsPolling();
}

function handleFileSelected(): void {
  if (requestTimer) clearTimeout(requestTimer);
  requestTimer = null;
  cancelRender();
  stopMetricsPolling();
  cancelSource();
  clearPreviewAudio();
  clearSourceSnapshot();
  if (isEnabled()) {
    void createOriginalSnapshot().then((ok) => {
      if (ok && isEnabled() && lg().state?.selectedFile) scheduleRender('file-selected');
    }).catch((error) => {
      console.debug('[preview] original snapshot failed', error);
    });
  } else {
    setState('disabled', 'Preview deshabilitado');
  }
}

function isParameterControl(target: EventTarget | null): boolean {
  const el = target as Element | null;
  if (!el || !(el instanceof Element)) return false;
  if (!el.matches('input, select, textarea')) return false;
  if (el.id === 's-livepreview') return false;
  return Boolean(el.closest('#pasoCadena, #pasoSalida'));
}

function onParameterEvent(event: Event): void {
  if (!isParameterControl(event.target)) return;
  handleParameterChange();
}

function bindWorkspace(): void {
  if (wired) return;
  wired = true;
  const toggle = checkbox();
  const bind = lg().ui?.bindOnce;
  if (typeof bind !== 'function') throw new Error('Preview Controller requiere LGMDM.ui.bindOnce');
  if (!toggle) throw new Error('Contrato DOM roto: #s-livepreview no existe');
  if (!audioWrap()) throw new Error('Contrato DOM roto: #previewAudioWrap no existe');

  bind(toggle, 'change', handleToggle as EventListener, 'server-preview-toggle');
  bind(window, 'lgmdm:file-selected', handleFileSelected as EventListener, 'server-preview-file-selected');

  const chain = chainPane();
  const output = outputPane();
  [chain, output].forEach((pane, index) => {
    if (!pane) {
      throw new Error(`Contrato DOM roto: panel de parámetros #${index === 0 ? 'pasoCadena' : 'pasoSalida'} no existe`);
    }
    bind(pane, 'input', onParameterEvent as EventListener, `server-preview-param-input-${index}`);
    bind(pane, 'change', onParameterEvent as EventListener, `server-preview-param-change-${index}`);
  });
}

// ── API pública ───────────────────────────────────────────────────────

const previewControllerApi = {
  start,
  stop,
  teardown,
  request: scheduleRender,
  isEnabled,
  isRunning: () => running,
  isReady: () => ready,
  getAudio: () => audioWrap()?.querySelector('audio[data-preview-ready="true"]') as HTMLAudioElement | null,
  setServerState: setState,
  getDurationSec: getPreviewDurationSec,
  getSourceId: () => previewSourceId,
  getSourceMeta: () => previewSourceMeta,
  debounceMs: DEBOUNCE_MS,
};

const wLGMDM = lg();
wLGMDM.previewController = { ...((wLGMDM.previewController as Record<string, unknown>) || {}), ...previewControllerApi };
(wLGMDM as Record<string, unknown>).previewWorkspace = { startPreview: start, stopPreview: stop };

// HMR idempotency
(wLGMDM as Record<string, unknown>).previewControllerBound = true;

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { bindWorkspace(); }, { once: true, signal });
} else {
  bindWorkspace();
}

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => {
  teardown();
  stopMetricsPolling();
  controller.abort();
}, { once: true });

// FIX A2: había `void config;` (variable inexistente → habría sido
// ReferenceError en runtime, tree-shakeado por Rollup) y `void spectrumToArray;`
// (la función SÍ se usa dentro de flattenTelemetry, no necesita este perk).
// El comentario original "Silenciar warning de variable no usada" mentía:
// tsconfig tiene noUnusedLocals: false, no hay warning que silenciar.
