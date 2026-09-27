// modal-helper.ts — accessible modal helper

export interface ModalOptions {
  /** HTMLElement overlay del modal (required). */
  modalEl: HTMLElement;
  /** Elemento que abrió el modal (return-focus target). Default: document.activeElement al abrir. */
  openerEl?: HTMLElement | null;
  /** Click fuera del modal cierra. Default: true. */
  closeOnBackdrop?: boolean;
  /** Tab cycling dentro del modal. Default: true. */
  trapFocus?: boolean;
  /** Escape cierra el modal. Default: true. */
  closeOnEscape?: boolean;
  /** Callback al abrir (recibe modalEl). */
  onOpen?: ((modalEl: HTMLElement) => void) | null;
  /** Callback al cerrar (recibe modalEl). */
  onClose?: ((modalEl: HTMLElement) => void) | null;
}

export interface ModalHandle {
  modalEl: HTMLElement;
  openerEl: HTMLElement | null;
}

interface ModalEntry {
  openerEl: HTMLElement | null;
  controller: AbortController;
  onClose: ((modalEl: HTMLElement) => void) | null;
}

/** Map de modales abiertos: modalEl -> { openerEl, controller, onClose }. */
const _open = new Map<HTMLElement, ModalEntry>();

/** Selector de elementos focusables dentro de un modal. */
const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'audio[controls]',
  'video[controls]',
  '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/** Devuelve los elementos focusables visibles dentro de `el`. */
function _focusable(el: HTMLElement | null | undefined): HTMLElement[] {
  if (!el) return [];
  return Array.from(el.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
    .filter((node): node is HTMLElement => node != null)
    .filter((node) => node.offsetParent !== null || node === el);
}

/** Auto-etiqueta el modal con aria-labelledby/aria-label si no los tiene. */
function _autoLabel(modalEl: HTMLElement): void {
  if (modalEl.getAttribute('aria-labelledby') || modalEl.getAttribute('aria-label')) return;
  const heading = modalEl.querySelector('h1, h2, h3, [data-modal-title]');
  if (heading) {
    if (!heading.id) heading.id = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
    modalEl.setAttribute('aria-labelledby', heading.id);
  } else if (modalEl.title) {
    modalEl.setAttribute('aria-label', modalEl.title);
  }
}

/** Trap de Tab: cicla entre primer/último focusable dentro del modal. */
function _trapKey(e: KeyboardEvent, modalEl: HTMLElement): void {
  if (e.key !== 'Tab') return;
  const items = _focusable(modalEl);
  if (!items.length) {
    e.preventDefault();
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/** Click en el backdrop (el modal mismo) cierra si closeOnBackdrop. */
function _onBackdropClick(e: MouseEvent, modalEl: HTMLElement, closeOnBackdrop: boolean): void {
  if (!closeOnBackdrop) return;
  if (e.target === modalEl) {
    closeModal(modalEl);
  }
}

/**
 * Abre un modal accesible.
 * @returns ModalHandle en éxito, o null si falta modalEl o el modal ya está abierto.
 */
export function openModal(opts?: ModalOptions): ModalHandle | null {
  const {
    modalEl,
    openerEl = null,
    closeOnBackdrop = true,
    trapFocus = true,
    closeOnEscape = true,
    onOpen = null,
    onClose = null,
  } = opts ?? {};

  if (!modalEl) {
    console.warn('[modal-helper] openModal: modalEl is required');
    return null;
  }
  // Idempotencia: si ya está abierto, no reabrir.
  if (_open.has(modalEl)) return null;

  if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
  if (!modalEl.hasAttribute('aria-modal')) modalEl.setAttribute('aria-modal', 'true');
  _autoLabel(modalEl);

  const previousFocus: HTMLElement | null = openerEl || (document.activeElement as HTMLElement | null);
  const controller = new AbortController();

  if (closeOnEscape) {
    document.addEventListener(
      'keydown',
      (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal(modalEl);
        }
      },
      { signal: controller.signal },
    );
  }
  if (trapFocus) {
    document.addEventListener('keydown', (e: KeyboardEvent) => _trapKey(e, modalEl), {
      signal: controller.signal,
    });
  }
  if (closeOnBackdrop) {
    modalEl.addEventListener('click', (e: MouseEvent) => _onBackdropClick(e, modalEl, closeOnBackdrop), {
      signal: controller.signal,
    });
  }

  _open.set(modalEl, { openerEl: previousFocus, controller, onClose });
  if (typeof onOpen === 'function') onOpen(modalEl);

  requestAnimationFrame(() => {
    const items = _focusable(modalEl);
    const target: HTMLElement =
      items.find((el) => !el.hasAttribute('autofocus-disabled')) || items[0] || modalEl;
    try {
      target.focus({ preventScroll: false });
    } catch {
      try {
        target.focus();
      } catch {
        /* ignore */
      }
    }
  });

  return { modalEl, openerEl: previousFocus };
}

/** Cierra un modal abierto: aborta listeners, dispara onClose y devuelve el foco al opener. */
export function closeModal(modalEl: HTMLElement): void {
  const entry = _open.get(modalEl);
  if (!entry) return;
  entry.controller.abort();
  _open.delete(modalEl);
  if (typeof entry.onClose === 'function') {
    try {
      entry.onClose(modalEl);
    } catch (e) {
      console.warn('[modal-helper] onClose error', e);
    }
  }
  if (entry.openerEl && typeof entry.openerEl.focus === 'function') {
    try {
      entry.openerEl.focus({ preventScroll: false });
    } catch {
      try {
        entry.openerEl.focus();
      } catch {
        /* ignore */
      }
    }
  }
}

/** ¿Está abierto el modal? */
export function isModalOpen(modalEl: HTMLElement): boolean {
  return _open.has(modalEl);
}

/** Cierra todos los modales abiertos. */
export function closeAllModals(): void {
  Array.from(_open.keys()).forEach(closeModal);
}

/** Convenience wrapper: cierra todos los modales (útil para beforeunload). */
export function teardownModals(): void {
  closeAllModals();
}

// ── Expose on the LGMDM namespace for legacy widgets ─────────────
interface LgmdmGlobal {
  ui?: {
    openModal?: typeof openModal;
    closeModal?: typeof closeModal;
    isModalOpen?: typeof isModalOpen;
    closeAllModals?: typeof closeAllModals;
    teardownModals?: typeof teardownModals;
    [key: string]: unknown;
  };
}

const win = window as Window & { LGMDM?: LgmdmGlobal };
const lg = win.LGMDM ?? (win.LGMDM = {});
const ui = lg.ui ?? (lg.ui = {});
ui.openModal = openModal;
ui.closeModal = closeModal;
ui.isModalOpen = isModalOpen;
ui.closeAllModals = closeAllModals;
ui.teardownModals = teardownModals;

// Auto-cleanup al descargar la página.
window.addEventListener('beforeunload', closeAllModals, { once: true });
