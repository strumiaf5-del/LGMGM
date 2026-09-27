(function (global) {
  "use strict";
  const MAX_FILE_MB = window.LGMDM?.config?.maxFileMb ?? 200;
  const MAX_FILE_BYTES = (window.LGMDM?.config?.maxFileBytes ?? MAX_FILE_MB * 1024 * 1024);
  const LGMDM = global.LGMDM = global.LGMDM || {};
// ============================================================
// 04-file-handling.js — Carga de archivo, librería persistente, referencia
// ============================================================
      const dropZone = document.getElementById("dropZone");
      const fileInput = document.getElementById("fileInput");
      let uppy = null;
      if (window.Uppy && window.Uppy.Uppy && window.Uppy.FileInput) {
        if (fileInput) fileInput.style.pointerEvents = "none";
        uppy = new window.Uppy.Uppy({
          autoProceed: false,
          allowMultipleUploads: false,
          restrictions: { maxNumberOfFiles: 1, allowedFileTypes: ["audio/*"] },
        });
        uppy.use(window.Uppy.FileInput, {
          target: "#uppyPicker",
          pretty: true,
          locale: { filesSelected: { 0: "Elegir archivo", 1: "1 archivo seleccionado" } },
        });
        uppy.on("file-added", (file) => {
          if (file && file.data) setFile(file.data);
        });
      }
      const bindOnce = LGMDM.ui?.bindOnce || ((el, type, fn, key, opts) => { el?.addEventListener(type, fn, opts); return true; });
      bindOnce(dropZone, "dragover", (e) => {
        e.preventDefault();
        dropZone?.classList.add("dragover");
      });
      bindOnce(dropZone, "dragleave", () => dropZone.classList.remove("dragover"), "file-drop-leave");
      bindOnce(dropZone, "drop", (e) => {
        e.preventDefault();
        dropZone.classList.remove("dragover");
        if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]);
      }, "file-drop-drop");
      bindOnce(fileInput, "change", () => {
        if (fileInput.files[0]) setFile(fileInput.files[0]);
      }, "file-input-change");

      function setFile(f, libraryId = null) {
        const warn = document.getElementById("fileSizeWarn");
        if (f.size > MAX_FILE_BYTES) {
          if (warn) warn.textContent = `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo ${MAX_FILE_MB} MB`;
          return;
        }
        const ALLOWED_AUDIO_EXT = /\.(wav|mp3|flac|ogg|aif|aiff)$/i;
        if (!ALLOWED_AUDIO_EXT.test(f.name || '')) {
          if (typeof window.LGMDM?.ui?.showToast === 'function') {
            window.LGMDM.ui.showToast(`Formato no soportado: ${f.name || 'archivo sin extensión'}`, 'error', 5000);
          }
          if (warn) warn.textContent = `⚠ Formato no soportado: ${f.name || 'sin extensión'}`;
          return;
        }
        if (warn) warn.textContent = "";
        window.LGMDM.state.selectedFile = f;
                window.dispatchEvent(new CustomEvent("lgmdm:file-selected", { detail: { name: f.name, libraryId } }));

        // Un archivo nuevo invalida el análisis anterior. Evita que Control Room
        // muestre métricas del track previamente seleccionado.
        window.LGMDM.ai.setContext(null);

        window.LGMDM.state._previewSessionId = genUUID();
        window.LGMDM.state._previewLibraryId = libraryId;
        if (document.getElementById("fileName")) document.getElementById("fileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        ["btnMaster", "btnAnalyze", "btnAdvice", "btnAnalyzeGrid", "btnAdviceGrid", "btnSpectrum", "btnStems", "btnAB", "btnAutoMaster", "btnAiSuggest"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) el.disabled = false;
        });
        window.LGMDM.reference.updateButtonState();
        document.getElementById("btnDownload")?.style.setProperty("display", "none");
        document.getElementById("btnReport")?.style.setProperty("display", "none");
        const trackNameInputEl = document.getElementById("trackNameInput");
        if (trackNameInputEl) {
          trackNameInputEl.value = "";
          trackNameInputEl.style.display = "none";
        }
        LGMDM.ui.clearResults();

        window.LGMDM.state.cachedFileBuffer = null;
        if (window.LGMDM.state.previewAudioUrl) {
          URL.revokeObjectURL(window.LGMDM.state.previewAudioUrl);
          window.LGMDM.state.previewAudioUrl = null;
        }
        window.LGMDM?.previewController?.stop?.({ silent: true, cancelSource: true });
        if (document.getElementById("previewAudioWrap")) document.getElementById("previewAudioWrap").replaceChildren();
        window.LGMDM?.spectrum?.clear?.();
        setPreviewStatus("Preview deshabilitado");

        if (typeof window.LGMDM?.meters?.teardownLiveMeters === 'function') window.LGMDM.meters.teardownLiveMeters();

        loadFileBuffer(f);
        // Cargar un archivo NO inicia el preview automaticamente.
        // El preview solo arranca por accion explicita del usuario.

        // F3 — Auto-análisis server-side al cargar archivo. Alimenta meters
        // (peak/RMS/LUFS/TRUE_PEAK/CORR) y spectrum bars en el console vía
        // el bridge analysis-updated → LGMDM.metrics (Fix 2 en 10-meters-dashboard.js).
        if (typeof window.requestAnalysis === 'function') {
          window.requestAnalysis({ clear: false }).catch(() => {});
        }

        if (!libraryId && document.getElementById("saveToLibraryChk")?.checked) {
          uploadCurrentFileToLibrary(f);
        }
      }

      // ... resto del archivo sin cambios ...
      // ── Librería persistente (archivos guardados en el servidor) ────────────────
      async function refreshLibraryList() {
        const listEl = document.getElementById("libraryList");
        // V3 ya no renderiza la librería persistente en este módulo;
        // la UI de referencias se gestiona desde reference-library-picker.js.
        // Evitamos promesas rechazadas si el contenedor legacy no existe.
        if (!listEl) {
          return;
        }
        try {
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/library`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          renderLibraryList(data.files || []);
        } catch (e) {
          console.debug("[librería] error al listar:", e);
          if (listEl) {
            listEl.innerHTML = `
              <div class="empty-state" role="status">
                <div class="empty-state-icon" aria-hidden="true">⚠</div>
                <h3>No se pudo cargar la librería</h3>
                <p>${LGMDM.ui.escapeHtml?.(e.message ?? String(e)) ?? "Error desconocido"}</p>
                <button class="btn btn-secondary" type="button" id="libraryRetryBtn">Reintentar</button>
              </div>`;
            listEl.querySelector("#libraryRetryBtn")?.addEventListener("click", () => listLibrary());
          }
        }
      }

      function _formatLibraryDuration(sec) {
        if (sec == null) return "";
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60).toString().padStart(2, "0");
        return `${m}:${s}`;
      }

      function renderLibraryList(files) {
        const listEl = document.getElementById("libraryList");
        if (!listEl) return;
        if (!files.length) {
          listEl.innerHTML = `
            <div class="empty-state" role="status">
              <div class="empty-state-icon" aria-hidden="true">📁</div>
              <h3>Tu librería está vacía</h3>
              <p>Arrastrá un archivo acá o hacé click para seleccionar.</p>
              <p class="empty-state__hint">Formatos: WAV · MP3 · FLAC · OGG · AIFF · hasta 100 MB</p>
              <button class="btn btn-primary" type="button" id="emptyUploadBtn">Subir archivo de audio</button>
            </div>`;
          const btn = listEl.querySelector("#emptyUploadBtn");
          btn?.addEventListener("click", () => {
            const fi = document.getElementById("fileInput");
            if (fi) fi.click();
          });

          // F5.8 — Drop-zone visual para arrastrar archivos al área vacía.
          const empty = listEl.querySelector(".empty-state");
          if (empty) {
            const onOver = (e) => { e.preventDefault(); empty.classList.add("drop-zone-active"); };
            const onLeave = () => empty.classList.remove("drop-zone-active");
            const onDrop = (e) => {
              e.preventDefault();
              empty.classList.remove("drop-zone-active");
              const file = e.dataTransfer?.files?.[0];
              if (!file) return;
              const input = document.getElementById("fileInput");
              if (input) {
                try {
                  const dt = new DataTransfer();
                  dt.items.add(file);
                  input.files = dt.files;
                  input.dispatchEvent(new Event("change", { bubbles: true }));
                } catch (_) {
                  // Fallback: re-trigger upload via click().
                  input.click();
                }
              }
            };
            empty.addEventListener("dragover", onOver);
            empty.addEventListener("dragleave", onLeave);
            empty.addEventListener("drop", onDrop);
          }
          return;
        }
        listEl.innerHTML = "";
        for (const f of files) {
          const row = document.createElement("div");
          row.className = "library-row";
          const info = document.createElement("button");
          info.type = "button";
          info.className = "library-row__info";
          info.title = f.original_filename;
          info.textContent = `${f.original_filename} — ${_formatLibraryDuration(f.duration_sec)}`;
          info.addEventListener("click", () => useLibraryFile(f.id, f.original_filename));
          info.setAttribute("aria-label", `Usar referencia ${f.original_filename}`);
          const delBtn = document.createElement("button");
          delBtn.type = "button";
          delBtn.textContent = "🗑";
          delBtn.title = "Borrar de la librería";
          delBtn.setAttribute("aria-label", `Borrar ${f.original_filename} de la librería`);
          delBtn.style.cssText = "background:none;border:none;color:inherit;opacity:.6;cursor:pointer;flex-shrink:0;";
          delBtn.addEventListener("click", async (e) => {
            e.stopPropagation();
            if (!confirm(`¿Borrar "${f.original_filename}" de la librería?`)) return;
            await deleteLibraryFile(f.id);
          });
          row.appendChild(info);
          row.appendChild(delBtn);
          listEl.appendChild(row);
        }
      }

      async function uploadCurrentFileToLibrary(f) {
        try {
          const fd = new FormData();
          fd.append("file", f);
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/library/upload`, { method: "POST", body: fd });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          await refreshLibraryList();
        } catch (e) {
          // No es crítico para el flujo principal (mastering/preview siguen
          // funcionando con el archivo local) — solo se loguea.
          console.debug("[librería] error al guardar:", e);
        }
      }

      async function useLibraryFile(fileId, filename) {
        const listEl = document.getElementById("libraryList");
        try {
          setPreviewStatus("Trayendo archivo de la librería…");
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/library/${fileId}/download`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const file = new File([blob], filename, { type: blob.type });
          setFile(file, fileId); // libraryId != null → no se vuelve a subir en el preview
        } catch (e) {
          console.debug("[librería] error al usar archivo:", e);
          alert("No se pudo traer el archivo de la librería.");
        }
      }

      async function deleteLibraryFile(fileId) {
        try {
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/library/${fileId}`, { method: "DELETE" });
          if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
          await refreshLibraryList();
        } catch (e) {
          console.debug("[librería] error al borrar:", e);
        }
      }

      document.getElementById("btnRefreshLibrary")?.addEventListener("click", refreshLibraryList);
      // La librería es protegida: cargarla únicamente cuando exista sesión.
      // Si el módulo se inicializa antes del login, esperamos al evento de auth.
      const loadLibraryWhenAuthenticated = () => {
        if (!!LGMDM.api.authToken()) {
          refreshLibraryList();
        }
      };
      window.addEventListener("lgmdm:authenticated", refreshLibraryList);
      loadLibraryWhenAuthenticated();

      async function loadFileBuffer(f) {
        window.LGMDM.state.cachedFileBuffer = await f.arrayBuffer(); // cachear para reusar en previews
        const buf = await LGMDM.audio.decode(window.LGMDM.state.cachedFileBuffer);
        drawWaveform(buf);
        // Un único contexto Web Audio compartido; no crear/cerrar contextos locales.
      }

      // ── Referencia (track de referencia para matching) ──────────────────────────
      const referenceState = (window.LGMDM.state.reference || (window.LGMDM.state.reference = { file: null, libraryId: null }));
      const dropZoneRef = document.getElementById("dropZoneRef");
      const refFileInput = document.getElementById("refFileInput");
      bindOnce(dropZoneRef, "dragover", (e) => {
        e.preventDefault();
        dropZoneRef.classList.add("dragover");
      }, "ref-drop-dragover");
      bindOnce(dropZoneRef, "dragleave", () => dropZoneRef.classList.remove("dragover"), "ref-drop-leave");
      bindOnce(dropZoneRef, "drop", (e) => {
        e.preventDefault();
        dropZoneRef.classList.remove("dragover");
        if (e.dataTransfer.files[0]) setRefFile(e.dataTransfer.files[0]);
      }, "ref-drop-drop");
      bindOnce(refFileInput, "change", () => {
        if (refFileInput.files[0]) setRefFile(refFileInput.files[0]);
      }, "ref-file-change");

      function setRefFile(f, fromLibraryId = null) {
        if (f.size > MAX_FILE_BYTES) {
          if (document.getElementById("refFileName")) document.getElementById("refFileName").textContent =
            `⚠ Archivo de ${(f.size / 1024 / 1024).toFixed(1)} MB — máximo ${MAX_FILE_MB} MB`;
          return;
        }
        referenceState.file = f;
        referenceState.libraryId = fromLibraryId || null;
        if (document.getElementById("refFileName")) document.getElementById("refFileName").textContent = `${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)`;
        window.LGMDM.reference.updateButtonState();
        // Si viene de la librería, no hay nada que subir/guardar de nuevo.
        if (!fromLibraryId && document.getElementById("saveRefToLibraryChk")?.checked) {
          uploadRefFileToLibrary(f);
        }
      }
      const referenceApi = window.LGMDM.reference = window.LGMDM.reference || {};
      referenceApi.updateButtonState = function updateRefButtonState() {
        const button = document.getElementById("btnMasterRef");
        if (button) button.disabled = !(window.LGMDM.state.selectedFile && referenceState.file);
      };

      async function uploadRefFileToLibrary(f) {
        if (typeof LGMDM.library?.saveLocalFile === 'function') {
          await LGMDM.library.saveLocalFile(f, { kind: 'reference' });
        }
      }

      // La selección de referencias persistentes en V3 está centralizada en
      // reference-library-picker.js; no mantener aquí el handler legacy que
      // dependía de #toggleRefLibraryList/#libraryListRef.

      // ── EQ Curve ─────────────────────────────────────────────────────────────────

  // ── Library Service (migrado desde 00-library-service.js) ───────────
  const library = LGMDM.library = LGMDM.library || {};
  if (typeof library.saveLocalFile !== 'function') {
    library.saveLocalFile = async function saveLocalFile(file, options = {}) {
      if (!(file instanceof File)) throw new TypeError('saveLocalFile requiere un File');
      const form = new FormData();
      form.append('file', file);
      const response = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/library/upload`, { method: 'POST', body: form });
      if (!response.ok) {
        const error = new Error(`HTTP ${response.status}`);
        error.status = response.status;
        throw error;
      }
      const payload = await response.json().catch(() => ({}));
      global.dispatchEvent(new CustomEvent('lgmdm:library-updated', { detail: { kind: options.kind || 'track', file: file.name, payload } }));
      return payload;
    };
  }

})(window);
