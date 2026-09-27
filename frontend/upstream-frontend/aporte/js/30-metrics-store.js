/* LGMDM — Single Metrics Store
 * One source of truth for live server metrics.
 * Consumers subscribe; producers publish. No DOM cloning and no function wrappers.
 */
(function (global) {
  'use strict';
  const LG = global.LGMDM = global.LGMDM || {};
  const listeners = new Set();
  let snapshot = null;
  let sequence = 0;
  let publishing = false;

  function normalize(metrics) {
    if (!metrics || typeof metrics !== 'object') return null;
    const copy = { ...metrics };
    if (Array.isArray(metrics.spectrum)) copy.spectrum = metrics.spectrum.slice();
    else if (metrics.spectrum && typeof metrics.spectrum === 'object') {
      const bands = metrics.spectrum.bands_db || metrics.spectrum.values_db || metrics.spectrum.values || null;
      if (Array.isArray(bands)) copy.spectrum = bands.slice();
    }
    const chain = copy.chain_meters || copy.chainMeters || {};
    const comp = chain.comp || copy.comp_meters || {};
    const limiter = chain.limiter || copy.limiter_meters || {};
    const glue = chain.glue || copy.glue_meters || {};
    if (copy.comp_gr_db == null && comp.gr_db != null) copy.comp_gr_db = Number(comp.gr_db);
    if (copy.limiter_gr_db == null && limiter.gr_db != null) copy.limiter_gr_db = Number(limiter.gr_db);
    if (copy.glue_gr_db == null && glue.gr_db != null) copy.glue_gr_db = Number(glue.gr_db);
    return copy;
  }

  function publish(metrics, meta = {}) {
    const next = normalize(metrics);
    if (!next) {
      console.debug('[metrics-store] publish skipped: normalize returned null', { metrics, source: meta.source });
      const failEvent = {
        metrics: null,
        sequence: ++sequence,
        source: meta.source || 'unknown',
        timestamp: performance.now(),
        error: 'invalid-metrics',
      };
      if (!publishing) {
        publishing = true;
        try {
          listeners.forEach((fn) => {
            try { fn(failEvent); } catch (err) { console.warn('[metrics-store] subscriber error', err); }
          });
          global.dispatchEvent(new CustomEvent('lgmdm:metrics', { detail: failEvent }));
        } finally {
          publishing = false;
        }
      }
      return null;
    }
    snapshot = next;
    const event = {
      metrics: next,
      sequence: ++sequence,
      source: meta.source || 'unknown',
      timestamp: performance.now(),
    };
    if (publishing) return next;
    publishing = true;
    try {
      listeners.forEach((fn) => {
        try { fn(event); } catch (err) { console.warn('[metrics-store] subscriber error', err); }
      });
      global.dispatchEvent(new CustomEvent('lgmdm:metrics', { detail: event }));
    } finally {
      publishing = false;
    }
    return next;
  }

  function get() {
    if (!snapshot) return null;
    const copy = { ...snapshot };
    if (Array.isArray(snapshot.spectrum)) copy.spectrum = snapshot.spectrum.slice();
    return copy;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return () => {};
    listeners.add(fn);
    if (snapshot) {
      try { fn({ metrics: get(), sequence, source: 'replay', timestamp: performance.now() }); } catch (_) {}
    }
    return () => listeners.delete(fn);
  }

  function clear() {
    snapshot = null;
  }

  LG.metrics = Object.assign(LG.metrics || {}, { publish, get, subscribe, clear });
})(window);
