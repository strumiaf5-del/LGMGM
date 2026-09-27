// Theme switcher — toggles between light/dark and persists the choice.
// Exposes `window.toggleTheme()` so the keyboard-shortcuts module can bind
// `Ctrl+T` (and `Ctrl+Shift+D` for dark) to the same controller.
//
// Aligned with aporte/js/00-theme-manager.js storage key `lgmdm-theme`
// (instead of the older `theme` key) so cross-app navigation keeps the theme.

const STORAGE_KEY = 'lgmdm-theme';
const LEGACY_STORAGE_KEY = 'theme';

type Theme = 'light' | 'dark';

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(LEGACY_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* ignore */ }
  // Default to dark for a mastering console UI.
  return 'dark';
}

function writeTheme(theme: Theme): void {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    // Drop the legacy key so there is a single source of truth.
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch { /* ignore */ }
}

function applyTheme(theme: Theme): void {
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  // Notify other modules (theme manager, chassis skin, etc.).
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme } }));
}

let currentTheme: Theme = readTheme();

export function getCurrentTheme(): Theme {
  return currentTheme;
}

export function setTheme(theme: Theme): void {
  if (theme === currentTheme) return;
  currentTheme = theme;
  applyTheme(theme);
  writeTheme(theme);
}

export function toggleTheme(): Theme {
  const next: Theme = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

// Bind to the global scope so keyboard shortcuts can call `window.toggleTheme()`.
// (The visual suite and keyboard shortcuts both expect this to exist.)
type ToggleThemeWindow = Window & typeof globalThis & { toggleTheme?: () => void };
(window as ToggleThemeWindow).toggleTheme = toggleTheme;

export function initThemeSwitcher(): void {
  // Apply the persisted theme on boot.
  applyTheme(currentTheme);

  const themeToggle = document.getElementById('theme-switcher-btn') as HTMLButtonElement | null;
  if (!themeToggle) return;

  themeToggle.addEventListener('click', toggleTheme);

  // Re-apply the theme if it was changed in another tab/window.
  window.addEventListener('storage', (e: StorageEvent) => {
    if (e.key === STORAGE_KEY && (e.newValue === 'light' || e.newValue === 'dark')) {
      currentTheme = e.newValue;
      applyTheme(currentTheme);
    }
  });
}

// FIX C4: auto-boot so the persisted theme is restored and the 🎨 button works.
// Idempotent via a global flag on window.LGMDM (survives HMR).
interface LgmdmTheme { themeSwitcherBound?: boolean }
function lgmdm(): LgmdmTheme {
  const w = window as Window & { LGMDM?: LgmdmTheme };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}
const _g = lgmdm();
if (!_g.themeSwitcherBound) {
  _g.themeSwitcherBound = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initThemeSwitcher(), { once: true });
  } else {
    initThemeSwitcher();
  }
}
