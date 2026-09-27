// keyboard-shortcuts.ts — keyboard shortcuts

interface ShortcutAction {
  label: string;
  description: string;
  handler: (e: KeyboardEvent) => void;
  preventDefault?: boolean;
}

const SHORTCUTS: Record<string, ShortcutAction> = {
  // Analysis & mastering
  'ctrl+shift+a': {
    label: 'Analizar',
    description: 'Ejecutar análisis del archivo cargado',
    handler: () => document.getElementById('btnAnalyze')?.click(),
  },
  'ctrl+shift+r': {
    label: 'Recomendaciones',
    description: 'Obtener recomendaciones de IA',
    handler: () => document.getElementById('btnAdvice')?.click(),
  },
  'ctrl+shift+m': {
    label: 'Master (Sync)',
    description: 'Masterizar sincrónico',
    handler: () => document.getElementById('btnMasterSync')?.click(),
  },
  'ctrl+shift+q': {
    label: 'Master (Queue)',
    description: 'Encolar mastering',
    handler: () => document.getElementById('btnMasterAsync')?.click(),
  },
  'ctrl+shift+p': {
    label: 'Pitch Correction',
    description: 'Corregir pitch',
    handler: () => document.getElementById('btnPitchCorrection')?.click(),
  },

  // Normalization
  'ctrl+shift+l': {
    label: 'Normalizar LUFS',
    description: 'Normalizar por LUFS',
    handler: () => document.getElementById('btnNormalizeLufs')?.click(),
  },

  // Editing
  'ctrl+z': {
    label: 'Undo',
    description: 'Deshacer último cambio',
    handler: () => lgmdm().undo?.undoLastChange?.(),
  },
  'ctrl+shift+z': {
    label: 'Redo',
    description: 'Rehacer cambio',
    handler: () => lgmdm().undo?.redoLastChange?.(),
  },
  'ctrl+h': {
    label: 'Historial',
    description: 'Alternar panel de historial (deshacer/rehacer)',
    handler: () => lgmdm().undo?.toggleHistoryPanel?.(),
  },

  // Playback
  ' ': {
    label: 'Play/Pause',
    description: 'Reproducir o pausar audio',
    handler: () => lgmdm().playback?.toggle?.() ?? document.getElementById('consolePlayBtn')?.click(),
    preventDefault: true,
  },

  // A/B
  'ctrl+b': {
    label: 'Toggle A/B',
    description: 'Alternar comparación A/B',
    handler: () => lgmdm().ab?.toggle?.() ?? document.getElementById('consoleABToggle')?.click(),
  },

  // Presets
  'ctrl+s': {
    label: 'Guardar Preset',
    description: 'Guardar configuración actual como preset',
    handler: () => (window as Window & { saveCurrentPreset?: () => void }).saveCurrentPreset?.(),
  },

  // Theme
  'ctrl+t': {
    label: 'Alternar Tema',
    description: 'Cambiar entre temas claro/oscuro',
    handler: () => (window as Window & { toggleTheme?: () => void }).toggleTheme?.(),
  },

  // Help
  'shift+/': {
    label: 'Mostrar Atajos',
    description: 'Mostrar lista de atajos de teclado',
    handler: () => lgmdm().shortcuts?.show?.(),
    preventDefault: true,
  },

  // Reference loader
  'r': {
    label: 'Cargar Referencia',
    description: 'Foco en selector de referencia',
    handler: () => document.getElementById('refFileInput')?.focus(),
  },

  // Slider nudging (FIX: arrowup/arrowdown, not up/down)
  'arrowup': {
    label: 'Incrementar Parámetro',
    description: 'Aumentar el parámetro enfocado',
    handler: (e) => adjustFocusedSlider(1, e),
  },
  'arrowdown': {
    label: 'Decrementar Parámetro',
    description: 'Disminuir el parámetro enfocado',
    handler: (e) => adjustFocusedSlider(-1, e),
  },
};

// ── Global LGMDM access ──────────────────────────────────────────
interface LgmdmGlobal {
  undo?: {
    undoLastChange?: () => void;
    redoLastChange?: () => void;
    toggleHistoryPanel?: () => void;
  };
  playback?: { toggle?: () => void };
  ab?: { toggle?: () => void; setMode?: (m: string) => void };
  shortcuts?: { show?: () => void };
  ui?: { showToast?: (msg: string, type?: string) => void };
  shortcutsBound?: boolean;
}

function lgmdm(): LgmdmGlobal {
  // FIX M1: reassign window.LGMDM if missing so HMR idempotency flags survive.
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

// ── Normalize a KeyboardEvent into a shortcut key ───────────────
function normalizeShortcut(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  const key = String(e.key ?? e.code ?? '').toLowerCase();
  if (!key) return '';

  if (key === 'spacebar') {
    parts.push(' ');
  } else if (key.length === 1) {
    parts.push(key);
  } else if (e.code) {
    parts.push(e.code.toLowerCase());
  }
  return parts.join('+');
}

// ── Slider nudge handler ────────────────────────────────────────
function adjustFocusedSlider(direction: 1 | -1, e: KeyboardEvent): void {
  const focused = document.activeElement;
  if (!focused || !(focused instanceof HTMLInputElement) || focused.type !== 'range') return;
  e.preventDefault();
  const step = parseFloat(focused.step) || 1;
  const current = parseFloat(focused.value);
  const min = parseFloat(focused.min);
  const max = parseFloat(focused.max);
  const next = Math.max(min, Math.min(max, current + step * direction));
  if (!Number.isFinite(next)) return;
  focused.value = String(next);
  focused.dispatchEvent(new Event('input', { bubbles: true }));
  focused.dispatchEvent(new Event('change', { bubbles: true }));
}

// ── Help modal with focus trap and AbortController cleanup ──────
let modal: HTMLDivElement | null = null;
let modalAbort: AbortController | null = null;

function closeShortcutsModal(): void {
  if (modalAbort) { modalAbort.abort(); modalAbort = null; }
  if (modal) {
    // FIX M4: el setAttribute('aria-hidden') estaba después de modal.remove()
    // → sin efecto (elemento huérfano). Era dead code.
    modal.remove();
    modal = null;
  }
}

function showShortcutsModal(): void {
  if (modal) {
    // Toggle: if visible, close; if hidden, show.
    const hidden = modal.getAttribute('aria-hidden') === 'true';
    if (hidden) {
      modal.style.display = 'block';
      modal.setAttribute('aria-hidden', 'false');
      focusFirst();
    } else {
      closeShortcutsModal();
    }
    return;
  }

  modalAbort = new AbortController();
  const signal = modalAbort.signal;

  modal = document.createElement('div');
  modal.id = 'keyboard-shortcuts-modal';
  modal.setAttribute('role', 'dialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-labelledby', 'shortcuts-modal-title');
  modal.setAttribute('aria-hidden', 'false');
  Object.assign(modal.style, {
    position: 'fixed', inset: '0', zIndex: '1200',
    display: 'block', padding: '1.5rem',
  });

  const overlay = document.createElement('div');
  Object.assign(overlay.style, {
    position: 'absolute', inset: '0',
    background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(4px)',
  });
  overlay.addEventListener('click', closeShortcutsModal, { signal });

  const content = document.createElement('div');
  Object.assign(content.style, {
    position: 'relative', margin: '0 auto', maxWidth: '600px',
    maxHeight: '70vh', overflowY: 'auto',
    background: 'var(--ui-surface, #0b1224)',
    border: '1px solid var(--ui-border, rgba(125,232,255,0.22))',
    borderRadius: '12px', padding: '1.5rem', color: 'var(--ui-text, #f1f5f9)',
  });

  const title = document.createElement('h2');
  title.id = 'shortcuts-modal-title';
  title.textContent = '⌨️ Atajos de Teclado';
  Object.assign(title.style, { margin: '0 0 1rem', fontSize: '1.5em' });
  content.appendChild(title);

  const grid = document.createElement('div');
  Object.assign(grid.style, {
    display: 'grid', gridTemplateColumns: '140px 1fr', gap: '0.5rem 1rem', fontSize: '0.9em',
  });
  for (const action of Object.values(SHORTCUTS)) {
    const combo = Object.keys(SHORTCUTS).find((k) => SHORTCUTS[k] === action) || '';
    const kbd = document.createElement('kbd');
    kbd.textContent = combo;
    Object.assign(kbd.style, {
      background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
      borderRadius: '4px', padding: '2px 6px', fontFamily: 'var(--mono, monospace)',
      textTransform: 'uppercase', fontSize: '0.85em',
    });
    grid.appendChild(kbd);

    const label = document.createElement('span');
    label.textContent = action.label;
    grid.appendChild(label);

    const expl = document.createElement('span');
    expl.textContent = action.description;
    Object.assign(expl.style, { gridColumn: '2', color: 'var(--ui-muted, #94a3b8)', fontSize: '0.85em' });
    grid.appendChild(expl);
  }
  content.appendChild(grid);

  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕ Cerrar';
  Object.assign(closeBtn.style, {
    marginTop: '1.5rem', padding: '0.6rem 1rem', width: '100%',
    background: 'rgba(255,255,255,0.06)', color: 'inherit',
    border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px',
    cursor: 'pointer', fontWeight: '600',
  });
  closeBtn.addEventListener('click', closeShortcutsModal, { signal });
  content.appendChild(closeBtn);

  modal.appendChild(overlay);
  modal.appendChild(content);
  document.body.appendChild(modal);

  // Escape to close + focus trap.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.preventDefault(); closeShortcutsModal(); return; }
    if (e.key === 'Tab' && modal) {
      const focusables = modal.querySelectorAll<HTMLElement>('button, [href], input, [tabindex="0"]');
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault(); first.focus();
      }
    }
  }, { signal });

  focusFirst();
}

function focusFirst(): void {
  if (!modal) return;
  requestAnimationFrame(() => {
    modal?.querySelector<HTMLElement>('button, [href], input, [tabindex="0"]')?.focus();
  });
}

// ── Floating help indicator (accessible <button>) ───────────────
function addHelpIndicator(): void {
  if (document.getElementById('lgmdm-shortcut-help')) return;
  const indicator = document.createElement('button');
  indicator.id = 'lgmdm-shortcut-help';
  indicator.type = 'button';
  indicator.textContent = 'Presiona ? para ver atajos';
  indicator.setAttribute('aria-label', 'Mostrar atajos de teclado');
  Object.assign(indicator.style, {
    position: 'fixed', bottom: '20px', left: '20px',
    padding: '8px 12px', background: 'var(--ui-surface, #0b1224)',
    border: '1px solid var(--ui-border, rgba(125,232,255,0.22))',
    borderRadius: '6px', fontSize: '0.85em',
    color: 'var(--ui-text, #f1f5f9)', cursor: 'pointer',
    zIndex: '9997',
  });
  indicator.addEventListener('click', showShortcutsModal);
  document.body.appendChild(indicator);
}

// ── Setup ───────────────────────────────────────────────────────
function setupKeyboardShortcuts(): void {
  const g = lgmdm();
  if (g.shortcutsBound) return; // global guard — survives HMR
  g.shortcutsBound = true;

  const focusableInputs = new Set(['input', 'textarea', 'select']);
  const allowedInInputs = new Set(['ctrl+z', 'ctrl+shift+z']);
  // FIX M10: Space (' ') must not fire play/pause when a button/link/summary is
  // focused — those elements activate on Space per WAI-ARIA. Without this,
  // tabbing to any button and pressing Space would toggle playback instead of
  // activating the button.
  const spaceBlockingTags = new Set(['button', 'a', 'summary']);

  document.addEventListener('keydown', (e: KeyboardEvent) => {
    const activeTag = document.activeElement?.tagName.toLowerCase() ?? '';
    const isInput = focusableInputs.has(activeTag);

    const shortcut = normalizeShortcut(e);
    // In inputs, only allow the allow-list to fire (Ctrl+Z family).
    if (isInput && !allowedInInputs.has(shortcut)) return;
    // Space should only toggle playback when nothing interactive is focused.
    if (shortcut === ' ' && spaceBlockingTags.has(activeTag)) return;

    const action = SHORTCUTS[shortcut];
    if (!action) return;

    if (action.preventDefault !== false) e.preventDefault();
    try {
      action.handler(e);
    } catch (err) {
      console.error(`Error executing shortcut "${shortcut}":`, err);
      lgmdm().ui?.showToast?.(`Error ejecutando atajo: ${(err as Error).message}`, 'error');
    }
  });
}

// Export the show function so it can be re-bound from other modules.
function initKeyboardShortcuts(): void {
  setupKeyboardShortcuts();
  addHelpIndicator();
  // Expose the show() so the '?' shortcut and the indicator can both call it.
  const g = lgmdm();
  g.shortcuts = g.shortcuts || {};
  g.shortcuts.show = showShortcutsModal;
}

// Auto-init on DOMContentLoaded (so the module is side-effectful on import).
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initKeyboardShortcuts, { once: true });
} else {
  initKeyboardShortcuts();
}

export { setupKeyboardShortcuts, showShortcutsModal, closeShortcutsModal, initKeyboardShortcuts };
