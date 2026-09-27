// session.ts — JWT session management. Port of aporte/js/00-auth.js.

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
