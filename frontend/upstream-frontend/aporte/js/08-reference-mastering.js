(function (global) {
  "use strict";
  const LGMDM = global.LGMDM = global.LGMDM || {};
  LGMDM.state = LGMDM.state || {};
  const referenceState = LGMDM.state.reference || (LGMDM.state.reference = { file: null, libraryId: null });
  LGMDM.reference = LGMDM.reference || {};

// ============================================================
// 08-reference-mastering.js — Master con referencia, bandas EQ dinámicas, preview en vivo, análisis
// ============================================================

// ── Spinner reutiliza el mismo CSS que en 07 ────────────────
// (ya inyectado al inicio de 07, así que no hace falta repetir)

// ── MASTER CON REFERENCIA ────────────────────────────────────
function collectReferenceParamsObj() {
  return {
    eq_max_boost_db: LGMDM.dom.requireById("s-ref-eq", "08-reference-mastering").checked
      ? LGMDM.dom.requireById("s-ref-boost", "08-reference-mastering").value
      : "0",
    eq_max_cut_db: LGMDM.dom.requireById("s-ref-eq", "08-reference-mastering").checked ? LGMDM.dom.requireById("s-ref-cut", "08-reference-mastering").value : "0",
    eq_fit_method: LGMDM.dom.requireById("s-ref-eqmethod", "08-reference-mastering").value,
    match_loudness: LGMDM.dom.requireById("s-ref-loudness", "08-reference-mastering").checked,
    match_dynamics: LGMDM.dom.requireById("s-ref-dynamics", "08-reference-mastering").checked,
    match_stereo_width: LGMDM.dom.requireById("s-ref-stereo", "08-reference-mastering").checked,
    match_transient: LGMDM.dom.requireById("s-ref-transient", "08-reference-mastering").checked,
    match_sub_bass: LGMDM.dom.requireById("s-ref-subbass", "08-reference-mastering").checked,
    match_desser: LGMDM.dom.requireById("s-ref-desser", "08-reference-mastering").checked,
    match_saturation: LGMDM.dom.requireById("s-ref-saturation", "08-reference-mastering").checked,
    output_format: LGMDM.dom.requireById("s-format", "08-reference-mastering").value,
    output_bit_depth: LGMDM.dom.requireById("s-bitdepth", "08-reference-mastering").value,
    dither_mode: LGMDM.dom.requireById("s-dither-mode", "08-reference-mastering").value,
    dynamics_margin_db: LGMDM.dom.requireById("s-ref-dynmargin", "08-reference-mastering").value,
    stereo_blend: (parseFloat(LGMDM.dom.requireById("s-ref-stereoblend", "08-reference-mastering").value) / 100).toFixed(2),
    band_gains_array: LGMDM.reference?.bandEQ ? LGMDM.reference.bandEQ.getGainsArray() : [],
    ms_eq_matching: LGMDM.dom.byId("s-ref-ms-eq")?.checked ?? true,
    adaptive_loudness_weighting: LGMDM.dom.requireById("s-ref-adaptive-loudness", "08-reference-mastering")?.checked ?? true,
    loudness_sensitivity_amount: ((parseFloat(LGMDM.dom.requireById("s-ref-loudness-sensitivity", "08-reference-mastering")?.value || "65") / 100)).toFixed(2),
    premium_match_profile: LGMDM.dom.requireById("s-ref-premium-profile", "08-reference-mastering")?.value || "balanced",
    premium_vocal_protect: LGMDM.dom.requireById("s-ref-vocal-protect", "08-reference-mastering")?.checked ?? true,
    premium_translation_check: LGMDM.dom.requireById("s-ref-translation-check", "08-reference-mastering")?.checked ?? true,
    premium_alt_versions: LGMDM.dom.requireById("s-ref-alt-versions", "08-reference-mastering")?.checked ?? false,
    iterative_eq_passes: parseInt(LGMDM.dom.requireById("s-ref-eq-passes", "08-reference-mastering")?.value || "3", 10),
    match_crest: LGMDM.dom.requireById("s-ref-match-crest", "08-reference-mastering")?.checked ?? true,
    crest_amount: (parseFloat(LGMDM.dom.requireById("s-ref-crest-amount", "08-reference-mastering")?.value || "75") / 100).toFixed(2),
    match_spectral_dynamics: LGMDM.dom.requireById("s-ref-spectral-dynamics", "08-reference-mastering")?.checked ?? true,
    spectral_dynamics_amount: (parseFloat(LGMDM.dom.requireById("s-ref-spectral-dyn-amount", "08-reference-mastering")?.value || "60") / 100).toFixed(2),
    spectral_dynamics_bins: parseInt(LGMDM.dom.requireById("s-ref-spectral-dyn-bins", "08-reference-mastering")?.value || "4", 10),
    ...(LGMDM.dom.requireById("s-ref-fixed-lufs", "08-reference-mastering")?.checked
      ? { loudness_target_lufs: parseFloat(LGMDM.dom.requireById("s-ref-fixed-lufs-value", "08-reference-mastering")?.value || "-14") }
      : {}),
    use_parallel_compression: LGMDM.dom.requireById("s-ref-parallel-comp", "08-reference-mastering")?.checked ?? true,
    parallel_mix: (parseFloat(LGMDM.dom.requireById("s-ref-parallel-mix", "08-reference-mastering")?.value || "28") / 100).toFixed(2),
    parallel_threshold_db: parseFloat(LGMDM.dom.requireById("s-ref-parallel-thr", "08-reference-mastering")?.value || "-20"),
    parallel_ratio: parseFloat(LGMDM.dom.requireById("s-ref-parallel-ratio", "08-reference-mastering")?.value || "4"),
    parallel_makeup_db: parseFloat(LGMDM.dom.requireById("s-ref-parallel-makeup", "08-reference-mastering")?.value || "6"),
    use_multiband_saturation: LGMDM.dom.requireById("s-ref-mb-sat", "08-reference-mastering")?.checked ?? true,
    mb_sat_mix: (parseFloat(LGMDM.dom.requireById("s-ref-mb-sat-mix", "08-reference-mastering")?.value || "45") / 100).toFixed(2),
    mb_sat_low_drive: (parseFloat(LGMDM.dom.requireById("s-ref-mb-sat-low", "08-reference-mastering")?.value || "7") / 100).toFixed(3),
    mb_sat_mid_drive: (parseFloat(LGMDM.dom.requireById("s-ref-mb-sat-mid", "08-reference-mastering")?.value || "4") / 100).toFixed(3),
    mb_sat_high_drive: (parseFloat(LGMDM.dom.requireById("s-ref-mb-sat-high", "08-reference-mastering")?.value || "2") / 100).toFixed(3),
    mb_sat_mode: LGMDM.dom.requireById("s-ref-mb-sat-mode", "08-reference-mastering")?.value || "tape",
    use_two_stage_limiter: LGMDM.dom.requireById("s-ref-two-stage-lim", "08-reference-mastering")?.checked ?? true,
    gentle_ceiling_db: parseFloat(LGMDM.dom.requireById("s-ref-gentle-ceil", "08-reference-mastering")?.value || "-2.5"),
    gentle_release_ms: parseFloat(LGMDM.dom.requireById("s-ref-gentle-rel", "08-reference-mastering")?.value || "120"),
    max_target_lufs: parseFloat(LGMDM.dom.requireById("s-ref-max-lufs", "08-reference-mastering")?.value || "-12"),
  };
}
const REF_PARAM_LABELS = { /* ... igual que antes ... */ };

async function submitReferenceMasterJob() {
  LGMDM.ui.clearResults();
  LGMDM.ui.showStatus(null, "Enviando archivos…", "queued");
  LGMDM.dom.requireById("btnMasterRef", "08-reference-mastering").disabled = true;

  const fd = new FormData();
  if (window.LGMDM.state._previewLibraryId) {
    fd.append("library_id", window.LGMDM.state._previewLibraryId);
  } else {
    fd.append("file", window.LGMDM.state.selectedFile);
  }
  if (referenceState.libraryId) {
    fd.append("reference_library_id", referenceState.libraryId);
  } else {
    fd.append("reference_file", referenceState.file);
  }

  const _refParamsObj = collectReferenceParamsObj();
  if (_refParamsObj.band_gains_array) {
    _refParamsObj.band_gains_array = JSON.stringify(_refParamsObj.band_gains_array);
  }
  const params = new URLSearchParams(_refParamsObj);

  try {
    const url = `${LGMDM.api.apiBase()}/master/reference?${params.toString()}`;
    const res = await LGMDM.api.apiFetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (!window.LGMDM.state.jobs) window.LGMDM.state.jobs = { mastering: {}, reference: {} };
    window.LGMDM.state.jobs.reference.jobId = data.job_id;
    window.LGMDM.state.currentJobId = data.job_id;
    LGMDM.ui.showStatus(null, `Job ${data.job_id.slice(0, 8)}… en cola (matching por referencia)`, "queued");
    startReferencePolling(data.job_id);
  } catch (e) {
    console.debug("❌ Error al enviar (referencia):", e);
    LGMDM.ui.showStatus(null, "Error: " + e.message, "error");
    LGMDM.dom.requireById("btnMasterRef", "08-reference-mastering").disabled = false;
  }
}

// ── refBandEQ (sin cambios) ──────────────────────────────────
LGMDM.reference.bandEQ = (function() {
  const CONTAINER   = LGMDM.dom.requireById("ref-band-controls", "08-reference-mastering");
  const COUNT_SLIDER = LGMDM.dom.requireById("s-band-count", "08-reference-mastering");
  const COUNT_VAL    = LGMDM.dom.requireById("v-band-count", "08-reference-mastering");
  const RESET_BTN    = LGMDM.dom.requireById("btn-band-reset", "08-reference-mastering");
  if (!CONTAINER || !COUNT_SLIDER || !COUNT_VAL || !RESET_BTN) {
    return { getGainsArray: () => [], getBandCount: () => 0 };
  }
  const MIN_HZ = 20, MAX_HZ = 20000;
  let _bands = [];

  function _logFreqs(n) {
    return Array.from({length: n}, (_, i) =>
      MIN_HZ * Math.pow(MAX_HZ / MIN_HZ, i / (n - 1))
    );
  }

  function _interpolate(oldBands, newFreqs) {
    if (!oldBands.length) return newFreqs.map(() => 0);
    return newFreqs.map(f => {
      const logF = Math.log10(f);
      const logFs = oldBands.map(b => Math.log10(b.freq_hz));
      if (logF <= logFs[0])  return oldBands[0].gain_db;
      if (logF >= logFs[logFs.length-1]) return oldBands[logFs.length-1].gain_db;
      for (let i = 0; i < logFs.length - 1; i++) {
        if (logF >= logFs[i] && logF <= logFs[i+1]) {
          const t = (logF - logFs[i]) / (logFs[i+1] - logFs[i]);
          return oldBands[i].gain_db * (1-t) + oldBands[i+1].gain_db * t;
        }
      }
      return 0;
    });
  }

  function _fmtHz(hz) {
    if (hz >= 1000) return (hz/1000).toFixed(hz >= 10000 ? 0 : 1) + " kHz";
    return Math.round(hz) + " Hz";
  }

  function _render(n, interpolatedGains) {
    const freqs = _logFreqs(n);
    CONTAINER.innerHTML = "";
    _bands = [];

    freqs.forEach((freq, i) => {
      const gain = interpolatedGains ? Math.round(interpolatedGains[i] * 2) / 2 : 0;
      _bands.push({ freq_hz: freq, gain_db: gain });

      const div = document.createElement("div");
      div.className = "param";
      div.style.marginBottom = n > 14 ? "0.05rem" : "0.1rem";

      const valId  = "dyn-band-val-"  + i;
      const slId   = "dyn-band-sl-"   + i;
      const gainStr = (gain >= 0 ? "+" : "") + gain.toFixed(1) + " dB";

      div.innerHTML = `
        <label style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">
          ${_fmtHz(freq)}
        </label>
        <span class="val" id="${valId}" style="font-size:${n > 14 ? '0.62rem' : '0.68rem'}">${gainStr}</span>
        <input type="range" id="${slId}" min="-12" max="12" step="0.5" value="${gain}"
          style="${n > 14 ? 'height:3px;' : ''}" />
      `;
      CONTAINER.appendChild(div);

      const sl  = div.querySelector("input");
      const val = div.querySelector("span.val");
      sl.addEventListener("input", () => {
        const v = parseFloat(sl.value);
        _bands[i].gain_db = v;
        val.textContent = (v >= 0 ? "+" : "") + v.toFixed(1) + " dB";
        CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
      });
    });
  }

  function setBandCount(n, skipInterp) {
    const newFreqs = _logFreqs(n);
    const gains = skipInterp ? null : _interpolate(_bands, newFreqs);
    _render(n, gains);
    COUNT_VAL.textContent = n;
  }

  setBandCount(7, true);

  COUNT_SLIDER.addEventListener("input", () => {
    const n = parseInt(COUNT_SLIDER.value, 10);
    setBandCount(n, false);
    CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
  });

  RESET_BTN.addEventListener("click", () => {
    const n = parseInt(COUNT_SLIDER.value, 10);
    setBandCount(n, true);
    CONTAINER.dispatchEvent(new CustomEvent("bandchange", { bubbles: true }));
  });

  return {
    getGainsArray() {
      return _bands.map(b => ({ freq_hz: Math.round(b.freq_hz * 10) / 10, gain_db: b.gain_db }));
    },
    getBandCount() {
      return _bands.length;
    }
  };
})();

// ── Preview en tiempo real con referencia (con spinners en estado) ──
(function() {
  let refWs = null;
  const referenceAudioState = LGMDM.state.audio.reference || (LGMDM.state.audio.reference = { active: false, playTime: 0 });
  let refSessionId = null;
  let refRefSessionId = null;
  let refSrcUploaded = false;
  let refRefUploaded = false;
  let debounceTimer = null;

  function updateRefPreviewBtn() {
    const ok = !!(window.LGMDM.state.selectedFile && referenceState.file);
    const btn = LGMDM.dom.requireById("btnRefPreview", "08-reference-mastering");
    if (btn) btn.disabled = !ok;
  }
  // Expuesta aca mismo: esta funcion vive dentro de este IIFE interno
  // (linea 218-472), no en el scope del archivo. La linea al final del
  // archivo que intentaba exponerla (`LGMDM.reference.updateRefPreviewBtn
  // = updateRefPreviewBtn`) apuntaba a un nombre que no existe ahi afuera
  // y tiraba ReferenceError apenas cargaba el script.
  window.LGMDM.reference.updateRefPreviewBtn = updateRefPreviewBtn;

  const referenceApi = window.LGMDM.reference = window.LGMDM.reference || {};
  const _baseUpdateRefButtonState = referenceApi.updateButtonState;
  referenceApi.updateButtonState = function() {
    _baseUpdateRefButtonState?.();
    updateRefPreviewBtn();
  };

  function drawEqCurve(curve) {
    const wrap = LGMDM.dom.requireById("refEqCurveWrap", "08-reference-mastering");
    const canvas = LGMDM.dom.requireById("refEqCurveCanvas", "08-reference-mastering");
    if (!wrap || !canvas || !curve || !curve.length) return;
    wrap.style.display = "block";
    const ctx = canvas.getContext("2d");
    const W = canvas.width, H = canvas.height;
    ctx.clearRect(0, 0, W, H);
    const ZERO_Y = H / 2;
    ctx.strokeStyle = "rgba(255,255,255,0.1)";
    ctx.beginPath(); ctx.moveTo(0, ZERO_Y); ctx.lineTo(W, ZERO_Y); ctx.stroke();
    const gains = curve.map(p => p.gain_db);
    const MAX_G = Math.max(6, ...gains.map(Math.abs));
    ctx.beginPath();
    ctx.strokeStyle = "var(--ui-accent-2, #06b6d4)";
    ctx.lineWidth = 1.5;
    curve.forEach((p, i) => {
      const x = (i / (curve.length - 1)) * W;
      const y = ZERO_Y - (p.gain_db / MAX_G) * (H * 0.42);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  function updateMetrics(m) {
    const set = (id, v) => { const el = document.getElementById(id); if(el) el.textContent = v; };
    set("rp-lufs", m.lufs_momentary != null ? m.lufs_momentary.toFixed(1) + " LUFS" : "--");
    set("rp-peak", m.peak_db != null ? m.peak_db.toFixed(1) + " dBFS" : "--");
    set("rp-rms",  m.rms_db  != null ? m.rms_db.toFixed(1) + " dB" : "--");
    set("rp-corr", m.stereo_correlation != null ? m.stereo_correlation.toFixed(2) : "--");
  }

  function initAudioCtx() {
    return LGMDM.audio.getContext();
  }

  let _refPreviewActive = false;
  const _INITIAL_BUFFER_SEC = 0.30;
  const _MIN_AHEAD_SEC = 0.15;

  function scheduleChunk(pcmBytes, sr, channels) {
    if (!_refPreviewActive) return;
    const actx = initAudioCtx();
    const i16 = new Int16Array(pcmBytes);
    const samples = i16.length / channels;
    const buf = actx.createBuffer(channels, samples, sr);
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
    if (referenceAudioState.playTime < now + _MIN_AHEAD_SEC) referenceAudioState.playTime = now + _INITIAL_BUFFER_SEC;
    src.start(referenceAudioState.playTime);
    src.onended = () => src.disconnect();
    referenceAudioState.playTime += buf.duration;
  }

  function stopRefPreview() {
    _refPreviewActive = false;
    if (refWs) {
      try { refWs.close(); } catch(e) {}
      refWs = null;
    }
    referenceAudioState.playTime = 0;
    const status = LGMDM.dom.requireById("rp-status", "08-reference-mastering");
    if (status) status.textContent = "";
  }

  async function launchRefPreview() {
    stopRefPreview();
    const panel = LGMDM.dom.requireById("refPreviewPanel", "08-reference-mastering");
    if (panel) panel.style.display = "block";
    if (!window.LGMDM.state.selectedFile || !referenceState.file) return;
    if (!refSessionId) refSessionId = genUUID();
    if (!refRefSessionId) refRefSessionId = genUUID();

    const status = LGMDM.dom.requireById("rp-status", "08-reference-mastering");
    if (status) status.textContent = "Conectando…";

    const params = collectReferenceParamsObj();
    const band_gains_array = LGMDM.reference?.bandEQ ? LGMDM.reference.bandEQ.getGainsArray() : [];

    const wsUrl = await LGMDM.api.wsAuthUrl("/ws/ref-stream");
    refWs = new WebSocket(wsUrl);
    refWs.binaryType = "arraybuffer";

    let wsChannels = 2, wsSr = 44100;
    let pendingMetrics = null;

    refWs.onopen = () => {
      _refReconnectAttempts = 0;
      refWs.send(JSON.stringify({
        session_id:       refSessionId,
        ref_session_id:   refRefSessionId,
        chunk_seconds:    1.0,
        eq_bands:         parseInt(params.eq_bands || 28, 10),
        eq_max_boost_db:  parseFloat(params.eq_max_boost_db || 6),
        eq_max_cut_db:    parseFloat(params.eq_max_cut_db || -9),
        eq_q:             parseFloat(params.eq_q || 1.3),
        eq_match_blend:   parseFloat(params.eq_match_blend || 0.75),
        eq_fit_method:    params.eq_fit_method || "heuristic",
        ms_eq_matching:   params.ms_eq_matching !== false,
        iterative_eq_passes: parseInt(params.iterative_eq_passes || 3, 10),
        band_gains_array,
        ...(window.LGMDM.state.reference.libraryId ? { ref_library_id: window.LGMDM.state.reference.libraryId } : {}),
      }));
    };

    refWs.onmessage = async (evt) => {
      if (evt.data instanceof ArrayBuffer) {
        scheduleChunk(evt.data, wsSr, wsChannels);
        if (pendingMetrics) { updateMetrics(pendingMetrics); pendingMetrics = null; }
        return;
      }
      let msg;
      try {
        msg = JSON.parse(evt.data);
      } catch (error) {
        console.warn("[reference] frame JSON inválido", error);
        return;
      }
      if (!refWs || refWs.readyState !== WebSocket.OPEN) return;

      if (msg.event === "need_upload") {
        _refPreviewActive = true;
        if (status) status.textContent = "Subiendo track…";
        const buf = await window.LGMDM.state.selectedFile.arrayBuffer();
        if (!refWs || refWs.readyState !== WebSocket.OPEN) return;
        refWs.send(buf);
        refWs.send(JSON.stringify({ event: "upload_complete" }));

      } else if (msg.event === "use_cache") {
        _refPreviewActive = true;
        refWs.send(JSON.stringify({ event: "params_only" }));

      } else if (msg.event === "need_upload_ref") {
        _refPreviewActive = true;
        if (status) status.textContent = "Subiendo referencia…";
        if (!referenceState.file || typeof referenceState.file.arrayBuffer !== "function") {
          if (status) status.textContent = "Error: referencia de biblioteca no disponible para preview.";
          refWs.close();
          return;
        }
        const buf = await referenceState.file.arrayBuffer();
        if (!refWs || refWs.readyState !== WebSocket.OPEN) return;
        refWs.send(buf);
        refWs.send(JSON.stringify({ event: "upload_complete" }));

      } else if (msg.event === "use_cache_ref") {
        _refPreviewActive = true;
        refWs.send(JSON.stringify({ event: "params_only" }));

      } else if (msg.event === "analyzing") {
        if (status) status.textContent = msg.message || "Analizando…";

      } else if (msg.event === "matching_ready") {
        if (status) status.textContent = "▶ Reproduciendo preview…";
        drawEqCurve(msg.eq_curve);

      } else if (msg.event === "chunk") {
        wsChannels = msg.channels || 2;
        wsSr       = msg.sample_rate || 44100;
        pendingMetrics = msg.metrics;

      } else if (msg.event === "done") {
        if (status) status.textContent = "✓ Preview completado";

      } else if (msg.event === "error") {
        if (status) status.textContent = "Error: " + msg.message;
      }
    };

    refWs.onerror = () => {
      if (status) status.textContent = "Error de conexión WebSocket.";
    };
    let _refReconnectAttempts = 0;
    refWs.onclose = () => {
      const socket = refWs;
      if (refWs === socket) refWs = null;
      if (status && status.textContent === "▶ Reproduciendo preview…") {
        status.textContent = "";
      }
      if (_refReconnectAttempts < 3) {
        _refReconnectAttempts++;
        setTimeout(() => launchRefPreview(), 1000 * _refReconnectAttempts);
      }
    };
  }

  function debouncedPreview() {
    if (!refWs) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => launchRefPreview(), 120);
  }

  LGMDM.dom.requireById("ref-band-controls", "08-reference-mastering")?.addEventListener("bandchange", debouncedPreview);

  LGMDM.dom.requireById("btnRefPreview", "08-reference-mastering")?.addEventListener("click", () => {
    if (!refSrcUploaded)  refSessionId    = genUUID();
    if (!refRefUploaded)  refRefSessionId = genUUID();
    refSrcUploaded = refRefUploaded = true;
    launchRefPreview();
  });

  LGMDM.dom.requireById("btnRefPreviewStop", "08-reference-mastering")?.addEventListener("click", () => {
    stopRefPreview();
    const panel = LGMDM.dom.requireById("refPreviewPanel", "08-reference-mastering");
    if (panel) panel.style.display = "none";
  });

  LGMDM.reference.onFileSelected = () => {
    refSessionId = null;
    refSrcUploaded = false;
    updateRefPreviewBtn();
  };
  LGMDM.reference.onRefFileSelected = () => {
    refRefSessionId = null;
    refRefUploaded = false;
    updateRefPreviewBtn();
  };
})();

// ── Botón master con referencia ──────────────────────────────
LGMDM.dom.requireById("btnMasterRef", "08-reference-mastering")?.addEventListener("click", () => {
  if (!window.LGMDM.state.selectedFile || !referenceState.file) {
    LGMDM.ui.showStatus(null, "Seleccioná tu track y un track de referencia", "error");
    return;
  }
  LGMDM.ui.clearResults();
  const paramsObj = collectReferenceParamsObj();
  const panel = document.createElement("div");
  panel.className = "params-preview";
  let html = `<h3>🔎 Parámetros corregidos — matching por referencia</h3><div class="pp-group"><div class="pp-grid">`;
  Object.entries(paramsObj).forEach(([k, v]) => {
    html += `<div class="pp-item"><span>${REF_PARAM_LABELS[k] || k}</span><span>${formatParamValue(v, k)}</span></div>`;
  });
  html += `</div></div><div class="pp-actions">
  <button class="btn btn-secondary" id="ppRefCancelBtn">✕ Cancelar</button>
  <button class="btn btn-primary" id="ppRefConfirmBtn">✅ Confirmar y masterizar</button>
</div>`;
  panel.innerHTML = html;
  LGMDM.ui.getContent().prepend(panel);
  panel.querySelector("#ppRefConfirmBtn").addEventListener("click", () => {
    panel.remove();
    submitReferenceMasterJob();
  });
  panel.querySelector("#ppRefCancelBtn").addEventListener("click", () => panel.remove());
});

function startReferencePolling(jobId) {
  if (window.LGMDM.state.referencePollInterval) clearInterval(window.LGMDM.state.referencePollInterval);
  let _refPollFailures = 0;
  window.LGMDM.state.referencePollInterval = setInterval(async () => {
    try {
      const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/job/${jobId}`);
      _refPollFailures = 0;
      const data = await res.json();
      if (data.status === "queued") {
        LGMDM.ui.showStatus(null, "En cola…", "queued", data.progress, data.stage);
      } else if (data.status === "processing") {
        LGMDM.ui.showStatus(null, "Masterizando por referencia…", "processing", data.progress, data.stage);
      } else if (data.status === "done") {
        clearInterval(window.LGMDM.state.referencePollInterval);
        LGMDM.ui.showStatus(null, "Masterizado por referencia ✓", "done");
        LGMDM.dom.requireById("btnMasterRef", "08-reference-mastering").disabled = false;
        const refUrl = `${LGMDM.api.apiBase()}/download/${jobId}`;
        if (!window.LGMDM.state.jobs) window.LGMDM.state.jobs = { mastering: {}, reference: {} };
        window.LGMDM.state.jobs.reference.downloadUrl = refUrl;
        window.LGMDM.state.downloadUrl = refUrl;
        const btn = LGMDM.dom.requireById("btnDownload", "08-reference-mastering");
        btn.style.display = "block";
        const nameInput = LGMDM.dom.requireById("trackNameInput", "08-reference-mastering");
        nameInput.style.display = "block";
        prefillTrackNameFromFile();
        window.LGMDM.state.downloadFilename = "reference-master.wav";
        window.LGMDM.state.activeJobType = "reference";
        if (btn) LGMDM.ui.bindOnce(btn, "click", async () => {
          try {
            btn.disabled = true;
            const dlUrl = window.LGMDM.state.downloadUrl;
            const filename = window.LGMDM.state.downloadFilename || (window.LGMDM.state.activeJobType === "reference" ? "reference-master.wav" : "mastered.wav");
            await LGMDM.api.downloadAuthenticated(dlUrl + currentTrackNameParam(), { filename });
          } catch (e) {
            LGMDM.errors?.handleClientError?.(e, "No se pudo descargar el master de referencia.", { context: "reference-download" })
              || window.LGMDM.ui?.showToast?.(e.message || "No se pudo descargar el master de referencia.", "error");
          } finally { btn.disabled = false; }
        }, "app-master-download");

        let _refAbBtn = document.getElementById("btnRefAB");
        if (!_refAbBtn) {
          _refAbBtn = document.createElement("button");
          _refAbBtn.id = "btnRefAB";
          _refAbBtn.className = "btn";
          _refAbBtn.style.cssText = "display:block;margin-top:0.4rem;background:var(--ui-surface-2,#1a1a2e);border:1px solid var(--ui-accent-2);color:var(--ui-accent-2);font-size:0.75rem";
          _refAbBtn.textContent = "⇄ A/B Original vs Master";
          btn.parentElement?.insertBefore(_refAbBtn, btn.nextSibling);
        }
        _refAbBtn.style.display = "block";
        if (!_refAbBtn.dataset.refAbWired) {
          _refAbBtn.dataset.refAbWired = "true";
          _refAbBtn.addEventListener("click", async () => {
          _refAbBtn.disabled = true;
          _refAbBtn.textContent = "Cargando master…";
          try {
            const resp = await LGMDM.api.apiFetch(window.LGMDM.state.downloadUrl);
            if (!resp.ok) throw new Error("Error descargando master");
            const masterBlob = await resp.blob();
            if (typeof setupABPlayer === "function") {
              setupABPlayer(masterBlob);
              const wrap = LGMDM.dom.requireById("previewAudioWrap", "08-reference-mastering");
              if (wrap) {
                wrap.scrollIntoView({ behavior: "smooth", block: "center" });
              }
              _refAbBtn.textContent = "⇄ A/B activo (ver preview arriba)";
            } else {
              throw new Error("No se pudo preparar el A/B autenticado.");
            }
          } catch (e) {
            _refAbBtn.textContent = "⚠ Reintentar A/B";
            _refAbBtn.disabled = false;
            console.debug("A/B error:", e);
            LGMDM.ui.showToast?.(e.message || "Error al cargar master", "error");
          }
        });
        }

        const rBtn = LGMDM.dom.requireById("btnReport", "08-reference-mastering");
        rBtn.style.display = "block";
        rBtn.addEventListener("click", () => downloadReport(jobId));
        if (data.analysis_before?.lufs != null)
          showLoudnessMeter(data.analysis_after?.lufs ?? data.analysis_before.lufs);
        if (data.reference_match) renderReferenceMatch(data.reference_match, data.analysis_reference, data.analysis_after);
        renderAnalysisComparison(data.analysis_before, data.analysis_after);
        if (data.analysis_reference?.fft_spectrum && data.analysis_after?.fft_spectrum) {
          renderFFT([
            { label: "Referencia", data: data.analysis_reference.fft_spectrum, color: "var(--ui-accent-2)" },
            { label: "Resultado", data: data.analysis_after.fft_spectrum, color: "var(--ui-warn)" },
          ]);
        }
        if (data.mix_advice_after) renderAdvicePanel(data.mix_advice_after, "Evaluación", "— Resultado");
        if (data.analysis_after) window.LGMDM.ai.setContext({ ...data.analysis_after, mix_advice: data.mix_advice_after });
      } else if (data.status === "error") {
        clearInterval(window.LGMDM.state.referencePollInterval);
        LGMDM.ui.showStatus(null, "Error: " + data.error, "error");
        LGMDM.dom.requireById("btnMasterRef", "08-reference-mastering").disabled = false;
      }
    } catch (e) {
      console.debug("Poll error (referencia):", e);
      _refPollFailures++;
      if (_refPollFailures >= 5) {
        clearInterval(window.LGMDM.state.referencePollInterval);
        window.LGMDM.state.referencePollInterval = null;
        console.debug("Polling de referencia abortado tras 5 fallos");
      }
    }
  }, 1500);
}

// ── Funciones auxiliares (match bar, análisis, etc.) ────────
function _matchBarRow(label, ownVal, refVal, unit, closeThresholdAbs, fmt) {
  fmt = fmt || ((v) => v);
  if (ownVal == null || refVal == null) return "";
  const diff = Math.abs(ownVal - refVal);
  const ok = diff <= closeThresholdAbs;
  const lo = Math.min(ownVal, refVal, 0) - Math.abs(refVal || 1) * 0.15;
  const hi = Math.max(ownVal, refVal, 0) + Math.abs(refVal || 1) * 0.15;
  const range = hi - lo || 1;
  const ownPct = Math.max(0, Math.min(100, ((ownVal - lo) / range) * 100));
  const refPct = Math.max(0, Math.min(100, ((refVal - lo) / range) * 100));
  return `
  <div class="match-bar-row">
    <div class="match-bar-label">${ok ? "✓" : "⚠"} ${label}</div>
    <div class="match-bar-track">
      <div class="match-bar-marker match-bar-ref" style="left:${refPct}%" title="Referencia: ${fmt(refVal)}${unit}"></div>
      <div class="match-bar-fill" style="width:${ownPct}%"></div>
    </div>
    <div class="match-bar-values">${fmt(ownVal)}${unit} <span class="lgjs-s-7bdef099">vs ref ${fmt(refVal)}${unit}</span></div>
  </div>`;
}

function renderReferenceAnalysisPanel(refAnalysis, ownAnalysis, rm) {
  if (!refAnalysis) return '';
  const spec = refAnalysis.spectrum || {};
  const ownSpec = (ownAnalysis || {}).spectrum || {};
  const SPEC_BANDS = [
    { key: 'sub_bass',    label: 'Sub-graves',  range: '20–80 Hz' },
    { key: 'bass',        label: 'Graves',       range: '80–250 Hz' },
    { key: 'low_mid',     label: 'Low-Mid',      range: '250–800 Hz' },
    { key: 'mid',         label: 'Medios',       range: '800–2.5k' },
    { key: 'high_mid',    label: 'High-Mid',     range: '2.5–6 kHz' },
    { key: 'presence',    label: 'Presencia',    range: '6–12 kHz' },
    { key: 'air',         label: 'Aire',         range: '12–20 kHz' },
  ];
  const refVals = SPEC_BANDS.map(b => spec[b.key] ?? -60);
  const maxRef = Math.max(...refVals, -60);
  const minRef = Math.min(...refVals, -80);
  const range = maxRef - minRef || 1;

  const specBarsHtml = SPEC_BANDS.map((b, i) => {
    const rv = spec[b.key] ?? null;
    const sv = ownSpec[b.key] ?? null;
    if (rv === null) return '';
    const refPct = Math.max(4, ((rv - minRef) / range) * 100);
    const srcPct = sv !== null ? Math.max(4, ((sv - minRef) / range) * 100) : null;
    const diff = sv !== null ? (rv - sv) : null;
    const diffStr = diff !== null ? (diff >= 0 ? `+${diff.toFixed(1)}` : diff.toFixed(1)) + ' dB' : '';
    const diffColor = diff === null ? '' : Math.abs(diff) < 2 ? 'var(--ui-good,#3c6)' : Math.abs(diff) < 5 ? 'var(--ui-warn,#fa0)' : 'var(--ui-danger,#e05)';
    return `<div class="lgjs-s-5e07f2f4">
      <div class="lgjs-s-9b04fdf1">
        <span><b>${b.label}</b> <span class="lgjs-s-57f9e31d">${b.range}</span></span>
        <span style="color:${diffColor};font-family:var(--mono)">${diffStr}</span>
      </div>
      <div class="lgjs-s-13feb0ac">
        ${srcPct !== null ? `<div style="position:absolute;left:0;top:0;height:100%;width:${srcPct.toFixed(1)}%;background:var(--ui-accent,#7c3aed);opacity:.45;border-radius:4px"></div>` : ''}
        <div style="position:absolute;left:0;top:0;height:100%;width:${refPct.toFixed(1)}%;background:var(--ui-accent-2,#06b6d4);opacity:.75;border-radius:4px"></div>
      </div>
    </div>`;
  }).join('');

  const dynMetrics = [
    { label: 'RMS',          ownVal: ownAnalysis?.rms_db,             refVal: refAnalysis.rms_db,             unit: ' dB', fmt: v=>v.toFixed(1) },
    { label: 'Pico',         ownVal: ownAnalysis?.peak_db,            refVal: refAnalysis.peak_db,            unit: ' dBFS', fmt: v=>v.toFixed(1) },
    { label: 'Crest Factor', ownVal: ownAnalysis?.crest_factor_db,    refVal: refAnalysis.crest_factor_db,    unit: ' dB', fmt: v=>v.toFixed(1) },
    { label: 'LRA',          ownVal: ownAnalysis?.lra,                refVal: refAnalysis.lra,                unit: ' LU', fmt: v=>v?.toFixed(1) ?? '--' },
    { label: 'LUFS',         ownVal: ownAnalysis?.lufs,               refVal: refAnalysis.lufs,               unit: ' LUFS', fmt: v=>v.toFixed(1) },
  ];
  const dynRows = dynMetrics.map(m => {
    if (m.refVal == null) return '';
    const diff = m.ownVal != null ? (m.refVal - m.ownVal) : null;
    const dc = diff === null ? '' : Math.abs(diff) < 1 ? 'var(--ui-good,#3c6)' : Math.abs(diff) < 3 ? 'var(--ui-warn,#fa0)' : 'var(--ui-danger,#e05)';
    return `<div class="lgjs-s-8f2ca087">
      <span class="lgjs-s-57f9e31d">${m.label}</span>
      <span><span class="lgjs-s-8b7bf11b">${m.ownVal != null ? m.fmt(m.ownVal) + m.unit : '--'}</span>
      <span class="lgjs-s-2a8d43fd">→</span>
      <span class="lgjs-s-b04dd70a">${m.fmt(m.refVal)}${m.unit}</span>
      ${diff !== null ? `<span style="color:${dc};margin-left:.35rem;font-family:var(--mono)">(${diff >= 0 ? '+' : ''}${diff.toFixed(1)})</span>` : ''}
      </span>
    </div>`;
  }).join('');

  const ownCorr = ownAnalysis?.stereo_correlation ?? null;
  const refCorr = refAnalysis.stereo_correlation ?? null;
  const stereoRow = (ownCorr !== null && refCorr !== null)
    ? `<div class="lgjs-s-f6b7e75c">
        <span class="lgjs-s-57f9e31d">Correlación estéreo</span>
        <span><span class="lgjs-s-8b7bf11b">${ownCorr.toFixed(2)}</span>
        <span class="lgjs-s-2a8d43fd">→</span>
        <span class="lgjs-s-b04dd70a">${refCorr.toFixed(2)}</span></span>
       </div>` : '';

  const bg = rm?.band_gains_applied || {};
  const BAND_LABELS = { sub:'Sub', bass:'Graves', low_mid:'Low-Mid', mid:'Medios', high_mid:'High-Mid', presence:'Presencia', air:'Aire' };
  const bgApplied = Object.entries(bg).filter(([k,v]) => Math.abs(v) >= 0.1);
  const bgHtml = bgApplied.length ? `<div class="lgjs-s-432d224b">Ajustes manuales aplicados: ${
    bgApplied.map(([k,v]) => `<span style="color:${v>0?'var(--ui-good,#3c6)':'var(--ui-danger,#e05)'}"><b>${BAND_LABELS[k]||k}</b> ${v>0?'+':''}${v.toFixed(1)} dB</span>`).join(' · ')
  }</div>` : '';

  const msEqHtml = (rm && rm.eq_curve_mid_db && rm.eq_curve_mid_db.length) ? (() => {
    setTimeout(() => {
      const cv = document.getElementById('refMsEqCanvas');
      if (!cv) return;
      const ctx = cv.getContext('2d');
      const W = cv.width, H = cv.height, ZERO = H / 2;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath(); ctx.moveTo(0, ZERO); ctx.lineTo(W, ZERO); ctx.stroke();
      [[rm.eq_curve_mid_db, 'var(--ui-accent-2,#06b6d4)'],
       [rm.eq_curve_side_db, 'var(--ui-accent,#7c3aed)']].forEach(([curve, color]) => {
        if (!curve || !curve.length) return;
        const gains = curve.map(p => p.gain_db);
        const maxG = Math.max(6, ...gains.map(Math.abs));
        ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.5;
        curve.forEach((p, i) => {
          const x = (i / (curve.length - 1)) * W;
          const y = ZERO - (p.gain_db / maxG) * (H * 0.42);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        });
        ctx.stroke();
      });
    }, 80);
    return `<div class="lgjs-s-b310ca1d">
      <div class="lgjs-s-1a89f6c8">Curvas EQ M/S</div>
      <div class="lgjs-s-79d07016">
        <span><span class="lgjs-s-db235cd1"></span>Mid</span>
        <span><span class="lgjs-s-4ffbdd01"></span>Side</span>
      </div>
      <canvas id="refMsEqCanvas" width="320" height="55" class="lgjs-s-92a1031c"></canvas>
    </div>`;
  })() : '';

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
    </div>
  </details>`;
}

function renderReferenceMatch(rm, refAnalysis, ownAnalysis) {
  const panel = document.createElement("div");
  panel.className = "ref-match-panel";
  const pct = rm.after?.match_percent ?? 0;
  const report = rm.intelligent_report || {};
  const dynBands = rm.dynamics_by_band || {};
  const stereoBands = rm.stereo_width_by_band || {};
  const lra = rm.lra || {};

  const stages = [
    { label: "Antes", v: rm.before?.match_percent },
    { label: "Tras EQ", v: rm.after_eq?.match_percent },
    { label: "Final", v: pct },
  ];
  const stageBars = stages
    .map(
      (s) => `
  <div class="match-stage-col">
    <div class="match-stage-bar-track"><div class="match-stage-bar-fill" style="height:${Math.max(2, s.v ?? 0)}%"></div></div>
    <div class="match-stage-pct">${s.v ?? "--"}%</div>
    <div class="match-stage-label">${s.label}</div>
  </div>`
    )
    .join("");

  const dynRows = ["low", "mid", "high"]
    .map((name) => {
      const b = dynBands[name];
      if (!b) return "";
      const label = name === "low" ? "Graves" : name === "mid" ? "Medios" : "Agudos";
      if (b.own_crest_db == null) {
        const text = b.applied
          ? `comprimida (gap ${b.gap_db} dB, ratio ${b.ratio}:1)`
          : `sin cambios (gap ${b.gap_db} dB)`;
        return `<div class="ref-match-step">${label}: <b>${text}</b></div>`;
      }
      return _matchBarRow(
        `${label} (crest factor)`, b.own_crest_db, b.ref_crest_db, " dB", 1.5,
        (v) => v.toFixed(1)
      );
    })
    .join("");

  const stereoRows = ["low", "mid", "high"]
    .map((name) => {
      const k = stereoBands[name];
      if (k === undefined) return "";
      const label = name === "low" ? "Graves" : name === "mid" ? "Medios" : "Agudos";
      const pctBar = Math.max(0, Math.min(100, ((k - 0.5) / 1.0) * 100));
      const ok = Math.abs(k - 1.0) < 0.35;
      return `
  <div class="match-bar-row">
    <div class="match-bar-label">${ok ? "✓" : "↔"} ${label}</div>
    <div class="match-bar-track">
      <div class="lgjs-s-635b13e7" title="Sin cambio de ancho"></div>
      <div class="match-bar-fill" style="width:${pctBar}%"></div>
    </div>
    <div class="match-bar-values">factor ${k.toFixed(2)}x</div>
  </div>`;
    })
    .join("");

  const lraText = lra.applied
    ? `LRA ${lra.own_lra} → acercado a ${lra.ref_lra} LU (ratio ${lra.ratio}:1)`
    : `LRA propio: ${lra.own_lra ?? "--"} LU · referencia: ${lra.ref_lra ?? "--"} LU`;

  const loudnessBar = _matchBarRow(
    "Loudness (LUFS)", ownAnalysis?.lufs, refAnalysis?.lufs, " LUFS", 0.5, (v) => v.toFixed(1)
  );
  const loudnessMatch = rm.loudness_match || {};
  const adaptiveLoudnessHtml = loudnessMatch.adaptive
    ? `<div class="lgjs-s-3717df59">👂 LUFS perceptual: propio <b>${loudnessMatch.source?.perceived_lufs ?? "--"}</b> · ref <b>${loudnessMatch.reference?.perceived_lufs ?? "--"}</b> · corrección 3–6 kHz <b>${loudnessMatch.source?.presence_correction_db ?? "--"} / ${loudnessMatch.reference?.presence_correction_db ?? "--"} dB</b></div>`
    : "";

  const tipsHtml = (report.tips || []).map((t) => `<li>${LGMDM.ui.escapeHtml(t)}</li>`).join("");
  const issuesHtml = (report.issues || []).map((t) => `<li class="lgjs-s-6898f371">${LGMDM.ui.escapeHtml(t)}</li>`).join("");

  panel.innerHTML = `
  <h3>🎯 Match con referencia</h3>
  <div class="ref-match-score-row">
    <div class="ref-match-score-circle"><span class="score-num">${pct}%</span><span class="score-label">MATCH TONAL</span></div>
    <div class="match-stage-cols">${stageBars}</div>
    <div>
      ${report.overall_score !== undefined ? `<div class="lgjs-s-2db3fd7b">Puntaje inteligente general: <b>${window.LGMDM.ui.escapeHtml(report.overall_score)}/100 (${window.LGMDM.ui.escapeHtml(report.grade ?? '')})</b></div>` : ""}
    </div>
  </div>
  <div class="lgjs-s-01219b21">Loudness</div>
  ${loudnessBar}
  <div class="ref-match-steps">
    <div class="ref-match-step">Ganancia aplicada: <b>${rm.loudness_gain_applied_db >= 0 ? "+" : ""}${rm.loudness_gain_applied_db} dB</b></div>
    ${adaptiveLoudnessHtml}
    <div class="ref-match-step">Techo limiter: <b>${(20 * Math.log10(rm.limiter_ceiling)).toFixed(2)} dBFS</b></div>
    <div class="lgjs-s-3717df59">${lraText}</div>
  </div>
  <div class="lgjs-s-01219b21">Dinámica por banda (crest factor propio vs. referencia)</div>
  ${dynRows}
  <div class="lgjs-s-01219b21">Ancho estéreo por banda</div>
  ${stereoRows}
  ${issuesHtml ? `<ul class="lgjs-s-f5b25172">${issuesHtml}</ul>` : ""}
  ${tipsHtml ? `<ul class="lgjs-s-9211073b">${tipsHtml}</ul>` : ""}
  ${msEqHtml}
`;
  const detailHtml = renderReferenceAnalysisPanel(refAnalysis, ownAnalysis, rm);
  if (detailHtml) panel.insertAdjacentHTML('beforeend', detailHtml);

  const sd = rm.spectral_dynamics;
  if (sd && sd.applied && sd.src_tonal_slope && sd.ref_tonal_slope) {
    const slope_src = sd.src_tonal_slope.loud_vs_quiet_db || [];
    const slope_ref = sd.ref_tonal_slope.loud_vs_quiet_db || [];
    const BAND_NAMES = ["Sub", "Graves", "Low-Mid", "Medios", "High-Mid", "Presencia", "Aire"];
    const slopeRows = slope_ref.map((refVal, i) => {
      const srcVal = slope_src[i] ?? 0;
      const label = BAND_NAMES[i] || `Banda ${i+1}`;
      const maxV = Math.max(Math.abs(refVal), Math.abs(srcVal), 1);
      const refPct = 50 + (refVal / maxV) * 45;
      const srcPct = 50 + (srcVal / maxV) * 45;
      const diff = Math.abs(refVal - srcVal);
      const color = diff < 1.5 ? "var(--ui-good,#3c6)" : diff < 3 ? "var(--ui-warn,#fa0)" : "var(--ui-danger,#e05)";
      return `<div class="lgjs-s-0397441f">
        <span class="lgjs-s-2dd04810">${label}</span>
        <div class="lgjs-s-f2285fd6">
          <div class="lgjs-s-bd475080"></div>
          <div title="Referencia" style="position:absolute;left:${refPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--ui-accent-2,#06b6d4);border-radius:1px"></div>
          <div title="Original" style="position:absolute;left:${srcPct.toFixed(1)}%;top:-1px;width:3px;height:8px;background:var(--ui-accent,#7c3aed);opacity:0.7;border-radius:1px"></div>
        </div>
        <span style="width:2.5rem;text-align:right;color:${color};font-family:var(--mono)">${refVal >= 0 ? '+' : ''}${refVal.toFixed(1)}</span>
      </div>`;
    }).join('');
    panel.insertAdjacentHTML('beforeend', `<details class="lgjs-s-63dabc83">
      <summary class="lgjs-s-4a58161d">🎚 Spectral balance por rango dinámico</summary>
      <div class="lgjs-s-3dc98b5e">
        <p class="lgjs-s-cb84d2cf">Diferencia espectral fuerte vs suave. Cyan = referencia · Violeta = original.</p>
        ${slopeRows}
        <p class="lgjs-s-5853bcb4">Intensidad: ${Math.round(sd.amount * 100)}% · ${sd.n_bins} rangos</p>
      </div>
    </details>`);
  }

  LGMDM.ui.getContent().appendChild(panel);
}

// ── AB Panel (sin cambios) ──────────────────────────────────
LGMDM.dom.requireById("btnAB", "08-reference-mastering")?.addEventListener("click", () => {
  if (!window.LGMDM.state.selectedFile) return;
  showABPanel();
});
function showABPanel() {
  let wrap = document.getElementById("abPanelWrap");
  if (wrap) return;
  LGMDM.ui.clearResults();
  wrap = document.createElement("div");
  wrap.id = "abPanelWrap";
  wrap.className = "ab-wrap";
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
  LGMDM.dom.requireById("content", "08-reference-mastering").appendChild(wrap);
  LGMDM.dom.requireById("abCaptureA", "08-reference-mastering:showABPanel").addEventListener("click", () => captureAB("A"));
  LGMDM.dom.requireById("abCaptureB", "08-reference-mastering:showABPanel").addEventListener("click", () => captureAB("B"));
  LGMDM.dom.requireById("abPlayA", "08-reference-mastering:showABPanel").addEventListener("click", () => playAB("A"));
  LGMDM.dom.requireById("abPlayB", "08-reference-mastering:showABPanel").addEventListener("click", () => playAB("B"));
}

async function captureAB(slot) {
  if (!window.LGMDM.state.selectedFile) {
    LGMDM.dom.requireById("abStatus", "08-reference-mastering:captureAB").textContent = "Selecciona un archivo primero.";
    return;
  }
  const status = LGMDM.dom.requireById("abStatus", "08-reference-mastering:captureAB");
  status.textContent = `Capturando ${slot}…`;
  const fd = new FormData();
  fd.append("file", window.LGMDM.state.selectedFile);
  try {
    const params = LGMDM.params.build();
    params.set("preview_seconds", "10");
    const url = `${LGMDM.api.apiBase()}/preview?${params.toString()}`;
    const res = await LGMDM.api.apiFetch(url, { method: "POST", body: fd });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const blob = await res.blob();
    if (slot === "A") {
      window.LGMDM.state.abSnapshotA = { blob, label: "A" };
      LGMDM.dom.requireById("abPlayA", "08-reference-mastering:captureAB").disabled = false;
      LGMDM.dom.requireById("abPlayA", "08-reference-mastering:captureAB").classList.add("active-a");
    } else {
      window.LGMDM.state.abSnapshotB = { blob, label: "B" };
      LGMDM.dom.requireById("abPlayB", "08-reference-mastering:captureAB").disabled = false;
      LGMDM.dom.requireById("abPlayB", "08-reference-mastering:captureAB").classList.add("active-b");
    }
    status.textContent = `${slot} capturado ✓. ${window.LGMDM.state.abSnapshotA && window.LGMDM.state.abSnapshotB ? "Ambos listos." : ""}`;
  } catch (e) {
    console.debug("Error capturando:", e);
    status.textContent = "Error: " + e.message;
  }
}

let _abCurrentUrl = null;
function playAB(slot) {
  const snap = slot === "A" ? window.LGMDM.state.abSnapshotA : window.LGMDM.state.abSnapshotB;
  if (!snap) return;
  const wrap = LGMDM.dom.requireById("abAudioWrap", "08-reference-mastering:playAB");
  if (_abCurrentUrl) URL.revokeObjectURL(_abCurrentUrl);
  _abCurrentUrl = URL.createObjectURL(snap.blob);
  wrap.innerHTML = `<div style="font-family:var(--mono);font-size:.75rem;color:${slot === "A" ? "var(--ui-accent)" : "var(--ui-warn)"};margin-bottom:.3rem">▶ ${slot}</div><audio controls src="${LGMDM.ui.safeAudioSrc(_abCurrentUrl)}" class="lgjs-s-0466783d"></audio>`;
}

// ── Advice ────────────────────────────────────────────────────
function renderAdvicePanel(adviceData, title, subtitle) {
  const panel = document.createElement("div");
  panel.className = "advice-panel";
  const score = adviceData.score ?? 0,
    grade = adviceData.grade ?? "";
  const issues = adviceData.issues ?? [],
    tips = adviceData.tips ?? [];
  const gradeClass =
    grade === "Excelente"
      ? "grade-ex"
      : grade === "Buena"
        ? "grade-good"
        : grade === "Aceptable"
          ? "grade-ok"
          : "grade-bad";
  const issuesHtml = issues.length
    ? `<ul class="advice-issues">${issues.map((i) => `<li>${LGMDM.ui.escapeHtml(i)}</li>`).join("")}</ul>`
    : "";
  const tipsHtml = tips.length ? `<ul class="advice-tips">${tips.map((t) => `<li>${LGMDM.ui.escapeHtml(t)}</li>`).join("")}</ul>` : "";
  panel.innerHTML = `<h3>${LGMDM.ui.escapeHtml(title)}${subtitle ? ` <span class="lgjs-s-21bab4f3">${LGMDM.ui.escapeHtml(subtitle)}</span>` : ""}</h3><div class="advice-score-row"><div class="advice-score-circle"><span class="score-num">${score}</span><span class="score-label">/ 100</span></div><div><div class="advice-grade ${gradeClass}">${grade}</div><div class="lgjs-s-14ef2f38">${issues.length} problema${issues.length !== 1 ? "s" : ""}</div></div></div>${issuesHtml}${tipsHtml}`;
  LGMDM.ui.getContent().appendChild(panel);
}

  // Public contracts consumed by other modules.
  LGMDM.reference.renderAdvicePanel = renderAdvicePanel;
})(window);
