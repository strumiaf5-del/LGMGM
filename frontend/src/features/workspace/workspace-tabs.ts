// workspace-tabs.ts — workspace tabs (console/analysis/presets)

import { bindOnce } from '../../core/ui';
import { storage } from '../../core/storage';

const STORAGE_KEY = 'lgmdm.workspace';
const VALID_WORKSPACES = ['console', 'analysis', 'presets'];

let analysisRedrawRaf: number | null = null;

function setWorkspace(name: string, persist = true): void {
  const root = document.getElementById('lgmdmWorkspaceShell');
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLElement>('.lg-workspace-workspace-tab'));
  const panes = Array.from(root.querySelectorAll<HTMLElement>('.lg-workspace-workspace'));
  tabs.forEach((t) => {
    const active = t.dataset.workspace === name;
    t.classList.toggle('active', active);
    t.setAttribute('aria-selected', String(active));
    t.tabIndex = active ? 0 : -1;
  });
  panes.forEach((p) => p.classList.toggle('active', p.dataset.workspace === name));
  if (persist) { try { storage.set(STORAGE_KEY, name); } catch { /* ignore */ } }
  document.body.dataset.workspace = name;
  document.querySelectorAll<HTMLElement>('.lg-workspace-workspace').forEach((p) => { p.hidden = p.dataset.workspace !== name; });
  if (analysisRedrawRaf) { cancelAnimationFrame(analysisRedrawRaf); analysisRedrawRaf = null; }
  if (name === 'analysis') {
    analysisRedrawRaf = requestAnimationFrame(() => {
      analysisRedrawRaf = null;
      const lg = (window as Window & { LGMDM?: { analysis?: { redraw?: () => void } } }).LGMDM;
      try { lg?.analysis?.redraw?.(); } catch { /* ignore */ }
    });
  }
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('workspace', name);
    window.history.replaceState(null, '', u.pathname + u.search);
  } catch { /* ignore */ }
}

function current(): string | undefined {
  return document.body.dataset.workspace;
}

function ensurePlaceholder(slotId: string, text: string): void {
  const slot = document.getElementById(slotId);
  if (!slot || slot.children.length) return;
  const el = document.createElement('div');
  el.className = 'lg-workspace-empty-state';
  el.textContent = text;
  slot.appendChild(el);
}

let wsController: AbortController | null = null;

function initWorkspaceTabs(): void {
  // FIX M1/M3: idempotency flag on window.LGMDM (survives HMR) + AbortController.
  const w = window as Window & { LGMDM?: { workspaceTabsBound?: boolean } };
  if (!w.LGMDM) w.LGMDM = {};
  if (w.LGMDM.workspaceTabsBound) return;
  w.LGMDM.workspaceTabsBound = true;
  if (wsController) wsController.abort();
  wsController = new AbortController();
  const signal = wsController.signal;
  const root = document.getElementById('lgmdmWorkspaceShell');
  if (!root) return;
  const tabs = Array.from(root.querySelectorAll<HTMLElement>('.lg-workspace-workspace-tab'));
  if (!tabs.length) return;

  tabs.forEach((tab, i) => {
    const ws = tab.dataset.workspace;
    if (!ws) return;
    tab.addEventListener('click', () => setWorkspace(ws), { signal });
    tab.addEventListener('keydown', (rawE) => {
      const e = rawE as KeyboardEvent;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        tabs[(i + 1) % tabs.length].focus();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        tabs[(i - 1 + tabs.length) % tabs.length].focus();
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        setWorkspace(ws);
      }
    }, { signal });
  });

  // Chain buttons jump back to Console while opening the requested pane.
  document.querySelectorAll<HTMLElement>('.lg-chain-node[data-pane], .lg-chain-control-strip [data-stage]').forEach((el) => {
    el.addEventListener('click', () => setWorkspace('console'), { signal });
  });

  ensurePlaceholder('presetGrid', 'Los presets aparecerán aquí cuando estén disponibles.');

  // Build the preset workspace from the already-wired preset buttons.
  const presetSource = Array.from(document.querySelectorAll<HTMLElement>('#presetGrid [data-preset]'));
  const presetGrid = document.getElementById('workspacePresetGrid');
  if (presetGrid) {
    presetSource.forEach((src) => {
      const card = document.createElement('div');
      card.className = 'lg-workspace-preset-card';
      const title = document.createElement('strong');
      title.textContent = src.textContent.trim();
      const note = document.createElement('small');
      note.textContent = 'Aplicar preset al motor y volver a consola.';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'APLICAR PRESET';
      btn.addEventListener('click', () => { src.click(); setWorkspace('console'); }, { signal });
      card.append(title, note, btn);
      presetGrid.appendChild(card);
    });
  }

  // Default to console; restore only known workspace values.
  let initial = 'console';
  try {
    const urlWs = new URL(window.location.href).searchParams.get('workspace');
    if (urlWs && VALID_WORKSPACES.includes(urlWs)) initial = urlWs;
    else {
      let saved: string | null = null;
      try { saved = storage.get(STORAGE_KEY); } catch { /* ignore */ }
      if (saved && VALID_WORKSPACES.includes(saved)) initial = saved;
    }
  } catch { /* ignore */ }
  setWorkspace(initial, false);
}

export function teardownWorkspaceTabs(): void {
  // FIX M3: abort the controller to remove all listeners at once.
  if (wsController) { wsController.abort(); wsController = null; }
  if (analysisRedrawRaf) { cancelAnimationFrame(analysisRedrawRaf); analysisRedrawRaf = null; }
  const w = window as Window & { LGMDM?: { workspaceTabsBound?: boolean } };
  if (w.LGMDM) w.LGMDM.workspaceTabsBound = false;
}
window.addEventListener('beforeunload', teardownWorkspaceTabs, { once: true });

// Bridge to window.LGMDM.workspace (legacy compat — preserved BUGFIX).
interface LgmdmWorkspace {
  workspace?: { setWorkspace: typeof setWorkspace; current: () => string | undefined };
}
function lgmdm(): LgmdmWorkspace {
  return (window as Window & { LGMDM?: LgmdmWorkspace }).LGMDM || {};
}
const g = lgmdm();
g.workspace = { setWorkspace, current };

// Boot.
if (document.readyState === 'loading') {
  bindOnce(document, 'DOMContentLoaded', initWorkspaceTabs, 'workspace-dom-ready', { once: true });
} else {
  initWorkspaceTabs();
}
