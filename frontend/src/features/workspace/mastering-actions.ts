// features/workspace/mastering-actions.ts — Master, Auto-Mastering IA, Analyze, Advice, Spectrum, Stems, Polling.
//
// Carga tras `core/state.ts` (necesita state.selectedFile), `workspace/sliders-ui.ts`
// (sliders alimentan params), `canvas/eq-waveform.ts` (no requiere), y `canvas/params-builder.ts`
// (params.build() y params.renderPreview()).
//
// FIX vs aporte: todos los bridges a módulos no portados (`LGMDM.ai.*`, `renderPerceptualStandalone`,
// `renderFFT`, `renderAnalysisComparison`, `setupABPlayer`, `aiShowTyping`, `aiHideTyping`,
// `aiAppendMessage`, `aiAppendNote`, `LGMDM.reference.renderAdvicePanel`) son opcionales.

// ── Helpers ────────────────────────────────────────────────────────────

interface StateShape {
  selectedFile?: File | null;
  _previewLibraryId?: string | null;
  jobs?: {
    mastering?: { jobId?: string | null; downloadUrl?: string | null };
    reference?: { jobId?: string | null; downloadUrl?: string | null };
  };
  masteringPollInterval?: number | null;
  referencePollInterval?: number | null;
  downloadUrl?: string | null;
  downloadFilename?: string;
  activeJobType?: 'mastering' | 'reference';
}

interface UiShape {
  clearResults?: () => void;
  showStatus?: (container: unknown, msg: string, kind: string, progress?: number, stage?: string) => void;
  escapeHtml?: (s: unknown) => string;
  getContent?: () => HTMLElement;
  bindOnce?: (el: HTMLElement, type: string, fn: EventListener, key?: string) => void;
  showToast?: (msg: string, kind: string, ms?: number) => void;
}

interface AiShape {
  setContext?: (ctx: Record<string, unknown>) => void;
}

interface MetricsShape {
  publish?: (data: Record<string, unknown>, opts: { source: string }) => void;
}

interface ApiShape {
  apiBase: () => string;
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  client: {
    get: (endpoint: string, options?: RequestInit) => Promise<Response>;
    post: (endpoint: string, options?: RequestInit) => Promise<Response>;
    put: (endpoint: string, options?: RequestInit) => Promise<Response>;
    patch: (endpoint: string, options?: RequestInit) => Promise<Response>;
    delete: (endpoint: string, options?: RequestInit) => Promise<Response>;
  };
  downloadAuthenticated: (endpoint: string, opts: { filename?: string } & RequestInit) => Promise<unknown>;
}

interface ParamsShape {
  build?: () => URLSearchParams;
  renderPreview?: (params: Record<string, unknown>, opts: Record<string, unknown>) => void;
}

interface WorkspaceShape {
  setWorkspace?: (name: string) => void;
  getCurrent?: () => string;
}

interface AnalysisShape {
  request?: () => Promise<Record<string, unknown> | null>;
}

interface ReferenceShape {
  renderAdvicePanel?: (data: Record<string, unknown>, title: string, subtitle?: string) => void;
}

interface ErrorsShape {
  handleClientError?: (e: unknown, msg: string, ctx: Record<string, unknown>) => void;
}

declare global {
  interface Window {
    setupABPlayer?: (blob: Blob) => Promise<void>;
    renderPerceptualStandalone?: (data: Record<string, unknown>) => void;
    // renderFFT ya está declarado en visualizer-helpers.ts
    renderAnalysisComparison?: (before: Record<string, unknown>, after: Record<string, unknown>) => void;
    prefillTrackNameFromFile?: () => void;
    currentTrackNameParam?: () => string;
    aiShowTyping?: () => void;
    aiHideTyping?: () => void;
    aiAppendMessage?: (role: 'user' | 'assistant', content: string) => void;
    aiAppendNote?: (content: string) => void;
    // applyPresetToUI ya está declarado en presets/save.ts
    collectMasterParamsObj?: () => Record<string, unknown>;
  }
}

const lg = () => (window.LGMDM = window.LGMDM || {}) as unknown as Record<string, unknown> & {
  state?: StateShape & { downloadReport?: (jobId: string) => Promise<void> };
  ui?: UiShape;
  api?: ApiShape;
  ai?: AiShape;
  metrics?: MetricsShape;
  params?: ParamsShape;
  workspace?: WorkspaceShape;
  analysis?: AnalysisShape;
  reference?: ReferenceShape;
  errors?: ErrorsShape;
};

function requireState(): NonNullable<ReturnType<typeof lg>['state']> {
  const s = lg().state;
  if (!s) throw new Error('State bridge no inicializada (cargar core/state.ts primero)');
  return s as NonNullable<ReturnType<typeof lg>['state']>;
}

function requireApi(): NonNullable<ReturnType<typeof lg>['api']> {
  const a = lg().api;
  if (!a) throw new Error('API bridge no inicializada');
  return a as NonNullable<ReturnType<typeof lg>['api']>;
}

function ui(): UiShape {
  return lg().ui || {};
}

function showStatus(msg: string, kind: string, progress?: number, stage?: string): void {
  ui().showStatus?.(null, msg, kind, progress, stage);
}

// ── AbortController para cleanup ──────────────────────────────────────

const controller = new AbortController();
const { signal } = controller;

// ── MASTER (async con polling) ────────────────────────────────────────

async function submitMasterJob(): Promise<void> {
  const state = requireState();
  const api = requireApi();
  ui().clearResults?.();
  showStatus('Enviando archivo…', 'queued');
  document.getElementById('btnMaster')?.setAttribute('disabled', '');

  const fd = new FormData();
  if (state.selectedFile) fd.append('file', state.selectedFile);
  if (state._previewLibraryId) fd.append('library_id', state._previewLibraryId);

  try {
    const params = lg().params?.build?.() || new URLSearchParams();
    const url = `${api.apiBase()}/master?${params.toString()}`;
    const res = await api.client.post(url, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { job_id: string };
    if (!state.jobs) state.jobs = { mastering: {}, reference: {} } as NonNullable<StateShape['jobs']>;
    if (state.jobs) {
      state.jobs.mastering = { ...state.jobs.mastering, jobId: data.job_id };
    }
    showStatus(`Job ${data.job_id.slice(0, 8)}… en cola`, 'queued');
    startPolling(data.job_id);
  } catch (e) {
    showStatus('Error: ' + (e as Error).message, 'error');
    document.getElementById('btnMaster')?.removeAttribute('disabled');
  }
}

document.getElementById('btnMaster')?.addEventListener('click', () => {
  const state = lg().state;
  if (!state?.selectedFile) {
    showStatus('Selecciona un archivo primero', 'error');
    return;
  }
  ui().clearResults?.();
  const paramsObj = collectMasterParamsObj();
  lg().params?.renderPreview?.(paramsObj, { onConfirm: submitMasterJob });
}, { signal });

document.getElementById('btnMasterAsync')?.addEventListener('click', () => {
  document.getElementById('btnMaster')?.click();
}, { signal });

// ── MASTER SYNC (descarga inmediata) ──────────────────────────────────

async function submitMasterSync(): Promise<void> {
  const state = requireState();
  const api = requireApi();
  if (!state.selectedFile) {
    showStatus('Selecciona un archivo primero', 'error');
    return;
  }
  ui().clearResults?.();
  showStatus('Procesando (sync)…', 'processing');
  const fd = new FormData();
  if (state.selectedFile) fd.append('file', state.selectedFile);
  if (state._previewLibraryId) fd.append('library_id', state._previewLibraryId);
  try {
    const params = lg().params?.build?.() || new URLSearchParams();
    const url = `${api.apiBase()}/master/sync?${params.toString()}`;
    const res = await api.client.post(url, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const blob = await res.blob();
    let filename = 'mastered.wav';
    const cd = res.headers.get('content-disposition');
    if (cd) {
      const m = cd.match(/filename\*=UTF-8''([^;]+)/) || cd.match(/filename="?([^";]+)"?/);
      if (m && m[1]) filename = decodeURIComponent(m[1]);
    }
    const link = document.createElement('a');
    const masterObjUrl = URL.createObjectURL(blob);
    link.href = masterObjUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(masterObjUrl), 1500);
    showStatus('Master sync completado ✓', 'done');
  } catch (e) {
    showStatus('Error: ' + (e as Error).message, 'error');
  }
}

document.getElementById('btnMasterSync')?.addEventListener('click', () => {
  const state = lg().state;
  if (!state?.selectedFile) {
    showStatus('Selecciona un archivo primero', 'error');
    return;
  }
  ui().clearResults?.();
  const paramsObj = collectMasterParamsObj();
  lg().params?.renderPreview?.(paramsObj, { onConfirm: submitMasterSync, confirmLabel: 'Master (descarga)' });
}, { signal });

// ── AUTO-MASTERING IA ────────────────────────────────────────────────

document.getElementById('btnAutoMaster')?.addEventListener('click', async () => {
  const state = lg().state;
  if (!state?.selectedFile) {
    showStatus('Selecciona un archivo primero', 'error');
    return;
  }
  const api = requireApi();
  ui().clearResults?.();
  showStatus('🤖 La IA está analizando tu track…', 'processing');
  const autoBtn = document.getElementById('btnAutoMaster') as HTMLButtonElement | null;
  const masterBtn = document.getElementById('btnMaster') as HTMLButtonElement | null;
  if (autoBtn) autoBtn.disabled = true;
  if (masterBtn) masterBtn.disabled = true;

  const panel = document.getElementById('aiPanel');
  if (panel && !panel.classList.contains('open')) panel.classList.add('open');
  document.getElementById('aiSuggestions')?.replaceChildren();
  window.aiShowTyping?.();

  const fd = new FormData();
  fd.append('file', state.selectedFile);
  try {
    // FIX A11: el backend declara `output_format: str = Form("wav")` (ai.py:159),
    // no Query. Antes se mandaba como query → descartado (default "wav").
    const fmt = (document.getElementById('s-format') as HTMLSelectElement | null)?.value || 'wav';
    fd.append('output_format', fmt);
    const res = await api.client.post(`${api.apiBase()}/ai/auto-master`, { body: fd });
    window.aiHideTyping?.();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { job_id: string; analysis?: Record<string, unknown>; ai_decision?: Record<string, string> };
    if (!state.jobs) state.jobs = { mastering: {}, reference: {} } as NonNullable<StateShape['jobs']>;
    if (state.jobs) state.jobs.mastering = { ...state.jobs.mastering, jobId: data.job_id };
    lg().ai?.setContext?.((data.analysis || {}) as Record<string, unknown>);

    const d = data.ai_decision || {};
    const platformLabel = d.platform ? d.platform : 'sin target específico';
    window.aiAppendMessage?.(
      'assistant',
      `🤖 Auto-Mastering en marcha — la IA calculó los parámetros a medida de este track (no usó un preset fijo).\nPlataforma: ${platformLabel}` +
        (d.reasoning ? `\n\n${d.reasoning}` : '')
    );
    const { platform: _p, reasoning: _r, ...aiParams } = d as Record<string, string>;
    if (Object.keys(aiParams).length) {
      lg().params?.renderPreview?.(aiParams, {
        readOnly: true,
        title: '🤖 Parámetros calculados por la IA para este track',
      });
    }
    showStatus('IA calculó los parámetros — procesando…', 'queued');
    startPolling(data.job_id);
  } catch (e) {
    window.aiHideTyping?.();
    window.aiAppendNote?.('Error en el auto-mastering: ' + (e as Error).message);
    showStatus('Error: ' + (e as Error).message, 'error');
  } finally {
    if (autoBtn) autoBtn.disabled = false;
    if (masterBtn) masterBtn.disabled = false;
  }
}, { signal });

// ── SUGGEST IA ───────────────────────────────────────────────────────

document.getElementById('btnAiSuggest')?.addEventListener('click', async () => {
  const state = lg().state;
  if (!state?.selectedFile) {
    showStatus('Selecciona un archivo primero', 'error');
    return;
  }
  const api = requireApi();
  ui().clearResults?.();
  showStatus('🤖 La IA está analizando tu track…', 'processing');
  const suggestBtn = document.getElementById('btnAiSuggest') as HTMLButtonElement | null;
  const autoBtn = document.getElementById('btnAutoMaster') as HTMLButtonElement | null;
  const masterBtn = document.getElementById('btnMaster') as HTMLButtonElement | null;
  if (suggestBtn) suggestBtn.disabled = true;
  if (autoBtn) autoBtn.disabled = true;
  if (masterBtn) masterBtn.disabled = true;

  const panel = document.getElementById('aiPanel');
  if (panel && !panel.classList.contains('open')) panel.classList.add('open');
  document.getElementById('aiSuggestions')?.replaceChildren();
  window.aiShowTyping?.();

  const fd = new FormData();
  if (state._previewLibraryId) {
    fd.append('library_id', state._previewLibraryId);
  } else {
    fd.append('file', state.selectedFile);
  }
  try {
    const res = await api.client.post(`${api.apiBase()}/ai/suggest`, { body: fd });
    window.aiHideTyping?.();
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { analysis?: Record<string, unknown>; ai_decision?: Record<string, string> };
    lg().ai?.setContext?.((data.analysis || {}) as Record<string, unknown>);

    const d = data.ai_decision || {};
    const platformLabel = d.platform ? d.platform : 'sin target específico';
    window.aiAppendMessage?.(
      'assistant',
      `🤖 Analicé el track y armé una propuesta de cadena a medida (no un preset fijo).\nPlataforma: ${platformLabel}\n\nCargué los parámetros en los controles — escuchá el preview, ajustá lo que quieras, y confirmá cuando estés conforme.` +
        (d.reasoning ? `\n\n${d.reasoning}` : '')
    );

    const { platform: _p, reasoning: _r, ...aiParams } = d as Record<string, string>;
    if (Object.keys(aiParams).length) {
      window.applyPresetToUI?.(aiParams);
      document.querySelectorAll('.preset-btn.active').forEach((b) => b.classList.remove('active'));
      lg().params?.renderPreview?.(aiParams, {
        title: '🤖 Parámetros sugeridos por la IA — revisá y confirmá para masterizar',
        confirmLabel: '✅ Confirmar y masterizar',
        onConfirm: submitMasterJob,
      });
    }
    showStatus('Parámetros cargados — revisá y confirmá cuando quieras', 'done');
  } catch (e) {
    window.aiHideTyping?.();
    window.aiAppendNote?.('Error al pedir la sugerencia de la IA: ' + (e as Error).message);
    showStatus('Error: ' + (e as Error).message, 'error');
  } finally {
    if (suggestBtn) suggestBtn.disabled = false;
    if (autoBtn) autoBtn.disabled = false;
    if (masterBtn) masterBtn.disabled = false;
  }
}, { signal });

// ── ANALYZE ──────────────────────────────────────────────────────────

async function handleAnalyzeClick(): Promise<void> {
  try {
    const data = await lg().analysis?.request?.();
    if (!data) return;
    const currentWs = document.body?.dataset?.workspace || lg().workspace?.getCurrent?.();
    if (currentWs !== 'console') {
      lg().workspace?.setWorkspace?.('analysis');
    }
  } catch (e) {
    if ((e as { name?: string })?.name === 'AbortError') {
      console.debug('[analyze] cancelado por el usuario:', e);
      return;
    }
    showStatus('Error: ' + (e as Error).message, 'error');
  }
}

['btnAnalyze', 'btnAnalyzeGrid'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', () => { void handleAnalyzeClick(); }, { signal });
});

// ── ADVICE ───────────────────────────────────────────────────────────

async function handleAdviceClick(): Promise<void> {
  const state = lg().state;
  if (!state?.selectedFile) return;
  const api = requireApi();
  ui().clearResults?.();
  showStatus('Analizando mezcla…', 'processing');
  const fd = new FormData();
  fd.append('file', state.selectedFile);
  try {
    const res = await api.client.post(`${api.apiBase()}/mix-advice`, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as {
      analysis?: { lufs?: number; fft_spectrum?: unknown };
      issues?: unknown;
      tips?: unknown;
      score?: unknown;
    };
    showStatus('Evaluación completada', 'done');
    if (data.analysis?.lufs != null) {
      const lufsMeter = (window as unknown as { LGMDM?: { eqWaveform?: { showLoudnessMeter?: (v: number) => void } } }).LGMDM?.eqWaveform?.showLoudnessMeter;
      lufsMeter?.(data.analysis.lufs);
    }
    lg().reference?.renderAdvicePanel?.(data as unknown as Record<string, unknown>, 'Evaluación de la mezcla');
    window.renderPerceptualStandalone?.((data.analysis || {}) as Record<string, unknown>);
    if (data.analysis?.fft_spectrum) {
      (window as unknown as { renderFFT?: (s: Array<{ label: string; data: unknown }>) => void }).renderFFT?.([{ label: 'Espectro', data: data.analysis.fft_spectrum as unknown }]);
    }
    if (data.analysis) {
      lg().ai?.setContext?.({ ...data.analysis, mix_advice: { issues: data.issues, tips: data.tips, score: data.score } });
    }
    lg().workspace?.setWorkspace?.('analysis');
  } catch (e) {
    showStatus('Error: ' + (e as Error).message, 'error');
  }
}

['btnAdvice', 'btnAdviceGrid'].forEach((id) => {
  document.getElementById(id)?.addEventListener('click', () => { void handleAdviceClick(); }, { signal });
});

// ── SPECTRUM ─────────────────────────────────────────────────────────

document.getElementById('btnSpectrum')?.addEventListener('click', async () => {
  const state = lg().state;
  if (!state?.selectedFile) return;
  const api = requireApi();
  ui().clearResults?.();
  showStatus('Calculando FFT…', 'processing');
  const fd = new FormData();
  fd.append('file', state.selectedFile);
  try {
    const res = await api.client.post(`${api.apiBase()}/spectrum?n_fft=4096&n_bins=96`, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    showStatus('Spectrum listo', 'done');
    window.renderFFT?.([{ label: 'Espectro', data }]);
    lg().workspace?.setWorkspace?.('analysis');
  } catch (e) {
    showStatus('Error: ' + (e as Error).message, 'error');
  }
}, { signal });

// ── STEM SEPARATION ──────────────────────────────────────────────────

document.getElementById('btnStems')?.addEventListener('click', async () => {
  const state = lg().state;
  if (!state?.selectedFile) return;
  const api = requireApi();
  ui().clearResults?.();
  showStatus('Separando en stems…', 'processing', 0, 'En cola…');
  const btn = document.getElementById('btnStems') as HTMLButtonElement | null;
  if (btn) btn.disabled = true;
  const fd = new FormData();
  fd.append('file', state.selectedFile);
  const stemsMode = (document.getElementById('s-stems-mode') as HTMLSelectElement | null)?.value || 'demucs_4stem';
  fd.append('mode', stemsMode);
  try {
    const res = await api.client.post(`${api.apiBase()}/stems/separate`, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { job_id: string };
    pollStemsJob(data.job_id);
  } catch (e) {
    showStatus('Error: ' + (e as Error).message, 'error');
    if (btn) btn.disabled = false;
  }
}, { signal });

function pollStemsJob(jobId: string): void {
  const api = requireApi();
  const interval = window.setInterval(async () => {
    try {
      const res = await api.client.get(`${api.apiBase()}/job/${jobId}`);
      const data = await res.json() as { status: string; progress?: number; stage?: string; stem_analysis?: Record<string, unknown>; available_stems?: string[]; error?: string };
      if (data.status === 'queued' || data.status === 'processing') {
        showStatus('Separando stems…', 'processing', data.progress, data.stage);
      } else if (data.status === 'done') {
        clearInterval(interval);
        showStatus('Stems listos ✓', 'done');
        const btn = document.getElementById('btnStems') as HTMLButtonElement | null;
        if (btn) btn.disabled = false;
        renderStemsPanel(data.stem_analysis || {}, jobId, data.available_stems || []);
      } else if (data.status === 'error') {
        clearInterval(interval);
        showStatus('Error: ' + data.error, 'error');
        const btn = document.getElementById('btnStems') as HTMLButtonElement | null;
        if (btn) btn.disabled = false;
      }
    } catch (e) {
      console.debug('Poll stems error:', e);
    }
  }, 1500);
}

let stemDownloadBound = false;

function renderStemsPanel(stemAnalysis: Record<string, unknown>, jobId: string, availableStems: string[]): void {
  if (!stemDownloadBound) {
    stemDownloadBound = true;
    document.addEventListener('click', async (ev) => {
      const target = ev.target as HTMLElement;
      const btn = target.closest?.('[data-stem-download]') as HTMLButtonElement | null;
      if (!btn) return;
      ev.preventDefault();
      const job = btn.dataset.stemDownload || '';
      const stem = btn.dataset.stemName || '';
      try {
        btn.disabled = true;
        const api = requireApi();
        await api.downloadAuthenticated(`${api.apiBase()}/stems/download/${encodeURIComponent(job)}/${encodeURIComponent(stem)}`, { filename: `${stem}.wav` });
      } catch (e) {
        lg().errors?.handleClientError?.(e, 'No se pudo descargar el stem.', { context: 'stem-download' });
      } finally {
        btn.disabled = false;
      }
    }, { signal });
  }
  const stems = (stemAnalysis.stems as Record<string, { name: string; label?: string; is_silent?: boolean; peak_db?: number; rms_db?: number; lufs?: number; dominant_band?: string }> | undefined) || {};
  const wrap = document.createElement('div');
  wrap.className = 'stems-wrap';

  const safe = ui().escapeHtml || ((s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string)));
  const cards = Object.values(stems).map((s) => `
    <div class="stem-card ${s.is_silent ? 'silent' : ''}">
      <div class="stem-title">${safe(s.label || s.name)}</div>
      <div class="stem-metric"><span>Peak</span><span>${s.peak_db} dB</span></div>
      <div class="stem-metric"><span>RMS</span><span>${s.rms_db} dB</span></div>
      ${s.lufs != null ? `<div class="stem-metric"><span>LUFS</span><span>${s.lufs}</span></div>` : ''}
      <div class="stem-metric"><span>Banda dominante</span><span>${safe((s.dominant_band || '—').replace('_', ' '))}</span></div>
      ${availableStems.includes(s.name) ? `<button type="button" class="stem-dl" data-stem-download="${safe(jobId)}" data-stem-name="${safe(s.name)}">⬇ Descargar ${safe(s.name)}.wav</button>` : ''}
    </div>
  `).join('');

  const recs = (stemAnalysis.recommendations as Array<{ message: string; type?: string; score: string | number; band_hz?: [string, string] }> | undefined) || [];
  const recsHtml = recs.length
    ? recs.map((r) => `
      <div class="stem-rec ${r.type === 'kick_bass_collision' ? 'kick-bass' : ''}">
        ${safe(r.message)}
        <div class="rec-score">Score de colisión: ${safe(String(r.score))}${r.band_hz ? ` · Banda: ${safe(String(r.band_hz[0]))}-${safe(String(r.band_hz[1]))} Hz` : ''}</div>
      </div>
    `).join('')
    : `<div class="stem-summary">${safe(stemAnalysis.summary) || 'Sin colisiones detectadas.'}</div>`;

  const isRoformer = Object.keys(stems).includes('instrumental');
  wrap.innerHTML = `
    <h3>Stems (${isRoformer ? 'Roformer — voz/instrumental' : 'Demucs — 4 stems'})</h3>
    <div class="stem-cards">${cards}</div>
    <h3 class="stem-recommendations-title">Recomendaciones</h3>
    ${recsHtml}
  `;
  ui().getContent?.()?.prepend(wrap);
}

// ── Polling del master ────────────────────────────────────────────────

function startPolling(jobId: string): void {
  const state = lg().state || ({} as StateShape);
  if (!state) return;
  if (state.masteringPollInterval) clearInterval(state.masteringPollInterval);
  const api = requireApi();
  let pollFailures = 0;
  state.masteringPollInterval = window.setInterval(async () => {
    try {
      const res = await api.client.get(`${api.apiBase()}/job/${jobId}`);
      pollFailures = 0;
      const data = await res.json() as {
        status: string;
        progress?: number;
        stage?: string;
        download_url?: string;
        analysis_before?: { lufs?: number };
        analysis_after?: { lufs?: number };
        chain_meters?: Record<string, unknown>;
        mix_advice_before?: Record<string, unknown>;
        mix_advice_after?: Record<string, unknown>;
        error?: string;
      };
      if (data.status === 'queued') {
        showStatus('En cola…', 'queued', data.progress, data.stage);
      } else if (data.status === 'processing') {
        showStatus('Masterizando…', 'processing', data.progress, data.stage);
      } else if (data.status === 'done') {
        clearInterval(state.masteringPollInterval!);
        showStatus('Mastering completado ✓', 'done');
        document.getElementById('btnMaster')?.removeAttribute('disabled');
        const finalUrl = `${api.apiBase()}/download/${jobId}`;
        if (!state.jobs) state.jobs = { mastering: {}, reference: {} } as NonNullable<StateShape['jobs']>;
        if (state.jobs) state.jobs.mastering = { ...state.jobs.mastering, downloadUrl: finalUrl };
        state.downloadUrl = finalUrl;
        const btn = document.getElementById('btnDownload');
        if (btn) btn.style.display = 'block';

        const abBtn = document.getElementById('btnAB') as HTMLButtonElement | null;
        if (abBtn && typeof window.setupABPlayer === 'function') {
          abBtn.style.display = 'block';
          abBtn.disabled = true;
          abBtn.textContent = '⏳ Cargando A/B…';
          api.client.get(state.downloadUrl || '')
            .then((r) => r.blob())
            .then((masterBlob) => window.setupABPlayer?.(masterBlob))
            .then(() => {
              abBtn.disabled = false;
              abBtn.textContent = '⚡ A/B';
            })
            .catch(() => { abBtn.style.display = 'none'; });
        }
        const nameInput = document.getElementById('trackNameInput') as HTMLInputElement | null;
        if (nameInput) nameInput.style.display = 'block';
        window.prefillTrackNameFromFile?.();
        state.downloadFilename = 'mastered.wav';
        state.activeJobType = 'mastering';
        if (btn) {
          ui().bindOnce?.(btn as HTMLElement, 'click', async () => {
            try {
              (btn as HTMLButtonElement).disabled = true;
              const dlUrl = state.downloadUrl || '';
              const filename = state.downloadFilename || (state.activeJobType === 'reference' ? 'reference-master.wav' : 'mastered.wav');
              await api.downloadAuthenticated(dlUrl + (window.currentTrackNameParam?.() || ''), { filename });
            } catch (e) {
              ui().showToast?.((e as Error).message || 'No se pudo descargar el master.', 'error');
            } finally {
              (btn as HTMLButtonElement).disabled = false;
            }
          }, 'app-master-download');
        }
        const rBtn = document.getElementById('btnReport');
        if (rBtn) {
          rBtn.style.display = 'block';
          ui().bindOnce?.(rBtn as HTMLElement, 'click', () => { void lg().state?.downloadReport?.(jobId); }, 'master-report');
        }
        if (data.analysis_before?.lufs != null) {
          const lufsMeter = (window as unknown as { LGMDM?: { eqWaveform?: { showLoudnessMeter?: (v: number) => void } } }).LGMDM?.eqWaveform?.showLoudnessMeter;
          lufsMeter?.(data.analysis_after?.lufs ?? data.analysis_before.lufs!);
        }
        window.renderAnalysisComparison?.(data.analysis_before || {}, data.analysis_after || {});
        // F-MB-GR — publicar chain_meters del master al metrics store.
        const publish = lg().metrics?.publish;
        if (data.chain_meters && typeof publish === 'function') {
          try {
            publish({
              ...(data.analysis_after || {}),
              chain_meters: data.chain_meters,
              output_lufs: data.analysis_after?.lufs,
            }, { source: 'master-done' });
          } catch (_) {
            /* ignore */
          }
        }
        if (data.mix_advice_before) lg().reference?.renderAdvicePanel?.(data.mix_advice_before, 'Evaluación', '— Antes');
        if (data.mix_advice_after) lg().reference?.renderAdvicePanel?.(data.mix_advice_after, 'Evaluación', '— Después');
        if (data.analysis_after) lg().ai?.setContext?.({ ...data.analysis_after, mix_advice: data.mix_advice_after });
      } else if (data.status === 'error') {
        clearInterval(state.masteringPollInterval!);
        showStatus('Error: ' + data.error, 'error');
        document.getElementById('btnMaster')?.removeAttribute('disabled');
      }
    } catch (e) {
      console.debug('Poll error:', e);
      pollFailures++;
      if (pollFailures >= 5) {
        clearInterval(state.masteringPollInterval!);
        state.masteringPollInterval = null;
      }
    }
  }, 1500);
}

// ── collectMasterParamsObj / applyPresetToUI / activePreset ──────────
// Estas funciones viven en otros módulos (presets). Aquí solo usamos
// referencias si existen.

function collectMasterParamsObj(): Record<string, unknown> {
  if (typeof window.collectMasterParamsObj === 'function') {
    return window.collectMasterParamsObj();
  }
  return {};
}

// ── Exponer API pública ───────────────────────────────────────────────

const wLGMDM = lg();
const masteringApi = (wLGMDM.mastering = wLGMDM.mastering || {}) as Record<string, unknown>;
(masteringApi as { submitJob: typeof submitMasterJob }).submitJob = submitMasterJob;
(masteringApi as { submitSync: typeof submitMasterSync }).submitSync = submitMasterSync;

// FIX M-NEW-2: este bloque se seteaba `masteringActionsBound = true` con
// comentario "// HMR idempotency", pero el flag nunca se consultaba →
// comentario miente (regla 7 AGENTS.md). Como este módulo es ESM y Vite
// hace full page reload, el flag era cosmético. Lo quitamos (mismo criterio
// que FIX M-NEW-1 en reference-mastering.ts). Las asignaciones de arriba
// son idempotentes (re-asignan lo mismo en re-import).

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => controller.abort(), { once: true });

export {}; // módulo válido para `declare global`
