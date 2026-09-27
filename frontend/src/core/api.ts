// api.ts — API client with retry/backoff/CSRF/ws/download

import { buildUrl, API_BASE } from './api-config';

const TOKEN_KEY = 'master_auth_token';
const USER_KEY = 'master_auth_user';
const CSRF_META_SELECTOR = 'meta[name="lgmdm-csrf-token"]';
const CSRF_SESSION_KEY = 'lgmdm.csrf-token';
const DEFAULT_TIMEOUT_MS = 30_000;
// FIX M14: FormData uploads used to disable the timeout entirely (0), which
// let an unresponsive server hang the request forever. 5 minutes is long
// enough for large audio files on a slow link, while still bounding the wait.
const DEFAULT_UPLOAD_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 2;
const RETRYABLE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT']);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// ── Error type ─────────────────────────────────────────────────
export interface ApiError extends Error {
  status: number;
  detail: string;
  code?: string;
}

function makeError(status: number, detail: string, code?: string): ApiError {
  const err = new Error(detail) as ApiError;
  err.status = status;
  err.detail = detail;
  err.code = code;
  err.name = status >= 500 ? 'ApiServerError' : 'ApiClientError';
  return err;
}

// ── Token & headers ────────────────────────────────────────────
function getAuthToken(): string | null {
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function getCsrfToken(): string {
  const meta = document.querySelector<HTMLMetaElement>(CSRF_META_SELECTOR);
  const metaValue = meta?.content?.trim();
  if (metaValue) return metaValue;
  try { return sessionStorage.getItem(CSRF_SESSION_KEY) || ''; } catch { return ''; }
}

function withAuthHeaders(headers: HeadersInit | undefined, method = 'GET'): Record<string, string> {
  const base: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((headers as Record<string, string>) || {}),
  };
  const token = getAuthToken();
  if (token) base['Authorization'] = `Bearer ${token}`;
  const normalizedMethod = String(method || 'GET').toUpperCase();
  if (!SAFE_METHODS.has(normalizedMethod)) {
    const csrf = getCsrfToken();
    if (csrf && !base['X-CSRF-Token'] && !base['x-csrf-token']) {
      base['X-CSRF-Token'] = csrf;
    }
  }
  return base;
}

// ── URL helpers ────────────────────────────────────────────────
export function apiUrl(path: string = ''): string {
  if (!path) return API_BASE;
  return buildUrl(path);
}

export function wsUrl(path: string = ''): string {
  if (!API_BASE) {
    // Relative API_BASE (production reverse proxy) → use location host.
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    return `${proto}://${location.host}${path.startsWith('/') ? path : `/${path}`}`;
  }
  const url = new URL(API_BASE);
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('La URL de la API debe usar http:// o https://');
  }
  const proto = url.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${url.host}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function wsAuthUrl(path: string = ''): Promise<string> {
  if (!getAuthToken()) {
    const err = makeError(401, 'Sesión requerida para autorizar WebSocket', 'AUTH_REQUIRED');
    throw err;
  }
  const target = new URL(wsUrl(path));
  // FIX K2: el backend declara @router.get("/auth/ws-ticket") (auth.py:121).
  // Antes se llamaba con POST → 405, lo que rompía la auth de TODOS los WS
  // que usan token (wsAuthUrl es el previo de /ws/mix-stream etc.).
  const res = await apiFetchRaw<Response>('/auth/ws-ticket', { method: 'GET' });
  if (!res.ok) throw makeError(res.status, `No se pudo autorizar WebSocket (HTTP ${res.status})`);
  const data = await res.json() as { token?: string };
  if (!data.token || typeof data.token !== 'string') {
    throw makeError(0, 'El servidor no devolvió un ticket WebSocket válido');
  }
  target.searchParams.set('token', data.token);
  return target.toString();
}

function resolveApiTarget(path: string): string {
  const raw = String(path ?? '');
  if (/^https?:\/\//i.test(raw)) {
    // Absolute URL — validate origin matches API_BASE (or location origin if relative).
    const url = new URL(raw);
    const baseOrigin = API_BASE ? new URL(API_BASE).origin : location.origin;
    if (url.origin !== baseOrigin) {
      throw makeError(0, 'Destino API fuera del origen permitido', 'CORS_VIOLATION');
    }
    return url.toString();
  }
  return buildUrl(raw);
}

// ── Retry / backoff ─────────────────────────────────────────────
function retryAfterMs(response: Response, fallbackMs: number): number {
  const raw = response.headers.get('retry-after');
  if (!raw) return fallbackMs;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30_000);
  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, Math.min(date - Date.now(), 30_000));
  return fallbackMs;
}

function isFormDataBody(body: unknown): boolean {
  return typeof FormData !== 'undefined' && body instanceof FormData;
}

// ── Core request (with retry, timeout, error extraction) ───────
interface RequestOptions extends RequestInit {
  responseType?: 'json' | 'blob' | 'text' | 'response';
  timeoutMs?: number;
  maxRetries?: number;
  retryNonIdempotent?: boolean;
}

async function request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
  const {
    responseType = 'json',
    timeoutMs,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryNonIdempotent = false,
    ...init
  } = options;

  const method = String(init.method || 'GET').toUpperCase();
  const externalSignal = init.signal ?? null;
  const isFormData = isFormDataBody(init.body);
  const effectiveTimeout = timeoutMs ?? (isFormData ? DEFAULT_UPLOAD_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const retryableMethod = RETRYABLE_METHODS.has(method) || retryNonIdempotent;
  const maxAttempts = retryableMethod ? maxRetries : 0;

  let lastError: ApiError | null = null;

  for (let attempt = 0; attempt <= maxAttempts; attempt += 1) {
    const controller = effectiveTimeout > 0 ? new AbortController() : null;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let externalAbortHandler: (() => void) | null = null;

    try {
      const requestOptions: RequestInit = { ...init };
      if (!controller && externalSignal) requestOptions.signal = externalSignal;
      if (controller) {
        timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
        if (externalSignal) {
          if (externalSignal.aborted) controller.abort(externalSignal.reason);
          else {
            externalAbortHandler = () => controller.abort((externalSignal as AbortSignal).reason);
            externalSignal.addEventListener('abort', externalAbortHandler, { once: true });
          }
        }
        requestOptions.signal = controller.signal;
      }
      requestOptions.headers = withAuthHeaders(init.headers, method);
      // FIX K4 (prereq): withAuthHeaders fuerza Content-Type: application/json.
      // Si el body es FormData, ese header override al multipart automático
      // del browser → FastAPI recibe "application/json" con body multipart y
      // no puede parsear los Form()/File(). Lo borramos para que el browser
      // setee multipart/form-data;boundary=... (verificado con node+http).
      if (isFormDataBody(init.body)) {
        delete (requestOptions.headers as Record<string, string>)['Content-Type'];
      }

      const res = await fetch(resolveApiTarget(endpoint), {
        ...requestOptions,
        credentials: 'include',
      });

      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= maxAttempts || !retryableMethod) {
        return await parseResponse<T>(res, responseType);
      }
      const delayMs = retryAfterMs(res, 500 * (2 ** attempt));
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        if (externalSignal?.aborted) throw err;
        if (attempt >= maxAttempts) {
          throw makeError(0, 'La solicitud tardó demasiado. Verificá tu conexión e intentá nuevamente.', 'TIMEOUT');
        }
        // Fall through to retry backoff below.
      } else if (err instanceof TypeError) {
        // Network error (server down, CORS, DNS).
        if (attempt >= maxAttempts) {
          throw makeError(0, 'No se pudo conectar con el servidor. Verificá tu conexión.', 'NETWORK');
        }
      } else if (err instanceof Error && (err as ApiError).status !== undefined) {
        // Already an ApiError thrown by parseResponse — don't retry, rethrow.
        throw err;
      } else {
        lastError = err as ApiError;
        if (attempt >= maxAttempts) throw err;
      }
      const delayMs = 500 * (2 ** attempt);
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
    } finally {
      if (timeoutId !== null) clearTimeout(timeoutId);
      if (externalSignal && externalAbortHandler) {
        externalSignal.removeEventListener('abort', externalAbortHandler);
      }
    }
  }

  throw lastError || makeError(0, 'La solicitud HTTP agotó los reintentos permitidos.');
}

async function parseResponse<T>(res: Response, responseType: string): Promise<T> {
  if (!res.ok) {
    let body: unknown = null;
    try { body = await res.json(); } catch { /* non-JSON error */ }
    const fallback = res.status >= 500
      ? `Error del servidor (HTTP ${res.status}). Reintentá en unos segundos.`
      : `Error de autenticación (HTTP ${res.status}).`;
    throw makeError(res.status, extractDetail(body, fallback));
  }
  if (responseType === 'blob') return await res.blob() as T;
  if (responseType === 'text') return await res.text() as T;
  if (responseType === 'response') return res as unknown as T;
  return await res.json() as T;
}

function extractDetail(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  // FastAPI Pydantic 422 returns `[{ loc: [...], msg, type }, ...]`
  if (Array.isArray(detail)) {
    const msgs = detail
      .map((d) => (d && typeof d === 'object' && typeof (d as { msg?: string }).msg === 'string') ? (d as { msg: string }).msg : null)
      .filter((m): m is string => Boolean(m));
    return msgs.length ? msgs.join(', ') : fallback;
  }
  return fallback;
}

// ── Public API ─────────────────────────────────────────────────
export async function apiFetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(endpoint, options);
}

export async function apiFetchBlob(endpoint: string, options?: RequestInit): Promise<Blob> {
  return request<Blob>(endpoint, { ...options, responseType: 'blob' });
}

export async function apiFetchText(endpoint: string, options?: RequestInit): Promise<string> {
  return request<string>(endpoint, { ...options, responseType: 'text' });
}

async function apiFetchRaw<T = Response>(endpoint: string, options?: RequestInit): Promise<T> {
  return request<T>(endpoint, { ...options, responseType: 'response' });
}

// ── Download with auth ─────────────────────────────────────────
function filenameFromResponse(res: Response, fallback = 'lgmdm-download'): string {
  const cd = res.headers.get('content-disposition') || '';
  const utf = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf) {
    try { return decodeURIComponent(utf[1].trim().replace(/^"|"$/g, '')); } catch { /* ignore */ }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1].trim() : fallback;
}

export interface DownloadResult {
  response: Response;
  blob: Blob;
  filename: string;
}

export async function downloadAuthenticated(
  endpoint: string,
  options: { filename?: string; notify?: boolean } & RequestInit = {},
): Promise<DownloadResult> {
  const { filename = 'lgmdm-download', notify = true, ...fetchOptions } = options;
  const res = await apiFetchRaw<Response>(endpoint, fetchOptions);
  if (res.status === 401 || res.status === 403) {
    window.dispatchEvent(new CustomEvent('lgmdm:auth-required', {
      detail: { status: res.status, path: String(endpoint) },
    }));
    let detail = 'Sesión expirada. Iniciá sesión nuevamente para descargar.';
    try { const data = await res.clone().json() as { detail?: string }; detail = data.detail || detail; } catch { /* ignore */ }
    throw makeError(res.status, detail);
  }
  if (!res.ok) {
    let detail = `Error de descarga (HTTP ${res.status})`;
    try { const data = await res.clone().json() as { detail?: string }; detail = data.detail || detail; } catch { /* ignore */ }
    throw makeError(res.status, detail);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filenameFromResponse(res, filename);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  if (notify) console.debug(`[api] descarga completa: ${a.download}`);
  return { response: res, blob, filename: a.download };
}

// ── HTTP client with typed methods ─────────────────────────────
interface ApiClient {
  get: (endpoint: string, options?: RequestInit) => Promise<Response>;
  post: (endpoint: string, options?: RequestInit) => Promise<Response>;
  put: (endpoint: string, options?: RequestInit) => Promise<Response>;
  patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
  delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
}

function makeClientMethod(method: string) {
  return (endpoint: string, options?: RequestInit) =>
    apiFetchRaw<Response>(endpoint, { ...options, method });
}

export const client: ApiClient = Object.freeze({
  get: makeClientMethod('GET'),
  post: makeClientMethod('POST'),
  put: makeClientMethod('PUT'),
  patch: makeClientMethod('PATCH'),
  delete: makeClientMethod('DELETE'),
});

// ── Bridge to window.LGMDM (legacy compat) ─────────────────────
interface LgmdmApi {
  apiBase?: () => string;
  apiUrl?: (path?: string) => string;
  wsUrl?: (path?: string) => string;
  wsAuthUrl?: (path?: string) => Promise<string>;
  authToken?: () => string;
  csrfToken?: () => string;
  authHeaders?: (extra?: HeadersInit, method?: string) => Record<string, string>;
  apiFetch?: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  downloadAuthenticated?: (endpoint: string, options?: { filename?: string } & RequestInit) => Promise<DownloadResult>;
  resolveApiTarget?: (path: string) => string;
  client?: ApiClient;
}

function lgmdm(): { api?: LgmdmApi } {
  // FIX M1: reassign window.LGMDM if missing so the bridge isn't lost when this
  // is the first LGMDM-touching module to load (e.g. on the login page).
  const w = window as Window & { LGMDM?: { api?: LgmdmApi } };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}

const g = lgmdm();
g.api = g.api || {};
g.api.apiBase = () => API_BASE;
g.api.apiUrl = apiUrl;
g.api.wsUrl = wsUrl;
g.api.wsAuthUrl = wsAuthUrl;
g.api.authToken = () => getAuthToken() || '';
g.api.csrfToken = getCsrfToken;
g.api.authHeaders = withAuthHeaders;
g.api.apiFetch = apiFetch;
g.api.downloadAuthenticated = downloadAuthenticated;
g.api.resolveApiTarget = resolveApiTarget;
g.api.client = client;

export { TOKEN_KEY, USER_KEY };
export type { ApiClient };
