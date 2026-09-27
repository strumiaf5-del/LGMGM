// index.ts — pro suite tab wrappers (compliance/abx/codec/waterfall). Port of aporte/js/{40,41,42,43}-tab-*.js.

import { escapeHtml } from '../../core/ui';

type RenderFn = (container: HTMLElement, metrics?: unknown) => void;
type DelegatedFn = ((container: HTMLElement, metrics?: unknown) => void) | undefined;

function lgmdm(): { proFeatures?: { tabs?: Record<string, RenderFn> } } {
  return (window as Window & { LGMDM?: { proFeatures?: { tabs?: Record<string, RenderFn> } } }).LGMDM || {};
}

function emptyState(tabName: string): string {
  return `<div class="empty-state" role="alert">
    <div class="empty-state-icon" aria-hidden="true">⚠</div>
    <h3>Tab ${escapeHtml(tabName)} no disponible</h3>
    <p>34-premium-suite.js debe cargarse antes que este archivo.</p>
  </div>`;
}

function getDelegatedFn(name: string): DelegatedFn {
  // The 34-premium-suite module sets these globals; read fresh at call time.
  const fn = (window as unknown as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as DelegatedFn) : undefined;
}

function makeTabRenderer(tabName: string, delegatedGlobalName: string): RenderFn {
  return (container: HTMLElement, metrics?: unknown) => {
    const fn = getDelegatedFn(delegatedGlobalName);
    if (fn) {
      try { return fn(container, metrics); } catch (err) {
        console.error(`[tabs:${tabName}] renderer threw:`, err);
      }
    }
    container.innerHTML = emptyState(tabName);
  };
}

export function renderComplianceTab(container: HTMLElement, metrics?: unknown): void {
  return makeTabRenderer('Compliance', '_lgmdmRenderComplianceTab')(container, metrics);
}
export function renderAbxTab(container: HTMLElement): void {
  return makeTabRenderer('ABX', '_lgmdmRenderAbxTab')(container);
}
export function renderCodecTab(container: HTMLElement): void {
  return makeTabRenderer('Codec', '_lgmdmRenderCodecTab')(container);
}
export function renderWaterfallTab(container: HTMLElement): void {
  return makeTabRenderer('Waterfall', '_lgmdmRenderWaterfallTab')(container);
}

// Register on the LGMDM namespace (legacy compat).
const g = lgmdm();
g.proFeatures = g.proFeatures || { tabs: {} };
g.proFeatures.tabs = g.proFeatures.tabs || {};
g.proFeatures.tabs.compliance = renderComplianceTab;
g.proFeatures.tabs.abx = renderAbxTab;
g.proFeatures.tabs.codec = renderCodecTab;
g.proFeatures.tabs.waterfall = renderWaterfallTab;
