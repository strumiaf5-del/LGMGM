// login.ts — login page controller

import { login, register, validateSession, clearSession } from './session';

const REDIRECT_TARGET = 'index.html';
const SUBMIT_BUSY_TEXT = 'Ingresando…';
const SUBMIT_DONE_TEXT = '✓ Redirigiendo a la consola…';
const SUBMIT_DEFAULT_LOGIN = 'Ingresar a la consola';
const SUBMIT_DEFAULT_REGISTER = 'Crear cuenta';

type MsgEl = HTMLDivElement | null;

function showMsg(el: MsgEl, text: string, type: 'error' | 'success' | 'warning' | 'info'): void {
  if (!el) return;
  el.textContent = text;
  el.className = `auth-msg ${type}`;
  el.classList.remove('hidden');
}

function hideMsg(el: MsgEl): void {
  if (!el) return;
  el.classList.add('hidden');
  el.textContent = '';
}

function setInvalid(input: HTMLInputElement, invalid: boolean): void {
  if (invalid) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

function redirect(): void {
  window.location.replace(REDIRECT_TARGET);
}

async function handleExistingSession(): Promise<void> {
  // If a valid session exists, redirect to the console. If the server is
  // unreachable, stay on the login page (do NOT bypass auth).
  const ok = await validateSession();
  if (ok) redirect();
  // On failure, validateSession already cleared the session if it was 401/403.
}

function initTabs(): void {
  const tabLogin = document.getElementById('tab-login') as HTMLButtonElement | null;
  const tabRegister = document.getElementById('tab-register') as HTMLButtonElement | null;
  const formLogin = document.getElementById('form-login') as HTMLDivElement | null;
  const formRegister = document.getElementById('form-register') as HTMLDivElement | null;
  if (!tabLogin || !tabRegister || !formLogin || !formRegister) return;

  function showLogin(): void {
    if (!formLogin || !formRegister || !tabLogin || !tabRegister) return;
    formLogin.classList.remove('hidden');
    formRegister.classList.add('hidden');
    tabLogin.classList.add('active');
    tabLogin.setAttribute('aria-selected', 'true');
    tabRegister.classList.remove('active');
    tabRegister.setAttribute('aria-selected', 'false');
    hideMsg(document.getElementById('login-msg') as MsgEl);
    document.getElementById('login-email')?.focus();
  }

  function showRegister(): void {
    if (!formLogin || !formRegister || !tabLogin || !tabRegister) return;
    formLogin.classList.add('hidden');
    formRegister.classList.remove('hidden');
    tabLogin.classList.remove('active');
    tabLogin.setAttribute('aria-selected', 'false');
    tabRegister.classList.add('active');
    tabRegister.setAttribute('aria-selected', 'true');
    hideMsg(document.getElementById('reg-msg') as MsgEl);
    document.getElementById('reg-name')?.focus();
  }

  tabLogin.addEventListener('click', showLogin);
  tabRegister.addEventListener('click', showRegister);

  // Arrow-key navigation between tabs (WAI-ARIA tabs pattern).
  const tabs = [tabLogin, tabRegister];
  tabs.forEach((tab, i) => {
    tab.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && i < tabs.length - 1) {
        e.preventDefault();
        tabs[i + 1].focus();
        (tabs[i + 1] as HTMLButtonElement).click();
      } else if (e.key === 'ArrowLeft' && i > 0) {
        e.preventDefault();
        tabs[i - 1].focus();
        (tabs[i - 1] as HTMLButtonElement).click();
      }
    });
  });
}

function initEnterNavigation(): void {
  // Pressing Enter on the email field moves focus to password (if empty).
  const loginEmail = document.getElementById('login-email') as HTMLInputElement | null;
  const loginPwd = document.getElementById('login-pwd') as HTMLInputElement | null;
  if (loginEmail && loginPwd) {
    loginEmail.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' && !loginPwd.value) {
        e.preventDefault();
        loginPwd.focus();
      }
    });
  }

  // Register form: name → email → password.
  const regName = document.getElementById('reg-name') as HTMLInputElement | null;
  const regEmail = document.getElementById('reg-email') as HTMLInputElement | null;
  const regPwd = document.getElementById('reg-pwd') as HTMLInputElement | null;
  if (regName && regEmail) {
    regName.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); regEmail.focus(); }
    });
  }
  if (regEmail && regPwd) {
    regEmail.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter') { e.preventDefault(); regPwd.focus(); }
    });
  }
}

function initLoginForm(): void {
  const form = document.getElementById('form-login-real') as HTMLFormElement | null;
  const emailInput = document.getElementById('login-email') as HTMLInputElement | null;
  const pwdInput = document.getElementById('login-pwd') as HTMLInputElement | null;
  const btn = document.getElementById('login-btn') as HTMLButtonElement | null;
  const msg = document.getElementById('login-msg') as MsgEl;
  if (!form || !emailInput || !pwdInput || !btn) return;

  let submitting = false;

  form.addEventListener('submit', async (e: SubmitEvent) => {
    e.preventDefault();
    if (submitting) return; // guard against Enter-spam double submit
    hideMsg(msg);
    setInvalid(emailInput, false);
    setInvalid(pwdInput, false);

    const email = emailInput.value.trim();
    const pwd = pwdInput.value;
    if (!email || !pwd) {
      showMsg(msg, 'Completá todos los campos.', 'error');
      if (!email) setInvalid(emailInput, true);
      if (!pwd) setInvalid(pwdInput, true);
      return;
    }

    submitting = true;
    btn.disabled = true;
    btn.textContent = SUBMIT_BUSY_TEXT;

    try {
      await login(email, pwd);
      btn.textContent = SUBMIT_DONE_TEXT;
      redirect();
    } catch (err) {
      const detail = (err as Error)?.message || 'Error de autenticación.';
      showMsg(msg, detail, 'error');
      btn.disabled = false;
      btn.textContent = SUBMIT_DEFAULT_LOGIN;
    } finally {
      submitting = false;
    }
  });
}

function initRegisterForm(): void {
  const form = document.getElementById('form-register-real') as HTMLFormElement | null;
  const nameInput = document.getElementById('reg-name') as HTMLInputElement | null;
  const emailInput = document.getElementById('reg-email') as HTMLInputElement | null;
  const pwdInput = document.getElementById('reg-pwd') as HTMLInputElement | null;
  const btn = document.getElementById('register-btn') as HTMLButtonElement | null;
  const msg = document.getElementById('reg-msg') as MsgEl;
  if (!form || !emailInput || !pwdInput || !btn) return;

  let submitting = false;

  form.addEventListener('submit', async (e: SubmitEvent) => {
    e.preventDefault();
    if (submitting) return;
    hideMsg(msg);
    setInvalid(emailInput, false);
    setInvalid(pwdInput, false);

    const name = nameInput?.value.trim() ?? '';
    const email = emailInput.value.trim();
    const pwd = pwdInput.value;
    if (!email || !pwd) {
      showMsg(msg, 'Completá todos los campos.', 'error');
      if (!email) setInvalid(emailInput, true);
      if (!pwd) setInvalid(pwdInput, true);
      return;
    }
    if (pwd.length < 8) {
      showMsg(msg, 'La contraseña debe tener al menos 8 caracteres.', 'error');
      setInvalid(pwdInput, true);
      return;
    }

    submitting = true;
    btn.disabled = true;
    btn.textContent = 'Creando cuenta…';

    try {
      await register(name, email, pwd);
      showMsg(msg, '✓ Cuenta creada con éxito. Aguardá la aprobación del administrador.', 'success');
      form.reset();
    } catch (err) {
      const detail = (err as Error)?.message || 'Error al crear cuenta.';
      showMsg(msg, detail, 'error');
    } finally {
      submitting = false;
      btn.disabled = false;
      btn.textContent = SUBMIT_DEFAULT_REGISTER;
    }
  });
}

export function initLoginPage(): void {
  initTabs();
  initEnterNavigation();
  initLoginForm();
  initRegisterForm();
  // Kick off async session check (do NOT block form interaction during the check).
  handleExistingSession().catch((err) => {
    console.error('[login] session check failed:', err);
  });
}

export { clearSession };
