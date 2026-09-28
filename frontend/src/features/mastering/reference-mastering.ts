import type { JobId } from '../../core/state';
import { audioEngine } from '../../core/audio-engine';

// features/mastering/reference-mastering.ts — Master con referencia, EQ dinámica, preview en vivo, análisis.
// (PRODUCTION reference, NO del aporte experimental).
//
// FIX: NO declaramos `LGMDM` ni `setupABPlayer` aquí — core/state.ts y otros
// módulos ya los declaran. Si redeclaramos con tipos diferentes, TS se queja.
// Usamos `lg()` helper con Record<string, unknown> y accedemos via casting.

// FIX: NO declaramos tipos de LGMDM ni bridges — esto choca con declaraciones
// globales en otros archivos. Usamos `lg(): any` y optional chaining en runtime.

// Usamos `any` para lg() porque este módulo cruza muchos bridges (LGMDM.*) que
// están declarados globalmente en otros archivos. La verificación real es en
// runtime — si el bridge no existe, retorna undefined y optional chaining lo maneja.
// TODO(U-2): `lg(): any` es la raíz `any` de este archivo. Migrarla a un slice
// tipado cascada a 60+ usos `lg().dom/.state/.ui/.api/.audio/.errors/.ai/.params`
// (varios sin `?.`), requiriendo decidir required-vs-optional por bridge.
// Migración dedicada pendiente. Los 6 `(window as any).LGMDM` directos (líneas
// 155, 249, 341, 375, 525, 1322) se migran abajo con `lgmdmRef()`.
const lg = (): any => ((window as any).LGMDM = (window as any).LGMDM || {});

// Slice local para los 6 accesos directos a `window.LGMDM.reference` (los que
// NO van por `lg()`). Reusa `ReferenceApiObj` (línea 21). Cast por `unknown`
// porque la declaración global de `Window.LGMDM` (core/state.ts) es mínima y no
// incluye `reference`. En los WRITE sites se afirma no-undefined con
// `as LgmdmReferenceSlice` (LGMDM lo inicializa core/state.ts al cargar): no es
// `as any` ni `!`, y preserva el contrato runtime original (mismo TypeError si
// LGMDM no estuviera — situación que no ocurre por orden de carga).
interface LgmdmReferenceSlice {
  reference?: ReferenceApiObj;
  [key: string]: unknown;
}
const lgmdmRef = () => (window as unknown as Window & { LGMDM?: LgmdmReferenceSlice }).LGMDM;

interface ReferenceStateObj {
  file: File | null;
  libraryId: string | null;
}

interface ReferenceApiObj {
  onFileSelected?: () => void;
  onRefFileSelected?: () => void;
  renderAdvicePanel?: (data: Record<string, unknown>, title: string, subtitle?: string) => void;
  updateButtonState?: () => void;
  bandEQ?: { getGainsArray(): Array<{ freq_hz: number; gain_db: number }>; getBandCount(): number };
  stopRefPreview?: () => void;
}

interface StateShape {
  selectedFile?: File | null;
  _previewLibraryId?: string | null;
  reference?: ReferenceStateObj;
  jobs?: {
    mastering?: { jobId?: string | null; downloadUrl?: string | null };
    reference?: { jobId?: string | null; downloadUrl?: string | null };
  };
  referencePollInterval?: number | null;
  currentJobId?: JobId | null;
  downloadUrl?: string | null;
  downloadFilename?: string;
  activeJobType?: 'mastering' | 'reference';
  audio?: { reference?: { active: boolean; playTime: number } };
}

declare global {
  interface Window {
    safeAudioSrc?: (url: string) => string;
    renderAdvicePanel?: (data: Record<string, unknown>, title: string, subtitle?: string) => void;
  }
}

function genUUID(): string {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function reqInput(id: string, owner: string): HTMLInputElement {
  const dom = lg().dom;
  if (!dom) throw new Error(`[LGMDM DOM CONTRACT] ${owner}: dom bridge no disponible`);
  return dom.requireById(id, owner) as HTMLInputElement;
}

// U-3: como `reqInput` pero para `HTMLElement` genérico. `requireById` (dom.ts:88)
// retorna `T` no-null y arroja si falta — reemplaza `container!.X` / `countVal!.X`
// en closures (`render()`, callbacks) que no ven el narrow del guard del IIFE.
function reqEl(id: string, owner: string): HTMLElement {
  const dom = lg().dom;
  if (!dom) throw new Error(`[LGMDM DOM CONTRACT] ${owner}: dom bridge no disponible`);
  return dom.requireById(id, owner) as HTMLElement;
}

function byId(id: string): HTMLElement | null {
  return lg().dom?.byId(id) ?? document.getElementById(id);
}

function referenceState(): ReferenceStateObj {
  const st = lg().state;
  if (!st) throw new Error('State bridge no inicializada');
  if (!st.reference) {
    st.reference = { file: null, libraryId: null };
  }
  return st.reference;
}

function formatParamValue(value: unknown, key: string): string {
  if (typeof value === 'number') {
    if (key.includes('lufs')) return `${value} LUFS`;
    if (key.includes('freq') || ['hp', 'air', 'ceiling'].includes(key)) return `${value} Hz`;
    if (key.includes('thresh') || key.includes('makeup') || key.includes('gain') || key.includes('drive') || key === 'width') return `${value} dB`;
    if (key.includes('attack') || key.includes('release') || key === 'lrelease') return `${value} ms`;
    if (key.includes('ratio')) return `${value}:1`;
    return String(value);
  }
  return String(value);
}

const REF_PARAM_LABELS: Record<string, string> = {
  eq_max_boost_db: 'EQ Boost máx',
  eq_max_cut_db: 'EQ Cut máx',
  eq_fit_method: 'Método de fit',
  match_loudness: 'Match loudness',
  match_dynamics: 'Match dynamics',
  match_stereo_width: 'Match stereo',
  match_transient: 'Match transient',
  match_sub_bass: 'Match sub-bass',
  match_desser: 'Match de-esser',
  match_saturation: 'Match saturation',
  output_format: 'Formato',
  output_bit_depth: 'Bit depth',
  dither_mode: 'Dither',
  dynamics_margin_db: 'Margen dynamics',
  stereo_blend: 'Stereo blend',
  iterative_eq_passes: 'EQ passes',
  match_crest: 'Match crest',
  crest_amount: 'Crest amount',
  match_spectral_dynamics: 'Spectral dyn',
  spectral_dynamics_amount: 'Spectral amount',
  spectral_dynamics_bins: 'Spectral bins',
  loudness_target_lufs: 'Target LUFS',
  parallel_mix: 'Parallel mix',
  parallel_threshold_db: 'Parallel thr',
  parallel_ratio: 'Parallel ratio',
  parallel_makeup_db: 'Parallel makeup',
  mb_sat_mix: 'MB sat mix',
  mb_sat_low_drive: 'MB sat low',
  mb_sat_mid_drive: 'MB sat mid',
  mb_sat_high_drive: 'MB sat high',
  mb_sat_mode: 'MB sat mode',
  gentle_ceiling_db: 'Gentle ceiling',
  gentle_release_ms: 'Gentle release',
  max_target_lufs: 'Max LUFS',
  premium_match_profile: 'Premium profile',
  premium_vocal_protect: 'Vocal protect',
  adaptive_loudness_weighting: 'Adaptive loudness',
  loudness_sensitivity_amount: 'Loudness sens.',
};

function collectReferenceParamsObj(): Record<string, unknown> {
  return {
    eq_max_boost_db: reqInput('s-ref-eq', '08-reference-mastering').checked
      ? reqInput('s-ref-boost', '08-reference-mastering').value
      : '0',
    eq_max_cut_db: reqInput('s-ref-eq', '08-reference-mastering').checked ? reqInput('s-ref-cut', '08-reference-mastering').value : '0',
    eq_fit_method: reqInput('s-ref-eqmethod', '08-reference-mastering').value,
    match_loudness: reqInput('s-ref-loudness', '08-reference-mastering').checked,
    match_dynamics: reqInput('s-ref-dynamics', '08-reference-mastering').checked,
    match_stereo_width: reqInput('s-ref-stereo', '08-reference-mastering').checked,
    match_transient: reqInput('s-ref-transient', '08-reference-mastering').checked,
    match_sub_bass: reqInput('s-ref-subbass', '08-reference-mastering').checked,
    match_desser: reqInput('s-ref-desser', '08-reference-mastering').checked,
    match_saturation: reqInput('s-ref-saturation', '08-reference-mastering').checked,
    output_format: reqInput('s-format', '08-reference-mastering').value,
    output_bit_depth: reqInput('s-bitdepth', '08-reference-mastering').value,
    dither_mode: reqInput('s-dither-mode', '08-reference-mastering').value,
    dynamics_margin_db: reqInput('s-ref-dynmargin', '08-reference-mastering').value,
    stereo_blend: (parseFloat(reqInput('s-ref-stereoblend', '08-reference-mastering').value) / 100).toFixed(2),
    band_gains_array: lgmdmRef()?.reference?.bandEQ?.getGainsArray() ?? [],
    ms_eq_matching: reqInput('s-ref-ms-eq', '08-reference-mastering')?.checked ?? true, adaptive_loudness_weighting: reqInput('s-ref-adaptive-loudness', '08-reference-mastering')?.checked ?? true,
    loudness_sensitivity_amount: ((parseFloat(reqInput('s-ref-loudness-sensitivity', '08-reference-mastering')?.value || '65') / 100)).toFixed(2),
    premium_match_profile: reqInput('s-ref-premium-profile', '08-reference-mastering')?.value || 'balanced',
    premium_vocal_protect: reqInput('s-ref-vocal-protect', '08-reference-mastering')?.checked ?? true,
    premium_translation_check: reqInput('s-ref-translation-check', '08-reference-mastering')?.checked ?? true,
    premium_alt_versions: reqInput('s-ref-alt-versions', '08-reference-mastering')?.checked ?? false,
    iterative_eq_passes: parseInt(reqInput('s-ref-eq-passes', '08-reference-mastering')?.value || '3', 10),
    match_crest: reqInput('s-ref-match-crest', '08-reference-mastering')?.checked ?? true,
    crest_amount: (parseFloat(reqInput('s-ref-crest-amount', '08-reference-mastering')?.value || '75') / 100).toFixed(2),
    match_spectral_dynamics: reqInput('s-ref-spectral-dynamics', '08-reference-mastering')?.checked ?? true,
    spectral_dynamics_amount: (parseFloat(reqInput('s-ref-spectral-dyn-amount', '08-reference-mastering')?.value || '60') / 100).toFixed(2),
    spectral_dynamics_bins: parseInt(reqInput('s-ref-spectral-dyn-bins', '08-reference-mastering')?.value || '4', 10),
    ...(reqInput('s-ref-fixed-lufs', '08-reference-mastering')?.checked
      ? { loudness_target_lufs: parseFloat(reqInput('s-ref-fixed-lufs-value', '08-reference-mastering')?.value || '-14') }
      : {}),
    use_parallel_compression: reqInput('s-ref-parallel-comp', '08-reference-mastering')?.checked ?? true,
    parallel_mix: (parseFloat(reqInput('s-ref-parallel-mix', '08-reference-mastering')?.value || '28') / 100).toFixed(2),
    parallel_threshold_db: parseFloat(reqInput('s-ref-parallel-thr', '08-reference-mastering')?.value || '-20'),
    parallel_ratio: parseFloat(reqInput('s-ref-parallel-ratio', '08-reference-mastering')?.value || '4'),
    parallel_makeup_db: parseFloat(reqInput('s-ref-parallel-makeup', '08-reference-mastering')?.value || '6'),
    use_multiband_saturation: reqInput('s-ref-mb-sat', '08-reference-mastering')?.checked ?? true,
    mb_sat_mix: (parseFloat(reqInput('s-ref-mb-sat-mix', '08-reference-mastering')?.value || '45') / 100).toFixed(2),
    mb_sat_low_drive: (parseFloat(reqInput('s-ref-mb-sat-low', '08-reference-mastering')?.value || '7') / 100).toFixed(3),
    mb_sat_mid_drive: (parseFloat(reqInput('s-ref-mb-sat-mid', '08-reference-mastering')?.value || '4') / 100).toFixed(3),
    mb_sat_high_drive: (parseFloat(reqInput('s-ref-mb-sat-high', '08-reference-mastering')?.value || '2') / 100).toFixed(3),
    mb_sat_mode: reqInput('s-ref-mb-sat-mode', '08-reference-mastering')?.value || 'tape',
    use_two_stage_limiter: reqInput('s-ref-two-stage-lim', '08-reference-mastering')?.checked ?? true,
    gentle_ceiling_db: parseFloat(reqInput('s-ref-gentle-ceil', '08-reference-mastering')?.value || '-2.5'),
    gentle_release_ms: parseFloat(reqInput('s-ref-gentle-rel', '08-reference-mastering')?.value || '120'),
    max_target_lufs: parseFloat(reqInput('s-ref-max-lufs', '08-reference-mastering')?.value || '-12'),
  };
}

async function submitReferenceMasterJob(): Promise<void> {
  const ui = lg().ui;
  ui.clearResults?.();
  ui.showStatus?.(null, 'Enviando archivos…', 'queued');
  (reqInput('btnMasterRef', '08-reference-mastering') as HTMLButtonElement).disabled = true;

  const fd = new FormData();
  const st = lg().state;
  if (st._previewLibraryId) {
    fd.append('library_id', st._previewLibraryId);
  } else if (st.selectedFile) {
    fd.append('file', st.selectedFile);
  }
  const ref = referenceState();
  // FIX A10: el backend declara `reference_source: str = Form("upload")` y
  // cuando es "upload" exige `reference_file`. Antes el FE no mandaba
  // `reference_source` cuando usaba librería → el backend defaulteaba "upload"
  // → 400 "reference_file required when reference_source=upload". Ahora
  // mandamos explícitamente "library" o "upload" según corresponda.
  if (ref.libraryId) {
    fd.append('reference_library_id', ref.libraryId);
    fd.append('reference_source', 'library');
  } else if (ref.file) {
    fd.append('reference_file', ref.file);
    fd.append('reference_source', 'upload');
  }

  const paramsObj = { ...collectReferenceParamsObj() };
  if (paramsObj.band_gains_array) {
    paramsObj.band_gains_array = JSON.stringify(paramsObj.band_gains_array);
  }
  const params = new URLSearchParams(paramsObj as Record<string, string>);

  try {
    const api = lg().api;
    const url = `${api.apiBase()}/master/reference?${params.toString()}`;
    const res = await api.client.post(url, { body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json() as { job_id: string };
    st.currentJobId = data.job_id as JobId;
    ui.showStatus?.(null, `Job ${data.job_id.slice(0, 8)}… en cola (matching por referencia)`, 'queued');
    startReferencePolling(data.job_id);
  } catch (e) {
    console.debug('❌ Error al enviar (referencia):', e);
    ui.showStatus?.(null, 'Error: ' + (e as Error).message, 'error');
    (reqInput('btnMasterRef', '08-reference-mastering') as HTMLButtonElement).disabled = false;
  }
}

// ── refBandEQ ──────────────────────────────────────────────────────

(function setupBandEQ(): void {
  const container = reqEl('ref-band-controls', '08-reference-mastering');
  const countSlider = byId('s-band-count') as HTMLInputElement | null;
  const countVal = reqEl('v-band-count', '08-reference-mastering');
  const resetBtn = byId('btn-band-reset');
  if (!countSlider || !resetBtn) {
    const _lg = lgmdmRef(); if (_lg) _lg.reference = _lg.reference || {};
    return;
  }
  const MIN_HZ = 20;
  const MAX_HZ = 20000;
  let _bands: Array<{ freq_hz: number; gain_db: number }> = [];

  function logFreqs(n: number): number[] {
    return Array.from({ length: n }, (_, i) => MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (n - 1)));
  }

  function interpolate(oldBands: Array<{ freq_hz: number; gain_db: number }>, newFreqs: number[]): number[] {
    if (!oldBands.length) return newFreqs.map(() => 0);
    return newFreqs.map((f) => {
      const logF = Math.log10(f);
      const logFs = oldBands.map((b) => Math.log10(b.freq_hz));
      if (logF <= logFs[0]) return oldBands[0].gain_db;
      if (logF >= logFs[logFs.length - 1]) return oldBands[logFs.length - 1].gain_db;
      for (let i = 0; i < logFs.length - 1; i++) {
        if (logF >= logFs[i] && logF <= logFs[i + 1]) {
          const t = (logF - logFs[i]) / (logFs[i + 1] - logFs[i]);
          return oldBands[i].gain_db * (1 - t) + oldBands[i + 1].gain_db * t;
        }
      }
      return 0;
    });
  }

  function fmtHz(hz: number): string {
    if (hz >= 1000) return (hz / 1000).toFixed(hz >= 10000 ? 0 : 1) + ' kHz';
    return Math.round(hz) + ' Hz';
  }

  function render(n: number, interpolatedGains: number[] | null): void {
    const freqs = logFreqs(n);
    container.innerHTML = '';
    _bands = [];

    freqs.forEach((freq, i) => {
      const gain = interpolatedGains ? Math.round(interpolatedGains[i] * 2) / 2 : 0;
      _bands.push({ freq_hz: freq, gain_db: gain });

      const div = document.createElement('div');
      div.className = 'param';
      div.style.marginBottom = n > 14 ? '0.05rem' : '0.1rem';

      const valId = 'dyn-band-val-' + i;
      const slId = 'dyn-band-sl-' + i;
      const gainStr = (gain >= 0 ? '+' : '') + gain.toFixed(1) + ' dB';

      div.innerHTML = `
        <label style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">
          ${fmtHz(freq)}
        </label>
        <span class="val" id="${valId}" style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">${gainStr}</span>
        <input type="range" id="${slId}" min="-12" max="12" step="0.5" value="${gain}"
          style="${n > 14 ? 'height:3px;' : ''}" />
      `;
      container.appendChild(div);

      const sl = div.querySelector('input') as HTMLInputElement;
      const val = div.querySelector('span.val') as HTMLElement;
      sl.addEventListener('input', () => {
        const v = parseFloat(sl.value);
        _bands[i].gain_db = v;
        val.textContent = (v >= 0 ? '+' : '') + v.toFixed(1) + ' dB';
        container.dispatchEvent(new CustomEvent('bandchange', { bubbles: true }));
      });
    });
  }

  function setBandCount(n: number, skipInterp: boolean): void {
    const newFreqs = logFreqs(n);
    const gains = skipInterp ? null : interpolate(_bands, newFreqs);
    render(n, gains);
    countVal.textContent = String(n);
  }

  setBandCount(7, true);

  countSlider.addEventListener('input', () => {
    const n = parseInt(countSlider.value, 10);
    setBandCount(n, false);
    container.dispatchEvent(new CustomEvent('bandchange', { bubbles: true }));
  });

  resetBtn.addEventListener('click', () => {
    const n = parseInt(countSlider.value, 10);
    setBandCount(n, true);
    container.dispatchEvent(new CustomEvent('bandchange', { bubbles: true }));
  });

  const refApi = lgmdmRef()?.reference;
  if (refApi) {
    refApi.bandEQ = {
      getGainsArray() {
        return _bands.map((b) => ({ freq_hz: Math.round(b.freq_hz * 10) / 10, gain_db: b.gain_db }));
      },
      getBandCount() {
        return _bands.length;
      },
    };
  }
})();

// ── Preview en tiempo real con WebSocket ─────────────────────────────

(function setupRefPreview(): void {
  let refWs: WebSocket | null = null;
  const refState = referenceState();
  const refAudioState = (lg().state.audio?.reference) || (lg().state.audio = { reference: { active: false, playTime: 0 } }).reference!;
  let refSessionId: string | null = null;
  let refRefSessionId: string | null = null;
  let debounceTimer: number | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: number | null = null;
  const MAX_RECONNECT = 5;
  const RECONNECT_BASE_MS = 1000;
  const RECONNECT_MAX_MS = 30000;

  function updateRefPreviewBtn(): void {
    const st = lg().state;
    const ok = !!(st.selectedFile && refState.file);
    const btn = byId('btnRefPreview') as HTMLButtonElement | null;
    if (btn) btn.disabled = !ok;
  }
  const _lg = lgmdmRef() as LgmdmReferenceSlice;
  const refApi = (_lg.reference = _lg.reference || {});
  const baseUpdate = refApi.updateButtonState;
  refApi.updateButtonState = function updateRefButtonState(): void {
    baseUpdate?.();
    updateRefPreviewBtn();
  };

  function drawEqCurve(curve: Array<{ freq_hz: number; gain_db: number }>): void {
    const wrap = byId('refEqCurveWrap');
    const canvas = byId('refEqCurveCanvas') as HTMLCanvasElement | null;
    if (!wrap || !canvas || !curve || !curve.length) return;
    wrap.style.display = 'block';
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const ZERO_Y = H / 2;
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.beginPath();
    ctx.moveTo(0, ZERO_Y);
    ctx.lineTo(W, ZERO_Y);
    ctx.stroke();
    const gains = curve.map((p) => p.gain_db);
    const MAX_G = Math.max(6, ...gains.map(Math.abs));
    ctx.beginPath();
    const cs = getComputedStyle(document.documentElement);
    ctx.strokeStyle = cs.getPropertyValue('--ui-accent-2').trim() || 'rgba(125,232,255,0.85)';
    ctx.lineWidth = 1.5;
    curve.forEach((p, i) => {
      const x = (i / (curve.length - 1)) * W;
      const y = ZERO_Y - (p.gain_db / MAX_G) * (H * 0.42);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function updateMetrics(m: Record<string, unknown>): void {
    const set = (id: string, v: string): void => { const el = byId(id); if (el) el.textContent = v; };
    set('rp-lufs', m.lufs_momentary != null ? (m.lufs_momentary as number).toFixed(1) + ' LUFS' : '--');
    set('rp-peak', m.peak_db != null ? (m.peak_db as number).toFixed(1) + ' dBFS' : '--');
    set('rp-rms', m.rms_db != null ? (m.rms_db as number).toFixed(1) + ' dB' : '--');
    set('rp-corr', m.stereo_correlation != null ? (m.stereo_correlation as number).toFixed(2) : '--');
  }

  function initAudioCtx(): AudioContext | null {
    // V1: usar audioEngine.getContext() — antes leía lg().audio?.getContext?.()
    // que nunca se asigna → retornaba null → scheduleChunk era no-op silencioso.
    return audioEngine.getContext();
  }

  // RP1: pool de AudioBuffers para scheduleChunk — los source nodes son
  // one-shot (no se pueden pooled), pero los AudioBuffer sí: reusar 4 evita
  // createBuffer + getChannelData alloc por chunk. Realloc si cambia
  // sampleRate/channels/samples; el último chunk parcial bypassa el pool.
  const AUDIO_BUFFER_POOL_SIZE = 4;
  interface PoolEntry { buf: AudioBuffer; inUse: boolean }
  let _bufferPool: PoolEntry[] = [];
  let _bufferPoolIdx = 0;
  let _bufferPoolSr = 0;
  let _bufferPoolCh = 0;
  let _bufferPoolSamples = 0;

  function acquireBuffer(sr: number, channels: number, samples: number): AudioBuffer | null {
    const actx = initAudioCtx();
    if (!actx) return null;
    if (sr !== _bufferPoolSr || channels !== _bufferPoolCh || samples !== _bufferPoolSamples || _bufferPool.length === 0) {
      _bufferPool = [];
      for (let i = 0; i < AUDIO_BUFFER_POOL_SIZE; i++) {
        _bufferPool.push({ buf: actx.createBuffer(channels, samples, sr), inUse: false });
      }
      _bufferPoolSr = sr;
      _bufferPoolCh = channels;
      _bufferPoolSamples = samples;
      _bufferPoolIdx = 0;
    }
    // Chunk parcial (samples != del tamaño negociado) — no entra al pool.
    if (samples !== _bufferPoolSamples) {
      return actx.createBuffer(channels, samples, sr);
    }
    for (let i = 0; i < AUDIO_BUFFER_POOL_SIZE; i++) {
      const idx = (_bufferPoolIdx + i) % AUDIO_BUFFER_POOL_SIZE;
      if (!_bufferPool[idx].inUse) {
        _bufferPool[idx].inUse = true;
        _bufferPoolIdx = (idx + 1) % AUDIO_BUFFER_POOL_SIZE;
        return _bufferPool[idx].buf;
      }
    }
    // Todos en uso — fallback a alloc one-off (no contamina el pool).
    return actx.createBuffer(channels, samples, sr);
  }

  function releaseBuffer(buf: AudioBuffer): void {
    for (let i = 0; i < _bufferPool.length; i++) {
      if (_bufferPool[i].buf === buf) {
        _bufferPool[i].inUse = false;
        return;
      }
    }
  }

  let previewActive = false;
  const INITIAL_BUFFER_SEC = 0.30;
  const MIN_AHEAD_SEC = 0.15;

  function scheduleChunk(pcmBytes: ArrayBuffer, sr: number, channels: number): void {
    if (!previewActive) return;
    const actx = initAudioCtx();
    if (!actx) return;
    const i16 = new Int16Array(pcmBytes);
    const samples = i16.length / channels;
    const buf = acquireBuffer(sr, channels, samples);
    if (!buf) return;
    for (let ch = 0; ch < channels; ch++) {
      const chData = buf.getChannelData(ch);
      for (let i = 0; i < samples; i++) chData[i] = i16[i * channels + ch] / 32767;
      const FADE = Math.min(Math.floor(sr * 0.010), Math.floor(samples / 4));
      for (let i = 0; i < FADE; i++) {
        chData[i] *= i / FADE;
        chData[samples - 1 - i] *= i / FADE;
      }
    }
    const src = actx.createBufferSource();
    src.buffer = buf;
    src.connect(actx.destination);
    const now = actx.currentTime;
    if (refAudioState.playTime < now + MIN_AHEAD_SEC) refAudioState.playTime = now + INITIAL_BUFFER_SEC;
    src.start(refAudioState.playTime);
    // RP1: liberar el buffer del pool cuando el source termina — evita
    // entregar un buffer todavía en reproducción a un chunk nuevo.
    src.onended = () => { src.disconnect(); releaseBuffer(buf); };
    refAudioState.playTime += buf.duration;
  }

  function stopRefPreview(): void {
    previewActive = false;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
    // FIX M-NEW-9: limpiar debounceTimer (setTimeout 120ms que dispara
    // launchRefPreview). Antes no se cancelaba en stopRefPreview → podía
    // disparar launchRefPreview post-stop.
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    reconnectAttempts = 0;
    if (refWs) {
      try { refWs.close(); } catch (_) { /* ignore */ }
      refWs = null;
    }
    // FIX A9: limpiar el interval de polling de referencia. Antes no se
    // limpiaba en stopRefPreview ni en beforeunload → si el job quedaba en
    // 'processing' indefinido, el interval seguía polleando para siempre.
    const st = lg().state;
    if (st?.referencePollInterval) {
      clearInterval(st.referencePollInterval);
      st.referencePollInterval = null;
    }
    refAudioState.playTime = 0;
    const status = byId('rp-status');
    if (status) status.textContent = '';
  }
  refApi.stopRefPreview = stopRefPreview;

  async function launchRefPreview(): Promise<void> {
    stopRefPreview();
    const panel = byId('refPreviewPanel');
    if (panel) panel.style.display = 'block';
    const st = lg().state;
    if (!st.selectedFile || !refState.file) return;
    // W3: resume explícito del AudioContext dentro del gesture (click que
    // disparó launchRefPreview). Sin esto, scheduleChunk puede agendar un
    // source sobre un ctx suspendido → silencio sin error.
    await audioEngine.resume();
    if (!refSessionId) refSessionId = genUUID();
    if (!refRefSessionId) refRefSessionId = genUUID();

    const status = byId('rp-status');
    if (status) status.textContent = 'Conectando…';

    const api = lg().api;
    // FIX K9: el helper real es `wsAuthUrl` (api.ts, devuelve
    // Promise<WsAuthTarget> = { url, protocols }). Antes se llamaba
    // `wsAuthHandle` que NO EXISTE en ningún .ts → el guard era siempre
    // true y el WS del ref-stream nunca se abría.
    if (!api.wsAuthUrl) {
      console.warn('[reference] wsAuthUrl no disponible');
      return;
    }
    let wsChannels = 2;
    let wsSr = 44100;
    let pendingMetrics: Record<string, unknown> | null = null;

    try {
      const { url: wsTarget, protocols } = await api.wsAuthUrl('/ws/ref-stream');
      // FIX WS-2: protocols debe pasar a WebSocket — el backend ecoa
      // "lgmdm-ws-ticket" y Chrome cierra con 1006 si no lo ofrecimos.
      refWs = new WebSocket(wsTarget, protocols);
      refWs.binaryType = 'arraybuffer';
    } catch (e) {
      console.warn('[reference] WS auth failed:', e);
      // WS6: antes el catch logueaba y retornaba sin actualizar el status →
      // "Conectando…" quedaba para siempre. Ahora surfacea el error.
      if (status) status.textContent = 'Error de auth: ' + (e as Error).message;
      return;
    }

    refWs.onopen = () => {
      reconnectAttempts = 0;
      const params = collectReferenceParamsObj();
      const bandGains = lgmdmRef()?.reference?.bandEQ?.getGainsArray() ?? [];
      const refLibId = lg().state.reference?.libraryId;
      const ws = refWs;
      if (!ws) return;
      ws.send(JSON.stringify({
        session_id: refSessionId,
        ref_session_id: refRefSessionId,
        chunk_seconds: 1.0,
        eq_bands: parseInt(params.eq_bands as string || '28', 10),
        eq_max_boost_db: parseFloat(params.eq_max_boost_db as string || '6'),
        eq_max_cut_db: parseFloat(params.eq_max_cut_db as string || '-9'),
        eq_q: parseFloat(params.eq_q as string || '1.3'),
        eq_match_blend: parseFloat(params.eq_match_blend as string || '0.75'),
        eq_fit_method: params.eq_fit_method || 'heuristic',
        ms_eq_matching: params.ms_eq_matching !== false,
        iterative_eq_passes: parseInt(params.iterative_eq_passes as string || '3', 10),
        band_gains_array: bandGains,
        ...(refLibId ? { ref_library_id: refLibId } : {}),
      }));
    };

    refWs.onmessage = async (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        scheduleChunk(evt.data, wsSr, wsChannels);
        if (pendingMetrics) { updateMetrics(pendingMetrics); pendingMetrics = null; }
        return;
      }
      let msg: Record<string, unknown>;
      try { msg = JSON.parse(evt.data as string); } catch (e) { console.warn('[reference] frame JSON inválido', e); return; }
      if (!refWs || refWs.readyState !== WebSocket.OPEN) return;

      if (msg.event === 'need_upload') {
        previewActive = true;
        if (status) status.textContent = 'Subiendo track…';
        const buf = await lg().state.selectedFile?.arrayBuffer();
        if (!refWs || refWs.readyState !== WebSocket.OPEN) return;
        if (buf) {
          refWs.send(buf);
          refWs.send(JSON.stringify({ event: 'upload_complete' }));
        }
      } else if (msg.event === 'use_cache') {
        previewActive = true;
        refWs.send(JSON.stringify({ event: 'params_only' }));
      } else if (msg.event === 'need_upload_ref') {
        previewActive = true;
        if (status) status.textContent = 'Subiendo referencia…';
        if (!refState.file || typeof refState.file.arrayBuffer !== 'function') {
          if (status) status.textContent = 'Error: referencia de biblioteca no disponible para preview.';
          refWs.close();
          return;
        }
        const buf = await refState.file.arrayBuffer();
        if (!refWs || refWs.readyState !== WebSocket.OPEN) return;
        if (buf) {
          refWs.send(buf);
          refWs.send(JSON.stringify({ event: 'upload_complete' }));
        }
      } else if (msg.event === 'use_cache_ref') {
        previewActive = true;
        refWs.send(JSON.stringify({ event: 'params_only' }));
      } else if (msg.event === 'analyzing') {
        if (status) status.textContent = (msg.message as string) || 'Analizando…';
      } else if (msg.event === 'matching_ready') {
        if (status) status.textContent = '▶ Reproduciendo preview…';
        drawEqCurve(msg.eq_curve as Array<{ freq_hz: number; gain_db: number }>);
      } else if (msg.event === 'chunk') {
        wsChannels = (msg.channels as number) || 2;
        wsSr = (msg.sample_rate as number) || 44100;
        pendingMetrics = msg.metrics as Record<string, unknown>;
      } else if (msg.event === 'done') {
        if (status) status.textContent = '✓ Preview completado';
      } else if (msg.event === 'error') {
        if (status) status.textContent = 'Error: ' + (msg.message as string);
      }
    };

    refWs.onerror = (e) => {
      // WS4: antes descartaba el event sin loguear.
      console.warn('[ref-stream] WS error', e);
      if (status) status.textContent = 'Error de conexión WebSocket.';
    };
    // WS8 TODO: heartbeat (setInterval ping cada 15s, close si no pong en 30s)
    // — skip: backend /ws/ref-stream no tiene handler de ping/pong (verificado:
    // grep "ping|pong" en routers/streaming.py → 0 matches). Sin eco backend,
    // un heartbeat client-side-only cerraría el socket cada 30s sin razón.
    refWs.onclose = (ev: CloseEvent) => {
      refWs = null;
      if (status && status.textContent === '▶ Reproduciendo preview…') status.textContent = '';
      // WS1: inspeccionar el code — 4001 = auth fail, no reconectar.
      if (ev.code === 4001) {
        if (status) status.textContent = 'Sesión expirada';
        previewActive = false;
        reconnectAttempts = 0;
        return;
      }
      if (!previewActive) return;
      if (reconnectAttempts >= MAX_RECONNECT) {
        if (status) status.textContent = 'Conexión perdida (máx reintentos).';
        return;
      }
      // WS3: jitter — delay * (0.5 + Math.random()) evita thundering herd
      // si varios clients reconectan a la vez tras un restart del backend.
      const delay = Math.min(RECONNECT_BASE_MS * Math.pow(2, reconnectAttempts), RECONNECT_MAX_MS) * (0.5 + Math.random());
      reconnectAttempts++;
      if (status) status.textContent = `Reconectando en ${Math.round(delay / 1000)}s…`;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        void launchRefPreview();
      }, delay);
    };
  }

  function debouncedPreview(): void {
    if (!refWs) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => { void launchRefPreview(); }, 120);
  }

  (byId('ref-band-controls'))?.addEventListener('bandchange', debouncedPreview);

  (byId('btnRefPreview') as HTMLButtonElement | null)?.addEventListener('click', () => {
    refSessionId = genUUID();
    refRefSessionId = genUUID();
    void launchRefPreview();
  });

  (byId('btnRefPreviewStop') as HTMLButtonElement | null)?.addEventListener('click', () => {
    stopRefPreview();
    const panel = byId('refPreviewPanel');
    if (panel) panel.style.display = 'none';
  });

  refApi.onFileSelected = () => {
    refSessionId = null;
    updateRefPreviewBtn();
  };
  refApi.onRefFileSelected = () => {
    refRefSessionId = null;
    updateRefPreviewBtn();
  };
  window.addEventListener('beforeunload', () => {
    try { stopRefPreview(); } catch (_) { /* ignore */ }
  }, { once: true });
})();

// FIX M-NEW-1: el flag `referenceMasteringBound` se seteaba pero no se
// consultaba → el comentario "HMR-safe" mentía. Como este módulo es ESM
// y Vite hace full page reload (no HMR soft), el flag es cosmético. Lo
// quitamos para no tener un comentario que miente (regla 7). Si en el
// futuro se habilita HMR soft, agregar `if (LGMDM.referenceMasteringBound)
// return;` al inicio del módulo.

// ── Botón master con referencia ─────────────────────────────────────

(byId('btnMasterRef') as HTMLButtonElement | null)?.addEventListener('click', () => {
  const st = lg().state;
  if (!st.selectedFile || !referenceState().file) {
    lg().ui.showStatus?.(null, 'Seleccioná tu track y un track de referencia', 'error');
    return;
  }
  lg().ui.clearResults?.();
  const paramsObj = collectReferenceParamsObj();
  const panel = document.createElement('div');
  panel.className = 'params-preview';
  let html = `<h3>🔎 Parámetros corregidos — matching por referencia</h3><div class="pp-group"><div class="pp-grid">`;
  Object.entries(paramsObj).forEach(([k, v]) => {
    html += `<div class="pp-item"><span>${REF_PARAM_LABELS[k] || k}</span><span>${formatParamValue(v, k)}</span></div>`;
  });
  html += `</div></div><div class="pp-actions">
    <button class="btn btn-secondary" id="ppRefCancelBtn">✕ Cancelar</button>
    <button class="btn btn-primary" id="ppRefConfirmBtn">✅ Confirmar y masterizar</button>
  </div>`;
  panel.innerHTML = html;
  lg().ui.getContent?.()?.prepend(panel);
  panel.querySelector('#ppRefConfirmBtn')?.addEventListener('click', () => {
    panel.remove();
    void submitReferenceMasterJob();
  });
  panel.querySelector('#ppRefCancelBtn')?.addEventListener('click', () => panel.remove());
});

// ── Polling del job de referencia ───────────────────────────────────

function startReferencePolling(jobId: string): void {
  const st = lg().state;
  if (st.referencePollInterval) clearInterval(st.referencePollInterval);
  let pollFailures = 0;
  const interval = window.setInterval(async () => {
    try {
      const api = lg().api;
      const res = await api.client.get(`${api.apiBase()}/job/${jobId}`);
      pollFailures = 0;
      const data = await res.json() as {
        status: string;
        progress?: number;
        stage?: string;
        reference_match?: Record<string, unknown>;
        analysis_reference?: Record<string, unknown>;
        analysis_before?: { lufs?: number };
        analysis_after?: { lufs?: number; fft_spectrum?: number[] };
        mix_advice_after?: Record<string, unknown>;
        error?: string;
      };
      if (data.status === 'queued') {
        lg().ui.showStatus?.(null, 'En cola…', 'queued', data.progress, data.stage);
      } else if (data.status === 'processing') {
        lg().ui.showStatus?.(null, 'Masterizando por referencia…', 'processing', data.progress, data.stage);
      } else if (data.status === 'done') {
        clearInterval(interval);
        lg().ui.showStatus?.(null, 'Masterizado por referencia ✓', 'done');
        (reqInput('btnMasterRef', '08-reference-mastering') as HTMLButtonElement).disabled = false;
        const refUrl = `${api.apiBase()}/download/${jobId}`;
        if (!st.jobs) (st as { jobs: NonNullable<StateShape['jobs']> }).jobs = { mastering: {}, reference: {} };
        const jobs = st.jobs;
        if (!jobs) return;
        if (!jobs.reference) jobs.reference = {};
        jobs.reference.downloadUrl = refUrl;
        st.downloadUrl = refUrl;
        const btn = reqInput('btnDownload', '08-reference-mastering') as HTMLButtonElement;
        btn.style.display = 'block';
        const nameInput = reqInput('trackNameInput', '08-reference-mastering') as HTMLInputElement;
        nameInput.style.display = 'block';
        window.prefillTrackNameFromFile?.();
        st.downloadFilename = 'reference-master.wav';
        st.activeJobType = 'reference';
        if (btn) {
          lg().ui.bindOnce?.(btn, 'click', async () => {
            try {
              btn.disabled = true;
              const dlUrl = st.downloadUrl || '';
              const filename = st.downloadFilename || (st.activeJobType === 'reference' ? 'reference-master.wav' : 'mastered.wav');
              await api.downloadAuthenticated?.(dlUrl + (window.currentTrackNameParam?.() || ''), { filename });
            } catch (e) {
              lg().errors.handleClientError?.(e, 'No se pudo descargar el master de referencia.', { context: 'reference-download' });
            } finally {
              btn.disabled = false;
            }
          }, 'app-master-download');
        }

        let abBtn = document.getElementById('btnRefAB') as HTMLButtonElement | null;
        if (!abBtn) {
          abBtn = document.createElement('button');
          abBtn.id = 'btnRefAB';
          abBtn.className = 'btn';
          abBtn.style.cssText = 'display:block;margin-top:0.4rem;background:var(--ui-surface-2);border:1px solid var(--ui-accent-2);color:var(--ui-accent-2);font-size:0.75rem';
          abBtn.textContent = '⇄ A/B Original vs Master';
          btn.parentElement?.insertBefore(abBtn, btn.nextSibling);
        }
        abBtn.style.display = 'block';
        const btnEl = abBtn;
        if (!abBtn.dataset.refAbWired) {
          abBtn.dataset.refAbWired = 'true';
          abBtn.addEventListener('click', async () => {
            btnEl.disabled = true;
            btnEl.textContent = 'Cargando master…';
            try {
              const resp = await api.client.get(st.downloadUrl || '');
              if (!resp.ok) throw new Error('Error descargando master');
              const masterBlob = await resp.blob();
              if (typeof window.setupABPlayer === 'function') {
                await window.setupABPlayer(masterBlob);
                const wrap = reqInput('previewAudioWrap', '08-reference-mastering');
                if (wrap) wrap.scrollIntoView({ behavior: 'smooth', block: 'center' });
                btnEl.textContent = '⇄ A/B activo (ver preview arriba)';
              } else {
                throw new Error('No se pudo preparar el A/B autenticado.');
              }
            } catch (e) {
              btnEl.textContent = '⚠ Reintentar A/B';
              btnEl.disabled = false;
              console.debug('A/B error:', e);
              lg().ui.showToast?.((e as Error).message || 'Error al cargar master', 'error');
            }
          });
        }

        const rBtn = reqInput('btnReport', '08-reference-mastering') as HTMLButtonElement;
        rBtn.style.display = 'block';
        rBtn.addEventListener('click', () => { void window.downloadReport?.(jobId); });
        if (data.analysis_before?.lufs != null) {
          const lufs = data.analysis_after?.lufs ?? data.analysis_before.lufs!;
          window.showLoudnessMeter?.(lufs);
        }
        if (data.reference_match) {
          renderReferenceMatch(data.reference_match, data.analysis_reference || {}, data.analysis_after || {});
        }
        window.renderAnalysisComparison?.(data.analysis_before || {}, data.analysis_after || {});
        if (data.analysis_reference?.fft_spectrum && data.analysis_after?.fft_spectrum) {
          (window.renderFFT as ((s: Array<{ label: string; data: unknown; color?: string }>) => void) | undefined)?.([
            { label: 'Referencia', data: data.analysis_reference.fft_spectrum, color: 'var(--ui-accent-2)' },
            { label: 'Resultado', data: data.analysis_after.fft_spectrum, color: 'var(--ui-warn)' },
          ]);
        }
        if (data.mix_advice_after) {
          window.renderAdvicePanel?.(data.mix_advice_after as Record<string, unknown>, 'Evaluación', '— Resultado');
        }
        if (data.analysis_after) {
          lg().ai.setContext?.({ ...data.analysis_after, mix_advice: data.mix_advice_after });
        }
      } else if (data.status === 'error') {
        clearInterval(interval);
        lg().ui.showStatus?.(null, 'Error: ' + data.error, 'error');
        (reqInput('btnMasterRef', '08-reference-mastering') as HTMLButtonElement).disabled = false;
      }
    } catch (e) {
      console.debug('Poll error (referencia):', e);
      pollFailures++;
      if (pollFailures >= 5) {
        clearInterval(interval);
        st.referencePollInterval = null;
        console.debug('Polling de referencia abortado tras 5 fallos');
      }
    }
  }, 1500);
  st.referencePollInterval = interval;
}

// ── Render del match con referencia ──────────────────────────────────

function _matchBarRow(label: string, ownVal: number | null | undefined, refVal: number | null | undefined, unit: string, closeThresholdAbs: number, fmt?: (v: number) => string): string {
  const fmtFn = fmt || ((v: number) => v.toString());
  if (ownVal == null || refVal == null) return '';
  const diff = Math.abs(ownVal - refVal);
  const ok = diff <= closeThresholdAbs;
  const lo = Math.min(ownVal, refVal, 0) - Math.abs(refVal || 1) * 0.15;
  const hi = Math.max(ownVal, refVal, 0) + Math.abs(refVal || 1) * 0.15;
  const range = hi - lo || 1;
  const ownPct = Math.max(0, Math.min(100, ((ownVal - lo) / range) * 100));
  const refPct = Math.max(0, Math.min(100, ((refVal - lo) / range) * 100));
  return `
  <div class="match-bar-row">
    <div class="match-bar-label">${ok ? '✓' : '⚠'} ${label}</div>
    <div class="match-bar-track">
      <div class="match-bar-marker match-bar-ref" style="left:${refPct}%" title="Referencia: ${fmtFn(refVal)}${unit}"></div>
      <div class="match-bar-fill" style="width:${ownPct}%"></div>
    </div>
    <div class="match-bar-values">${fmtFn(ownVal)}${unit} <span class="lgjs-s-7bdef099">vs ref ${fmtFn(refVal)}${unit}</span></div>
  </div>`;
}

function renderReferenceAnalysisPanel(refAnalysis: Record<string, unknown> | undefined, ownAnalysis: Record<string, unknown> | undefined, rm: Record<string, unknown> | undefined): string {
  if (!refAnalysis) return '';
  const spec = (refAnalysis.spectrum as Record<string, number>) || {};
  const ownSpec = ((ownAnalysis || {}).spectrum as Record<string, number>) || {};
  const SPEC_BANDS = [
    { key: 'sub_bass', label: 'Sub-graves', range: '20–80 Hz' },
    { key: 'bass', label: 'Graves', range: '80–250 Hz' },
    { key: 'low_mid', label: 'Low-Mid', range: '250–800 Hz' },
    { key: 'mid', label: 'Medios', range: '800–2.5k' },
    { key: 'high_mid', label: 'High-Mid', range: '2.5–6 kHz' },
    { key: 'presence', label: 'Presencia', range: '6–12 kHz' },
    { key: 'air', label: 'Aire', range: '12–20 kHz' },
  ];
  const refVals = SPEC_BANDS.map((b) => spec[b.key] ?? -60);
  const maxRef = Math.max(...refVals, -60);
  const minRef = Math.min(...refVals, -80);
  const range = maxRef - minRef || 1;

  const esc = lg().ui.escapeHtml || ((s: unknown) => String(s));

  const specBarsHtml = SPEC_BANDS.map((b) => {
    const rv = spec[b.key] ?? null;
    const sv = ownSpec[b.key] ?? null;
    if (rv === null) return '';
    const refPct = Math.max(4, ((rv - minRef) / range) * 100);
    const srcPct = sv !== null ? Math.max(4, ((sv - minRef) / range) * 100) : null;
    const diff = sv !== null ? (rv - sv) : null;
    const diffStr = diff !== null ? (diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)) + ' dB' : '';
    const diffColor = diff === null ? '' : Math.abs(diff) < 2 ? 'var(--ui-good)' : Math.abs(diff) < 5 ? 'var(--ui-warn)' : 'var(--ui-danger)';
    return `<div class="lgjs-s-5e07f2f4">
      <div class="lgjs-s-9b04fdf1">
        <span><b>${b.label}</b> <span class="lgjs-s-57f9e31d">${b.range}</span></span>
        <span style="color:${diffColor};font-family:var(--mono)">${diffStr}</span>
      </div>
      <div class="lgjs-s-13feb0ac">
        ${srcPct !== null ? `<div style="position:absolute;left:0;top:0;height:100%;width:${srcPct.toFixed(1)}%;background:var(--ui-accent);opacity:.45;border-radius:4px"></div>` : ''}
        <div style="position:absolute;left:0;top:0;height:100%;width:${refPct.toFixed(1)}%;background:var(--ui-accent-2);opacity:.75;border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');

  const dynMetrics = [
    { label: 'RMS', ownVal: ownAnalysis?.rms_db, refVal: refAnalysis.rms_db, unit: ' dB', fmt: (v: number) => v.toFixed(1) },
    { label: 'Pico', ownVal: ownAnalysis?.peak_db, refVal: refAnalysis.peak_db, unit: ' dBFS', fmt: (v: number) => v.toFixed(1) },
    { label: 'Crest Factor', ownVal: ownAnalysis?.crest_factor_db, refVal: refAnalysis.crest_factor_db, unit: ' dB', fmt: (v: number) => v.toFixed(1) },
    { label: 'LRA', ownVal: ownAnalysis?.lra, refVal: refAnalysis.lra, unit: ' LU', fmt: (v: number) => v?.toFixed(1) ?? '--' },
    { label: 'LUFS', ownVal: ownAnalysis?.lufs, refVal: refAnalysis.lufs, unit: ' LUFS', fmt: (v: number) => v.toFixed(1) },
  ];
  const dynRows = dynMetrics.map((m) => {
    if (m.refVal == null) return '';
    const diff = m.ownVal != null ? ((m.refVal as number) - (m.ownVal as number)) : null;
    const dc = diff === null ? '' : Math.abs(diff) < 1 ? 'var(--ui-good)' : Math.abs(diff) < 3 ? 'var(--ui-warn)' : 'var(--ui-danger)';
    return `<div class="lgjs-s-8f2ca087">
      <span class="lgjs-s-57f9e31d">${m.label}</span>
      <span><span class="lgjs-s-8b7bf11b">${m.ownVal != null ? m.fmt(m.ownVal as number) + m.unit : '--'}</span>
      <span class="lgjs-s-2a8d43fd">→</span>
      <span class="lgjs-s-b04dd70a">${m.fmt(m.refVal as number)}${m.unit}</span>
      ${diff !== null ? `<span style="color:${dc};margin-left:.35rem;font-family:var(--mono)">(${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>` : ''}
      </span>
    </div>`;
  }).join('');

  const ownCorr = ownAnalysis?.stereo_correlation as number | undefined ?? null;
  const refCorr = refAnalysis.stereo_correlation as number | undefined ?? null;
  const stereoRow = (ownCorr !== null && refCorr !== null)
    ? `<div class="lgjs-s-f6b7e75c">
        <span class="lgjs-s-57f9e31d">Correlación estéreo</span>
        <span><span class="lgjs-s-8b7bf11b">${ownCorr.toFixed(2)}</span>
        <span class="lgjs-s-2a8d43fd">→</span>
        <span class="lgjs-s-b04dd70a">${refCorr.toFixed(2)}</span></span>
       </div>` : '';

  const bg = (rm?.band_gains_applied as Record<string, number>) || {};
  const BAND_LABELS: Record<string, string> = { sub: 'Sub', bass: 'Graves', low_mid: 'Low-Mid', mid: 'Medios', high_mid: 'High-Mid', presence: 'Presencia', air: 'Aire' };
  const bgApplied = Object.entries(bg).filter(([, v]) => Math.abs(v) >= 0.1);
  const bgHtml = bgApplied.length
    ? `<div class="lgjs-s-432d224b">Ajustes manuales aplicados: ${bgApplied.map(([k, v]) => `<span style="color:${v > 0 ? 'var(--ui-good)' : 'var(--ui-danger)'}"><b>${BAND_LABELS[k] || k}</b> ${v > 0 ? '+' : ''}${v.toFixed(1)} dB</span>`).join(' · ')}</div>`
    : '';

  const msEqCurveMid = rm?.eq_curve_mid_db as Array<{ freq_hz: number; gain_db: number }> | undefined;
  let msEqHtml = '';
  if (msEqCurveMid && msEqCurveMid.length) {
    setTimeout(() => {
      const cv = byId('refMsEqCanvas') as HTMLCanvasElement | null;
      if (!cv) return;
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      const W = cv.width;
      const H = cv.height;
      const ZERO = H / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.moveTo(0, ZERO);
      ctx.lineTo(W, ZERO);
      ctx.stroke();
      ([
        [rm?.eq_curve_mid_db as Array<{ freq_hz: number; gain_db: number }> | undefined, 'var(--ui-accent-2)'],
        [rm?.eq_curve_side_db as Array<{ freq_hz: number; gain_db: number }> | undefined, 'var(--ui-accent)'],
      ] as Array<[Array<{ freq_hz: number; gain_db: number }> | undefined, string]>).forEach(([curve, color]) => {
        if (!curve || !curve.length) return;
        const gains = curve.map((p) => p.gain_db);
        const maxG = Math.max(6, ...gains.map(Math.abs));
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        curve.forEach((p, i) => {
          const x = (i / (curve.length - 1)) * W;
          const y = ZERO - (p.gain_db / maxG) * (H * 0.42);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }, 80);
    msEqHtml = `<div class="lgjs-s-b310ca1d">
      <div class="lgjs-s-1a89f6c8">Curvas EQ M/S</div>
      <div class="lgjs-s-79d07016">
        <span><span class="lgjs-s-db235cd1"></span>Mid</span>
        <span><span class="lgjs-s-4ffbdd01"></span>Side</span>
      </div>
      <canvas id="refMsEqCanvas" width="320" height="55" class="lgjs-s-92a1031c"></canvas>
    </div>`;
  }

  return `<details class="lgjs-s-88f2910f" open>
    <summary class="lgjs-s-fc8bafd1">
      📊 Análisis detallado de la referencia
    </summary>
    <div class="lgjs-s-9f9dbb04">
      <div class="lgjs-s-4493394d">
        <span><span class="lgjs-s-9b5a0fd3"></span>Referencia</span>
        <span><span class="lgjs-s-06163cdb"></span>Original</span>
      </div>
      <div class="lgjs-s-7be77f33">Espectro por banda (energía relativa)</div>
      ${specBarsHtml}
      <div class="lgjs-s-fd6e5fd4">Dinámica comparada</div>
      ${dynRows}
      ${stereoRow}
      ${bgHtml}
      ${msEqHtml}
    </div>
  </details>`;
}

function renderReferenceMatch(rm: Record<string, unknown>, refAnalysis: Record<string, unknown>, ownAnalysis: Record<string, unknown>): void {
  const panel = document.createElement('div');
  panel.className = 'ref-match-panel';
  const after = rm.after as { match_percent?: number } | undefined;
  const pct = after?.match_percent ?? 0;
  const report = (rm.intelligent_report as { tips?: string[]; issues?: string[]; overall_score?: number; grade?: string }) || {};
  const dynBands = (rm.dynamics_by_band as Record<string, { own_crest_db?: number; ref_crest_db?: number; applied?: boolean; gap_db?: number; ratio?: number }>) || {};
  const stereoBands = (rm.stereo_width_by_band as Record<string, number>) || {};
  const lra = (rm.lra as { applied?: boolean; own_lra?: number; ref_lra?: number; ratio?: number }) || {};

  const stages = [
    { label: 'Antes', v: (rm.before as { match_percent?: number } | undefined)?.match_percent },
    { label: 'Tras EQ', v: (rm.after_eq as { match_percent?: number } | undefined)?.match_percent },
    { label: 'Final', v: pct },
  ];
  const stageBars = stages.map((s) => `
    <div class="match-stage-col">
      <div class="match-stage-bar-track"><div class="match-stage-bar-fill" style="height:${Math.max(2, s.v ?? 0)}%"></div></div>
      <div class="match-stage-pct">${s.v ?? '--'}%</div>
      <div class="match-stage-label">${s.label}</div>
    </div>`).join('');

  const esc = lg().ui.escapeHtml || ((s: unknown) => String(s));

  const dynRows = ['low', 'mid', 'high'].map((name) => {
    const b = dynBands[name];
    if (!b) return '';
    const label = name === 'low' ? 'Graves' : name === 'mid' ? 'Medios' : 'Agudos';
    if (b.own_crest_db == null) {
      const text = b.applied
        ? `comprimida (gap ${b.gap_db} dB, ratio ${b.ratio}:1)`
        : `sin cambios (gap ${b.gap_db} dB)`;
      return `<div class="ref-match-step">${label}: <b>${text}</b></div>`;
    }
    return _matchBarRow(`${label} (crest factor)`, b.own_crest_db, b.ref_crest_db, ' dB', 1.5, (v: number) => v.toFixed(1));
  }).join('');

  const stereoRows = ['low', 'mid', 'high'].map((name) => {
    const k = stereoBands[name];
    if (k === undefined) return '';
    const label = name === 'low' ? 'Graves' : name === 'mid' ? 'Medios' : 'Agudos';
    const pctBar = Math.max(0, Math.min(100, ((k - 0.5) / 1.0) * 100));
    const ok = Math.abs(k - 1.0) < 0.35;
    return `
      <div class="match-bar-row">
        <div class="match-bar-label">${ok ? '✓' : '↔'} ${label}</div>
        <div class="match-bar-track">
          <div class="lgjs-s-635b13e7" title="Sin cambio de ancho"></div>
          <div class="match-bar-fill" style="width:${pctBar}%"></div>
        </div>
        <div class="match-bar-values">factor ${k.toFixed(2)}x</div>
      </div>`;
  }).join('');

  const lraText = lra.applied
    ? `LRA ${lra.own_lra} → acercado a ${lra.ref_lra} LU (ratio ${lra.ratio}:1)`
    : `LRA propio: ${lra.own_lra ?? '--'} LU · referencia: ${lra.ref_lra ?? '--'} LU`;

  const loudnessBar = _matchBarRow('Loudness (LUFS)', ownAnalysis?.lufs as number, refAnalysis?.lufs as number, ' LUFS', 0.5, (v: number) => v.toFixed(1));
  const loudnessMatch = (rm.loudness_match as { adaptive?: boolean; source?: { perceived_lufs?: number; presence_correction_db?: number }; reference?: { perceived_lufs?: number; presence_correction_db?: number } }) || {};
  const adaptiveLoudnessHtml = loudnessMatch.adaptive
    ? `<div class="lgjs-s-3717df59">👂 LUFS perceptual: propio <b>${loudnessMatch.source?.perceived_lufs ?? '--'}</b> · ref <b>${loudnessMatch.reference?.perceived_lufs ?? '--'}</b> · corrección 3–6 kHz <b>${loudnessMatch.source?.presence_correction_db ?? '--'} / ${loudnessMatch.reference?.presence_correction_db ?? '--'} dB</b></div>`
    : '';

  const tipsHtml = (report.tips || []).map((t) => `<li>${esc(t)}</li>`).join('');
  const issuesHtml = (report.issues || []).map((t) => `<li class="lgjs-s-6898f371">${esc(t)}</li>`).join('');

  const limCeilDb = Math.max(0.01, Number(rm.limiter_ceiling ?? 0.95));
  panel.innerHTML = `
    <h3>🎯 Match con referencia</h3>
    <div class="ref-match-score-row">
      <div class="ref-match-score-circle"><span class="score-num">${pct}%</span><span class="score-label">MATCH TONAL</span></div>
      <div class="match-stage-cols">${stageBars}</div>
      <div>
        ${report.overall_score !== undefined ? `<div class="lgjs-s-2db3fd7b">Puntaje inteligente general: <b>${esc(report.overall_score)}/100 (${esc(report.grade ?? '')})</b></div>` : ''}
      </div>
    </div>
    <div class="lgjs-s-01219b21">Loudness</div>
    ${loudnessBar}
    <div class="ref-match-steps">
      <div class="ref-match-step">Ganancia aplicada: <b>${(rm.loudness_gain_applied_db as number) >= 0 ? '+' : ''}${rm.loudness_gain_applied_db as number} dB</b></div>
      ${adaptiveLoudnessHtml}
      <div class="ref-match-step">Techo limiter: <b>${(20 * Math.log10(limCeilDb)).toFixed(2)} dBFS</b></div>
      <div class="lgjs-s-3717df59">${lraText}</div>
    </div>
    <div class="lgjs-s-01219b21">Dinámica por banda (crest factor propio vs. referencia)</div>
    ${dynRows}
    <div class="lgjs-s-01219b21">Ancho estéreo por banda</div>
    ${stereoRows}
    ${issuesHtml ? `<ul class="lgjs-s-f5b25172">${issuesHtml}</ul>` : ''}
    ${tipsHtml ? `<ul class="lgjs-s-9211073b">${tipsHtml}</ul>` : ''}
  `;
  const detailHtml = renderReferenceAnalysisPanel(refAnalysis, ownAnalysis, rm);
  if (detailHtml) panel.insertAdjacentHTML('beforeend', detailHtml);

  const sd = rm.spectral_dynamics as { applied?: boolean; src_tonal_slope?: { loud_vs_quiet_db?: number[] }; ref_tonal_slope?: { loud_vs_quiet_db?: number[] }; amount?: number; n_bins?: number } | undefined;
  if (sd && sd.applied && sd.src_tonal_slope && sd.ref_tonal_slope) {
    const slopeSrc = sd.src_tonal_slope.loud_vs_quiet_db || [];
    const slopeRef = sd.ref_tonal_slope.loud_vs_quiet_db || [];
    const BAND_NAMES = ['Sub', 'Graves', 'Low-Mid', 'Medios', 'High-Mid', 'Presencia', 'Aire'];
    const slopeRows = slopeRef.map((refVal, i) => {
      const srcVal = slopeSrc[i] ?? 0;
      const label = BAND_NAMES[i] || `Banda ${i + 1}`;
      const maxV = Math.max(Math.abs(refVal), Math.abs(srcVal), 1);
      const refPct = 50 + (refVal / maxV) * 45;
      const srcPct = 50 + (srcVal / maxV) * 45;
      const diff = Math.abs(refVal - srcVal);
      const color = diff < 1.5 ? 'var(--ui-good)' : diff < 3 ? 'var(--ui-warn)' : 'var(--ui-danger)';
      return `<div class="lgjs-s-0397441f">
        <span class="lgjs-s-2dd04810">${label}</span>
        <div class="lgjs-s-f2285fd6">
          <div class="lgjs-s-bd475080"></div>
          <div title="Referencia" style="position:absolute;left:${refPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--ui-accent-2);border-radius:1px"></div>
          <div title="Original" style="position:absolute;left:${srcPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--ui-accent);opacity:0.7;border-radius:1px"></div>
        </div>
        <span style="width:2.5rem;text-align:right;color:${color};font-family:var(--mono)">${refVal >= 0 ? '+' : ''}${refVal.toFixed(1)}</span>
      </div>`;
    }).join('');
    panel.insertAdjacentHTML('beforeend', `<details class="lgjs-s-63dabc83">
      <summary class="lgjs-s-4a58161d">🎚 Spectral balance por rango dinámico</summary>
      <div class="lgjs-s-3dc98b5e">
        <p class="lgjs-s-cb84d2cf">Diferencia espectral fuerte vs suave. Cyan = referencia · Violeta = original.</p>
        ${slopeRows}
        <p class="lgjs-s-5853bcb4">Intensidad: ${Math.round((sd.amount ?? 0) * 100)}% · ${sd.n_bins} rangos</p>
      </div>
    </details>`);
  }

  lg().ui.getContent?.()?.appendChild(panel);
}

// ── A/B Panel ──────────────────────────────────────────────────────

(byId('btnAB') as HTMLButtonElement | null)?.addEventListener('click', () => {
  if (!lg().state.selectedFile) return;
  showABPanel();
});

function showABPanel(): void {
  let wrap = document.getElementById('abPanelWrap');
  if (wrap) return;
  lg().ui.clearResults?.();
  wrap = document.createElement('div');
  wrap.id = 'abPanelWrap';
  wrap.className = 'ab-wrap';
  wrap.innerHTML = `
    <h3>⚡ Comparación A/B</h3>
    <p class="lgjs-s-1866d4ca">Guardá dos versiones (A y B) y comparalas.</p>
    <div class="ab-controls">
      <button class="ab-btn" id="abCaptureA">📸 Capturar A</button>
      <button class="ab-btn" id="abCaptureB">📸 Capturar B</button>
      <button class="ab-btn" id="abPlayA" disabled>▶ A</button>
      <button class="ab-btn" id="abPlayB" disabled>▶ B</button>
    </div>
    <div id="abStatus" class="lgjs-s-7760b3fd">Capturá A y B.</div>
    <div id="abAudioWrap" class="lgjs-s-2239d6d5"></div>
  `;
  reqInput('content', '08-reference-mastering').appendChild(wrap);
  reqInput('abCaptureA', '08-reference-mastering:showABPanel').addEventListener('click', () => { void captureAB('A'); });
  reqInput('abCaptureB', '08-reference-mastering:showABPanel').addEventListener('click', () => { void captureAB('B'); });
  reqInput('abPlayA', '08-reference-mastering:showABPanel').addEventListener('click', () => playAB('A'));
  reqInput('abPlayB', '08-reference-mastering:showABPanel').addEventListener('click', () => playAB('B'));
}

async function captureAB(slot: 'A' | 'B'): Promise<void> {
  const st = lg().state;
  if (!st.selectedFile) {
    reqInput('abStatus', '08-reference-mastering:captureAB').textContent = 'Selecciona un archivo primero.';
    return;
  }
  const status = reqInput('abStatus', '08-reference-mastering:captureAB');
  status.textContent = `Capturando ${slot}…`;
  try {
    const api = lg().api;
    if (!api) throw new Error('API bridge no inicializada');
    // FIX K7: /preview pide JSON body con preview_source_id (preview.py:86),
    // no FormData con file. Antes mandaba FormData → 422. Flujo correcto:
    // 1) /preview/source (FormData) → source_id; 2) /preview (JSON) → WAV blob.
    const sourceFd = new FormData();
    sourceFd.append('file', st.selectedFile);
    sourceFd.append('duration_sec', '10');
    sourceFd.append('output_format', 'wav');
    sourceFd.append('output_bit_depth', '24');
    const sourceRes = await api.client.post(`${api.apiBase()}/preview/source`, { body: sourceFd });
    const sourceData = await sourceRes.json() as { source_id?: string };
    if (!sourceData.source_id) throw new Error('El servidor no devolvió preview_source_id');
    const _params = lg().params;
    const _collect = _params?.collect;
    const collected = typeof _collect === 'function' ? _collect() : null;
    if (!collected) throw new Error('No se pudieron recolectar los params');
    const previewRes = await api.client.post(`${api.apiBase()}/preview`, {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preview_source_id: sourceData.source_id,
        preview_duration_sec: 10,
        params: collected,
      }),
    });
    const blob = await previewRes.blob();
    (st as Record<string, unknown>)[`abSnapshot${slot}`] = { blob, label: slot };
    (reqInput(`abPlay${slot}`, '08-reference-mastering:captureAB') as HTMLButtonElement).disabled = false;
    reqInput(`abPlay${slot}`, '08-reference-mastering:captureAB').classList.add(`active-${slot.toLowerCase()}`);
    const both = (st as Record<string, unknown>).abSnapshotA && (st as Record<string, unknown>).abSnapshotB;
    status.textContent = `${slot} capturado ✓. ${both ? 'Ambos listos.' : ''}`;
  } catch (e) {
    console.debug('Error capturando:', e);
    status.textContent = 'Error: ' + (e as Error).message;
  }
}

let abCurrentUrl: string | null = null;
function playAB(slot: 'A' | 'B'): void {
  const st = lg().state as Record<string, unknown>;
  const snap = (st[`abSnapshot${slot}`] as { blob: Blob; label: string } | undefined);
  if (!snap) return;
  const wrap = reqInput('abAudioWrap', '08-reference-mastering:playAB');
  if (abCurrentUrl) URL.revokeObjectURL(abCurrentUrl);
  abCurrentUrl = URL.createObjectURL(snap.blob);
  const safeUrl = window.safeAudioSrc?.(abCurrentUrl) ?? abCurrentUrl;
  wrap.innerHTML = `<div style="font-family:var(--mono);font-size:.75rem;color:${slot === 'A' ? 'var(--ui-accent)' : 'var(--ui-warn)'};margin-bottom:.3rem">▶ ${slot}</div><audio controls src="${safeUrl}" class="lgjs-s-0466783d"></audio>`;
}

// ── Multi-Reference (5 referencias con pesos) ───────────────────────

document.getElementById('btnMultiRef')?.addEventListener('click', () => {
  if (!lg().state.selectedFile) {
    lg().ui.showStatus?.(null, 'Subí un archivo primero.', 'error');
    return;
  }
  openMultiRefModal();
});

function openMultiRefModal(): void {
  const existing = document.getElementById('multiRefModal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'multiRefModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;';

  const box = document.createElement('div');
  box.style.cssText = 'background:var(--ui-panel-bg,#1a1a2e);border-radius:12px;padding:24px;max-width:600px;width:90%;max-height:80vh;overflow-y:auto;border:1px solid var(--ui-border,#333);';

  box.innerHTML = `
    <h2 style="margin:0 0 16px;color:var(--ui-text,#e0e0e0);">🎯 Matching Timbral Multivariable</h2>
    <p style="font-size:0.85em;color:var(--ui-text-dim,#aaa);margin-bottom:16px;">
      Subí hasta 5 referencias comerciales y asigná un peso a cada una. El sistema promedia los perfiles espectrales y aplica matching sobre el promedio ponderado.
    </p>
    <div id="multiRefSlots"></div>
    <button id="multiRefAddBtn" type="button" class="btn btn-secondary btn-sm" style="margin:8px 0;">+ Agregar referencia</button>
    <div style="display:flex;gap:8px;margin-top:16px;">
      <button id="multiRefSubmitBtn" type="button" class="btn btn-primary" style="flex:1;">Masterizar</button>
      <button id="multiRefCancelBtn" type="button" class="btn btn-secondary">Cancelar</button>
    </div>
  `;

  modal.appendChild(box);
  document.body.appendChild(modal);

  const slots = box.querySelector('#multiRefSlots') as HTMLElement;
  const addBtn = box.querySelector('#multiRefAddBtn') as HTMLButtonElement;
  interface RefDataEntry { file: File | null; weight: number }
  const refData: RefDataEntry[] = [];

  function addSlot(): void {
    if (refData.length >= 5) return;
    const idx = refData.length;
    refData.push({ file: null, weight: 1.0 });
    const slot = document.createElement('div');
    slot.style.cssText = 'display:flex;align-items:center;gap:8px;margin:6px 0;padding:8px;border-radius:6px;background:rgba(255,255,255,0.03);';
    slot.innerHTML = `
      <input type="file" accept="audio/*" class="multi-ref-file" style="flex:1;font-size:0.8em;" />
      <label style="font-size:0.8em;color:var(--ui-text-dim,#aaa);">Peso:</label>
      <input type="range" min="0" max="100" step="5" value="50" class="multi-ref-weight" style="width:80px;" />
      <span class="multi-ref-weight-val" style="font-size:0.8em;color:var(--ui-text,#e0e0e0);min-width:30px;">50%</span>
    `;
    const fileInput = slot.querySelector('.multi-ref-file') as HTMLInputElement;
    const weightInput = slot.querySelector('.multi-ref-weight') as HTMLInputElement;
    const weightVal = slot.querySelector('.multi-ref-weight-val') as HTMLElement;

    fileInput.addEventListener('change', (e) => {
      refData[idx].file = (e.target as HTMLInputElement).files?.[0] || null;
    });
    weightInput.addEventListener('input', (e) => {
      refData[idx].weight = Number((e.target as HTMLInputElement).value) / 100;
      weightVal.textContent = (e.target as HTMLInputElement).value + '%';
    });

    slots.appendChild(slot);
  }

  addBtn.addEventListener('click', addSlot);
  addSlot();
  addSlot();

  box.querySelector('#multiRefCancelBtn')?.addEventListener('click', () => modal.remove());
  box.querySelector('#multiRefSubmitBtn')?.addEventListener('click', async () => {
    const valid = refData.filter((r) => r.file);
    if (valid.length < 2) {
      lg().ui.showStatus?.(null, 'Subí al menos 2 referencias.', 'error');
      return;
    }
    modal.remove();
    lg().ui.clearResults?.();
    lg().ui.showStatus?.(null, 'Multi-reference mastering…', 'processing');

    const fd = new FormData();
    if (lg().state.selectedFile) fd.append('file', lg().state.selectedFile);
    valid.forEach((r) => { if (r.file) fd.append('reference_files', r.file); });
    fd.append('reference_weights', valid.map((r) => r.weight).join(','));

    try {
      const api = lg().api;
      const res = await api.client.post(`${api.apiBase()}/master/multi-reference`, { body: fd });
      const data = await res.json() as Record<string, unknown>;
      lg().ui.showStatus?.(null, 'Multi-reference encolado ✓', 'done');
    } catch (e) {
      // FIX K8: el backend NO declara /master/multi-reference (verificado:
      // grep -rn "multi-reference" backend/routers/mastering.py → 0 matches).
      // Como el backend es READ-ONLY, no podemos agregar el endpoint desde
      // acá. Mostramos un mensaje claro en vez del 404 críptico.
      const status = (e as { status?: number }).status;
      if (status === 404) {
        lg().ui.showStatus?.(null, 'Multi-reference no disponible en este backend (el endpoint /master/multi-reference no está declarado).', 'error');
      } else {
        console.debug('Error multi-ref:', e);
        lg().ui.showStatus?.(null, 'Error: ' + (e as Error).message, 'error');
      }
    }
  });
}

// ── API pública + cleanup ───────────────────────────────────────────

// Exponer renderAdvicePanel en window.LGMDM.reference (consumido por mastering-actions)
const _lg = lgmdmRef() as LgmdmReferenceSlice;
const refApiFinal = (_lg.reference = _lg.reference || {});
refApiFinal.renderAdvicePanel = (data: Record<string, unknown>, title: string, subtitle?: string) => {
  const panel = document.createElement('div');
  panel.className = 'advice-panel';
  const adviceData = data as { score?: number; grade?: string; issues?: string[]; tips?: string[] };
  const score = adviceData.score ?? 0;
  const grade = adviceData.grade ?? '';
  const gradeClass = grade === 'Excelente' ? 'grade-ex'
    : grade === 'Buena' ? 'grade-good'
    : grade === 'Aceptable' ? 'grade-ok'
    : 'grade-bad';
  const esc = lg().ui.escapeHtml || ((s: unknown) => String(s));
  const issues = adviceData.issues ?? [];
  const tips = adviceData.tips ?? [];
  const issuesHtml = issues.length
    ? `<ul class="advice-issues">${issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>`
    : '';
  const tipsHtml = tips.length ? `<ul class="advice-tips">${tips.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : '';
  panel.innerHTML = `<h3>${esc(title)}${subtitle ? ` <span class="lgjs-s-21bab4f3">${esc(subtitle)}</span>` : ''}</h3><div class="advice-score-row"><div class="advice-score-circle"><span class="score-num">${score}</span><span class="score-label">/ 100</span></div><div><div class="advice-grade ${gradeClass}">${grade}</div><div class="lgjs-s-14ef2f38">${issues.length} problema${issues.length !== 1 ? 's' : ''}</div></div></div>${issuesHtml}${tipsHtml}`;
  lg().ui.getContent?.()?.appendChild(panel);
};

export {};
