/* LGMDM — Chain family navigation
 * Keeps the left sidebar as the parameter workspace and groups the chain
 * into families so the operator never sees the entire chain at once.
 */
(function (global) {
  'use strict';
  const FAMILY_ORDER = ['input','eq','dynamics','stereo','output'];
  const FAMILY_LABELS = {
    input: 'INPUT',
    eq: 'EQ / TONE',
    dynamics: 'DINÁMICA',
    stereo: 'STEREO / COLOR',
    output: 'OUTPUT',
  };
  const R2_KEY = 'v1:lgmdm-chain-r2';
  const FAMILY_HINTS = {
    input: ['ruido', 'input gain'],
    eq: ['ecualización', 'filtros de borde', 'eq correctiva', 'dynamic eq', 'balance tonal', 'eq tonal', 'modo eq', 'mid / side'],
    dynamics: ['compresión', 'dinámica —', 'compresión paralela', 'de-esser', 'compresor multibanda', 'transient shaper'],
    stereo: ['saturación armónica', 'espacio & estéreo', 'multiband stereo width', 'low-end mono maker', 'glue compressor'],
    output: ['clipper', 'normalización y salida', 'normalización & limiter', 'salida & oversampling'],
  };

  function textOf(el) { return (el?.textContent || '').replace(/\s+/g,' ').trim().toLowerCase(); }

  function familyForText(text) {
    for (const f of FAMILY_ORDER) {
      if (FAMILY_HINTS[f].some(h => text.includes(h))) return f;
    }
    return null;
  }

  function build() {
    const chain = document.getElementById('pasoCadena');
    if (!chain || document.getElementById('chainFamilyTabs')) return;
    const body = chain.querySelector('.process-card-body');
    if (!body) return;

    const nav = document.createElement('div');
    nav.id = 'chainFamilyTabs';
    nav.className = 'chain-family-tabs';
    nav.setAttribute('role','tablist');
    nav.setAttribute('aria-label','Familias de procesamiento');
    FAMILY_ORDER.forEach((family, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chain-family-tab' + (i === 0 ? ' active' : '');
      btn.dataset.family = family;
      btn.textContent = FAMILY_LABELS[family];
      btn.setAttribute('role','tab');
      btn.setAttribute('aria-selected', String(i === 0));
      btn.tabIndex = i === 0 ? 0 : -1;
      nav.appendChild(btn);
    });
    chain.parentNode?.insertBefore(nav, chain);

    const children = Array.from(body.children);
    let currentFamily = 'input';
    let lastH3 = null;
    const grouped = new Map(FAMILY_ORDER.map(f => [f, []]));

    for (const child of children) {
      const tag = child.tagName.toLowerCase();
      const txt = textOf(child);
      const byText = familyForText(txt);
      if (byText) currentFamily = byText;
      if (tag === 'h3') {
        lastH3 = child;
        const hFamily = familyForText(txt);
        if (hFamily) currentFamily = hFamily;
      }
      child.dataset.chainFamily = currentFamily;
      if (grouped.has(currentFamily)) grouped.get(currentFamily).push(child);
    }

    const CHAIN_FAMILY_KEY = 'v2:lgmdm-chain-family';
    const showFamily = (family) => {
      for (const [f, nodes] of grouped) {
        nodes.forEach(node => {
          node.hidden = f !== family;
          node.classList.toggle('chain-family-visible', f === family);
        });
      }
      nav.querySelectorAll('.chain-family-tab').forEach(btn => {
        const active = btn.dataset.family === family;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-selected', String(active));
        btn.tabIndex = active ? 0 : -1;
      });
      try { LGMDM.storage.set(CHAIN_FAMILY_KEY, family); } catch (_) {}
      try {
        const u = new URL(window.location.href);
        u.searchParams.set('chain', family);
        window.history.replaceState(null, '', u.pathname + u.search);
      } catch (_) {}
    };

    nav.addEventListener('click', (ev) => {
      const btn = ev.target.closest('.chain-family-tab');
      if (!btn) return;
      showFamily(btn.dataset.family);
    });

    nav.addEventListener('keydown', (ev) => {
      const btn = ev.target.closest('.chain-family-tab');
      if (!btn) return;
      const tabsArr = Array.from(nav.querySelectorAll('.chain-family-tab'));
      const idx = tabsArr.indexOf(btn);
      if (idx < 0) return;
      let target = null;
      if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') {
        target = tabsArr[(idx + 1) % tabsArr.length];
      } else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') {
        target = tabsArr[(idx - 1 + tabsArr.length) % tabsArr.length];
      } else if (ev.key === 'Home') {
        target = tabsArr[0];
      } else if (ev.key === 'End') {
        target = tabsArr[tabsArr.length - 1];
      }
      if (target) {
        ev.preventDefault();
        target.focus();
        showFamily(target.dataset.family);
      }
    });

    let initial = 'input';
    try {
      const urlChain = new URL(window.location.href).searchParams.get('chain');
      if (FAMILY_ORDER.includes(urlChain)) initial = urlChain;
      else {
        const saved = LGMDM.storage.get(CHAIN_FAMILY_KEY);
        if (FAMILY_ORDER.includes(saved)) initial = saved;
      }
    } catch (_) {}
    showFamily(initial);

    // ── R2 toggle (2 columnas) ──
    let r2Active = false;
    try { r2Active = LGMDM.storage.get(R2_KEY) === '1'; } catch (_) {}
    if (r2Active) chain.classList.add('chain-r2');

    const r2Toggle = document.createElement('label');
    r2Toggle.className = 'chain-r2-toggle';
    r2Toggle.innerHTML = `<input type="checkbox" ${r2Active ? 'checked' : ''}/> Vista 2 columnas (R2)`;
    r2Toggle.querySelector('input').addEventListener('change', (e) => {
      r2Active = e.target.checked;
      chain.classList.toggle('chain-r2', r2Active);
      try { LGMDM.storage.set(R2_KEY, r2Active ? '1' : '0'); } catch (_) {}
    });
    nav.parentNode?.insertBefore(r2Toggle, nav.nextSibling);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', build, { once: true });
  else build();
})(window);
