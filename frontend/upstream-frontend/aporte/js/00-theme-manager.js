(function (global) {
  "use strict";

  const LGMDM = (global.LGMDM = global.LGMDM || {});
  const STORAGE_KEY = "lgmdm-theme";
  const LEGACY_STORAGE_KEY = "base10-theme";

  const THEMES = Object.freeze({
    AUTO: "auto",
    NEON_STUDIO: "neon-studio",
    CARBON_FORGE: "carbon-forge",
    AURORA_WAVE: "aurora-wave",
    OBSIDIAN_GOLD: "obsidian-gold",
    VIOLET_CIRCUIT: "violet-circuit",
    ARCTIC_PLATINUM: "arctic-platinum",
    DARK: "dark",
    LIGHT: "light",
    OLED_BLACK: "oled-black",
    HIGH_CONTRAST: "high-contrast",
  });

  const THEME_META = Object.freeze({
    [THEMES.AUTO]: { icon: "◐", label: "Auto", note: "Preferencia del sistema" },
    [THEMES.NEON_STUDIO]: { icon: "✦", label: "Neon Studio", note: "Futurista / premium" },
    [THEMES.CARBON_FORGE]: { icon: "◼", label: "Carbon Forge", note: "Hardware / sobrio" },
    [THEMES.AURORA_WAVE]: { icon: "◈", label: "Aurora Wave", note: "Teal / magenta" },
    [THEMES.OBSIDIAN_GOLD]: { icon: "◆", label: "Obsidian Gold", note: "Mastering clásico" },
    [THEMES.VIOLET_CIRCUIT]: { icon: "◇", label: "Violet Circuit", note: "Creativo / eléctrico" },
    [THEMES.ARCTIC_PLATINUM]: { icon: "◇", label: "Arctic Platinum", note: "Claro / moderno" },
    [THEMES.DARK]: { icon: "●", label: "Dark", note: "Neutro" },
    [THEMES.LIGHT]: { icon: "○", label: "Light", note: "Claro" },
    [THEMES.OLED_BLACK]: { icon: "⬛", label: "OLED Black", note: "Negro puro" },
    [THEMES.HIGH_CONTRAST]: { icon: "◉", label: "High Contrast", note: "Accesibilidad" },
  });

  const STUDIO_THEMES = [
    THEMES.NEON_STUDIO,
    THEMES.CARBON_FORGE,
    THEMES.AURORA_WAVE,
    THEMES.OBSIDIAN_GOLD,
    THEMES.VIOLET_CIRCUIT,
    THEMES.ARCTIC_PLATINUM,
  ];
  const ACCESS_THEMES = [THEMES.AUTO, THEMES.DARK, THEMES.LIGHT, THEMES.OLED_BLACK, THEMES.HIGH_CONTRAST];

  let currentTheme = THEMES.NEON_STUDIO;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)");

  function storageGet(key) {
    try {
      return LGMDM.storage?.get?.(key) ?? localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function storageSet(key, value) {
    try {
      if (LGMDM.storage?.set) LGMDM.storage.set(key, value);
      else localStorage.setItem(key, value);
    } catch (_) {
      /* visual preference must never break the application */
    }
  }

  function getSavedTheme() {
    const modern = storageGet(STORAGE_KEY);
    if (modern && Object.values(THEMES).includes(modern)) return modern;
    const legacy = storageGet(LEGACY_STORAGE_KEY);
    if (legacy && Object.values(THEMES).includes(legacy)) return legacy;
    return THEMES.NEON_STUDIO;
  }

  function resolvedTheme(theme) {
    return theme === THEMES.AUTO ? (prefersDark.matches ? THEMES.DARK : THEMES.LIGHT) : theme;
  }

  function applyTheme(theme, { persist = true, announce = true } = {}) {
    if (!Object.values(THEMES).includes(theme)) {
      throw new Error(`LGMDM Theme Contract: unknown theme "${theme}"`);
    }

    currentTheme = theme;
    if (persist) storageSet(STORAGE_KEY, theme);

    const root = document.documentElement;
    root.setAttribute("data-theme", theme);
    root.classList.remove(...Object.values(THEMES).filter(Boolean).map((name) => `theme-${name}`));
    root.classList.add(`theme-${theme}`);

    const resolved = resolvedTheme(theme);
    root.dataset.themeResolved = resolved;

    // Lee --ui-bg del CSS del theme activo (single source of truth).
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      const cs = getComputedStyle(root);
      const bg = cs.getPropertyValue('--ui-bg').trim() || '#070812';
      meta.setAttribute('content', bg);
    }

    updateSwitcherUI();
    if (announce) {
      window.dispatchEvent(new CustomEvent("themechange", { detail: { theme, resolvedTheme: resolved } }));
    }
  }

  function createMenu() {
    if (document.getElementById("theme-switcher-menu")) return;
    const button = document.getElementById("theme-switcher-btn");
    if (!button) return;

    const wrapper = document.createElement("div");
    wrapper.className = "theme-switcher-wrap";
    button.parentNode.insertBefore(wrapper, button);
    wrapper.appendChild(button);

    const menu = document.createElement("div");
    menu.id = "theme-switcher-menu";
    menu.className = "theme-switcher-menu hidden";
    menu.setAttribute("role", "menu");
    menu.innerHTML = `
      <div class="theme-switcher-title">LGMDM Visual Themes</div>
      <div class="theme-section-label">STUDIO</div>
      <div class="theme-grid studio-theme-grid"></div>
      <div class="theme-section-label">UTILITY</div>
      <div class="theme-option-list utility-theme-list"></div>
      <div class="theme-divider"></div>
      <div class="theme-shortcuts"><small>Ctrl/Cmd + Shift + T · selector de tema</small></div>
    `;
    wrapper.appendChild(menu);

    const studioGrid = menu.querySelector(".studio-theme-grid");
    const utilityList = menu.querySelector(".utility-theme-list");

    STUDIO_THEMES.forEach((theme) => studioGrid.appendChild(makeOption(theme, true)));
    ACCESS_THEMES.forEach((theme) => utilityList.appendChild(makeOption(theme, false)));

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opened = menu.classList.contains("hidden");
      menu.classList.toggle("hidden");
      if (opened) {
        const items = menu.querySelectorAll('.theme-option[data-theme]');
        if (items.length) items[0].focus();
      } else {
        updateSwitcherUI();
      }
    });

    menu.addEventListener("keydown", (event) => {
      const items = Array.from(menu.querySelectorAll('.theme-option[data-theme]'));
      if (!items.length) return;
      const current = document.activeElement;
      const idx = items.indexOf(current);
      let next = null;
      if (event.key === 'ArrowDown' || event.key === 'ArrowRight') {
        next = items[(idx < 0 ? 0 : (idx + 1) % items.length)];
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') {
        next = items[(idx < 0 ? items.length - 1 : (idx - 1 + items.length) % items.length)];
      } else if (event.key === 'Home') {
        next = items[0];
      } else if (event.key === 'End') {
        next = items[items.length - 1];
      } else if (event.key === 'Escape') {
        event.preventDefault();
        menu.classList.add("hidden");
        button.focus();
        return;
      }
      if (next) {
        event.preventDefault();
        next.focus();
      }
    });

    document.addEventListener("click", (event) => {
      if (!wrapper.contains(event.target)) menu.classList.add("hidden");
    });
  }

  function makeOption(theme, studio) {
    const meta = THEME_META[theme];
    const button = document.createElement("button");
    button.type = "button";
    button.className = studio ? "theme-option theme-option-studio" : "theme-option";
    button.dataset.theme = theme;
    button.setAttribute("role", "menuitemradio");
    button.innerHTML = `<span class="theme-option-swatch theme-${theme}" aria-hidden="true"></span><span class="theme-option-copy"><strong>${meta.icon} ${meta.label}</strong><small>${meta.note}</small></span>`;
    button.addEventListener("click", () => {
      applyTheme(theme);
      document.getElementById("theme-switcher-menu")?.classList.add("hidden");
      showThemeToast(`${meta.icon} ${meta.label}`);
    });
    return button;
  }

  function updateSwitcherUI() {
    document.querySelectorAll(".theme-option[data-theme]").forEach((option) => {
      const active = option.dataset.theme === currentTheme;
      option.classList.toggle("active", active);
      option.setAttribute("aria-checked", String(active));
    });
  }

  function toggleDarkMode() {
    const dark = [THEMES.DARK, THEMES.OLED_BLACK, THEMES.NEON_STUDIO, THEMES.CARBON_FORGE, THEMES.AURORA_WAVE, THEMES.OBSIDIAN_GOLD, THEMES.VIOLET_CIRCUIT].includes(currentTheme);
    applyTheme(dark ? THEMES.ARCTIC_PLATINUM : THEMES.NEON_STUDIO);
  }

  function showThemeToast(message) {
    const existing = document.querySelector(".theme-toast");
    if (existing) existing.remove();
    const toast = document.createElement("div");
    toast.className = "theme-toast show";
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 1600);
  }

  function setupListeners() {
    prefersDark.addEventListener("change", () => {
      if (currentTheme === THEMES.AUTO) applyTheme(THEMES.AUTO, { persist: false });
    });

    document.addEventListener("keydown", (event) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "t") {
        event.preventDefault();
        document.getElementById("theme-switcher-menu")?.classList.toggle("hidden");
      }
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        toggleDarkMode();
      }
    });
  }

  function init() {
    currentTheme = getSavedTheme();
    applyTheme(currentTheme, { persist: true, announce: false });
    createMenu();
    setupListeners();
    updateSwitcherUI();
    console.debug(`🎨 LGMDM theme initialized: ${currentTheme}`);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})(window);
