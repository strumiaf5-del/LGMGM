// Shared utilities for the application
import { addResizeObserver, removeResizeObserver } from './dom';

// FIX M3: createResizeObserver eliminado — era dead code (0 callers en src/,
// tree-shakeado del bundle) y tenía un leak latente: pisaba
// window.resizeObserver sin desconectar el anterior. Si se necesita un
// ResizeObserver con cleanup, usar addResizeObserver/removeResizeObserver
// de dom.ts (que retornan el observer para poder removeObserverlo).

/**
 * Show a sidebar pane by id. Hides all other panes first.
 * This is a thin helper called by the tab navigation component.
 */
export function showPane(paneId: string): void {
  const panes = document.querySelectorAll<HTMLElement>('.sidebar-pane');
  panes.forEach((p) => {
    const isTarget = p.id === paneId;
    p.classList.toggle('sidebar-pane--active', isTarget);
    p.hidden = !isTarget;
  });
}

export { addResizeObserver, removeResizeObserver };