// admin-panel.ts — admin user panel. Port of aporte/js/00-auth.js.

import { apiFetch, type ApiError } from '../../core/api';
import { openModal, closeModal } from '../../core/modal-helper';
import { escapeHtml, showToast } from '../../core/ui';
import type { AuthUser } from './session';
import type { AdminListUser } from '../../types/auth';

// FIX M9: AdminUser ahora es alias de AdminListUser de types/auth.ts
// (alineado con el backend /auth/admin/users). Antes tenía `role?: string`
// y `status?: '...|string'` que desactivaban el narrowing de TS.
type AdminUser = AdminListUser;

let adminListBound = false;
let overlay: HTMLElement | null = null;

/** Open the admin panel. Creates the overlay lazily if missing. */
export async function openAdminPanel(): Promise<void> {
  const opener = document.getElementById('admin-panel-btn') || document.activeElement as HTMLElement;

  overlay = document.getElementById('admin-overlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.style.display = 'flex';
    openModal({
      modalEl: overlay,
      openerEl: opener,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { overlay?.classList.add('hidden'); if (overlay) overlay.style.display = 'none'; },
    });
    void loadAdminUsers();
    return;
  }

  overlay = document.createElement('div');
  overlay.id = 'admin-overlay';
  overlay.style.display = 'flex';
  overlay.innerHTML = `
    <div class="admin-box">
      <div class="admin-title">
        <span>⚙ Panel de administración</span>
        <button class="admin-close" id="admin-close-btn" type="button" aria-label="Cerrar panel">✕</button>
      </div>
      <div id="admin-users-list" aria-busy="true">
        <div class="skeleton-loader" aria-label="Cargando usuarios">
          <div class="skeleton-line skeleton-line--lg"></div>
          <div class="skeleton-line skeleton-line--md"></div>
          <div class="skeleton-line skeleton-line--sm"></div>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  openModal({
    modalEl: overlay,
    openerEl: opener,
    closeOnBackdrop: true,
    trapFocus: true,
    closeOnEscape: true,
    onClose: () => { overlay?.classList.add('hidden'); if (overlay) overlay.style.display = 'none'; },
  });
  const closeBtn = document.getElementById('admin-close-btn');
  if (closeBtn) closeBtn.addEventListener('click', () => overlay && closeModal(overlay));
  void loadAdminUsers();
}

async function loadAdminUsers(): Promise<void> {
  const list = document.getElementById('admin-users-list');
  if (!list) return;
  list.textContent = 'Cargando…';
  try {
    const users = await apiFetch<AdminUser[]>('/auth/admin/users');
    if (!users.length) {
      list.innerHTML = '<div class="lgjs-centered-empty">Sin usuarios registrados</div>';
      return;
    }
    list.innerHTML = users.map(renderUserRow).join('');
    bindListActions(list as HTMLElement);
  } catch (err) {
    const detail = (err as ApiError)?.detail || (err as Error)?.message || 'Error desconocido';
    list.innerHTML = `<div class="auth-msg error"></div>`;
    const errorEl = list.firstElementChild as HTMLElement | null;
    if (errorEl) errorEl.textContent = `Error: ${detail}`;
  }
}

function renderUserRow(u: AdminUser): string {
  const id = escapeHtml(String(u.id ?? ''));
  const email = escapeHtml(String(u.email ?? ''));
  const name = escapeHtml(String(u.name ?? ''));
  const status = escapeHtml(String(u.status ?? 'unknown'));
  const role = String(u.role ?? '');
  const statusClass = ['pending', 'approved', 'rejected'].includes(String(u.status)) ? String(u.status) : 'pending';
  return `
    <div class="user-row" data-id="${id}">
      <div class="user-info">
        <div class="user-email">${email}</div>
        <div class="user-name">${name}</div>
      </div>
      <span class="badge badge-${statusClass}">${status}</span>
      ${role === 'admin' ? '<span class="badge badge-admin">admin</span>' : ''}
      <div class="admin-actions">
        ${u.status !== 'approved' ? `<button type="button" class="admin-btn btn-approve" data-action="approve" data-id="${id}">✓ Aprobar</button>` : ''}
        ${u.status !== 'rejected' && role !== 'admin' ? `<button type="button" class="admin-btn btn-reject" data-action="reject" data-id="${id}">✗ Rechazar</button>` : ''}
        ${role !== 'admin' ? `<button type="button" class="admin-btn btn-delete" data-action="delete" data-id="${id}">🗑</button>` : ''}
      </div>
    </div>`;
}

function bindListActions(list: HTMLElement): void {
  if (adminListBound) return;
  adminListBound = true;
  list.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLButtonElement | null;
    if (!btn || !list.contains(btn)) return;
    const action = btn.dataset.action;
    const id = btn.dataset.id;
    if (!action || !id) return;
    btn.disabled = true;
    try {
      let res: unknown;
      if (action === 'approve') {
        res = await apiFetch(`/auth/admin/approve/${encodeURIComponent(id)}`, { method: 'POST' });
      } else if (action === 'reject') {
        res = await apiFetch(`/auth/admin/reject/${encodeURIComponent(id)}`, { method: 'POST' });
      } else if (action === 'delete') {
        if (!confirm('¿Eliminar este usuario?')) { btn.disabled = false; return; }
        res = await apiFetch(`/auth/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
      } else {
        btn.disabled = false;
        return;
      }
      await loadAdminUsers();
    } catch (err) {
      const detail = (err as ApiError)?.detail || (err as Error)?.message || 'Error desconocido';
      showToast(`Error: ${detail}`, 'error');
      btn.disabled = false;
    }
  });
}

/** Render the user bar (name + admin button + logout). Called after auth. */
export function renderUserBar(user: AuthUser): void {
  let bar = document.getElementById('auth-user-bar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'auth-user-bar';
  } else {
    bar.innerHTML = '';
  }

  const nameSpan = document.createElement('span');
  nameSpan.className = 'auth-user-name';
  nameSpan.textContent = String(user.name || user.email || '').trim();
  nameSpan.title = String(user.email || '').trim();

  const logoutBtn = document.createElement('button');
  logoutBtn.className = 'header-btn auth-logout-btn';
  logoutBtn.id = 'logout-btn';
  logoutBtn.type = 'button';
  logoutBtn.textContent = '⎋';
  logoutBtn.title = 'Cerrar sesión';
  logoutBtn.setAttribute('aria-label', 'Cerrar sesión');

  bar.appendChild(nameSpan);

  if (user.role === 'admin') {
    const adminBtn = document.createElement('button');
    adminBtn.id = 'admin-panel-btn';
    adminBtn.className = 'header-btn auth-admin-btn';
    adminBtn.type = 'button';
    adminBtn.innerHTML = '<svg class="header-btn-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/></svg>';
    adminBtn.title = 'Panel de administración de usuarios';
    adminBtn.setAttribute('aria-label', 'Panel de administración');
    adminBtn.addEventListener('click', () => { void openAdminPanel(); });
    bar.appendChild(adminBtn);
  }

  bar.appendChild(logoutBtn);

  // Force placement in .header-right — never fall to body.
  const headerRight = document.querySelector<HTMLElement>('.header-right');
  const headerEl = document.querySelector<HTMLElement>('header');
  if (headerRight && !headerRight.contains(bar)) headerRight.appendChild(bar);
  else if (headerEl && !headerEl.contains(bar)) headerEl.appendChild(bar);
  else if (!document.body.contains(bar)) document.body.appendChild(bar);

  logoutBtn.addEventListener('click', () => {
    // Clearing handled by session module; just redirect.
    window.location.replace('login.html');
  });
}

/** Hide the auth overlay (if present). */
export function hideAuthOverlay(): void {
  const overlayEl = document.getElementById('auth-overlay');
  if (overlayEl) {
    overlayEl.classList.add('hidden');
    overlayEl.style.display = 'none';
  }
}

/** Dispatch `lgmdm:authenticated` event after rendering the user bar. */
export function onAuthenticated(user: AuthUser): void {
  renderUserBar(user);
  window.dispatchEvent(new CustomEvent('lgmdm:authenticated', { detail: { user } }));
}
