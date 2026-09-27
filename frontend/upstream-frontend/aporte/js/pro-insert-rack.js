// ============================================================
// pro-insert-rack.js — Pro Insert Rack flotante con drag-reorder
// 10 inserts DSP premium con dock/floating modes + persistencia
// ============================================================
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  const NS = (LG.proInsertRack = LG.proInsertRack || {});

  // Catálogo de los 10 inserts premium
  const INSERTS = [
    { id: 'resonance-tamer',  title: 'Reso Tamer',       endpoint: '/dsp/resonance-tamer' },
    { id: 'inflator',         title: 'Inflator',         endpoint: '/dsp/inflator' },
    { id: 'phantom-sub',      title: 'Phantom Sub',      endpoint: '/dsp/phantom-sub' },
    { id: 'iso-compensation', title: 'ISO 226 Comp',     endpoint: '/dsp/iso-compensation' },
    { id: 'match-eq',         title: 'Match EQ',         endpoint: '/dsp/match-eq' },
    { id: 'cross-demask',     title: 'Cross Demask',     endpoint: '/dsp/cross-demask' },
    { id: 'loudness-penalty', title: 'Loudness Penalty', endpoint: '/dsp/loudness-penalty' },
    { id: 'phase-rotation',   title: 'Phase Rotation',   endpoint: '/dsp/phase-rotation' },
    { id: 'spectral-tilt',    title: 'Spectral Tilt',    endpoint: '/dsp/spectral-tilt' },
    { id: 'dr-meter',         title: 'DR Meter',         endpoint: '/dsp/dr-meter' }
  ];

  const STATE_KEY = 'lgmdm.insert_rack.state.v1';

  function loadState() {
    try {
      const raw = localStorage.getItem(STATE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }
  function saveState(s) {
    try { localStorage.setItem(STATE_KEY, JSON.stringify(s)); } catch (_) {}
  }

  function buildCard(spec, isBypassed) {
    const card = document.createElement('article');
    card.className = 'pir-card';
    card.draggable = true;
    card.dataset.insertId = spec.id;
    card.dataset.endpoint = spec.endpoint;
    card.dataset.state = isBypassed ? 'bypassed' : 'active';
    card.tabIndex = 0;
    card.setAttribute('aria-label', `${spec.title}. Espacio para pick-up, flechas para reordenar.`);
    card.setAttribute('aria-grabbed', 'false');
    card.innerHTML = `
      <header class="pir-card-head">
        <span class="pir-drag" aria-label="Drag para reordenar">⠿</span>
        <strong class="pir-card-title">${spec.title}</strong>
        <span class="pir-led ${isBypassed ? '' : 'pir-led--active'}" data-role="led"></span>
        <button class="pir-bypass" data-role="bypass" aria-pressed="${isBypassed}" aria-label="Bypass ${spec.title}" title="Bypass" type="button">B</button>
      </header>
      <div class="pir-card-body">
        <div class="pir-card-endpoint" data-role="endpoint">${spec.endpoint}</div>
      </div>
      <footer class="pir-card-foot">
        <span class="pir-status" data-role="status">Ready</span>
        <button class="pir-btn pir-btn--mini" data-role="openDetail" aria-label="Abrir detalle de ${spec.title}" title="Abrir detalle" type="button">⤢</button>
      </footer>
    `;
    return card;
  }

  function wireDragAndDrop(grid) {
    let dragSrc = null;
    grid.addEventListener('dragstart', (e) => {
      const card = e.target.closest('.pir-card');
      if (!card) return;
      dragSrc = card;
      card.classList.add('dragging');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', card.dataset.insertId);
    });
    grid.addEventListener('dragend', () => {
      if (dragSrc) dragSrc.classList.remove('dragging');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      persistFromDom();
    });
    grid.addEventListener('dragover', (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const over = e.target.closest('.pir-card');
      if (!over || over === dragSrc) return;
      grid.querySelectorAll('.drag-over').forEach(c => c.classList.remove('drag-over'));
      over.classList.add('drag-over');
    });
    grid.addEventListener('drop', (e) => {
      e.preventDefault();
      const over = e.target.closest('.pir-card');
      if (!over || over === dragSrc) return;
      const rect = over.getBoundingClientRect();
      const after = (e.clientY - rect.top) > rect.height / 2;
      over.parentNode.insertBefore(dragSrc, after ? over.nextSibling : over);
      dragSrc = null;
    });
  }

  // ── Keyboard reorder (Space pick-up, ArrowLeft/Right move, Space drop) ────
  function wireKeyboardReorder(grid) {
    grid.addEventListener('keydown', (e) => {
      const card = e.target.closest?.('.pir-card');
      if (!card) return;
      const cards = Array.from(grid.querySelectorAll('.pir-card'));
      const idx = cards.indexOf(card);
      if (idx < 0) return;
      if (e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        if (card.dataset.kbPickedUp === '1') {
          delete card.dataset.kbPickedUp;
          card.classList.remove('dragging');
          card.setAttribute('aria-grabbed', 'false');
          persistFromDom();
        } else {
          card.dataset.kbPickedUp = '1';
          card.classList.add('dragging');
          card.setAttribute('aria-grabbed', 'true');
        }
      } else if (card.dataset.kbPickedUp === '1') {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
          e.preventDefault();
          const next = cards[idx + 1];
          if (next) {
            grid.insertBefore(card, next.nextSibling);
            card.focus();
          }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault();
          const prev = cards[idx - 1];
          if (prev) {
            grid.insertBefore(card, prev);
            card.focus();
          }
        } else if (e.key === 'Escape') {
          e.preventDefault();
          delete card.dataset.kbPickedUp;
          card.classList.remove('dragging');
        }
      }
    });
  }

  function persistFromDom() {
    const grid = LG.dom.byId('pirGrid');
    if (!grid) return;
    const order = [...grid.querySelectorAll('.pir-card')].map(c => c.dataset.insertId);
    const bypass = {};
    grid.querySelectorAll('.pir-card').forEach(c => {
      bypass[c.dataset.insertId] = c.dataset.state === 'bypassed';
    });
    const rack = LG.dom.byId('proInsertRack');
    const minimized = rack ? rack.dataset.minimized === 'true' : false;
    const hidden = rack ? rack.dataset.hidden === 'true' : true;
    const mode = rack ? (rack.dataset.mode === 'floating' ? 'floating' : 'docked') : 'docked';
    const position = (mode === 'floating' && rack) ? readPosition(rack) : undefined;
    const payload = { order, bypass, minimized, hidden, mode };
    if (position) payload.position = position;
    saveState(payload);
    updateActiveCount();
  }

  function readPosition(rack) {
    const left = parseFloat(rack.style.left);
    const top = parseFloat(rack.style.top);
    if (Number.isFinite(left) && Number.isFinite(top)) {
      return { left, top };
    }
    return null;
  }

  function toggleMode(root) {
    if (!root) return;
    const isFloating = root.classList.contains('pro-insert-rack--floating');
    const next = isFloating ? 'docked' : 'floating';
    root.dataset.mode = next;
    if (next === 'floating') {
      root.classList.remove('pro-insert-rack--docked');
      root.classList.add('pro-insert-rack--floating');
      if (!root.style.left || root.style.left === 'auto') {
        const rect = root.getBoundingClientRect();
        root.style.left = Math.max(0, rect.left) + 'px';
        root.style.top = Math.max(0, rect.top) + 'px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      }
      root.dataset.minimized = 'false';
      const minBtn = root.querySelector('#pirMinimize');
      if (minBtn) {
        minBtn.textContent = '─';
        minBtn.title = 'Minimizar';
      }
      const modeBtn = root.querySelector('#pirModeToggle');
      if (modeBtn) {
        modeBtn.textContent = '⤵';
        modeBtn.title = 'Cambiar a Dock';
      }
    } else {
      root.classList.remove('pro-insert-rack--floating');
      root.classList.add('pro-insert-rack--docked');
      root.style.left = '';
      root.style.top = '';
      root.style.right = '';
      root.style.bottom = '';
      const modeBtn = root.querySelector('#pirModeToggle');
      if (modeBtn) {
        modeBtn.textContent = '⤴';
        modeBtn.title = 'Cambiar a Floating';
      }
    }
    persistFromDom();
  }

  function updateActiveCount() {
    const grid = LG.dom.byId('pirGrid');
    const out = LG.dom.byId('pirActiveCount');
    if (!grid || !out) return;
    const active = grid.querySelectorAll('.pir-card[data-state="active"]').length;
    out.textContent = `${active}/10 active`;
  }

  function buildShell() {
    const shell = document.createElement('aside');
    shell.id = 'proInsertRack';
    shell.className = 'pro-insert-rack pro-insert-rack--docked';
    shell.dataset.state = 'docked';
    shell.dataset.minimized = 'true';
    shell.dataset.hidden = 'true';
    shell.dataset.mode = 'docked';
    shell.setAttribute('role', 'region');
    shell.setAttribute('aria-label', 'Pro Insert Rack');
    shell.innerHTML = `
      <header class="pir-titlebar" id="pirTitlebar">
        <div class="pir-titlebar-left">
          <span class="pir-drag" aria-hidden="true">⋮⋮</span>
          <strong class="pir-title"><svg class="pir-title-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="margin-right:6px;vertical-align:-2px;"><rect x="2" y="2.5" width="12" height="3.5" rx="1"/><rect x="2" y="6.5" width="12" height="3.5" rx="1"/><rect x="2" y="10.5" width="12" height="3.5" rx="1"/><circle cx="5" cy="4.2" r="0.8" fill="currentColor"/><circle cx="11" cy="8.2" r="0.8" fill="currentColor"/><circle cx="5" cy="12.2" r="0.8" fill="currentColor"/></svg>Pro Insert Rack</strong>
          <span class="pir-count" id="pirActiveCount">0/10 active</span>
        </div>
        <div class="pir-titlebar-right">
          <button class="pir-btn pir-btn--accent" id="pirRunChain" aria-label="Procesar cadena de inserts activos" title="Procesar cadena (inserts activos en este orden)" type="button">▶ Run chain</button>
          <button class="pir-btn pir-btn--icon" id="pirResetAll" aria-label="Activar todos los inserts" title="Activar todos" type="button">↻</button>
          <button class="pir-btn pir-btn--icon" id="pirModeToggle" aria-label="Cambiar modo Dock/Floating" title="Cambiar a Floating" type="button">⤴</button>
          <button class="pir-btn pir-btn--icon" id="pirMinimize" aria-label="Expandir/contraer Pro Insert Rack" title="Expandir" type="button">▢</button>
          <button class="pir-btn pir-btn--icon" id="pirClose" aria-label="Cerrar Pro Insert Rack" title="Cerrar" type="button">✕</button>
        </div>
      </header>
      <div class="pir-grid" id="pirGrid"></div>
    `;
    return shell;
  }

  function mount(rootEl) {
    let root = rootEl || LG.dom.byId('proInsertRack');
    if (!root) {
      root = buildShell();
      document.body.appendChild(root);
    }
    const grid = root.querySelector('#pirGrid');

    const persisted = loadState();
    const order = (persisted && Array.isArray(persisted.order) && persisted.order.length === 10)
      ? persisted.order : INSERTS.map(i => i.id);
    const bypass = (persisted && persisted.bypass) || {};
    const isHidden = persisted && typeof persisted.hidden === 'boolean' ? persisted.hidden : true;
    root.dataset.hidden = isHidden ? 'true' : 'false';
    const initialMode = (persisted && (persisted.mode === 'floating' || persisted.mode === 'docked'))
      ? persisted.mode
      : 'docked';
    root.dataset.mode = initialMode;
    if (initialMode === 'floating') {
      root.classList.remove('pro-insert-rack--docked');
      root.classList.add('pro-insert-rack--floating');
      const pos = persisted && persisted.position;
      if (pos && typeof pos.left === 'number' && typeof pos.top === 'number') {
        root.style.left = pos.left + 'px';
        root.style.top = pos.top + 'px';
        root.style.right = 'auto';
        root.style.bottom = 'auto';
      }
      const modeBtn = root.querySelector('#pirModeToggle');
      if (modeBtn) {
        modeBtn.textContent = '⤵';
        modeBtn.title = 'Cambiar a Dock';
      }
    }
    if (persisted && typeof persisted.minimized === 'boolean') {
      root.dataset.minimized = persisted.minimized ? 'true' : 'false';
      const minBtn = root.querySelector('#pirMinimize');
      if (minBtn) {
        minBtn.textContent = persisted.minimized ? '▢' : '─';
        minBtn.title = persisted.minimized ? 'Expandir' : 'Minimizar';
      }
    }

    order.forEach(id => {
      const spec = INSERTS.find(i => i.id === id);
      if (spec) grid.appendChild(buildCard(spec, bypass[id] === true));
    });

    wireDragAndDrop(grid);
    wireKeyboardReorder(grid);

    grid.addEventListener('click', (e) => {
      const bypassBtn = e.target.closest('[data-role="bypass"]');
      if (bypassBtn) {
        const card = bypassBtn.closest('.pir-card');
        const wasActive = card.dataset.state === 'active';
        card.dataset.state = wasActive ? 'bypassed' : 'active';
        bypassBtn.setAttribute('aria-pressed', String(!wasActive));
        const led = card.querySelector('[data-role="led"]');
        if (led) led.classList.toggle('pir-led--active', !wasActive);
        persistFromDom();
        return;
      }
      const detailBtn = e.target.closest('[data-role="openDetail"]');
      if (detailBtn) {
        const card = detailBtn.closest('.pir-card');
        if (card) openDetail(card.dataset.insertId);
      }
    });

    root.querySelector('#pirClose')?.addEventListener('click', () => {
      if (typeof root._pirTeardown === 'function') root._pirTeardown();
      root.dataset.hidden = 'true';
      persistFromDom();
    });
    root.querySelector('#pirResetAll')?.addEventListener('click', () => resetAll(root));
    root.querySelector('#pirRunChain')?.addEventListener('click', () => {
      const btn = root.querySelector('#pirRunChain');
      if (btn) btn.disabled = true;
      NS.runChain().finally(() => {
        if (btn) btn.disabled = false;
      });
    });
    root.querySelector('#pirMinimize')?.addEventListener('click', () => {
      const isDocked = root.classList.contains('pro-insert-rack--docked');
      if (isDocked) {
        root.dataset.minimized = root.dataset.minimized === 'true' ? 'false' : 'true';
        const btn = root.querySelector('#pirMinimize');
        if (btn) {
          btn.textContent = root.dataset.minimized === 'true' ? '▢' : '─';
          btn.title = root.dataset.minimized === 'true' ? 'Expandir' : 'Minimizar';
        }
        persistFromDom();
      }
    });
    root.querySelector('#pirModeToggle')?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleMode(root);
    });

    updateActiveCount();

    wireTitlebarDrag(root);

    // Wire el botón del header que abre/cierra el rack
    const headerBtn = LG.dom.byId('btnToggleInsertRack');
    if (headerBtn && !headerBtn._pirWired) {
      headerBtn._pirWired = true;
      headerBtn.addEventListener('click', NS.toggle);
    }

    // MX-11 — hook al evento canónico de file load. Dispara el procesamiento
    // de todos los inserts activos con el archivo recién cargado. El listener
    // se registra una sola vez por instancia del módulo (el IIFE garantiza
    // Auto-trigger removido — antes esto llamaba processAll() cada vez que el
    // usuario cargaba un archivo, disparando TODOS los DSP activos. Ahora
    // los inserts solo se procesan cuando el usuario clickea "▶ Run chain"
    // en el titlebar o llama LG.proInsertRack.runChain() explícitamente.
    // El usuario decide el orden (drag/drop) y cuándo correr la cadena.

    return root;
  }

  // ── Drag-to-move del panel flotante ──────────────────────────────────────
  function wireTitlebarDrag(shell) {
    const titlebar = shell.querySelector('#pirTitlebar');
    if (!titlebar) return;
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    const ac = new AbortController();
    shell.dataset.pirDragAbort = '';

    function teardown() {
      if (!ac.signal.aborted) ac.abort();
    }
    shell._pirTeardown = teardown;

    // Convierte de right/bottom a left/top absolutos para poder arrastrar libremente
    function toAbsolute() {
      const rect = shell.getBoundingClientRect();
      shell.style.right = 'auto';
      shell.style.bottom = 'auto';
      shell.style.left = rect.left + 'px';
      shell.style.top = rect.top + 'px';
    }

    function dragStart(clientX, clientY) {
      dragging = true;
      const hasAbsLeft = shell.style.left && shell.style.left !== 'auto' && shell.style.left !== '';
      if (!hasAbsLeft) toAbsolute();
      startX = clientX;
      startY = clientY;
      startLeft = parseInt(shell.style.left, 10) || 0;
      startTop = parseInt(shell.style.top, 10) || 0;
      document.body.classList.add('lgmdm-layout-dragging');
      document.body.style.userSelect = 'none';
      document.body.style.webkitUserSelect = 'none';
    }

    function dragMove(clientX, clientY) {
      if (!dragging) return;
      const dx = clientX - startX;
      const dy = clientY - startY;
      const minL = 0, minT = 0;
      const maxL = Math.max(0, window.innerWidth - 240);
      const maxT = Math.max(0, window.innerHeight - 40);
      shell.style.left = Math.max(minL, Math.min(maxL, startLeft + dx)) + 'px';
      shell.style.top = Math.max(minT, Math.min(maxT, startTop + dy)) + 'px';
    }

    function dragEnd() {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('lgmdm-layout-dragging');
      document.body.style.userSelect = '';
      document.body.style.webkitUserSelect = '';
      if (typeof persistFromDom === 'function') persistFromDom();
    }

    titlebar.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      dragStart(e.clientX, e.clientY);
      e.preventDefault();
    }, { signal: ac.signal });
    document.addEventListener('mousemove', (e) => dragMove(e.clientX, e.clientY), { signal: ac.signal });
    document.addEventListener('mouseup', dragEnd, { signal: ac.signal });

    titlebar.addEventListener('touchstart', (e) => {
      if (e.target.closest('button')) return;
      const t = e.touches[0];
      dragStart(t.clientX, t.clientY);
    }, { passive: true, signal: ac.signal });
    document.addEventListener('touchmove', (e) => {
      if (!dragging) return;
      const t = e.touches[0];
      dragMove(t.clientX, t.clientY);
    }, { passive: true, signal: ac.signal });
    document.addEventListener('touchend', dragEnd, { signal: ac.signal });
  }

  function resetAll(root) {
    root.querySelectorAll('.pir-card').forEach(c => {
      c.dataset.state = 'active';
      c.querySelector('[data-role="bypass"]').setAttribute('aria-pressed', 'false');
      c.querySelector('[data-role="led"]').className = 'pir-led pir-led--active';
    });
    persistFromDom();
  }

  // ── Detail modal — abre el widget del insert en un popup ──────────────
  function openDetail(insertId) {
    const spec = INSERTS.find((i) => i.id === insertId);
    if (!spec) return;
    const existing = document.getElementById('pirDetailModal');
    if (existing) existing.remove();
    const inst = (typeof NS.registry === 'object' && NS.registry) ? NS.registry[insertId] : null;
    const WidgetClass = inst?.widget || null;

    const overlay = document.createElement('div');
    overlay.id = 'pirDetailModal';
    overlay.className = 'pir-detail-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `${spec.title} — detalle`);
    overlay.innerHTML = `
      <div class="pir-detail-dialog">
        <header class="pir-detail-head">
          <strong>${spec.title}</strong>
          <code class="pir-detail-endpoint">${spec.endpoint}</code>
          <button class="pir-detail-close" type="button" aria-label="Cerrar">✕</button>
        </header>
        <div class="pir-detail-body" id="pirDetailBody">
          ${WidgetClass ? '<div class="pir-detail-canvas-wrap"><canvas id="pirDetailCanvas"></canvas></div>' : ''}
          <div class="pir-detail-info" id="pirDetailInfo"></div>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);

    let widget = null;
    const closeAll = () => {
      if (widget && typeof widget.destroy === 'function') {
        try { widget.destroy(); } catch (_) {}
      }
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') closeAll(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closeAll(); });
    overlay.querySelector('.pir-detail-close').addEventListener('click', closeAll);
    document.addEventListener('keydown', onKey);

    if (WidgetClass) {
      try {
        const opts = inst?.params ? { ...inst.params } : {};
        widget = new WidgetClass();
        widget.init(overlay.querySelector('#pirDetailCanvas'), opts);
        const info = overlay.querySelector('#pirDetailInfo');
        if (info) {
          const params = inst?.params || {};
          info.innerHTML = Object.keys(params).length === 0
            ? '<em>Sin parámetros editables (vista solamente)</em>'
            : '<ul>' + Object.entries(params).map(([k, v]) => `<li><code>${k}</code>: ${typeof v === 'number' ? v.toFixed(2) : String(v)}</li>`).join('') + '</ul>';
        }
      } catch (err) {
        console.debug(`[pir] openDetail init failed: ${insertId}`, err);
      }
    } else {
      const info = overlay.querySelector('#pirDetailInfo');
      if (info) info.innerHTML = '<em>Widget visual no disponible todavía para este DSP. Usá la pestaña "SUITE PRO" del header para controles completos.</em>';
    }
  }

  // Inserts que requieren 2 archivos — no funcionan en chain pipeline
  const DUAL_FILE_INSERTS = new Set(['match-eq', 'cross-demask']);

  async function processInsert(insertId, file) {
    const spec = INSERTS.find(i => i.id === insertId);
    if (!spec) throw new Error('unknown insert ' + insertId);
    const card = document.querySelector(`.pir-card[data-insert-id="${insertId}"]`);
    if (!card) throw new Error('card not mounted');
    if (card.dataset.state === 'bypassed') return null;
    const led = card.querySelector('[data-role="led"]');
    const status = card.querySelector('[data-role="status"]');
    led.className = 'pir-led pir-led--processing';
    card.dataset.state = 'processing';
    if (status) status.textContent = 'Processing…';
    try {
      let payload;
      if (insertId === 'match-eq') {
        const refFile = LG.state?.reference?.file;
        if (!refFile) throw new Error('Match EQ requiere archivo de referencia');
        const fd = new FormData();
        fd.append('target_file', file);
        fd.append('reference_file', refFile);
        const cat = LG.proInsertRack.CATALOG?.['match-eq'];
        if (cat) {
          const params = cat.toBackendParams.call({ params: cat.defaults || {} });
          Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
        }
        const res = await LG.api.apiFetch(spec.endpoint, { method: 'POST', body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ct = res.headers.get('content-type') || '';
        payload = ct.includes('application/json') ? await res.json() : await res.blob();
      } else {
        const insert = LG.proInsertRack.registry?.[insertId];
        if (insert && typeof insert.fetch === 'function') {
          payload = await insert.fetch(file);
        } else {
          const fd = new FormData();
          fd.append('file', file);
          const cat = LG.proInsertRack.CATALOG?.[insertId];
          if (cat && typeof cat.toBackendParams === 'function') {
            const params = cat.toBackendParams.call({ params: cat.defaults || {} });
            Object.entries(params).forEach(([k, v]) => fd.append(k, String(v)));
          }
          const res = await LG.api.apiFetch(spec.endpoint, { method: 'POST', body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const ct = res.headers.get('content-type') || '';
          payload = ct.includes('application/json') ? await res.json() : await res.blob();
        }
      }
      led.className = 'pir-led pir-led--active';
      card.dataset.state = 'active';
      if (status) status.textContent = 'Ready';
      return payload;
    } catch (err) {
      led.className = 'pir-led pir-led--error';
      card.dataset.state = 'error';
      if (status) status.textContent = err.message.slice(0, 24);
      throw err;
    }
  }

  // API pública
  NS.mount = mount;
  NS.INSERTS = INSERTS;
  NS.processOne = processInsert;
  NS.processAll = async function(file) {
    const root = LG.dom.byId('proInsertRack');
    if (!root) return null;
    if (!(file instanceof Blob)) return { results: [], blob: null };
    const cards = [...root.querySelectorAll('.pir-card[data-state="active"]')];
    if (cards.length === 0) return { results: [], blob: file };
    let blob = file;
    const results = [];
    const origName = file instanceof File ? file.name : 'input.wav';
    for (let i = 0; i < cards.length; i++) {
      const insertId = cards[i].dataset.insertId;
      if (insertId === 'cross-demask') {
        results.push({ id: insertId, ok: false, error: 'Requiere 2 stems — usar standalone' });
        continue;
      }
      try {
        const payload = await processInsert(insertId, blob);
        if (payload instanceof Blob) {
          // F2 — forzar extensión .wav en el blob intermedio del chain. Los
          // endpoints /dsp/* devuelven WAV 24-bit sin importar el formato del
          // input original; preservar la extensión original (.flac/.mp3/etc)
          // hacía que el siguiente insert fallara _validate_audio_magic_bytes
          // porque el header ya no coincidía con la extensión.
          const safeName = payload instanceof File ? payload.name : `processed_${i + 1}.wav`;
          blob = new File([payload], safeName, { type: payload.type || 'audio/wav' });
        }
        results.push({ id: cards[i].dataset.insertId, ok: true });
      } catch (e) {
        results.push({ id: cards[i].dataset.insertId, ok: false, error: e.message });
      }
    }
    return { results, blob };
  };
  NS.reset = function() { resetAll(LG.dom.byId('proInsertRack')); };
  NS.open = function() {
    const root = LG.dom.byId('proInsertRack');
    if (root) {
      root.dataset.hidden = 'false';
      persistFromDom();
    }
  };
  NS.close = function() {
    const root = LG.dom.byId('proInsertRack');
    if (root) {
      root.dataset.hidden = 'true';
      persistFromDom();
    }
  };
  NS.toggle = function() {
    const root = LG.dom.byId('proInsertRack');
    if (root) {
      const isHidden = root.dataset.hidden === 'true';
      root.dataset.hidden = isHidden ? 'false' : 'true';
      persistFromDom();
    }
  };

  // Render del output de la cadena: <audio> + download button en
  // #previewAudioWrap + A/B comparison con el original. El usuario ve,
  // escucha y descarga el resultado del chain.
  function renderChainOutput(blob, originalName, results) {
    const wrap = document.getElementById('previewAudioWrap');
    if (!wrap || !(blob instanceof Blob) || blob.size === 0) return;

    // Limpiar contenido anterior del chain (no el preview del servidor)
    wrap.querySelectorAll('[data-chain-output]').forEach((n) => n.remove());
    const prevUrl = wrap.querySelector('audio[data-preview-ready="true"]')?.src;
    if (prevUrl) try { URL.revokeObjectURL(prevUrl); } catch (_) {}

    const chainUrl = URL.createObjectURL(blob);
    const ok = results?.filter((r) => r.ok).length || 0;
    const fail = results?.filter((r) => !r.ok).length || 0;

    const container = document.createElement('div');
    container.dataset.chainOutput = 'true';
    container.className = 'chain-output-wrap';
    container.innerHTML = `
      <div class="chain-output-head">
        <strong>Chain Output</strong>
        <span class="chain-output-meta">${ok} inserts OK${fail ? ` · ${fail} con error` : ''} · ${(blob.size / 1024 / 1024).toFixed(1)} MB</span>
      </div>
      <audio controls preload="metadata" src="${chainUrl}" data-chain-audio></audio>
      <div class="chain-output-actions">
        <a class="btn btn-primary" href="${chainUrl}" download="chain_${(originalName || 'master').replace(/\.[^/.]+$/, '')}.wav">Descargar Master</a>
        <button class="btn btn-secondary" type="button" id="chainABBtn">Comparar con original</button>
      </div>
    `;
    wrap.appendChild(container);

    // Quitar botón "Play" del master console si el chain no está reproduciendo
    const playBtn = document.getElementById('consolePlayBtn');
    if (playBtn) {
      playBtn.disabled = false;
      playBtn.textContent = '▶';
      playBtn.setAttribute('aria-pressed', 'false');
    }

    const abBtn = container.querySelector('#chainABBtn');
    if (abBtn && typeof window.setupABPlayer === 'function') {
      abBtn.addEventListener('click', () => {
        abBtn.disabled = true;
        abBtn.textContent = 'Cargando A/B…';
        window.setupABPlayer(blob).then(() => {
          abBtn.disabled = false;
          abBtn.textContent = 'A/B listo';
        }).catch(() => {
          abBtn.disabled = false;
          abBtn.textContent = 'Comparar con original';
        });
      });
    }

    // Limpiar URL al cerrar o reemplazar
    const observer = new MutationObserver(() => {
      if (!document.body.contains(container)) {
        URL.revokeObjectURL(chainUrl);
        observer.disconnect();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Run chain — procesa todos los inserts activos en el orden actual del
  // rack. El usuario decide el orden (drag/drop) y cuándo correr. Si no hay
  // archivo cargado, muestra toast y sale. Si no hay cards activas, sale
  // sin error (no es un bug, sólo no hay nada que procesar).
  NS.runChain = async function() {
    const f = window.LGMDM?.state?.selectedFile;
    if (!f) {
      if (window.LGMDM?.ui?.showToast) {
        window.LGMDM.ui.showToast('Cargá un archivo antes de correr la cadena', 'warning', 4000);
      }
      return null;
    }
    if (window.LGMDM?.ui?.showToast) {
      window.LGMDM.ui.showToast('Procesando cadena de inserts…', 'info', 2000);
    }
    return NS.processAll(f).then((result) => {
      const ok = result?.results?.filter((r) => r.ok).length || 0;
      const fail = result?.results?.filter((r) => !r.ok).length || 0;
      if (window.LGMDM?.ui?.showToast) {
        const msg = fail === 0
          ? `Cadena completada · ${ok} inserts OK`
          : `Cadena terminada · ${ok} OK · ${fail} con error`;
        window.LGMDM.ui.showToast(msg, fail === 0 ? 'success' : 'warning', 5000);
      }
      // Mostrar output de la cadena en el preview area (audio + descarga + A/B)
      if (result?.blob instanceof Blob && result.blob.size > 0 && ok > 0) {
        renderChainOutput(result.blob, f.name, result.results || []);
      }
      return result;
    }).catch((err) => {
      if (window.LGMDM?.ui?.showToast) {
        window.LGMDM.ui.showToast('Insert Rack falló: ' + (err?.message || err), 'error');
      }
      throw err;
    });
  };

  // Auto-mount si el DOM tiene el contenedor
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => mount(), { once: true });
  } else {
    mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
