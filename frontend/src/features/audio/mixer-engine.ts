// mixer-engine.ts — mixer preview engine + server preview

import { audioEngine } from '../../core/audio-engine';
import { audioTap } from '../../core/audio-tap';
import { cachedEl } from '../../core/dom';
import { wsAuthUrl } from '../../core/api';
import { defaultStemParams, type StemParams } from './mixer-model';

export interface StemEntry {
  file: File | null;
  params: StemParams;
  uploaded: boolean;
  duration?: number;
  libraryId?: string;
  libraryName?: string;
  __frozen?: boolean;
}

interface StemChain {
  hp: BiquadFilterNode;
  lp: BiquadFilterNode;
  eqLow: BiquadFilterNode;
  eqLoMid: BiquadFilterNode;
  eqHiMid: BiquadFilterNode;
  eqHigh: BiquadFilterNode;
  comp: DynamicsCompressorNode;
  gainNode: GainNode;
  panNode: StereoPannerNode;
  muteSoloGain: GainNode;
  source: AudioBufferSourceNode | null;
}

interface PreviewEngine {
  ctx: AudioContext | null;
  masterGain: GainNode | null;
  nodes: Record<string, StemChain>;
  buffers: Record<string, ArrayBuffer>;
  decodedBuffers: Record<string, AudioBuffer>;
  playing: boolean;
  position: number;
  startCtxTime: number;
  startOffset: number;
  duration: number;
  rafId: number;
  endTimer: ReturnType<typeof setTimeout> | null;
}

interface ServerPreview {
  enabled: boolean;
  ws: WebSocket | null;
  debounceTimer: ReturnType<typeof setTimeout> | null;
  rendering: boolean;
}

interface MixerState {
  sessionId: string;
  stems: Record<string, StemEntry>;
  stemLibrary: unknown[];
  stemLibraryLoaded: boolean;
  jobId: string | null;
  // FIX A17: `polling: ReturnType<typeof setInterval> | null` era dead code
  // — declarado en la interfaz e inicializado en `mixerState` pero nunca
  // asignado ni leído (el polling del aporte original no se portó al TS).
}

function genUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function dbToLin(db: number): number { return Math.pow(10, db / 20); }

const mixerState: MixerState = {
  sessionId: genUUID(),
  stems: {},
  stemLibrary: [],
  stemLibraryLoaded: false,
  jobId: null,
};

const previewEngine: PreviewEngine = {
  ctx: null,
  masterGain: null,
  nodes: {},
  buffers: {},
  decodedBuffers: {},
  playing: false,
  position: 0,
  startCtxTime: 0,
  startOffset: 0,
  duration: 0,
  rafId: 0,
  endTimer: null,
};

const serverPreview: ServerPreview = {
  enabled: false,
  ws: null,
  debounceTimer: null,
  rendering: false,
};

function ensureAudioCtx(): AudioContext {
  if (!previewEngine.ctx) {
    previewEngine.ctx = audioEngine.getContext();
    previewEngine.masterGain = previewEngine.ctx.createGain();
    previewEngine.masterGain.connect(previewEngine.ctx.destination);
    const masterGainEl = cachedEl<HTMLInputElement>('mix-master-gain');
    const masterDb = parseFloat(masterGainEl?.value || '0');
    if (previewEngine.masterGain) previewEngine.masterGain.gain.value = dbToLin(masterDb);
  }
  return previewEngine.ctx;
}

export async function decodeStemForPreview(name: string, file: File): Promise<void> {
  try {
    const arrBuf = await file.arrayBuffer();
    previewEngine.buffers[name] = arrBuf;
    if (previewEngine.playing) {
      const decoded = await ensureDecoded(name);
      if (decoded) await startStemSource(name, getPreviewPosition());
    }
    updateTransportUI();
  } catch (err) {
    console.warn(`No se pudo leer "${name}" para preview:`, err);
  }
}

async function ensureDecoded(name: string): Promise<AudioBuffer | null> {
  if (previewEngine.decodedBuffers[name]) return previewEngine.decodedBuffers[name];
  if (!previewEngine.buffers[name]) return null;
  const ctx = ensureAudioCtx();
  try {
    // slice(0) prevents decodeAudioData from detaching the stored buffer.
    const audioBuf = await ctx.decodeAudioData(previewEngine.buffers[name].slice(0));
    previewEngine.decodedBuffers[name] = audioBuf;
    return audioBuf;
  } catch (err) {
    console.warn(`Error decodificando "${name}":`, err);
    return null;
  }
}

function ensureStemChain(name: string): StemChain {
  if (previewEngine.nodes[name]) return previewEngine.nodes[name];
  const ctx = ensureAudioCtx();
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.707;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.707;
  const eqLow = ctx.createBiquadFilter(); eqLow.type = 'peaking';
  const eqLoMid = ctx.createBiquadFilter(); eqLoMid.type = 'peaking';
  const eqHiMid = ctx.createBiquadFilter(); eqHiMid.type = 'peaking';
  const eqHigh = ctx.createBiquadFilter(); eqHigh.type = 'peaking';
  const comp = ctx.createDynamicsCompressor();
  const gainNode = ctx.createGain();
  const panNode = ctx.createStereoPanner();
  const muteSoloGain = ctx.createGain();

  hp.connect(lp); lp.connect(eqLow); eqLow.connect(eqLoMid); eqLoMid.connect(eqHiMid);
  eqHiMid.connect(eqHigh); eqHigh.connect(comp); comp.connect(gainNode);
  gainNode.connect(panNode); panNode.connect(muteSoloGain);
  if (previewEngine.masterGain) muteSoloGain.connect(previewEngine.masterGain);

  const chain: StemChain = { hp, lp, eqLow, eqLoMid, eqHiMid, eqHigh, comp, gainNode, panNode, muteSoloGain, source: null };
  previewEngine.nodes[name] = chain;
  return chain;
}

function applyStemParamsToChain(name: string): void {
  if (!previewEngine.ctx) return;
  const chain = previewEngine.nodes[name];
  const p = mixerState.stems[name]?.params;
  if (!chain || !p) return;
  const t = previewEngine.ctx.currentTime;
  const ramp = (audioParam: AudioParam, val: number) => audioParam.setTargetAtTime(val, t, 0.015);
  ramp(chain.hp.frequency, p.hp_cutoff_hz);
  ramp(chain.lp.frequency, Math.min(p.lp_cutoff_hz, previewEngine.ctx.sampleRate / 2 - 100));
  ramp(chain.eqLow.frequency, p.eq_low_freq); ramp(chain.eqLow.gain, p.eq_low_gain_db); ramp(chain.eqLow.Q, p.eq_low_q);
  ramp(chain.eqLoMid.frequency, p.eq_lomid_freq); ramp(chain.eqLoMid.gain, p.eq_lomid_gain_db); ramp(chain.eqLoMid.Q, p.eq_lomid_q);
  ramp(chain.eqHiMid.frequency, p.eq_himid_freq); ramp(chain.eqHiMid.gain, p.eq_himid_gain_db); ramp(chain.eqHiMid.Q, p.eq_himid_q);
  ramp(chain.eqHigh.frequency, p.eq_high_freq); ramp(chain.eqHigh.gain, p.eq_high_gain_db); ramp(chain.eqHigh.Q, p.eq_high_q);
  if (p.comp_enabled) {
    const thrDb = 20 * Math.log10(Math.max(p.comp_threshold, 1e-6));
    chain.comp.threshold.setTargetAtTime(Math.max(-100, thrDb), t, 0.02);
    chain.comp.ratio.setTargetAtTime(Math.min(20, Math.max(1, p.comp_ratio)), t, 0.02);
    chain.comp.attack.setTargetAtTime(Math.max(0.001, p.comp_attack_ms / 1000), t, 0.01);
    chain.comp.release.setTargetAtTime(Math.max(0.01, p.comp_release_ms / 1000), t, 0.01);
  } else {
    chain.comp.threshold.setTargetAtTime(0, t, 0.02);
    chain.comp.ratio.setTargetAtTime(1, t, 0.02);
  }
  const makeupLin = p.comp_enabled ? dbToLin(p.comp_makeup_db) : 1;
  ramp(chain.gainNode.gain, dbToLin(p.gain_db) * makeupLin);
  ramp(chain.panNode.pan, p.pan);
}

function updateAllMuteSolo(): void {
  if (!previewEngine.ctx) return;
  const stems = mixerState.stems;
  const anySolo = Object.values(stems).some((s) => s.params.solo);
  const t = previewEngine.ctx.currentTime;
  for (const [name, s] of Object.entries(stems)) {
    const chain = previewEngine.nodes[name];
    if (!chain) continue;
    const audible = !s.params.mute && (!anySolo || s.params.solo);
    chain.muteSoloGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01);
  }
}

export function getPreviewPosition(): number {
  if (!previewEngine.playing || !previewEngine.ctx) return previewEngine.position;
  return previewEngine.startOffset + (previewEngine.ctx.currentTime - previewEngine.startCtxTime);
}

async function startStemSource(name: string, atPosition: number): Promise<void> {
  const buf = await ensureDecoded(name);
  if (!buf || !previewEngine.ctx) return;
  // FIX C9: re-check playing after the await — stopPreview may have run while
  // we were decoding, which would leave this source orphaned and audible.
  if (!previewEngine.playing) return;
  const chain = ensureStemChain(name);
  applyStemParamsToChain(name);
  if (chain.source) { try { chain.source.stop(); } catch { /* ignore */ } }
  const src = previewEngine.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(chain.hp);
  const offset = Math.min(Math.max(atPosition, 0), buf.duration);
  try { src.start(previewEngine.ctx.currentTime, offset); } catch { /* ignore */ }
  src.onended = () => { try { src.disconnect(); } catch { /* ignore */ } };
  chain.source = src;
}

export async function playPreview(): Promise<void> {
  // FIX C8: guard against re-entry — a rapid double-call would start duplicate
  // sources and leave an orphaned RAF. Stop first if already playing.
  if (previewEngine.playing) stopPreview(false);
  const names = Object.keys(mixerState.stems).filter((n) => previewEngine.buffers[n]);
  ensureAudioCtx();
  if (previewEngine.ctx && previewEngine.ctx.state === 'suspended') await previewEngine.ctx.resume();
  if (!names.length) { updateTransportUI(); return; }

  await Promise.all(names.map(async (n) => { await ensureDecoded(n); }));

  let maxDur = 0;
  for (const n of names) {
    const b = previewEngine.decodedBuffers[n];
    if (b && b.duration > maxDur) maxDur = b.duration;
  }
  previewEngine.duration = maxDur;
  if (previewEngine.position >= previewEngine.duration) previewEngine.position = 0;
  const startOffset = previewEngine.position;
  for (const n of names) {
    await startStemSource(n, startOffset);
  }
  // FIX A13: re-check post-await. Si stopPreview/teardownMixerEngine corrió
  // durante los awaits (resume, ensureDecoded, startStemSource), no debemos
  // setear playing=true ni programar endTimer → queda "playing" sin audio.
  if (!previewEngine.ctx || previewEngine.ctx.state === 'closed') return;
  previewEngine.playing = true;
  previewEngine.startCtxTime = previewEngine.ctx ? previewEngine.ctx.currentTime : 0;
  previewEngine.startOffset = startOffset;
  updateAllMuteSolo();
  if (previewEngine.endTimer) clearTimeout(previewEngine.endTimer);
  const remaining = Math.max(0, previewEngine.duration - startOffset);
  previewEngine.endTimer = setTimeout(() => { void stopPreview(true); }, remaining * 1000 + 60);
  updateTransportUI();
  window.dispatchEvent(new CustomEvent('lgmdm:playback-started', { detail: { source: 'mixer-preview' } }));
  tickTransport();
}

export function stopPreview(resetToStart: boolean): void {
  const wasPlaying = previewEngine.playing;
  if (previewEngine.ctx) {
    Object.values(previewEngine.nodes).forEach((chain) => {
      if (chain.source) { try { chain.source.stop(); } catch { /* ignore */ } chain.source = null; }
    });
  }
  previewEngine.position = resetToStart ? 0 : getPreviewPosition();
  previewEngine.playing = false;
  if (previewEngine.endTimer) { clearTimeout(previewEngine.endTimer); previewEngine.endTimer = null; }
  if (previewEngine.rafId) { cancelAnimationFrame(previewEngine.rafId); previewEngine.rafId = 0; }
  updateTransportUI();
  if (wasPlaying) {
    window.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { source: 'mixer-preview' } }));
  }
}

export function togglePreview(): void {
  if (previewEngine.playing) stopPreview(false);
  else void playPreview();
}

export function seekPreview(seconds: number): void {
  const wasPlaying = previewEngine.playing;
  if (wasPlaying) stopPreview(false);
  previewEngine.position = Math.max(0, Math.min(seconds, previewEngine.duration || seconds));
  updateTransportUI();
  if (wasPlaying) void playPreview();
}

function fmtTime(s: number): string {
  if (!Number.isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function updateTransportUI(): void {
  const btn = cachedEl<HTMLButtonElement>('mxrPlayBtn');
  const seek = cachedEl<HTMLInputElement>('mxrSeek');
  const time = cachedEl<HTMLElement>('mxrTimeLabel');
  if (btn) btn.textContent = previewEngine.playing ? '⏸' : '▶';
  const pos = getPreviewPosition();
  if (seek) {
    seek.max = String(previewEngine.duration || 0);
    if (document.activeElement !== seek) seek.value = String(pos);
  }
  if (time) time.textContent = `${fmtTime(pos)} / ${fmtTime(previewEngine.duration)}`;
}

function tickTransport(): void {
  if (!previewEngine.playing) return;
  updateTransportUI();
  previewEngine.rafId = requestAnimationFrame(tickTransport);
}

function removeStemFromPreview(name: string): void {
  const chain = previewEngine.nodes[name];
  if (chain) {
    if (chain.source) { try { chain.source.stop(); } catch { /* ignore */ } }
    const safe = (node: AudioNode | null) => {
      if (node && typeof node.disconnect === 'function') { try { node.disconnect(); } catch { /* ignore */ } }
    };
    safe(chain.hp); safe(chain.lp); safe(chain.eqLow); safe(chain.eqLoMid);
    safe(chain.eqHiMid); safe(chain.eqHigh); safe(chain.comp); safe(chain.gainNode);
    safe(chain.panNode); safe(chain.muteSoloGain);
    chain.source = null;
  }
  delete previewEngine.nodes[name];
  delete previewEngine.decodedBuffers[name];
  delete previewEngine.buffers[name];
}

function resetPreviewEngine(): void {
  stopPreview(true);
  Object.keys(previewEngine.nodes).forEach(removeStemFromPreview);
}

// ── Server preview ────────────────────────────────────────────
function setServerPreviewStatus(txt: string): void {
  const el = cachedEl<HTMLElement>('mxrServerPreviewStatus');
  if (el) el.textContent = txt;
}

function scheduleServerPreview(): void {
  if (!serverPreview.enabled) return;
  if (serverPreview.debounceTimer) clearTimeout(serverPreview.debounceTimer);
  setServerPreviewStatus('Esperando…');
  serverPreview.debounceTimer = setTimeout(() => { void runServerPreview(); }, 800);
}

async function runServerPreview(): Promise<void> {
  const names = Object.keys(mixerState.stems).filter((n) => mixerState.stems[n].uploaded);
  if (!names.length) { setServerPreviewStatus('Subí al menos un stem.'); return; }
  if (serverPreview.ws) { try { serverPreview.ws.close(); } catch { /* ignore */ } serverPreview.ws = null; }
  serverPreview.rendering = true;
  setServerPreviewStatus('Renderizando en el servidor…');
  const stemParams: Record<string, StemParams> = {};
  names.forEach((n) => { stemParams[n] = mixerState.stems[n].params; });
  const mixParamsPayload = {
    master_gain_db: parseFloat(cachedEl<HTMLInputElement>('mix-master-gain')?.value || '0'),
    target_lufs: parseFloat(cachedEl<HTMLInputElement>('mix-lufs')?.value || '-14'),
    normalize_before_master: cachedEl<HTMLInputElement>('mix-normalize')?.checked ?? true,
    master_limiter_ceiling: parseFloat(cachedEl<HTMLInputElement>('mix-master-ceiling')?.value || '0.95'),
    chain_params: {},
  };
  const pcmChunks: ArrayBuffer[] = [];
  let sampleRate = 44100, channels = 2;
  try {
    const wsUrl = await wsAuthUrl('/ws/mix-stream');
    await new Promise<void>((resolve, reject) => {
      let resolved = false;
      const ws = new WebSocket(wsUrl);
      serverPreview.ws = ws;
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        // FIX K11: antes se mandaba `stem_library_ids: {}` (vacío) → el backend
        // hacía stem_library_ids.get(name) = None → "Stem 'X' no encontrado".
        // Ahora poblamos el mapa desde mixerState.stems[n].libraryId (seteado
        // por addStemFromLibrary y por handleDroppedFiles al subir el stem).
        const stem_library_ids: Record<string, string> = {};
        names.forEach((n) => {
          const id = mixerState.stems[n]?.libraryId;
          if (id) stem_library_ids[n] = id;
        });
        ws.send(JSON.stringify({
          session_id: mixerState.sessionId,
          stem_names: names,
          stem_library_ids,
          stem_params: stemParams,
          mix_params: mixParamsPayload,
          chunk_seconds: 1.0,
          preview_seconds: 12,
          sr: 44100,
        }));
      };
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          let msg: { event?: string; sample_rate?: number; channels?: number; message?: string };
          try { msg = JSON.parse(ev.data); } catch { return; }
          if (msg.event === 'chunk') {
            if (typeof msg.sample_rate === 'number') sampleRate = msg.sample_rate;
            if (typeof msg.channels === 'number') channels = msg.channels;
          }
          if (msg.event === 'error') reject(new Error(msg.message || 'Error de preview'));
          if (msg.event === 'done' && !resolved) { resolved = true; resolve(); }
        } else {
          pcmChunks.push(ev.data as ArrayBuffer);
        }
      };
      ws.onerror = () => reject(new Error('No se pudo abrir /ws/mix-stream'));
      ws.onclose = () => {
        if (!resolved) {
          resolved = true;
          if (pcmChunks.length) resolve();
          else reject(new Error('Streaming cerrado sin audio'));
        }
      };
    });

    if (pcmChunks.length) {
      const blob = wavBlobFromPcm16(pcmChunks, sampleRate, channels);
      const audioEl = cachedEl<HTMLAudioElement>('mxrServerPreviewAudio');
      if (audioEl) {
        if (audioEl.dataset.blobUrl) URL.revokeObjectURL(audioEl.dataset.blobUrl);
        const url = URL.createObjectURL(blob);
        audioEl.dataset.blobUrl = url;
        audioEl.src = url;
        void audioEl.play().catch(() => { /* ignore autoplay block */ });
      }
    }
    setServerPreviewStatus(`Preview listo ✓ — ${names.length} stem${names.length !== 1 ? 's' : ''}`);
  } catch (err) {
    setServerPreviewStatus(`Error: ${(err as Error).message}`);
  } finally {
    serverPreview.rendering = false;
    const ws = (serverPreview as ServerPreview).ws;
    if (ws) {
      try { ws.close(); } catch { /* ignore */ }
      (serverPreview as ServerPreview).ws = null;
    }
  }
}

// ── PCM → WAV blob helper (inline, was window.wavBlobFromPcm16) ──
function wavBlobFromPcm16(chunks: ArrayBuffer[], sampleRate: number, channels: number): Blob {
  const total = chunks.reduce((n, c) => n + c.byteLength, 0);
  const buffer = new ArrayBuffer(44 + total);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + total, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, 'data');
  view.setUint32(40, total, true);
  let off = 44;
  for (const c of chunks) { new Uint8Array(buffer, off, c.byteLength).set(new Uint8Array(c)); off += c.byteLength; }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ── Teardown ──────────────────────────────────────────────────
let tornDown = false;
export function teardownMixerEngine(): void {
  if (tornDown) return;
  tornDown = true;
  stopPreview(true);
  if (serverPreview.debounceTimer) { clearTimeout(serverPreview.debounceTimer); serverPreview.debounceTimer = null; }
  if (serverPreview.ws) { try { serverPreview.ws.close(); } catch { /* ignore */ } serverPreview.ws = null; }
  resetPreviewEngine();
  if (previewEngine.masterGain) { try { previewEngine.masterGain.disconnect(); } catch { /* ignore */ } }
  previewEngine.ctx = null;
  previewEngine.masterGain = null;
  // FIX M12: tear down the audio tap (it may be holding analysers connected
  // to the mixer's masterGain that we just disconnected).
  try { audioTap.teardown(); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { source: 'mixer-teardown' } }));
}
window.addEventListener('beforeunload', teardownMixerEngine, { once: true });

// ── Public surface (consumed by audioTap + master console) ─────
export const mixerEngine = Object.freeze({
  mixerState,
  previewEngine,
  serverPreview,
  ensureAudioCtx,
  decodeStemForPreview,
  ensureDecoded,
  ensureStemChain,
  applyStemParamsToChain,
  updateAllMuteSolo,
  getPreviewPosition,
  startStemSource,
  playPreview,
  stopPreview,
  togglePreview,
  seekPreview,
  fmtTime,
  updateTransportUI,
  tickTransport,
  removeStemFromPreview,
  resetPreviewEngine,
  setServerPreviewStatus,
  scheduleServerPreview,
  runServerPreview,
  teardown: teardownMixerEngine,
  // Allow external code to register stems (used by future UI module).
  addStem(name: string, entry: StemEntry): void {
    mixerState.stems[name] = entry;
    Object.freeze(entry);
  },
  removeStem: removeStemFromPreview,
  defaultStemParams,
});

// Bridge to window.LGMDM.mixerEngine (legacy compat — audioTap reads this).
interface LgmdmMixer {
  mixerEngine?: typeof mixerEngine;
  mixer?: { state: MixerState; previewEngine: PreviewEngine; functions: { playPreview: typeof playPreview; stopPreview: typeof stopPreview; togglePreview: typeof togglePreview } };
}

function lgmdm(): any {
  return (window as any).LGMDM || {};
}

const g = lgmdm();
(window as Window & { LGMDM?: LgmdmMixer }).LGMDM = g;
g.mixerEngine = mixerEngine;
g.mixer = Object.freeze({
  state: mixerState,
  previewEngine,
  functions: Object.freeze({ playPreview, stopPreview, togglePreview }),
});

// ── createMixerLibraryService (definido en dist 13-mixer.js) ────────
// Servicio de librería de stems: refresh + add + delete. Portado del dist.

interface MixerLibraryItem {
  id: string;
  original_filename: string;
  duration_sec?: number;
}

interface CreateMixerLibraryServiceCtx {
  mixerState: { stems: Record<string, { file: File | null; params: unknown; uploaded?: boolean; duration?: number; libraryId?: string; libraryName?: string }> };
  apiFetch: <T>(endpoint: string, options?: RequestInit) => Promise<T>;
  cachedEl: (id: string) => HTMLElement | null;
  defaultStemParams: (name: string) => unknown;
  addChannelToDOM: (name: string) => void;
  renderMixerSidePanel: () => void;
  decodeStemForPreview: (name: string, file: File) => Promise<void>;
  scheduleServerPreview: () => void;
  handleClientError?: (e: unknown, msg: string, ctx: Record<string, unknown>) => void;
}

let _stemLibrary: MixerLibraryItem[] = [];
let _stemLibraryLoaded = false;

function _freezeStem(_stem: { params: unknown }): void {
  // No-op intencional: el freeze de stems del aporte original no se porta al TS.
  // Se llama desde _onStemChange (línea 611) para mantener el contrato de la API
  // interna, pero hoy no aplica ninguna lógica de freeze.
}

function normalizeStemName(name: string | undefined, fallback: string | undefined): string {
  const base = (name || fallback || 'stem').replace(/\.[^.]+$/, '').trim();
  return base || 'stem';
}

export async function refreshStemLibrary(force: boolean = false): Promise<MixerLibraryItem[]> {
  if (_stemLibraryLoaded && !force) return _stemLibrary;
  try {
    const res = await lgmdm().api.apiFetch('/mix/stem-library');
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json() as { files?: MixerLibraryItem[] };
    _stemLibrary = data.files || [];
    _stemLibraryLoaded = true;
  } catch (err) {
    console.warn('No se pudo cargar la librería de stems:', err);
    _stemLibrary = [];
  }
  return _stemLibrary;
}

export async function addStemFromLibrary(item: MixerLibraryItem): Promise<void> {
  const stemName = normalizeStemName(item.original_filename, item.id);
  const state = lgmdm().mixerEngine?.mixerState || (lgmdm().mixerState as { stems: Record<string, unknown> });
  if (state.stems[stemName] && !confirm(`Ya existe "${stemName}". ¿Reemplazar?`)) return;
  state.stems[stemName] = {
    file: null,
    params: defaultStemParams(stemName),
    uploaded: true,
    duration: item.duration_sec,
    libraryId: item.id,
    libraryName: item.original_filename,
  };
  _freezeStem(state.stems[stemName] as { params: unknown });
  try {
    const res = await lgmdm().api.apiFetch(`/mix/stem-library/${item.id}/download`);
    if (!res.ok) throw new Error(await res.text());
    const blob = await res.blob();
    const file = new File([blob], item.original_filename || `${stemName}.wav`, { type: blob.type });
    await decodeStemForPreview(stemName, file);
    scheduleServerPreview();
  } catch (err) {
    console.warn('No se pudo preparar preview local del stem guardado:', err);
  }
}

export async function deleteStemFromLibrary(item: MixerLibraryItem): Promise<void> {
  if (!confirm(`¿Borrar "${item.original_filename}" de la librería de stems?`)) return;
  try {
    const res = await lgmdm().api.apiFetch(`/mix/stem-library/${item.id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(await res.text());
    _stemLibrary = _stemLibrary.filter((x) => x.id !== item.id);
  } catch (err) {
    lgmdm().errors?.handleClientError?.(err, 'No se pudo borrar el stem.', { context: 'mixer-stem-delete' });
  }
}

export function createMixerLibraryService(ctx: CreateMixerLibraryServiceCtx): {
  normalizeStemName: typeof normalizeStemName;
  refreshStemLibrary: typeof refreshStemLibrary;
  addStemFromLibrary: typeof addStemFromLibrary;
  deleteStemFromLibrary: typeof deleteStemFromLibrary;
} {
  return Object.freeze({
    normalizeStemName,
    refreshStemLibrary,
    addStemFromLibrary,
    deleteStemFromLibrary,
  });
}

// Exponer en window.LGMDM para que mixer-ui.ts lo pueda usar.
{
  const w = window as Window & { LGMDM?: { createMixerLibraryService?: typeof createMixerLibraryService } };
  if (w.LGMDM) w.LGMDM.createMixerLibraryService = createMixerLibraryService;
}
