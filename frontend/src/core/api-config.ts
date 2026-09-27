// API base URL detection with validation.
// Reads `lgmdm_api_origin` from localStorage (must match a strict URL regex),
// falls back to localhost:8000 in dev, or the production origin otherwise.

const API_ORIGIN_KEY = 'lgmdm_api_origin';
const ALLOWED_REMOTE_ORIGINS = new Set<string>([
  'https://masteringstudio-api.duckdns.org',
  'https://masteringstudio-api2.duckdns.org',
  'http://127.0.0.1:8000',
  'http://127.0.0.1:8001',
  'http://localhost:8000',
  'http://localhost:8001',
]);

const URL_REGEX = /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i;

function detectApiBase(): string {
  // 1. Manual override (validated against regex + allowlist)
  try {
    const stored = localStorage.getItem(API_ORIGIN_KEY);
    if (stored && URL_REGEX.test(stored) && ALLOWED_REMOTE_ORIGINS.has(stored)) {
      return stored.replace(/\/$/, '');
    }
    // Drop invalid/malicious stored values silently.
    if (stored) localStorage.removeItem(API_ORIGIN_KEY);
  } catch {
    // localStorage unavailable (private mode) — fall through.
  }

  // 2. Dev: same host on port 8000
  if (typeof location !== 'undefined' && (location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    return `${location.protocol}//${location.hostname}:8000`;
  }

  // 3. Production: same-origin API under /api (Caddy handle_path /api/* → backend).
  // Igual que el FE vanilla de prod (00-api.js): apiBase() retorna `${location.origin}/api`.
  // Antes retornaba '' (vacío) → llamadas como `/auth/login` caían en el file_server
  // de Caddy y daban 404. Con `${location.origin}/api` → callers que hacen
  // `${api.apiBase()}/path` Y los que hacen `apiFetch('/path')` funcionan ambos
  // (buildUrl no duplica /api porque apiBase() ya retorna el origin completo).
  if (typeof location !== 'undefined') {
    return `${location.origin}/api`;
  }
  return '/api';
}

export const API_BASE = detectApiBase();

export function buildUrl(endpoint: string): string {
  // Accept both `/auth/login` and `auth/login`.
  const path = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${API_BASE}${path}`;
}

export function setApiOrigin(origin: string): boolean {
  if (!URL_REGEX.test(origin) || !ALLOWED_REMOTE_ORIGINS.has(origin)) return false;
  try {
    localStorage.setItem(API_ORIGIN_KEY, origin);
    return true;
  } catch {
    return false;
  }
}

export function clearApiOrigin(): void {
  try { localStorage.removeItem(API_ORIGIN_KEY); } catch { /* ignore */ }
}
