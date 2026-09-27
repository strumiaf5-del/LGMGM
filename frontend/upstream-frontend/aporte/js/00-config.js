// ============================================================
// 00-config.js — Configuración única del frontend LGMDM
// Fuente de verdad para límites y valores de producto compartidos.
// ============================================================
(function (global) {
  'use strict';

  const MAX_FILE_MB = 200;
  const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
  const PREVIEW_DURATION_SEC = 25;

  const LGMDM = global.LGMDM = global.LGMDM || {};
  LGMDM.config = Object.freeze({
    maxFileMb: MAX_FILE_MB,
    maxFileBytes: MAX_FILE_BYTES,
    previewDurationSec: PREVIEW_DURATION_SEC,
  });

  function applyConfigToDocument() {
    document.querySelectorAll('[data-lgmdm-max-file-mb]').forEach((el) => {
      el.textContent = String(MAX_FILE_MB);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyConfigToDocument, { once: true });
  } else {
    applyConfigToDocument();
  }
})(window);
