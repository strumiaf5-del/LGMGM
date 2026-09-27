// ============================================================
// 00-modal-helper.js — Helper canónico para modales accesibles
// ============================================================
// API:
//   LGMDM.ui.openModal({
//     modalEl,         // HTMLElement overlay del modal
//     openerEl,        // HTMLElement que abrió el modal (return-focus)
//     closeOnBackdrop, // default true (click fuera cierra)
//     trapFocus,       // default true (Tab cycling)
//     closeOnEscape,   // default true
//     onOpen,          // opcional
//     onClose,         // opcional
//   })
//   LGMDM.ui.closeModal(modalEl)
//   LGMDM.ui.isModalOpen(modalEl)
//
// Atributos aplicados al modal:
//   role="dialog"        (si no existe)
//   aria-modal="true"    (si no existe)
//   aria-labelledby      (auto-link al primer <h2>/<h3>/[aria-label]/title)
//
// Requiere: 00-ui-core.js (LGMDM.ui.bindOnce)
// Carga: tras 00-ui-core.js, antes de cualquier script que abra modales
// ============================================================

(function (global) {
  "use strict";
  const LG = global.LGMDM = global.LGMDM || {};
  const ui = LG.ui = LG.ui || {};

  const _open = new Map();   // modalEl -> { openerEl, controller, onClose }

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

  function _focusable(el) {
    if (!el) return [];
    return Array.from(el.querySelectorAll(FOCUSABLE_SELECTOR))
      .filter((node) => node.offsetParent !== null || node === el);
  }

  function _autoLabel(modalEl) {
    if (modalEl.getAttribute('aria-labelledby') || modalEl.getAttribute('aria-label')) return;
    const heading = modalEl.querySelector('h1, h2, h3, [data-modal-title]');
    if (heading) {
      if (!heading.id) heading.id = `modal-title-${Math.random().toString(36).slice(2, 9)}`;
      modalEl.setAttribute('aria-labelledby', heading.id);
    } else if (modalEl.title) {
      modalEl.setAttribute('aria-label', modalEl.title);
    }
  }

  function _trapKey(e, modalEl) {
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

  function _onBackdropClick(e, modalEl, closeOnBackdrop) {
    if (!closeOnBackdrop) return;
    if (e.target === modalEl) {
      closeModal(modalEl);
    }
  }

  function openModal(opts) {
    const {
      modalEl,
      openerEl = null,
      closeOnBackdrop = true,
      trapFocus = true,
      closeOnEscape = true,
      onOpen = null,
      onClose = null,
    } = opts || {};

    if (!modalEl) {
      console.warn('[modal-helper] openModal: modalEl is required');
      return null;
    }
    if (_open.has(modalEl)) return _open.get(modalEl);

    if (!modalEl.hasAttribute('role')) modalEl.setAttribute('role', 'dialog');
    if (!modalEl.hasAttribute('aria-modal')) modalEl.setAttribute('aria-modal', 'true');
    _autoLabel(modalEl);

    const previousFocus = openerEl || document.activeElement;
    const controller = new AbortController();

    if (closeOnEscape) {
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeModal(modalEl);
        }
      }, { signal: controller.signal });
    }
    if (trapFocus) {
      document.addEventListener('keydown', (e) => _trapKey(e, modalEl), { signal: controller.signal });
    }
    if (closeOnBackdrop) {
      modalEl.addEventListener('click', (e) => _onBackdropClick(e, modalEl, closeOnBackdrop), { signal: controller.signal });
    }

    _open.set(modalEl, { openerEl: previousFocus, controller, onClose });
    if (typeof onOpen === 'function') onOpen(modalEl);

    requestAnimationFrame(() => {
      const items = _focusable(modalEl);
      const target = items.find((el) => !el.hasAttribute('autofocus-disabled')) || items[0] || modalEl;
      try { target.focus({ preventScroll: false }); } catch (_) { try { target.focus(); } catch (__) {} }
    });

    return { modalEl, openerEl: previousFocus };
  }

  function closeModal(modalEl) {
    const entry = _open.get(modalEl);
    if (!entry) return;
    entry.controller.abort();
    _open.delete(modalEl);
    if (typeof entry.onClose === 'function') {
      try { entry.onClose(modalEl); } catch (e) { console.warn('[modal-helper] onClose error', e); }
    }
    if (entry.openerEl && typeof entry.openerEl.focus === 'function') {
      try { entry.openerEl.focus({ preventScroll: false }); } catch (_) { try { entry.openerEl.focus(); } catch (__) {} }
    }
  }

  function isModalOpen(modalEl) {
    return _open.has(modalEl);
  }

  function closeAllModals() {
    Array.from(_open.keys()).forEach(closeModal);
  }

  ui.openModal = openModal;
  ui.closeModal = closeModal;
  ui.isModalOpen = isModalOpen;
  ui.closeAllModals = closeAllModals;
})(window);
