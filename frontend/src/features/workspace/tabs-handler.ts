// tabs-handler.ts — sidebar tab navigation

import { bindOnce } from '../../core/ui';
import { storage } from '../../core/storage';

interface TabState {
  activeTab: string;
}

interface LgmdmTabs {
  select?: (tabName: string) => void;
  getActive?: () => string;
  state?: TabState;
}

interface LgmdmGlobal {
  tabs?: LgmdmTabs;
  previewController?: { teardown?: () => void };
  mixerUI?: { activate?: () => void; deactivate?: () => void };
}

function lgmdm(): LgmdmGlobal {
  return (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM || {};
}

const PANE_MAP: Record<string, string> = {
  'pane-mastering-ref': 'archivo',
  'pane-archivo': 'archivo',
  'pane-cadena': 'cadena',
  'pane-salida': 'salida',
  'pane-mixer': 'mixer',
  'pane-proyectos': 'proyectos',
};

const DETAILS_MAP: Record<string, string> = {
  'pane-mastering-ref': 'pasoArchivo',
  'pane-archivo': 'pasoArchivo',
  'pane-cadena': 'pasoCadena',
  'pane-salida': 'pasoSalida',
  'pane-mixer': 'pasoMixer',
};

const VALID_TABS = ['pane-mastering-ref', 'pane-archivo', 'pane-cadena', 'pane-salida', 'pane-mixer', 'pane-proyectos'];

const TAB_STATE: TabState = { activeTab: 'pane-mastering-ref' };

function selectTabInternal(tabName: string): void {
  const normalized = VALID_TABS.includes(tabName) ? tabName : 'pane-mastering-ref';
  // No teardown of the preview when going to the Mixer: activateMixerMode
  // manages its own previewEngine. Calling teardown here would destroy the
  // mixer's engine before it can use it (race Mixer ↔ preview).
  if (normalized !== 'pane-mixer' && typeof lgmdm().previewController?.teardown === 'function') {
    try { lgmdm().previewController!.teardown!(); } catch { /* ignore */ }
  }
  const tabs = document.querySelectorAll<HTMLElement>('#sidebarTabs .sidebar-tab');
  TAB_STATE.activeTab = normalized;
  tabs.forEach((btn) => {
    const active = btn.dataset.pane === normalized;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  });

  if (normalized === 'pane-proyectos') {
    document.querySelector('.content-shell')?.classList.add('is-tab-hidden');
    return;
  }

  const container = document.getElementById('sidebarPaneContainer');
  if (container && PANE_MAP[normalized]) {
    container.className = container.className.replace(/sidebar-showing-\w+/g, '').trim();
    container.classList.add(`sidebar-showing-${PANE_MAP[normalized]}`);
  }

  Object.values(DETAILS_MAP)
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => el !== null)
    .forEach((details) => {
      if (typeof details.removeAttribute === 'function' && details.tagName === 'DETAILS') {
        details.removeAttribute('open');
      }
    });

  const activeDetails = document.getElementById(DETAILS_MAP[normalized]);
  if (activeDetails && activeDetails.tagName === 'DETAILS') {
    activeDetails.setAttribute('open', '');
  }

  if (normalized === 'pane-mixer') {
    if (typeof lgmdm().mixerUI?.activate === 'function') {
      try { lgmdm().mixerUI!.activate!(); } catch { /* ignore */ }
    } else {
      document.body.classList.add('mode-mixer');
      document.querySelector('.content')?.classList.add('content--mixer');
    }
  } else {
    if (typeof lgmdm().mixerUI?.deactivate === 'function') {
      try { lgmdm().mixerUI!.deactivate!(); } catch { /* ignore */ }
    } else {
      document.body.classList.remove('mode-mixer');
      document.querySelector('.content')?.classList.remove('content--mixer');
    }
  }

  document.querySelector('.content-shell')?.classList.remove('is-tab-hidden');
}

export function selectTab(tabName: string): void {
  selectTabInternal(tabName);
  try { storage.set('active-tab', TAB_STATE.activeTab); } catch { /* ignore */ }
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('tab', TAB_STATE.activeTab);
    window.history.replaceState(null, '', u.pathname + u.search);
  } catch { /* ignore */ }
}

export function getActiveTab(): string {
  return TAB_STATE.activeTab;
}

// FIX M3: AbortController so teardown can remove all listeners at once.
let controller: AbortController | null = null;

let boundTabs: HTMLElement[] = [];
function initTabs(): void {
  // FIX M1/M3: idempotency flag on window.LGMDM (survives HMR).
  const w = window as Window & { LGMDM?: { tabsHandlerBound?: boolean } };
  if (!w.LGMDM) w.LGMDM = {};
  if (w.LGMDM.tabsHandlerBound) return;
  w.LGMDM.tabsHandlerBound = true;
  if (controller) controller.abort();
  controller = new AbortController();
  const signal = controller.signal;
  const tabs = Array.from(document.querySelectorAll<HTMLElement>('#sidebarTabs .sidebar-tab[data-pane]'));
  if (!tabs.length) return;
  boundTabs = tabs;
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => {
      if (tab.dataset.pane) selectTab(tab.dataset.pane);
    }, { signal });
    tab.addEventListener('keydown', (rawE) => {
      const e = rawE as KeyboardEvent;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        const next = tabs[(i + 1) % tabs.length];
        next.focus();
        if (next.dataset.pane) selectTab(next.dataset.pane);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        const prev = tabs[(i - 1 + tabs.length) % tabs.length];
        prev.focus();
        if (prev.dataset.pane) selectTab(prev.dataset.pane);
      }
    }, { signal });
  });
  let saved: string | null = null;
  try { saved = storage.get('active-tab'); } catch { /* ignore */ }
  let urlTab: string | null = null;
  try { urlTab = new URL(window.location.href).searchParams.get('tab'); } catch { /* ignore */ }
  const initial = urlTab && VALID_TABS.includes(urlTab)
    ? urlTab
    : saved && VALID_TABS.includes(saved)
      ? saved
      : 'pane-mastering-ref';
  selectTabInternal(initial);
}

export function teardownTabsHandler(): void {
  // FIX M3: abort the controller to remove all listeners at once.
  if (controller) { controller.abort(); controller = null; }
  boundTabs = [];
  const w = window as Window & { LGMDM?: { tabsHandlerBound?: boolean } };
  if (w.LGMDM) w.LGMDM.tabsHandlerBound = false;
}
window.addEventListener('beforeunload', teardownTabsHandler, { once: true });

// Bridge to window.LGMDM.tabs (legacy compat — keyboard-shortcuts may read).
const g = lgmdm();
g.tabs = g.tabs || { state: TAB_STATE };
g.tabs.select = selectTab;
g.tabs.getActive = getActiveTab;
g.tabs.state = TAB_STATE;

// Boot.
if (document.readyState === 'loading') {
  bindOnce(document, 'DOMContentLoaded', initTabs, 'tabs-handler-dom-ready', { once: true });
} else {
  initTabs();
}
