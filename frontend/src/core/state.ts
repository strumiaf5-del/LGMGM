// core/state.ts — Estado global, cache de colores, tema, IA estado.
// Side-effect: monta `window.LGMDM.state` (single source of truth).
//
// Auditoría 2026-09-18 eliminó el puente SHARED_KEYS → window.*.
// Para consumir estado: `window.LGMDM.state.selectedFile` (getter/setter via
// Object.defineProperty), `window.LGMDM.state.getSelectedFile()`.

import { config } from './config';

// ── Tipos públicos ────────────────────────────────────────────────────

export interface StemsPayload {
  stems: Record<string, unknown>;
  available: string[];
}

// U-5: branded type para IDs de job. `JobId` es `string` estructuralmente pero
// con un brand fantasma, así no se puede asignar un `string` cualquiera sin
// afirmarlo en la frontera (p.ej. `data.job_id as JobId` donde entra del backend).
// Sólo se aplica a `currentJobId` (scope pedido por U-5).
//
// TP4: `LibraryId` y `SessionId` definidos como branded types para uso futuro,
// PERO no aplicados a los campos de `PublicState` todavía. Razón: los write-sites
// de `_previewLibraryId` / `_previewSessionId` / `reference.libraryId` viven en
// archivos fuera del scope de este agente (`features/workspace/file-handling.ts`
// líneas 178-179, 494; `features/library/reference-picker.ts` línea 263).
// Aplicarlos acá introduciría 4 errores TS en archivos que no puedo editar →
// `tsc --noEmit` no llegaría a 0. Cuando esos archivos se migren, aplicar:
//   `PublicState._previewLibraryId: LibraryId | null`
//   `PublicState._previewSessionId: SessionId | null`
//   `PublicState.reference.libraryId: LibraryId | null`
// y los write-sites con `as LibraryId` / `as SessionId` en la frontera del backend.
export type JobId = string & { readonly __brand: 'JobId' };
export type LibraryId = string & { readonly __brand: 'LibraryId' };
export type SessionId = string & { readonly __brand: 'SessionId' };

export interface PublicState {
  reference: { file: File | null; libraryId: string | null };
  runtime: {
    preview: Record<string, unknown>;
    reference: { file: File | null; libraryId: string | null };
    audio: Record<string, unknown>;
  };
  jobs: {
    mastering: { jobId: string | null; downloadUrl: string | null };
    reference: { jobId: string | null; downloadUrl: string | null };
  };
  selectedFile: File | null;
  lastAnalysisData: Record<string, unknown> | null;
  stems: StemsPayload | null;
  cachedFileBuffer: ArrayBuffer | null;
  _previewLibraryId: string | null;
  _previewSessionId: string | null;
  previewAudioUrl: string | null;
  masteringPollInterval: number | null;
  referencePollInterval: number | null;
  downloadUrl: string | null;
  /** Descarga el reporte JSON de un job de masterización. */
  downloadReport(jobId: string): Promise<void>;
  getSelectedFile(): File | null;
  getLastAnalysis(): Record<string, unknown> | null;
  setStems(payload: StemsPayload | string[] | null): StemsPayload | null;
  clearStems(): void;
}

export interface ThemePalette {
  bg: string;
  surface: string;
  surface2: string;
  surface3: string;
  border: string;
  accent: string;
  accent2: string;
  good: string;
  warn: string;
  danger: string;
  text: string;
  muted: string;
  faint: string;
  panel: string;
  panelStrong: string;
  get(varName: string): string;
}

declare global {
  interface Window {
    LGMDM?: {
      config?: { maxFileBytes?: number; maxFileMb?: number };
      api?: { apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>; apiBase: () => string; client: { get: (e: string, o?: RequestInit) => Promise<Response>; post: (e: string, o?: RequestInit) => Promise<Response>; put: (e: string, o?: RequestInit) => Promise<Response>; patch: (e: string, o?: RequestInit) => Promise<Response>; delete: (e: string, o?: RequestInit) => Promise<Response> } };
      errors?: { handleClientError?: (e: unknown, msg: string, ctx: Record<string, unknown>) => void };
      dom?: { byId: (id: string) => HTMLElement | null };
      state?: PublicState;
      themeColors?: () => ThemePalette;
      formatters?: Readonly<{
        formatDbValue: (v: unknown, digits?: number) => string;
        formatLinearThresholdToDb: (v: unknown, digits?: number) => string;
        genUUID: () => string;
        getTrackBaseName: () => string;
        currentTrackNameParam: () => string;
        prefillTrackNameFromFile: () => void;
      }>;
      aiAssistant?: unknown;
      proFeatures?: unknown;
      metrics?: {
        subscribe?: (cb: (data: { metrics: Record<string, unknown> }) => void) => () => void;
        publish?: (data: Record<string, unknown>, opts: { source: string }) => void;
      };
      audio?: { resume?: () => Promise<void> };
      mixerEngine?: { previewEngine?: { playing?: boolean } };
      ab?: { isPlaying?: () => boolean };
    };
    formatDbValue?: (v: unknown, digits?: number) => string;
    formatLinearThresholdToDb?: (v: unknown, digits?: number) => string;
    genUUID?: () => string;
    getTrackBaseName?: () => string;
    currentTrackNameParam?: () => string;
    prefillTrackNameFromFile?: () => void;
    themeColors?: () => ThemePalette;
    downloadReport?: (jobId: string) => Promise<void>;
  }
}

// ── State privado (closure) ────────────────────────────────────────────

const MAX_FILE_BYTES = window.LGMDM?.config?.maxFileBytes ?? config.maxFileBytes;
const MAX_FILE_MB = window.LGMDM?.config?.maxFileMb ?? config.maxFileMb;

let selectedFile: File | null = null;
let cachedFileBuffer: ArrayBuffer | null = null;
let _previewSessionId: string | null = null;
let _previewLibraryId: string | null = null;
let currentJobId: JobId | null = null;
let downloadUrl: string | null = null;
let _stems: StemsPayload | null = null;

let _themeColorsCache: ThemePalette | null = null;

// Preview (lo usan 30-preview-controller y 10-meters-dashboard).
// U-4: the meters* closure vars that lived here (metersAudioCtx/SourceNode/
// AnalyserL/R/Splitter/RafId/LufsRingBuffer + METERS_LUFS_WINDOW) were leftover
// from a removed live-meters implementation (replaced by timeline-meters.ts).
// They were never assigned — only `|| null` inits + `= null` in teardown — so
// the teardown branches were no-ops. Removed 2026-09-27.
let previewDebounceTimer: number | null = null;
let previewAbortController: AbortController | null = null;
let previewAudioUrl: string | null = null;
let previewWS: WebSocket | null = null;

// AI assistant state (lo usa 11-ai-assistant-ux)
let lastAnalysisData: Record<string, unknown> | null = null;
let aiChatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
let aiAvailable: boolean | null = null;

// FIX A2: los 17 `void x;` de abajo eran perks (regla 7 de AGENTS.md) —
// no silenciaban nada porque tsconfig tiene `noUnusedLocals: false`. Si una
// de estas closure vars se llega a usar, es via `_publicState.X` (la prop
// pública), no via la closure var (que está muerta — bug "estado dual"
// documentado pero no arreglado acá porque requiere análisis del flujo de
// sync).

// ── Utilidades ─────────────────────────────────────────────────────────

// crypto.randomUUID() sólo existe en contextos seguros (HTTPS o localhost).
// Servir por HTTP+IP rompe esa función, así que acá usamos randomUUID si está
// disponible y si no generamos un UUID v4 a mano.
function genUUID(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function formatDbValue(value: unknown, digits = 1): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)} dB`;
}

function formatLinearThresholdToDb(value: unknown, digits = 1): string {
  const db = 20 * Math.log10(Math.max(Number(value), 1e-9));
  return `${db >= 0 ? '+' : ''}${db.toFixed(digits)} dB`;
}

// ── Cache de colores del tema ──────────────────────────────────────────
// Se cachean para evitar getComputedStyle() en cada frame de animación/canvas.
// Se invalida reactivamente ante eventos 'themechange'.
const LEGACY_COLOR_MAP: Record<string, string> = {
  '--bg': '--ui-bg',
  '--bg-2': '--ui-surface',
  '--surface': '--ui-surface',
  '--surface2': '--ui-surface-2',
  '--surface3': '--ui-surface-3',
  '--glass': '--ui-panel',
  '--glass2': '--ui-panel-strong',
  '--border': '--ui-border',
  '--border2': '--ui-border-2',
  '--amber': '--ui-warn',
  '--amber2': '--ui-warn-2',
  '--amber-glow': '--ui-warn-glow',
  '--vu-green': '--ui-good',
  '--vu-yellow': '--ui-warn',
  '--clip-red': '--ui-danger',
  '--cyan': '--ui-accent',
  '--lilac': '--ui-accent-2',
  '--text': '--ui-text',
  '--muted': '--ui-muted',
  '--faint': '--ui-faint',
  '--accent': '--ui-accent',
  '--accent-2': '--ui-accent-2',
  '--green': '--ui-good',
  '--yellow': '--ui-warn',
  '--red': '--ui-danger',
};

function themeColors(): ThemePalette {
  if (_themeColorsCache) return _themeColorsCache;
  const styles = getComputedStyle(document.documentElement);
  const read = (name: string): string => styles.getPropertyValue(name).trim();
  _themeColorsCache = {
    bg: read('--ui-bg'),
    surface: read('--ui-surface'),
    surface2: read('--ui-surface-2'),
    surface3: read('--ui-surface-3'),
    border: read('--ui-border'),
    accent: read('--ui-accent'),
    accent2: read('--ui-accent-2'),
    good: read('--ui-good'),
    warn: read('--ui-warn'),
    danger: read('--ui-danger'),
    text: read('--ui-text'),
    muted: read('--ui-muted'),
    faint: read('--ui-faint'),
    panel: read('--ui-panel'),
    panelStrong: read('--ui-panel-strong'),
    get: (varName: string): string => {
      if (!varName) return '';
      const key = varName.startsWith('--') ? varName : `--${varName}`;
      const mapped = LEGACY_COLOR_MAP[key] || key;
      return read(mapped) || read(key);
    },
  };
  return _themeColorsCache;
}

// ── Nombre del tema para la descarga ───────────────────────────────────

function currentTrackNameParam(): string {
  const input = window.LGMDM?.dom?.byId?.('trackNameInput');
  const val = ((input && (input as HTMLInputElement).value) || '').trim();
  return val ? `?name=${encodeURIComponent(val)}` : '';
}

function getTrackBaseName(): string {
  const input = window.LGMDM?.dom?.byId?.('trackNameInput');
  const val = ((input && (input as HTMLInputElement).value) || '').trim();
  if (val) return val;
  if (selectedFile) return selectedFile.name.replace(/\.[^/.]+$/, '');
  return 'reporte';
}

async function downloadReport(jobId: string): Promise<void> {
  try {
    const api = window.LGMDM?.api;
    if (!api) throw new Error('API bridge no inicializada');
    const res = await api.client.get(`${api.apiBase()}/report/${jobId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${getTrackBaseName()}_reporte.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  } catch (e) {
    window.LGMDM?.errors?.handleClientError?.(e, 'No se pudo descargar el reporte.', { context: 'report-download' });
  }
}

function prefillTrackNameFromFile(): void {
  const input = window.LGMDM?.dom?.byId?.('trackNameInput');
  if (!input || ((input as HTMLInputElement).value || '').trim() || !selectedFile) return;
  const base = selectedFile.name.replace(/\.[^/.]+$/, '');
  (input as HTMLInputElement).value = base;
}

// ── Single source of truth: window.LGMDM.state.* ────────────────────────

window.LGMDM = window.LGMDM || {};
const _publicState = (window.LGMDM.state = (window.LGMDM.state || {}) as PublicState);

_publicState.reference = _publicState.reference || { file: null, libraryId: null };
_publicState.runtime = _publicState.runtime || {
  preview: {},
  reference: _publicState.reference,
  audio: {},
};
_publicState.jobs = _publicState.jobs || {
  mastering: { jobId: null, downloadUrl: null },
  reference: { jobId: null, downloadUrl: null },
};

// selectedFile — getter/setter autoritativo
Object.defineProperty(_publicState, 'selectedFile', {
  get: () => selectedFile,
  set: (value: File | null) => {
    selectedFile = value;
  },
  configurable: true,
});

// lastAnalysisData — getter/setter autoritativo
Object.defineProperty(_publicState, 'lastAnalysisData', {
  get: () => lastAnalysisData,
  set: (value: Record<string, unknown> | null) => {
    lastAnalysisData = value;
  },
  configurable: true,
});

// FIX MX-12 — stems: getter/setter autoritativo. La asignación dispara
// el evento `stems-loaded` para que widgets Pro (cross-demask, etc.)
// actualicen su UI sin polling ni MutationObserver explícito.
Object.defineProperty(_publicState, 'stems', {
  get: () => _stems,
  set: (value: StemsPayload | null) => {
    _stems = value;
    const loaded = !!(value && (value.available?.length || Object.keys(value.stems || {}).length));
    window.dispatchEvent(new CustomEvent('stems-loaded', { detail: { stems: value, loaded } }));
  },
  configurable: true,
});

_publicState.setStems = function setStems(payload: StemsPayload | string[] | null): StemsPayload | null {
  let next: StemsPayload | null = null;
  if (payload == null) {
    next = null;
  } else if (Array.isArray(payload)) {
    next = { stems: {}, available: payload.slice() };
  } else if (typeof payload === 'object') {
    next = {
      stems: payload.stems && typeof payload.stems === 'object' ? payload.stems : {},
      available: Array.isArray(payload.available) ? payload.available.slice() : Object.keys(payload.stems || {}),
    };
  }
  _publicState.stems = next;
  return _publicState.stems;
};

_publicState.clearStems = function clearStems(): void {
  _publicState.stems = null;
};

_publicState.getSelectedFile = function getSelectedFile(): File | null {
  return selectedFile ?? null;
};

_publicState.getLastAnalysis = function getLastAnalysis(): Record<string, unknown> | null {
  return lastAnalysisData ?? null;
};

// Cross-script bridges for plain `<script>` consumers (non-module scope sharing).
_publicState.cachedFileBuffer = _publicState.cachedFileBuffer || null;
_publicState._previewLibraryId = _publicState._previewLibraryId || null;
_publicState._previewSessionId = _publicState._previewSessionId || null;
_publicState.previewAudioUrl = _publicState.previewAudioUrl || null;
_publicState.masteringPollInterval = _publicState.masteringPollInterval || null;
_publicState.referencePollInterval = _publicState.referencePollInterval || null;
_publicState.downloadUrl = _publicState.downloadUrl || null;

_publicState.downloadReport = downloadReport;

// Expose utility functions + theme colors to consumers
window.LGMDM.formatters = Object.freeze({
  formatDbValue,
  formatLinearThresholdToDb,
  genUUID,
  getTrackBaseName,
  currentTrackNameParam,
  prefillTrackNameFromFile,
});
window.LGMDM.themeColors = themeColors;
window.formatDbValue = formatDbValue;
window.formatLinearThresholdToDb = formatLinearThresholdToDb;
window.genUUID = genUUID;
window.getTrackBaseName = getTrackBaseName;
window.currentTrackNameParam = currentTrackNameParam;
window.prefillTrackNameFromFile = prefillTrackNameFromFile;
window.themeColors = themeColors;
window.downloadReport = downloadReport;

// themechange listener — invalida cache de colores del tema
window.addEventListener('themechange', () => {
  _themeColorsCache = null;
});

// HMR-safe re-entry guard
if ((window.LGMDM as Record<string, unknown>).__stateInitialized) {
  // Re-init: limpia lo anterior. Esto es defensivo — el módulo es side-effect.
  _themeColorsCache = null;
}
(window.LGMDM as Record<string, unknown>).__stateInitialized = true;

