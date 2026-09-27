// ============================================================
// 35-audio-tap.js — Audio routing compartido para Pro Suite
// ============================================================
// Extraído de 34-premium-suite.js (Fase 5 — consolidación).
// Provee un único Splitter/AnalyserNode conectado a la fuente
// de audio activa (mixer master o <audio> del preview), que
// reutilizan goniómetro, waterfall, aurora y multibanda.
//
// API pública:
//   LGMDM.proFeatures.audioTap.ensure()
//   LGMDM.proFeatures.audioTap.teardown()
//   LGMDM.proFeatures.audioTap.bandSpecs   // [{id, label, freq, q}, …]
// ============================================================

(function (global) {
  "use strict";
  const LG = global.LGMDM = global.LGMDM || {};
  const proFeatures = LG.proFeatures = LG.proFeatures || {};

  const _audioTap = {
    ctx: null,
    source: null,
    splitter: null,
    masterOut: null,
    sourceType: null,
    sourceEl: null,
    mediaSource: null,
    analyserGonioL: null,
    analyserGonioR: null,
    analyserL: null,
    analyserR: null,
    analyserWaterfall: null,
    analyserAurora: null,
    bandAnalysers: [],
    bandFilters: [],
    ready: false,
  };

  const BAND_SPECS = [
    { id: 'lowMid',  label: 'Low-Mid (200 Hz – 2 kHz)', freq: 632,   q: 0.7 },
    { id: 'highMid', label: 'High-Mid (2 kHz – 6 kHz)', freq: 3464,  q: 1.0 },
    { id: 'air',     label: 'Air (> 6 kHz)',            freq: 9798,  q: 1.2 },
  ];

  function ensureAudioTap(candidate) {
    const mixerMaster = LG?.mixerEngine?.previewEngine?.masterGain;
    const isNode = candidate && typeof candidate.connect === 'function';
    const isAudioEl = candidate && candidate.tagName === 'AUDIO';
    const audioEl = isAudioEl
      ? candidate
      : (document.querySelector('#previewAudioWrap audio[data-preview-ready="true"]')
        || document.querySelector('#previewAudioWrap audio')
        || document.querySelector('#mxrServerPreviewAudio'));

    const abGain = LG?.ab?.getGainNode?.();
    const abPlaying = LG?.ab?.isPlaying?.();

    // Si ya está listo, verificar si la fuente cambió
    if (_audioTap.ready) {
      if (isNode && _audioTap.source !== candidate) {
        teardownAudioTap();
      } else if (audioEl && _audioTap.sourceType === 'media-element' && _audioTap.sourceEl !== audioEl) {
        teardownAudioTap();
      } else if (abPlaying && abGain && _audioTap.source !== abGain) {
        teardownAudioTap();
      } else {
        return _audioTap;
      }
    }

    const ctx = (LG.audio && typeof LG.audio.getContext === 'function')
      ? LG.audio.getContext()
      : null;
    if (!ctx) return null;

    let source = null;
    let sourceType = null;
    let masterOut = null;
    let mediaSource = null;

    if (isNode) {
      source = candidate;
      sourceType = 'custom-node';
    } else if (abPlaying && abGain) {
      source = abGain;
      sourceType = 'ab-node';
    } else if (mixerMaster && mixerMaster.context === ctx && mixerMaster.context.state !== 'closed' && LG?.mixerEngine?.previewEngine?.playing) {
      source = mixerMaster;
      sourceType = 'mixer';
    } else if (audioEl) {
      try {
        mediaSource = audioEl._mediaElementSourceNode || (typeof ctx.createMediaElementSource === 'function' ? ctx.createMediaElementSource(audioEl) : null);
        if (mediaSource) {
          audioEl._mediaElementSourceNode = mediaSource;
          masterOut = ctx.createGain();
          masterOut.gain.value = 1;
          try { mediaSource.connect(masterOut); } catch (_) {}
          try { masterOut.connect(ctx.destination); } catch (_) {}
          source = mediaSource;
          sourceType = 'media-element';
        }
      } catch (_) {
        return null;
      }
    } else if (mixerMaster && mixerMaster.context === ctx && mixerMaster.context.state !== 'closed') {
      source = mixerMaster;
      sourceType = 'mixer';
    }

    if (!source) return null;

    const splitter = ctx.createChannelSplitter(2);
    try { source.connect(splitter); } catch (_) {}

    // Analysers estéreo principales (2048 FFT para meters y espectro completo)
    const analyserL = ctx.createAnalyser();
    analyserL.fftSize = 2048;
    analyserL.smoothingTimeConstant = 0;
    const analyserR = ctx.createAnalyser();
    analyserR.fftSize = 2048;
    analyserR.smoothingTimeConstant = 0;
    try { splitter.connect(analyserL, 0); } catch (_) {}
    try { splitter.connect(analyserR, 1); } catch (_) {}

    // Analysers para goniómetro polar (1024 FFT para respuesta inmediata)
    const analyserGonioL = ctx.createAnalyser();
    analyserGonioL.fftSize = 1024;
    analyserGonioL.smoothingTimeConstant = 0;
    const analyserGonioR = ctx.createAnalyser();
    analyserGonioR.fftSize = 1024;
    analyserGonioR.smoothingTimeConstant = 0;
    try { splitter.connect(analyserGonioL, 0); } catch (_) {}
    try { splitter.connect(analyserGonioR, 1); } catch (_) {}

    // Analysers para visualizadores Pro
    const analyserWaterfall = ctx.createAnalyser();
    analyserWaterfall.fftSize = 2048;
    analyserWaterfall.smoothingTimeConstant = 0.65;
    try { splitter.connect(analyserWaterfall, 0); } catch (_) {}

    const analyserAurora = ctx.createAnalyser();
    analyserAurora.fftSize = 2048;
    analyserAurora.smoothingTimeConstant = 0.78;
    try { splitter.connect(analyserAurora, 0); } catch (_) {}

    const bandAnalysers = [];
    const bandFilters = [];
    for (const spec of BAND_SPECS) {
      const fL = ctx.createBiquadFilter();
      fL.type = 'bandpass';
      fL.frequency.value = spec.freq;
      fL.Q.value = spec.q;
      const fR = ctx.createBiquadFilter();
      fR.type = 'bandpass';
      fR.frequency.value = spec.freq;
      fR.Q.value = spec.q;
      try { splitter.connect(fL, 0); } catch (_) {}
      try { splitter.connect(fR, 1); } catch (_) {}
      const aL = ctx.createAnalyser();
      aL.fftSize = 512;
      aL.smoothingTimeConstant = 0;
      const aR = ctx.createAnalyser();
      aR.fftSize = 512;
      aR.smoothingTimeConstant = 0;
      try { fL.connect(aL); } catch (_) {}
      try { fR.connect(aR); } catch (_) {}
      bandAnalysers.push([aL, aR]);
      bandFilters.push([fL, fR]);
    }

    Object.assign(_audioTap, {
      ctx, source, splitter, masterOut, mediaSource,
      sourceType,
      sourceEl: sourceType === 'media-element' ? (audioEl || null) : null,
      analyserL, analyserR,
      analyserGonioL, analyserGonioR, analyserWaterfall, analyserAurora,
      bandAnalysers, bandFilters,
      ready: true,
    });
    LG.state = LG.state || {};
    LG.state.audio = LG.state.audio || {};
    LG.state.audio.tap = _audioTap;
    return _audioTap;
  }

  function teardownAudioTap() {
    if (!_audioTap || !_audioTap.ready) return;
    const safe = (node) => { try { node && node.disconnect && node.disconnect(); } catch (_) {} };
    safe(_audioTap.splitter);
    safe(_audioTap.analyserL);
    safe(_audioTap.analyserR);
    safe(_audioTap.analyserGonioL);
    safe(_audioTap.analyserGonioR);
    safe(_audioTap.analyserWaterfall);
    safe(_audioTap.analyserAurora);
    (_audioTap.bandAnalysers || []).forEach((pair) => pair.forEach(safe));
    (_audioTap.bandFilters || []).forEach((pair) => pair.forEach(safe));
    if (_audioTap.sourceType === 'media-element') {
      safe(_audioTap.masterOut);
      safe(_audioTap.mediaSource);
    }
    Object.assign(_audioTap, {
      ready: false,
      ctx: null,
      source: null,
      splitter: null,
      masterOut: null,
      mediaSource: null,
      sourceType: null,
      sourceEl: null,
      analyserL: null,
      analyserR: null,
      analyserGonioL: null,
      analyserGonioR: null,
      analyserWaterfall: null,
      analyserAurora: null,
      bandAnalysers: [],
      bandFilters: [],
    });
    if (LG.state?.audio?.tap === _audioTap) LG.state.audio.tap = null;
  }

  proFeatures.audioTap = {
    ensure: ensureAudioTap,
    teardown: teardownAudioTap,
    bandSpecs: BAND_SPECS,
    getTap: () => _audioTap,
  };
})(window);
