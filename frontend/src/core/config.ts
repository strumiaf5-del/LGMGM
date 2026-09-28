// ============================================================
// config.ts — Configuración única del frontend LGMDM
// Fuente de verdad para límites y valores de producto compartidos.
// Portado desde aporte/js/00-config.js (IIFE) a módulo ES + Vite.
// ============================================================

// ── Constantes de producto (const assertions para literales exactos) ──
export const MAX_FILE_MB = 200 as const;
// `as const` no aplica a expresiones aritméticas (TS1355); se conserva la
// derivación del original para que cambie junto con MAX_FILE_MB. El tipo es `number`.
export const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
export const PREVIEW_DURATION_SEC = 25 as const;

/** Config inmutable compartida por todo el frontend y widgets legacy. */
export const config = Object.freeze({
  maxFileMb: MAX_FILE_MB,
  maxFileBytes: MAX_FILE_BYTES,
  previewDurationSec: PREVIEW_DURATION_SEC,
} as const);

export type Config = typeof config;

// ── Forma mínima del namespace global LGMDM para compatibilidad legacy ──
// Cada módulo define su propia vista local del namespace (ver keyboard-shortcuts.ts,
// audio-tap.ts, master-console.ts). Aquí sólo nos interesa `.config`.
interface LgmdmGlobal {
  config?: Config;
  [key: string]: unknown;
}

// NOTE: `as unknown as` (no `as any`): el cast puro falla bajo
// `exactOptionalPropertyTypes` porque la declaración global de `Window.LGMDM`
// en core/state.ts es deliberadamente mínima y su `config` no incluye
// `previewDurationSec`. El hop por `unknown` es el escape recomendado por el
// propio compilador ("convert the expression to 'unknown' first"); el slice
// local `LgmdmGlobal` sigue tipando los accesos posteriores.
function lgmdm(): LgmdmGlobal {
  const w = window as unknown as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

// Exponer `config` en `window.LGMDM.config` para widgets legacy que la leen de ahí.
lgmdm().config = config;

// ── Aplicación al DOM ──────────────────────────────────────────
// Flag de idempotencia: la init sólo debe aplicarse una vez aunque se llame
// varias veces o se dispare DOMContentLoaded tras una invocación manual.
let configApplied = false;

/**
 * Puebla los elementos `[data-lgmdm-max-file-mb]` con el valor de `MAX_FILE_MB`.
 * Idempotente: invocaciones posteriores a la primera son no-op.
 */
export function applyConfigToDocument(): void {
  if (configApplied) return;
  configApplied = true;

  document.querySelectorAll<HTMLElement>('[data-lgmdm-max-file-mb]').forEach((el) => {
    el.textContent = String(MAX_FILE_MB);
  });
}

// ── Auto-init ──────────────────────────────────────────────────
// Si el documento aún carga, esperar al DOMContentLoaded (once); si no,
// aplicar directamente. El flag `configApplied` evita doble aplicación cuando
// ambas ramas pudieran dispararse (p.ej. import tardío tras DOMContentLoaded).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyConfigToDocument, { once: true });
} else {
  applyConfigToDocument();
}
