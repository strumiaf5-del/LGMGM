// Single metrics store — one source of truth for live server metrics.
// Consumers subscribe; producers publish. Defensive: subscriber errors are
// isolated so one broken consumer doesn't break the others.
//

export interface Spectrum {
  bands_db?: number[];
  values_db?: number[];
  values?: number[];
}

export interface ChainMeter {
  gr_db?: number;
}

export interface ChainMeters {
  comp?: ChainMeter;
  limiter?: ChainMeter;
  glue?: ChainMeter;
}

export interface MetricsSnapshot {
  spectrum?: number[] | Spectrum;
  chain_meters?: ChainMeters;
  chainMeters?: ChainMeters;
  comp_meters?: ChainMeter;
  limiter_meters?: ChainMeter;
  glue_meters?: ChainMeter;
  comp_gr_db?: number;
  limiter_gr_db?: number;
  glue_gr_db?: number;
  peak_db?: number;
  rms_db?: number;
  true_peak_db?: number;
  [key: string]: unknown;
}

export interface MetricsEvent {
  metrics: MetricsSnapshot | null;
  sequence: number;
  source: string;
  timestamp: number;
  error?: string;
}

export interface MetricsStore {
  publish(metrics: unknown, meta?: { source?: string }): MetricsSnapshot | null;
  get(): MetricsSnapshot | null;
  subscribe(fn: (event: MetricsEvent) => void): () => void;
  clear(): void;
}

type Listener = (event: MetricsEvent) => void;

function isSpectrum(value: unknown): value is Spectrum {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalize(metrics: unknown): MetricsSnapshot | null {
  if (!metrics || typeof metrics !== 'object') return null;
  const m = metrics as MetricsSnapshot;
  const copy: MetricsSnapshot = { ...m };
  if (Array.isArray(m.spectrum)) {
    copy.spectrum = (m.spectrum as number[]).slice();
  } else if (isSpectrum(m.spectrum)) {
    const bands = m.spectrum.bands_db || m.spectrum.values_db || m.spectrum.values || null;
    if (Array.isArray(bands)) copy.spectrum = bands.slice();
  }
  const chain = (copy.chain_meters || copy.chainMeters || {}) as ChainMeters;
  const comp = chain.comp || (copy.comp_meters as ChainMeter) || {};
  const limiter = chain.limiter || (copy.limiter_meters as ChainMeter) || {};
  const glue = chain.glue || (copy.glue_meters as ChainMeter) || {};
  if (copy.comp_gr_db == null && comp.gr_db != null) copy.comp_gr_db = Number(comp.gr_db);
  if (copy.limiter_gr_db == null && limiter.gr_db != null) copy.limiter_gr_db = Number(limiter.gr_db);
  if (copy.glue_gr_db == null && glue.gr_db != null) copy.glue_gr_db = Number(glue.gr_db);
  return copy;
}

function buildEvent(next: MetricsSnapshot | null, source: string, error?: string): MetricsEvent {
  return {
    metrics: next,
    sequence: ++sequence,
    source: source || 'unknown',
    timestamp: performance.now(),
    error,
  };
}

const listeners = new Set<Listener>();
let snapshot: MetricsSnapshot | null = null;
let sequence = 0;
let publishing = false;

function emit(event: MetricsEvent): void {
  if (publishing) return;
  publishing = true;
  try {
    listeners.forEach((fn) => {
      try { fn(event); } catch (err) {
        console.warn('[metrics-store] subscriber error', err);
      }
    });
    window.dispatchEvent(new CustomEvent<MetricsEvent>('lgmdm:metrics', { detail: event }));
  } finally {
    publishing = false;
  }
}

function publish(metrics: unknown, meta: { source?: string } = {}): MetricsSnapshot | null {
  const next = normalize(metrics);
  if (!next) {
    console.debug('[metrics-store] publish skipped: normalize returned null', { metrics, source: meta.source });
    emit(buildEvent(null, meta.source || 'unknown', 'invalid-metrics'));
    return null;
  }
  snapshot = next;
  emit(buildEvent(next, meta.source || 'unknown'));
  return next;
}

function get(): MetricsSnapshot | null {
  if (!snapshot) return null;
  const copy: MetricsSnapshot = { ...snapshot };
  if (Array.isArray(snapshot.spectrum)) copy.spectrum = (snapshot.spectrum as number[]).slice();
  return copy;
}

function subscribe(fn: Listener): () => void {
  if (typeof fn !== 'function') return () => {};
  listeners.add(fn);
  if (snapshot) {
    try {
      fn({ metrics: get(), sequence, source: 'replay', timestamp: performance.now() });
    } catch (err) {
      console.warn('[metrics-store] replay subscriber error', err);
    }
  }
  return () => { listeners.delete(fn); };
}

function clear(): void {
  snapshot = null;
}

export const metricsStore: MetricsStore = Object.freeze({
  publish,
  get,
  subscribe,
  clear,
});
