// reference-library-picker.js
// Selector de referencias permanentes desde /reference-library
// Integrar al final de 08-reference-mastering.js o cargarlo como script separado.

(function (global) {
  "use strict";
  const LGMDM = global.LGMDM = global.LGMDM || {};
  const bindOnce = LGMDM.ui?.bindOnce || ((el, type, fn, key, opts) => { el?.addEventListener(type, fn, opts); return true; });
  // ── Estado ────────────────────────────────────────────────────────────────
  let _entries = [];       // lista de referencias indexadas
  let _filtered = [];      // resultado del filtro de búsqueda
  let _selected = null;    // entry seleccionada actualmente

  // ── Elementos DOM (se crean al llamar init()) ─────────────────────────────
  let _modal, _searchInput, _listEl, _statusEl;

  // ── Cargar índice desde el servidor ──────────────────────────────────────
  async function loadLibrary({retryOnAuth=false} = {}) {
    // Nunca disparamos una llamada protegida sin sesión disponible.
    const token = LGMDM.api.authToken();
    if (!token) {
      if (_statusEl) _statusEl.textContent = "Iniciá sesión para cargar la biblioteca.";
      return;
    }
    try {
      const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/reference-library`);
      if (res.status === 401 && retryOnAuth) {
        await new Promise(r => setTimeout(r, 100));
        return loadLibrary({retryOnAuth:false});
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      _entries = data.entries || [];
      _filtered = [..._entries];
      _renderList();
      if (_entries.length) {
        _statusEl.innerHTML = `<span role="status">${_entries.length} referencia${_entries.length !== 1 ? "s" : ""} disponible${_entries.length !== 1 ? "s" : ""}</span>`;
      } else {
        _statusEl.innerHTML = `
          <div class="empty-state" role="status">
            <div class="empty-state-icon" aria-hidden="true">📂</div>
            <h3>La biblioteca de referencias está vacía</h3>
            <p>Poné tus tracks en la carpeta <code>reference_library/</code> del servidor. Se indexan automáticamente.</p>
            <button class="btn btn-secondary" type="button" id="refLibEmptyRescan">↺ Re-escanear</button>
          </div>`;
        _statusEl.querySelector("#refLibEmptyRescan")?.addEventListener("click", async () => {
          _statusEl.innerHTML = '<div class="skeleton-loader"><div class="skeleton-line skeleton-line--md"></div></div>';
          try {
            await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/reference-library/rescan`, { method: "POST" });
            await loadLibrary();
          } catch (e) {
            _statusEl.textContent = "Error: " + e.message;
          }
        });
      }
    } catch (e) {
      _statusEl.innerHTML = `
        <div class="empty-state" role="alert">
          <div class="empty-state-icon" aria-hidden="true">⚠</div>
          <h3>Error cargando la biblioteca</h3>
          <p>${LGMDM.ui.escapeHtml?.(e.message ?? String(e)) ?? "Error desconocido"}</p>
          <button class="btn btn-secondary" type="button" id="refLibRetryBtn">Reintentar</button>
        </div>`;
      _statusEl.querySelector("#refLibRetryBtn")?.addEventListener("click", () => loadLibrary({retryOnAuth: true}));
    }
  }

  // ── Filtrar por búsqueda ──────────────────────────────────────────────────
  function _applySearch(q) {
    q = q.trim().toLowerCase();
    _filtered = q
      ? _entries.filter((e) => e.filename.toLowerCase().includes(q))
      : [..._entries];
    _renderList();
  }

  // ── Renderizar lista ──────────────────────────────────────────────────────
  function _renderList() {
    _listEl.innerHTML = "";
    if (!_filtered.length) {
      _listEl.innerHTML = `<div class="lgjs-centered-empty">Sin resultados</div>`;
      return;
    }
    _filtered.forEach((entry) => {
      const isSelected = _selected && _selected.id === entry.id;
      const dur = entry.duration_sec != null
        ? Math.floor(entry.duration_sec / 60) + ":" + String(Math.floor(entry.duration_sec % 60)).padStart(2, "0")
        : "--";
      const lufs = entry.lufs != null ? entry.lufs.toFixed(1) + " LUFS" : "--";
      const peak = entry.peak_db != null ? entry.peak_db.toFixed(1) + " dBFS" : "--";

      const row = document.createElement("div");
      row.className = "ref-lib-row" + (isSelected ? " ref-lib-row--selected" : "");
      const nameEl = document.createElement("div");
      nameEl.className = "ref-lib-name";
      nameEl.textContent = entry.filename || "Referencia sin nombre";
      const metaEl = document.createElement("div");
      metaEl.className = "ref-lib-meta";
      for (const value of [dur, lufs, peak, entry.sr ? (entry.sr / 1000).toFixed(1) + "kHz" : ""]) {
        const span = document.createElement("span");
        span.textContent = value;
        metaEl.appendChild(span);
      }
      row.append(nameEl, metaEl);
      bindOnce(row, "click", () => _selectEntry(entry), `ref-row-${entry.id}`);
      _listEl.appendChild(row);
    });
  }

  // ── Seleccionar una referencia ────────────────────────────────────────────
  function _selectEntry(entry) {
    _selected = entry;

    // Actualizar variable global que usa 08-reference-mastering.js
    LGMDM.state = LGMDM.state || {}; LGMDM.state.reference = LGMDM.state.reference || { file: null, libraryId: null };
    LGMDM.state.reference.libraryId = entry.id;
    LGMDM.state.reference.file = null;       // anular el File subido a mano

    // Mostrar nombre seleccionado en el label del input de referencia
    const label = document.getElementById("refFileLabel") || document.getElementById("ref-file-label") || document.getElementById("refFileName");
    if (label) label.textContent = "📌 " + entry.filename;

    // Invalidar caché de sesión del WS de ref-preview
    if (typeof LGMDM.reference?.onRefFileSelected === "function") LGMDM.reference?.onRefFileSelected();

    // Cerrar modal
    _closeModal();

    // Actualizar botón de preview/submit
    if (typeof LGMDM.reference?.updateRefPreviewBtn === "function") LGMDM.reference.updateRefPreviewBtn();
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function _buildModal() {
    if (_modal) return;
    _modal = document.createElement("div");
    _modal.id = "refLibModal";
    _modal.innerHTML = `
      <div class="ref-lib-backdrop"></div>
      <div class="ref-lib-dialog">
        <div class="ref-lib-header">
          <span>📚 Biblioteca de referencias</span>
          <button class="ref-lib-close" id="refLibClose" title="Cerrar">✕</button>
        </div>
        <div class="ref-lib-toolbar">
          <input type="text" id="refLibSearch" placeholder="Buscar por nombre…" autocomplete="off" />
          <button class="btn btn-secondary btn-sm" id="refLibRescan" title="Re-escanear carpeta">↺ Actualizar</button>
        </div>
        <div class="ref-lib-status" id="refLibStatus" role="status" aria-live="polite">
          <div class="skeleton-loader" aria-busy="true" aria-label="Cargando biblioteca">
            <div class="skeleton-line skeleton-line--lg"></div>
            <div class="skeleton-line skeleton-line--md"></div>
            <div class="skeleton-line skeleton-line--sm"></div>
          </div>
        </div>
        <div class="ref-lib-list" id="refLibList"></div>
        <div class="ref-lib-footer">
          <span class="lgjs-s-8e359722">
            Poné tus tracks de referencia en <code>reference_library/</code> en el servidor.
            Se indexan automáticamente.
          </span>
        </div>
      </div>
    `;
    document.body.appendChild(_modal);

    _searchInput = _modal.querySelector("#refLibSearch");
    _listEl      = _modal.querySelector("#refLibList");
    _statusEl    = _modal.querySelector("#refLibStatus");

    bindOnce(_modal.querySelector("#refLibClose"), "click", _closeModal, "ref-lib-close");
    bindOnce(_modal.querySelector(".ref-lib-backdrop"), "click", _closeModal, "ref-lib-backdrop-close");
    bindOnce(_searchInput, "input", (e) => _applySearch(e.target.value), "ref-lib-search");
    bindOnce(_modal.querySelector("#refLibRescan"), "click", async () => {
      _statusEl.textContent = "Re-escaneando…";
      try {
        await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/reference-library/rescan`, { method: "POST" });
        await loadLibrary();
      } catch (e) {
        _statusEl.textContent = "Error: " + e.message;
      }
    }, "ref-lib-rescan");

  }

  function _openModal() {
    _buildModal();
    _modal.style.display = "flex";
    if (!_modal.hasAttribute('role')) _modal.setAttribute('role', 'dialog');
    if (!_modal.hasAttribute('aria-modal')) _modal.setAttribute('aria-modal', 'true');
    window.LGMDM.ui.openModal({
      modalEl: _modal,
      openerEl: document.getElementById('btnOpenRefLib') || document.activeElement,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { if (_modal) _modal.style.display = "none"; },
    });
    _searchInput.value = "";
    _filtered = [..._entries];
    _renderList();
    loadLibrary({retryOnAuth:true});
  }

  function _closeModal() {
    if (!_modal) return;
    window.LGMDM.ui.closeModal(_modal);
    _modal.style.display = "none";
  }

  // ── Botón que abre el modal (se inserta junto al input de referencia) ──────
  function _injectButton() {
    let btn = document.getElementById("btnOpenRefLib");
    if (btn) {
      bindOnce(btn, "click", (e) => { e.preventDefault(); _openModal(); }, "ref-lib-open");
      return;
    }

    // Buscar el label/botón del archivo de referencia si no existe el botón estático
    const refInput = document.getElementById("refFileInput") || document.querySelector("input[id*='ref'][type='file']");
    if (!refInput) return;

    btn = document.createElement("button");
    btn.className = "btn btn-secondary btn-sm";
    btn.id = "btnOpenRefLib";
    btn.classList.add("ref-lib-open-button");
    btn.textContent = "📚 Elegir desde biblioteca de referencias";
    bindOnce(btn, "click", (e) => { e.preventDefault(); _openModal(); }, "ref-lib-open");

    // Insertar después del input de referencia (o su wrapper)
    const wrapper = refInput.closest(".file-drop-zone, .file-input-wrap, .param") || refInput.parentElement;
    wrapper.insertAdjacentElement("afterend", btn);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    _injectButton();
    // Solo pre-cargamos cuando hay sesión. Si el login ocurre después,
    // el evento de autenticación dispara la carga una sola vez.
    const maybeLoad = () => {
      const token = LGMDM.api.authToken();
      if (token) loadLibrary({retryOnAuth:true}).catch(() => {});
    };
    maybeLoad();
    bindOnce(window, "lgmdm:authenticated", maybeLoad, "reference-library-authenticated");
  }

  // Esperar a que el DOM esté listo
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 0);
  }

  // API pública (por si se necesita desde afuera)
  LGMDM.reference = LGMDM.reference || {};
  LGMDM.reference.libraryPicker = { open: _openModal, reload: loadLibrary };
})(window);
