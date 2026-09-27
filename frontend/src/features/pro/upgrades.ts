// upgrades.ts — pro upgrades (mini-metrics + undo patches)

import { bindOnce } from '../../core/ui';

interface UndoManager {
  saveState: (state: unknown, label?: string) => void;
  undo: () => unknown;
  redo: () => unknown;
  currentState: unknown;
  undoStack: { state: unknown; label: string; timestamp: number }[];
  redoStack: { state: unknown; label: string; timestamp: number }[];
  maxStates: number;
  notifyListeners: () => void;
}

interface LgmdmWithUndo {
  undo?: { manager?: UndoManager };
  state?: { getSelectedFile?: () => unknown; getLastAnalysis?: () => Record<string, unknown> | null };
  pro?: { renderMini?: typeof renderMini };
}

function lgmdm(): LgmdmWithUndo {
  const w = window as Window & { LGMDM?: LgmdmWithUndo };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

type MiniField = readonly [string, number | string | null | undefined];

export function renderMini(analysis: Record<string, unknown> | null): void {
  const target = document.querySelector<HTMLElement>('#proMiniMetrics');
  if (!target) return;
  if (!analysis || typeof analysis !== 'object') {
    target.replaceChildren();
    return;
  }
  const fields: MiniField[] = ([
    ['LUFS-I', analysis.integrated_lufs ?? analysis.lufs_i],
    ['LUFS-S', analysis.short_term_lufs ?? analysis.lufs_s],
    ['True Peak', analysis.true_peak_db ?? analysis.true_peak],
    ['DR', analysis.dynamic_range ?? analysis.dr],
  ] as [string, unknown][]).filter(([, v]) => v != null && Number.isFinite(v)) as MiniField[];
  if (!fields.length) {
    target.replaceChildren();
    return;
  }
  target.replaceChildren(...fields.map((field: MiniField) => {
    const [k, v] = field;
    const span = document.createElement('span');
    const label = document.createElement('b');
    label.textContent = k + ' ';
    const val = document.createElement('em');
    val.textContent = typeof v === 'number' ? v.toFixed(2) : String(v);
    span.append(label, val);
    return span;
  }));
}

let booted = false;
function boot(): void {
  if (booted) return;
  booted = true;
  // FIX M2: improveHistory() removed — undo-redo.ts already has the correct
  // implementation; this monkey-patch was dead code on cold load (manager
  // doesn't exist yet) and on HMR it would overwrite the good implementation
  // dropping a guard.
  bindOnce(window, 'analysis-updated', (event: Event) => {
    // detail=null also matters: clears the previous track's metrics.
    try {
      const detail = (event as CustomEvent).detail as Record<string, unknown> | null;
      renderMini(detail || null);
    } catch (err) {
      console.error('[pro-upgrades] analysis-updated handler threw:', err);
    }
  }, 'pro-analysis-updated');
  const initialAnalysis = lgmdm().state?.getLastAnalysis?.() ?? null;
  if (initialAnalysis) renderMini(initialAnalysis);
}

// Bridge to window.LGMDM.pro (legacy compat).
const g = lgmdm();
g.pro = g.pro || {};
g.pro.renderMini = renderMini;

// Boot.
if (document.readyState === 'loading') {
  bindOnce(document, 'DOMContentLoaded', boot, 'pro-upgrades-dom-ready', { once: true });
} else {
  boot();
}
