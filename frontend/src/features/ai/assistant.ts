// features/ai/assistant.ts — Asistente de IA (estilo LANDR AI).
//
// FIX vs aporte: tipos TS.
// FIX vs aporte: HMR-safe (`window.LGMDM.aiAssistantBound`).
// FIX vs aporte: AbortController + cleanup.
// FIX vs aporte: `/analysis/analyze` corregido a `/analysis` (matchea backend).

interface StateShape {
  selectedFile?: File | null;
  lastAnalysisData?: Record<string, unknown> | null;
  _previewLibraryId?: string | null;
}

interface ApiShape {
  apiBase: () => string;
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  // FIX K4: client.* retorna Promise<Response> real (para res.ok/.json/.blob/.headers).
  client: {
    get: (endpoint: string, options?: RequestInit) => Promise<Response>;
    post: (endpoint: string, options?: RequestInit) => Promise<Response>;
    put: (endpoint: string, options?: RequestInit) => Promise<Response>;
    patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
    delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
  };
}

interface UiShape {
  openModal?: (opts: Record<string, unknown>) => void;
  closeModal?: (el: HTMLElement) => void;
  showStatus?: (container: unknown, msg: string, kind: string) => void;
  showToast?: (msg: string, kind: string, ms?: number) => void;
}

// FIX A2: requireById vive en lg().dom (core/dom.ts:118), NO en lg().ui.
interface DomShape {
  requireById: <T extends HTMLElement = HTMLElement>(id: string, owner?: string) => T;
  byId?: <T extends HTMLElement = HTMLElement>(id: string) => T | null;
  cachedEl?: <T extends HTMLElement = HTMLElement>(id: string) => T | null;
}

interface AiShape {
  setContext: (data: Record<string, unknown> | null) => void;
}

interface AnalysisShape {
  request?: () => Promise<{ analysis?: Record<string, unknown> } | null>;
}

const AI_SUGGESTIONS = [
  '🤖 Masterizá esto por mí',
  '¿Cómo está el loudness de mi track?',
  '¿Qué preset me conviene?',
  '¿Tengo problemas de clipping?',
];

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  state?: StateShape;
  api?: ApiShape;
  ui?: UiShape;
  dom?: DomShape;
  ai?: AiShape;
  analysis?: AnalysisShape;
};

const PARAM_LABELS: Record<string, string> = {
  ingain: 'Input gain',
  thresh: 'Threshold',
  ratio: 'Ratio',
  cattack: 'Attack',
  crelease: 'Release',
  cmakeup: 'Makeup',
  glue_thresh: 'Glue threshold',
  glue_ratio: 'Glue ratio',
  glue_attack: 'Glue attack',
  glue_release: 'Glue release',
  glue_makeup: 'Glue makeup',
  hp: 'High-pass',
  air: 'Air shelf',
  ceiling: 'Ceiling',
  lrelease: 'Limiter release',
  target_lufs: 'Target LUFS',
  saturation_drive: 'Saturation drive',
  width: 'Stereo width',
};

let aiAvailable: boolean | null = null;
let aiChatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];

function aiEl(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function aiRequired(id: string, owner = '11-ai-assistant-ux'): HTMLElement {
  // FIX A2: requireById vive en lg().dom (core/dom.ts:118), NO en lg().ui.
  // Antes usaba lg().ui.requireById → "UI bridge no inicializada" al abrir el panel IA.
  const dom = lg().dom;
  if (!dom?.requireById) throw new Error('DOM bridge no inicializada');
  return dom.requireById(id, owner);
}

function setContext(analysisData: Record<string, unknown> | null): void {
  const state = lg().state || (lg().state = {} as StateShape);
  state.lastAnalysisData = analysisData || null;
  window.dispatchEvent(new CustomEvent('analysis-updated', { detail: state.lastAnalysisData }));

  const fab = aiEl('aiFab');
  if (!fab) return;
  fab.classList.toggle('has-context', Boolean(state.lastAnalysisData));
}

function aiCurrentPreset(): string | null {
  const active = document.querySelector<HTMLElement>('.preset-btn.active');
  return active?.dataset.preset || null;
}

function aiCurrentPlatform(): string | null {
  const sel = aiEl('s-platform') as HTMLSelectElement | null;
  return sel && sel.value ? sel.value : null;
}

function formatParamValue(value: unknown, key: string): string {
  if (typeof value === 'number') {
    if (key.includes('lufs')) return `${value} LUFS`;
    if (key.includes('freq') || key === 'hp' || key === 'air' || key === 'ceiling') return `${value} Hz`;
    if (key.includes('thresh') || key.includes('makeup') || key.includes('gain') || key.includes('drive') || key === 'width') return `${value} dB`;
    if (key.includes('attack') || key.includes('release') || key === 'lrelease') return `${value} ms`;
    if (key.includes('ratio')) return `${value}:1`;
    return String(value);
  }
  return String(value);
}

function aiAppendMessage(role: 'user' | 'assistant', content: string): HTMLElement {
  const wrap = aiRequired('aiMessages');
  const div = document.createElement('div');
  div.className = `ai-msg ${role}`;
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function aiAppendSuggestionCard(suggestedParams: Record<string, unknown>, summary?: string, explanation?: string): void {
  const wrap = aiRequired('aiMessages');
  const card = document.createElement('div');
  card.className = 'ai-suggestion-card';

  if (summary) {
    const title = document.createElement('div');
    title.className = 'ai-suggestion-card-title';
    title.textContent = summary;
    card.appendChild(title);
  }
  if (explanation) {
    const explain = document.createElement('div');
    explain.className = 'ai-suggestion-explanation';
    explain.textContent = explanation;
    card.appendChild(explain);
  }

  const list = document.createElement('ul');
  list.className = 'ai-suggestion-card-list';
  Object.entries(suggestedParams).forEach(([key, value]) => {
    const li = document.createElement('li');
    const label = PARAM_LABELS[key] || key;
    let valueText: string;
    if (typeof value === 'boolean') valueText = value ? 'activado' : 'desactivado';
    else if (typeof value === 'string') valueText = value;
    else valueText = formatParamValue(value, key);

    const labelEl = document.createElement('span');
    labelEl.className = 'ai-suggestion-param';
    labelEl.textContent = label;
    const valueEl = document.createElement('span');
    valueEl.className = 'ai-suggestion-value';
    valueEl.textContent = valueText;
    li.append(labelEl, valueEl);
    list.appendChild(li);
  });
  card.appendChild(list);

  const actions = document.createElement('div');
  actions.className = 'ai-suggestion-card-actions';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'ai-suggestion-cancel-btn';
  cancelBtn.type = 'button';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.addEventListener('click', () => { card.remove(); });
  actions.appendChild(cancelBtn);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'ai-suggestion-apply-btn';
  applyBtn.type = 'button';
  applyBtn.textContent = 'Confirmar cambios';
  applyBtn.addEventListener('click', () => {
    const fn = (window as unknown as { applyPresetToUI?: (s: unknown) => void }).applyPresetToUI;
    if (typeof fn === 'function') {
      fn(suggestedParams);
    }
    document.querySelectorAll('.preset-btn').forEach((b) => b.classList.remove('active'));
    applyBtn.textContent = '✓ Aplicado';
    applyBtn.disabled = true;
    cancelBtn.disabled = true;
    card.classList.add('applied');
  });
  actions.appendChild(applyBtn);
  card.appendChild(actions);

  wrap.appendChild(card);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiAppendNote(content: string): HTMLElement {
  const wrap = aiRequired('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-msg system-note';
  div.textContent = content;
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
  return div;
}

function aiShowTyping(): void {
  const wrap = aiRequired('aiMessages');
  const div = document.createElement('div');
  div.className = 'ai-msg assistant typing';
  div.id = 'aiTypingIndicator';
  div.innerHTML = '<span></span><span></span><span></span>';
  wrap.appendChild(div);
  wrap.scrollTop = wrap.scrollHeight;
}

function aiHideTyping(): void {
  const el = aiEl('aiTypingIndicator');
  if (el) el.remove();
}

function aiRenderSuggestions(): void {
  const box = aiRequired('aiSuggestions');
  box.innerHTML = '';
  AI_SUGGESTIONS.forEach((s) => {
    const btnEl = document.createElement('button');
    btnEl.className = 'ai-suggestion-btn';
    btnEl.type = 'button';
    btnEl.textContent = s;
    btnEl.addEventListener('click', () => {
      if (s.includes('Masterizá esto por mí')) {
        if (!lg().state?.selectedFile) {
          aiAppendNote('Primero subí un archivo de audio para poder masterizarlo.');
          return;
        }
        document.getElementById('btnAutoMaster')?.click();
        return;
      }
      const input = aiEl('aiInput') as HTMLTextAreaElement | null;
      if (input) input.value = s;
      void aiSendMessage();
    });
    box.appendChild(btnEl);
  });
}

async function aiCheckStatus(): Promise<void> {
  const api = lg().api;
  if (!api) return;
  try {
    const res = await api.client.get(`${api.apiBase()}/ai/status`);
    const data = await res.json() as { available?: boolean; reason?: string };
    aiAvailable = Boolean(data.available);
    const statusEl = aiRequired('aiStatusLine', '11-ai-assistant-ux:status');
    statusEl.textContent = aiAvailable
      ? (lg().state?.lastAnalysisData ? 'Analizando tu track' : 'Listo para ayudarte')
      : 'No configurado';
    (aiRequired('aiSend', '11-ai-assistant-ux:status') as HTMLButtonElement).disabled = !aiAvailable;
    if (!aiAvailable) {
      aiAppendNote(data.reason || 'El asistente de IA no está configurado en el backend (falta GEMINI_API_KEY).');
    }
  } catch (e) {
    aiAvailable = false;
    aiRequired('aiStatusLine', '11-ai-assistant-ux:status').textContent = 'Sin conexión al backend';
    (aiRequired('aiSend', '11-ai-assistant-ux:status') as HTMLButtonElement).disabled = true;
    aiAppendNote('No se pudo conectar con el backend (' + (api.apiBase()) + ') para consultar el asistente.');
  }
}

async function aiSendMessage(): Promise<void> {
  const api = lg().api;
  if (!api) return;

  const input = aiRequired('aiInput', '11-ai-assistant-ux:send') as HTMLTextAreaElement;
  const send = aiRequired('aiSend', '11-ai-assistant-ux:send') as HTMLButtonElement;
  const suggestions = aiRequired('aiSuggestions', '11-ai-assistant-ux:send');
  const msg = input.value.trim();
  if (!msg || send.disabled) return;
  input.value = '';
  input.style.height = 'auto';
  aiAppendMessage('user', msg);
  suggestions.replaceChildren();
  aiShowTyping();
  send.disabled = true;

  try {
    const res = await api.client.post(`${api.apiBase()}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: msg,
        history: aiChatHistory,
        analysis: lg().state?.lastAnalysisData,
        preset: aiCurrentPreset(),
        platform: aiCurrentPlatform(),
      }),
    });
    aiHideTyping();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { reply: string; suggested_params?: Record<string, unknown>; suggestion_summary?: string; suggestion_explanation?: string };
    aiAppendMessage('assistant', data.reply);
    if (data.suggested_params && Object.keys(data.suggested_params).length) {
      aiAppendSuggestionCard(data.suggested_params, data.suggestion_summary, data.suggestion_explanation);
    }
    aiChatHistory.push({ role: 'user', content: msg });
    aiChatHistory.push({ role: 'assistant', content: data.reply });
  } catch (e) {
    aiHideTyping();
    console.debug('Error en /ai/chat:', e);
    aiAppendNote('Error consultando al asistente: ' + (e as Error).message);
    const wrap = aiRequired('aiMessages');
    const retryDiv = document.createElement('div');
    retryDiv.className = 'ai-msg system-note';
    const btnEl = document.createElement('button');
    btnEl.type = 'button';
    btnEl.className = 'btn btn-secondary btn-sm';
    btnEl.textContent = '↺ Reintentar';
    btnEl.style.marginLeft = '8px';
    btnEl.addEventListener('click', () => {
      input.value = msg;
      retryDiv.remove();
      void aiSendMessage();
    });
    retryDiv.appendChild(btnEl);
    wrap.appendChild(retryDiv);
  } finally {
    send.disabled = false;
  }
}

// ── Bind botones ──────────────────────────────────────────────────────

const controller = new AbortController();
const { signal } = controller;

document.getElementById('metersToggle')?.addEventListener('click', () => {
  const body = document.getElementById('metersBody');
  const toggle = document.getElementById('metersToggle');
  if (!body || !toggle) return;
  const hidden = body.style.display === 'none';
  body.style.display = hidden ? 'block' : 'none';
  toggle.textContent = hidden ? 'ocultar' : 'mostrar';
  toggle.setAttribute('aria-expanded', String(hidden));
}, { signal });

document.getElementById('aiFab')?.addEventListener('click', () => {
  const panel = aiRequired('aiPanel', '11-ai-assistant-ux:toggle');
  const fab = document.getElementById('aiFab');
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  if (fab) fab.setAttribute('aria-expanded', String(opening));
  if (opening) {
    if (!panel.hasAttribute('role')) panel.setAttribute('role', 'dialog');
    if (!panel.hasAttribute('aria-modal')) panel.setAttribute('aria-modal', 'true');
    lg().ui?.openModal?.({
      modalEl: panel,
      openerEl: document.getElementById('aiFab') || document.activeElement,
      closeOnBackdrop: false,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => { panel.classList.remove('open'); },
    });
    if (aiAvailable === null) {
      aiAppendMessage('assistant', '¡Hola! Soy tu asistente de mastering. Puedo analizar tu track y darte consejos, o directamente masterizarlo por vos: elijo preset, plataforma target y ajustes de nivel según el análisis técnico. ¿En qué te ayudo?');
      aiRenderSuggestions();
      void aiCheckStatus();
    }
    (aiRequired('aiInput', '11-ai-assistant-ux:toggle') as HTMLTextAreaElement).focus();
  } else {
    lg().ui?.closeModal?.(panel);
  }
}, { signal });

document.getElementById('aiClose')?.addEventListener('click', () => {
  const panel = aiRequired('aiPanel', '11-ai-assistant-ux:close');
  lg().ui?.closeModal?.(panel);
  panel.classList.remove('open');
  const fab = document.getElementById('aiFab');
  if (fab) fab.setAttribute('aria-expanded', 'false');
}, { signal });

document.getElementById('aiSend')?.addEventListener('click', () => { void aiSendMessage(); }, { signal });

document.getElementById('aiInput')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    void aiSendMessage();
  }
}, { signal });

document.getElementById('aiInput')?.addEventListener('input', function (this: HTMLTextAreaElement) {
  this.style.height = 'auto';
  this.style.height = Math.min(this.scrollHeight, 96) + 'px';
}, { signal });

// Sidebar tabs init
(function initSidebar(): void {
  const paso1 = document.getElementById('pasoArchivo');
  const paso2 = document.getElementById('pasoCadena');
  const paso3 = document.getElementById('pasoSalida');
  if (paso1) paso1.setAttribute('open', '');
  if (paso2) paso2.removeAttribute('open');
  if (paso3) paso3.removeAttribute('open');
})();

// Aside scroll hint
(function initScrollHint(): void {
  const aside = document.querySelector('aside');
  const hint = document.getElementById('asideScrollHint');
  if (!aside || !hint) return;
  function updateScrollHint(): void {
    const atBottom = aside!.scrollHeight - aside!.scrollTop - aside!.clientHeight < 20;
    hint!.classList.toggle('hidden', atBottom);
  }
  aside.addEventListener('scroll', updateScrollHint, { passive: true });
  updateScrollHint();
  new ResizeObserver(updateScrollHint).observe(aside);
})();

// Botones secundarios visibles cuando hay archivo
(function watchSecondaryButtons(): void {
  const secondaryBtns = ['btnAutoMaster', 'btnAiSuggest', 'btnAnalyze', 'btnAdvice', 'btnAnalyzeGrid', 'btnAdviceGrid', 'btnSpectrum', 'btnStems', 'btnAB'];
  const observer = new MutationObserver(() => {
    if (lg().state?.selectedFile) {
      secondaryBtns.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
      });
    }
  });
  const masterBtn = document.getElementById('btnMaster');
  if (masterBtn) {
    observer.observe(masterBtn, { attributes: true, attributeFilter: ['disabled'] });
  }
})();

// ── Exponer API ───────────────────────────────────────────────────────

const wLGMDM = lg();
const existingAi: AiShape = (wLGMDM.ai as AiShape | undefined) || { setContext: () => { /* noop */ } };
existingAi.setContext = setContext;
wLGMDM.ai = existingAi;
const existingAnalysis: AnalysisShape = (wLGMDM.analysis as AnalysisShape | undefined) || { request: async () => null };
existingAnalysis.request = async function request(): Promise<{ analysis?: Record<string, unknown> } | null> {
  const file = lg().state?.selectedFile;
  if (!file) {
    lg().ui?.showStatus?.(null, 'Cargá un archivo antes de analizar.', 'error');
    return null;
  }
  const api = lg().api;
  if (!api) throw new Error('API bridge no inicializada');
  const fd = new FormData();
  fd.append('file', file);
  const libId = lg().state?._previewLibraryId;
  if (libId) fd.append('library_id', libId);
  try {
    const res = await api.client.post('/analysis', { body: fd });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { analysis?: Record<string, unknown> };
    if (data?.analysis) setContext(data.analysis);
    return data;
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      console.debug('[analysis] request cancelado por el usuario:', e);
      throw e;
    }
    console.debug('[analysis] request failed:', e);
    lg().ui?.showStatus?.(null, 'Error: ' + (e as Error).message, 'error');
    throw e;
  }
};

// Funciones globales para 07-mastering-actions.js
Object.assign(globalThis as unknown as Record<string, unknown>, {
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

// HMR idempotency
(wLGMDM as Record<string, unknown>).aiAssistantBound = true;

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => controller.abort(), { once: true });

export {};
