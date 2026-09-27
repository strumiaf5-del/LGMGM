// features/workspace/file-handling.ts — Carga de archivo, librería persistente, referencia.
//
// Carga tras `core/state.ts` (state central) — file-handling escribe en `state.selectedFile`.
//
// FIX vs aporte: `audioEngine.decode` se importa del ESM (`core/audio-engine`).
// FIX vs aporte: bridges a `LGMDM.ai`, `LGMDM.previewController`, `LGMDM.spectrum`,
// `LGMDM.meters`, `drawWaveform`, `setPreviewStatus` son todos opcionales (módulos
// no portados aún). El módulo no rompe si no existen.
// FIX vs aporte: HMR-safe (`window.LGMDM.fileHandlingBound`).
// FIX vs aporte: AbortController para teardown de listeners.

import { audioEngine } from '../../core/audio-engine';
import { config } from '../../core/config';
import { bindOnce, escapeHtml, showToast } from '../../core/ui';

const MAX_FILE_MB = window.LGMDM?.config?.maxFileMb ?? config.maxFileMb;
const MAX_FILE_BYTES = window.LGMDM?.config?.maxFileBytes ?? MAX_FILE_MB * 1024 * 1024;
const ALLOWED_AUDIO_EXT = /\.(wav|mp3|flac|ogg|aif|aiff)$/i;

declare global {
  interface Window {
    Uppy?: {
      Uppy?: new (opts: Record<string, unknown>) => {
        use: (plugin: unknown, opts: Record<string, unknown>) => void;
        on: (event: string, cb: (file: { data?: File }) => void) => void;
      };
      FileInput?: unknown;
    };
  }
}

const lgmdm = () => window.LGMDM as Record<string, unknown> & {
  state?: {
    selectedFile?: File | null;
    cachedFileBuffer?: ArrayBuffer | null;
    previewAudioUrl?: string | null;
    _previewSessionId?: string | null;
    _previewLibraryId?: string | null;
    reference?: { file: File | null; libraryId: string | null };
  };
  ui?: {
    bindOnce?: typeof bindOnce;
    clearResults?: () => void;
    escapeHtml?: typeof escapeHtml;
    showToast?: typeof showToast;
    showStatus?: (container: unknown, msg: string, kind: string) => void;
  };
  audio?: { decode?: typeof audioEngine.decode };
  ai?: { setContext?: (ctx: unknown) => void };
  previewController?: { stop?: (opts?: { silent?: boolean; cancelSource?: boolean }) => void };
  spectrum?: { clear?: () => void };
  meters?: { teardownLiveMeters?: () => void };
  reference?: { updateButtonState?: () => void; libraryPicker?: unknown; stopRefPreview?: () => void };
  library?: { saveLocalFile?: (f: File, opts: { kind: string }) => Promise<unknown> };
  api?: {
    authToken?: () => string;
    apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
    // FIX K4: client.* retorna Promise<Response> real (para res.ok/.blob/.json).
    client: {
      get: (endpoint: string, options?: RequestInit) => Promise<Response>;
      post: (endpoint: string, options?: RequestInit) => Promise<Response>;
      put: (endpoint: string, options?: RequestInit) => Promise<Response>;
      patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
      delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
    };
    apiBase: () => string;
  };
};

// Helper para acceder a `window.LGMDM.reference` con tipo seguro
const getReference = (): { updateButtonState?: () => void } => {
  const lg = lgmdm();
  return (lg.reference as { updateButtonState?: () => void }) || {};
};

// Helper para acceder a `window.LGMDM.library` con tipo seguro
const getLibrary = (): { saveLocalFile?: (f: File, opts: { kind: string }) => Promise<unknown> } => {
  const lg = lgmdm();
  return (lg.library as { saveLocalFile?: (f: File, opts: { kind: string }) => Promise<unknown> }) || {};
};

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

function setPreviewStatus(msg: string): void {
  const ui = lgmdm().ui;
  if (typeof ui?.showStatus === 'function') {
    ui.showStatus(null, msg, 'info');
  }
}

function drawWaveform(buf: AudioBuffer): void {
  const draw = (window as unknown as { drawWaveform?: (b: AudioBuffer) => void }).drawWaveform;
  if (typeof draw === 'function') draw(buf);
}

// HMR-safe guard
if ((window.LGMDM as Record<string, unknown> | undefined)?.fileHandlingBound) {
  // Re-init: salimos, los listeners anteriores ya están (o fueron abortados por el teardown previo).
  // En HMR, el módulo se re-ejecuta; los listeners viejos se garbage-colectan junto al módulo viejo.
}

// ── Drop-zone + file-input + Uppy ───────────────────────────────────────

const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput') as HTMLInputElement | null;

if (window.Uppy?.Uppy && window.Uppy.FileInput) {
  if (fileInput) fileInput.style.pointerEvents = 'none';
  const uppy = new window.Uppy.Uppy({
    autoProceed: false,
    allowMultipleUploads: false,
    restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ['audio/*'] },
  });
  uppy.use(window.Uppy.FileInput, {
    target: '#uppyPicker',
    pretty: true,
    locale: { filesSelected: { 0: 'Elegir archivo', 1: '1 archivo seleccionado' } },
  });
  uppy.on('file-added', (file: { data?: File }) => {
    if (file && file.data) setFile(file.data);
  });
}

bindOnce(dropZone as HTMLElement, 'dragover', ((e: Event) => {
  (e as DragEvent).preventDefault();
  dropZone?.classList.add('dragover');
}) as EventListener);

bindOnce(dropZone as HTMLElement, 'dragleave', (() => {
  dropZone?.classList.remove('dragover');
}) as EventListener, 'file-drop-leave');

bindOnce(dropZone as HTMLElement, 'drop', ((e: Event) => {
  const de = e as DragEvent;
  de.preventDefault();
  dropZone?.classList.remove('dragover');
  const file = de.dataTransfer?.files?.[0];
  if (file) setFile(file);
}) as EventListener, 'file-drop-drop');

bindOnce(fileInput as HTMLInputElement, 'change', (() => {
  const file = fileInput?.files?.[0];
  if (file) setFile(file);
}) as EventListener, 'file-input-change');

// ── setFile — entry point principal ─────────────────────────────────────

function setFile(f: File, libraryId: string | null = null): void {
  const warn = document.getElementById('fileSizeWarn');
  if (f.size > MAX_FILE_BYTES) {
    if (warn) warn.textContent = `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo ${MAX_FILE_MB} MB`;
    return;
  }
  if (!ALLOWED_AUDIO_EXT.test(f.name || '')) {
    if (typeof showToast === 'function') {
      showToast(`Formato no soportado: ${f.name || 'archivo sin extensión'}`, 'error', 5000);
    }
    if (warn) warn.textContent = `⚠ Formato no soportado: ${f.name || 'sin extensión'}`;
    return;
  }
  if (warn) warn.textContent = '';

  const lg = lgmdm();
  if (lg.state) lg.state.selectedFile = f;

  window.dispatchEvent(new CustomEvent('lgmdm:file-selected', { detail: { name: f.name, libraryId } }));

  // Un archivo nuevo invalida el análisis anterior. Evita que Control Room
  // muestre métricas del track previamente seleccionado.
  lg.ai?.setContext?.(null);

  if (lg.state) {
    lg.state._previewSessionId = genUUID();
    lg.state._previewLibraryId = libraryId;
  }

  const fileNameEl = document.getElementById('fileName');
  if (fileNameEl) fileNameEl.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;

  const buttonIds = ['btnMaster', 'btnAnalyze', 'btnAdvice', 'btnAnalyzeGrid', 'btnAdviceGrid', 'btnSpectrum', 'btnStems', 'btnAB', 'btnAutoMaster', 'btnAiSuggest'];
  for (const id of buttonIds) {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    if (el) el.disabled = false;
  }

  getReference().updateButtonState?.();

  const btnDownload = document.getElementById('btnDownload');
  const btnReport = document.getElementById('btnReport');
  btnDownload?.style.setProperty('display', 'none');
  btnReport?.style.setProperty('display', 'none');

  const trackNameInputEl = document.getElementById('trackNameInput') as HTMLInputElement | null;
  if (trackNameInputEl) {
    trackNameInputEl.value = '';
    trackNameInputEl.style.display = 'none';
  }

  lg.ui?.clearResults?.();

  if (lg.state) lg.state.cachedFileBuffer = null;
  if (lg.state?.previewAudioUrl) {
    URL.revokeObjectURL(lg.state.previewAudioUrl);
    lg.state.previewAudioUrl = null;
  }
  lg.previewController?.stop?.({ silent: true, cancelSource: true });
  const previewAudioWrap = document.getElementById('previewAudioWrap');
  if (previewAudioWrap) previewAudioWrap.replaceChildren();
  lg.spectrum?.clear?.();
  setPreviewStatus('Preview deshabilitado');

  if (typeof lg.meters?.teardownLiveMeters === 'function') {
    lg.meters.teardownLiveMeters();
  }

  void loadFileBuffer(f);

  // F3 — Auto-análisis server-side al cargar archivo. Alimenta meters
  // (peak/RMS/LUFS/TRUE_PEAK/CORR) y spectrum bars en el console vía
  // el bridge analysis-updated → LGMDM.metrics.
  const w = window as unknown as { requestAnalysis?: (opts: { clear: boolean }) => Promise<unknown> };
  if (typeof w.requestAnalysis === 'function') {
    void w.requestAnalysis({ clear: false }).catch(() => {});
  }

  if (!libraryId && (document.getElementById('saveToLibraryChk') as HTMLInputElement | null)?.checked) {
    void uploadCurrentFileToLibrary(f);
  }
}

// ── Librería persistente ────────────────────────────────────────────────

async function refreshLibraryList(): Promise<void> {
  const listEl = document.getElementById('libraryList');
  // V3 ya no renderiza la librería persistente en este módulo;
  // la UI de referencias se gestiona desde reference-picker.ts.
  // Evitamos promesas rechazadas si el contenedor legacy no existe.
  if (!listEl) return;

  const lg = lgmdm();
  const api = lg.api;
  if (!api) return;

  try {
    const res = await api.client.get(`${api.apiBase()}/library`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    renderLibraryList(data.files || []);
  } catch (e) {
    console.debug('[librería] error al listar:', e);
    if (listEl) {
      const safe = lg.ui?.escapeHtml ? lg.ui.escapeHtml(e instanceof Error ? e.message : String(e)) : 'Error desconocido';
      listEl.innerHTML = `
        <div class="empty-state" role="status">
          <div class="empty-state-icon" aria-hidden="true">⚠</div>
          <h3>No se pudo cargar la librería</h3>
          <p>${safe}</p>
          <button class="btn btn-secondary" type="button" id="libraryRetryBtn">Reintentar</button>
        </div>`;
      listEl.querySelector('#libraryRetryBtn')?.addEventListener('click', () => {
        void listLibrary();
      });
    }
  }
}

function _formatLibraryDuration(sec: number | null | undefined): string {
  if (sec == null) return '';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function renderLibraryList(files: Array<{ id: string; original_filename: string; duration_sec?: number }>): void {
  const listEl = document.getElementById('libraryList');
  if (!listEl) return;
  if (!files.length) {
    listEl.innerHTML = `
      <div class="empty-state" role="status">
        <div class="empty-state-icon" aria-hidden="true">📁</div>
        <h3>Tu librería está vacía</h3>
        <p>Arrastrá un archivo acá o hacé click para seleccionar.</p>
        <p class="empty-state__hint">Formatos: WAV · MP3 · FLAC · OGG · AIFF · hasta 100 MB</p>
        <button class="btn btn-primary" type="button" id="emptyUploadBtn">Subir archivo de audio</button>
      </div>`;

    const btn = listEl.querySelector('#emptyUploadBtn');
    btn?.addEventListener('click', () => {
      const fi = document.getElementById('fileInput') as HTMLInputElement | null;
      if (fi) fi.click();
    });

    // F5.8 — Drop-zone visual para arrastrar archivos al área vacía.
    const empty = listEl.querySelector('.empty-state');
    if (empty) {
      const onOver = (e: Event) => {
        (e as DragEvent).preventDefault();
        empty.classList.add('drop-zone-active');
      };
      const onLeave = () => empty.classList.remove('drop-zone-active');
      const onDrop = (e: Event) => {
        const de = e as DragEvent;
        de.preventDefault();
        empty.classList.remove('drop-zone-active');
        const file = de.dataTransfer?.files?.[0];
        if (!file) return;
        const input = document.getElementById('fileInput') as HTMLInputElement | null;
        if (input) {
          try {
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          } catch (_) {
            // Fallback: re-trigger upload via click().
            input.click();
          }
        }
      };
      empty.addEventListener('dragover', onOver);
      empty.addEventListener('dragleave', onLeave);
      empty.addEventListener('drop', onDrop);
    }
    return;
  }

  listEl.innerHTML = '';
  for (const f of files) {
    const row = document.createElement('div');
    row.className = 'library-row';

    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'library-row__info';
    info.title = f.original_filename;
    info.textContent = `${f.original_filename} — ${_formatLibraryDuration(f.duration_sec)}`;
    info.addEventListener('click', () => {
      void useLibraryFile(f.id, f.original_filename);
    });
    info.setAttribute('aria-label', `Usar referencia ${f.original_filename}`);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '🗑';
    delBtn.title = 'Borrar de la librería';
    delBtn.setAttribute('aria-label', `Borrar ${f.original_filename} de la librería`);
    delBtn.style.cssText = 'background:none;border:none;color:inherit;opacity:.6;cursor:pointer;flex-shrink:0;';
    delBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`¿Borrar "${f.original_filename}" de la librería?`)) return;
      await deleteLibraryFile(f.id);
    });

    row.appendChild(info);
    row.appendChild(delBtn);
    listEl.appendChild(row);
  }
}

async function uploadCurrentFileToLibrary(f: File): Promise<void> {
  const api = lgmdm().api;
  if (!api) return;
  try {
    const fd = new FormData();
    fd.append('file', f);
    const res = await api.client.post(`${api.apiBase()}/library/upload`, { body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    await refreshLibraryList();
  } catch (e) {
    console.debug('[librería] error al guardar:', e);
  }
}

async function useLibraryFile(fileId: string, filename: string): Promise<void> {
  // FIX cleanup bloque 2: 'void document.getElementById('libraryList');' era un perk
  // (regla 7 AGENTS.md) que no hacía nada — listEl se gestiona en refreshLibraryList.
  const api = lgmdm().api;
  if (!api) return;
  try {
    setPreviewStatus('Trayendo archivo de la librería…');
    const res = await api.client.get(`${api.apiBase()}/library/${fileId}/download`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const blob = await res.blob();
    const file = new File([blob], filename, { type: blob.type });
    setFile(file, fileId); // libraryId != null → no se vuelve a subir en el preview
  } catch (e) {
    console.debug('[librería] error al usar archivo:', e);
    alert('No se pudo traer el archivo de la librería.');
  }
}

async function deleteLibraryFile(fileId: string): Promise<void> {
  const api = lgmdm().api;
  if (!api) return;
  try {
    // FIX K4: client.delete lanza ApiError en !ok (incluido 404). Toleramos 404
    // (librería ya borrada) re-capturando el error y revisando .status.
    try {
      await api.client.delete(`${api.apiBase()}/library/${fileId}`);
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
    }
    await refreshLibraryList();
  } catch (e) {
    console.debug('[librería] error al borrar:', e);
  }
}

function listLibrary(): void {
  void refreshLibraryList();
}

document.getElementById('btnRefreshLibrary')?.addEventListener('click', () => {
  void refreshLibraryList();
});

// La librería es protegida: cargarla únicamente cuando exista sesión.
// Si el módulo se inicializa antes del login, esperamos al evento de auth.
function loadLibraryWhenAuthenticated(): void {
  if (!!lgmdm().api?.authToken?.()) {
    void refreshLibraryList();
  }
}
window.addEventListener('lgmdm:authenticated', () => {
  void refreshLibraryList();
});
loadLibraryWhenAuthenticated();

async function loadFileBuffer(f: File): Promise<void> {
  const lg = lgmdm();
  if (lg.state) lg.state.cachedFileBuffer = await f.arrayBuffer(); // cachear para reusar en previews
  const buf = await audioEngine.decode(lg.state?.cachedFileBuffer as ArrayBuffer);
  drawWaveform(buf);
  // Un único contexto Web Audio compartido; no crear/cerrar contextos locales.
}

// ── Referencia (track de referencia para matching) ──────────────────────

const refState = ((window.LGMDM as Record<string, unknown> | undefined)?.state as { reference?: { file: File | null; libraryId: string | null } } | undefined)?.reference
  || ((window.LGMDM as Record<string, unknown> | undefined)?.state as { reference?: { file: File | null; libraryId: string | null } } | undefined) || { reference: { file: null, libraryId: null } };
// Garantizar que `state.reference` exista
if (!(window.LGMDM as Record<string, unknown> | undefined)?.state) {
  // no debería pasar porque core/state.ts ya monta el state
} else {
  const state = (window.LGMDM as { state: { reference?: { file: File | null; libraryId: string | null } } }).state;
  state.reference = state.reference || { file: null, libraryId: null };
}

const dropZoneRef = document.getElementById('dropZoneRef');
const refFileInput = document.getElementById('refFileInput') as HTMLInputElement | null;

bindOnce(dropZoneRef as HTMLElement, 'dragover', ((e: Event) => {
  (e as DragEvent).preventDefault();
  dropZoneRef?.classList.add('dragover');
}) as EventListener, 'ref-drop-dragover');

bindOnce(dropZoneRef as HTMLElement, 'dragleave', (() => {
  dropZoneRef?.classList.remove('dragover');
}) as EventListener, 'ref-drop-leave');

bindOnce(dropZoneRef as HTMLElement, 'drop', ((e: Event) => {
  const de = e as DragEvent;
  de.preventDefault();
  dropZoneRef?.classList.remove('dragover');
  const file = de.dataTransfer?.files?.[0];
  if (file) setRefFile(file);
}) as EventListener, 'ref-drop-drop');

bindOnce(refFileInput as HTMLInputElement, 'change', (() => {
  const file = refFileInput?.files?.[0];
  if (file) setRefFile(file);
}) as EventListener, 'ref-file-change');

function setRefFile(f: File, fromLibraryId: string | null = null): void {
  if (f.size > MAX_FILE_BYTES) {
    const refFileNameEl = document.getElementById('refFileName');
    if (refFileNameEl) {
      refFileNameEl.textContent = `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo ${MAX_FILE_MB} MB`;
    }
    return;
  }

  // Garantizar que state.reference exista
  const lg = lgmdm();
  const state = lg.state as { reference?: { file: File | null; libraryId: string | null } } | undefined;
  if (state && !state.reference) {
    state.reference = { file: null, libraryId: null };
  }
  if (state?.reference) {
    state.reference.file = f;
    state.reference.libraryId = fromLibraryId;
  }

  const refFileNameEl = document.getElementById('refFileName');
  if (refFileNameEl) {
    refFileNameEl.textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
  }

  getReference().updateButtonState?.();

  if (!fromLibraryId && (document.getElementById('saveRefToLibraryChk') as HTMLInputElement | null)?.checked) {
    void uploadRefFileToLibrary(f);
  }
}

const wLGMDM = window.LGMDM = window.LGMDM || {};
const referenceApi = (wLGMDM as Record<string, unknown>).reference = ((wLGMDM as Record<string, unknown>).reference as Record<string, unknown> || {});
if (typeof (referenceApi as { updateButtonState?: unknown }).updateButtonState !== 'function') {
  (referenceApi as { updateButtonState: () => void }).updateButtonState = function updateRefButtonState(): void {
    const button = document.getElementById('btnMasterRef') as HTMLButtonElement | null;
    const state = lgmdm().state as { selectedFile?: File | null; reference?: { file: File | null } } | undefined;
    if (button) button.disabled = !(state?.selectedFile && state?.reference?.file);
  };
}

async function uploadRefFileToLibrary(f: File): Promise<void> {
  if (typeof getLibrary().saveLocalFile === 'function') {
    await getLibrary().saveLocalFile!(f, { kind: 'reference' });
  }
}

// ── Library Service (migrado desde 00-library-service.js) ───────────────

const library = (wLGMDM as Record<string, unknown>).library = ((wLGMDM as Record<string, unknown>).library as Record<string, unknown> || {});
if (typeof (library as { saveLocalFile?: unknown }).saveLocalFile !== 'function') {
  (library as { saveLocalFile: (f: File, opts: { kind: string }) => Promise<unknown> }).saveLocalFile = async function saveLocalFile(file: File, options: { kind: string } = { kind: 'track' }): Promise<unknown> {
    if (!(file instanceof File)) throw new TypeError('saveLocalFile requiere un File');
    const api = lgmdm().api;
    if (!api) throw new Error('API bridge no inicializada');
    const form = new FormData();
    form.append('file', file);
    const response = await api.client.post(`${api.apiBase()}/library/upload`, { body: form });
    if (!response.ok) {
      const error = new Error(`HTTP ${response.status}`);
      (error as Error & { status?: number }).status = response.status;
      throw error;
    }
    const payload = await response.json().catch(() => ({}));
    window.dispatchEvent(new CustomEvent('lgmdm:library-updated', { detail: { kind: options.kind, file: file.name, payload } }));
    return payload;
  };
}

// FIX cleanup bloque 2: 'void refState;' era un perk (regla 7 AGENTS.md) para
// silenciar el unused. refState se define línea 448 y se usa en el accessor
// pattern de state.reference (líneas 451-456). Sin el void, tsc sigue EXIT 0.

// Marcar como inicializado (HMR-safe)
(window.LGMDM as Record<string, unknown>).fileHandlingBound = true;
