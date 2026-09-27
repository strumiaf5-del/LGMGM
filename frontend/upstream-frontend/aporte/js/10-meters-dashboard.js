(function (global) {
  "use strict";
  const LGMDM = global.LGMDM = global.LGMDM || {};
// ============================================================
// 10-meters-dashboard.js — Dashboard, medidores en vivo, multiband GR/VU, espectrómetro
// ============================================================

// DOM cache centralizado en 00-api.js.
// ── Enlazar eventos de preview ──────────────────────────────
const previewTriggerIds = [
  "s-ingain",
  "s-peak",
  "s-uselufs",
  "s-lufstarget",
  "s-thresh",
  "s-ratio",
  "s-cattack",
  "s-crelease",
  "s-cmakeup",
  "s-comp-link",
  "s-oversample",
  "s-glue-bypass",
  "s-glue-thresh",
  "s-glue-ratio",
  "s-glue-attack",
  "s-glue-release",
  "s-glue-makeup",
  "s-glue-pdr",
  "s-glue-pdr-hold",
  "s-hp",
  "s-air",
  "s-shelf-freq",
  "s-lowshelf",
  "s-lowshelf-freq",
  "s-comp-pdr",
  "s-comp-pdr-hold",
  "s-mb-pdr",
  "s-mb-pdr-hold",
  "s-mscomp-pdr",
  "s-mscomp-pdr-hold",
  "s-mb-sw-lowx",
  "s-mb-sw-highx",
  "s-mb-sw-low",
  "s-mb-sw-mid",
  "s-mb-sw-high",
  "s-eq1freq",
  "s-eq1gain",
  "s-eq1q",
  "s-eq2freq",
  "s-eq2gain",
  "s-eq2q",
  "s-eq3freq",
  "s-eq3gain",
  "s-eq3q",
  "s-eq4freq",
  "s-eq4gain",
  "s-eq4q",
  "s-eq5freq",
  "s-eq5gain",
  "s-eq5q",
  "s-eq6freq",
  "s-eq6gain",
  "s-eq6q",
  "s-tatt",
  "s-tsus",
  "s-satdrive",
  "s-satmode",
  "s-satmix",
  "s-mgain",
  "s-sgain",
  "s-width",
  "s-enhancer",
  "s-haas",
  "s-bassmono",
  "s-rsize",
  "s-rwet",
  "s-ceiling",
  "s-lrelease",
  "s-format",
  "s-mb-lowx",
  "s-mb-highx",
  "s-mb-low-th",
  "s-mb-low-ratio",
  "s-mb-low-att",
  "s-mb-low-rel",
  "s-mb-low-mu",
  "s-mb-mid-th",
  "s-mb-mid-ratio",
  "s-mb-mid-att",
  "s-mb-mid-rel",
  "s-mb-mid-mu",
  "s-mb-high-th",
  "s-mb-high-ratio",
  "s-mb-high-att",
  "s-mb-high-rel",
  "s-mb-high-mu",
  "mb-bypass",
  "s-dyneq-bypass",
  "s-dyneq-freq",
  "s-dyneq-q",
  "s-dyneq-thresh",
  "s-dyneq-ratio",
  "s-dyneq-attack",
  "s-dyneq-release",
  "s-dyneq-maxred",
  "s-reso-bypass",
  "s-reso-freq",
  "s-reso-q",
  "s-reso-thresh",
  "s-reso-ratio",
  "s-reso-attack",
  "s-reso-release",
  "s-reso-maxred",
  "s-mono-freq",
  "s-mono-amount",
  "s-eq-mode",
  "s-lp-taps",
  "s-tonalbal-bypass",
  "s-tonalbal-amount",
  "s-tonalbal-boost",
  "s-tonalbal-cut",
  "s-tonalbal-bands",
  "parallelBypass",
  "parallelMix",
  "parallelThresh",
  "parallelRatio",
  "parallelAttack",
  "parallelRelease",
  "mb-stereo-bypass",
  "s-clip-bypass",
  "s-clip-mode",
  "s-clip-ceiling",
  "s-clip-drive",
  "s-lp-bypass",
  "s-lp-cutoff",
  "s-mseq-bypass",
  "s-mseq-mid-freq",
  "s-mseq-side-freq",
  "s-mscomp-bypass",
  "s-nr-bypass",
  "s-nr-strength",
  "s-nr-noise-sample-sec",
];

previewTriggerIds.forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  const evt = el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input";
  const bind = window.LGMDM.ui.bindOnce;
  bind(el, evt, () => window.LGMDM?.previewController?.request?.(), `preview-${evt}`);
});

// ── Dashboard ─────────────────────────────────────────────────
let dashboardWS = null,
  dashboardPollTimer = null;

function startDashboardPolling() {
  stopDashboard();
  dashboardPollTimer = setInterval(async () => {
    if (!LGMDM.api.authToken?.()) { stopDashboard(); return; }
    try {
      const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/dashboard`);
      if (res.status === 401 || res.status === 403) { stopDashboard(); return; }
    } catch (e) {}
  }, 5000);
}

function stopDashboard() {
  if (dashboardWS) {
    try {
      dashboardWS.close();
    } catch (e) {}
    dashboardWS = null;
  }
  if (dashboardPollTimer) {
    clearInterval(dashboardPollTimer);
    dashboardPollTimer = null;
  }
}

async function startDashboard() {
  stopDashboard();
  if (!LGMDM.api.authToken?.()) return;
  startDashboardPolling();
}

const dashboardBindOnce = window.LGMDM.ui.bindOnce;
dashboardBindOnce(window, 'lgmdm:authenticated', startDashboard, 'dashboard-authenticated');
startDashboard();

// ── Metrics Store → meters principales ───────────────────────
(function () {
  const store = window.LGMDM?.metrics;
  if (!store?.subscribe) return;
  const clamp01 = window.clamp01 || ((v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0)));
  const fill = (id, value, floor, ceiling = 0) => {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(value);
    const pct = `${clamp01((n - floor) / (ceiling - floor)) * 100}%`;
    el.style.height = pct;
    el.style.width = '100%';
    if (Number.isFinite(n)) {
      el.setAttribute('aria-valuenow', String(Math.round(n * 10) / 10));
    }
  };
  const text = (id, value, suffix = '') => {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Number(value);
    el.textContent = Number.isFinite(n) ? `${n.toFixed(1)}${suffix}` : `-∞${suffix}`;
  };
  const update = ({ metrics }) => {
    const m = metrics || {};
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
    // FIX 2: actualizar panel LUFS detallado (loudnessMeterWrap) cuando
    // llega metrics con lufs. El panel es estático en HTML; showLoudnessMeter
    // solo actualiza el número y la barra de progreso.
    if (typeof showLoudnessMeter === 'function' && Number.isFinite(lufs)) {
      showLoudnessMeter(lufs);
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
    const bands = Array.isArray(m.spectrum) ? m.spectrum : [];
    const bandIds = ['sub','bass','lowmid','mid','highmid','air'];
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

    // ── Reducción de ganancia multibanda + dinámica/paralela/glue ──────────
    // FIX A: backend envía toda la data de meters dentro de `m.meters.*`
    // (preview live) o campos planos (master job async). Unificamos ambas
    // rutas bajo `_chain`.
    const _chain = m.meters || m.chain_meters || m;
    const mb = _chain.mb || _chain.mb_meters || {};
    const compM = _chain.comp || _chain.comp_meters || {};
    const glueM = _chain.glue || _chain.glue_meters || {};
    const parM = _chain.parallel || _chain.parallel_meters || {};
    const msComp = _chain.ms_comp || _chain.ms_comp_meters || {};
    const deess = _chain.deess_meters || {};
    const reso = _chain.reso || _chain.reso_meters || {};
    const preLim = _chain.pre_limiter || {};
    const postLim = _chain.post_limiter || {};
    // FIX 2 cont: el mb-gr-section ahora SIEMPRE visible (era hidden-panel
    // por defecto). El JS sólo añade hidden-panel si NO hay datos de ningún
    // meter, y la remueve cuando llegan.
    const grSection = document.getElementById('mbGrSection');
    const hasAnyMeter = [
      mb.low_gr_db, mb.mid_gr_db, mb.high_gr_db,
      compM.gr_db, glueM.gr_db, parM.gr_db,
      msComp.mid_gr_db, msComp.side_gr_db,
      deess.gr_db, reso.gr_db,
      preLim.rms_db, preLim.peak_db,
      postLim.rms_db, postLim.peak_db, postLim.lufs
    ].some(Number.isFinite);
    if (grSection) {
      if (hasAnyMeter) grSection.classList.remove('hidden-panel');
      else grSection.classList.add('hidden-panel');
    }

    const grBar = (barId, readId, grDb, { bypassLabel } = {}) => {
      const bar = document.getElementById(barId);
      const read = document.getElementById(readId);
      const v = Number(grDb);
      // gr_db en el backend es magnitud de reducción (0 = sin reducir, más
      // negativo/positivo = más reducción según el stage) — normalizamos a
      // "cuánto se comió" en dB positivos para la barra, tope visual 18dB.
      const reducedDb = Number.isFinite(v) ? Math.abs(v) : 0;
      if (bar) {
        bar.style.width = `${clamp01(reducedDb / 18) * 100}%`;
        bar.setAttribute('aria-valuenow', String(Math.round(reducedDb * 10) / 10));
        bar.setAttribute('aria-valuetext', `${reducedDb.toFixed(1)} dB`);
      }
      const text = Number.isFinite(v) ? `${reducedDb.toFixed(1)} dB` : (bypassLabel || '0.0 dB');
      if (read) {
        read.textContent = text;
        read.setAttribute?.('aria-valuenow', String(Math.round(reducedDb * 10) / 10));
        read.setAttribute?.('aria-valuetext', text);
      }
    };
    grBar('grBarLow', 'grReadLow', mb.low_gr_db);
    grBar('grBarMid', 'grReadMid', mb.mid_gr_db);
    grBar('grBarHigh', 'grReadHigh', mb.high_gr_db);
    grBar('grBarComp', 'grReadComp', compM.gr_db);
    grBar('grBarGlue', 'grReadGlue', glueM.bypass ? null : glueM.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarParallel', 'grReadParallel', parM.bypass ? null : parM.gr_db, { bypassLabel: 'bypass' });

    // ── M/S Compressor ───────────────────────────────────────────────────
    // FIX B: ms_comp es anidado: {bypass, mid: {gr_db, ...}, side: {gr_db, ...}}
    grBar('grBarMsCompMid', 'grReadMsCompMid', msComp.bypass ? null : msComp.mid?.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarMsCompSide', 'grReadMsCompSide', msComp.bypass ? null : msComp.side?.gr_db, { bypassLabel: 'bypass' });

    // ── De-esser + Dynamic EQ (resonancias) ────────────────────────────
    grBar('grBarDeess', 'grReadDeess', deess.bypass ? null : deess.gr_db, { bypassLabel: 'bypass' });
    grBar('grBarReso', 'grReadReso', reso.bypass ? null : reso.gr_db, { bypassLabel: 'bypass' });

    // ── Pre/Post-Limiter VU ─────────────────────────────────────────────
    const vuBar = (id, dbValue, suffix) => {
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
    };
    vuBar('vuPreRms', preLim.rms_db, ' dB');
    vuBar('vuPrePeak', preLim.peak_db, ' dB');
    vuBar('vuPostRms', postLim.rms_db, ' dB');
    vuBar('vuPostPeak', postLim.peak_db, ' dB');
    vuBar('vuPostLufs', postLim.lufs, ' LUFS');

    // ── Meters summary (aria-live a 1Hz, solo en cruces de threshold) ──────
    updateMetersSummary(m);
  };

  // SR no debe recibir 60 updates/segundo del meter — solo anunciamos
  // cruces significativos (peak > -3 dBFS, true peak > -1 dBTP, cambio
  // grande de LUFS). Throttle: 1 Hz máx.
  const _summaryState = { lastText: '', lastTs: 0, lastPeak: -Infinity };
  function updateMetersSummary(m) {
    const now = performance.now();
    if (now - _summaryState.lastTs < 1000) return;
    const peak = Number(m.peak_db);
    const truePeak = Number(m.true_peak_db);
    const lufs = Number(m.lufs_momentary ?? m.lufs);
    let text = null;
    if (Number.isFinite(truePeak) && truePeak > -1) {
      text = `Atención: True Peak ${truePeak.toFixed(1)} dBTP cerca del clipping.`;
    } else if (Number.isFinite(peak) && peak > -3 && _summaryState.lastPeak <= -3) {
      text = `Peak subió a ${peak.toFixed(1)} dB.`;
    } else if (Number.isFinite(lufs) && Math.abs(lufs - (_summaryState.lastLufs ?? lufs)) > 2) {
      text = `Loudness momentáneo: ${lufs.toFixed(1)} LUFS.`;
    }
    _summaryState.lastTs = now;
    _summaryState.lastPeak = Number.isFinite(peak) ? peak : _summaryState.lastPeak;
    _summaryState.lastLufs = Number.isFinite(lufs) ? lufs : _summaryState.lastLufs;
    if (text && text !== _summaryState.lastText) {
      const el = document.getElementById('metersSummary');
      if (el) el.textContent = text;
      _summaryState.lastText = text;
    }
  }

  store.subscribe(update);

  // Bridge analysis-updated → metrics store (so meters show data after analysis)
  window.addEventListener('analysis-updated', (evt) => {
    const data = evt.detail;
    if (data && typeof store.publish === 'function') {
      try { store.publish(data, { source: 'analysis' }); } catch (_) {}
    }
  });
})();

// ── Live Meters Web Audio Engine ─────────────────────────────
const N_SAMPLES = 2048;
const _timeL = new Float32Array(N_SAMPLES);
const _timeR = new Float32Array(N_SAMPLES);
const _byteFreqL = new Uint8Array(N_SAMPLES / 2);
const _byteFreqR = new Uint8Array(N_SAMPLES / 2);
const _byteTimeL = new Uint8Array(N_SAMPLES);
const _byteTimeR = new Uint8Array(N_SAMPLES);

const _liveState = {
  running: false,
  sourceNodeOrEl: null,
  tap: null,
  lastTs: 0,
  silentFrames: 0,
  prevPeakDb: -60,
  prevRmsDb: -60,
  prevTruePeakDb: -60,
  prevLufs: -60,
  prevCorr: 1.0,
  prevMonoDb: 0,
  prevSpectrum: [-80, -80, -80, -80, -80, -80],
  prevMbLowGr: 0,
  prevMbMidGr: 0,
  prevMbHighGr: 0,
  prevCompGr: 0,
  prevGlueGr: 0,
};

function getSliderNum(id, fallback = 0) {
  const el = document.getElementById(id);
  if (!el) return fallback;
  const v = parseFloat(el.value);
  return Number.isFinite(v) ? v : fallback;
}

function isChecked(id, fallback = false) {
  const el = document.getElementById(id);
  return el ? Boolean(el.checked) : fallback;
}

function readTimeDomain(analyser, floatBuf, byteBuf) {
  if (!analyser) return;
  if (typeof analyser.getFloatTimeDomainData === 'function') {
    analyser.getFloatTimeDomainData(floatBuf);
  } else if (typeof analyser.getByteTimeDomainData === 'function') {
    analyser.getByteTimeDomainData(byteBuf);
    for (let i = 0; i < byteBuf.length; i++) {
      floatBuf[i] = (byteBuf[i] - 128) / 128.0;
    }
  }
}

function readFrequency(analyser, byteBuf) {
  if (!analyser) return;
  if (typeof analyser.getByteFrequencyData === 'function') {
    analyser.getByteFrequencyData(byteBuf);
  }
}

function isAudioPlaying(sourceElOrNode) {
  if (sourceElOrNode && sourceElOrNode.tagName === 'AUDIO') {
    return !sourceElOrNode.paused && !sourceElOrNode.ended;
  }
  if (window.LGMDM?.mixerEngine?.previewEngine?.playing) return true;
  if (window.LGMDM?.ab?.isPlaying?.()) return true;
  const wrapAudio = document.querySelector('#previewAudioWrap audio') || document.querySelector('#mxrServerPreviewAudio');
  if (wrapAudio && !wrapAudio.paused && !wrapAudio.ended) return true;
  return false;
}

function getBandDb(freqL, freqR, startFreq, endFreq, sampleRate) {
  const binSize = (sampleRate || 48000) / N_SAMPLES;
  const startBin = Math.max(0, Math.floor(startFreq / binSize));
  const endBin = Math.min(N_SAMPLES / 2 - 1, Math.ceil(endFreq / binSize));
  if (startBin > endBin) return -80;
  let sumVal = 0;
  let count = 0;
  for (let k = startBin; k <= endBin; k++) {
    const avgByte = 0.5 * ((freqL[k] || 0) + (freqR[k] || 0));
    sumVal += avgByte;
    count++;
  }
  if (count === 0) return -80;
  const avgB = sumVal / count;
  return -100 + (avgB / 255.0) * 80.0;
}

function tickLiveMeters(timestamp) {
  const s = window.LGMDM?.state || {};
  if (!_liveState.running) return;

  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    if (timestamp && _liveState.lastTs && (timestamp - _liveState.lastTs) < 100) {
      s.metersRafId = requestAnimationFrame(tickLiveMeters);
      return;
    }
  } else {
    if (timestamp && _liveState.lastTs && (timestamp - _liveState.lastTs) < 16) {
      s.metersRafId = requestAnimationFrame(tickLiveMeters);
      return;
    }
  }
  _liveState.lastTs = timestamp || 0;

  const tap = _liveState.tap || (window.LGMDM?.proFeatures?.audioTap?.ensure?.(_liveState.sourceNodeOrEl));
  if (!tap) {
    s.metersRafId = requestAnimationFrame(tickLiveMeters);
    return;
  }
  _liveState.tap = tap;

  const playing = isAudioPlaying(_liveState.sourceNodeOrEl);

  if (!playing) {
    _liveState.silentFrames++;
    if (_liveState.silentFrames > 35) {
      _liveState.running = false;
      s.metersRafId = null;
      if (window.LGMDM?.metrics?.publish) {
        window.LGMDM.metrics.publish({
          peak_db: -Infinity,
          rms_db: -Infinity,
          lufs: -Infinity,
          lufs_momentary: -Infinity,
          true_peak_db: -Infinity,
          stereo_correlation: 0,
          mono_compatibility_db: 0,
          spectrum: [-80, -80, -80, -80, -80, -80],
          meters: {
            mb: { low_gr_db: 0, mid_gr_db: 0, high_gr_db: 0 },
            comp: { gr_db: 0 },
            glue: { gr_db: 0, bypass: true },
            parallel: { gr_db: 0, bypass: true },
            ms_comp: { mid_gr_db: 0, side_gr_db: 0, bypass: true },
            pre_limiter: { rms_db: -Infinity, peak_db: -Infinity },
            post_limiter: { rms_db: -Infinity, peak_db: -Infinity, lufs: -Infinity },
          }
        }, { source: 'live-idle' });
      }
      return;
    }

    _liveState.prevPeakDb = Math.max(-60, _liveState.prevPeakDb - 1.5);
    _liveState.prevRmsDb = Math.max(-60, _liveState.prevRmsDb - 1.5);
    _liveState.prevTruePeakDb = Math.max(-60, _liveState.prevTruePeakDb - 1.5);
    _liveState.prevLufs = Math.max(-40, _liveState.prevLufs - 1.2);
    _liveState.prevCorr = _liveState.prevCorr * 0.9;
    _liveState.prevMbLowGr = Math.max(0, _liveState.prevMbLowGr - 0.5);
    _liveState.prevMbMidGr = Math.max(0, _liveState.prevMbMidGr - 0.5);
    _liveState.prevMbHighGr = Math.max(0, _liveState.prevMbHighGr - 0.5);
    _liveState.prevCompGr = Math.max(0, _liveState.prevCompGr - 0.5);
    _liveState.prevGlueGr = Math.max(0, _liveState.prevGlueGr - 0.5);
    _liveState.prevSpectrum = _liveState.prevSpectrum.map(v => Math.max(-80, v - 2.0));

    if (window.LGMDM?.metrics?.publish) {
      window.LGMDM.metrics.publish({
        peak_db: _liveState.prevPeakDb <= -59.5 ? -Infinity : _liveState.prevPeakDb,
        rms_db: _liveState.prevRmsDb <= -59.5 ? -Infinity : _liveState.prevRmsDb,
        lufs: _liveState.prevLufs <= -39.5 ? -Infinity : _liveState.prevLufs,
        lufs_momentary: _liveState.prevLufs <= -39.5 ? -Infinity : _liveState.prevLufs,
        true_peak_db: _liveState.prevTruePeakDb <= -59.5 ? -Infinity : _liveState.prevTruePeakDb,
        stereo_correlation: _liveState.prevCorr,
        mono_compatibility_db: _liveState.prevMonoDb,
        spectrum: _liveState.prevSpectrum,
        meters: {
          mb: { low_gr_db: -_liveState.prevMbLowGr, mid_gr_db: -_liveState.prevMbMidGr, high_gr_db: -_liveState.prevMbHighGr },
          comp: { gr_db: -_liveState.prevCompGr },
          glue: { gr_db: -_liveState.prevGlueGr, bypass: isChecked('s-glue-bypass') },
          parallel: { gr_db: 0, bypass: isChecked('parallelBypass') },
          ms_comp: { mid_gr_db: -_liveState.prevCompGr * 0.8, side_gr_db: -_liveState.prevCompGr * 0.4, bypass: isChecked('s-mscomp-bypass') },
          pre_limiter: { rms_db: _liveState.prevRmsDb, peak_db: _liveState.prevPeakDb },
          post_limiter: { rms_db: _liveState.prevRmsDb, peak_db: _liveState.prevPeakDb, lufs: _liveState.prevLufs },
        }
      }, { source: 'live-decay' });
    }

    s.metersRafId = requestAnimationFrame(tickLiveMeters);
    return;
  }

  // Audio is active!
  _liveState.silentFrames = 0;

  const aL = tap.analyserL || tap.analyserGonioL;
  const aR = tap.analyserR || tap.analyserGonioR;
  readTimeDomain(aL, _timeL, _byteTimeL);
  readTimeDomain(aR, _timeR, _byteTimeR);
  readFrequency(aL, _byteFreqL);
  readFrequency(aR, _byteFreqR);

  // 1) Peak & True Peak
  let maxAbs = 0;
  let maxIdx = 0;
  let maxIsLeft = true;
  let sumSq = 0;
  let sumL = 0, sumR = 0, sumLR = 0, sumMid = 0, sumSide = 0;

  for (let i = 0; i < N_SAMPLES; i++) {
    const l = _timeL[i];
    const r = _timeR[i];
    const absL = Math.abs(l);
    const absR = Math.abs(r);

    if (absL > maxAbs) { maxAbs = absL; maxIdx = i; maxIsLeft = true; }
    if (absR > maxAbs) { maxAbs = absR; maxIdx = i; maxIsLeft = false; }

    const sq = 0.5 * (l * l + r * r);
    sumSq += sq;

    sumL += l * l;
    sumR += r * r;
    sumLR += l * r;
    const m = 0.5 * (l + r);
    const sd = 0.5 * (l - r);
    sumMid += m * m;
    sumSide += sd * sd;
  }

  // Instant Peak dBFS
  const rawPeakDb = maxAbs > 1e-4 ? 20 * Math.log10(maxAbs) : -60;
  if (rawPeakDb > _liveState.prevPeakDb) {
    _liveState.prevPeakDb = rawPeakDb;
  } else {
    _liveState.prevPeakDb = Math.max(-60, _liveState.prevPeakDb - 0.4);
  }

  // Parabolic True Peak interpolation
  const arr = maxIsLeft ? _timeL : _timeR;
  let truePeakAmp = maxAbs;
  if (maxIdx > 0 && maxIdx < N_SAMPLES - 1) {
    const alpha = Math.abs(arr[maxIdx - 1]);
    const beta  = maxAbs;
    const gamma = Math.abs(arr[maxIdx + 1]);
    const denom = 2 * beta - alpha - gamma;
    if (denom > 1e-6) {
      const delta = 0.5 * (alpha - gamma) / denom;
      truePeakAmp = Math.max(maxAbs, beta - 0.25 * (alpha - gamma) * delta);
    }
  }
  const rawTpDb = truePeakAmp > 1e-4 ? 20 * Math.log10(truePeakAmp) : -60;
  if (rawTpDb > _liveState.prevTruePeakDb) {
    _liveState.prevTruePeakDb = rawTpDb;
  } else {
    _liveState.prevTruePeakDb = Math.max(-60, _liveState.prevTruePeakDb - 0.35);
  }

  // 2) RMS dBFS
  const rmsVal = Math.sqrt(sumSq / N_SAMPLES);
  const rawRmsDb = rmsVal > 1e-4 ? 20 * Math.log10(rmsVal) : -60;
  _liveState.prevRmsDb = _liveState.prevRmsDb === -60
    ? rawRmsDb
    : (_liveState.prevRmsDb * 0.8 + rawRmsDb * 0.2);

  // 3) LUFS Momentary (K-weighting RLB approximation)
  const lufsRaw = -0.691 + 10 * Math.log10(Math.max(1e-9, (sumSq / N_SAMPLES) * 1.25));
  const boundedLufs = Math.max(-40, Math.min(0, lufsRaw));
  _liveState.prevLufs = _liveState.prevLufs === -60
    ? boundedLufs
    : (_liveState.prevLufs * 0.88 + boundedLufs * 0.12);

  // 4) Stereo Correlation & Mono Compatibility
  const denomLR = Math.sqrt(sumL * sumR);
  const rawCorr = denomLR > 1e-7 ? (sumLR / denomLR) : 1.0;
  const boundedCorr = Math.max(-1.0, Math.min(1.0, rawCorr));
  _liveState.prevCorr = _liveState.prevCorr * 0.85 + boundedCorr * 0.15;

  const monoDb = 10 * Math.log10((sumMid + 1e-9) / (sumSide + 1e-9));
  _liveState.prevMonoDb = Math.max(-18, Math.min(18, monoDb));

  // 5) 6 Frequency Bands
  const sRate = tap.ctx?.sampleRate || 48000;
  const subDb     = getBandDb(_byteFreqL, _byteFreqR, 20, 60, sRate);
  const bassDb    = getBandDb(_byteFreqL, _byteFreqR, 60, 250, sRate);
  const lowmidDb  = getBandDb(_byteFreqL, _byteFreqR, 250, 800, sRate);
  const midDb     = getBandDb(_byteFreqL, _byteFreqR, 800, 3000, sRate);
  const highmidDb = getBandDb(_byteFreqL, _byteFreqR, 3000, 8000, sRate);
  const airDb     = getBandDb(_byteFreqL, _byteFreqR, 8000, 20000, sRate);

  const rawSpectrum = [subDb, bassDb, lowmidDb, midDb, highmidDb, airDb];
  _liveState.prevSpectrum = _liveState.prevSpectrum.map((prev, idx) => {
    const target = rawSpectrum[idx];
    return target > prev ? (prev * 0.4 + target * 0.6) : Math.max(-80, prev - 1.2);
  });

  // 6) Dynamic Gain Reduction (simulated from active UI thresholds vs live levels)
  const compThresh = getSliderNum('s-thresh', 0);
  const compRatio = Math.max(1, getSliderNum('s-ratio', 1));
  const compOver = _liveState.prevRmsDb - compThresh;
  const targetCompGr = (compOver > 0 && compRatio > 1) ? compOver * (1 - 1 / compRatio) : 0;
  _liveState.prevCompGr = targetCompGr > _liveState.prevCompGr
    ? (_liveState.prevCompGr * 0.3 + targetCompGr * 0.7)
    : Math.max(0, _liveState.prevCompGr * 0.85);

  const glueThresh = getSliderNum('s-glue-thresh', 0);
  const glueRatio = Math.max(1, getSliderNum('s-glue-ratio', 1));
  const glueOver = _liveState.prevRmsDb - glueThresh;
  const targetGlueGr = (glueOver > 0 && glueRatio > 1 && !isChecked('s-glue-bypass')) ? glueOver * (1 - 1 / glueRatio) : 0;
  _liveState.prevGlueGr = targetGlueGr > _liveState.prevGlueGr
    ? (_liveState.prevGlueGr * 0.3 + targetGlueGr * 0.7)
    : Math.max(0, _liveState.prevGlueGr * 0.85);

  // Multiband GR
  const mbLowTh = getSliderNum('s-mb-low-th', 0);
  const mbLowRatio = Math.max(1, getSliderNum('s-mb-low-ratio', 1));
  const mbLowLevel = Math.max(_liveState.prevSpectrum[0], _liveState.prevSpectrum[1]);
  const targetMbLowGr = (mbLowLevel > mbLowTh && mbLowRatio > 1 && !isChecked('mb-bypass')) ? (mbLowLevel - mbLowTh) * (1 - 1 / mbLowRatio) : 0;
  _liveState.prevMbLowGr = targetMbLowGr > _liveState.prevMbLowGr ? (_liveState.prevMbLowGr * 0.3 + targetMbLowGr * 0.7) : Math.max(0, _liveState.prevMbLowGr * 0.85);

  const mbMidTh = getSliderNum('s-mb-mid-th', 0);
  const mbMidRatio = Math.max(1, getSliderNum('s-mb-mid-ratio', 1));
  const mbMidLevel = Math.max(_liveState.prevSpectrum[2], _liveState.prevSpectrum[3]);
  const targetMbMidGr = (mbMidLevel > mbMidTh && mbMidRatio > 1 && !isChecked('mb-bypass')) ? (mbMidLevel - mbMidTh) * (1 - 1 / mbMidRatio) : 0;
  _liveState.prevMbMidGr = targetMbMidGr > _liveState.prevMbMidGr ? (_liveState.prevMbMidGr * 0.3 + targetMbMidGr * 0.7) : Math.max(0, _liveState.prevMbMidGr * 0.85);

  const mbHighTh = getSliderNum('s-mb-high-th', 0);
  const mbHighRatio = Math.max(1, getSliderNum('s-mb-high-ratio', 1));
  const mbHighLevel = Math.max(_liveState.prevSpectrum[4], _liveState.prevSpectrum[5]);
  const targetMbHighGr = (mbHighLevel > mbHighTh && mbHighRatio > 1 && !isChecked('mb-bypass')) ? (mbHighLevel - mbHighTh) * (1 - 1 / mbHighRatio) : 0;
  _liveState.prevMbHighGr = targetMbHighGr > _liveState.prevMbHighGr ? (_liveState.prevMbHighGr * 0.3 + targetMbHighGr * 0.7) : Math.max(0, _liveState.prevMbHighGr * 0.85);

  // Pre / Post Limiter
  const ceiling = getSliderNum('s-ceiling', 0);
  const preLim = { rms_db: _liveState.prevRmsDb, peak_db: _liveState.prevPeakDb };
  const postLim = {
    rms_db: Math.min(_liveState.prevRmsDb, ceiling - 3),
    peak_db: Math.min(_liveState.prevPeakDb, ceiling),
    lufs: Math.min(_liveState.prevLufs, ceiling - 2),
  };

  // Publish to Metrics Store
  if (window.LGMDM?.metrics?.publish) {
    window.LGMDM.metrics.publish({
      peak_db: _liveState.prevPeakDb,
      rms_db: _liveState.prevRmsDb,
      lufs: _liveState.prevLufs,
      lufs_momentary: _liveState.prevLufs,
      true_peak_db: _liveState.prevTruePeakDb,
      stereo_correlation: _liveState.prevCorr,
      mono_compatibility_db: _liveState.prevMonoDb,
      spectrum: _liveState.prevSpectrum,
      meters: {
        mb: {
          low_gr_db: -_liveState.prevMbLowGr,
          mid_gr_db: -_liveState.prevMbMidGr,
          high_gr_db: -_liveState.prevMbHighGr,
        },
        comp: { gr_db: -_liveState.prevCompGr },
        glue: { gr_db: -_liveState.prevGlueGr, bypass: isChecked('s-glue-bypass') },
        parallel: { gr_db: 0, bypass: isChecked('parallelBypass') },
        ms_comp: {
          mid_gr_db: -_liveState.prevCompGr * 0.8,
          side_gr_db: -_liveState.prevCompGr * 0.4,
          bypass: isChecked('s-mscomp-bypass'),
        },
        pre_limiter: preLim,
        post_limiter: postLim,
      }
    }, { source: 'live-webaudio' });
  }

  s.metersRafId = requestAnimationFrame(tickLiveMeters);
}

function setupLiveMeters(audioSourceOrEl) {
  const s = window.LGMDM?.state || (window.LGMDM.state = {});
  if (s.metersRafId) {
    cancelAnimationFrame(s.metersRafId);
    s.metersRafId = null;
  }

  if (window.LGMDM?.audio && typeof window.LGMDM.audio.resume === 'function') {
    window.LGMDM.audio.resume().catch(() => {});
  }

  const tap = window.LGMDM?.proFeatures?.audioTap?.ensure?.(audioSourceOrEl);
  _liveState.tap = tap || null;
  _liveState.sourceNodeOrEl = audioSourceOrEl || tap?.sourceEl || null;
  _liveState.running = true;
  _liveState.silentFrames = 0;
  _liveState.lastTs = 0;

  s.metersRafId = requestAnimationFrame(tickLiveMeters);
  return true;
}

function stopLiveMeters() {
  const s = window.LGMDM?.state || {};
  if (s.metersRafId) {
    cancelAnimationFrame(s.metersRafId);
    s.metersRafId = null;
  }
  _liveState.running = false;
}

function teardownLiveMeters() {
  stopLiveMeters();
  _liveState.sourceNodeOrEl = null;
  _liveState.tap = null;
  _liveState.prevPeakDb = -60;
  _liveState.prevRmsDb = -60;
  _liveState.prevTruePeakDb = -60;
  _liveState.prevLufs = -60;
  _liveState.prevCorr = 1.0;
  _liveState.prevMonoDb = 0;
  _liveState.prevSpectrum = [-80, -80, -80, -80, -80, -80];

  const fill = (id) => { const el = document.getElementById(id); if (el) el.style.height = '0%'; };
  const text = (id, str) => { const el = document.getElementById(id); if (el) el.textContent = str; };
  fill('meterPeakFill'); text('meterPeakReadout', '-∞ dB');
  fill('meterRmsFill'); text('meterRmsReadout', '-∞ dB');
  fill('meterLufsFill'); text('meterLufsReadout', '-∞');
  fill('meterTruePeakFill'); text('meterTruePeakReadout', '-∞ dBTP');
  text('lufsNumber', '---');
  const lufsFill = document.getElementById('lufsBarFill');
  if (lufsFill) lufsFill.style.width = '0%';

  const stereoFill = document.getElementById('stereoMeterFill');
  if (stereoFill) stereoFill.style.width = '50%';
  text('stereoMeterReadout', 'corr: --');
  text('monoCompatReadout', 'mono: -- dB');

  ['sub','bass','lowmid','mid','highmid','air'].forEach(id => {
    const bar = document.getElementById(`fb-${id}`);
    const read = document.getElementById(`fbv-${id}`);
    if (bar) bar.style.width = '0%';
    if (read) read.textContent = '-∞';
  });

  ['grBarLow', 'grBarMid', 'grBarHigh', 'grBarComp', 'grBarGlue', 'grBarParallel'].forEach(id => {
    const bar = document.getElementById(id);
    if (bar) bar.style.width = '0%';
  });
}

// ── Event bindings for live audio lifecycle ──────────────────
function onMediaPlay(e) {
  const target = e?.target;
  if (target && target.tagName === 'AUDIO') {
    setupLiveMeters(target);
  } else if (!target || target === document || target === window) {
    setupLiveMeters();
  }
}

function onMediaPause() {
  if (_liveState.running && !isAudioPlaying(_liveState.sourceNodeOrEl)) {
    _liveState.silentFrames = 0;
  }
}

document.addEventListener('play', onMediaPlay, true);
document.addEventListener('playing', onMediaPlay, true);
document.addEventListener('pause', onMediaPause, true);
document.addEventListener('ended', onMediaPause, true);

window.addEventListener('lgmdm:preview-ready', (e) => {
  const audioEl = e?.detail?.audio || document.querySelector('#previewAudioWrap audio');
  if (audioEl) {
    audioEl.addEventListener('play', () => setupLiveMeters(audioEl));
    audioEl.addEventListener('playing', () => setupLiveMeters(audioEl));
  }
});

window.addEventListener('lgmdm:playback-started', (e) => {
  setupLiveMeters(e?.detail?.sourceNode);
});

window.addEventListener('lgmdm:playback-stopped', () => {
  if (_liveState.running) {
    _liveState.silentFrames = 0;
  }
});

  LGMDM.meters = LGMDM.meters || {};
  LGMDM.meters.stopDashboard = stopDashboard;
  LGMDM.meters.setupLiveMeters = setupLiveMeters;
  LGMDM.meters.startLiveMeters = setupLiveMeters;
  LGMDM.meters.stopLiveMeters = stopLiveMeters;
  LGMDM.meters.teardownLiveMeters = teardownLiveMeters;
  LGMDM.meters.getLiveState = () => ({ ..._liveState });
})(window);
