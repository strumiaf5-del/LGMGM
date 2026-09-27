/* LGMDM Layout Controller — authoritative shell/sidebar/resizer owner. */
(function(){
  'use strict';
  const LGMDM = window.LGMDM = window.LGMDM || {};
  const root = document.documentElement;
  const layoutRoot = document.querySelector('.main-container');
  const sidebar = layoutRoot?.querySelector(':scope > .sidebar');
  const content = layoutRoot?.querySelector(':scope > .content-area');
  const handle = document.getElementById('sidebarResizeHandle');
  const collapseBtn = document.getElementById('sidebarCollapseBtn');
  const uncollapseBtn = document.getElementById('sidebarUncollapseBtn');
  if (!layoutRoot || !sidebar || !content || !handle) return;

  const bindOnce = LGMDM.ui?.bindOnce || ((el, ev, fn, key, opts) => {
    if (el) el.addEventListener(ev, fn, opts);
  });
  const KEY_W = 'lgmdm:flex-sidebar-w';
  const KEY_C = 'lgmdm:flex-sidebar-collapsed';
  const MIN = 250;
  const isDesktop = () => window.innerWidth >= 960;
  const MAX = () => Math.max(420, Math.min(560, Math.round(window.innerWidth * 0.42)));
  const clampWidth = (v) => Math.max(MIN, Math.min(MAX(), Number(v) || 320));

  function apply(width) {
    if (!isDesktop()) return null;
    const px = Math.round(clampWidth(width));
    if (!layoutRoot.dataset.prevGridColumns && layoutRoot.style.gridTemplateColumns) {
      layoutRoot.dataset.prevGridColumns = layoutRoot.style.gridTemplateColumns;
    }
    root.style.setProperty('--lg-sidebar-w', `${px}px`);
    layoutRoot.style.setProperty('grid-template-columns', `${px}px 8px minmax(0,1fr)`, 'important');
    return px;
  }

  function revertGridColumns() {
    if (layoutRoot.dataset.prevGridColumns) {
      layoutRoot.style.gridTemplateColumns = layoutRoot.dataset.prevGridColumns;
      delete layoutRoot.dataset.prevGridColumns;
    } else {
      layoutRoot.style.removeProperty('grid-template-columns');
    }
  }

  function save(width) {
    try { LGMDM.storage?.set(KEY_W, String(Math.round(width))); } catch (_) {}
  }

  function setCollapsed(collapsed) {
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
        try { saved = parseFloat(LGMDM.storage?.get(KEY_W) || ''); } catch (_) {}
        revertGridColumns();
        apply(Number.isFinite(saved) ? saved : Math.round(window.innerWidth * 0.22));
      }
    } else {
      revertGridColumns();
    }
    if (collapseBtn) {
      collapseBtn.textContent = collapsed ? '▶' : '◀';
      collapseBtn.title = collapsed ? 'Expandir sidebar' : 'Colapsar sidebar';
    }
    if (uncollapseBtn) {
      uncollapseBtn.hidden = !collapsed;
    }
    try { LGMDM.storage?.set(KEY_C, String(collapsed)); } catch (_) {}
  }

  let dragging = false;
  let startX = 0;
  let startW = 0;
  bindOnce(handle, 'pointerdown', (e) => {
    if (!isDesktop() || sidebar.classList.contains('collapsed')) return;
    dragging = true;
    startX = e.clientX;
    startW = sidebar.getBoundingClientRect().width;
    handle.setPointerCapture?.(e.pointerId);
    handle.classList.add('dragging');
    document.body.classList.add('lgmdm-layout-dragging');
    e.preventDefault();
  }, 'flex-pointerdown');
  bindOnce(handle, 'pointermove', (e) => {
    if (dragging) apply(startW + e.clientX - startX);
  }, 'flex-pointermove');

  const end = () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.classList.remove('lgmdm-layout-dragging');
    save(sidebar.getBoundingClientRect().width);
  };
  bindOnce(handle, 'pointerup', end, 'flex-pointerup');
  bindOnce(handle, 'pointercancel', end, 'flex-pointercancel');
  bindOnce(handle, 'dblclick', () => {
    const w = Math.round(window.innerWidth * 0.22);
    apply(w); save(w);
  }, 'flex-dblclick');
  bindOnce(handle, 'keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      apply(sidebar.getBoundingClientRect().width + (e.key === 'ArrowLeft' ? -16 : 16));
    } else if (e.key === 'Home') {
      e.preventDefault(); apply(MIN);
    } else if (e.key === 'End') {
      e.preventDefault(); apply(MAX());
    }
  }, 'flex-keyboard');
  bindOnce(collapseBtn, 'click', () => setCollapsed(!sidebar.classList.contains('collapsed')), 'flex-collapse');
  if (uncollapseBtn) {
    bindOnce(uncollapseBtn, 'click', () => setCollapsed(false), 'flex-uncollapse');
  }

  function fit() {
    if (!isDesktop()) {
      revertGridColumns();
      sidebar.style.removeProperty('width');
      return;
    }
    if (sidebar.classList.contains('collapsed')) return;
    let saved = NaN;
    try { saved = parseFloat(LGMDM.storage?.get(KEY_W) || ''); } catch (_) {}
    const fallback = window.innerWidth < 1100 ? window.innerWidth * 0.28 : window.innerWidth * 0.22;
    apply(Number.isFinite(saved) ? saved : fallback);
  }

  bindOnce(window, 'resize', fit, 'flex-window-resize', { passive:true });
  let collapsed = false;
  try { collapsed = LGMDM.storage?.get(KEY_C) === 'true'; } catch (_) {}
  setCollapsed(collapsed);
  fit();
})();
