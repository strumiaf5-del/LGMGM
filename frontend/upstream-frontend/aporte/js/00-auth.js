// ============================================================
// 00-auth.js — Login, registro y panel de admin
// Bloquea el acceso hasta que haya una sesión válida en sessionStorage.
// ============================================================

(function () {
  'use strict';

  const LG = window.LGMDM = window.LGMDM || {};
  const LGMDM = LG;
  const TOKEN_KEY = 'master_auth_token';
  const USER_KEY  = 'master_auth_user';

  // ── Helpers ───────────────────────────────────────────────────────────────

  function clearRetiredSessionKeys() {
    try {
      LGMDM.storage.remove(TOKEN_KEY);
      LGMDM.storage.remove(USER_KEY);
    } catch (_) {}
  }

  function saveSession(token, user) {
    sessionStorage.setItem(TOKEN_KEY, token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    clearRetiredSessionKeys();
  }

  function clearSession() {
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(USER_KEY);
    clearRetiredSessionKeys();
  }

  function getToken() {
    return sessionStorage.getItem(TOKEN_KEY);
  }

  function getUser()  {
    try { return JSON.parse(sessionStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
  }

  // La autenticación de transporte vive en 00-api.js (apiFetch/authHeaders).
  // ── UI ────────────────────────────────────────────────────────────────────

  function hideAuthOverlay() {
    const overlay = document.getElementById('auth-overlay');
    if (overlay) {
      overlay.classList.add('hidden');
      overlay.style.display = 'none';
    }
  }

  function renderUserBar(user) {
    let bar = document.getElementById('auth-user-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'auth-user-bar';
    } else {
      bar.innerHTML = '';
    }

    const nameSpan = document.createElement('span');
    nameSpan.className = 'auth-user-name';
    nameSpan.textContent = String(user?.name || user?.email || '').trim();
    nameSpan.title = String(user?.email || '').trim();

    const logoutBtn = document.createElement('button');
    logoutBtn.className = 'header-btn auth-logout-btn';
    logoutBtn.id = 'logout-btn';
    logoutBtn.type = 'button';
    logoutBtn.textContent = '⎋';
    logoutBtn.title = 'Cerrar sesión';
    logoutBtn.setAttribute('aria-label', 'Cerrar sesión');

    bar.appendChild(nameSpan);

    if (user?.role === 'admin') {
      const adminBtn = document.createElement('button');
      adminBtn.id = 'admin-panel-btn';
      adminBtn.className = 'header-btn auth-admin-btn';
      adminBtn.type = 'button';
      adminBtn.innerHTML = '<svg class="header-btn-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.8M8 12.7v1.8M1.5 8h1.8M12.7 8h1.8M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M3.4 12.6l1.3-1.3M11.3 4.7l1.3-1.3"/></svg>';
      adminBtn.title = 'Panel de administración de usuarios';
      adminBtn.setAttribute('aria-label', 'Panel de administración');
      adminBtn.addEventListener('click', openAdminPanel);
      bar.appendChild(adminBtn);
    }

    bar.appendChild(logoutBtn);

    // F10.x: forzar placement en .header-right — nunca caer al body.
    const headerRight = document.querySelector('.header-right');
    const headerEl = document.querySelector('header');
    if (headerRight && !headerRight.contains(bar)) {
      headerRight.appendChild(bar);
    } else if (headerEl && !headerEl.contains(bar)) {
      headerEl.appendChild(bar);
    }
    if (!document.body.contains(bar)) {
      document.body.appendChild(bar); // último recurso si no hay header
    }

    const bindOnce = window.LGMDM?.ui?.bindOnce || window.bindOnce || ((el, type, fn, key, opts) => { el?.addEventListener(type, fn, opts); return true; });
    bindOnce(logoutBtn, 'click', () => {
      clearSession();
      window.location.replace('login.html');
    }, 'auth-userbar-logout');
  }

  function renderAdminButton() {
    let btn = document.getElementById('admin-panel-btn');
    if (!btn) {
      const userBar = document.getElementById('auth-user-bar');
      if (userBar) {
        btn = document.createElement('button');
        btn.id = 'admin-panel-btn';
        btn.className = 'header-btn auth-admin-btn';
        btn.type = 'button';
        btn.textContent = '⚙';
        btn.title = 'Panel de administración de usuarios';
        btn.setAttribute('aria-label', 'Panel de administración');
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) userBar.insertBefore(btn, logoutBtn);
        else userBar.appendChild(btn);
      }
    }
    if (btn && !btn.dataset.wired) {
      btn.dataset.wired = 'true';
      btn.addEventListener('click', openAdminPanel);
    }
  }

  async function openAdminPanel() {
    let overlay = document.getElementById('admin-overlay');
    if (overlay) {
      overlay.classList.remove('hidden');
      overlay.style.display = 'flex';
      LGMDM.ui.openModal({
        modalEl: overlay,
        openerEl: document.getElementById('admin-panel-btn') || document.activeElement,
        closeOnBackdrop: true,
        trapFocus: true,
        closeOnEscape: true,
        onClose: () => { overlay.classList.add('hidden'); overlay.style.display = 'none'; },
      });
      loadAdminUsers();
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
    LGMDM.ui.openModal({
      modalEl: overlay,
      openerEl: document.getElementById('admin-panel-btn') || document.activeElement,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { overlay.classList.add('hidden'); overlay.style.display = 'none'; },
    });
    document.getElementById('admin-close-btn')?.addEventListener('click', () => {
      LGMDM.ui.closeModal(overlay);
    });
    loadAdminUsers();
  }

  async function loadAdminUsers() {
    const list = document.getElementById('admin-users-list');
    if (!list) return;
    list.textContent = 'Cargando…';
    try {
      const res = await LGMDM.api.apiFetch(`/auth/admin/users`);
      if (!res.ok) throw new Error(await res.text());
      const users = await res.json();
      if (!users.length) {
        list.innerHTML = '<div class="lgjs-centered-empty">Sin usuarios registrados</div>';
        return;
      }

      list.innerHTML = users.map(u => {
        const id = LG.ui.escapeHtml(String(u.id ?? ''));
        const email = LG.ui.escapeHtml(String(u.email ?? ''));
        const name = LG.ui.escapeHtml(String(u.name ?? ''));
        const status = LG.ui.escapeHtml(String(u.status ?? 'unknown'));
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
      }).join('');

      if (!list.dataset.bound) {
        list.dataset.bound = '1';
        list.addEventListener('click', async e => {
          const btn = e.target.closest('[data-action]');
          if (!btn || !list.contains(btn)) return;
          const { action, id } = btn.dataset;
          btn.disabled = true;
          try {
            let res;
            if (action === 'approve') res = await LGMDM.api.apiFetch(`/auth/admin/approve/${encodeURIComponent(id)}`, { method: 'POST' });
            else if (action === 'reject') res = await LGMDM.api.apiFetch(`/auth/admin/reject/${encodeURIComponent(id)}`, { method: 'POST' });
            else if (action === 'delete') {
              if (!confirm('¿Eliminar este usuario?')) { btn.disabled = false; return; }
              res = await LGMDM.api.apiFetch(`/auth/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' });
            }
            if (!res?.ok) throw new Error(await res?.text());
            await loadAdminUsers();
          } catch (err) {
            alert('Error: ' + err.message);
            btn.disabled = false;
          }
        });
      }
    } catch (err) {
      list.innerHTML = '<div class="auth-msg error"></div>';
      const errorEl = list.firstElementChild;
      if (errorEl) errorEl.textContent = `Error: ${err.message}`;
    }
  }

  function onAuthenticated(user) {
    renderUserBar(user);
    if (user.role === 'admin') renderAdminButton();
    window.dispatchEvent(new CustomEvent('lgmdm:authenticated', { detail: { user } }));
  }

  // ── Init ──────────────────────────────────────────────────────────────────

  function init() {
    let token = getToken();
    let user  = getUser();

    try {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.has('demo') || urlParams.has('offline')) {
        const demoUser = { name: 'Operador Local', email: 'demo@lgmdm.local', role: 'admin' };
        saveSession('demo_token', demoUser);
        token = 'demo_token';
        user = demoUser;
      }
    } catch (_) {}

    // Si no hay sesión válida, redirigir inmediatamente a la página de login
    if (!token || !user) {
      window.location.replace('login.html');
      return;
    }

    if (token === 'demo_token') {
      onAuthenticated(user);
      hideAuthOverlay();
      return;
    }

    // Validar sesión previa con el backend
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 4000);

    LGMDM.api.apiFetch('/auth/me', { signal: controller.signal })
      .then(async res => {
        if (res.ok) {
          onAuthenticated(user);
          hideAuthOverlay();
          return;
        }
        if (res.status === 401 || res.status === 403) {
          clearSession();
          window.location.replace('login.html');
          return;
        }
        // Error de servidor (500/502/503): mantener sesión y avisar modo offline
        onAuthenticated(user);
        hideAuthOverlay();
        if (window.LGMDM?.ui?.showStatus) {
          window.LGMDM.ui.showStatus(null, 'Servidor no disponible momentáneamente (modo offline)', 'warn');
        }
      })
      .catch((err) => {
        // Fallo de conexión o timeout: mantener sesión y permitir operar offline
        console.debug('[auth] backend inaccesible o timeout, manteniendo sesión local:', err?.message || err);
        onAuthenticated(user);
        hideAuthOverlay();
        if (window.LGMDM?.ui?.showStatus) {
          window.LGMDM.ui.showStatus(null, 'Servidor no conectado (modo offline)', 'warn');
        }
      })
      .finally(() => window.clearTimeout(timeoutId));
  }

  LG.auth = Object.assign(LG.auth || {}, {
    getToken,
    getUser,
    saveSession,
    clearSession,
    onAuthenticated,
    openAdminPanel,
  });

  // Esperar a que el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
