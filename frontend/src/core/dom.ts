// DOM utilities — CSS vars, touch detection, resize observers, element lookup.

export function readVarPx(variable: string): number {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(variable)
    .trim();

  if (value.endsWith('px')) {
    return parseFloat(value);
  }

  // Handle em, rem, percentages
  if (value.endsWith('em')) {
    const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize * parseFloat(value);
  }

  if (value.endsWith('rem')) {
    const rootFontSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return rootFontSize * parseFloat(value);
  }

  if (value.endsWith('%')) {
    // For percentage values, we need a reference element
    return 0;
  }

  // Fallback for non-pixel values
  return 0;
}

export function setVar(name: string, value: string): void {
  document.documentElement.style.setProperty(name, value);
}

export function getVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function isTouchDevice(): boolean {
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

export function addResizeObserver(target: Element, callback: ResizeObserverCallback): ResizeObserver {
  const observer = new ResizeObserver(callback);
  observer.observe(target);
  return observer;
}

export function removeResizeObserver(observer: ResizeObserver, target: Element): void {
  observer.unobserve(target);
}

// ── Element lookup helpers (ported from aporte/js/00-api.js) ────
const domCache = new Map<string, HTMLElement>();

/** Cached element lookup. Returns null if missing. Results are cached by id
 *  so repeat lookups are O(1). Use `invalidateCachedEl` if the element may
 *  have been replaced. */
export function cachedEl<T extends HTMLElement = HTMLElement>(id: string): T | null {
  const cached = domCache.get(id);
  if (cached && document.body.contains(cached)) return cached as T;
  const el = document.getElementById(id) as T | null;
  if (el) domCache.set(id, el);
  else domCache.delete(id);
  return el;
}

/** Invalidate one or more cached elements (e.g. after swapping a container). */
export function invalidateCachedEl(...ids: string[]): void {
  ids.forEach((id) => domCache.delete(id));
}

const _byIdMissingLogged = new Set<string>();

/** Lookup by id with a one-time debug log if missing. */
export function byId<T extends HTMLElement = HTMLElement>(id: string): T | null {
  const node = document.getElementById(id) as T | null;
  if (!node && !_byIdMissingLogged.has(id)) {
    _byIdMissingLogged.add(id);
    console.debug(`[dom] #${id} not found`);
  }
  return node;
}

/** Lookup by id, throwing if missing. Use for elements that are required by a
 *  module's contract — fail loudly so missing DOM is caught early. */
export function requireById<T extends HTMLElement = HTMLElement>(id: string, owner = ''): T {
  const node = document.getElementById(id) as T | null;
  if (!node) {
    const err = new Error(`[DOM CONTRACT] ${owner || 'unknown'}: #${id} is required but missing`);
    console.error(err);
    throw err;
  }
  return node;
}

// Bridge to window.LGMDM.dom (legacy compat).
interface LgmdmDom {
  cachedEl?: <T extends HTMLElement = HTMLElement>(id: string) => T | null;
  invalidateCachedEl?: (...ids: string[]) => void;
  byId?: <T extends HTMLElement = HTMLElement>(id: string) => T | null;
  requireById?: <T extends HTMLElement = HTMLElement>(id: string, owner?: string) => T;
}

function lgmdm(): { dom?: LgmdmDom } {
  // FIX M1: reassign window.LGMDM if missing so the bridge isn't lost.
  const w = window as Window & { LGMDM?: { dom?: LgmdmDom } };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

const g = lgmdm();
g.dom = g.dom || {};
g.dom.cachedEl = cachedEl;
g.dom.invalidateCachedEl = invalidateCachedEl;
g.dom.byId = byId;
g.dom.requireById = requireById;
