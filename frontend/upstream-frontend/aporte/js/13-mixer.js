// 13-mixer-model.js — Mixer domain model and pure helpers
(function(){
  "use strict";
  const LG = window.LGMDM = window.LGMDM || {};
function defaultStemParams(name) {
  return {
    name, stem_type: detectStemType(name),
    gain_db: 0, pan: 0, mute: false, solo: false,
    hp_cutoff_hz: 20, lp_cutoff_hz: 20000,
    eq_low_freq: 100,   eq_low_gain_db: 0,   eq_low_q: 0.8,
    eq_lomid_freq: 500, eq_lomid_gain_db: 0, eq_lomid_q: 1.0,
    eq_himid_freq: 3000,eq_himid_gain_db: 0, eq_himid_q: 1.0,
    eq_high_freq: 10000,eq_high_gain_db: 0,  eq_high_q: 0.8,
    comp_enabled: false, comp_threshold: 0.5, comp_ratio: 4,
    comp_attack_ms: 10, comp_release_ms: 100, comp_makeup_db: 0,
    comp_stereo_link: true, comp_pdr: true,
    transient_attack: 0, transient_sustain: 0,
    stereo_width_amount: 1.0,
    sidechain_trigger_name: null, sidechain_threshold: 0.3,
    sidechain_ratio: 6, sidechain_attack_ms: 5, sidechain_release_ms: 80,
    reverb_enabled: false,
    reverb_preset: 'small_studio',
    reverb_wet_amount: 0.3,
    reverb_pre_delay_ms: 0,
    reverb_room_size: 1.0,
    pitch_correction_enabled: false,
    pitch_correction_mode: 'MEDIUM',
    pitch_correction_scale: null,
    pitch_correction_glide_ms: 50,
  };
}

function detectStemType(name) {
  const n = name.toLowerCase();
  if (/kick|bd|bombo/.test(n))        return 'kick';
  if (/snare|caja|rim/.test(n))       return 'snare';
  if (/bass|bajo|808/.test(n))        return 'bass';
  if (/voc|voice|vocal|lead/.test(n)) return 'vocals';
  if (/guitar|guit/.test(n))          return 'guitar';
  if (/synth|pad|keys|piano/.test(n)) return 'synth';
  if (/drum|perc|hat|cymbal/.test(n)) return 'drums';
  if (/fx|effect|atm/.test(n))        return 'fx';
  return 'other';
}

function stemEmoji(t) {
  return ({kick:'[KICK]',snare:'[SNR]',bass:'[BASS]',vocals:'[VOX]',guitar:'[GTR]',
           synth:'[SYN]',drums:'[DRM]',fx:'[FX]',other:'[TRK]'})[t]||'[TRK]';
}


  LG.mixerUiModel = Object.freeze({ defaultStemParams, detectStemType, stemEmoji });
})();

// ──────────────────────────────────────────────────────
// ENGINE (migrado desde 13-mixer-engine.js)
// ──────────────────────────────────────────────────────

// ============================================================

(function (global) {

  // Canonical shared services from 00-api.js / 01-state.js.
  const LG = global.LGMDM || {};
  const cachedEl = LG.dom?.cachedEl || ((id) => document.getElementById(id));
  const invalidateCachedEl = LG.dom?.invalidateCachedEl || (() => {});
  const getGenUUID = () => typeof global.genUUID === 'function' ? global.genUUID() : crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`;
  const formatDbValue = window.LGMDM?.formatters?.formatDbValue;
  const formatLinearThresholdToDb = window.LGMDM?.formatters?.formatLinearThresholdToDb;

  // ── Estado ────────────────────────────────────────────────────────────────
  const mixerState = {
    sessionId: getGenUUID(),
    stems: {},
    stemLibrary: [],
    stemLibraryLoaded: false,
    jobId: null,
    polling: null,
  };

  // ── Live preview engine (Web Audio API) ──────────────────────────────────
  const previewEngine = {
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
    rafId: null,
    endTimer: null,
  };

  function dbToLin(db) { return Math.pow(10, db / 20); }

  function ensureAudioCtx() {
    if (!previewEngine.ctx) {
      const audioMod = global.LGMDM?.audio;
      if (!audioMod || typeof audioMod.getContext !== 'function') {
        throw new Error('LGMDM.audio.getContext no disponible');
      }
      previewEngine.ctx = audioMod.getContext();
      previewEngine.masterGain = previewEngine.ctx.createGain();
      previewEngine.masterGain.connect(previewEngine.ctx.destination);
      const masterDb = parseFloat(cachedEl('mix-master-gain')?.value || 0);
      previewEngine.masterGain.gain.value = dbToLin(masterDb);
    }
    return previewEngine.ctx;
  }

  async function decodeStemForPreview(name, file) {
    try {
      const arrBuf = await file.arrayBuffer();
      previewEngine.buffers[name] = arrBuf;
      if (previewEngine.playing) {
        const decoded = await ensureDecoded(name);
        if (decoded) startStemSource(name, getPreviewPosition());
      }
      updateTransportUI();
    } catch (err) {
      console.warn(`No se pudo leer "${name}" para preview:`, err);
    }
  }

  async function ensureDecoded(name) {
    if (previewEngine.decodedBuffers[name]) return previewEngine.decodedBuffers[name];
    if (!previewEngine.buffers[name]) return null;
    const ctx = ensureAudioCtx();
    try {
      const audioBuf = await ctx.decodeAudioData(previewEngine.buffers[name].slice(0));
      previewEngine.decodedBuffers[name] = audioBuf;
      return audioBuf;
    } catch (err) {
      console.warn(`Error decodificando "${name}":`, err);
      return null;
    }
  }

  function ensureStemChain(name) {
    if (previewEngine.nodes[name]) return previewEngine.nodes[name];
    const ctx = ensureAudioCtx();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 0.707;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';  lp.Q.value = 0.707;
    const eqLow   = ctx.createBiquadFilter(); eqLow.type   = 'peaking';
    const eqLoMid = ctx.createBiquadFilter(); eqLoMid.type = 'peaking';
    const eqHiMid = ctx.createBiquadFilter(); eqHiMid.type = 'peaking';
    const eqHigh  = ctx.createBiquadFilter(); eqHigh.type  = 'peaking';
    const comp = ctx.createDynamicsCompressor();
    const gainNode = ctx.createGain();
    const panNode = ctx.createStereoPanner();
    const muteSoloGain = ctx.createGain();

    hp.connect(lp); lp.connect(eqLow); eqLow.connect(eqLoMid); eqLoMid.connect(eqHiMid);
    eqHiMid.connect(eqHigh); eqHigh.connect(comp); comp.connect(gainNode);
    gainNode.connect(panNode); panNode.connect(muteSoloGain);
    muteSoloGain.connect(previewEngine.masterGain);

    const chain = { hp, lp, eqLow, eqLoMid, eqHiMid, eqHigh, comp, gainNode, panNode, muteSoloGain, source: null };
    previewEngine.nodes[name] = chain;
    return chain;
  }

  function applyStemParamsToChain(name) {
    if (!previewEngine.ctx) return;
    const chain = previewEngine.nodes[name];
    const p = mixerState.stems[name]?.params;
    if (!chain || !p) return;
    const t = previewEngine.ctx.currentTime;
    const ramp = (audioParam, val) => audioParam.setTargetAtTime(val, t, 0.015);
    ramp(chain.hp.frequency, p.hp_cutoff_hz);
    ramp(chain.lp.frequency, Math.min(p.lp_cutoff_hz, previewEngine.ctx.sampleRate / 2 - 100));
    ramp(chain.eqLow.frequency,   p.eq_low_freq);   ramp(chain.eqLow.gain,   p.eq_low_gain_db);   ramp(chain.eqLow.Q,   p.eq_low_q);
    ramp(chain.eqLoMid.frequency, p.eq_lomid_freq); ramp(chain.eqLoMid.gain, p.eq_lomid_gain_db); ramp(chain.eqLoMid.Q, p.eq_lomid_q);
    ramp(chain.eqHiMid.frequency, p.eq_himid_freq); ramp(chain.eqHiMid.gain, p.eq_himid_gain_db); ramp(chain.eqHiMid.Q, p.eq_himid_q);
    ramp(chain.eqHigh.frequency,  p.eq_high_freq);  ramp(chain.eqHigh.gain,  p.eq_high_gain_db);  ramp(chain.eqHigh.Q,  p.eq_high_q);
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

  function updateAllMuteSolo() {
    if (!previewEngine.ctx) return;
    const stems = mixerState.stems;
    const anySolo = Object.values(stems).some(s => s.params.solo);
    const t = previewEngine.ctx.currentTime;
    for (const [name, s] of Object.entries(stems)) {
      const chain = previewEngine.nodes[name];
      if (!chain) continue;
      const audible = !s.params.mute && (!anySolo || s.params.solo);
      chain.muteSoloGain.gain.setTargetAtTime(audible ? 1 : 0, t, 0.01);
    }
  }

  function getPreviewPosition() {
    if (!previewEngine.playing || !previewEngine.ctx) return previewEngine.position;
    return previewEngine.startOffset + (previewEngine.ctx.currentTime - previewEngine.startCtxTime);
  }

  async function startStemSource(name, atPosition) {
    const buf = await ensureDecoded(name);
    if (!buf) return;
    const chain = ensureStemChain(name);
    applyStemParamsToChain(name);
    if (chain.source) { try { chain.source.stop(); } catch (e) {} }
    const src = previewEngine.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(chain.hp);
    const offset = Math.min(Math.max(atPosition, 0), buf.duration);
    try { src.start(previewEngine.ctx.currentTime, offset); } catch (e) {}
    src.onended = () => { try { src.disconnect(); } catch (_) {} };
    chain.source = src;
  }

  async function playPreview() {
    const names = Object.keys(mixerState.stems).filter(n => previewEngine.buffers[n]);
    ensureAudioCtx();
    if (previewEngine.ctx.state === 'suspended') previewEngine.ctx.resume();
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
    previewEngine.playing = true;
    previewEngine.startCtxTime = previewEngine.ctx.currentTime;
    previewEngine.startOffset = startOffset;
    updateAllMuteSolo();
    clearTimeout(previewEngine.endTimer);
    const remaining = Math.max(0, previewEngine.duration - startOffset);
    previewEngine.endTimer = setTimeout(() => stopPreview(true), remaining * 1000 + 60);
    updateTransportUI();
    try { global.dispatchEvent(new CustomEvent('lgmdm:playback-started', { detail: { source: 'mixer-preview' } })); } catch (_) {}
    tickTransport();
  }

  function stopPreview(resetToStart) {
    const wasPlaying = previewEngine.playing;
    if (previewEngine.ctx) {
      Object.values(previewEngine.nodes).forEach(chain => {
        if (chain.source) { try { chain.source.stop(); } catch (e) {} chain.source = null; }
      });
    }
    previewEngine.position = resetToStart ? 0 : getPreviewPosition();
    previewEngine.playing = false;
    clearTimeout(previewEngine.endTimer);
    cancelAnimationFrame(previewEngine.rafId);
    updateTransportUI();
    if (wasPlaying) {
      try { global.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { source: 'mixer-preview' } })); } catch (_) {}
    }
  }

  function togglePreview() { previewEngine.playing ? stopPreview(false) : playPreview(); }

  function seekPreview(seconds) {
    const wasPlaying = previewEngine.playing;
    if (wasPlaying) stopPreview(false);
    previewEngine.position = Math.max(0, Math.min(seconds, previewEngine.duration || seconds));
    updateTransportUI();
    if (wasPlaying) playPreview();
  }

  function fmtTime(s) {
    if (!Number.isFinite(s)) return '0:00';
    const m = Math.floor(s / 60), sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, '0')}`;
  }

  function updateTransportUI() {
    const btn = cachedEl('mxrPlayBtn');
    const seek = cachedEl('mxrSeek');
    const time = cachedEl('mxrTimeLabel');
    if (btn) btn.textContent = previewEngine.playing ? '⏸' : '▶';
    const pos = getPreviewPosition();
    if (seek) {
      seek.max = previewEngine.duration || 0;
      if (document.activeElement !== seek) seek.value = pos;
    }
    if (time) time.textContent = `${fmtTime(pos)} / ${fmtTime(previewEngine.duration)}`;
  }

  function tickTransport() {
    if (!previewEngine.playing) return;
    updateTransportUI();
    previewEngine.rafId = requestAnimationFrame(tickTransport);
  }

  function removeStemFromPreview(name) {
    const chain = previewEngine.nodes[name];
    if (chain) {
      if (chain.source) { try { chain.source.stop(); } catch (e) {} }
      const safe = (node) => { try { node && node.disconnect && node.disconnect(); } catch (_) {} };
      for (const node of Object.values(chain)) safe(node);
      chain.source = null;
    }
    delete previewEngine.nodes[name];
    delete previewEngine.decodedBuffers[name];
    delete previewEngine.buffers[name];
  }

  function resetPreviewEngine() {
    stopPreview(true);
    Object.keys(previewEngine.nodes).forEach(removeStemFromPreview);
  }

  // ── Server preview ──────────────────────────────────────────────────────────
  const serverPreview = { enabled: false, ws: null, debounceTimer: null, rendering: false };

  function setServerPreviewStatus(txt) {
    const el = cachedEl('mxrServerPreviewStatus');
    if (el) el.textContent = txt;
  }

  function scheduleServerPreview() {
    if (!serverPreview.enabled) return;
    clearTimeout(serverPreview.debounceTimer);
    setServerPreviewStatus('Esperando…');
    // Throttle: 800ms en lugar de 700ms para reducir llamadas
    serverPreview.debounceTimer = setTimeout(runServerPreview, 800);
  }

  async function runServerPreview() {
    const names = Object.keys(mixerState.stems).filter(n => mixerState.stems[n].uploaded);
    if (!names.length) { setServerPreviewStatus('Subí al menos un stem.'); return; }
    if (serverPreview.ws) { try { serverPreview.ws.close(); } catch (e) {} serverPreview.ws = null; }
    serverPreview.rendering = true;
    setServerPreviewStatus('Renderizando en el servidor…');
    const stemParams = {};
    names.forEach(n => stemParams[n] = mixerState.stems[n].params);
    const mixParamsPayload = {
      master_gain_db: parseFloat(cachedEl('mix-master-gain')?.value || 0),
      target_lufs:    parseFloat(cachedEl('mix-lufs')?.value || -14),
      normalize_before_master: cachedEl('mix-normalize')?.checked ?? true,
      master_limiter_ceiling: parseFloat(cachedEl('mix-master-ceiling')?.value || 0.95),
      chain_params: {},
    };
    const pcmChunks = [];
    let sampleRate = 44100, channels = 2;
    try {
      const apiMod = global.LGMDM?.api;
      const wsAuthFn = apiMod?.wsAuthUrl;
      if (typeof wsAuthFn !== 'function') throw new Error('LGMDM.api.wsAuthUrl no disponible');
      const wsUrl = await wsAuthFn('/ws/mix-stream');
      await new Promise((resolve, reject) => {
        let resolved = false;
        const ws = new WebSocket(wsUrl);
        serverPreview.ws = ws;
        ws.binaryType = 'arraybuffer';
        ws.onopen = () => {
          ws.send(JSON.stringify({
            session_id: mixerState.sessionId,
            stem_names: names,
            stem_library_ids: (typeof window.buildStemLibraryIdMap === 'function' ? window.buildStemLibraryIdMap(names) : {}),
            stem_params: stemParams,
            mix_params: mixParamsPayload,
            chunk_seconds: 1.0,
            preview_seconds: 12,
            sr: 44100,
          }));
        };
        ws.onmessage = (ev) => {
          if (typeof ev.data === 'string') {
            let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
            if (msg.event === 'chunk') { sampleRate = msg.sample_rate; channels = msg.channels; }
            if (msg.event === 'error') reject(new Error(msg.message || 'Error de preview'));
            if (msg.event === 'done' && !resolved) { resolved = true; resolve(); }
          } else {
            pcmChunks.push(ev.data);
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

      if (typeof wavBlobFromPcm16 === 'function') {
        const blob = wavBlobFromPcm16(pcmChunks, sampleRate, channels);
        const audioEl = cachedEl('mxrServerPreviewAudio');
        if (audioEl) {
          if (audioEl.dataset.blobUrl) URL.revokeObjectURL(audioEl.dataset.blobUrl);
          const url = URL.createObjectURL(blob);
          audioEl.dataset.blobUrl = url;
          audioEl.src = url;
          audioEl.play().catch(() => {});
        }
      }
      setServerPreviewStatus(`Preview listo ✓ — ${names.length} stem${names.length !== 1 ? 's' : ''}`);
    } catch (err) {
      setServerPreviewStatus('Error: ' + err.message);
    } finally {
      serverPreview.rendering = false;
      if (serverPreview.ws) {
        try { serverPreview.ws.close(); } catch (e) {}
        serverPreview.ws = null;
      }
    }
  }



  const runtime = {
    cachedEl, invalidateCachedEl, mixerState, previewEngine, serverPreview,
    getGenUUID, formatDbValue, formatLinearThresholdToDb, dbToLin,
    ensureAudioCtx, decodeStemForPreview, ensureDecoded, ensureStemChain,
    applyStemParamsToChain, updateAllMuteSolo, getPreviewPosition, startStemSource,
    playPreview, stopPreview, togglePreview, seekPreview, fmtTime, updateTransportUI,
    tickTransport, removeStemFromPreview, resetPreviewEngine, setServerPreviewStatus,
    scheduleServerPreview, runServerPreview
  };
  global.LGMDM = global.LGMDM || {};
  global.LGMDM.mixerEngine = runtime;

  // F5.13 — Namespace explícito + freeze profundo.
  // - mixerState (top-level inmutable)
  // - mixerState.stems[name] (cada stem frozen al crearse)
  // - previewEngine (referencia viva al engine, NO frozen — debe permitir
  //   updates de rafId, buffers, etc.)
  // - runtime.functions (frozen: playPreview/stopPreview/togglePreview)
  function _freezeStem(stem) {
    if (!stem || stem.__frozen) return;
    Object.freeze(stem);
    stem.__frozen = true;
  }

  // Freeze each stem as it's created via the helper.
  Object.values(mixerState.stems).forEach(_freezeStem);

  Object.freeze(mixerState);
  global.LGMDM.mixer = Object.freeze({
    state: mixerState,
    previewEngine,
    functions: Object.freeze({
      playPreview: runtime.playPreview,
      stopPreview: runtime.stopPreview,
      togglePreview: runtime.togglePreview,
      _freezeStem,
    }),
  });

})(window);

// ──────────────────────────────────────────────────────
// LIBRARY (migrado desde 13-mixer-library.js)
// ──────────────────────────────────────────────────────

// 13-mixer-library.js — Stem library service and persistence orchestration
(function(){
  "use strict";
  const LG = window.LGMDM = window.LGMDM || {};
  const LGMDM = LG;

  function createMixerLibraryService(ctx) {
    const { mixerState, apiFetch, cachedEl, defaultStemParams, addChannelToDOM, renderMixerSidePanel, decodeStemForPreview, scheduleServerPreview, handleClientError } = ctx;
    function normalizeStemName(name, fallback) {
      const base = (name || fallback || "stem").replace(/\.[^.]+$/, "").trim();
      return base || "stem";
    }
    async function refreshStemLibrary(force) {
      if (mixerState.stemLibraryLoaded && !force) return mixerState.stemLibrary;
      try {
        const res = await LGMDM.api.apiFetch("/mix/stem-library");
        if (!res.ok) throw new Error(await res.text());
        const data = await res.json();
        mixerState.stemLibrary = data.files || [];
        mixerState.stemLibraryLoaded = true;
      } catch (err) {
        console.warn("No se pudo cargar la librería de stems:", err);
        mixerState.stemLibrary = [];
      }
      renderMixerSidePanel();
      return mixerState.stemLibrary;
    }
    async function addStemFromLibrary(item) {
      const stemName = normalizeStemName(item.original_filename, item.id);
      if (mixerState.stems[stemName] && !confirm(`Ya existe "${stemName}". ¿Reemplazar?`)) return;
      mixerState.stems[stemName] = { file:null, params:defaultStemParams(stemName), uploaded:true, duration:item.duration_sec, libraryId:item.id, libraryName:item.original_filename };
      _freezeStem(mixerState.stems[stemName]);
      addChannelToDOM(stemName);
      try {
        const res = await LGMDM.api.apiFetch(`/mix/stem-library/${item.id}/download`);
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const file = new File([blob], item.original_filename || `${stemName}.wav`, { type: blob.type });
        await decodeStemForPreview(stemName, file);
        const submitBtn = cachedEl("mixerSubmitBtn");
        if (submitBtn) submitBtn.removeAttribute("disabled");
        scheduleServerPreview();
      } catch (err) {
        console.warn("No se pudo preparar preview local del stem guardado:", err);
      }
    }
    async function deleteStemFromLibrary(item) {
      if (!confirm(`¿Borrar "${item.original_filename}" de la librería de stems?`)) return;
      try {
        const res = await LGMDM.api.apiFetch(`/mix/stem-library/${item.id}`, { method:"DELETE" });
        if (!res.ok) throw new Error(await res.text());
        mixerState.stemLibrary = mixerState.stemLibrary.filter(x => x.id !== item.id);
        renderMixerSidePanel();
      } catch (err) {
        handleClientError?.(err, "No se pudo borrar el stem.", { context:"mixer-stem-delete" });
      }
    }
    return Object.freeze({ normalizeStemName, refreshStemLibrary, addStemFromLibrary, deleteStemFromLibrary });
  }

  LG.createMixerLibraryService = createMixerLibraryService;
})();
