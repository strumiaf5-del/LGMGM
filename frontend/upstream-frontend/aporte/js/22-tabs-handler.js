/** 22-tabs-handler.js — authoritative sidebar navigation. */
(function(){
  'use strict';
  const LG = window.LGMDM = window.LGMDM || {};
  LG.tabs = LG.tabs || {};
  const TAB_STATE = LG.tabs.state = LG.tabs.state || { activeTab: 'pane-mastering-ref' };
  const bindOnce = LG.ui?.bindOnce || ((el, ev, fn) => el?.addEventListener(ev, fn));
  const paneMap = {
    'pane-mastering-ref': 'archivo',
    'pane-archivo': 'archivo',
    'pane-cadena': 'cadena',
    'pane-salida': 'salida',
    'pane-mixer': 'mixer',
    'pane-proyectos': 'proyectos'
  };
  const detailsMap = {
    'pane-mastering-ref': 'pasoArchivo',
    'pane-archivo': 'pasoArchivo',
    'pane-cadena': 'pasoCadena',
    'pane-salida': 'pasoSalida',
    'pane-mixer': 'pasoMixer'
  };
  const VALID_TABS = ['pane-mastering-ref', 'pane-archivo', 'pane-cadena', 'pane-salida', 'pane-mixer', 'pane-proyectos'];

  function selectTabInternal(tabName) {
    const normalized = VALID_TABS.includes(tabName)
      ? tabName
      : 'pane-mastering-ref';
    // No teardown del preview cuando vamos al Mixer: activateMixerMode
    // gestiona su propio previewEngine (previewEngine.playing → stopPreview
    // en deactivateMixerMode). Llamar teardown aquí destruiría el engine del
    // mixer antes de que pueda usarlo (race condition Mixer ↔ preview).
    if (normalized !== 'pane-mixer' && typeof LGMDM?.previewController?.teardown === 'function') {
      LGMDM.previewController.teardown();
    }
    const tabs = document.querySelectorAll('#sidebarTabs .sidebar-tab');
    TAB_STATE.activeTab = normalized;
    tabs.forEach((btn) => {
      const active = btn.dataset.pane === normalized;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
      btn.tabIndex = active ? 0 : -1;
    });

    if (normalized === 'pane-proyectos') {
      document.querySelector('.content-shell')?.classList.add('is-tab-hidden');
      return;
    }

    const container = document.getElementById('sidebarPaneContainer');
    if (container && paneMap[normalized]) {
      container.className = container.className.replace(/sidebar-showing-\w+/g, '').trim();
      container.classList.add(`sidebar-showing-${paneMap[normalized]}`);
    }

    Object.values(detailsMap)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .forEach((details) => {
        if (typeof details.removeAttribute === 'function' && details.tagName === 'DETAILS') {
          details.removeAttribute('open');
        }
      });

    const activeDetails = document.getElementById(detailsMap[normalized]);
    if (activeDetails && activeDetails.tagName === 'DETAILS') {
      activeDetails.setAttribute('open', '');
    }

    if (normalized === 'pane-mixer') {
      if (typeof LGMDM?.mixerUI?.activate === 'function') {
        LGMDM.mixerUI.activate();
      } else {
        document.body.classList.add('mode-mixer');
        document.querySelector('.content')?.classList.add('content--mixer');
      }
    } else {
      if (typeof LGMDM?.mixerUI?.deactivate === 'function') {
        LGMDM.mixerUI.deactivate();
      } else {
        document.body.classList.remove('mode-mixer');
        document.querySelector('.content')?.classList.remove('content--mixer');
      }
    }

    document.querySelector('.content-shell')?.classList.remove('is-tab-hidden');
  }

  function selectTab(tabName) {
    selectTabInternal(tabName);
    try { LG.storage?.set('active-tab', TAB_STATE.activeTab); } catch (_) {}
    try {
      const u = new URL(window.location.href);
      u.searchParams.set('tab', TAB_STATE.activeTab);
      window.history.replaceState(null, '', u.pathname + u.search);
    } catch (_) {}
  }

  LG.tabs.select = selectTab;
  LG.tabs.getActive = () => TAB_STATE.activeTab;

  function initTabs() {
    const tabs = [...document.querySelectorAll('#sidebarTabs .sidebar-tab[data-pane]')];
    if (!tabs.length) return;
    tabs.forEach((tab, i) => {
      bindOnce(tab, 'click', () => selectTab(tab.dataset.pane), 'tabs-handler-click');
      bindOnce(tab, 'keydown', (e) => {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = tabs[(i + 1) % tabs.length];
          next.focus();
          selectTab(next.dataset.pane);
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = tabs[(i - 1 + tabs.length) % tabs.length];
          prev.focus();
          selectTab(prev.dataset.pane);
        }
      }, 'tabs-handler-keydown');
    });
    let saved = null;
    try { saved = LG.storage?.get('active-tab'); } catch (_) {}
    let urlTab = null;
    try { urlTab = new URL(window.location.href).searchParams.get('tab'); } catch (_) {}
    const initial = VALID_TABS.includes(urlTab)
      ? urlTab
      : VALID_TABS.includes(saved)
        ? saved
        : 'pane-mastering-ref';
    selectTabInternal(initial);
  }

  bindOnce(document, 'DOMContentLoaded', initTabs, 'tabs-handler-dom-ready', { once:true });
  if (document.readyState !== 'loading') initTabs();
})();
