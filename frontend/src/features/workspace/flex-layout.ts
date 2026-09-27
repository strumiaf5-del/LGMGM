// flex-layout.ts — sidebar resize + collapse

import { bindOnce } from '../../core/ui';
import { storage } from '../../core/storage';

const KEY_W = 'lgmdm:flex-sidebar-w';
const KEY_C = 'lgmdm:flex-sidebar-collapsed';
const MIN = 250;
const isDesktop = (): boolean => window.innerWidth >= 960;
const maxW = (): number => Math.max(420, Math.min(560, Math.round(window.innerWidth * 0.42)));
const clampWidth = (v: number): number => Math.max(MIN, Math.min(maxW(), Number(v) || 320));
let layoutRoot: HTMLElement | null = null;
let sidebar: HTMLElement | null = null;
let handle: HTMLElement | null = null;
let collapseBtn: HTMLElement | null = null;
let uncollapseBtn: HTMLElement | null = null;

function apply(width: number): number | null {
  if (!isDesktop() || !layoutRoot) return null;
  const px = Math.round(clampWidth(width));
  if (!layoutRoot.dataset.prevGridColumns && layoutRoot.style.gridTemplateColumns) {
    layoutRoot.dataset.prevGridColumns = layoutRoot.style.gridTemplateColumns;
  }
  document.documentElement.style.setProperty('--lg-sidebar-w', `${px}px`);
  layoutRoot.style.setProperty('grid-template-columns', `${px}px 8px minmax(0,1fr)`, 'important');
  return px;
}

function revertGridColumns(): void {
  if (!layoutRoot) return;
  if (layoutRoot.dataset.prevGridColumns) {
    layoutRoot.style.gridTemplateColumns = layoutRoot.dataset.prevGridColumns;
    delete layoutRoot.dataset.prevGridColumns;
  } else {
    layoutRoot.style.removeProperty('grid-template-columns');
  }
}

function save(width: number): void {
  try { storage.set(KEY_W, String(Math.round(width))); } catch { /* ignore */ }
}

function setCollapsed(collapsed: boolean): void {
  if (!sidebar || !layoutRoot) return;
  sidebar.classList.toggle('collapsed', collapsed);
  layoutRoot.classList.toggle('sidebar-collapsed', collapsed);
  if (isDesktop()) {
    if (collapsed) {
      if (!layoutRoot.dataset.prevGridColumns && layoutRoot.style.gridTemplateColumns) {
        layoutRoot.dataset.prevGridColumns = layoutRoot.style.gridTemplateColumns;
      }
      layoutRoot.style.setProperty('grid-template-columns', '0 0 minmax(0,1fr)', 'important');
    } else {
      let saved = NaN;
      try { saved = parseFloat(storage.get(KEY_W) || ''); } catch { /* ignore */ }
      revertGridColumns();
      apply(Number.isFinite(saved) ? saved : Math.round(window.innerWidth * 0.22));
    }
  } else {
    revertGridColumns();
  }
  if (collapseBtn) {
    collapseBtn.textContent = collapsed ? '▶' : '◀';
    collapseBtn.title = collapsed ? 'Expandir sidebar' : 'Colapsar sidebar';
    // FIX A2-a11y: exponer el estado expandido/colapsado a screen readers.
    collapseBtn.setAttribute('aria-expanded', String(!collapsed));
  }
  if (uncollapseBtn) {
    uncollapseBtn.hidden = collapsed;
  }
  try { storage.set(KEY_C, String(collapsed)); } catch { /* ignore */ }
}

function fit(): void {
  if (!isDesktop() || !sidebar || !layoutRoot) {
    if (layoutRoot) revertGridColumns();
    if (sidebar) sidebar.style.removeProperty('width');
    return;
  }
  if (sidebar.classList.contains('collapsed')) return;
  let saved = NaN;
  try { saved = parseFloat(storage.get(KEY_W) || ''); } catch { /* ignore */ }
  const fallback = window.innerWidth < 1100 ? window.innerWidth * 0.28 : window.innerWidth * 0.22;
  apply(Number.isFinite(saved) ? saved : fallback);
}

let flexController: AbortController | null = null;

function initFlexLayout(): void {
  // FIX M1/M3: idempotency flag on window.LGMDM (survives HMR) + AbortController.
  const w = window as Window & { LGMDM?: { flexLayoutBound?: boolean } };
  if (!w.LGMDM) w.LGMDM = {};
  if (w.LGMDM.flexLayoutBound) return;
  w.LGMDM.flexLayoutBound = true;
  if (flexController) flexController.abort();
  flexController = new AbortController();
  const signal = flexController.signal;
  const root = document.documentElement;
  layoutRoot = document.querySelector<HTMLElement>('.main-container');
  sidebar = (layoutRoot?.querySelector<HTMLElement>(':scope > .sidebar')) || null;
  const content = layoutRoot?.querySelector<HTMLElement>(':scope > .content-area');
  handle = document.getElementById('sidebarResizeHandle');
  collapseBtn = document.getElementById('sidebarCollapseBtn');
  uncollapseBtn = document.getElementById('sidebarUncollapseBtn');
  if (!layoutRoot || !sidebar || !content || !handle) {
    if (w.LGMDM) w.LGMDM.flexLayoutBound = false;
    return;
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;

  handle.addEventListener('pointerdown', (rawE) => {
    const e = rawE as PointerEvent;
    if (!isDesktop() || sidebar!.classList.contains('collapsed')) return;
    dragging = true;
    startX = e.clientX;
    startW = sidebar!.getBoundingClientRect().width;
    (handle as HTMLElement).setPointerCapture?.(e.pointerId);
    (handle as HTMLElement).classList.add('dragging');
    document.body.classList.add('lgmdm-layout-dragging');
    e.preventDefault();
  }, { signal });
  handle.addEventListener('pointermove', (rawE) => {
    const e = rawE as PointerEvent;
    if (dragging) apply(startW + e.clientX - startX);
  }, { signal });

  const end = () => {
    if (!dragging) return;
    dragging = false;
    (handle as HTMLElement).classList.remove('dragging');
    document.body.classList.remove('lgmdm-layout-dragging');
    if (sidebar) save(sidebar.getBoundingClientRect().width);
  };
  handle.addEventListener('pointerup', end, { signal });
  handle.addEventListener('pointercancel', end, { signal });
  handle.addEventListener('dblclick', () => {
    const w = Math.round(window.innerWidth * 0.22);
    apply(w); save(w);
  }, { signal });
  handle.addEventListener('keydown', (rawE) => {
    const e = rawE as KeyboardEvent;
    if (!sidebar) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      apply(sidebar.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -16 : 16));
    } else if (e.key === 'Home') {
      e.preventDefault(); apply(MIN);
    } else if (e.key === 'End') {
      e.preventDefault(); apply(maxW());
    }
  }, { signal });
  if (collapseBtn) collapseBtn.addEventListener('click', () => setCollapsed(!sidebar!.classList.contains('collapsed')), { signal });
  if (uncollapseBtn) {
    uncollapseBtn.addEventListener('click', () => setCollapsed(false), { signal });
  }

  window.addEventListener('resize', fit, { passive: true, signal });
  let collapsed = false;
  try { collapsed = storage.get(KEY_C) === 'true'; } catch { /* ignore */ }
  setCollapsed(collapsed);
  fit();
}

export function teardownFlexLayout(): void {
  // FIX M3: abort the controller to remove all listeners at once.
  if (flexController) { flexController.abort(); flexController = null; }
  layoutRoot = sidebar = handle = collapseBtn = uncollapseBtn = null;
  const w = window as Window & { LGMDM?: { flexLayoutBound?: boolean } };
  if (w.LGMDM) w.LGMDM.flexLayoutBound = false;
}
window.addEventListener('beforeunload', teardownFlexLayout, { once: true });

// Boot.
if (document.readyState === 'loading') {
  bindOnce(document, 'DOMContentLoaded', initFlexLayout, 'flex-layout-dom-ready', { once: true });
} else {
  initFlexLayout();
}
