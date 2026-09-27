// ============================================================
// 01-state.js — Estado global, cache de colores, tema, IA estado
// ============================================================
(function () {
  'use strict';
      // ── State ─────────────────────────────────────────────────────────────────────
      const MAX_FILE_BYTES = window.LGMDM?.config?.maxFileBytes ?? (200 * 1024 * 1024);
      const MAX_FILE_MB = window.LGMDM?.config?.maxFileMb ?? 200;

      // crypto.randomUUID() sólo existe en contextos seguros (HTTPS o localhost).
      // Serví por HTTP+IP (ej. http://104.128.64.125:5500) rompe esa función, así que
      // acá usamos randomUUID si está disponible y si no generamos un UUID v4 a mano.
      function genUUID() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
          return window.crypto.randomUUID();
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      }

      function formatDbValue(value, digits = 1) {
        const n = Number(value);
        if (!Number.isFinite(n)) return "—";
        return `${n >= 0 ? "+" : ""}${n.toFixed(digits)} dB`;
      }
      function formatLinearThresholdToDb(value, digits = 1) {
        const db = 20 * Math.log10(Math.max(Number(value), 1e-9));
        return `${db >= 0 ? "+" : ""}${db.toFixed(digits)} dB`;
      }

      let selectedFile = null;
      let cachedFileBuffer = null; // ArrayBuffer cacheado al seleccionar el archivo
      let _previewSessionId = null; // UUID que identifica el archivo actual en el caché del servidor
      let _previewLibraryId = null; // id del archivo en la librería persistente del servidor, si se eligió de ahí
      let currentJobId = null;
      let downloadUrl = null;
      // FIX MX-12 — stems separados (objeto {stemName: File|info, ...} + available[]).
      // Nullable hasta que el flujo de "Separar Stems" complete y emita `stems-loaded`.
      // Los widgets Pro (cross-demask, etc.) lo consultan para condicionar su UI.
      let _stems = null;

      // ── Cache de colores del tema ────────────────────────────────────────────────
      // Se cachean para evitar getComputedStyle() en cada frame de animación/canvas.
      // Se invalida reactivamente ante eventos 'themechange'.
      let _themeColorsCache = null;
      window.addEventListener("themechange", () => {
        _themeColorsCache = null;
      });

      const LEGACY_COLOR_MAP = {
        "--bg": "--ui-bg",
        "--bg-2": "--ui-surface",
        "--surface": "--ui-surface",
        "--surface2": "--ui-surface-2",
        "--surface3": "--ui-surface-3",
        "--glass": "--ui-panel",
        "--glass2": "--ui-panel-strong",
        "--border": "--ui-border",
        "--border2": "--ui-border-2",
        "--amber": "--ui-warn",
        "--amber2": "--ui-warn-2",
        "--amber-glow": "--ui-warn-glow",
        "--vu-green": "--ui-good",
        "--vu-yellow": "--ui-warn",
        "--clip-red": "--ui-danger",
        "--cyan": "--ui-accent",
        "--lilac": "--ui-accent-2",
        "--text": "--ui-text",
        "--muted": "--ui-muted",
        "--faint": "--ui-faint",
        "--accent": "--ui-accent",
        "--accent-2": "--ui-accent-2",
        "--green": "--ui-good",
        "--yellow": "--ui-warn",
        "--red": "--ui-danger",
      };

      function themeColors() {
        if (_themeColorsCache) return _themeColorsCache;
        const styles = getComputedStyle(document.documentElement);
        const read = (name) => styles.getPropertyValue(name).trim();
        _themeColorsCache = {
          bg: read("--ui-bg"),
          surface: read("--ui-surface"),
          surface2: read("--ui-surface-2"),
          surface3: read("--ui-surface-3"),
          border: read("--ui-border"),
          accent: read("--ui-accent"),
          accent2: read("--ui-accent-2"),
          good: read("--ui-good"),
          warn: read("--ui-warn"),
          danger: read("--ui-danger"),
          text: read("--ui-text"),
          muted: read("--ui-muted"),
          faint: read("--ui-faint"),
          panel: read("--ui-panel"),
          panelStrong: read("--ui-panel-strong"),
          get: (varName) => {
            if (!varName) return "";
            const key = varName.startsWith("--") ? varName : `--${varName}`;
            const mapped = LEGACY_COLOR_MAP[key] || key;
            return read(mapped) || read(key);
          },
        };
        return _themeColorsCache;
      }

      // ── Nombre del tema para la descarga ────────────────────────────────────────
      function currentTrackNameParam() {
        const input = window.LGMDM?.dom?.byId?.("trackNameInput");
        const val = ((input && input.value) || "").trim();
        return val ? `?name=${encodeURIComponent(val)}` : "";
      }
      function getTrackBaseName() {
        const input = window.LGMDM?.dom?.byId?.("trackNameInput");
        const val = ((input && input.value) || "").trim();
        if (val) return val;
        if (selectedFile) return selectedFile.name.replace(/\.[^/.]+$/, "");
        return "reporte";
      }
      async function downloadReport(jobId) {
        try {
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/report/${jobId}`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = `${getTrackBaseName()}_reporte.json`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch (e) {
          window.LGMDM?.errors?.handleClientError?.(e, "No se pudo descargar el reporte.", { context: "report-download" });
        }
      }
      function prefillTrackNameFromFile() {
        const input = window.LGMDM?.dom?.byId?.("trackNameInput");
        if (!input || input.value.trim() || !selectedFile) return;
        const base = selectedFile.name.replace(/\.[^/.]+$/, "");
        input.value = base;
      }
      let previewDebounceTimer = null,
        previewAbortController = null,
        previewAudioUrl = null,
        previewWS = null;
      let metersAudioCtx = null,
        metersSourceNode = null,
        metersAnalyserL = null,
        metersAnalyserR = null,
        metersRafId = null,
        metersSplitter = null;
      let metersLufsRingBuffer = [];
      const METERS_LUFS_WINDOW = 60;

      // ── Asistente de IA: estado ─────────────────────────────────────────────────
      let lastAnalysisData = null; // último dict de análisis (lufs, peak_db, spectrum, mix_advice, ...)
      let aiChatHistory = []; // [{role:'user'|'assistant', content:str}, ...]
      let aiAvailable = null; // null=sin chequear, true/false luego de /ai/status

      // Single source of truth: window.LGMDM.state.*
      // Auditoría 2026-09-18 eliminó el puente SHARED_KEYS → window.*
      // (ningún módulo activo leía window.selectedFile / window.lastAnalysisData
      //  directamente; antes de eliminarlo, se buscó exhaustivamente).
      // Para consumir estado: window.LGMDM.state.selectedFile (getter/setter
      // via Object.defineProperty). Backward compat removida en Fase 5.
      const _publicState = window.LGMDM?.state || (window.LGMDM = window.LGMDM || {}, window.LGMDM.state = {});
      _publicState.reference = _publicState.reference || { file: null, libraryId: null };
      _publicState.runtime = _publicState.runtime || { preview: {}, reference: _publicState.reference, audio: {} };
      _publicState.jobs = _publicState.jobs || {
        mastering: { jobId: null, downloadUrl: null },
        reference: { jobId: null, downloadUrl: null }
      };
      Object.defineProperty(_publicState, "selectedFile", {
        get: () => selectedFile,
        set: (value) => {
          selectedFile = value;
        },
        configurable: true
      });
      Object.defineProperty(_publicState, "lastAnalysisData", { get: () => lastAnalysisData, set: (value) => { lastAnalysisData = value; }, configurable: true });
      // FIX MX-12 — stems: getter/setter autoritativo. La asignación dispara
      // el evento `stems-loaded` para que widgets Pro (cross-demask, etc.)
      // actualicen su UI sin polling ni MutationObserver explícito.
      Object.defineProperty(_publicState, "stems", {
        get: () => _stems,
        set: (value) => {
          _stems = value;
          // FIX MX-12 — siempre notificamos (load y unload). El flag `loaded`
          // en el detail permite a los consumidores diferenciar la transición
          // sin necesidad de comparar el estado anterior.
          const loaded = !!(value && (value.available?.length || Object.keys(value.stems || {}).length));
          window.dispatchEvent(new CustomEvent('stems-loaded', { detail: { stems: value, loaded } }));
        },
        configurable: true,
      });
      _publicState.setStems = function setStems(payload) {
        // Helper canónico para que el flujo de separación (07-mastering-actions.js)
        // pueble el state de forma uniforme. `payload` puede ser:
        //   { stems: {vocals: {..}, ...}, available: ['vocals','drums',...] }
        // Acepta también un array (legacy): se mapea a { stems: {}, available: [...] }
        let next = null;
        if (payload == null) {
          next = null;
        } else if (Array.isArray(payload)) {
          next = { stems: {}, available: payload.slice() };
        } else if (typeof payload === 'object') {
          next = {
            stems: payload.stems && typeof payload.stems === 'object' ? payload.stems : {},
            available: Array.isArray(payload.available) ? payload.available.slice() : Object.keys(payload.stems || {}),
          };
        }
        _publicState.stems = next;
        return _publicState.stems;
      };
      _publicState.clearStems = function clearStems() {
        _publicState.stems = null;
      };
      _publicState.getSelectedFile = function getSelectedFile() {
        return selectedFile ?? null;
      };
      _publicState.getLastAnalysis = function getLastAnalysis() {
        return lastAnalysisData ?? null;
      };
      // Cross-script bridges for plain `<script>` consumers (non-module scope sharing).
      _publicState.cachedFileBuffer = _publicState.cachedFileBuffer || null;
      _publicState.metersRafId = _publicState.metersRafId || null;
      _publicState.metersAudioCtx = _publicState.metersAudioCtx || null;
      _publicState.metersSourceNode = _publicState.metersSourceNode || null;
      _publicState._previewLibraryId = _publicState._previewLibraryId || null;
      _publicState._previewSessionId = _publicState._previewSessionId || null;
      _publicState.previewAudioUrl = _publicState.previewAudioUrl || null;
      _publicState.masteringPollInterval = _publicState.masteringPollInterval || null;
      _publicState.referencePollInterval = _publicState.referencePollInterval || null;
      _publicState.downloadUrl = _publicState.downloadUrl || null;

      // Single source of truth: los consumidores leen/escriben vía
      // window.LGMDM.state.* o window.LGMDM.state.<key>. No hay SHARED_KEYS
      // puente a window.* — auditoría 2026-09-18 detectó que ningún módulo
      // activo lee window.selectedFile / window.lastAnalysisData / etc.
      // directamente (grep -rn sobre /frontend/js/ sin resultados).

      _publicState.downloadReport = downloadReport;
      window.downloadReport = downloadReport;

      // Expose utility functions + theme colors to consumers
      window.LGMDM = window.LGMDM || {};
      window.LGMDM.formatters = Object.freeze({
        formatDbValue, formatLinearThresholdToDb, genUUID,
        getTrackBaseName, currentTrackNameParam, prefillTrackNameFromFile,
      });
      window.LGMDM.themeColors = themeColors;
      window.formatDbValue = formatDbValue;
      window.formatLinearThresholdToDb = formatLinearThresholdToDb;
      window.genUUID = genUUID;
      window.getTrackBaseName = getTrackBaseName;
      window.currentTrackNameParam = currentTrackNameParam;
      window.prefillTrackNameFromFile = prefillTrackNameFromFile;
      window.themeColors = themeColors;

      // ── Sliders ──────────────────────────────────────────────────────────────────

})();
