// ============================================================
// 18-undo-redo.js — Historial de cambios (undo/redo)
// ============================================================

(function () {
  "use strict";

  class UndoRedoManager {
    constructor(maxStates = 50) {
      this.maxStates = maxStates;
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = null;
      this.listeners = [];
    }

    // Guardar estado actual
    saveState(state, label = 'Change') {
      const next = JSON.parse(JSON.stringify(state));
      if (this.currentState !== null) {
        this.undoStack.push({
          state: JSON.parse(JSON.stringify(this.currentState)),
          label,
          timestamp: Date.now(),
        });
        if (this.undoStack.length > this.maxStates) this.undoStack.shift();
      }
      this.redoStack = [];
      this.currentState = next;
      this.notifyListeners();
    }

    undo() {
      if (this.undoStack.length === 0) return null;
      this.redoStack.push({
        state: JSON.parse(JSON.stringify(this.currentState)),
        label: 'Redo',
        timestamp: Date.now(),
      });
      const previousState = this.undoStack.pop();
      this.currentState = JSON.parse(JSON.stringify(previousState.state));
      this.notifyListeners();
      return previousState;
    }

    redo() {
      if (this.redoStack.length === 0) return null;
      this.undoStack.push({
        state: JSON.parse(JSON.stringify(this.currentState)),
        label: 'Undo',
        timestamp: Date.now(),
      });
      const nextState = this.redoStack.pop();
      this.currentState = JSON.parse(JSON.stringify(nextState.state));
      this.notifyListeners();
      return nextState;
    }

    canUndo() {
      return this.undoStack.length > 0;
    }

    canRedo() {
      return this.redoStack.length > 0;
    }

    getHistory() {
      return {
        undo: this.undoStack.map(s => ({ label: s.label, timestamp: s.timestamp })),
        redo: this.redoStack.map(s => ({ label: s.label, timestamp: s.timestamp })),
      };
    }

    clear() {
      this.undoStack = [];
      this.redoStack = [];
      this.currentState = null;
      this.notifyListeners();
    }

    onChange(callback) {
      this.listeners.push(callback);
    }

    notifyListeners() {
      this.listeners.forEach(cb => {
        try {
          cb({
            canUndo: this.canUndo(),
            canRedo: this.canRedo(),
            history: this.getHistory(),
          });
        } catch (err) {
          console.error('Error in undo/redo listener:', err);
        }
      });
    }
  }

  // ── Crear instancia global ──
  window.LGMDM.undo = window.LGMDM.undo || {};
  window.LGMDM.undo.manager = new UndoRedoManager();

  // ── Funciones auxiliares ──
  window.LGMDM.undo.undoLastChange = function() {
    const result = window.LGMDM.undo.manager.undo();
    if (result) {
      window.LGMDM.ui.showToast?.(`Deshacer: ${result.label}`, 'info', 2000);
      window.applyMasteringState?.(result.state);
    }
  };

  window.LGMDM.undo.redoLastChange = function() {
    const result = window.LGMDM.undo.manager.redo();
    if (result) {
      window.LGMDM.ui.showToast?.(`Rehacer: ${result.label}`, 'info', 2000);
      window.applyMasteringState?.(result.state);
    }
  };

  // ── UI para historial ──
  function createHistoryPanel() {
    const panel = document.createElement('div');
    panel.id = 'history-panel';
    panel.className = "history-panel";
  /* remaining runtime styles are defined in lgmdm.css */
  panel.dataset.historyPanel = "true";
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

    document.getElementById('closeHistoryPanel')?.addEventListener('click', () => {
      panel.style.display = 'none';
    });

    // Actualizar lista de historial
    window.LGMDM.undo.manager.onChange(({ history }) => {
      const list = document.getElementById('historyList');
      if (!list) return;

      list.innerHTML = '';

      // Undo stack
      if (history.undo.length > 0) {
        const undoTitle = document.createElement('div');
        undoTitle.textContent = '🔙 Deshacer';
        undoTitle.className = 'undo-history-title';
        list.appendChild(undoTitle);

        history.undo.slice().reverse().forEach(item => {
          const li = document.createElement('button');
          li.type = 'button';
          li.style.cssText = `
            padding: 4px 8px;
            background: var(--ui-surface-3);
            border-radius: 4px;
            margin-bottom: 4px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.8em;
            border: none;
            color: inherit;
            text-align: left;
            width: 100%;
          `;
          li.textContent = `• ${item.label}`;
          li.setAttribute('aria-label', `Deshacer: ${item.label}`);
          li.addEventListener('click', window.LGMDM.undo.undoLastChange);
          li.addEventListener('mouseenter', () => {
            li.style.background = 'var(--ui-border)';
          });
          li.addEventListener('mouseleave', () => {
            li.style.background = 'var(--ui-surface-3)';
          });
          list.appendChild(li);
        });
      }

      // Redo stack
      if (history.redo.length > 0) {
        const redoTitle = document.createElement('div');
        redoTitle.textContent = '🔜 Rehacer';
        redoTitle.style.cssText = 'font-weight: 600; margin: 12px 0 4px 0; color: var(--ui-good);';
        list.appendChild(redoTitle);

        history.redo.slice().reverse().forEach(item => {
          const li = document.createElement('button');
          li.type = 'button';
          li.style.cssText = `
            padding: 4px 8px;
            background: var(--ui-surface-3);
            border-radius: 4px;
            margin-bottom: 4px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.8em;
            border: none;
            color: inherit;
            text-align: left;
            width: 100%;
          `;
          li.textContent = `• ${item.label}`;
          li.setAttribute('aria-label', `Rehacer: ${item.label}`);
          li.addEventListener('click', window.LGMDM.undo.redoLastChange);
          li.addEventListener('mouseenter', () => {
            li.style.background = 'var(--ui-border)';
          });
          li.addEventListener('mouseleave', () => {
            li.style.background = 'var(--ui-surface-3)';
          });
          list.appendChild(li);
        });
      }

      if (history.undo.length === 0 && history.redo.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = 'Sin historial aún';
        empty.style.cssText = 'color: var(--ui-muted); text-align: center; padding: 16px 0;';
        list.appendChild(empty);
      }
    });

    return panel;
  }

  // ── Toggle history panel ──
  window.LGMDM.undo.toggleHistoryPanel = function() {
    const panel = document.getElementById('history-panel') || createHistoryPanel();
    const isOpen = panel.style.display !== 'none' && window.LGMDM.ui.isModalOpen(panel);
    if (isOpen) {
      window.LGMDM.ui.closeModal(panel);
      panel.style.display = 'none';
    } else {
      panel.style.display = 'block';
      window.LGMDM.ui.openModal({
        modalEl: panel,
        openerEl: document.getElementById('historyToggleBtn') || document.activeElement,
        closeOnBackdrop: false,
        trapFocus: true,
        closeOnEscape: true,
        onClose: () => { panel.style.display = 'none'; },
      });
    }
  };

  // ── Agregar botón al header ──
  function addHistoryToggleButton() {
    const headerRight = document.querySelector('.header-right');
    const header = document.querySelector('header');
    const target = headerRight || header;
    if (!target) return;
    if (document.getElementById('historyToggleBtn')) return;

    const historyBtn = document.createElement('button');
    historyBtn.id = 'historyToggleBtn';
    historyBtn.className = 'header-btn';
    historyBtn.textContent = '⏱️';
    historyBtn.title = 'Historial de cambios (Ctrl+H)';
    historyBtn.setAttribute('aria-label', 'Mostrar historial de cambios (Ctrl+H)');
    historyBtn.addEventListener('click', window.LGMDM.undo.toggleHistoryPanel);

    const themeSwitcher = document.getElementById('theme-switcher-btn');
    if (headerRight && themeSwitcher && themeSwitcher.parentNode === headerRight) {
      headerRight.insertBefore(historyBtn, themeSwitcher);
    } else {
      target.appendChild(historyBtn);
    }
  }

  // ── Inicializar ──
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      createHistoryPanel();
      addHistoryToggleButton();
    });
  } else {
    createHistoryPanel();
    addHistoryToggleButton();
  }

  // ── Aplicar estado restaurado por undo/redo ──
  window.applyMasteringState = function applyMasteringState(state) {
    if (!state || typeof state !== 'object') return;
    const applyPreset = window.applyPresetToUI;
    if (typeof applyPreset === 'function') {
      applyPreset(state);
    } else {
      // Fallback: actualizar sliders directamente desde el mapa global
      const sliderMap = window.LGMDM?.sliderIdToParam || {};
      Object.entries(sliderMap).forEach(([sliderId, paramKey]) => {
        if (state[paramKey] == null) return;
        const sliderEl = document.getElementById(sliderId);
        if (!sliderEl) return;
        sliderEl.value = state[paramKey];
        sliderEl.dispatchEvent(new Event('input', { bubbles: true }));
      });
    }
    // Notificar al engine/visualizers para que se actualicen
    window.dispatchEvent(new CustomEvent('mastering-state-applied', { detail: state }));
  };
})();
