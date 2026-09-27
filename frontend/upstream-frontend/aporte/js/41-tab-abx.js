// ============================================================
// 41-tab-abx.js — Tab 2: Blind ABX test
// ============================================================
// F5.15 — Wrapper del tab ABX. La función renderAbxTab original
// permanece en 34-premium-suite.js. Este stub expone el tab vía
// LGMDM.proFeatures.tabs.abx para que el dispatch lo pueda llamar
// sin tener que conocer la ubicación interna.
// Carga: tras 34-premium-suite.js.
// ============================================================

(function (global) {
  "use strict";
  const proFeatures = global.LGMDM = global.LGMDM || {};
  proFeatures.proFeatures = proFeatures.proFeatures || {};

  function renderAbxTab(container) {
    if (typeof global._lgmdmRenderAbxTab === "function") {
      return global._lgmdmRenderAbxTab(container);
    }
    container.innerHTML = `<div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠</div>
      <h3>Tab ABX no disponible</h3>
      <p>34-premium-suite.js debe cargarse antes que este archivo.</p>
    </div>`;
  }

  proFeatures.proFeatures.tabs = proFeatures.proFeatures.tabs || {};
  proFeatures.proFeatures.tabs.abx = renderAbxTab;
})(window);
