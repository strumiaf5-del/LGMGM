// chain-family-tabs.ts — chain family tabstrip. Port of aporte/js/32-chain-family-tabs.js.

import { storage } from '../../core/storage';
import { prefersReducedMotion } from '../../core/utils';

// ── Types ─────────────────────────────────────────────────────

/** A chain family. Matches the order shown in the tab strip. */
export type ChainFamily = 'input' | 'eq' | 'dynamics' | 'stereo' | 'output';

/** Public surface exposed on `window.LGMDM.chainFamilyTabs`. */
export interface ChainFamilyTabs {
  /** Build the tab strip and R2 toggle. Idempotent. */
  build: () => void;
  /** Remove everything `build` created and abort all listeners. */
  teardown: () => void;
  /** Programmatically select a family. No-op if not built. */
  setFamily: (family: ChainFamily) => void;
  /** Return the active family, or `null` if not built. */
  getActive: () => ChainFamily | null;
  /** Toggle the 2-column (R2) view. No-op if not built. */
  setR2: (active: boolean) => void;
  /** Whether R2 (2-column view) is currently active. */
  isR2Active: () => boolean;
}

// ── Config ────────────────────────────────────────────────────

const FAMILY_ORDER: readonly ChainFamily[] = [
  'input',
  'eq',
  'dynamics',
  'stereo',
  'output',
];

const FAMILY_LABELS: Readonly<Record<ChainFamily, string>> = {
  input: 'INPUT',
  eq: 'EQ / TONE',
  dynamics: 'DINÁMICA',
  stereo: 'STEREO / COLOR',
  output: 'OUTPUT',
};

const FAMILY_HINTS: Readonly<Record<ChainFamily, readonly string[]>> = {
  input: ['ruido', 'input gain'],
  eq: [
    'ecualización',
    'filtros de borde',
    'eq correctiva',
    'dynamic eq',
    'balance tonal',
    'eq tonal',
    'modo eq',
    'mid / side',
  ],
  dynamics: [
    'compresión',
    'dinámica —',
    'compresión paralela',
    'de-esser',
    'compresor multibanda',
    'transient shaper',
  ],
  stereo: [
    'saturación armónica',
    'espacio & estéreo',
    'multiband stereo width',
    'low-end mono maker',
    'glue compressor',
  ],
  output: [
    'clipper',
    'normalización y salida',
    'normalización & limiter',
    'salida & oversampling',
  ],
};

const R2_KEY = 'v1:lgmdm-chain-r2';
const CHAIN_FAMILY_KEY = 'v2:lgmdm-chain-family';

// ── Helpers ───────────────────────────────────────────────────

function isChainFamily(value: unknown): value is ChainFamily {
  return typeof value === 'string' && (FAMILY_ORDER as readonly string[]).includes(value);
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function familyForText(text: string): ChainFamily | null {
  for (const f of FAMILY_ORDER) {
    if (FAMILY_HINTS[f].some((h) => text.includes(h))) return f;
  }
  return null;
}

// ── Module state (single owner for build/teardown) ─────────────

let built = false;
let activeController: AbortController | null = null;
let activeFamily: ChainFamily | null = null;
let r2Active = false;
let nav: HTMLDivElement | null = null;
let r2Toggle: HTMLLabelElement | null = null;
let grouped: Map<ChainFamily, HTMLElement[]> | null = null;

function ensureController(): AbortController {
  if (!activeController) activeController = new AbortController();
  return activeController;
}

// ── Family selection (module-scoped so the public API can call it) ─

function showFamily(family: ChainFamily): void {
  if (!built || !grouped || !nav) return;
  for (const [f, nodes] of grouped) {
    const visible = f === family;
    for (const node of nodes) {
      node.hidden = !visible;
      node.classList.toggle('chain-family-visible', visible);
    }
  }
  nav.querySelectorAll<HTMLButtonElement>('.chain-family-tab').forEach((btn) => {
    const active = btn.dataset.family === family;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
  });
  activeFamily = family;
  try {
    storage.set(CHAIN_FAMILY_KEY, family);
  } catch {
    /* localStorage may be unavailable (private mode, disabled cookies). */
  }
  try {
    const u = new URL(window.location.href);
    u.searchParams.set('chain', family);
    window.history.replaceState(null, '', u.pathname + u.search);
  } catch {
    /* history API may be unavailable in sandboxed frames. */
  }
}

// ── Build ─────────────────────────────────────────────────────

export function buildChainFamilyTabs(): void {
  if (built) return;
  const chain = document.getElementById('pasoCadena');
  if (!chain) return;
  if (document.getElementById('chainFamilyTabs')) return;
  const body = chain.querySelector<HTMLElement>('.process-card-body');
  if (!body) return;

  const reducedMotion = prefersReducedMotion();

  // ── Tab strip ───────────────────────────────────────────────
  const navEl = document.createElement('div');
  navEl.id = 'chainFamilyTabs';
  navEl.className = 'chain-family-tabs';
  navEl.setAttribute('role', 'tablist');
  navEl.setAttribute('aria-label', 'Familias de procesamiento');
  FAMILY_ORDER.forEach((family, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chain-family-tab' + (i === 0 ? ' active' : '');
    btn.dataset.family = family;
    btn.textContent = FAMILY_LABELS[family];
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', String(i === 0));
    btn.tabIndex = i === 0 ? 0 : -1;
    // Respect prefers-reduced-motion: drop the CSS color/bg/border transition.
    if (reducedMotion) btn.style.transition = 'none';
    navEl.appendChild(btn);
  });
  // Insert the tab strip as the previous sibling of the chain card.
  const parent = chain.parentNode;
  if (parent) parent.insertBefore(navEl, chain);

  // ── Group body children by family ───────────────────────────
  const groupedMap = new Map<ChainFamily, HTMLElement[]>(
    FAMILY_ORDER.map((f): [ChainFamily, HTMLElement[]] => [f, []]),
  );
  let currentFamily: ChainFamily = 'input';
  for (const child of Array.from(body.children)) {
    if (!(child instanceof HTMLElement)) continue;
    const tag = child.tagName.toLowerCase();
    const txt = textOf(child);
    const byText = familyForText(txt);
    if (byText) currentFamily = byText;
    if (tag === 'h3') {
      const hFamily = familyForText(txt);
      if (hFamily) currentFamily = hFamily;
    }
    child.dataset.chainFamily = currentFamily;
    const list = groupedMap.get(currentFamily);
    if (list) list.push(child);
  }

  // ── Listeners (all owned by the single AbortController) ──────
  const ac = ensureController();

  navEl.addEventListener(
    'click',
    (ev: MouseEvent) => {
      try {
        const target =
          ev.target instanceof Element
            ? ev.target.closest<HTMLButtonElement>('.chain-family-tab')
            : null;
        if (!target) return;
        const f = target.dataset.family;
        if (isChainFamily(f)) showFamily(f);
      } catch {
        /* defensive: a click handler must never throw uncaught. */
      }
    },
    { signal: ac.signal },
  );

  navEl.addEventListener(
    'keydown',
    (ev: KeyboardEvent) => {
      try {
        const target =
          ev.target instanceof Element
            ? ev.target.closest<HTMLButtonElement>('.chain-family-tab')
            : null;
        if (!target) return;
        const tabsArr = Array.from(
          navEl.querySelectorAll<HTMLButtonElement>('.chain-family-tab'),
        );
        const idx = tabsArr.indexOf(target);
        if (idx < 0) return;
        let next: HTMLButtonElement | null = null;
        if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
          next = tabsArr[(idx + 1) % tabsArr.length] ?? null;
        } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
          next = tabsArr[(idx - 1 + tabsArr.length) % tabsArr.length] ?? null;
        } else if (ev.key === 'Home') {
          next = tabsArr[0] ?? null;
        } else if (ev.key === 'End') {
          next = tabsArr[tabsArr.length - 1] ?? null;
        }
        if (next) {
          ev.preventDefault();
          next.focus();
          const f = next.dataset.family;
          if (isChainFamily(f)) showFamily(f);
        }
      } catch {
        /* defensive */
      }
    },
    { signal: ac.signal },
  );

  // ── Initial family (URL → storage → 'input') ────────────────
  let initial: ChainFamily = 'input';
  try {
    const urlChain = new URL(window.location.href).searchParams.get('chain');
    if (isChainFamily(urlChain)) {
      initial = urlChain;
    } else {
      const saved = storage.get(CHAIN_FAMILY_KEY);
      if (isChainFamily(saved)) initial = saved;
    }
  } catch {
    /* URL/storage unavailable — keep 'input'. */
  }
  showFamily(initial);

  // ── R2 toggle (2 columnas) ──────────────────────────────────
  try {
    r2Active = storage.get(R2_KEY) === '1';
  } catch {
    r2Active = false;
  }
  if (r2Active) chain.classList.add('chain-r2');

  const toggle = document.createElement('label');
  toggle.className = 'chain-r2-toggle';
  // Build the checkbox + label text as separate nodes (no innerHTML for the
  // control — keeps the surface free of any HTML-injection path).
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = r2Active;
  checkbox.setAttribute('aria-label', 'Vista 2 columnas (R2)');
  toggle.appendChild(checkbox);
  toggle.appendChild(document.createTextNode(' Vista 2 columnas (R2)'));
  checkbox.addEventListener(
    'change',
    (e: Event) => {
      try {
        if (!(e.target instanceof HTMLInputElement)) return;
        r2Active = e.target.checked;
        chain.classList.toggle('chain-r2', r2Active);
        try {
          storage.set(R2_KEY, r2Active ? '1' : '0');
        } catch {
          /* storage */
        }
      } catch {
        /* defensive */
      }
    },
    { signal: ac.signal },
  );

  // Insert the R2 toggle right after the tab strip.
  const navParent = navEl.parentNode;
  if (navParent) navParent.insertBefore(toggle, navEl.nextSibling);

  // ── Commit module state ────────────────────────────────────
  nav = navEl;
  r2Toggle = toggle;
  grouped = groupedMap;
  built = true;
}

// ── Teardown ──────────────────────────────────────────────────

export function teardownChainFamilyTabs(): void {
  // Abort every listener (click, keydown, change) and the DOMContentLoaded
  // init listener in one shot.
  if (activeController) {
    activeController.abort();
    activeController = null;
  }

  // Restore the chain body: un-hide every grouped node and drop the markers
  // the build stamped on them.
  if (grouped) {
    for (const nodes of grouped.values()) {
      for (const node of nodes) {
        node.hidden = false;
        node.classList.remove('chain-family-visible');
        node.removeAttribute('data-chain-family');
      }
    }
  }

  // Remove the injected DOM (tab strip + R2 toggle).
  nav?.remove();
  r2Toggle?.remove();

  // Drop the R2 layout class — `build` re-applies it from storage on re-init.
  const chain = document.getElementById('pasoCadena');
  chain?.classList.remove('chain-r2');

  nav = null;
  r2Toggle = null;
  grouped = null;
  activeFamily = null;
  r2Active = false;
  built = false;
}

// ── Programmatic API ───────────────────────────────────────────

export function setChainFamily(family: ChainFamily): void {
  if (!built) return;
  showFamily(family);
}

export function getActiveChainFamily(): ChainFamily | null {
  return built ? activeFamily : null;
}

export function setChainR2(active: boolean): void {
  if (!built) return;
  r2Active = active;
  const chain = document.getElementById('pasoCadena');
  chain?.classList.toggle('chain-r2', r2Active);
  if (r2Toggle) {
    const cb = r2Toggle.querySelector('input');
    if (cb instanceof HTMLInputElement) cb.checked = r2Active;
  }
  try {
    storage.set(R2_KEY, r2Active ? '1' : '0');
  } catch {
    /* storage */
  }
}

export function isChainR2Active(): boolean {
  return r2Active;
}

// ── Auto-init (mirrors the aporte's DOMContentLoaded behaviour) ──

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        buildChainFamilyTabs();
      },
      { once: true, signal: ensureController().signal },
    );
  } else {
    buildChainFamilyTabs();
  }
}

// ── Cleanup on page unload ─────────────────────────────────────

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', teardownChainFamilyTabs, {
    once: true,
  });
}

// ── Public API on window.LGMDM.chainFamilyTabs ─────────────────
// Same bridge pattern as core/storage.ts and core/utils.ts: read the existing
// `window.LGMDM` (or create it), attach our slice, write back. The cast only
// narrows the visible type — it does not truncate the other LGMDM slices.

const api: ChainFamilyTabs = {
  build: buildChainFamilyTabs,
  teardown: teardownChainFamilyTabs,
  setFamily: setChainFamily,
  getActive: getActiveChainFamily,
  setR2: setChainR2,
  isR2Active: isChainR2Active,
};

interface LgmdmChainFamilyTabs {
  chainFamilyTabs?: ChainFamilyTabs;
}

const lg =
  (window as Window & { LGMDM?: LgmdmChainFamilyTabs }).LGMDM || {};
(window as Window & { LGMDM?: LgmdmChainFamilyTabs }).LGMDM = lg;
lg.chainFamilyTabs = api;
