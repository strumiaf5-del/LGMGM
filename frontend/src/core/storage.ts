// localStorage wrapper — raw strings + JSON helpers. Port of aporte/js/00-storage.js.

/** Read a raw string. Returns `fallback` (default `null`) on miss or error. */
export function get<T = null>(key: unknown, fallback?: T): string | T | null {
  try {
    const value = localStorage.getItem(String(key));
    return value === null ? (fallback ?? null) : value;
  } catch {
    return fallback ?? null;
  }
}

/** Write a raw string. Coerces both key and value to strings. Returns success. */
export function set(key: unknown, value: string): boolean {
  try {
    localStorage.setItem(String(key), String(value));
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. Returns success. */
export function remove(key: unknown): boolean {
  try {
    localStorage.removeItem(String(key));
    return true;
  } catch {
    return false;
  }
}

/** Read and `JSON.parse` a value. Returns `fallback` (default `null`) on miss or parse error. */
export function getJSON<T = unknown>(key: unknown, fallback?: T): T {
  const raw = get(key, null);
  if (raw === null) return (fallback ?? null) as T;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return (fallback ?? null) as T;
  }
}

/** `JSON.stringify` and write a value. Returns success. */
export function setJSON(key: unknown, value: unknown): boolean {
  try {
    return set(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/** Frozen facade bundling all storage helpers. */
export const storage = Object.freeze({ get, set, remove, getJSON, setJSON });

// ── Global LGMDM access (legacy widget compatibility) ─────────────
// Populate `window.LGMDM.storage` so widgets still consuming the old
// IIFE global keep working. Mirrors the pattern in master-console.ts.
interface LgmdmGlobal {
  storage?: typeof storage;
}
const lg = (window as Window & { LGMDM?: LgmdmGlobal }).LGMDM || {};
(window as Window & { LGMDM?: LgmdmGlobal }).LGMDM = lg;
lg.storage = storage;
