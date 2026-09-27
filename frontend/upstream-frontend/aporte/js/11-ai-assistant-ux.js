(function(global){
  "use strict";
  const LGMDM = global.LGMDM = global.LGMDM || {};
// ============================================================
// ============================================================

aiRequired("metersToggle", "11-ai-assistant-ux:meters").addEventListener("click", () => {
  const body = aiRequired("metersBody", "11-ai-assistant-ux:meters");
  const toggle = aiRequired("metersToggle", "11-ai-assistant-ux:meters");
  const hidden = body.style.display === "none";
  body.style.display = hidden ? "block" : "none";
  toggle.textContent = hidden ? "ocultar" : "mostrar";
  toggle.setAttribute("aria-expanded", String(hidden));
});

window.addEventListener("beforeunload", () => {
  LGMDM.meters?.stopDashboard?.();
  LGMDM.meters?.teardownLiveMeters?.();
  try { window.LGMDM?.spectrum?.clear?.(); } catch (e) {}
});

// ═══════════════════════════════════════════════════════════════
// ── Asistente de IA (estilo LANDR AI) ────────────────────────
// ═══════════════════════════════════════════════════════════════

const AI_SUGGESTIONS = [
  "🤖 Masterizá esto por mí",
  "¿Cómo está el loudness de mi track?",
  "¿Qué preset me conviene?",
  "¿Tengo problemas de clipping?",
];

function aiEl(id) {
  return document.getElementById(id);
}

function aiRequired(id, owner = "11-ai-assistant-ux") {
  return LGMDM.dom.requireById(id, owner);
}


function setContext(analysisData) {
  window.LGMDM.state.lastAnalysisData = analysisData || null;
  window.dispatchEvent(new CustomEvent("analysis-updated", { detail: window.LGMDM.state.lastAnalysisData }));

  const fab = aiEl("aiFab");
  if (!fab) return;
  fab.classList.toggle("has-context", Boolean(window.LGMDM.state.lastAnalysisData));
}

function aiCurrentPreset() {
  const active = document.querySelector(".preset-btn.active");
  return active ? active.dataset.preset : null;
}

function aiCurrentPlatform() {
  const sel = aiEl("s-platform");
  return sel && sel.value ? sel.value : null;
}

function aiAppendMessage(role, content) {
  const wrap = aiRequired("aiMessages");
  const div = document.createElement("div");
  div.className = `ai-msg ${role}`;
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function aiAppendSuggestionCard(suggestedParams, summary, explanation) {
  const wrap = aiRequired("aiMessages");
  const card = document.createElement("div");
  card.className = "ai-suggestion-card";

  if (summary) {
    const title = document.createElement("div");
    title.className = "ai-suggestion-card-title";
    title.textContent = summary;
    card.appendChild(title);
  }

  if (explanation) {
    const explain = document.createElement("div");
    explain.className = "ai-suggestion-explanation";
    explain.textContent = explanation;
    card.appendChild(explain);
  }

  const list = document.createElement("ul");
  list.className = "ai-suggestion-card-list";
  Object.entries(suggestedParams).forEach(([key, value]) => {
    const li = document.createElement("li");
    const label = PARAM_LABELS[key] || key;
    let valueText;
    if (typeof value === "boolean") {
      valueText = value ? "activado" : "desactivado";
    } else if (typeof value === "string") {
      valueText = value;
    } else {
      valueText = formatParamValue(value, key);
    }
    const labelEl = document.createElement("span");
    labelEl.className = "ai-suggestion-param";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.className = "ai-suggestion-value";
    valueEl.textContent = valueText;
    li.append(labelEl, valueEl);
    list.appendChild(li);
  });
  card.appendChild(list);

  const actions = document.createElement("div");
  actions.className = "ai-suggestion-card-actions";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "ai-suggestion-cancel-btn";
  cancelBtn.textContent = "Cancelar";
  cancelBtn.addEventListener("click", () => {
    card.remove();
  });
  actions.appendChild(cancelBtn);

  const applyBtn = document.createElement("button");
  applyBtn.className = "ai-suggestion-apply-btn";
  applyBtn.textContent = "Confirmar cambios";
  applyBtn.addEventListener("click", () => {
    applyPresetToUI(suggestedParams);
    activePreset = null;
    document.querySelectorAll(".preset-btn").forEach((b) => b.classList.remove("active"));
    applyBtn.textContent = "✓ Aplicado";
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    card?.classList.add("applied");
  });
  actions.appendChild(applyBtn);
  card.appendChild(actions);

  wrap.appendChild(card);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiAppendNote(content) {
  const wrap = aiRequired("aiMessages");
  const div = document.createElement("div");
  div.className = "ai-msg system-note";
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiShowTyping() {
  const wrap = aiRequired("aiMessages");
  const div = document.createElement("div");
  div.className = "ai-msg assistant typing";
  div.id = "aiTypingIndicator";
  div.innerHTML = "<span></span><span></span><span></span>";
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiHideTyping() {
  const el = aiEl("aiTypingIndicator");
  if (el) el.remove();
}

function aiRenderSuggestions() {
  const box = aiRequired("aiSuggestions");
  box.innerHTML = "";
  AI_SUGGESTIONS.forEach((s) => {
    const btn = document.createElement("button");
    btn.className = "ai-suggestion-btn";
    btn.textContent = s;
    if (!btn || !box) return;
  btn.addEventListener("click", () => {
      if (s.includes("Masterizá esto por mí")) {
        if (!window.LGMDM.state.selectedFile) {
          aiAppendNote("Primero subí un archivo de audio para poder masterizarlo.");
          return;
        }
        document.getElementById("btnAutoMaster").click();
        return;
      }
      aiEl("aiInput").value = s;
      aiSendMessage();
    });
    box.appendChild(btn);
  });
}

async function aiCheckStatus() {
  try {
    const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/ai/status`);
    const data = await res.json();
    aiAvailable = !!data.available;
    aiRequired("aiStatusLine", "11-ai-assistant-ux:status").textContent = aiAvailable
      ? window.LGMDM.state.lastAnalysisData
        ? "Analizando tu track"
        : "Listo para ayudarte"
      : "No configurado";
    aiRequired("aiSend", "11-ai-assistant-ux:status").disabled = !aiAvailable;
    if (!aiAvailable) {
      aiAppendNote(data.reason || "El asistente de IA no está configurado en el backend (falta GEMINI_API_KEY).");
    }
  } catch (e) {
    aiAvailable = false;
    aiRequired("aiStatusLine", "11-ai-assistant-ux:status").textContent = "Sin conexión al backend";
    aiRequired("aiSend", "11-ai-assistant-ux:status").disabled = true;
    aiAppendNote("No se pudo conectar con el backend (" + LGMDM.api.apiBase() + ") para consultar el asistente.");
  }
}

async function aiSendMessage() {
  const input = aiRequired("aiInput", "11-ai-assistant-ux:send");
  const send = aiRequired("aiSend", "11-ai-assistant-ux:send");
  const suggestions = aiRequired("aiSuggestions", "11-ai-assistant-ux:send");
  const msg = input.value.trim();
  if (!msg || send.disabled) return;
  input.value = "";
  input.style.height = "auto";
  aiAppendMessage("user", msg);
  suggestions.replaceChildren();
  aiShowTyping();
  send.disabled = true;

  try {
    const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/ai/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: msg,
        history: aiChatHistory,
        analysis: window.LGMDM.state.lastAnalysisData,
        preset: aiCurrentPreset(),
        platform: aiCurrentPlatform(),
      }),
    });
    aiHideTyping();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    aiAppendMessage("assistant", data.reply);
    if (data.suggested_params && Object.keys(data.suggested_params).length) {
      aiAppendSuggestionCard(data.suggested_params, data.suggestion_summary, data.suggestion_explanation);
    }
    aiChatHistory.push({ role: "user", content: msg });
    aiChatHistory.push({ role: "assistant", content: data.reply });
  } catch (e) {
    aiHideTyping();
    console.debug("Error en /ai/chat:", e);
    aiAppendNote("Error consultando al asistente: " + e.message);
    // F5.14 — Retry button en error.
    const wrap = aiRequired("aiMessages");
    const retryDiv = document.createElement("div");
    retryDiv.className = "ai-msg system-note";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-secondary btn-sm";
    btn.textContent = "↺ Reintentar";
    btn.style.marginLeft = "8px";
    btn.addEventListener("click", () => {
      input.value = msg;
      retryDiv.remove();
      aiSendMessage();
    });
    retryDiv.appendChild(btn);
    wrap.appendChild(retryDiv);
  } finally {
    send.disabled = false;
  }
}

aiEl("aiFab")?.addEventListener("click", () => {
  const panel = aiRequired("aiPanel", "11-ai-assistant-ux:toggle");
  const fab = document.getElementById("aiFab");
  const opening = !panel.classList.contains("open");
  panel.classList.toggle("open");
  if (fab) fab.setAttribute("aria-expanded", String(opening));
  if (opening) {
    if (!panel.hasAttribute("role")) panel.setAttribute("role", "dialog");
    if (!panel.hasAttribute("aria-modal")) panel.setAttribute("aria-modal", "true");
    window.LGMDM.ui.openModal({
      modalEl: panel,
      openerEl: document.getElementById("aiFab") || document.activeElement,
      closeOnBackdrop: false,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { panel.classList.remove("open"); },
    });
    if (aiAvailable === null) {
      aiAppendMessage(
        "assistant",
        "¡Hola! Soy tu asistente de mastering. Puedo analizar tu track y darte consejos, o directamente masterizarlo por vos: elijo preset, plataforma target y ajustes de nivel según el análisis técnico. ¿En qué te ayudo?",
      );
      aiRenderSuggestions();
      aiCheckStatus();
    }
    aiRequired("aiInput", "11-ai-assistant-ux:toggle").focus();
  } else {
    window.LGMDM.ui.closeModal(panel);
  }
});

aiEl("aiClose")?.addEventListener("click", () => {
  const panel = aiRequired("aiPanel", "11-ai-assistant-ux:close");
  window.LGMDM.ui.closeModal(panel);
  panel.classList.remove("open");
  const fab = document.getElementById("aiFab");
  if (fab) fab.setAttribute("aria-expanded", "false");
});
aiEl("aiSend")?.addEventListener("click", aiSendMessage);
aiEl("aiInput")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    aiSendMessage();
  }
});
aiEl("aiInput")?.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = Math.min(this.scrollHeight, 96) + "px";
});

// ── Sidebar tabs ──────────────────────────────────────────────
// FIX: tab click handler removed — 22-tabs-handler.js is the authoritative
// sidebar navigation. The previous in-file handler referenced an undeclared
// `container` variable (line 316) which threw ReferenceError on every click
// and stopped the Cadena/Salida/Mixer panes from ever becoming visible.
(function () {
  const paso1 = document.getElementById("pasoArchivo");
  const paso2 = document.getElementById("pasoCadena");
  const paso3 = document.getElementById("pasoSalida");
  if (paso1) paso1.setAttribute("open", "");
  if (paso2) paso2.removeAttribute("open");
  if (paso3) paso3.removeAttribute("open");
})();

(function () {
  const aside = document.querySelector("aside");
  const hint = document.getElementById("asideScrollHint");
  if (!aside || !hint) return;
  function updateScrollHint() {
    const atBottom = aside.scrollHeight - aside.scrollTop - aside.clientHeight < 20;
    hint.classList.toggle("hidden", atBottom);
  }
  aside.addEventListener("scroll", updateScrollHint, { passive: true });
  updateScrollHint();
  new ResizeObserver(updateScrollHint).observe(aside);
})();

(function () {
  const secondaryBtns = ["btnAutoMaster", "btnAiSuggest", "btnAnalyze", "btnAdvice", "btnAnalyzeGrid", "btnAdviceGrid", "btnSpectrum", "btnStems", "btnAB"];
  const observer = new MutationObserver(() => {
    if (window.LGMDM.state.selectedFile) {
      secondaryBtns.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = "";
      });
    }
  });
  const masterBtn = document.getElementById("btnMaster");
  if (masterBtn) {
    observer.observe(masterBtn, { attributes: true, attributeFilter: ["disabled"] });
  }
})();

// Se eliminó la línea que hacía referencia a window._origSetFile
(function(){
  const LG = window.LGMDM = window.LGMDM || {};
  LG.ai = Object.assign(LG.ai || {}, { setContext });
  LG.analysis = Object.assign(LG.analysis || {}, {
    async request() {
      const file = window.LGMDM?.state?.selectedFile;
      if (!file) {
        window.LGMDM?.ui?.showStatus?.(null, "Cargá un archivo antes de analizar.", "error");
        return null;
      }
      const fd = new FormData();
      fd.append("file", file);
      const libId = window.LGMDM?.state?._previewLibraryId;
      if (libId) fd.append("library_id", libId);
      try {
        const res = await window.LGMDM.api.apiFetch("/analysis/analyze", { method: "POST", body: fd });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (data?.analysis) window.LGMDM.ai?.setContext?.(data.analysis);
        return data;
      } catch (e) {
        if (e?.name === 'AbortError') {
          console.debug('[analysis] request cancelado por el usuario:', e);
          throw e;
        }
        console.debug("[analysis] request failed:", e);
        window.LGMDM?.ui?.showStatus?.(null, "Error: " + e.message, "error");
        throw e;
      }
    },
  });
})();

// 07-mastering-actions.js corre fuera de este IIFE y llama a estas
// funciones directamente (sin prefijo LGMDM.ai.), asi que quedan
// expuestas tambien como globales.
Object.assign(global, {
  aiEl,
  aiAppendMessage,
  aiAppendNote,
  aiShowTyping,
  aiHideTyping,
  aiCurrentPreset,
  aiCurrentPlatform,
  aiRenderSuggestions,
  aiAppendSuggestionCard,
});

})(window);
