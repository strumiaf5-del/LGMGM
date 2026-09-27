// reference-picker.ts — reference library picker. Port of aporte/js/reference-library-picker.js.

import { apiFetch, client, TOKEN_KEY } from '../../core/api';
import type { ApiError } from '../../core/api';
import { escapeHtml } from '../../core/ui';
import { openModal, closeModal } from '../../core/modal-helper';
import { getPrefersReducedMotion } from '../../core/utils';

// ── Types ────────────────────────────────────────────────────────

/** Una referencia indexada en `reference_library/` del servidor. */
export interface ReferenceEntry {
  id: string;
  filename: string;
  duration_sec?: number | null;
  lufs?: number | null;
  peak_db?: number | null;
  sr?: number | null;
}

interface LoadLibraryOptions {
  retryOnAuth?: boolean;
}

/** Respuesta de `GET /reference-library`. */
interface LibraryIndexResponse {
  entries?: ReferenceEntry[];
}

/** API pública del selector, espejada en `window.LGMDM.reference.libraryPicker`. */
export interface LibraryPickerApi {
  open: () => void;
  reload: (options?: LoadLibraryOptions) => Promise<void>;
}

/** Namespace `window.LGMDM.reference` que este módulo lee/escribe. */
interface LgmdmReferenceNamespace {
  /** Invalida la caché de sesión del WS de ref-preview (definido por
   *  08-reference-mastering.js, aún no porteado). */
  onRefFileSelected?: () => void;
  /** Actualiza el botón de preview/submit (definido por 08-reference-mastering). */
  updateRefPreviewBtn?: () => void;
  libraryPicker?: LibraryPickerApi;
  /** FIX G10: Para el preview de referencia (limpieza de state + evento).
   *  master-console.ts:127 lo llama antes de iniciar otro preview. */
  stopRefPreview?: () => void;
}

/** Slice de `window.LGMDM.state.reference` que este módulo escribe. */
interface ReferenceStateObj {
  file: File | null;
  libraryId: string | null;
}

interface LgmdmStateSlice {
  state?: {
    reference?: ReferenceStateObj;
  };
}

interface LgmdmGlobal extends LgmdmStateSlice {
  reference?: LgmdmReferenceNamespace;
  referencePickerBound?: boolean;
}

function lgmdm(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  return w.LGMDM ?? ({} as LgmdmGlobal);
}

/** Type guard para `ApiError` (evita `any`). */
function isApiError(e: unknown): e is ApiError {
  return e instanceof Error && typeof (e as ApiError).status === 'number';
}

function getAuthToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

// ── Module state ──────────────────────────────────────────────────
let _abort: AbortController | null = null;
let _modal: HTMLDivElement | null = null;
let _searchInput: HTMLInputElement | null = null;
let _listEl: HTMLDivElement | null = null;
let _statusEl: HTMLElement | null = null;
let _injectedButton: HTMLButtonElement | null = null;
let _entries: ReferenceEntry[] = [];
let _filtered: ReferenceEntry[] = [];
let _selected: ReferenceEntry | null = null;

/** Garantiza un AbortController vivo para `{ signal }`. Lo recrea después de
 *  un teardown si una operación se invoca manualmente antes de re-init. */
function ensureAbort(): AbortController {
  if (!_abort) _abort = new AbortController();
  return _abort;
}

// ── Helpers de render (null-safe) ──────────────────────────────────
function setStatus(html: string): void {
  if (_statusEl) _statusEl.innerHTML = html;
}

// ── Cargar índice desde el servidor ──────────────────────────────
export async function loadReferenceLibrary(opts: LoadLibraryOptions = {}): Promise<void> {
  const { retryOnAuth = false } = opts;
  // Nunca disparamos una llamada protegida sin sesión disponible.
  const token = getAuthToken();
  if (!token) {
    if (_statusEl) _statusEl.textContent = 'Iniciá sesión para cargar la biblioteca.';
    return;
  }
  try {
    const data = await apiFetch<LibraryIndexResponse>('/reference-library');
    _entries = data.entries ?? [];
    _filtered = [..._entries];
    _renderList();
    if (_entries.length) {
      const n = _entries.length;
      setStatus(
        `<span role="status">${n} referencia${n !== 1 ? 's' : ''} disponible${n !== 1 ? 's' : ''}</span>`,
      );
    } else {
      _renderEmptyState();
    }
  } catch (err) {
    // Reintento silencioso una sola vez si la sesión caducó entre el check y
    // la llamada (401). El aporte reintentaba tras 100ms; se preserva.
    if (isApiError(err) && err.status === 401 && retryOnAuth) {
      await new Promise<void>((r) => setTimeout(r, 100));
      return loadReferenceLibrary({ retryOnAuth: false });
    }
    _renderErrorState(err);
  }
}

function _renderEmptyState(): void {
  setStatus(`
    <div class="empty-state" role="status">
      <div class="empty-state-icon" aria-hidden="true">📂</div>
      <h3>La biblioteca de referencias está vacía</h3>
      <p>Poné tus tracks en la carpeta <code>reference_library/</code> del servidor. Se indexan automáticamente.</p>
      <button class="btn btn-secondary" type="button" id="refLibEmptyRescan">↺ Re-escanear</button>
    </div>`);
  const rescan = _statusEl?.querySelector<HTMLButtonElement>('#refLibEmptyRescan');
  if (!rescan) return;
  rescan.addEventListener('click', () => {
    try {
      setStatus('<div class="skeleton-loader"><div class="skeleton-line skeleton-line--md"></div></div>');
      void _rescan();
    } catch (e) {
      console.error('[reference-picker] empty-rescan handler', e);
    }
  }, { signal: ensureAbort().signal });
}

async function _rescan(): Promise<void> {
  try {
    await client.post('/reference-library/rescan');
    await loadReferenceLibrary();
  } catch (e) {
    if (_statusEl) _statusEl.textContent = 'Error: ' + (e instanceof Error ? e.message : String(e));
  }
}

function _renderErrorState(err: unknown): void {
  const msg =
    err instanceof Error && err.message
      ? err.message
      : err != null
        ? String(err)
        : 'Error desconocido';
  setStatus(`
    <div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠</div>
      <h3>Error cargando la biblioteca</h3>
      <p>${escapeHtml(msg)}</p>
      <button class="btn btn-secondary" type="button" id="refLibRetryBtn">Reintentar</button>
    </div>`);
  const retry = _statusEl?.querySelector<HTMLButtonElement>('#refLibRetryBtn');
  if (!retry) return;
  retry.addEventListener('click', () => {
    try {
      void loadReferenceLibrary({ retryOnAuth: true });
    } catch (e) {
      console.error('[reference-picker] retry handler', e);
    }
  }, { signal: ensureAbort().signal });
}

// ── Filtrar por búsqueda ──────────────────────────────────────────
function _applySearch(value: string): void {
  const q = value.trim().toLowerCase();
  _filtered = q
    ? _entries.filter((e) => e.filename.toLowerCase().includes(q))
    : [..._entries];
  _renderList();
}

// ── Renderizar lista ──────────────────────────────────────────────
function _renderList(): void {
  if (!_listEl) return;
  _listEl.innerHTML = '';
  if (!_filtered.length) {
    _listEl.innerHTML = `<div class="lgjs-centered-empty">Sin resultados</div>`;
    return;
  }
  const signal = ensureAbort().signal;
  for (const entry of _filtered) {
    const isSelected = _selected?.id === entry.id;
    const dur =
      entry.duration_sec != null
        ? Math.floor(entry.duration_sec / 60) +
          ':' +
          String(Math.floor(entry.duration_sec % 60)).padStart(2, '0')
        : '--';
    const lufs = entry.lufs != null ? entry.lufs.toFixed(1) + ' LUFS' : '--';
    const peak = entry.peak_db != null ? entry.peak_db.toFixed(1) + ' dBFS' : '--';
    const sr = entry.sr ? (entry.sr / 1000).toFixed(1) + 'kHz' : '';

    const row = document.createElement('div');
    row.className = 'ref-lib-row' + (isSelected ? ' ref-lib-row--selected' : '');
    const nameEl = document.createElement('div');
    nameEl.className = 'ref-lib-name';
    nameEl.textContent = entry.filename || 'Referencia sin nombre';
    const metaEl = document.createElement('div');
    metaEl.className = 'ref-lib-meta';
    // Se preservan los 4 spans (incluyendo vacíos) para no alterar el layout.
    for (const value of [dur, lufs, peak, sr]) {
      const span = document.createElement('span');
      span.textContent = value;
      metaEl.appendChild(span);
    }
    row.append(nameEl, metaEl);

    const target = entry;
    row.addEventListener(
      'click',
      () => {
        try {
          _selectEntry(target);
        } catch (e) {
          console.error('[reference-picker] row click', e);
        }
      },
      { signal },
    );
    _listEl.appendChild(row);
  }
}

// ── Seleccionar una referencia ────────────────────────────────────
function _selectEntry(entry: ReferenceEntry): void {
  _selected = entry;

  // Actualizar la variable global que usa 08-reference-mastering.js.
  const g = lgmdm();
  const state = g.state ?? {};
  const refState: ReferenceStateObj = state.reference ?? { file: null, libraryId: null };
  refState.libraryId = entry.id;
  refState.file = null; // anular el File subido a mano
  state.reference = refState;
  g.state = state;

  // Mostrar el nombre seleccionado en el label del input de referencia.
  const label =
    document.getElementById('refFileLabel') ||
    document.getElementById('ref-file-label') ||
    document.getElementById('refFileName');
  if (label) label.textContent = '📌 ' + entry.filename;

  // Invalidar caché de sesión del WS de ref-preview (defensivo: la API la
  // define 08-reference-mastering.js, que puede no estar cargado todavía).
  const ref = lgmdm().reference;
  if (typeof ref?.onRefFileSelected === 'function') {
    try {
      ref.onRefFileSelected();
    } catch (e) {
      console.error('[reference-picker] onRefFileSelected', e);
    }
  }

  // Cerrar modal.
  _closeModal();

  // Actualizar botón de preview/submit (defensivo).
  if (typeof ref?.updateRefPreviewBtn === 'function') {
    try {
      ref.updateRefPreviewBtn();
    } catch (e) {
      console.error('[reference-picker] updateRefPreviewBtn', e);
    }
  }
}

// ── Modal ─────────────────────────────────────────────────────────
function _buildModal(): void {
  if (_modal) return;
  const modal = document.createElement('div');
  modal.id = 'refLibModal';
  modal.innerHTML = `
    <div class="ref-lib-backdrop"></div>
    <div class="ref-lib-dialog">
      <div class="ref-lib-header">
        <span>📚 Biblioteca de referencias</span>
        <button class="ref-lib-close" id="refLibClose" title="Cerrar">✕</button>
      </div>
      <div class="ref-lib-toolbar">
        <input type="text" id="refLibSearch" placeholder="Buscar por nombre…" autocomplete="off" />
        <button class="btn btn-secondary btn-sm" id="refLibRescan" title="Re-escanear carpeta">↺ Actualizar</button>
      </div>
      <div class="ref-lib-status" id="refLibStatus" role="status" aria-live="polite">
        <div class="skeleton-loader" aria-busy="true" aria-label="Cargando biblioteca">
          <div class="skeleton-line skeleton-line--lg"></div>
          <div class="skeleton-line skeleton-line--md"></div>
          <div class="skeleton-line skeleton-line--sm"></div>
        </div>
      </div>
      <div class="ref-lib-list" id="refLibList"></div>
      <div class="ref-lib-footer">
        <span class="lgjs-s-8e359722">
          Poné tus tracks de referencia en <code>reference_library/</code> en el servidor.
          Se indexan automáticamente.
        </span>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  _modal = modal;
  _searchInput = modal.querySelector<HTMLInputElement>('#refLibSearch');
  _listEl = modal.querySelector<HTMLDivElement>('#refLibList');
  _statusEl = modal.querySelector<HTMLElement>('#refLibStatus');

  const signal = ensureAbort().signal;

  const closeBtn = modal.querySelector<HTMLButtonElement>('#refLibClose');
  closeBtn?.addEventListener(
    'click',
    () => {
      try {
        _closeModal();
      } catch (e) {
        console.error('[reference-picker] close', e);
      }
    },
    { signal },
  );

  const backdrop = modal.querySelector<HTMLElement>('.ref-lib-backdrop');
  backdrop?.addEventListener(
    'click',
    () => {
      try {
        _closeModal();
      } catch (e) {
        console.error('[reference-picker] backdrop close', e);
      }
    },
    { signal },
  );

  _searchInput?.addEventListener(
    'input',
    (e: Event) => {
      try {
        if (e.target instanceof HTMLInputElement) _applySearch(e.target.value);
      } catch (err) {
        console.error('[reference-picker] search', err);
      }
    },
    { signal },
  );

  const rescan = modal.querySelector<HTMLButtonElement>('#refLibRescan');
  rescan?.addEventListener(
    'click',
    () => {
      try {
        if (_statusEl) _statusEl.textContent = 'Re-escaneando…';
        void _rescan();
      } catch (err) {
        console.error('[reference-picker] rescan', err);
      }
    },
    { signal },
  );
}

function _openModal(): void {
  _buildModal();
  if (!_modal) return;
  _modal.style.display = 'flex';
  if (!_modal.hasAttribute('role')) _modal.setAttribute('role', 'dialog');
  if (!_modal.hasAttribute('aria-modal')) _modal.setAttribute('aria-modal', 'true');
  const opener =
    document.getElementById('btnOpenRefLib') ||
    (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  openModal({
    modalEl: _modal,
    openerEl: opener,
    closeOnBackdrop: true,
    trapFocus: true,
    closeOnEscape: true,
    onClose: () => {
      if (_modal) _modal.style.display = 'none';
    },
  });

  // Reduced-motion-aware open transition hook. Cuando el usuario prefiere
  // movimiento reducido, aplicamos la clase de apertura de inmediato (sin
  // transición); en caso contrario la diferimos al próximo frame para que
  // CSS pueda animar la entrada. Honra WCAG 2.3.3.
  const modalRef = _modal;
  if (getPrefersReducedMotion()) {
    modalRef.classList.add('ref-lib-modal--open');
  } else {
    requestAnimationFrame(() => modalRef.classList.add('ref-lib-modal--open'));
  }

  if (_searchInput) _searchInput.value = '';
  _filtered = [..._entries];
  _renderList();
  void loadReferenceLibrary({ retryOnAuth: true });
}

function _closeModal(): void {
  if (!_modal) return;
  // modal-helper.closeModal aborta sus propios listeners (escape/backdrop/
  // trap-focus) y dispara el onClose que oculta el modal.
  try {
    closeModal(_modal);
  } catch (e) {
    console.error('[reference-picker] closeModal', e);
  }
  _modal.classList.remove('ref-lib-modal--open');
  _modal.style.display = 'none';
}

// ── Botón que abre el modal (insertado junto al input de referencia) ──
function _injectButton(): void {
  const signal = ensureAbort().signal;
  const existing = document.getElementById('btnOpenRefLib');
  if (existing instanceof HTMLButtonElement) {
    existing.addEventListener(
      'click',
      (e) => {
        try {
          e.preventDefault();
          _openModal();
        } catch (err) {
          console.error('[reference-picker] open (static btn)', err);
        }
      },
      { signal },
    );
    return;
  }

  // Buscar el input de referencia si no existe el botón estático.
  const byId = document.getElementById('refFileInput');
  const refInput =
    byId instanceof HTMLInputElement
      ? byId
      : document.querySelector<HTMLInputElement>("input[id*='ref'][type='file']");
  if (!refInput) return;

  const btn = document.createElement('button');
  btn.className = 'btn btn-secondary btn-sm ref-lib-open-button';
  btn.id = 'btnOpenRefLib';
  btn.type = 'button';
  btn.textContent = '📚 Elegir desde biblioteca de referencias';
  btn.addEventListener(
    'click',
    (e) => {
      try {
        e.preventDefault();
        _openModal();
      } catch (err) {
        console.error('[reference-picker] open (injected btn)', err);
      }
    },
    { signal },
  );

  const wrapper =
    refInput.closest('.file-drop-zone, .file-input-wrap, .param') || refInput.parentElement;
  wrapper?.insertAdjacentElement('afterend', btn);
  _injectedButton = btn;
}

// ── Init / teardown ───────────────────────────────────────────────
export function initReferencePicker(): void {
  const g = lgmdm();
  // Idempotencia: el flag global sobrevive a HMR / double-import.
  if (g.referencePickerBound) return;
  g.referencePickerBound = true;

  ensureAbort();
  _injectButton();

  const maybeLoad = (): void => {
    try {
      if (getAuthToken()) {
        void loadReferenceLibrary({ retryOnAuth: true }).catch((e) => {
          console.error('[reference-picker] maybeLoad', e);
        });
      }
    } catch (e) {
      console.error('[reference-picker] maybeLoad (sync)', e);
    }
  };
  maybeLoad();
  // Recarga diferida cuando el login ocurre después del init.
  window.addEventListener('lgmdm:authenticated', maybeLoad, {
    signal: ensureAbort().signal,
  });
}

export function teardownReferencePicker(): void {
  // 1. Abortar todo listener registrado con el signal del módulo.
  if (_abort) {
    _abort.abort();
    _abort = null;
  }
  // 2. Cerrar + remover el modal del DOM.
  if (_modal) {
    try {
      closeModal(_modal);
    } catch {
      /* ignore — el modal puede no estar en el mapa de modal-helper */
    }
    _modal.remove();
    _modal = null;
  }
  // 3. Remover el botón inyectado (el #btnOpenRefLib estático se conserva).
  if (_injectedButton) {
    _injectedButton.remove();
    _injectedButton = null;
  }
  _searchInput = null;
  _listEl = null;
  _statusEl = null;
  _entries = [];
  _filtered = [];
  _selected = null;
  // 4. Liberar el flag de idempotencia para permitir re-init.
  const g = lgmdm();
  g.referencePickerBound = false;
}

// ── API pública ───────────────────────────────────────────────────
export function openReferenceLibrary(): void {
  _openModal();
}

// Expose on window.LGMDM.reference.libraryPicker (legacy compat).
function publishApi(): void {
  const g = lgmdm();
  g.reference = g.reference ?? {};
  g.reference.libraryPicker = {
    open: openReferenceLibrary,
    reload: loadReferenceLibrary,
  };
  // FIX G10: stopRefPreview — limpia el state de reference preview.
  // master-console.ts:127 lo llama para parar el preview de referencia
  // antes de iniciar otro. No hay audio element específico, así que
  // reseteamos el state y notificamos.
  if (typeof g.reference.stopRefPreview !== 'function') {
    g.reference.stopRefPreview = function stopRefPreview(): void {
      try {
        const state = lgmdm().state as { reference?: { file: File | null; libraryId: string | null } } | undefined;
        if (state?.reference) {
          state.reference.file = null;
          state.reference.libraryId = null;
        }
        window.dispatchEvent(new CustomEvent('lgmdm:ref-preview-stopped'));
      } catch (_) { /* ignore */ }
    };
  }
}

// ── Auto-boot ─────────────────────────────────────────────────────
publishApi();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initReferencePicker, { once: true });
} else {
  // Defer a la próxima tick para dejar asentar el DOM (mismo comportamiento
  // que el `setTimeout(init, 0)` del aporte).
  setTimeout(initReferencePicker, 0);
}

// Limpieza al descargar la página.
window.addEventListener('beforeunload', teardownReferencePicker, { once: true });
