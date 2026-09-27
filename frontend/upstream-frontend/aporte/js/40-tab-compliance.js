// ============================================================
// 40-tab-compliance.js — Tab 1: Compliance certificate
// ============================================================
// F5.15 — Stub del tab Compliance. Wrapper sobre la función original
// en 34-premium-suite.js. Migración completa pendiente (requiere
// extraer state, PLATFORMS, _currentMetrics, exportQualityCertificate
// a un namespace compartido).
// Carga: tras 34-premium-suite.js (necesita renderComplianceTab).
// ============================================================

(function (global) {
  "use strict";
  const proFeatures = global.LGMDM = global.LGMDM || {};
  proFeatures.proFeatures = proFeatures.proFeatures || {};

  function renderComplianceTab(container, metrics) {
    if (typeof global._lgmdmRenderComplianceTab === "function") {
      return global._lgmdmRenderComplianceTab(container, metrics);
    }
    container.innerHTML = `<div class="empty-state" role="alert">
      <div class="empty-state-icon" aria-hidden="true">⚠</div>
      <h3>Tab Compliance no disponible</h3>
      <p>34-premium-suite.js debe cargarse antes que este archivo.</p>
    </div>`;
  }

  proFeatures.proFeatures.tabs = proFeatures.proFeatures.tabs || {};
  proFeatures.proFeatures.tabs.compliance = renderComplianceTab;
})(window);
