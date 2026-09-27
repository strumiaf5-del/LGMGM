// ============================================================
// 43-tab-waterfall.js — Tab 5: Waterfall 3D 60FPS
// ============================================================
// F5.15 — Wrapper del tab Waterfall. renderWaterfallTab original
// permanece en 34-premium-suite.js. Este stub expone el tab vía
// LGMDM.proFeatures.tabs.waterfall.
// Carga: tras 34-premium-suite.js.
// ============================================================

(function (global) {
  "use strict";
  const proFeatures = global.LGMDM = global.LGMDM || {};
  proFeatures.proFeatures = proFeatures.proFeatures || {};

  function renderWaterfallTab(container) {
    if (typeof global._lgmdmRenderWaterfallTab === "function") {
      return global._lgmdmRenderWaterfallTab(container);
    }
    container.innerHTML = `<div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠</div>
      <h3>Tab Waterfall no disponible</h3>
      <p>34-premium-suite.js debe cargarse antes que este archivo.</p>
    </div>`;
  }

  proFeatures.proFeatures.tabs = proFeatures.proFeatures.tabs || {};
  proFeatures.proFeatures.tabs.waterfall = renderWaterfallTab;
})(window);
