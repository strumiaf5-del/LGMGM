// undo-redo.ts — history panel
// Exposes window.LGMDM.undo.{manager, undoLastChange, redoLastChange, toggleHistoryPanel}.
import { getPrefersReducedMotion } from '../../core/utils';
import { showToast } from '../../core/ui';
import { openModal, closeModal, isModalOpen } from '../../core/modal-helper';

// ── Types ───────────────────────────────────────────────────────

/** A flat mastering-params snapshot (slider values, toggles, etc.). */
export type MasteringState = Record<string, string | number | boolean | null>;

/** One entry on the undo/redo stack. */
export interface HistoryEntry {
  state: MasteringState;
  label: string;
  timestamp: number;
}

/** Summarised view returned by `getHistory()` (no state payloads). */
export interface HistorySummary {
  undo: Array<{ label: string; timestamp: number }>;
  redo: Array<{ label: string; timestamp: number }>;
}

/** Payload delivered to `onChange` listeners. */
export interface ChangePayload {
  canUndo: boolean;
  canRedo: boolean;
  history: HistorySummary;
}

// ── Deep clone (JSON round-trip, typed) ──────────────────────────

/** Structured deep clone of a JSON-serialisable state snapshot.
 *  Uses a JSON round-trip (same semantics as the aporte) and casts the
 *  `any` returned by `JSON.parse` back to the typed snapshot. */
function cloneState(state: MasteringState): MasteringState {
  return JSON.parse(JSON.stringify(state)) as MasteringState;
}

// ── UndoRedoManager ──────────────────────────────────────────────

/** Bounded undo/redo stack manager with change notifications. */
export class UndoRedoManager {
  maxStates: number;
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  currentState: MasteringState | null;
  listeners: Array<(payload: ChangePayload) => void>;

  constructor(maxStates = 50) {
    this.maxStates = maxStates;
    this.undoStack = [];
    this.redoStack = [];
    this.currentState = null;
    this.listeners = [];
  }

  // Guardar estado actual
  /** Deep-clones `state`, pushes the previous state onto the undo stack
   *  (capped to `maxStates`), and clears the redo stack (any redo becomes
   *  invalid after a new change). */
  saveState(state: MasteringState, label = 'Change'): void {
    const next = cloneState(state);
    if (this.currentState !== null) {
      this.undoStack.push({
        state: cloneState(this.currentState),
        label,
        timestamp: Date.now(),
      });
      if (this.undoStack.length > this.maxStates) this.undoStack.shift();
    }
    this.redoStack = [];
    this.currentState = next;
    this.notifyListeners();
  }

  /** Pop the undo stack: pushes the current state onto redo and restores
   *  the previous state. Returns the restored entry, or null if nothing
   *  to undo (or if there is no current state to push onto redo). */
  undo(): HistoryEntry | null {
    if (this.undoStack.length === 0 || this.currentState === null) return null;
    this.redoStack.push({
      state: cloneState(this.currentState),
      label: 'Redo',
      timestamp: Date.now(),
    });
    const previousState = this.undoStack.pop() ?? null;
    if (previousState) {
      this.currentState = cloneState(previousState.state);
    }
    this.notifyListeners();
    return previousState;
  }

  /** Pop the redo stack: pushes the current state onto undo and restores
   *  the next state. Returns the restored entry, or null if nothing to
   *  redo. */
  redo(): HistoryEntry | null {
    if (this.redoStack.length === 0 || this.currentState === null) return null;
    this.undoStack.push({
      state: cloneState(this.currentState),
      label: 'Undo',
      timestamp: Date.now(),
    });
    const nextState = this.redoStack.pop() ?? null;
    if (nextState) {
      this.currentState = cloneState(nextState.state);
    }
    this.notifyListeners();
    return nextState;
  }

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Returns label+timestamp summaries for both stacks (no state payloads). */
  getHistory(): HistorySummary {
    return {
      undo: this.undoStack.map((s) => ({ label: s.label, timestamp: s.timestamp })),
      redo: this.redoStack.map((s) => ({ label: s.label, timestamp: s.timestamp })),
    };
  }

  /** Reset both stacks and the current state. */
  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.currentState = null;
    this.notifyListeners();
  }

  /** Subscribe to stack changes. Returns an unsubscribe function so the
   *  history panel (and any other consumer) can detach cleanly. */
  onChange(callback: (payload: ChangePayload) => void): () => void {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }

  // Notify listeners
  /** Fire all listeners with the current canUndo/canRedo/history snapshot.
   *  Each callback is wrapped in try/catch so one bad listener doesn't
   *  break the rest (defensive, matches the aporte). */
  notifyListeners(): void {
    const payload: ChangePayload = {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      history: this.getHistory(),
    };
    this.listeners.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error('Error in undo/redo listener:', err);
      }
    });
  }
}

// ── Manager instance reuse across HMR ────────────────────────────
// On a Vite HMR re-evaluation the class identity changes, so `instanceof`
// against the new class returns false for an instance built by the old
// module. We structurally verify the existing `LGMDM.undo.manager` instead,
// so the live manager (and its history) is reused across hot reloads.
function isManagerLike(v: unknown): v is UndoRedoManager {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as { saveState?: unknown; undo?: unknown; redo?: unknown; getHistory?: unknown; clear?: unknown };
  return (
    typeof o.saveState === 'function' &&
    typeof o.undo === 'function' &&
    typeof o.redo === 'function' &&
    typeof o.getHistory === 'function' &&
    typeof o.clear === 'function'
  );
}

// ── Bridge to window.LGMDM (legacy compat) ───────────────────────
// Same pattern as master-console.ts / utils.ts: read window.LGMDM, create
// if missing, attach the `undo` slice. Typed via a local LgmdmUndoGlobal
// view so access to `lgmdm().undo.*` / `lgmdm().undoBound` is type-checked.
interface LgmdmUndoNamespace {
  manager?: UndoRedoManager;
  undoLastChange?: () => void;
  redoLastChange?: () => void;
  toggleHistoryPanel?: () => void;
}

interface LgmdmUndoGlobal {
  undo?: LgmdmUndoNamespace;
  undoBound?: boolean;
  sliderIdToParam?: Record<string, string>;
}

function lgmdm(): LgmdmUndoGlobal {
  const w = window as Window & { LGMDM?: LgmdmUndoGlobal };
  return w.LGMDM ?? (w.LGMDM = {});
}

// ── Module state (single live instance) ─────────────────────────

// Create the namespace + reuse-or-create the manager. The module-level
// `manager` const always refers to the live instance (the one subscribers
// and undoLastChange/redoLastChange operate on), even across HMR.
const g0 = lgmdm();
g0.undo = g0.undo ?? {};
const manager: UndoRedoManager = isManagerLike(g0.undo.manager)
  ? g0.undo.manager
  : new UndoRedoManager();
g0.undo.manager = manager;

/** AbortController for panel + toggle-button listeners. Created on init,
 *  aborted on teardown. */
let panelController: AbortController | null = null;

/** Unsubscribe handle for the manager.onChange → history list subscription. */
let historyListUnsubscribe: (() => void) | null = null;

// ── Helpers ──────────────────────────────────────────────────────

/** Type guard for elements that expose a `.value` (sliders, selects, text). */
function isValueInput(
  el: HTMLElement | null,
): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLSelectElement ||
    el instanceof HTMLTextAreaElement
  );
}

// ── Aplicar estado restaurado por undo/redo ──────────────────────

/**
 * Replay a saved mastering snapshot onto the UI. Prefers
 * `window.applyPresetToUI` (set by the preset/params modules) when present;
 * otherwise falls back to updating sliders directly via the global
 * `LGMDM.sliderIdToParam` map. Always dispatches a
 * `mastering-state-applied` CustomEvent so the engine/visualizers update.
 */
export function applyMasteringState(state: MasteringState): void {
  if (!state) return; // defensive (the type is non-nullable, legacy callers may pass null)
  const applyPreset = window.applyPresetToUI;
  if (typeof applyPreset === 'function') {
    try {
      applyPreset(state);
    } catch (err) {
      console.error('[undo-redo] applyPresetToUI failed:', err);
    }
  } else {
    // Fallback: actualizar sliders directamente desde el mapa global
    const sliderMap = lgmdm().sliderIdToParam ?? {};
    for (const [sliderId, paramKey] of Object.entries(sliderMap)) {
      try {
        const val = state[paramKey];
        if (val == null) continue;
        const sliderEl = document.getElementById(sliderId);
        if (!isValueInput(sliderEl)) continue;
        sliderEl.value = String(val);
        sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
      } catch (err) {
        console.error(`[undo-redo] slider fallback failed for "${sliderId}":`, err);
      }
    }
  }
  // Notificar al engine/visualizers para que se actualicen
  try {
    window.dispatchEvent(new CustomEvent('mastering-state-applied', { detail: state }));
  } catch (err) {
    console.error('[undo-redo] dispatch "mastering-state-applied" failed:', err);
  }
}

// ── Funciones auxiliares ─────────────────────────────────────────

/** Pop the undo stack and apply the restored state, with a toast. */
export function undoLastChange(): void {
  try {
    const result = manager.undo();
    if (result) {
      showToast(`Deshacer: ${result.label}`, 'info', 2000);
      applyMasteringState(result.state);
    }
  } catch (err) {
    console.error('[undo-redo] undoLastChange failed:', err);
    showToast('No se pudo deshacer el cambio', 'error', 2500);
  }
}

/** Pop the redo stack and apply the restored state, with a toast. */
export function redoLastChange(): void {
  try {
    const result = manager.redo();
    if (result) {
      showToast(`Rehacer: ${result.label}`, 'info', 2000);
      applyMasteringState(result.state);
    }
  } catch (err) {
    console.error('[undo-redo] redoLastChange failed:', err);
    showToast('No se pudo rehacer el cambio', 'error', 2500);
  }
}

// ── UI para historial ────────────────────────────────────────────

/** Inline style for a history list button. The hover `transition` is
 *  omitted when the user prefers reduced motion (WCAG 2.3.3). */
function listItemStyle(): string {
  const transition = getPrefersReducedMotion() ? 'none' : 'background 0.2s';
  return [
    'padding: 4px 8px',
    'background: var(--ui-surface-3)',
    'border-radius: 4px',
    'margin-bottom: 4px',
    'cursor: pointer',
    `transition: ${transition}`,
    'font-size: 0.8em',
    'border: none',
    'color: inherit',
    'text-align: left',
    'width: 100%',
  ].join('; ');
}

/** Build the history panel once and append it to <body>. Re-runs subscribe
 *  to the manager (detaching any previous subscription first so re-creating
 *  the panel never leaks listeners). Returns the panel element. */
function createHistoryPanel(): HTMLDivElement {
  // Unsubscribe any previous history-list subscription (idempotent re-create).
  historyListUnsubscribe?.();
  historyListUnsubscribe = null;

  const panel = document.createElement('div');
  panel.id = 'history-panel';
  panel.className = 'history-panel';
  /* remaining runtime styles are defined in lgmdm.css */
  panel.dataset.historyPanel = 'true';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', 'Historial de cambios');
  panel.style.cssText = `
    position: fixed;
    top: 60px;
    right: 0;
    width: 280px;
    max-height: 400px;
    background: var(--ui-surface-2);
    border: 1px solid var(--ui-border);
    border-left: 2px solid var(--ui-accent);
    border-radius: var(--radius, 8px);
    padding: 12px;
    z-index: var(--z-modal, 1200);
    box-shadow: -4px 4px 12px rgba(0, 0, 0, 0.3);
    font-family: var(--sans);
    font-size: 0.85em;
    color: var(--ui-text);
    display: none;
  `;

  panel.innerHTML = `
    <div class="history-panel__header">
      <strong>Historial</strong>
      <button id="closeHistoryPanel" class="history-panel__close" type="button" aria-label="Cerrar historial">✕</button>
    </div>
    <div id="historyList" class="history-panel__list"></div>
  `;

  document.body.appendChild(panel);

  // Close button — registered with the panel AbortController so teardown
  // removes it in one shot.
  const ac = panelController;
  const closeBtn = document.getElementById('closeHistoryPanel');
  if (closeBtn && ac) {
    try {
      closeBtn.addEventListener(
        'click',
        () => {
          panel.style.display = 'none';
        },
        { signal: ac.signal },
      );
    } catch (err) {
      console.error('[undo-redo] closeHistoryPanel bind failed:', err);
    }
  }

  // Actualizar lista de historial
  historyListUnsubscribe = manager.onChange(({ history }) => {
    const list = document.getElementById('historyList');
    if (!list) return;

    list.innerHTML = '';

    // Undo stack
    if (history.undo.length > 0) {
      const undoTitle = document.createElement('div');
      undoTitle.textContent = '🔙 Deshacer';
      undoTitle.className = 'undo-history-title';
      list.appendChild(undoTitle);

      history.undo.slice().reverse().forEach((item) => {
        try {
          const li = document.createElement('button');
          li.type = 'button';
          li.style.cssText = listItemStyle();
          li.textContent = `• ${item.label}`;
          li.setAttribute('aria-label', `Deshacer: ${item.label}`);
          li.addEventListener('click', undoLastChange);
          if (!getPrefersReducedMotion()) {
            li.addEventListener('mouseenter', () => {
              li.style.background = 'var(--ui-border)';
            });
            li.addEventListener('mouseleave', () => {
              li.style.background = 'var(--ui-surface-3)';
            });
          }
          list.appendChild(li);
        } catch (err) {
          console.error('[undo-redo] render undo item failed:', err);
        }
      });
    }

    // Redo stack
    if (history.redo.length > 0) {
      const redoTitle = document.createElement('div');
      redoTitle.textContent = '🔜 Rehacer';
      redoTitle.style.cssText =
        'font-weight: 600; margin: 12px 0 4px 0; color: var(--ui-good);';
      list.appendChild(redoTitle);

      history.redo.slice().reverse().forEach((item) => {
        try {
          const li = document.createElement('button');
          li.type = 'button';
          li.style.cssText = listItemStyle();
          li.textContent = `• ${item.label}`;
          li.setAttribute('aria-label', `Rehacer: ${item.label}`);
          li.addEventListener('click', redoLastChange);
          if (!getPrefersReducedMotion()) {
            li.addEventListener('mouseenter', () => {
              li.style.background = 'var(--ui-border)';
            });
            li.addEventListener('mouseleave', () => {
              li.style.background = 'var(--ui-surface-3)';
            });
          }
          list.appendChild(li);
        } catch (err) {
          console.error('[undo-redo] render redo item failed:', err);
        }
      });
    }

    if (history.undo.length === 0 && history.redo.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Sin historial aún';
      empty.style.cssText =
        'color: var(--ui-muted); text-align: center; padding: 16px 0;';
      list.appendChild(empty);
    }
  });

  return panel;
}

// ── Toggle history panel ────────────────────────────────────────

/** Show or hide the history panel. Uses the shared modal-helper so the
 *  panel inherits focus-trap, Escape-to-close, and aria-modal semantics. */
export function toggleHistoryPanel(): void {
  const existing = document.getElementById('history-panel');
  const panel: HTMLElement = existing ?? createHistoryPanel();
  const isOpen = panel.style.display !== 'none' && isModalOpen(panel);
  if (isOpen) {
    closeModal(panel);
    panel.style.display = 'none';
  } else {
    panel.style.display = 'block';
    const toggleBtn = document.getElementById('historyToggleBtn');
    const opener =
      toggleBtn ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    openModal({
      modalEl: panel,
      openerEl: opener,
      closeOnBackdrop: false,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => {
        panel.style.display = 'none';
      },
    });
  }
}

// ── Agregar botón al header ──────────────────────────────────────

/** Inject the ⏱️ history toggle button into the header (before the theme
 *  switcher when possible). Idempotent: bails out if the button exists. */
function addHistoryToggleButton(): void {
  const headerRightEl = document.querySelector('.header-right');
  const headerEl = document.querySelector('header');
  const headerRight = headerRightEl instanceof HTMLElement ? headerRightEl : null;
  const header = headerEl instanceof HTMLElement ? headerEl : null;
  const target = headerRight ?? header;
  if (!target) return;
  if (document.getElementById('historyToggleBtn')) return;

  const historyBtn = document.createElement('button');
  historyBtn.id = 'historyToggleBtn';
  historyBtn.className = 'header-btn';
  historyBtn.textContent = '⏱️';
  historyBtn.title = 'Historial de cambios (Ctrl+H)';
  historyBtn.setAttribute('aria-label', 'Mostrar historial de cambios (Ctrl+H)');

  const ac = panelController;
  try {
    historyBtn.addEventListener('click', toggleHistoryPanel, ac ? { signal: ac.signal } : undefined);
  } catch (err) {
    console.error('[undo-redo] historyToggle bind failed:', err);
  }

  const themeSwitcher = document.getElementById('theme-switcher-btn');
  if (headerRight && themeSwitcher && themeSwitcher.parentNode === headerRight) {
    headerRight.insertBefore(historyBtn, themeSwitcher);
  } else {
    target.appendChild(historyBtn);
  }
}

// ── Inicializar ──────────────────────────────────────────────────

/** Build the panel + toggle button. Idempotent via `window.LGMDM.undoBound`
 *  so HMR re-evaluation never registers listeners twice. */
function initPanel(): void {
  const g = lgmdm();
  if (g.undoBound) return; // global guard — survives HMR reloads
  g.undoBound = true;

  const ac = new AbortController();
  panelController = ac;

  const build = (): void => {
    try {
      createHistoryPanel();
      addHistoryToggleButton();
    } catch (err) {
      console.error('[undo-redo] panel init failed:', err);
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build, { once: true, signal: ac.signal });
  } else {
    build();
  }
}

// ── Teardown ─────────────────────────────────────────────────────

/** Tear down the whole undo/redo feature:
 *  - abort the panel AbortController (removes close + toggle listeners);
 *  - unsubscribe the history list from the manager;
 *  - clear the undo/redo stacks + current state;
 *  - close the modal if open and remove the panel + button from the DOM;
 *  - reset `undoBound` so a later `initPanel()` can rebuild cleanly. */
export function teardownUndoRedo(): void {
  try {
    panelController?.abort();
  } catch (err) {
    console.error('[undo-redo] panelController abort failed:', err);
  }
  panelController = null;

  try {
    historyListUnsubscribe?.();
  } catch (err) {
    console.error('[undo-redo] history unsubscribe failed:', err);
  }
  historyListUnsubscribe = null;

  try {
    const panel = document.getElementById('history-panel');
    if (panel && isModalOpen(panel)) closeModal(panel);
    panel?.remove();
  } catch (err) {
    console.error('[undo-redo] panel remove failed:', err);
  }

  try {
    document.getElementById('historyToggleBtn')?.remove();
  } catch (err) {
    console.error('[undo-redo] toggle button remove failed:', err);
  }

  try {
    manager.clear();
  } catch (err) {
    console.error('[undo-redo] manager.clear() failed:', err);
  }

  // Reset the idempotency flag so a subsequent init can rebuild.
  lgmdm().undoBound = false;
}

// ── Typed getter for the singleton ──────────────────────────────

/** Typed accessor for the live UndoRedoManager singleton (the same
 *  instance exposed on `window.LGMDM.undo.manager`). */
export function getUndoRedoManager(): UndoRedoManager {
  return manager;
}

// ── Populá window.LGMDM.undo con la API pública ──────────────────
// Mismo patrón que master-console.ts: la namespace se completa para que
// keyboard-shortcuts (Ctrl+Z / Ctrl+Shift+Z / Ctrl+H) y widgets legacy
// puedan llamar `LGMDM.undo.undoLastChange()` etc.
g0.undo.undoLastChange = undoLastChange;
g0.undo.redoLastChange = redoLastChange;
g0.undo.toggleHistoryPanel = toggleHistoryPanel;

// Expose the state-replay helper as a window global for legacy callers.
window.applyMasteringState = applyMasteringState;

// ── Auto-init + beforeunload teardown ────────────────────────────
initPanel();
window.addEventListener('beforeunload', teardownUndoRedo, { once: true });

// ── Global type declarations for legacy window helpers ───────────
declare global {
  interface Window {
    /** Replays a saved mastering snapshot onto the UI sliders. Set here;
     *  consumed by legacy widgets and by undo/redo internally. */
    applyMasteringState?: (state: MasteringState) => void;
    /** Optional preset→UI replay (set by the preset/params modules). When
     *  present, applyMasteringState delegates to it instead of the slider
     *  fallback. */
    applyPresetToUI?: (state: MasteringState) => void;
  }
}
