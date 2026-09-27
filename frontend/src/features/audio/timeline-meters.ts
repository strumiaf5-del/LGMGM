// features/audio/timeline-meters.ts — Medidores en tiempo real server-side.
// Port de /root/nuevito/frontend/upstream-frontend/dist/js/44-timeline-meters.js
// (PRODUCTION reference, no del aporte experimental).
//
// Indexa un timeline pre-computado por el backend (compute_meters_timeline)
// usando audio.currentTime como índice. Sin AnalyserNode, sin biquads,
// sin getFloatFrequencyData. Los valores son exactos del backend.

interface MetricsShape {
  publish?: (data: Record<string, unknown>, opts: { source: string }) => void;
}

interface TimelineBlock {
  peak_db?: number;
  rms_db?: number;
  lufs?: number;
  stereo_corr?: number;
  spectrum?: number[];
}

interface ChainMetersSnapshot {
  comp?: { gr_db?: number; curve?: number[]; curve_hop_ms?: number };
  mb?: {
    low_gr_db?: number; mid_gr_db?: number; high_gr_db?: number;
    low_curve?: number[]; mid_curve?: number[]; high_curve?: number[];
    curve_hop_ms?: number;
  };
  glue?: { gr_db?: number; curve?: number[]; curve_hop_ms?: number };
  parallel?: { gr_db?: number; curve?: number[]; curve_hop_ms?: number };
  ms_comp?: {
    mid?: { gr_db?: number; curve?: number[]; curve_hop_ms?: number };
    side?: { gr_db?: number; curve?: number[]; curve_hop_ms?: number };
  };
  meters_timeline?: { timeline?: TimelineBlock[]; hop_ms?: number; n_blocks?: number };
}

interface PostLimiter {
  peak_db?: number;
  rms_db?: number;
  lufs?: number;
  stereo_correlation?: number;
}

interface FlatTelemetry {
  meters?: ChainMetersSnapshot;
  chain_meters?: ChainMetersSnapshot;
  post_limiter?: PostLimiter;
  analysis_after?: { true_peak_db?: number; mono_compatibility_db?: number; spectrum?: unknown };
  peak_db?: number;
  rms_db?: number;
  lufs?: number;
  lufs_momentary?: number;
  stereo_correlation?: number;
  true_peak_db?: number;
  mono_compatibility_db?: number;
  spectrum?: number[] | unknown;
}

interface Curves {
  comp?: { curve: number[]; hop: number };
  mb?: { low: number[]; mid: number[]; high: number[]; hop: number };
  glue?: { curve: number[]; hop: number };
  parallel?: { curve: number[]; hop: number };
  msMid?: { curve: number[]; hop: number };
  msSide?: { curve: number[]; hop: number };
}

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  metrics?: MetricsShape;
  proFeatures?: { realtimeMeters?: RealtimeMetersApi };
};

interface RealtimeMetersApi {
  start: () => void;
  stop: () => void;
  isRunning: () => boolean;
  reset: () => void;
  hasTimeline: () => boolean;
}

let timeline: TimelineBlock[] | null = null;
let hopMs = 33;
let chainSnapshot: Record<string, unknown> | null = null;
let curves: Curves | null = null;
let rafId = 0;
let running = false;
let idlePublished = false;

function extractCurves(chain: ChainMetersSnapshot | undefined): Curves {
  const out: Curves = {};
  if (!chain) return out;
  if (chain.comp && chain.comp.curve && chain.comp.curve_hop_ms) {
    out.comp = { curve: chain.comp.curve, hop: chain.comp.curve_hop_ms };
  }
  if (chain.mb && chain.mb.curve_hop_ms) {
    out.mb = {
      low: chain.mb.low_curve ?? [],
      mid: chain.mb.mid_curve ?? [],
      high: chain.mb.high_curve ?? [],
      hop: chain.mb.curve_hop_ms,
    };
  }
  if (chain.glue && chain.glue.curve && chain.glue.curve_hop_ms) {
    out.glue = { curve: chain.glue.curve, hop: chain.glue.curve_hop_ms };
  }
  if (chain.parallel && chain.parallel.curve && chain.parallel.curve_hop_ms) {
    out.parallel = { curve: chain.parallel.curve, hop: chain.parallel.curve_hop_ms };
  }
  if (chain.ms_comp) {
    if (chain.ms_comp.mid && chain.ms_comp.mid.curve && chain.ms_comp.mid.curve_hop_ms) {
      out.msMid = { curve: chain.ms_comp.mid.curve, hop: chain.ms_comp.mid.curve_hop_ms };
    }
    if (chain.ms_comp.side && chain.ms_comp.side.curve && chain.ms_comp.side.curve_hop_ms) {
      out.msSide = { curve: chain.ms_comp.side.curve, hop: chain.ms_comp.side.curve_hop_ms };
    }
  }
  return out;
}

function sampleCurve(entry: { curve: number[]; hop: number } | undefined, tSec: number): number | null {
  if (!entry || !entry.curve || !entry.curve.length || !entry.hop) return null;
  const idx = Math.floor((tSec * 1000) / entry.hop);
  const clamped = Math.max(0, Math.min(idx, entry.curve.length - 1));
  return Number(entry.curve[clamped]);
}

function flattenTelemetry(telemetry: FlatTelemetry | Record<string, unknown>): FlatTelemetry {
  let flat = telemetry as FlatTelemetry;
  if ((telemetry as FlatTelemetry).meters) {
    flat = Object.assign({}, telemetry, (telemetry as FlatTelemetry).meters) as FlatTelemetry;
  }
  if ((telemetry as FlatTelemetry).chain_meters) {
    flat = Object.assign({}, flat, (telemetry as FlatTelemetry).chain_meters) as FlatTelemetry;
  }
  const post: PostLimiter | undefined =
    flat.post_limiter ||
    ((flat.chain_meters as unknown as { post_limiter?: PostLimiter })?.post_limiter);
  if (post) {
    if (post.peak_db != null && flat.peak_db == null) flat.peak_db = post.peak_db;
    if (post.rms_db != null && flat.rms_db == null) flat.rms_db = post.rms_db;
    if (post.lufs != null && flat.lufs == null) flat.lufs = post.lufs;
    if (post.stereo_correlation != null && flat.stereo_correlation == null) flat.stereo_correlation = post.stereo_correlation;
  }
  const aa = flat.analysis_after || ((telemetry as FlatTelemetry).analysis_after);
  if (aa) {
    if (aa.true_peak_db != null && flat.true_peak_db == null) flat.true_peak_db = aa.true_peak_db;
    if (aa.mono_compatibility_db != null && flat.mono_compatibility_db == null) flat.mono_compatibility_db = aa.mono_compatibility_db;
  }
  return flat;
}

function buildMetrics(block: TimelineBlock | null, tSec: number | null): Record<string, unknown> {
  const base: Record<string, unknown> = chainSnapshot ? { ...chainSnapshot } : {};
  if (block) {
    if (Number.isFinite(block.peak_db)) base.peak_db = block.peak_db;
    if (Number.isFinite(block.rms_db)) base.rms_db = block.rms_db;
    if (Number.isFinite(block.lufs)) base.lufs_momentary = block.lufs;
    if (Number.isFinite(block.stereo_corr)) base.stereo_correlation = block.stereo_corr;
    if (Array.isArray(block.spectrum)) base.spectrum = block.spectrum;
  }

  if (curves && tSec != null) {
    const srcChain = (chainSnapshot && ((chainSnapshot as FlatTelemetry).chain_meters || (chainSnapshot as FlatTelemetry).meters)) || {};
    const chain: ChainMetersSnapshot = { ...(srcChain as ChainMetersSnapshot) };
    if (curves.comp) {
      const v = sampleCurve(curves.comp, tSec);
      if (v != null) chain.comp = { ...(chain.comp || {}), gr_db: v };
    }
    if (curves.glue) {
      const v = sampleCurve(curves.glue, tSec);
      if (v != null) chain.glue = { ...(chain.glue || {}), gr_db: v };
    }
    if (curves.parallel) {
      const v = sampleCurve(curves.parallel, tSec);
      if (v != null) chain.parallel = { ...(chain.parallel || {}), gr_db: v };
    }
    if (curves.mb) {
      const chain2 = chain.mb || {};
      const lv = sampleCurve({ curve: curves.mb.low, hop: curves.mb.hop }, tSec);
      const mv = sampleCurve({ curve: curves.mb.mid, hop: curves.mb.hop }, tSec);
      const hv = sampleCurve({ curve: curves.mb.high, hop: curves.mb.hop }, tSec);
      chain.mb = { ...chain2 };
      if (lv != null) chain.mb.low_gr_db = lv;
      if (mv != null) chain.mb.mid_gr_db = mv;
      if (hv != null) chain.mb.high_gr_db = hv;
    }
    if (curves.msMid) {
      const v = sampleCurve(curves.msMid, tSec);
      if (v != null) {
        chain.ms_comp = { ...(chain.ms_comp || {}) };
        chain.ms_comp.mid = { ...(chain.ms_comp.mid || {}), gr_db: v };
      }
    }
    if (curves.msSide) {
      const v = sampleCurve(curves.msSide, tSec);
      if (v != null) {
        chain.ms_comp = { ...(chain.ms_comp || {}) };
        chain.ms_comp.side = { ...(chain.ms_comp.side || {}), gr_db: v };
      }
    }
    if (chainSnapshot && (chainSnapshot as FlatTelemetry).chain_meters) {
      base.chain_meters = chain;
    } else {
      base.meters = chain;
    }
  }
  return base;
}

function tick(): void {
  rafId = requestAnimationFrame(tick);
  if (!running) return;

  const audio = document.querySelector<HTMLAudioElement>('#previewAudioWrap audio[data-preview-ready="true"]')
    || document.querySelector<HTMLAudioElement>('#previewAudioWrap audio');
  const playing = audio && !audio.paused && !audio.ended;

  if (!playing) {
    const m = lg().metrics;
    if (chainSnapshot && m?.publish && !idlePublished) {
      try { m.publish(buildMetrics(null, null), { source: 'server-timeline-idle' }); } catch (_) { /* ignore */ }
      idlePublished = true;
    }
    return;
  }
  idlePublished = false;

  if (!timeline || !timeline.length) return;

  const tSec = Number(audio.currentTime) || 0;
  const idx = Math.max(0, Math.min(
    Math.floor((tSec * 1000) / hopMs),
    timeline.length - 1
  ));
  const block = timeline[idx];
  const metrics = buildMetrics(block, tSec);

  const m2 = lg().metrics;
  if (m2?.publish) {
    try { m2.publish(metrics, { source: 'server-timeline' }); } catch (_) { /* ignore */ }
  }
}

function start(): void {
  if (running) return;
  running = true;
  idlePublished = false;
  if (!rafId) rafId = requestAnimationFrame(tick);
}

function stop(): void {
  running = false;
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = 0;
  }
}

function reset(): void {
  timeline = null;
  chainSnapshot = null;
  curves = null;
  stop();
}

// ── API pública ───────────────────────────────────────────────────────

const realtimeMetersApi: RealtimeMetersApi = {
  start, stop, isRunning: () => running, reset,
  hasTimeline: () => !!(timeline && timeline.length),
};

const wLGMDM = lg();
const proFeatures = (wLGMDM.proFeatures = wLGMDM.proFeatures || {}) as Record<string, unknown>;
(proFeatures as { realtimeMeters: RealtimeMetersApi }).realtimeMeters = realtimeMetersApi;

// Event listeners (sin AbortController porque este módulo debe persistir)
window.addEventListener('lgmdm:preview-telemetry', ((e: Event) => {
  const d = (e as CustomEvent).detail as { telemetry?: FlatTelemetry };
  if (!d || !d.telemetry) return;
  const flat = flattenTelemetry(d.telemetry);
  chainSnapshot = flat as unknown as Record<string, unknown>;
  const chain = ((flat as FlatTelemetry).chain_meters || (flat as FlatTelemetry).meters || flat) as ChainMetersSnapshot;
  curves = extractCurves(chain);

  const tl = ((flat as FlatTelemetry).chain_meters && (flat as FlatTelemetry).chain_meters!.meters_timeline) ||
              ((flat as FlatTelemetry).meters && (flat as FlatTelemetry).meters!.meters_timeline);
  if (tl && tl.timeline && tl.timeline.length) {
    timeline = tl.timeline;
    hopMs = tl.hop_ms || 33;
    console.log('[44-timeline] meters_timeline cargada:', tl.n_blocks, 'bloques, hop=', hopMs, 'ms');
  } else {
    console.warn('[44-timeline] meters_timeline no encontrada en telemetry');
  }
  start();
}) as EventListener);

window.addEventListener('lgmdm:preview-ready', ((e: Event) => {
  const detail = (e as CustomEvent).detail as { ready?: boolean };
  if (!e || !detail || !detail.ready) {
    chainSnapshot = null;
    curves = null;
    timeline = null;
    stop();
  } else {
    start();
  }
}) as EventListener);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { start(); }, { once: true });
} else {
  start();
}

// HMR idempotency
(wLGMDM as Record<string, unknown>).timelineMetersBound = true;

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => {
  reset();
}, { once: true });

export {};
