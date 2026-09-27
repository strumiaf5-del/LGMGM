// ============================================================
// 42-tab-codec.js — Tab 4: Codec simulator
// ============================================================
// F5.15 — Wrapper del tab Codec. renderCodecTab original permanece
// en 34-premium-suite.js. Este stub expone el tab vía
// LGMDM.proFeatures.tabs.codec.
// Carga: tras 34-premium-suite.js.
// ============================================================

(function (global) {
  "use strict";
  const proFeatures = global.LGMDM = global.LGMDM || {};
  proFeatures.proFeatures = proFeatures.proFeatures || {};

  function renderCodecTab(container) {
    if (typeof global._lgmdmRenderCodecTab === "function") {
      return global._lgmdmRenderCodecTab(container);
    }
    container.innerHTML = `<div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠</div>
      <h3>Tab Codec no disponible</h3>
      <p>34-premium-suite.js debe cargarse antes que este archivo.</p>
    </div>`;
  }

  proFeatures.proFeatures.tabs = proFeatures.proFeatures.tabs || {};
  proFeatures.proFeatures.tabs.codec = renderCodecTab;
})(window);
