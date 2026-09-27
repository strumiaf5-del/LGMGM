// view.ts — analysis tab renderer. Port of aporte/js/29-analysis-view.js.

import { apiUrl } from '../../core/api';
import { escapeHtml } from '../../core/ui';
import { getPrefersReducedMotion } from '../../core/utils';

// ── Types ─────────────────────────────────────────────────────

/** Espectro FFT devuelto por el servidor (subset que este módulo toca). */
export interface FftSpectrum {
  magnitudes_db?: number[];
  [key: string]: unknown;
}

/** Serie que se le pasa al renderer `window.renderFFT`. */
export interface FftSeries {
  label: string;
  data: FftSpectrum;
  color?: string;
}

/**
 * Payload del endpoint `/analysis`. Solo tipamos los campos que este
 * módulo lee directamente (`fft_spectrum`); el resto viaja como
 * `unknown` (nunca `any`) porque los renderers legacy (`@ts-nocheck`)
 * leen muchos campos y este módulo solo se los reenvía.
 */
export interface ServerAnalysisData {
  fft_spectrum?: FftSpectrum;
  [key: string]: unknown;
}

/** Opciones de `requestAnalysis`. */
export interface AnalysisRequestOptions {
  /** Si es `false`, no limpia el contenedor antes de pedir. */
  clear?: boolean;
}

/** Detalle del evento `lgmdm:analysis-state`. */
interface AnalysisStateDetail {
  state?: string;
  text?: string;
  progress?: number | null;
}

/** Firma de `requestAnalysis` (para el bridge `window.requestAnalysis`). */
export type RequestAnalysisFn = (
  options?: AnalysisRequestOptions,
) => Promise<ServerAnalysisData | null>;

/** API pública expuesta en `window.LGMDM.analysis`. */
export interface AnalysisApi {
  update: (data: ServerAnalysisData) => void;
  render: (data: ServerAnalysisData) => void;
  request: RequestAnalysisFn;
  clear: () => void;
  redraw: () => void;
  teardown: () => void;
}

/** Slice de `window.LGMDM.state` que este módulo consume. */
interface LgmdmStateSlice {
  selectedFile?: File | null;
  getSelectedFile?: () => File | null;
}

/** Slice de `window.LGMDM.api` que este módulo consume. */
interface LgmdmApiSlice {
  authHeaders?: (extra?: HeadersInit, method?: string) => Record<string, string>;
  apiBase?: () => string;
}

/** Slice del namespace global que este módulo lee/escribe. */
interface LgmdmGlobal {
  api?: LgmdmApiSlice;
  state?: LgmdmStateSlice;
  analysis?: AnalysisApi;
  analysisViewBound?: boolean;
}

// ── Window globals (legacy renderers + requestAnalysis) ───────
// Los renderers `renderAnalysisSingle` / `renderFFT` los provee el
// módulo `visualizer-helpers` (legacy, `@ts-nocheck`). Los tipamos
// acá para que este módulo los consuma de forma segura.
declare global {
  interface Window {
    renderAnalysisSingle?: (data: ServerAnalysisData) => void;
    renderFFT?: (series: FftSeries[]) => void;
    requestAnalysis?: RequestAnalysisFn;
  }
}

// ── Constants ─────────────────────────────────────────────────

const REQUEST_TIMEOUT_MS = 60_000;
const ANALYSIS_ENDPOINT = '/analysis';

/** Skeleton animado (líneas con CSS animation) mostrado al procesar. */
const SKELETON_ANIMATED = `<div class="skeleton-loader" aria-busy="true" aria-label="Analizando audio">
  <div class="skeleton-line skeleton-line--lg"></div>
  <div class="skeleton-line skeleton-line--md"></div>
  <div class="skeleton-line skeleton-line--sm"></div>
  <div class="skeleton-line skeleton-line--md"></div>
  <div class="skeleton-line skeleton-line--sm"></div>
</div>`;

/** Skeleton estático (sin animación) para `prefers-reduced-motion`. */
const SKELETON_STATIC = `<div class="skeleton-loader" aria-busy="true" aria-label="Analizando audio"><p>Analizando audio…</p></div>`;

// ── LGMDM namespace accessor ──────────────────────────────────

function lgmdm(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

// ── DOM helper ────────────────────────────────────────────────

function qs(id: string): HTMLElement | null {
  return document.getElementById(id);
}

/** Type guard: ¿es un objeto plano (no null/primitiva)? */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
}

// ── Module state ──────────────────────────────────────────────

let requestSeq = 0;
let requestedFile: File | null = null;
let lastData: ServerAnalysisData | null = null;
let analysisRaf = 0;
let teardownDone = false;

/** Único signal de disposal para todos los listeners registrados. */
const teardownController = new AbortController();

/** Controllers de requests en vuelo — teardown los aborta a todos. */
const inflightControllers = new Set<AbortController>();

// ── Selected file (state bridge) ─────────────────────────────
// El aporte usa `LG.state?.getSelectedFile?.()`; el resto del TS usa
// `LGMDM.state?.selectedFile`. Soportamos ambos, con guards tipo-safe.
function getSelectedFile(): File | null {
  const st = lgmdm().state;
  if (!st) return null;
  try {
    if (typeof st.getSelectedFile === 'function') {
      const f = st.getSelectedFile();
      return f instanceof File ? f : null;
    }
  } catch {
    /* ignore — fall through to property */
  }
  return st.selectedFile instanceof File ? st.selectedFile : null;
}

// ── Auth headers para el upload FormData ──────────────────────
// Reutiliza el bridge `window.LGMDM.api.authHeaders` (token + CSRF)
// pero le strips el `Content-Type` default (`application/json`) para
// que el navegador setee el boundary multipart del FormData.
function buildAuthHeaders(method: 'POST'): Record<string, string> {
  const api = lgmdm().api;
  const headers: Record<string, string> = api?.authHeaders
    ? api.authHeaders({}, method)
    : {};
  delete headers['Content-Type'];
  delete headers['content-type'];
  return headers;
}

// ── Status + skeleton ─────────────────────────────────────────

function setStatus(state: string, text: string, progress: number | null = null): void {
  // El aporte hacía `if (!status) return;` que, al estar el bloque del
  // skeleton después, también lo salteaba. Mantenemos el update del
  // elemento de status opcional pero dejamos que el skeleton renderice
  // de forma independiente, así el estado "procesando" es visible y el
  // respeto de `prefers-reduced-motion` es efectivo.
  const status = qs('analysisStatus');
  if (status) {
    status.textContent =
      progress != null
        ? `${state.toUpperCase()} ${Math.round(progress)}%`
        : state.toUpperCase();
    status.classList.toggle('processing', state === 'processing');
    status.classList.toggle('ready', state === 'ready');
    status.classList.toggle('error', state === 'error');
    status.title = text || '';
  }

  // Skeleton loader mientras el server-side procesa.
  const container = qs('analysisDynamicContent');
  if (container && state === 'processing' && container.dataset.skeleton !== '1') {
    container.dataset.skeleton = '1';
    // Honra prefers-reduced-motion: las skeleton-lines animan por CSS;
    // si el usuario pide movimiento reducido, inyectamos un placeholder
    // estático en su lugar.
    container.innerHTML = getPrefersReducedMotion() ? SKELETON_STATIC : SKELETON_ANIMATED;
  } else if (container && state !== 'processing') {
    delete container.dataset.skeleton;
  }
}

// ── Render server analysis ────────────────────────────────────

export function renderServerAnalysis(data: ServerAnalysisData): void {
  if (!isPlainObject(data)) {
    throw new Error('El servidor devolvió un análisis inválido');
  }
  const dynamic = qs('analysisDynamicContent');
  if (!dynamic) throw new Error('Contrato DOM roto: #analysisDynamicContent no existe');
  if (typeof window.renderAnalysisSingle === 'function') {
    window.renderAnalysisSingle(data);
  } else {
    throw new Error('Renderizador server-analysis no disponible');
  }
  const spectrum = data.fft_spectrum;
  if (spectrum && typeof window.renderFFT === 'function') {
    window.renderFFT([{ label: 'Espectro del servidor', data: spectrum }]);
  }
}

// ── Clear dynamic content + idle status ───────────────────────

function clearContent(): void {
  const target = qs('analysisDynamicContent');
  if (target) target.replaceChildren();
  setStatus('idle', 'Esperando análisis del servidor');
}

// ── Request analysis from the server ──────────────────────────

export async function requestAnalysis(
  options: AnalysisRequestOptions = {},
): Promise<ServerAnalysisData | null> {
  const file = getSelectedFile();
  if (!(file instanceof File)) {
    throw new Error('No existe archivo seleccionado para el análisis server-side');
  }
  const seq = ++requestSeq;
  requestedFile = file;
  if (options.clear !== false) clearContent();
  setStatus('processing', 'Análisis completo en servidor…');

  // Per-request controller: 60s de timeout + linkeado al teardown signal.
  const controller = new AbortController();
  inflightControllers.add(controller);
  const signal = controller.signal;
  const onTeardown = (): void => {
    try {
      controller.abort();
    } catch {
      /* ignore */
    }
  };
  teardownController.signal.addEventListener('abort', onTeardown, { once: true });
  let timeoutId: ReturnType<typeof setTimeout> | null = setTimeout(
    () => {
      try {
        controller.abort();
      } catch {
        /* ignore */
      }
    },
    REQUEST_TIMEOUT_MS,
  );

  try {
    const body = new FormData();
    body.append('file', file, file.name);
    const headers = buildAuthHeaders('POST');
    const res = await fetch(apiUrl(ANALYSIS_ENDPOINT), {
      method: 'POST',
      body,
      headers,
      credentials: 'include',
      signal,
    });
    // Race-check: si llegó un request más nuevo o cambió el archivo, descartar.
    if (seq !== requestSeq || requestedFile !== getSelectedFile()) return null;
    if (!res.ok) {
      let detail = `HTTP ${res.status}`;
      try {
        const text = await res.text();
        if (text) detail += `: ${text}`;
      } catch {
        /* ignore — non-text body */
      }
      throw new Error(`Análisis server-side rechazado: ${detail}`);
    }
    const data = (await res.json()) as ServerAnalysisData;
    if (seq !== requestSeq || requestedFile !== getSelectedFile()) return null;
    lastData = data;
    renderServerAnalysis(data);
    setStatus('ready', 'Análisis completo del servidor disponible');
    window.dispatchEvent(
      new CustomEvent('lgmdm:analysis-state', {
        detail: { state: 'ready', text: 'Análisis completo del servidor disponible', progress: 100 },
      }),
    );
    window.dispatchEvent(new CustomEvent('analysis-updated', { detail: data }));
    return data;
  } catch (err) {
    if (seq === requestSeq) {
      const message = err instanceof Error ? err.message : 'Error desconocido';
      setStatus('error', message);
      // F5.11 — Empty state con retry.
      const container = qs('analysisDynamicContent');
      if (container) {
        container.innerHTML = `<div class="empty-state" role="alert">
  <div class="empty-state-icon" aria-hidden="true">⚠</div>
  <h3>No se pudo analizar el audio</h3>
  <p>${escapeHtml(message)}</p>
  <button class="btn btn-primary" type="button" id="analysisRetryBtn">Reintentar análisis</button>
</div>`;
        const retryBtn = container.querySelector<HTMLButtonElement>('#analysisRetryBtn');
        retryBtn?.addEventListener('click', () => {
          void requestAnalysis({ clear: true }).catch((e) => {
            console.debug('[analysis] retry failed', e);
          });
        });
      }
    }
    throw err;
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    teardownController.signal.removeEventListener('abort', onTeardown);
    inflightControllers.delete(controller);
  }
}

// ── Teardown ─────────────────────────────────────────────────

export function teardownAnalysisView(): void {
  if (teardownDone) return;
  teardownDone = true;
  // Desregistra todos los listeners atados al signal en un solo abort.
  try {
    teardownController.abort();
  } catch {
    /* ignore */
  }
  // Cancela el redraw rAF pendiente.
  if (analysisRaf) {
    cancelAnimationFrame(analysisRaf);
    analysisRaf = 0;
  }
  // Aborta todo request en vuelo (timeout/teardown).
  inflightControllers.forEach((c) => {
    try {
      c.abort();
    } catch {
      /* ignore */
    }
  });
  inflightControllers.clear();
  // Invalida cualquier request pendiente y limpia el canvas/contenido.
  requestSeq += 1;
  lastData = null;
  requestedFile = null;
  try {
    clearContent();
  } catch {
    /* ignore */
  }
}

// ── Listener registration ────────────────────────────────────

function registerListeners(): void {
  // Workspace tab clicks → al mostrar el tab Analysis, re-pedir análisis
  // (clear: false para no limpiar si ya hay datos). Coexiste con el
  // redraw que hace `workspace-tabs.ts` (mismo patrón que el aporte).
  document.querySelectorAll<HTMLElement>('.lg-workspace-workspace-tab').forEach((tab) => {
    tab.addEventListener(
      'click',
      () => {
        try {
          if (tab.dataset.workspace !== 'analysis') return;
          if (analysisRaf) cancelAnimationFrame(analysisRaf);
          analysisRaf = requestAnimationFrame(() => {
            analysisRaf = 0;
            try {
              const req = lgmdm().analysis?.request;
              if (typeof req === 'function') {
                void req({ clear: false }).catch((error) => {
                  console.debug('[analysis] workspace request failed', error);
                });
              }
            } catch (error) {
              console.debug('[analysis] workspace request threw', error);
            }
          });
        } catch (error) {
          console.debug('[analysis] tab click handler failed', error);
        }
      },
      { signal: teardownController.signal },
    );
  });

  window.addEventListener(
    'lgmdm:analysis-state',
    (event) => {
      try {
        const detail = (event as CustomEvent<AnalysisStateDetail>).detail || {};
        setStatus(detail.state || 'idle', detail.text || '', detail.progress ?? null);
      } catch (error) {
        console.debug('[analysis] lgmdm:analysis-state handler failed', error);
      }
    },
    { signal: teardownController.signal },
  );

  window.addEventListener(
    'lgmdm:file-selected',
    () => {
      try {
        requestSeq += 1;
        lastData = null;
        requestedFile = null;
        clearContent();
      } catch (error) {
        console.debug('[analysis] lgmdm:file-selected handler failed', error);
      }
    },
    { signal: teardownController.signal },
  );
}

// ── Public API assembly ───────────────────────────────────────

const analysisApi: AnalysisApi = {
  update: renderServerAnalysis,
  render: renderServerAnalysis,
  request: requestAnalysis,
  clear: () => {
    lastData = null;
    requestedFile = null;
    requestSeq += 1;
    clearContent();
  },
  redraw: () => {
    if (lastData) renderServerAnalysis(lastData);
  },
  teardown: teardownAnalysisView,
};

const g = lgmdm();
g.analysis = Object.assign(g.analysis ?? {}, analysisApi) as AnalysisApi;

// Bridge legacy: `window.requestAnalysis` (el aporte lo exponía así).
window.requestAnalysis = requestAnalysis;

// ── Boot (idempotent) ─────────────────────────────────────────

if (!g.analysisViewBound) {
  g.analysisViewBound = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerListeners, {
      once: true,
      signal: teardownController.signal,
    });
  } else {
    registerListeners();
  }
}

// Limpieza al descargar la página.
window.addEventListener('beforeunload', teardownAnalysisView, { once: true });
