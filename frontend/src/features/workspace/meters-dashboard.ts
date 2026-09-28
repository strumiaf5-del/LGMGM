// features/workspace/meters-dashboard.ts — Dashboard, medidores principales.
// Port de /root/nuevito/frontend/upstream-frontend/dist/js/10-meters-dashboard.js
// (PRODUCTION reference, no del aporte experimental).
//
// El live meters en tiempo real está separado en `features/audio/timeline-meters.ts`
// (sigue el patrón del dist: 10-meters-dashboard.js + 44-timeline-meters.js).
//

interface MetricsShape {
  subscribe?: (cb: (data: { metrics: Record<string, unknown> }) => void) => () => void;
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
  authToken?: () => string;
}

interface UiShape {
  bindOnce: (el: HTMLElement | Window | Document, type: string, fn: EventListener, key: string) => boolean;
}

interface StateShape {
  // U-4: metersRafId/metersSourceNode/metersAudioCtx removed — dead state.
  // The live-meters RAF + AudioContext are owned by timeline-meters.ts.
}

declare global {
  interface Window {
    // (window.clamp01 ya está declarado en core/utils.ts)
    showLoudnessMeter?: (v: number | null | undefined) => void;
  }
}

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  metrics?: MetricsShape;
  api?: ApiShape;
  ui?: UiShape;
  state?: StateShape;
};

// ── Bind sliders → previewController.request() ────────────────────────

const previewTriggerIds = [
  's-preview-start',
  's-ingain', 's-peak', 's-uselufs', 's-lufstarget',
  's-thresh', 's-ratio', 's-cattack', 's-crelease', 's-cmakeup',
  's-comp-link', 's-oversample',
  's-glue-bypass', 's-glue-thresh', 's-glue-ratio', 's-glue-attack', 's-glue-release', 's-glue-makeup',
  's-glue-pdr', 's-glue-pdr-hold',
  's-hp', 's-air', 's-shelf-freq', 's-lowshelf', 's-lowshelf-freq',
  's-comp-pdr', 's-comp-pdr-hold', 's-mb-pdr', 's-mb-pdr-hold',
  's-mscomp-pdr', 's-mscomp-pdr-hold',
  's-mb-sw-lowx', 's-mb-sw-highx', 's-mb-sw-low', 's-mb-sw-mid', 's-mb-sw-high',
  's-eq1freq', 's-eq1gain', 's-eq1q',
  's-eq2freq', 's-eq2gain', 's-eq2q',
  's-eq3freq', 's-eq3gain', 's-eq3q',
  's-eq4freq', 's-eq4gain', 's-eq4q',
  's-eq5freq', 's-eq5gain', 's-eq5q',
  's-eq6freq', 's-eq6gain', 's-eq6q',
  's-tatt', 's-tsus', 's-satdrive', 's-satmode', 's-satmix',
  's-mgain', 's-sgain', 's-width', 's-enhancer', 's-haas', 's-bassmono',
  's-rsize', 's-rwet', 's-ceiling', 's-lrelease',
  's-format',
  's-mb-lowx', 's-mb-highx',
  's-mb-low-th', 's-mb-low-ratio', 's-mb-low-att', 's-mb-low-rel', 's-mb-low-mu',
  's-mb-mid-th', 's-mb-mid-ratio', 's-mb-mid-att', 's-mb-mid-rel', 's-mb-mid-mu',
  's-mb-high-th', 's-mb-high-ratio', 's-mb-high-att', 's-mb-high-rel', 's-mb-high-mu',
  'mb-bypass',
  's-dyneq-bypass', 's-dyneq-freq', 's-dyneq-q', 's-dyneq-thresh', 's-dyneq-ratio', 's-dyneq-attack', 's-dyneq-release', 's-dyneq-maxred',
  's-reso-bypass', 's-reso-freq', 's-reso-q', 's-reso-thresh', 's-reso-ratio', 's-reso-attack', 's-reso-release', 's-reso-maxred',
  's-mono-freq', 's-mono-amount', 's-eq-mode', 's-lp-taps',
  's-tonalbal-bypass', 's-tonalbal-amount', 's-tonalbal-boost', 's-tonalbal-cut', 's-tonalbal-bands',
  'parallelBypass', 'parallelMix', 'parallelThresh', 'parallelRatio', 'parallelAttack', 'parallelRelease',
  'mb-stereo-bypass',
  's-clip-bypass', 's-clip-mode', 's-clip-ceiling', 's-clip-drive',
  's-lp-bypass', 's-lp-cutoff',
  's-mseq-bypass', 's-mseq-mid-freq', 's-mseq-side-freq',
  's-mscomp-bypass',
  's-nr-bypass', 's-nr-strength', 's-nr-noise-sample-sec',
];

const controller = new AbortController();
const { signal } = controller;
const bind = lg().ui?.bindOnce;

previewTriggerIds.forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const evt = el.tagName === 'SELECT' || (el as HTMLInputElement).type === 'checkbox' ? 'change' : 'input';
  bind?.(el, evt, () => {
    const pc = (window.LGMDM as { previewController?: { request?: () => void } }).previewController;
    pc?.request?.();
  }, `preview-${evt}`);
});

// ── Dashboard polling ─────────────────────────────────────────────────

// FIX M10: `dashboardWS` era dead code — se declaraba y se seteaba a null
// pero nunca se asignaba a un WebSocket real. El backend /ws/dashboard
// existe pero el FE no lo usa (solo hace polling HTTP). Eliminado.
let dashboardPollTimer: number | null = null;

function startDashboardPolling(): void {
  stopDashboard();
  const api = lg().api;
  if (!api) return;
  dashboardPollTimer = window.setInterval(async () => {
    try {
      // FIX K4: client.get lanza ApiError en !ok (incluido 401/403). Revisamos
      // .status en el error para detener el polling si la sesión expiró.
      await api.client.get(`${api.apiBase()}/dashboard`);
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) { stopDashboard(); return; }
      /* otros errores: ignorar */
    }
  }, 5000);
}

function stopDashboard(): void {
  if (dashboardPollTimer) {
    clearInterval(dashboardPollTimer);
    dashboardPollTimer = null;
  }
}

function startDashboard(): void {
  stopDashboard();
  if (!lg().api?.authToken?.()) return;
  startDashboardPolling();
}

bind?.(window, 'lgmdm:authenticated', startDashboard as EventListener, 'dashboard-authenticated');
startDashboard();

// ── Metrics Store → meters principales ───────────────────────────────

(function subscribeToMetrics(): void {
  const store = window.LGMDM?.metrics as MetricsShape | undefined;
  if (!store?.subscribe) return;
  const clamp01 = window.clamp01 || ((v: number) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)));

  function fill(id: string, value: unknown, floor: number, ceiling = 0): void {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(value);
    const pct = `${clamp01((n - floor) / (ceiling - floor)) * 100}%`;
    el.style.height = pct;
    el.style.width = '100%';
    if (Number.isFinite(n)) {
      el.setAttribute('aria-valuenow', String(Math.round(n * 10) / 10));
    }
  }

  function text(id: string, value: unknown, suffix = ''): void {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(value);
    el.textContent = Number.isFinite(n) ? `${n.toFixed(1)}${suffix}` : `-∞${suffix}`;
  }

  function update(payload: { metrics: Record<string, unknown> }): void {
    const m = payload.metrics || {};
    const peak = Number(m.peak_db);
    const rms = Number(m.rms_db);
    const lufs = Number(m.lufs_momentary ?? m.lufs);
    const truePeak = Number(m.true_peak_db);
    const corr = Number(m.stereo_correlation);
    const mono = Number(m.mono_compatibility_db);

    fill('meterPeakFill', peak, -60, 0);
    fill('meterRmsFill', rms, -60, 0);
    fill('meterLufsFill', lufs, -40, 0);
    fill('meterTruePeakFill', truePeak, -60, 0);
    text('meterPeakReadout', peak, ' dB');
    text('meterRmsReadout', rms, ' dB');
    text('meterLufsReadout', lufs, ' LUFS');
    text('meterTruePeakReadout', truePeak, ' dBTP');

    if (typeof window.showLoudnessMeter === 'function' && Number.isFinite(lufs)) {
      window.showLoudnessMeter(lufs);
    }

    const stereoFill = document.getElementById('stereoMeterFill');
    if (stereoFill && Number.isFinite(corr)) {
      stereoFill.style.width = `${clamp01((corr + 1) / 2) * 100}%`;
      stereoFill.setAttribute('aria-valuenow', String(Math.round(corr * 100) / 100));
      stereoFill.setAttribute('aria-valuetext', `correlación ${corr.toFixed(2)}`);
    }
    if (Number.isFinite(corr)) {
      const el = document.getElementById('stereoMeterReadout');
      if (el) el.textContent = `corr: ${corr.toFixed(2)}`;
    }
    if (Number.isFinite(mono)) {
      const el = document.getElementById('monoCompatReadout');
      if (el) el.textContent = `mono: ${mono.toFixed(1)} dB`;
    }

    const bands = Array.isArray(m.spectrum) ? (m.spectrum as number[]) : [];
    const bandIds = ['sub', 'bass', 'lowmid', 'mid', 'highmid', 'air'];
    bandIds.forEach((id, i) => {
      const v = Number(bands[i]);
      const bar = document.getElementById(`fb-${id}`);
      const read = document.getElementById(`fbv-${id}`);
      if (bar && Number.isFinite(v)) {
        bar.style.width = `${clamp01((v + 80) / 80) * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(v)));
        bar.setAttribute('aria-valuetext', `${Math.round(v)} dB`);
      }
      if (read && Number.isFinite(v)) read.textContent = `${v.toFixed(0)} dB`;
    });

    const _chain = (m.meters as Record<string, unknown> | undefined) || (m.chain_meters as Record<string, unknown> | undefined) || m;
    const mb = (_chain.mb as Record<string, unknown> | undefined) || (_chain.mb_meters as Record<string, unknown> | undefined) || {};
    const compM = (_chain.comp as Record<string, unknown> | undefined) || (_chain.comp_meters as Record<string, unknown> | undefined) || {};
    const glueM = (_chain.glue as Record<string, unknown> | undefined) || (_chain.glue_meters as Record<string, unknown> | undefined) || {};
    const parM = (_chain.parallel as Record<string, unknown> | undefined) || (_chain.parallel_meters as Record<string, unknown> | undefined) || {};
    const msComp = (_chain.ms_comp as Record<string, unknown> | undefined) || (_chain.ms_comp_meters as Record<string, unknown> | undefined) || {};
    const deess = (_chain.deess_meters as Record<string, unknown> | undefined) || {};
    const reso = (_chain.reso as Record<string, unknown> | undefined) || (_chain.reso_meters as Record<string, unknown> | undefined) || {};
    const preLim = (_chain.pre_limiter as Record<string, unknown> | undefined) || {};
    const postLim = (_chain.post_limiter as Record<string, unknown> | undefined) || {};

    // GR section SIEMPRE visible (no show/hide).
    const grSection = document.getElementById('mbGrSection');
    if (grSection) grSection.classList.remove('hidden-panel');

    function grBar(barId: string, readId: string, grDb: unknown, opts: { bypassLabel?: string } = {}): void {
      const bar = document.getElementById(barId);
      const read = document.getElementById(readId);
      const v = Number(grDb);
      const reducedDb = Number.isFinite(v) ? Math.abs(v) : 0;
      if (bar) {
        bar.style.width = `${clamp01(reducedDb / 18) * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(reducedDb * 10) / 10));
        bar.setAttribute('aria-valuetext', `${reducedDb.toFixed(1)} dB`);
      }
      const textVal = Number.isFinite(v) ? `${reducedDb.toFixed(1)} dB` : (opts.bypassLabel || '0.0 dB');
      if (read) {
        read.textContent = textVal;
        read.setAttribute?.('aria-valuenow', String(Math.round(reducedDb * 10) / 10));
        read.setAttribute?.('aria-valuetext', textVal);
      }
    }

    grBar('grBarLow', 'grReadLow', mb.low_gr_db);
    grBar('grBarMid', 'grReadMid', mb.mid_gr_db);
    grBar('grBarHigh', 'grReadHigh', mb.high_gr_db);
    grBar('grBarComp', 'grReadComp', compM.gr_db);
    grBar('grBarGlue', 'grReadGlue', glueM.bypass ? null : glueM.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarParallel', 'grReadParallel', parM.bypass ? null : parM.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarMsCompMid', 'grReadMsCompMid', msComp.bypass ? null : (msComp.mid as Record<string, unknown> | undefined)?.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarMsCompSide', 'grReadMsCompSide', msComp.bypass ? null : (msComp.side as Record<string, unknown> | undefined)?.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarDeess', 'grReadDeess', deess.bypass ? null : deess.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarReso', 'grReadReso', reso.bypass ? null : reso.gr_db, { bypassLabel: 'bypass' });

    function vuBar(id: string, dbValue: unknown, suffix: string): void {
      const el = document.getElementById(id);
      if (!el) return;
      const v = Number(dbValue);
      if (Number.isFinite(v)) {
        el.textContent = `${v.toFixed(1)}${suffix}`;
        el.setAttribute('aria-valuenow', String(Math.round(v * 10) / 10));
        el.setAttribute('aria-valuetext', `${v.toFixed(1)}${suffix}`);
      } else {
        el.textContent = '--';
        el.setAttribute('aria-valuenow', '0');
        el.setAttribute('aria-valuetext', '--');
      }
    }

    vuBar('vuPreRms', preLim.rms_db, ' dB');
    vuBar('vuPrePeak', preLim.peak_db, ' dB');
    vuBar('vuPreLufs', preLim.lufs, ' LUFS');
    vuBar('vuPostRms', postLim.rms_db, ' dB');
    vuBar('vuPostPeak', postLim.peak_db, ' dB');
    vuBar('vuPostLufs', postLim.lufs, ' LUFS');
    vuBar('vuPostGr', postLim.gr_db, ' dB');

    updateMetersSummary(m);
  }

  // SR no debe recibir 60 updates/segundo del meter — solo anunciamos
  // cruces significativos (peak > -3 dBFS, true peak > -1 dBTP, cambio
  // grande de LUFS). Throttle: 1 Hz máx.
  const _summaryState = { lastText: '', lastTs: 0, lastPeak: -Infinity, lastLufs: -Infinity as number };
  function updateMetersSummary(m: Record<string, unknown>): void {
    const now = performance.now();
    if (now - _summaryState.lastTs < 1000) return;
    const peak = Number(m.peak_db);
    const truePeak = Number(m.true_peak_db);
    const lufs = Number(m.lufs_momentary ?? m.lufs);
    let textVal: string | null = null;
    if (Number.isFinite(truePeak) && truePeak > -1) {
      textVal = `Atención: True Peak ${truePeak.toFixed(1)} dBTP cerca del clipping.`;
    } else if (Number.isFinite(peak) && peak > -3 && _summaryState.lastPeak <= -3) {
      textVal = `Peak subió a ${peak.toFixed(1)} dB.`;
    } else if (Number.isFinite(lufs) && Math.abs(lufs - (_summaryState.lastLufs ?? lufs)) > 2) {
      textVal = `Loudness momentáneo: ${lufs.toFixed(1)} LUFS.`;
    }
    _summaryState.lastTs = now;
    _summaryState.lastPeak = Number.isFinite(peak) ? peak : _summaryState.lastPeak;
    _summaryState.lastLufs = Number.isFinite(lufs) ? lufs : _summaryState.lastLufs;
    if (textVal && textVal !== _summaryState.lastText) {
      const el = document.getElementById('metersSummary');
      if (el) el.textContent = textVal;
      _summaryState.lastText = textVal;
    }
  }

  store.subscribe(update);

  window.addEventListener('analysis-updated', (evt) => {
    const data = (evt as CustomEvent).detail;
    if (data && typeof store.publish === 'function') {
      try { store.publish(data, { source: 'analysis' }); } catch (_) { /* ignore */ }
    }
  }, { signal });
})();

// ── Live Meters (no-op: el RAF y el AudioContext viven en timeline-meters.ts) ──

function teardownLiveMeters(): void {
  // U-4: the old live-meters teardown (cancelAnimationFrame, src.stop(),
  // ctx.close()) was dead — metersRafId/metersSourceNode/metersAudioCtx were
  // never assigned (only `|| null` inits + `= null` here). Real cleanup of the
  // live-meters RAF/AudioContext lives in timeline-meters.ts. Kept as a no-op
  // to preserve the public meters.teardownLiveMeters API + beforeunload call.
}

// ── API pública ───────────────────────────────────────────────────────

const wLGMDM = lg();
const metersApi = (wLGMDM.meters = wLGMDM.meters || {}) as Record<string, unknown>;
(metersApi as { stopDashboard: () => void }).stopDashboard = stopDashboard;
(metersApi as { teardownLiveMeters: () => void }).teardownLiveMeters = teardownLiveMeters;

// HMR idempotency
(wLGMDM as Record<string, unknown>).metersDashboardBound = true;

// Cleanup en beforeunload
window.addEventListener('beforeunload', () => {
  stopDashboard();
  teardownLiveMeters();
  controller.abort();
}, { once: true });

export {};
