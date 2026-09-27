// Audio routing tap — single Splitter/AnalyserNode connected to the active
// audio source (mixer master out, A/B node, or preview <audio> element).
// Reused by goniometer, waterfall, aurora and multiband visualizers.
//
// Ported from aporte/js/35-audio-tap.js with TypeScript types.
// FIX vs aporte: source candidate resolution is explicit (no `?` on globals).

import { audioEngine } from './audio-engine';

export interface BandSpec {
  id: 'lowMid' | 'highMid' | 'air';
  label: string;
  freq: number;
  q: number;
}

export const BAND_SPECS: readonly BandSpec[] = Object.freeze([
  { id: 'lowMid',  label: 'Low-Mid (200 Hz – 2 kHz)', freq: 632,  q: 0.7 },
  { id: 'highMid', label: 'High-Mid (2 kHz – 6 kHz)', freq: 3464, q: 1.0 },
  { id: 'air',     label: 'Air (> 6 kHz)',            freq: 9798, q: 1.2 },
]);

type AnyNode = AudioNode | null;

interface AudioTap {
  ctx: AudioContext | null;
  source: AnyNode;
  splitter: ChannelSplitterNode | null;
  masterOut: GainNode | null;
  mediaSource: MediaElementAudioSourceNode | null;
  sourceType: 'custom-node' | 'ab-node' | 'mixer' | 'media-element' | null;
  sourceEl: HTMLAudioElement | null;
  analyserL: AnalyserNode | null;
  analyserR: AnalyserNode | null;
  analyserGonioL: AnalyserNode | null;
  analyserGonioR: AnalyserNode | null;
  analyserWaterfall: AnalyserNode | null;
  analyserAurora: AnalyserNode | null;
  bandAnalysers: AnalyserNode[][];
  bandFilters: BiquadFilterNode[][];
  ready: boolean;
}

// External providers — set by the mixer/A-B modules when they boot.
// We keep these loose-typed because the mixer module isn't ported yet.
interface MixerEngineLike {
  previewEngine?: {
    masterGain?: GainNode | null;
    playing?: boolean;
  };
}

interface AbModuleLike {
  getGainNode?: () => GainNode | null;
  isPlaying?: () => boolean;
  setMode?: (mode: string) => void;
}

interface AppGlobals {
  mixerEngine?: MixerEngineLike;
  ab?: AbModuleLike;
  state?: {
    audio?: { tap?: AudioTap | null };
  };
}

function appGlobals(): AppGlobals {
  // FIX M1: reassign window.LGMDM if missing so the bridge isn't lost.
  const w = window as unknown as { LGMDM?: AppGlobals };
  if (!w.LGMDM) w.LGMDM = {} as AppGlobals;
  return w.LGMDM;
}

const tap: AudioTap = {
  ctx: null, source: null, splitter: null, masterOut: null,
  mediaSource: null, sourceType: null, sourceEl: null,
  analyserL: null, analyserR: null, analyserGonioL: null, analyserGonioR: null,
  analyserWaterfall: null, analyserAurora: null,
  bandAnalysers: [], bandFilters: [], ready: false,
};

function findAudioElement(): HTMLAudioElement | null {
  return (
    document.querySelector<HTMLAudioElement>('#previewAudioWrap audio[data-preview-ready="true"]')
    || document.querySelector<HTMLAudioElement>('#previewAudioWrap audio')
    || document.querySelector<HTMLAudioElement>('#mxrServerPreviewAudio')
  );
}

function safeDisconnect(node: AnyNode): void {
  try { node?.disconnect(); } catch { /* ignore */ }
}

export function ensureAudioTap(candidate?: AudioNode | HTMLAudioElement): AudioTap | null {
  const g = appGlobals();
  const mixerMaster = g.mixerEngine?.previewEngine?.masterGain ?? null;
  const isNode = !!candidate && typeof (candidate as AudioNode).connect === 'function';
  const isAudioEl = !!candidate && (candidate as HTMLElement).tagName === 'AUDIO';
  const audioEl = isAudioEl ? (candidate as HTMLAudioElement) : findAudioElement();

  const abGain = g.ab?.getGainNode?.() ?? null;
  const abPlaying = g.ab?.isPlaying?.() ?? false;

  // If already ready, check if the source changed.
  if (tap.ready) {
    if (isNode && tap.source !== candidate) teardownAudioTap();
    else if (audioEl && tap.sourceType === 'media-element' && tap.sourceEl !== audioEl) teardownAudioTap();
    else if (abPlaying && abGain && tap.source !== abGain) teardownAudioTap();
    else return tap;
  }

  const ctx = audioEngine.getContext();
  if (!ctx) return null;

  let source: AudioNode | null = null;
  let sourceType: AudioTap['sourceType'] = null;
  let masterOut: GainNode | null = null;
  let mediaSource: MediaElementAudioSourceNode | null = null;

  if (isNode) {
    source = candidate as AudioNode;
    sourceType = 'custom-node';
  } else if (abPlaying && abGain) {
    source = abGain;
    sourceType = 'ab-node';
  } else if (mixerMaster && mixerMaster.context === ctx && ctx.state !== 'closed' && g.mixerEngine?.previewEngine?.playing) {
    source = mixerMaster;
    sourceType = 'mixer';
  } else if (audioEl) {
    try {
      const cached = (audioEl as HTMLAudioElement & { _mediaElementSourceNode?: MediaElementAudioSourceNode })._mediaElementSourceNode;
      mediaSource = cached ?? (ctx.createMediaElementSource ? ctx.createMediaElementSource(audioEl) : null);
      if (mediaSource) {
        (audioEl as HTMLAudioElement & { _mediaElementSourceNode?: MediaElementAudioSourceNode })._mediaElementSourceNode = mediaSource;
        masterOut = ctx.createGain();
        masterOut.gain.value = 1;
        try { mediaSource.connect(masterOut); } catch { /* ignore */ }
        try { masterOut.connect(ctx.destination); } catch { /* ignore */ }
        source = mediaSource;
        sourceType = 'media-element';
      }
    } catch {
      return null;
    }
  } else if (mixerMaster && mixerMaster.context === ctx && ctx.state !== 'closed') {
    source = mixerMaster;
    sourceType = 'mixer';
  }

  if (!source) return null;

  const splitter = ctx.createChannelSplitter(2);
  try { source.connect(splitter); } catch { /* ignore */ }

  // Main stereo analysers (2048 FFT).
  const analyserL = ctx.createAnalyser();
  analyserL.fftSize = 2048;
  analyserL.smoothingTimeConstant = 0;
  analyserL.minDecibels = -90;
  analyserL.maxDecibels = -6;
  const analyserR = ctx.createAnalyser();
  analyserR.fftSize = 2048;
  analyserR.smoothingTimeConstant = 0;
  analyserR.minDecibels = -90;
  analyserR.maxDecibels = -6;
  try { splitter.connect(analyserL, 0); } catch { /* ignore */ }
  try { splitter.connect(analyserR, 1); } catch { /* ignore */ }

  // Goniometer analysers (1024 FFT, fast response).
  const analyserGonioL = ctx.createAnalyser();
  analyserGonioL.fftSize = 1024;
  analyserGonioL.smoothingTimeConstant = 0;
  analyserGonioL.minDecibels = -90;
  analyserGonioL.maxDecibels = -6;
  const analyserGonioR = ctx.createAnalyser();
  analyserGonioR.fftSize = 1024;
  analyserGonioR.smoothingTimeConstant = 0;
  analyserGonioR.minDecibels = -90;
  analyserGonioR.maxDecibels = -6;
  try { splitter.connect(analyserGonioL, 0); } catch { /* ignore */ }
  try { splitter.connect(analyserGonioR, 1); } catch { /* ignore */ }

  // Pro-visualizer analysers.
  const analyserWaterfall = ctx.createAnalyser();
  analyserWaterfall.fftSize = 2048;
  analyserWaterfall.smoothingTimeConstant = 0.65;
  analyserWaterfall.minDecibels = -90;
  analyserWaterfall.maxDecibels = -6;
  try { splitter.connect(analyserWaterfall, 0); } catch { /* ignore */ }

  const analyserAurora = ctx.createAnalyser();
  analyserAurora.fftSize = 2048;
  analyserAurora.smoothingTimeConstant = 0.78;
  analyserAurora.minDecibels = -90;
  analyserAurora.maxDecibels = -6;
  try { splitter.connect(analyserAurora, 0); } catch { /* ignore */ }

  const bandAnalysers: AnalyserNode[][] = [];
  const bandFilters: BiquadFilterNode[][] = [];
  for (const spec of BAND_SPECS) {
    const fL = ctx.createBiquadFilter();
    fL.type = 'bandpass';
    fL.frequency.value = spec.freq;
    fL.Q.value = spec.q;
    const fR = ctx.createBiquadFilter();
    fR.type = 'bandpass';
    fR.frequency.value = spec.freq;
    fR.Q.value = spec.q;
    try { splitter.connect(fL, 0); } catch { /* ignore */ }
    try { splitter.connect(fR, 1); } catch { /* ignore */ }
    const aL = ctx.createAnalyser();
    aL.fftSize = 512;
    aL.smoothingTimeConstant = 0;
    aL.minDecibels = -90;
    aL.maxDecibels = -6;
    const aR = ctx.createAnalyser();
    aR.fftSize = 512;
    aR.smoothingTimeConstant = 0;
    aR.minDecibels = -90;
    aR.maxDecibels = -6;
    try { fL.connect(aL); } catch { /* ignore */ }
    try { fR.connect(aR); } catch { /* ignore */ }
    bandAnalysers.push([aL, aR]);
    bandFilters.push([fL, fR]);
  }

  Object.assign(tap, {
    ctx, source, splitter, masterOut, mediaSource,
    sourceType,
    sourceEl: sourceType === 'media-element' ? audioEl : null,
    analyserL, analyserR,
    analyserGonioL, analyserGonioR, analyserWaterfall, analyserAurora,
    bandAnalysers, bandFilters,
    ready: true,
  });

  const app = appGlobals();
  app.state = app.state || {};
  app.state.audio = app.state.audio || {};
  app.state.audio.tap = tap;
  return tap;
}

export function teardownAudioTap(): void {
  if (!tap.ready) return;
  safeDisconnect(tap.splitter);
  safeDisconnect(tap.analyserL);
  safeDisconnect(tap.analyserR);
  safeDisconnect(tap.analyserGonioL);
  safeDisconnect(tap.analyserGonioR);
  safeDisconnect(tap.analyserWaterfall);
  safeDisconnect(tap.analyserAurora);
  tap.bandAnalysers.forEach((pair) => pair.forEach(safeDisconnect));
  tap.bandFilters.forEach((pair) => pair.forEach(safeDisconnect));
  if (tap.sourceType === 'media-element') {
    safeDisconnect(tap.masterOut);
    safeDisconnect(tap.mediaSource);
  }
  Object.assign(tap, {
    ready: false, ctx: null, source: null, splitter: null, masterOut: null,
    mediaSource: null, sourceType: null, sourceEl: null,
    analyserL: null, analyserR: null, analyserGonioL: null, analyserGonioR: null,
    analyserWaterfall: null, analyserAurora: null,
    bandAnalysers: [], bandFilters: [],
  });
  const app = appGlobals();
  if (app.state?.audio?.tap === tap) app.state.audio.tap = null;
}

export function getTap(): AudioTap {
  return tap;
}

export const audioTap = Object.freeze({
  ensure: ensureAudioTap,
  teardown: teardownAudioTap,
  bandSpecs: BAND_SPECS,
  getTap,
});

// Bridge to window.LGMDM.proFeatures.audioTap — consumed by master-console
// (ensureScopeTap) and premium-suite. Must be assigned so the global namespace
// resolves the tap (the ESM export alone isn't enough for @ts-nocheck consumers).
interface LgmdmProFeatures {
  proFeatures?: { audioTap?: typeof audioTap };
}
function lgmdm(): LgmdmProFeatures {
  const w = window as Window & { LGMDM?: LgmdmProFeatures };
  if (!w.LGMDM) w.LGMDM = {};
  return w.LGMDM;
}
const g = lgmdm();
g.proFeatures = g.proFeatures || {};
g.proFeatures.audioTap = audioTap;
