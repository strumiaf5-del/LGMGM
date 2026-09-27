// features/audio/mixer-ui.ts — Mixer UI/orquestación.
//
// Carga tras `features/audio/mixer-engine.ts` (necesita `window.LGMDM.mixerEngine`).
//
// FIX M-NEW-3: el comentario "AbortController + cleanup de listeners" era misleading
// — el AbortController (línea 124) solo cubre el listener de DOMContentLoaded
// (línea 922). Los listeners de bindMixerEvents se protegen con guards en los
// elementos (FIX A4: `_lgmdmBound`/`_lgmdmStageBound`). El `controller.abort()`
// en beforeunload solo cancela el DOMContentLoaded.

// ── Tipos ──────────────────────────────────────────────────────────────

interface MixerUiModelShape {
  defaultStemParams: () => Record<string, unknown>;
  detectStemType: (filename: string) => string;
  stemEmoji: (type: string) => string;
}

interface MixerEngineShape {
  cachedEl: (id: string) => HTMLElement | null;
  invalidateCachedEl: (id: string) => void;
  mixerState: { stems: Record<string, StemData> };
  previewEngine: {
    ctx: AudioContext | null;
    nodes: Record<string, AudioNode>;
    masterGain: GainNode;
  };
  serverPreview: Record<string, unknown>;
  getGenUUID: () => string;
  formatDbValue: (v: number) => string;
  formatLinearThresholdToDb: (v: number) => string;
  dbToLin: (db: number) => number;
  decodeStemForPreview: (name: string, file?: File) => Promise<void>;
  applyStemParamsToChain: (name: string) => void;
  updateAllMuteSolo: () => void;
  startStemSource: (name: string) => void;
  playPreview: () => void;
  stopPreview: () => void;
  togglePreview: () => void;
  seekPreview: (t: number) => void;
  fmtTime: (s: number) => string;
  updateTransportUI: () => void;
  removeStemFromPreview: (name: string) => void;
  resetPreviewEngine: () => void;
  setServerPreviewStatus: (s: string, t: string) => void;
  scheduleServerPreview: () => void;
  runServerPreview: () => Promise<void>;
  buildStemLibraryIdMap?: (names: string[]) => Record<string, string>;
}

interface StemData {
  uploaded: boolean;
  libraryId?: string;
  libraryName?: string;
  duration?: number;
  file: File | null;
  params: StemParams;
}

interface StemParams {
  gain_db: number;
  pan: number;
  mute: boolean;
  solo: boolean;
  hp_cutoff_hz: number;
  lp_cutoff_hz: number;
  eq_low_freq: number; eq_low_gain_db: number; eq_low_q: number;
  eq_lomid_freq: number; eq_lomid_gain_db: number; eq_lomid_q: number;
  eq_himid_freq: number; eq_himid_gain_db: number; eq_himid_q: number;
  eq_high_freq: number; eq_high_gain_db: number; eq_high_q: number;
  comp_enabled: boolean;
  comp_threshold: number; comp_ratio: number; comp_attack_ms: number;
  comp_release_ms: number; comp_makeup_db: number;
  comp_stereo_link: boolean; comp_pdr: boolean;
  transient_attack: number; transient_sustain: number;
  stereo_width_amount: number;
  sidechain_trigger_name: string;
  sidechain_threshold: number; sidechain_ratio: number;
  sidechain_attack_ms: number; sidechain_release_ms: number;
  reverb_enabled: boolean; reverb_preset: string;
  reverb_wet_amount: number; reverb_pre_delay_ms: number; reverb_room_size: number;
  pitch_correction_enabled: boolean;
  pitch_correction_mode: string; pitch_correction_scale: string;
  pitch_correction_glide_ms: number;
  stem_type: string;
}

interface MixerLibraryService {
  refreshStemLibrary: () => void;
  addStemFromLibrary: (id: string) => void;
  deleteStemFromLibrary: (id: string) => void;
}

interface ApiShape {
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
}

interface UiShape {
  bindOnce: (el: HTMLElement | Window | Document, type: string, fn: EventListener, key?: string) => boolean;
  showToast?: (msg: string, kind: string, ms?: number) => void;
  escapeHtml?: (s: unknown) => string;
}

interface ErrorsShape {
  handleClientError?: (e: unknown, msg: string, ctx: Record<string, unknown>) => void;
}

interface ActiveFader {
  applyDb: (db: number) => void;
  pxToDb: (dy: number, trackH: number) => number;
  getTrackH: () => number;
  dragging: boolean;
  startY: number;
}

declare global {
  interface Window {
    createMixerLibraryService?: (opts: Record<string, unknown>) => MixerLibraryService;
    buildStemLibraryIdMap?: (names: string[]) => Record<string, string>;
  }
}

const FADER_MIN = -60;
const FADER_MAX = 12;
const controller = new AbortController();
const { signal } = controller;

let _activeFader: ActiveFader | null = null;
let _channelTemplate: HTMLTemplateElement | null = null;
let _eqBandTemplate: HTMLTemplateElement | null = null;

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  ui?: UiShape;
  mixerEngine?: MixerEngineShape;
  mixerUiModel?: MixerUiModelShape;
  api?: ApiShape;
  errors?: ErrorsShape;
};

function runtime(): MixerEngineShape | null {
  return (lg().mixerEngine as MixerEngineShape | undefined) || null;
}

function model(): MixerUiModelShape | null {
  return (lg().mixerUiModel as MixerUiModelShape | undefined) || null;
}

// ── CSS fader helpers ──────────────────────────────────────────────────

function dbToPct(db: number): number {
  return Math.max(0, Math.min(1, (db - FADER_MIN) / (FADER_MAX - FADER_MIN)));
}

function faderKnobStyle(db: number): { topPct: string; fillPct: string } {
  const pct = dbToPct(db);
  return {
    topPct: ((1 - pct) * 100).toFixed(2),
    fillPct: (pct * 100).toFixed(2),
  };
}

function faderHTML(id: string, db: number): string {
  const { topPct, fillPct } = faderKnobStyle(db);
  const zeroTopPct = ((1 - dbToPct(0)) * 100).toFixed(2);
  return `
    <div class="mxr-fader-css" data-fader-id="${id}" data-db="${db}"
         style="--knob-top:${topPct}%;--fill-h:${fillPct}%;--zero-top:${zeroTopPct}%"
         role="slider" aria-valuenow="${db}" aria-valuemin="${FADER_MIN}" aria-valuemax="${FADER_MAX}"
         tabindex="0">
      <div class="mxr-fader-track">
        <div class="mxr-fader-fill"></div>
        <div class="mxr-fader-zero"></div>
        <div class="mxr-fader-knob"></div>
      </div>
    </div>`;
}

function setFaderDb(faderId: string, db: number): void {
  const el = document.querySelector(`.mxr-fader-css[data-fader-id="${faderId}"]`);
  if (!el) return;
  const { topPct, fillPct } = faderKnobStyle(db);
  (el as HTMLElement).style.setProperty('--knob-top', topPct + '%');
  (el as HTMLElement).style.setProperty('--fill-h', fillPct + '%');
  (el as HTMLElement).dataset.db = String(db);
  (el as HTMLElement).setAttribute('aria-valuenow', String(db));
}

// ── Drag logic ─────────────────────────────────────────────────────────

function initFaderDrags(container: HTMLElement): void {
  const r = runtime();
  if (!r) return;
  const previewEngine = r.previewEngine;
  const mixerState = r.mixerState;
  const cachedEl = r.cachedEl;
  const formatDbValue = r.formatDbValue;
  const applyStemParamsToChain = r.applyStemParamsToChain;
  const scheduleServerPreview = r.scheduleServerPreview;
  const dbToLin = r.dbToLin;

  container.querySelectorAll<HTMLElement>('.mxr-fader-css').forEach((el) => {
    const faderEl = el as HTMLElement & { _faderInited?: boolean };
    if (faderEl._faderInited) return;
    faderEl._faderInited = true;

    let dragging = false;
    let startY = 0;
    let startDb = 0;

    function getDb(): number { return parseFloat(faderEl.dataset.db || '0') || 0; }

    function applyDb(db: number): void {
      db = Math.max(FADER_MIN, Math.min(FADER_MAX, db));
      setFaderDb(faderEl.dataset.faderId || '', db);
      const id = faderEl.dataset.faderId || '';
      if (id === 'master') {
        const inp = cachedEl('mix-master-gain') as HTMLInputElement | null;
        if (inp) inp.value = String(db);
        const lbl = cachedEl('mix-master-gain-val');
        if (lbl) lbl.textContent = formatDbValue(db);
        const lblCh = cachedEl('mix-master-gain-val-ch');
        if (lblCh) lblCh.textContent = formatDbValue(db);
        if (previewEngine.ctx) {
          previewEngine.masterGain.gain.setTargetAtTime(dbToLin(db), previewEngine.ctx.currentTime, 0.015);
        }
        scheduleServerPreview();
      } else {
        const stemName = id.replace(/^gain:/, '');
        const p = mixerState.stems[stemName]?.params;
        if (p) p.gain_db = db;
        const lbl = cachedEl('ch-gain-val-' + stemName);
        if (lbl) lbl.textContent = formatDbValue(db);
        if (previewEngine.nodes[stemName]) applyStemParamsToChain(stemName);
        scheduleServerPreview();
      }
    }

    function pxToDb(dy: number, trackH: number): number {
      return startDb + (dy / trackH) * (FADER_MAX - FADER_MIN);
    }

    function getTrackH(): number {
      const track = faderEl.querySelector<HTMLElement>('.mxr-fader-track');
      return track?.getBoundingClientRect().height || 200;
    }

    function onDown(e: Event): void {
      dragging = true;
      const touch = (e as TouchEvent).touches?.[0];
      startY = touch ? touch.clientY : (e as MouseEvent).clientY;
      startDb = getDb();
      document.body.style.userSelect = 'none';
      e.preventDefault();
      _activeFader = {
        applyDb, pxToDb, getTrackH,
        dragging,
        startY,
      };
    }
    function onMove(e: Event): void {
      const f = _activeFader;
      if (!f || !f.dragging) return;
      const touch = (e as TouchEvent).touches?.[0];
      const cy = touch ? touch.clientY : (e as MouseEvent).clientY;
      const dy = f.startY - cy;
      f.applyDb(f.pxToDb(dy, f.getTrackH()));
    }
    function onUp(): void {
      const f = _activeFader;
      if (!f) return;
      f.dragging = false;
      document.body.style.userSelect = '';
      _activeFader = null;
    }

    faderEl.addEventListener('mousedown', onDown);
    faderEl.addEventListener('touchstart', onDown, { passive: false });
    if (!(document as Document & { _mxrFaderDocBound?: boolean })._mxrFaderDocBound) {
      (document as Document & { _mxrFaderDocBound?: boolean })._mxrFaderDocBound = true;
      document.addEventListener('mousemove', onMove);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchend', onUp);
    }

    faderEl.addEventListener('dblclick', () => { applyDb(0); });

    faderEl.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 1 : 0.5;
      if (e.key === 'ArrowUp') { applyDb(getDb() + step); e.preventDefault(); }
      if (e.key === 'ArrowDown') { applyDb(getDb() - step); e.preventDefault(); }
    });
  });
}

// ── DOM helpers ────────────────────────────────────────────────────────

function getMixerContentArea(): HTMLElement | null {
  const r = runtime();
  return r ? r.cachedEl('mixerContentArea') : document.getElementById('mixerContentArea');
}

function getMixerSidePanel(): HTMLElement | null {
  const r = runtime();
  return r ? r.cachedEl('mixerSidePanel') : document.getElementById('mixerSidePanel');
}

function updateToolbarHeader(): void {
  const r = runtime();
  if (!r) return;
  const stemCount = Object.keys(r.mixerState.stems).length;
  const tag = document.querySelector('.mxr-title-tag');
  if (tag) {
    tag.textContent = `${stemCount} stem${stemCount !== 1 ? 's' : ''}`;
  }
  const transport = (r.cachedEl('mxrTransport') || document.getElementById('mxrTransport')) as HTMLElement | null;
  if (transport) {
    transport.style.display = stemCount > 0 ? 'flex' : 'none';
  }
}

// ── Stem library ───────────────────────────────────────────────────────

function buildStemLibraryIdMap(names: string[]): Record<string, string> {
  const r = runtime();
  const out: Record<string, string> = {};
  if (!r) return out;
  names.forEach((n) => {
    const id = r.mixerState.stems[n]?.libraryId;
    if (id) out[n] = id;
  });
  return out;
}

let mixerLibrary: MixerLibraryService | null = null;

function initMixerLibrary(): MixerLibraryService | null {
  if (mixerLibrary) return mixerLibrary;
  const r = runtime();
  const lgApi = lg();
  if (!r) return null;
  if (typeof window.createMixerLibraryService !== 'function') return null;
  mixerLibrary = window.createMixerLibraryService({
    mixerState: r.mixerState,
    apiFetch: lgApi.api?.apiFetch,
    cachedEl: r.cachedEl,
    defaultStemParams: model()?.defaultStemParams,
    addChannelToDOM: (name: string) => addChannelToDOM(name),
    renderMixerSidePanel: () => renderMixerSidePanel(),
    decodeStemForPreview: (name: string) => r.decodeStemForPreview(name),
    scheduleServerPreview: () => r.scheduleServerPreview(),
    handleClientError: lgApi.errors?.handleClientError,
  });
  return mixerLibrary;
}

// ── Templates ──────────────────────────────────────────────────────────

function initTemplates(): void {
  if (!_channelTemplate) {
    _channelTemplate = document.getElementById('tmpl-channel') as HTMLTemplateElement | null;
    if (!_channelTemplate) {
      _channelTemplate = document.createElement('template');
      _channelTemplate.id = 'tmpl-channel';
      _channelTemplate.innerHTML = `
        <div class="mxr-channel" data-stem="">
          <div class="mxr-ch-header">
            <span class="mxr-ch-emoji"></span>
            <span class="mxr-ch-name"></span>
            <button class="mxr-ch-close" data-stem="">&times;</button>
          </div>
          <div class="mxr-ch-uploading" role="status" aria-live="polite"></div>
          <div class="mxr-fader-area">
            <div class="mxr-db-scale">
              <span>+12</span><span>+6</span><span>0</span>
              <span>-6</span><span>-12</span><span>-∞</span>
            </div>
            <div class="mxr-fader-placeholder"></div>
            <div class="mxr-fader-val"></div>
          </div>
          <div class="mxr-vu-wrap">
            <div class="mxr-vu-bar"><div class="mxr-vu-fill"></div></div>
            <div class="mxr-vu-bar"><div class="mxr-vu-fill"></div></div>
          </div>
          <div class="mxr-pan-row">
            <span class="mxr-pan-label">L</span>
            <input type="range" class="mxr-pan-slider" data-param="pan" min="-1" max="1" step="0.05" value="0">
            <span class="mxr-pan-label">R</span>
            <span class="mxr-pan-val"></span>
          </div>
          <div class="mxr-ms-row">
            <button class="mxr-btn-ms" data-action="mute">M</button>
            <button class="mxr-btn-ms" data-action="solo">S</button>
            <button class="mxr-btn-ms mxr-reset-btn" data-action="reset" title="Resetear canal">↺</button>
          </div>
          <details class="mxr-ch-details" open>
            <summary>Controles del canal</summary>
            <div class="mxr-adv-section">Filtros</div>
            <div class="param"><label>HP</label><span class="val"></span><input type="range" data-param="hp_cutoff_hz" min="20" max="500" step="5"></div>
            <div class="param"><label>LP</label><span class="val"></span><input type="range" data-param="lp_cutoff_hz" min="2000" max="20000" step="100"></div>
            <div class="mxr-adv-section">EQ 4 bandas</div>
            <div class="eq-bands-container"></div>
            <div>Compresor <input type="checkbox" data-param="comp_enabled"></div>
            <div class="param"><label>Threshold</label><span class="val"></span><input type="range" data-param="comp_threshold" min="0.01" max="1" step="0.01"></div>
            <div class="param"><label>Ratio</label><span class="val"></span><input type="range" data-param="comp_ratio" min="1" max="20" step="0.5"></div>
            <div class="param"><label>Attack</label><span class="val"></span><input type="range" data-param="comp_attack_ms" min="0.1" max="100" step="0.1"></div>
            <div class="param"><label>Release</label><span class="val"></span><input type="range" data-param="comp_release_ms" min="10" max="500" step="5"></div>
            <div class="param"><label>Makeup</label><span class="val"></span><input type="range" data-param="comp_makeup_db" min="-6" max="24" step="0.5"></div>
            <div class="mxr-adv-section">Transient</div>
            <div class="param"><label>Attack</label><span class="val"></span><input type="range" data-param="transient_attack" min="-1" max="1" step="0.05"></div>
            <div class="param"><label>Sustain</label><span class="val"></span><input type="range" data-param="transient_sustain" min="-1" max="1" step="0.05"></div>
            <div class="param"><label>Stereo</label><span class="val"></span><input type="range" data-param="stereo_width_amount" min="0" max="2" step="0.05"></div>
            <div class="mxr-adv-section">Sidechain</div>
            <div><label>Trigger</label>
              <select data-param="sidechain_trigger_name">
                <option value="">— Desactivado —</option>
              </select>
            </div>
            <div class="param"><label>SC Threshold</label><span class="val"></span><input type="range" data-param="sidechain_threshold" min="0.01" max="1" step="0.01"></div>
            <div class="param"><label>SC Ratio</label><span class="val"></span><input type="range" data-param="sidechain_ratio" min="1" max="20" step="0.5"></div>
            <div class="param"><label>SC Attack</label><span class="val"></span><input type="range" data-param="sidechain_attack_ms" min="0.5" max="100" step="0.5"></div>
            <div class="param"><label>SC Release</label><span class="val"></span><input type="range" data-param="sidechain_release_ms" min="10" max="500" step="5"></div>
            <div>Reverb <input type="checkbox" data-param="reverb_enabled"></div>
            <div><label>Preset</label>
              <select data-param="reverb_preset">
                <option value="small_studio">Small Studio</option>
                <option value="large_hall">Large Hall</option>
                <option value="cathedral">Cathedral</option>
                <option value="live_venue">Live Venue</option>
                <option value="plate">Plate</option>
                <option value="spring">Spring</option>
              </select>
            </div>
            <div class="param"><label>Wet Amount</label><span class="val"></span><input type="range" data-param="reverb_wet_amount" min="0" max="1" step="0.05"></div>
            <div class="param"><label>Pre-Delay (ms)</label><span class="val"></span><input type="range" data-param="reverb_pre_delay_ms" min="0" max="200" step="5"></div>
            <div class="param"><label>Room Size</label><span class="val"></span><input type="range" data-param="reverb_room_size" min="0.3" max="2" step="0.1"></div>
            <div>Pitch Correction <input type="checkbox" data-param="pitch_correction_enabled"></div>
            <div><label>Mode</label>
              <select data-param="pitch_correction_mode">
                <option value="OFF">Off</option>
                <option value="LIGHT">Light</option>
                <option value="MEDIUM">Medium</option>
                <option value="STRONG">Strong</option>
              </select>
            </div>
            <div class="param"><label>Glide (ms)</label><span class="val"></span><input type="range" data-param="pitch_correction_glide_ms" min="0" max="200" step="5"></div>
          </details>
        </div>`;
      document.body.appendChild(_channelTemplate);
    }
  }

  if (!_eqBandTemplate) {
    _eqBandTemplate = document.getElementById('tmpl-eqband') as HTMLTemplateElement | null;
    if (!_eqBandTemplate) {
      _eqBandTemplate = document.createElement('template');
      _eqBandTemplate.id = 'tmpl-eqband';
      _eqBandTemplate.innerHTML = `
        <div class="mxr-eqband">
          <div class="mxr-eqband-label"></div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Frec.</span>
            <input type="range" data-param="eq_freq" min="40" max="18000" step="10">
            <span class="mxr-eqband-val"></span>
          </div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Gan.</span>
            <input type="range" data-param="eq_gain_db" min="-12" max="12" step="0.5">
            <span class="mxr-eqband-val"></span>
          </div>
          <div class="mxr-eqband-row">
            <span class="mxr-eqband-tag">Q</span>
            <input type="range" data-param="eq_q" min="0.3" max="4" step="0.1">
            <span class="mxr-eqband-val"></span>
          </div>
        </div>`;
      document.body.appendChild(_eqBandTemplate);
    }
  }
}

function renderMasterChannel(): string {
  const r = runtime();
  const masterDb = 0;
  return `
    <div class="mxr-ch-header">
      <span class="mxr-ch-emoji">🎚️</span>
      <span class="mxr-ch-name">Master</span>
    </div>
    <div class="mxr-fader-area">
      <div class="mxr-db-scale">
        <span>+12</span><span>+6</span><span>0</span>
        <span>-6</span><span>-12</span><span>-∞</span>
      </div>
      ${faderHTML('master', masterDb)}
      <div class="mxr-fader-val" id="mix-master-gain-val-ch">${r ? r.formatDbValue(masterDb) : '0.0 dB'}</div>
      <input type="hidden" id="mix-master-gain" value="0">
    </div>`;
}

function renderMixer(): void {
  const area = getMixerContentArea();
  if (!area) return;
  const r = runtime();
  if (!r) return;

  let toolbar = area.querySelector<HTMLElement>('.mxr-toolbar');
  let stage = area.querySelector<HTMLElement>('.mxr-stage');
  if (!toolbar || !stage) {
    area.innerHTML = `<div class="mxr-toolbar"></div><div class="mxr-stage"></div>`;
    toolbar = area.querySelector<HTMLElement>('.mxr-toolbar');
    stage = area.querySelector<HTMLElement>('.mxr-stage');
  }

  const stemCount = Object.keys(r.mixerState.stems).length;
  if (toolbar) {
    toolbar.innerHTML = `
      <button class="btn btn-sm" id="mixerAddStemBtn" type="button" aria-label="Añadir stem">＋ Stem</button>
      <button class="btn btn-sm" id="mixerAddMultiBtn" type="button" aria-label="Añadir múltiples archivos">Multi</button>
      <button class="btn btn-sm" id="mixerLibraryBtn" type="button" aria-label="Abrir librería">Librería</button>
      <input type="file" id="mixerFileInput" accept=".wav,.mp3,.flac,.ogg,.aiff,.aif" aria-label="Archivo de audio">
      <input type="file" id="mixerMultiInput" accept=".wav,.mp3,.flac,.ogg,.aiff,.aif" multiple aria-label="Múltiples archivos de audio">
      <span class="mxr-title-tag" aria-hidden="true">${stemCount} stem${stemCount !== 1 ? 's' : ''}</span>
      <div class="mxr-transport" id="mxrTransport" style="${stemCount ? 'display:flex' : 'display:none'}">
        <button class="btn btn-sm" id="mxrPlayBtn" type="button" title="Preview en vivo (client-side)" aria-label="Reproducir preview en vivo">▶</button>
        <input type="range" id="mxrSeek" class="mxr-seek" min="0" max="0" step="0.01" value="0" aria-label="Posición del preview">
        <span class="mxr-time" id="mxrTimeLabel" aria-live="off">0:00 / 0:00</span>
      </div>
      <button class="btn btn-sm mxr-clear-btn" id="mixerClearBtn" type="button" aria-label="Limpiar todos los stems" title="Limpiar todos los stems">🗑</button>
    `;
  }

  if (!stage) return;
  if (stemCount === 0) {
    stage.innerHTML = `
      <div class="mxr-empty">
        <div class="mxr-empty-icon">🎛️</div>
        <div class="mxr-empty-title">Arrastrá stems acá o usá los botones</div>
        <div class="mxr-empty-sub">WAV · MP3 · FLAC · OGG · AIFF — hasta 200MB</div>
        <div>
          <button class="btn btn-primary" id="mxrDropBtn" type="button">＋ Elegir archivos</button>
          <button class="btn btn-ref" id="mxrEmptyLibraryBtn" type="button">Usar librería</button>
        </div>
      </div>`;
  } else {
    let channels = stage.querySelector<HTMLElement>('#mixerChannels');
    if (!channels) {
      channels = document.createElement('div');
      channels.className = 'mxr-channels';
      channels.id = 'mixerChannels';
      stage.appendChild(channels);
      const masterEl = document.createElement('div');
      masterEl.className = 'mxr-channel mxr-master-ch';
      masterEl.id = 'mxrMasterCh';
      masterEl.innerHTML = renderMasterChannel();
      channels.appendChild(masterEl);
    }
    const existingNames = Array.from(channels.querySelectorAll<HTMLElement>('.mxr-channel:not(.mxr-master-ch)'))
      .map((el) => el.dataset.stem).filter(Boolean) as string[];
    const allNames = Object.keys(r.mixerState.stems);
    for (const name of allNames) {
      if (!existingNames.includes(name)) addChannelToDOM(name);
    }
    for (const name of existingNames) {
      if (!r.mixerState.stems[name]) {
        const el = document.getElementById(`ch-${CSS.escape(name)}`);
        if (el) el.remove();
      }
    }
    const master = channels.querySelector('#mxrMasterCh');
    for (const name of allNames) {
      const el = document.getElementById(`ch-${CSS.escape(name)}`);
      if (el && master) channels.insertBefore(el, master);
    }
  }

  updateToolbarHeader();
  bindMixerEvents();
  initFaderDrags(area);
  renderMixerSidePanel();
}

function addChannelToDOM(name: string): void {
  const r = runtime();
  if (!r) return;
  const stem = r.mixerState.stems[name];
  if (!stem) return;

  initTemplates();
  const tmpl = document.getElementById('tmpl-channel') as HTMLTemplateElement | null;
  if (!tmpl) return;
  const frag = tmpl.content.cloneNode(true) as DocumentFragment;
  const ch = frag.querySelector<HTMLElement>('.mxr-channel');
  if (!ch) return;
  ch.dataset.stem = name;
  ch.id = `ch-${CSS.escape(name)}`;
  const p = stem.params;

  // Header
  const emojiEl = ch.querySelector<HTMLElement>('.mxr-ch-emoji');
  if (emojiEl) emojiEl.textContent = (model()?.stemEmoji(p.stem_type) || '🎵');
  const nameEl = ch.querySelector<HTMLElement>('.mxr-ch-name');
  if (nameEl) nameEl.textContent = name;
  const closeBtn = ch.querySelector<HTMLButtonElement>('.mxr-ch-close');
  if (closeBtn) closeBtn.dataset.stem = name;

  // Uploading indicator
  const uploadEl = ch.querySelector<HTMLElement>('.mxr-ch-uploading');
  if (uploadEl) {
    if (!stem.uploaded) {
      uploadEl.style.display = 'block';
      uploadEl.textContent = '⏳ Subiendo…';
    } else {
      uploadEl.style.display = 'none';
    }
  }

  // Fader placeholder
  const faderPlaceholder = ch.querySelector('.mxr-fader-placeholder');
  if (faderPlaceholder) {
    faderPlaceholder.outerHTML = faderHTML('gain:' + name, p.gain_db);
  }
  const faderVal = ch.querySelector<HTMLElement>('.mxr-fader-val');
  if (faderVal) {
    faderVal.id = 'ch-gain-val-' + name;
    faderVal.textContent = r.formatDbValue(p.gain_db);
  }

  // VU meters
  const fills = ch.querySelectorAll<HTMLElement>('.mxr-vu-fill');
  if (fills[0]) fills[0].id = `mxr-vu-fill-l-${name}`;
  if (fills[1]) fills[1].id = `mxr-vu-fill-r-${name}`;

  // Pan
  const panSlider = ch.querySelector<HTMLInputElement>('.mxr-pan-slider');
  if (panSlider) { panSlider.dataset.stem = name; panSlider.value = String(p.pan); }
  const panVal = ch.querySelector<HTMLElement>('.mxr-pan-val');
  if (panVal) {
    panVal.id = 'ch-pan-val-' + name;
    panVal.textContent = Math.abs(p.pan) < 0.02 ? 'C' : (p.pan > 0 ? 'R' : 'L') + Math.abs(Math.round(p.pan * 100));
  }

  // Mute/Solo/Reset
  if (p.mute) ch.classList.add('mxr-ch--muted');
  if (p.solo) ch.classList.add('mxr-ch--solo');
  const muteBtn = ch.querySelector<HTMLButtonElement>('[data-action="mute"]');
  const soloBtn = ch.querySelector<HTMLButtonElement>('[data-action="solo"]');
  const resetBtn = ch.querySelector<HTMLButtonElement>('[data-action="reset"]');
  if (muteBtn) { muteBtn.dataset.stem = name; if (p.mute) muteBtn.classList.add('active-mute'); }
  if (soloBtn) { soloBtn.dataset.stem = name; if (p.solo) soloBtn.classList.add('active-solo'); }
  if (resetBtn) resetBtn.dataset.stem = name;

  // Filtros HP/LP
  const details = ch.querySelector<HTMLElement>('.mxr-ch-details');
  if (details) {
    const hpInput = details.querySelector<HTMLInputElement>('[data-param="hp_cutoff_hz"]');
    if (hpInput) {
      hpInput.dataset.stem = name;
      hpInput.value = String(p.hp_cutoff_hz);
      const hpVal = hpInput.parentElement?.querySelector<HTMLElement>('.val');
      if (hpVal) { hpVal.id = 'ch-hp-val-' + name; hpVal.textContent = p.hp_cutoff_hz + ' Hz'; }
    }
    const lpInput = details.querySelector<HTMLInputElement>('[data-param="lp_cutoff_hz"]');
    if (lpInput) {
      lpInput.dataset.stem = name;
      lpInput.value = String(p.lp_cutoff_hz);
      const lpVal = lpInput.parentElement?.querySelector<HTMLElement>('.val');
      if (lpVal) { lpVal.id = 'ch-lp-val-' + name; lpVal.textContent = p.lp_cutoff_hz >= 20000 ? '20k' : p.lp_cutoff_hz + ' Hz'; }
    }

    // EQ bands
    const eqContainer = details.querySelector<HTMLElement>('.eq-bands-container');
    if (eqContainer) {
      const eqTmpl = document.getElementById('tmpl-eqband') as HTMLTemplateElement | null;
      const bands = [
        { key: 'low', label: 'Graves', freq: p.eq_low_freq, gain: p.eq_low_gain_db, q: p.eq_low_q, fmin: 40, fmax: 400, fstep: 10 },
        { key: 'lomid', label: 'L-Mid', freq: p.eq_lomid_freq, gain: p.eq_lomid_gain_db, q: p.eq_lomid_q, fmin: 200, fmax: 1500, fstep: 10 },
        { key: 'himid', label: 'H-Mid', freq: p.eq_himid_freq, gain: p.eq_himid_gain_db, q: p.eq_himid_q, fmin: 800, fmax: 8000, fstep: 10 },
        { key: 'high', label: 'Agudos', freq: p.eq_high_freq, gain: p.eq_high_gain_db, q: p.eq_high_q, fmin: 4000, fmax: 18000, fstep: 10 },
      ];
      for (const b of bands) {
        if (!eqTmpl) continue;
        const eqFrag = eqTmpl.content.cloneNode(true) as DocumentFragment;
        const eqDiv = eqFrag.querySelector<HTMLElement>('.mxr-eqband');
        if (!eqDiv) continue;
        const label = eqDiv.querySelector<HTMLElement>('.mxr-eqband-label');
        if (label) label.textContent = b.label;
        const freqInput = eqDiv.querySelector<HTMLInputElement>('[data-param="eq_freq"]');
        if (freqInput) {
          freqInput.dataset.stem = name;
          freqInput.min = String(b.fmin); freqInput.max = String(b.fmax); freqInput.step = String(b.fstep);
          freqInput.value = String(b.freq);
          const freqVal = freqInput.parentElement?.querySelector<HTMLElement>('.mxr-eqband-val');
          if (freqVal) {
            freqVal.id = `ch-eq-${b.key}-freq-val-${name}`;
            freqVal.textContent = b.freq >= 1000 ? (b.freq / 1000).toFixed(1) + 'k' : b.freq + 'Hz';
          }
        }
        const gainInput = eqDiv.querySelector<HTMLInputElement>('[data-param="eq_gain_db"]');
        if (gainInput) {
          gainInput.dataset.stem = name;
          gainInput.value = String(b.gain);
          const gainVal = gainInput.parentElement?.querySelector<HTMLElement>('.mxr-eqband-val');
          if (gainVal) {
            gainVal.id = `ch-eq-${b.key}-gain-val-${name}`;
            gainVal.textContent = r.formatDbValue(b.gain);
          }
        }
        const qInput = eqDiv.querySelector<HTMLInputElement>('[data-param="eq_q"]');
        if (qInput) {
          qInput.dataset.stem = name;
          qInput.value = String(b.q);
          const qVal = qInput.parentElement?.querySelector<HTMLElement>('.mxr-eqband-val');
          if (qVal) {
            qVal.id = `ch-eq-${b.key}-q-val-${name}`;
            qVal.textContent = b.q.toFixed(1);
          }
        }
        eqContainer.appendChild(eqDiv);
      }
    }
  }

  // Append al stage
  const channels = document.getElementById('mixerChannels');
  const master = document.getElementById('mxrMasterCh');
  if (channels && master) channels.insertBefore(ch, master);
  else if (channels) channels.appendChild(ch);
}

// ── Mixer events ───────────────────────────────────────────────────────

function bindMixerEvents(): void {
  const r = runtime();
  if (!r) return;
  // FIX A4: antes bindMixerEvents se llamaba desde renderMixer en cada mute/solo/
  // reset/clear/drop → acumulaba listeners en elementos PERSISTENTES (mixerChannels,
  // stage). Los del toolbar (que se re-crea con innerHTML) se GCean solos, pero
  // channels/stage no. Guard con flag en el elemento (no global) para que el
  // primer bind los registre y los siguientes skipeen. Los del toolbar se bindean
  // siempre (elementos nuevos cada render).
  const stage = document.querySelector('.mxr-stage') as HTMLElement | null;
  const channels = stage?.querySelector<HTMLElement>('#mixerChannels') || null;
  // Listeners en channels (persistente): solo una vez
  if (channels && !(channels as unknown as { _lgmdmBound?: boolean })._lgmdmBound) {
    (channels as unknown as { _lgmdmBound?: boolean })._lgmdmBound = true;
    channels.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      const stem = target.dataset.stem || '';
      if (!stem) return;
      if (target.matches('.mxr-ch-close')) {
        if (typeof r.removeStemFromPreview === 'function') r.removeStemFromPreview(stem);
        renderMixer();
      } else if (target.matches('[data-action="mute"]')) {
        const p = r.mixerState.stems[stem]?.params;
        if (p) {
          p.mute = !p.mute;
          if (typeof r.updateAllMuteSolo === 'function') r.updateAllMuteSolo();
          renderMixer();
        }
      } else if (target.matches('[data-action="solo"]')) {
        const p = r.mixerState.stems[stem]?.params;
        if (p) {
          p.solo = !p.solo;
          if (typeof r.updateAllMuteSolo === 'function') r.updateAllMuteSolo();
          renderMixer();
        }
      } else if (target.matches('[data-action="reset"]')) {
        const m = model();
        if (m) {
          Object.assign(r.mixerState.stems[stem].params, m.defaultStemParams());
          renderMixer();
        }
      }
    });

    channels.addEventListener('input', (e) => {
      const target = e.target as HTMLInputElement;
      const stem = target.dataset.stem || '';
      if (!stem) return;
      const param = target.dataset.param || '';
      const p = r.mixerState.stems[stem]?.params;
      if (!p) return;
      const value = target.type === 'checkbox' ? target.checked : parseFloat(target.value);
      (p as unknown as Record<string, unknown>)[param] = value;
      if (typeof r.applyStemParamsToChain === 'function') r.applyStemParamsToChain(stem);
      if (typeof r.scheduleServerPreview === 'function') r.scheduleServerPreview();
    });
  }

  // Listeners en stage (persistente): solo una vez
  if (stage && !(stage as unknown as { _lgmdmStageBound?: boolean })._lgmdmStageBound) {
    (stage as unknown as { _lgmdmStageBound?: boolean })._lgmdmStageBound = true;
    stage.addEventListener('dragover', (e) => { e.preventDefault(); stage.classList.add('dragover'); });
    stage.addEventListener('dragleave', () => stage.classList.remove('dragover'));
    stage.addEventListener('drop', (e: Event) => {
      e.preventDefault();
      stage.classList.remove('dragover');
      const files = (e as DragEvent).dataTransfer?.files;
      if (files && files.length) void handleDroppedFiles(Array.from(files));
    });
  }

  // Listeners en toolbar (elementos se re-crean con innerHTML en cada renderMixer
  // → se GCean solos, seguro bindear siempre)
  document.getElementById('mixerAddStemBtn')?.addEventListener('click', () => {
    document.getElementById('mixerFileInput')?.click();
  });
  document.getElementById('mixerAddMultiBtn')?.addEventListener('click', () => {
    document.getElementById('mixerMultiInput')?.click();
  });
  document.getElementById('mixerLibraryBtn')?.addEventListener('click', () => {
    initMixerLibrary()?.refreshStemLibrary();
  });

  // Play
  document.getElementById('mxrPlayBtn')?.addEventListener('click', () => {
    if (typeof r.togglePreview === 'function') r.togglePreview();
  });
  document.getElementById('mxrSeek')?.addEventListener('input', (e) => {
    if (typeof r.seekPreview === 'function') {
      r.seekPreview(parseFloat((e.target as HTMLInputElement).value));
    }
  });

  // Clear
  document.getElementById('mixerClearBtn')?.addEventListener('click', () => {
    if (typeof r.resetPreviewEngine === 'function') r.resetPreviewEngine();
    renderMixer();
  });

  document.getElementById('mxrDropBtn')?.addEventListener('click', () => {
    document.getElementById('mixerFileInput')?.click();
  });
  document.getElementById('mxrEmptyLibraryBtn')?.addEventListener('click', () => {
    initMixerLibrary()?.refreshStemLibrary();
  });

  // File inputs
  document.getElementById('mixerFileInput')?.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files[0]) void handleDroppedFiles([files[0]]);
  });
  document.getElementById('mixerMultiInput')?.addEventListener('change', (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (files && files.length) void handleDroppedFiles(Array.from(files));
  });
}

async function handleDroppedFiles(files: File[]): Promise<void> {
  const r = runtime();
  const m = model();
  const api = lg().api;
  if (!r || !m) return;
  // FIX K11: antes handleDroppedFiles solo creaba la entrada del stem con
  // `uploaded: false` y descartaba el File (no lo guardaba ni subía). El WS
  // /ws/mix-stream necesita stems en la librería (library_id) para resolverlos,
  // y runServerPreview filtra `uploaded` → los stems locales nunca entraban
  // al preview. Ahora: guardamos el File, subimos a /mix/stem-library/upload,
  // seteamos libraryId + uploaded=true, y disparamos el preview.
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    if (!r.mixerState.stems[name]) {
      const params = { ...(m.defaultStemParams() as unknown as StemParams), stem_type: m.detectStemType(name) };
      r.mixerState.stems[name] = { uploaded: false, params, file };
    } else {
      r.mixerState.stems[name].file = file;
    }
    renderMixer();
    if (api && !r.mixerState.stems[name].libraryId) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        const item = await api.apiFetch<{ id?: string; original_filename?: string }>('/mix/stem-library/upload', { method: 'POST', body: fd });
        if (item?.id) {
          r.mixerState.stems[name].libraryId = item.id;
          r.mixerState.stems[name].uploaded = true;
          r.mixerState.stems[name].libraryName = item.original_filename || file.name;
          await r.decodeStemForPreview(name, file);
          r.scheduleServerPreview();
        }
      } catch (err) {
        console.warn('No se pudo subir el stem a la librería del mixer:', err);
      }
    }
    renderMixer();
  }
}

function renderMixerSidePanel(): void {
  // Side panel render básico (la lógica completa está en master-console/visualizer-helpers).
  const panel = getMixerSidePanel();
  if (!panel) return;
  const r = runtime();
  if (!r) return;
  const stemCount = Object.keys(r.mixerState.stems).length;
  panel.innerHTML = `<div class="mxr-side-info"><h3>Mixer</h3><p>${stemCount} stem${stemCount !== 1 ? 's' : ''} activos.</p></div>`;
}

// ── Init ───────────────────────────────────────────────────────────────

const wLGMDM = lg();
const mixerUiApi = (wLGMDM.mixerUi = wLGMDM.mixerUi || {}) as Record<string, unknown>;
(mixerUiApi as { render: () => void }).render = renderMixer;
(mixerUiApi as { buildStemLibraryIdMap: (n: string[]) => Record<string, string> }).buildStemLibraryIdMap = buildStemLibraryIdMap;
window.buildStemLibraryIdMap = buildStemLibraryIdMap;

if (typeof window.buildStemLibraryIdMap === 'function' && runtime()) {
  runtime()!.buildStemLibraryIdMap = buildStemLibraryIdMap;
}

// FIX M-NEW-1: el flag `mixerUIBound` se seteaba pero no se consultaba → el
// comentario "HMR-safe" mentía. Ahora el init se skipea si el flag ya está
// (re-ejecución del módulo en HMR). El flag se setea ANTES del init.
if ((wLGMDM as Record<string, unknown>).mixerUIBound) {
  // Ya inicializado — skipear (HMR re-entry).
} else {
  (wLGMDM as Record<string, unknown>).mixerUIBound = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initTemplates();
      renderMixer();
    }, { once: true, signal });
  } else {
    initTemplates();
    renderMixer();
  }
}

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => controller.abort(), { once: true });

export {};
