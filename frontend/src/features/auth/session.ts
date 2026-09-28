// session.ts — JWT session management

import { apiFetch, TOKEN_KEY, USER_KEY } from '../../core/api';
import type { User } from '../../types/auth';

// FIX M9: AuthUser ahora es alias de `User` de types/auth.ts (alineado con
// el backend). Antes tenía `role: 'admin' | 'user' | 'pending'` — pero
// 'pending' es un `status`, no un `role` (backend/auth.py: el rol siempre
// es 'admin'|'user', status es 'pending'|'approved'|'rejected').
export type AuthUser = User;

export interface Session {
  token: string;
  user: AuthUser;
}

let cached: Session | null = null;

function readUser(): AuthUser | null {
  try {
    const raw = sessionStorage.getItem(USER_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthUser;
    if (!parsed || typeof parsed !== 'object' || !parsed.id || !parsed.email) return null;
    return parsed;
  } catch {
    try { sessionStorage.removeItem(USER_KEY); } catch { /* ignore */ }
    return null;
  }
}

export function saveSession(token: string, user: AuthUser): void {
  try {
    // TODO CRIT-X2: migrar a cookie httpOnly + SameSite=Strict requiere
    // cooperación con el backend (auth.py emite el token en el body del
    // /auth/login y el cliente lo reenvía en `Authorization: Bearer`).
    // Hasta entonces, el JWT queda expuesto a cualquier XSS. La red de
    // seguridad del frontend es `clearSessionOnXss()` (ver más abajo).
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    cached = { token, user };
  } catch (err) {
    console.error('[session] saveSession failed:', err);
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
  } catch { /* ignore */ }
  cached = null;
}

/**
 * Defense-in-depth (CRIT-X2): purga el JWT si un escape gap de innerHTML
 * lo deja visible en el DOM. Escanea `document.head.innerHTML` y
 * `document.body.innerHTML` por el valor exacto del token; si aparece,
 * limpia la sesión y dispara `lgmdm:auth-required` para que la UI redirija
 * al login.
 *
 * LIMITACIONES (no es reemplazo del fix real):
 *  - Solo detecta tokens que estén en el DOM al momento del escaneo. Si el
 *    atacante ya exfiltró vía fetch/XHR, el daño está hecho.
 *  - El costo del escaneo es O(|DOM|); se throttle a 5s para no entorpecer
 *    la app durante renders pesados.
 *  - El fix definitivo es httpOnly + SameSite=Strict, emitido por el
 *    backend (ver TODO en `saveSession`).
 */
export function clearSessionOnXss(): void {
  if (typeof document === 'undefined') return;
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return;
    const head = document.head?.innerHTML || '';
    const body = document.body?.innerHTML || '';
    if (head.includes(token) || body.includes(token)) {
      console.warn('[session] XSS escape gap detectado — purgando token');
      clearSession();
      window.dispatchEvent(new CustomEvent('lgmdm:auth-required', {
        detail: { status: 401, reason: 'xss-detected' },
      }));
    }
  } catch (err) {
    console.debug('[session] clearSessionOnXss failed:', err);
  }
}

let xssWatchdogId: ReturnType<typeof setInterval> | null = null;
function installXssWatchdog(): void {
  if (xssWatchdogId !== null) return;
  if (typeof document === 'undefined') return;
  if (typeof setInterval !== 'function') return;
  // 5s es suficiente: si un escape gap se cuela al DOM, lo cazamos antes
  // del siguiente polling de actividad.
  xssWatchdogId = setInterval(() => clearSessionOnXss(), 5000);
}
installXssWatchdog();

export function getSession(): Session | null {
  if (cached) return cached;
  try {
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return null;
    const user = readUser();
    if (!user) {
      clearSession();
      return null;
    }
    cached = { token, user };
    return cached;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  return getSession()?.token ?? null;
}

/**
 * Validate the current session against `/auth/me`.
 * Returns `true` only if the server confirms the token is valid.
 * On 401/403 it clears the session. On network failure it returns `false`
 * WITHOUT clearing (the user may retry when the server comes back).
 */
export async function validateSession(): Promise<boolean> {
  const session = getSession();
  if (!session) return false;
  try {
    const me = await apiFetch<AuthUser>('/auth/me');
    // Refresh user info in case role changed server-side.
    saveSession(session.token, me);
    return true;
  } catch (err) {
    const status = (err as { status?: number }).status;
    if (status === 401 || status === 403) {
      clearSession();
      return false;
    }
    // 5xx, 0 (network), abort: keep session; user can retry.
    return false;
  }
}

/**
 * Login with email + password. On success, persists session and returns the user.
 * Throws `ApiError` with `.status` and `.detail` on failure.
 */
export async function login(email: string, password: string): Promise<AuthUser> {
  const data = await apiFetch<{ access_token: string; user: AuthUser }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  if (!data?.access_token || !data?.user) {
    throw new Error('Respuesta de login inesperada del servidor.');
  }
  saveSession(data.access_token, data.user);
  return data.user;
}

/**
 * Register a new account. The account is created in `pending` state and
 * requires admin approval before login. Returns void on success.
 */
export async function register(name: string, email: string, password: string): Promise<void> {
  if (password.length < 8) {
    throw new Error('La contraseña debe tener al menos 8 caracteres.');
  }
  await apiFetch<{ message?: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password, name }),
  });
}

export async function logout(): Promise<void> {
  // Best-effort server logout (cookies + server-side session) — ignore errors.
  try {
    await apiFetch('/auth/logout', { method: 'POST' });
  } catch { /* ignore — local clear still happens */ }
  clearSession();
}
