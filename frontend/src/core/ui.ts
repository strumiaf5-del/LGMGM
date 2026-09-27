// UI core — bindOnce, escapeHtml, showToast, playback arbiter

import { getJSON, setJSON } from './storage';

// ── bindOnce ───────────────────────────────────────────────────
const bound = new WeakMap<EventTarget, Set<string>>();

/**
 * Add an event listener only once per (element, type, key) triple.
 * Returns true if the listener was added, false if it was already bound.
 */
export function bindOnce(
  el: EventTarget | null,
  type: string,
  handler: EventListenerOrEventListenerObject,
  key: string = type,
  options?: boolean | AddEventListenerOptions,
): boolean {
  if (!el || typeof el.addEventListener !== 'function') return false;
  let map = bound.get(el);
  if (!map) { map = new Set(); bound.set(el, map); }
  const token = `${type}:${key}`;
  if (map.has(token)) return false;
  el.addEventListener(type, handler, options);
  map.add(token);
  return true;
}

// ── escapeHtml ─────────────────────────────────────────────────
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── safeAudioSrc ──────────────────────────────────────────────
/** Validate an audio src URL. Only http(s) and blob: are allowed; everything
 *  else (javascript:, data:, file:) returns '' to prevent XSS/navigation. */
export function safeAudioSrc(value: unknown): string {
  try {
    const raw = String(value ?? '').trim();
    if (!raw) return '';
    const u = new URL(raw, location.href);
    if (['http:', 'https:', 'blob:'].includes(u.protocol)) return u.href;
  } catch { /* ignore */ }
  return '';
}

// ── formatDisplay / syncRangeDisplay ──────────────────────────
type DisplayFormat = 'percent' | 'fixed1' | 'fixed2' | 'fixed1s' | 'raw';

export function formatDisplay(value: unknown, format: DisplayFormat | string = 'raw'): string {
  const n = Number(value);
  switch (format) {
    case 'percent': return `${value}%`;
    case 'fixed1': return Number.isFinite(n) ? n.toFixed(1) : String(value);
    case 'fixed2': return Number.isFinite(n) ? n.toFixed(2) : String(value);
    case 'fixed1s': return Number.isFinite(n) ? `${n.toFixed(1)}s` : String(value);
    default: return String(value);
  }
}

export function syncRangeDisplay(input: HTMLInputElement | null): void {
  if (!input?.dataset?.displayTarget) return;
  const target = document.getElementById(input.dataset.displayTarget);
  if (!target) return;
  target.textContent = formatDisplay(input.value, input.dataset.displayFormat || 'raw');
}

// ── syncParallelBypass ────────────────────────────────────────
const PARALLEL_CONTROL_IDS = ['parallelMix', 'parallelThresh', 'parallelRatio', 'parallelAttack', 'parallelRelease'] as const;

export function syncParallelBypass(input: HTMLElement | null): void {
  if (!input?.matches?.('[data-parallel-bypass]')) return;
  const off = (input as HTMLInputElement).checked === true;
  PARALLEL_CONTROL_IDS.forEach((id) => {
    const control = document.getElementById(id) as HTMLInputElement | null;
    if (!control) return;
    control.disabled = off;
    const row = control.closest('.param');
    if (row) row.classList.toggle('is-disabled-by-bypass', off);
  });
}

// ── clearResults ──────────────────────────────────────────────
const RESULT_SELECTORS = [
  '#results', '#result', '#analysisResults', '#analysis-results',
  '#masteringResults', '#mastering-results', '#resultPanel', '.results-panel',
  '#analysisDynamicContent',
];

const STATUS_SELECTORS = ['#consoleStatus', '#previewPanelStatus', '#previewStatus', '#previewActionStatus'];

export function clearResults(): void {
  RESULT_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      if ('value' in node && (node.tagName === 'INPUT' || node.tagName === 'TEXTAREA')) {
        (node as HTMLInputElement | HTMLTextAreaElement).value = '';
      } else {
        node.replaceChildren();
      }
    });
  });
  STATUS_SELECTORS.forEach((selector) => {
    document.querySelectorAll(selector).forEach((node) => {
      const el = node as HTMLElement;
      if (el.id === 'consoleStatus') el.textContent = 'Listo para recibir audio';
      else if (el.id === 'previewPanelStatus') el.textContent = 'Listo para procesar';
      else if (el.id === 'previewActionStatus') el.textContent = 'Esperando archivo';
      else el.textContent = '';
    });
  });
}

// ── showStatus ────────────────────────────────────────────────
type StatusType = 'info' | 'success' | 'warning' | 'error' | 'warn';

export function showStatus(
  target: string | HTMLElement | null,
  message: unknown,
  type: StatusType = 'info',
  progress: number | null = null,
  stage: string | null = null,
): void {
  const text = message == null ? '' : String(message);
  const safeType = (type === 'warn' ? 'warning' : type) as StatusType;

  const targeted = typeof target === 'string' ? document.getElementById(target) : target;
  if (targeted) {
    targeted.textContent = text;
    (targeted as HTMLElement).dataset.statusType = String(safeType);
    if (progress != null) (targeted as HTMLElement).dataset.progress = String(progress);
    else delete (targeted as HTMLElement).dataset.progress;
    if (stage != null) (targeted as HTMLElement).dataset.stage = String(stage);
    else delete (targeted as HTMLElement).dataset.stage;
  }

  const status = document.getElementById('consoleStatus');
  const previewStatus = document.getElementById('previewPanelStatus');
  const compactStatus = document.getElementById('previewActionStatus');
  if (status) status.textContent = text;
  if (previewStatus) previewStatus.textContent = text;
  if (compactStatus) compactStatus.textContent = text;

  document.querySelectorAll('[data-lgmdm-status]').forEach((node) => {
    const el = node as HTMLElement;
    el.textContent = text;
    el.dataset.statusType = String(safeType);
    if (progress != null) el.dataset.progress = String(progress);
    else delete el.dataset.progress;
    if (stage != null) el.dataset.stage = String(stage);
    else delete el.dataset.stage;
  });
}

// ── getContent ────────────────────────────────────────────────
export function getContent(): HTMLElement {
  // Prioritize the container that lives INSIDE the "Analysis" tab.
  return document.getElementById('analysisDynamicContent')
    || document.getElementById('content')
    || document.querySelector<HTMLElement>('.content')
    || document.body;
}

// ── Declarative controls init ──────────────────────────────────
let declarativeBound = false;

function initDeclarativeControls(): void {
  if (declarativeBound) return;
  declarativeBound = true;
  bindOnce(document, 'input', (event) => syncRangeDisplay(event.target as HTMLInputElement), 'ui-declarative-range');
  bindOnce(document, 'change', (event) => {
    const t = event.target as HTMLInputElement;
    syncRangeDisplay(t);
    syncParallelBypass(t);
  }, 'ui-declarative-change');
  document.querySelectorAll('[data-parallel-bypass]').forEach((el) => syncParallelBypass(el as HTMLElement));
}

// ── Toast ─────────────────────────────────────────────────────
let toastContainer: HTMLElement | null = null;

function ensureToastContainer(): HTMLElement {
  if (toastContainer && document.body.contains(toastContainer)) return toastContainer;
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.setAttribute('role', 'region');
    container.setAttribute('aria-live', 'polite');
    container.setAttribute('aria-label', 'Notificaciones');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  toastContainer = container;
  return container;
}

export interface ToastOptions {
  message: string;
  type?: 'error' | 'success' | 'warning' | 'info';
  duration?: number;
}

export function showToast(message: unknown, type: ToastOptions['type'] = 'info', duration = 4000): HTMLDivElement {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = String(message ?? '');
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  const ms = Math.max(0, Number(duration) || 0);
  if (ms > 0) {
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 220);
    }, ms);
  }
  return toast;
}

// ── Error handling ───────────────────────────────────────────
export function handleClientError(error: unknown, fallbackMessage?: string, context?: unknown): void {
  const msg = (error && (error as Error).message) || fallbackMessage || 'Error desconocido';
  showToast(msg, 'error');
  console.debug('[client-error]', msg, context, error);
}

// ── Global Playback Arbiter ───────────────────────────────────
let stoppingPlayback = false;

export function stopAllPlayback(exceptElement?: HTMLElement | null): void {
  if (stoppingPlayback) return;
  stoppingPlayback = true;
  try {
    // 1. Pause HTML5 audio elements
    document.querySelectorAll('audio').forEach((a) => {
      if (a !== exceptElement && !a.paused) {
        try { a.pause(); } catch { /* ignore */ }
      }
    });
    // 2. Stop visualizers Web Audio A/B player (if present).
    const lg = (window as Window & { LGMDM?: { visualizers?: { stopAB?: () => void } } }).LGMDM;
    try { lg?.visualizers?.stopAB?.(); } catch { /* ignore */ }
    // 3. Reset console play button if console preview is not the playing element.
    const previewAudio = document.querySelector<HTMLAudioElement>('#previewAudioWrap audio');
    if (exceptElement !== previewAudio) {
      const consolePb = document.getElementById('consolePlayBtn');
      if (consolePb) {
        consolePb.textContent = '▶';
        consolePb.setAttribute('aria-pressed', 'false');
      }
      const lg2 = (window as Window & { LGMDM?: { console?: { state?: { playing?: boolean } } } }).LGMDM;
      if (lg2?.console?.state) lg2.console.state.playing = false;
    }
    window.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', {
      detail: { except: exceptElement || null },
    }));
  } finally {
    stoppingPlayback = false;
  }
}

// Capture-phase listener so any <audio> play stops competing players.
document.addEventListener('play', (e) => {
  if (e.target && (e.target as HTMLElement).tagName === 'AUDIO') {
    stopAllPlayback(e.target as HTMLAudioElement);
  }
}, true);

// ── Boot ──────────────────────────────────────────────────────
if (document.readyState === 'loading') {
  bindOnce(document, 'DOMContentLoaded', initDeclarativeControls, 'ui-declarative-dom-ready', { once: true });
} else {
  initDeclarativeControls();
}

// ── Bridge to window.LGMDM.ui (legacy compat) ─────────────────
interface LgmdmUi {
  bindOnce?: typeof bindOnce;
  initDeclarativeControls?: () => void;
  escapeHtml?: typeof escapeHtml;
  safeAudioSrc?: typeof safeAudioSrc;
  getContent?: typeof getContent;
  clearResults?: typeof clearResults;
  showStatus?: typeof showStatus;
  showToast?: typeof showToast;
}

function lgmdm(): { ui?: LgmdmUi } {
  // FIX M1: reassign window.LGMDM if missing so the bridge isn't lost.
  const w = window as Window & { LGMDM?: { ui?: LgmdmUi } };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

const g = lgmdm();
g.ui = g.ui || {};
Object.assign(g.ui, {
  bindOnce,
  initDeclarativeControls,
  escapeHtml,
  safeAudioSrc,
  getContent,
  clearResults,
  showStatus,
  showToast,
});

// Also expose window.bindOnce (legacy).
(window as Window & { bindOnce?: typeof bindOnce }).bindOnce = bindOnce;

// Errors namespace.
const lgErr = (window as Window & { LGMDM?: { errors?: Record<string, unknown> } }).LGMDM;
if (lgErr) {
  lgErr.errors = lgErr.errors || {};
  (lgErr.errors as Record<string, unknown>).handleClientError = handleClientError;
}

// Playback namespace.
const lgPlay = (window as Window & { LGMDM?: { playback?: { stopAll?: typeof stopAllPlayback } } }).LGMDM;
if (lgPlay) {
  lgPlay.playback = lgPlay.playback || {};
  lgPlay.playback.stopAll = stopAllPlayback;
}

// Re-export storage helpers for convenience (some consumers expect them here).
export { getJSON, setJSON };
