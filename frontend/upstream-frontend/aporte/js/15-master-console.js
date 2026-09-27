(() => {
  'use strict';
  const root = window.LGMDM = window.LGMDM || {};
  const LGMDM = root;
  root.console = root.console || {};
  const $ = (id) => document.getElementById(id);
  const state = {
    raf: 0, start: performance.now(), playing: false, audio: null,
    ab: 'master', applying: false,
    stageBypass: { input: false, comp: false, stereo: false, limiter: false },
    metrics: null, spectrum: [], waveHistory: [],
  };

  const refs = {
    input: ['s-ingain', 'consoleInputFader'],
    compThreshold: ['s-thresh', 'consoleCompThreshold'],
    compRatio: ['s-ratio', 'consoleCompRatio'],
    stereo: ['s-width', 'consoleStereoFader'],
    limiter: ['s-ceiling', 'consoleLimiterFader'],
  };

  function mirror(srcId, dstId) {
    const src = LGMDM.dom.byId(srcId), dst = LGMDM.dom.byId(dstId);
    if (!src || !dst) return;
    dst.value = src.value;
    const event = dst.tagName === 'SELECT' || dst.type === 'checkbox' ? 'change' : 'input';
    dst.addEventListener(event, () => {
      src.value = dst.value;
      src.dispatchEvent(new Event(event, { bubbles: true }));
      updateReadouts();
      updateStageCards();
    });
    src.addEventListener('input', () => { dst.value = src.value; updateReadouts(); });
    src.addEventListener('change', () => { dst.value = src.value; updateReadouts(); updateStageCards(); });
  }

    function formatDb(v) { return `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)} dB`; }
  function ceilingDb(v) { return 20 * Math.log10(Math.max(0.01, Number(v))); }

      function toggleStage(stage) {
    state.stageBypass[stage] = !state.stageBypass[stage];
    const related = {
      comp: ['s-thresh', 's-ratio'],
      stereo: ['s-width'],
      limiter: ['s-ceiling'],
    }[stage] || [];
    related.forEach((id) => {
      const el = LGMDM.dom.byId(id);
      if (!el) return;
      if (state.stageBypass[stage]) {
        if (el.dataset.consoleSaved == null) el.dataset.consoleSaved = el.value;
        if (stage === 'comp') el.value = id === 's-ratio' ? '1' : '0';
        if (stage === 'stereo') el.value = '1';
        if (stage === 'limiter') el.value = '0.999';
      } else if (el.dataset.consoleSaved != null) {
        el.value = el.dataset.consoleSaved;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    updateReadouts(); updateStageCards(); scheduleConsolePreview();
  }

  function updateReadouts() {
    const input = Number(LGMDM.dom.byId('s-ingain')?.value ?? 0);
    const ct = Number(LGMDM.dom.byId('s-thresh')?.value ?? -18);
    const cr = Number(LGMDM.dom.byId('s-ratio')?.value ?? 4);
    const sw = Number(LGMDM.dom.byId('s-width')?.value ?? 1);
    const ceil = Number(LGMDM.dom.byId('s-ceiling')?.value ?? .891);
    if (LGMDM.dom.byId('consoleInputReadout')) LGMDM.dom.byId('consoleInputReadout').textContent = formatDb(input);
    if (LGMDM.dom.byId('consoleCompReadout')) LGMDM.dom.byId('consoleCompReadout').textContent = `${ct.toFixed(1)} dB · ${cr.toFixed(1)}:1`;
    if (LGMDM.dom.byId('consoleStereoReadout')) LGMDM.dom.byId('consoleStereoReadout').textContent = `${Math.round(sw * 100)}%`;
    if (LGMDM.dom.byId('consoleLimiterControlReadout')) LGMDM.dom.byId('consoleLimiterControlReadout').textContent = `${ceilingDb(ceil).toFixed(1)} dB`;
    if (LGMDM.dom.byId('consoleInputGr')) LGMDM.dom.byId('consoleInputGr').textContent = formatDb(input);
    if (LGMDM.dom.byId('consoleStereoGr')) LGMDM.dom.byId('consoleStereoGr').textContent = `WIDTH ${Math.round(sw * 100)}%`;
    if (LGMDM.dom.byId('consoleLimiterReadout')) LGMDM.dom.byId('consoleLimiterReadout').textContent = `CEILING ${ceilingDb(ceil).toFixed(1)}`;
    if (LGMDM.dom.byId('consoleCompGr')) LGMDM.dom.byId('consoleCompGr').textContent = `GR 0.0 dB`;
  }

  function updateStageCards() {
    document.querySelectorAll('.lg-stage-card').forEach(card => {
      const stage = card.dataset.stage;
      card.classList.toggle('bypassed', !!state.stageBypass[stage]);
      const em = card.querySelector('em');
      if (em) em.textContent = state.stageBypass[stage] ? 'BYPASS' : 'ACTIVE';
    });
  }

  function setAB(mode) {
    state.ab = mode;
    LGMDM.dom.byId('consoleABReadout')?.replaceChildren(document.createTextNode(mode === 'master' ? 'MASTER' : 'ORIGINAL'));
    LGMDM.dom.byId('consoleABMaster')?.classList.toggle('active', mode === 'master');
    LGMDM.dom.byId('consoleABOriginal')?.classList.toggle('active', mode === 'original');
    if (typeof window.LGMDM?.ab?.setMode === 'function') {
      try { window.LGMDM.ab.setMode(mode); return; } catch (_) {}
    }
    const audio = getPreviewAudio();
    if (audio) audio.dataset.abMode = mode;
  }

  function toggleAB() { setAB(state.ab === 'master' ? 'original' : 'master'); }

  function getPreviewAudio() {
    return document.querySelector('#previewAudioWrap audio, #mxrServerPreviewAudio');
  }
  function formatTime(sec) {
    if (!Number.isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function metricAmp(db, floor = -72) { return window.clamp01((Number(db ?? floor) - floor) / (0 - floor)); }

  const _spectrumHover = {
    active: false,
    x: 0,
    y: 0,
    cssW: 800,
    cssH: 200,
    bound: false,
  };

  function bindSpectrumHover(canvas) {
    if (_spectrumHover.bound || !canvas) return;
    _spectrumHover.bound = true;
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      _spectrumHover.active = true;
      _spectrumHover.x = e.clientX - rect.left;
      _spectrumHover.y = e.clientY - rect.top;
      _spectrumHover.cssW = rect.width || 800;
      _spectrumHover.cssH = rect.height || 200;
    });
    canvas.addEventListener('mouseleave', () => {
      _spectrumHover.active = false;
    });
  }

  function drawWaveform() {
    const canvas = LGMDM.dom.byId('lgmdmWaveformCanvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr)), h = Math.max(120, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);

    // Millimeter oscilloscope grid
    ctx.strokeStyle = 'rgba(116,230,255,0.06)'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) {
      const y = (h / 8) * i;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }
    for (let j = 1; j < 12; j++) {
      const x = (w / 12) * j;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    const m = state.metrics || {};
    const peakAmp = metricAmp(m.peak_db, -72);
    const rmsAmp = metricAmp(m.rms_db, -72);
    const gr = Math.max(0, Math.min(1, Math.abs(Number(m.comp_gr_db ?? 0)) / 12));
    state.waveHistory.push({ peak: peakAmp, rms: rmsAmp, gr });
    if (state.waveHistory.length > 90) state.waveHistory.shift();
    const hist = state.waveHistory;
    const mid = h / 2;

    const isIdle = peakAmp < 0.02 && rmsAmp < 0.02;

    if (isIdle) {
      // Ambient phosphorescent radar pulse in idle
      const phase = (performance.now() - state.start) / 1000;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)';
      ctx.lineWidth = Math.max(1, 1.2 * dpr);
      for (let i = 0; i < 180; i++) {
        const t = i / 179;
        const x = t * w;
        const ripple = Math.sin(t * 14 - phase * 1.5) * Math.sin(t * Math.PI) * (8 * dpr);
        const y = mid + ripple;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Center idle indicator badge
      ctx.fillStyle = 'rgba(116, 230, 255, 0.45)';
      ctx.font = `${Math.round(9 * dpr)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('SIGNAL SCOPE · ENGINE READY', w / 2, mid - 14 * dpr);
      ctx.textAlign = 'start';
      return;
    }

    // Active Waveform Envelope with Under-curve Glow Fill
    const gradFill = ctx.createLinearGradient(0, 0, 0, h);
    gradFill.addColorStop(0, 'rgba(0, 229, 255, 0.18)');
    gradFill.addColorStop(0.5, 'rgba(169, 140, 255, 0.06)');
    gradFill.addColorStop(1, 'rgba(0, 229, 255, 0.18)');

    ctx.beginPath();
    const phase = (performance.now() - state.start) / 500;
    const topPoints = [];
    const botPoints = [];
    for (let i = 0; i < 220; i++) {
      const t = i / 219, idx = Math.min(hist.length - 1, Math.floor(t * (hist.length - 1)));
      const item = hist[idx] || { peak: peakAmp, rms: rmsAmp, gr: 0 };
      const env = Math.max(0.04, item.rms * 0.75 + item.peak * 0.25);
      const texture = 0.45 * Math.sin(t * 34 + phase) + 0.2 * Math.sin(t * 87 - phase * 0.6) + 0.12 * Math.sin(t * 13 + phase * 0.3);
      const yTop = mid - texture * env * h * 0.42;
      const yBot = mid + texture * env * h * 0.42;
      topPoints.push({ x: t * w, y: yTop });
      botPoints.push({ x: t * w, y: yBot });
    }

    // Fill area between top and bottom
    ctx.moveTo(topPoints[0].x, topPoints[0].y);
    topPoints.forEach(p => ctx.lineTo(p.x, p.y));
    for (let j = botPoints.length - 1; j >= 0; j--) {
      ctx.lineTo(botPoints[j].x, botPoints[j].y);
    }
    ctx.closePath();
    ctx.fillStyle = gradFill;
    ctx.fill();

    // Top waveform line with neon stroke
    const gradStroke = ctx.createLinearGradient(0, 0, w, 0);
    gradStroke.addColorStop(0, 'rgba(0, 229, 255, 0.4)');
    gradStroke.addColorStop(0.5, 'rgba(176, 38, 255, 0.95)');
    gradStroke.addColorStop(1, 'rgba(0, 229, 255, 0.4)');

    ctx.beginPath();
    ctx.strokeStyle = gradStroke;
    ctx.lineWidth = Math.max(1, 1.5 * dpr);
    topPoints.forEach((p, idx) => {
      idx === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();

    // Dynamic RMS envelope line
    ctx.beginPath();
    hist.forEach((item, i) => {
      const x = hist.length === 1 ? 0 : (i / (hist.length - 1)) * w;
      const y = mid - item.rms * h * 0.38;
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = 'rgba(255, 202, 101, 0.85)';
    ctx.lineWidth = Math.max(1, 1.2 * dpr);
    ctx.stroke();
  }

  function drawConsoleSpectrum() {
    const canvas = LGMDM.dom.byId('lgmdmConsoleSpectrum'); if (!canvas) return;
    bindSpectrumHover(canvas);

    const m = state.metrics || {};
    const s28 = Array.isArray(m.spectrum_bands_db) ? m.spectrum_bands_db : null;
    const fftMags = Array.isArray(m.fft_spectrum?.magnitudes_db) ? m.fft_spectrum.magnitudes_db : null;
    const s7 = (m.spectrum && typeof m.spectrum === 'object') ? m.spectrum : null;
    const sArr = Array.isArray(m.spectrum) ? m.spectrum : null;

    let bands = null; let edges = null;
    if (s28 && s28.length > 0 && typeof s28[0] === 'object' && 'db' in s28[0]) {
      bands = s28.map((b) => Number(b.db));
      edges = [s28[0].freq_hz * 0.9, ...s28.map((b) => Number(b.freq_hz))];
    } else if (fftMags) {
      bands = fftMags.map((v) => Number(v));
    } else if (sArr && sArr.length >= 6) {
      bands = sArr.map(Number);
      edges = [20, 60, 250, 800, 3000, 8000, 20000];
    } else if (s7) {
      const order = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air'];
      bands = order.map((k) => Number(s7[k])).filter(Number.isFinite);
      edges = [20, 80, 250, 500, 2000, 4000, 8000, 20000];
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr)), h = Math.max(120, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, w, h);

    const minDb = -90, maxDb = 0;

    // 1) Horizontal dB grid lines
    ctx.strokeStyle = 'rgba(116, 230, 255, 0.07)';
    ctx.lineWidth = 1;
    ctx.fillStyle = 'rgba(155, 166, 196, 0.38)';
    ctx.font = `${Math.round(9 * dpr)}px monospace`;
    [-12, -24, -36, -48, -60, -72].forEach((dbVal) => {
      const y = ((maxDb - dbVal) / (maxDb - minDb)) * h;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      ctx.fillText(`${dbVal}`, 4 * dpr, y - 2 * dpr);
    });

    // 2) Logarithmic vertical frequency gridlines
    const freqMarkers = [50, 100, 250, 500, 1000, 2500, 5000, 10000, 20000];
    freqMarkers.forEach((f) => {
      const logF = Math.log10(f);
      const x = ((logF - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    });

    // If idle: render ambient phosphorescent baseline
    if (!bands || bands.length === 0) {
      const phase = (performance.now() - state.start) / 1400;
      ctx.beginPath();
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.28)';
      ctx.lineWidth = Math.max(1, 1.2 * dpr);
      const yBase = h * 0.88;
      for (let i = 0; i < 180; i++) {
        const t = i / 179;
        const x = t * w;
        const y = yBase + Math.sin(t * 16 + phase) * (3 * dpr);
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.stroke();

      // Ambient center text
      ctx.fillStyle = 'rgba(116, 230, 255, 0.45)';
      ctx.font = `${Math.round(9 * dpr)}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('SPECTRUM ANALYZER · ENGINE READY', w / 2, h * 0.48);
      ctx.textAlign = 'start';
    } else {
      // Audio active: render smooth continuous curve + translucent neon fill
      const N = bands.length;
      const xForBand = (i) => {
        const lo = edges && edges[i] != null ? edges[i] : Math.pow(10, Math.log10(20) + (i / N) * (Math.log10(20000) - Math.log10(20)));
        const hi = edges && edges[i + 1] != null ? edges[i + 1] : Math.pow(10, Math.log10(20) + ((i + 1) / N) * (Math.log10(20000) - Math.log10(20)));
        const logLo = Math.log10(Math.max(20, lo)), logHi = Math.log10(Math.max(20, hi));
        const xLo = ((logLo - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
        const xHi = ((logHi - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
        return [xLo, xHi];
      };

      const pts = [];
      for (let i = 0; i < N; i++) {
        const v = Number(bands[i]);
        const [xLo, xHi] = xForBand(i);
        const barH = Number.isFinite(v) ? Math.max(3, ((v - minDb) / (maxDb - minDb)) * h) : 3;
        const xCenter = (xLo + xHi) / 2;
        const y = h - barH;
        pts.push({ x: xCenter, y, v, barH, xLo, xHi });
      }

      // Draw subtle background bars
      for (const p of pts) {
        const barW = Math.max(2, (p.xHi - p.xLo) * 0.82);
        const gradBar = ctx.createLinearGradient(0, p.y, 0, h);
        gradBar.addColorStop(0, 'rgba(0, 229, 255, 0.45)');
        gradBar.addColorStop(1, 'rgba(116, 230, 255, 0.08)');
        ctx.fillStyle = gradBar;
        ctx.fillRect(p.x - barW / 2, p.y, barW, p.barH);
      }

      // Draw continuous filled curve
      if (pts.length > 1) {
        const curveGrad = ctx.createLinearGradient(0, 0, 0, h);
        curveGrad.addColorStop(0, 'rgba(0, 229, 255, 0.4)');
        curveGrad.addColorStop(0.5, 'rgba(176, 38, 255, 0.2)');
        curveGrad.addColorStop(1, 'rgba(10, 15, 30, 0.02)');

        ctx.beginPath();
        ctx.moveTo(pts[0].xLo, h);
        ctx.lineTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const midX = (prev.x + curr.x) / 2;
          const midY = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.lineTo(last.xHi, h);
        ctx.closePath();
        ctx.fillStyle = curveGrad;
        ctx.fill();

        // Glowing top stroke
        ctx.beginPath();
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) {
          const prev = pts[i - 1];
          const curr = pts[i];
          const midX = (prev.x + curr.x) / 2;
          const midY = (prev.y + curr.y) / 2;
          ctx.quadraticCurveTo(prev.x, prev.y, midX, midY);
        }
        ctx.lineTo(last.x, last.y);
        ctx.strokeStyle = '#00e5ff';
        ctx.lineWidth = Math.max(1.5, 2 * dpr);
        ctx.stroke();

        // Peak dots
        ctx.fillStyle = '#ffffff';
        pts.forEach((p) => {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2 * dpr, 0, Math.PI * 2);
          ctx.fill();
        });
      }
    }

    // 3) Interactive Hover Crosshair HUD (FabFilter-style)
    if (_spectrumHover.active) {
      const hx = Math.max(0, Math.min(w, _spectrumHover.x * dpr));
      const hy = Math.max(0, Math.min(h, _spectrumHover.y * dpr));
      const fracX = Math.max(0, Math.min(1, _spectrumHover.x / _spectrumHover.cssW));
      const freqHz = Math.round(Math.pow(10, Math.log10(20) + fracX * (Math.log10(20000) - Math.log10(20))));
      const fracY = Math.max(0, Math.min(1, _spectrumHover.y / _spectrumHover.cssH));
      const dbVal = Math.round((maxDb - fracY * (maxDb - minDb)) * 10) / 10;

      // Crosshair lines
      ctx.save();
      ctx.setLineDash([4 * dpr, 4 * dpr]);
      ctx.strokeStyle = 'rgba(0, 229, 255, 0.75)';
      ctx.lineWidth = 1 * dpr;

      // Vertical line
      ctx.beginPath(); ctx.moveTo(hx, 0); ctx.lineTo(hx, h); ctx.stroke();
      // Horizontal line
      ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(w, hy); ctx.stroke();
      ctx.restore();

      // Floating readout pill tag
      const freqLabel = freqHz >= 1000 ? `${(freqHz / 1000).toFixed(2)} kHz` : `${freqHz} Hz`;
      const dbLabel = `${dbVal > 0 ? '+' : ''}${dbVal.toFixed(1)} dBFS`;
      const tagText = `${freqLabel}  ·  ${dbLabel}`;

      ctx.font = `bold ${Math.round(10 * dpr)}px monospace`;
      const txtWidth = ctx.measureText(tagText).width;
      const pillW = txtWidth + 16 * dpr;
      const pillH = 22 * dpr;
      let pillX = hx + 12 * dpr;
      let pillY = hy - pillH - 6 * dpr;
      if (pillX + pillW > w - 8) pillX = hx - pillW - 12 * dpr;
      if (pillY < 8) pillY = hy + 12 * dpr;

      // Pill background
      ctx.fillStyle = 'rgba(8, 12, 24, 0.94)';
      ctx.strokeStyle = '#00e5ff';
      ctx.lineWidth = 1 * dpr;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(pillX, pillY, pillW, pillH, 4 * dpr) : ctx.rect(pillX, pillY, pillW, pillH);
      ctx.fill();
      ctx.stroke();

      // Pill text
      ctx.fillStyle = '#00e5ff';
      ctx.textAlign = 'center';
      ctx.fillText(tagText, pillX + pillW / 2, pillY + pillH * 0.68);
      ctx.textAlign = 'start';
    }
  }

  function updateConsoleStereoVu() {
    const l = LGMDM.dom.byId('consoleMeterL'), r = LGMDM.dom.byId('consoleMeterR'); if(!l || !r) return;
    const m=state.metrics||{}; const peak=metricAmp(m.peak_db,-60); const corr=Math.max(-1,Math.min(1,Number(m.stereo_correlation ?? 1)));
    const spread=(1-Math.max(0,corr))*0.18;
    l.style.height=`${Math.max(3,Math.min(100,(peak*(1+spread))*100))}%`;
    r.style.height=`${Math.max(3,Math.min(100,(peak*(1-spread))*100))}%`;
    l.style.opacity = corr < 0 ? '1' : '.92'; r.style.opacity = corr < 0 ? '1' : '.92';
  }

  function setStatus(text, active=false) { LGMDM.dom.byId('consoleStatus')?.replaceChildren(document.createTextNode(text)); document.querySelector('.lg-status-dot')?.classList.toggle('active',active); }
  function syncTrackInfo() {
    const file = LGMDM.state?.selectedFile ?? null;
    if(!file){
      LGMDM.dom.byId('consoleTrackTitle')?.replaceChildren(document.createTextNode('Sin archivo cargado'));
      LGMDM.dom.byId('consoleTrackMeta')?.replaceChildren(document.createTextNode('Esperando señal'));
      return;
    }
    const title=file.name.replace(/\.[^/.]+$/,'');
    LGMDM.dom.byId('consoleTrackTitle')?.replaceChildren(document.createTextNode(title));
    LGMDM.dom.byId('consoleTrackMeta')?.replaceChildren(document.createTextNode(`${file.type||'audio'} · ${(file.size/1024/1024).toFixed(1)} MB`));
    setStatus('Audio cargado · listo para analizar',true);
  }
  // Re-entry guard (MX-13) para syncChainMeters desde el bus de métricas LGMDM.metrics.
  let _metersSyncInFlight = false;
  let _metersSyncPending = false;
  let _lastMetrics = null;

  function updateConsoleMetrics(metrics) {
    if (!metrics) return;
    state.metrics = metrics;
    const peak = Number(metrics.peak_db);
    const rms = Number(metrics.rms_db);
    const lufs = Number(metrics.lufs_momentary ?? metrics.lufs);
    const truePeak = Number(metrics.true_peak_db);
    const corr = Number(metrics.stereo_correlation);

    const pEl = LGMDM.dom.byId('consolePeak');
    if (pEl && Number.isFinite(peak)) pEl.textContent = `${peak.toFixed(1)} dB`;

    const lEl = LGMDM.dom.byId('consoleLufs');
    if (lEl && Number.isFinite(lufs)) lEl.textContent = `${lufs.toFixed(1)} LUFS`;

    const tpEl = LGMDM.dom.byId('consoleTruePeak');
    if (tpEl && Number.isFinite(truePeak)) tpEl.textContent = `${truePeak.toFixed(1)} dBTP`;

    const rEl = LGMDM.dom.byId('consoleRms');
    if (rEl && Number.isFinite(rms)) rEl.textContent = `${rms.toFixed(1)} dB`;

    const cEl = LGMDM.dom.byId('consoleCorr');
    if (cEl && Number.isFinite(corr)) cEl.textContent = `${corr.toFixed(2)}`;

    updateConsoleStereoVu();
    syncChainMeters(metrics);
    window.LGMDM?.visualSuite?.updateMetrics?.(metrics);
  }

  function syncChainMeters(metrics){
    if (metrics) _lastMetrics = metrics;
    if (_metersSyncInFlight) { _metersSyncPending = true; return; }
    _metersSyncInFlight = true;
    try {
      if (!_lastMetrics) return;
      const chain = _lastMetrics.chain_meters || _lastMetrics.chainMeters || {};
      const comp = chain.comp || _lastMetrics.comp_meters || {};
      const glue = chain.glue || _lastMetrics.glue_meters || {};
      const limiter = chain.limiter || _lastMetrics.limiter_meters || {};
      const compGr = Number(comp.gr_db ?? _lastMetrics.comp_gr_db ?? 0);
      const glueGr = Number(glue.gr_db ?? 0);
      const limGr = Number(limiter.gr_db ?? _lastMetrics.limiter_gr_db ?? 0);
      if (LGMDM.dom.byId('consoleCompGr')) LGMDM.dom.byId('consoleCompGr').textContent = `GR ${(Number.isFinite(compGr)?compGr:0).toFixed(1)} dB`;
      if (LGMDM.dom.byId('consoleLimiterGr')) LGMDM.dom.byId('consoleLimiterGr').textContent = `GR ${(Number.isFinite(limGr)?limGr:0).toFixed(1)} dB`;
      const glueReadout = LGMDM.dom.byId('consoleGlueGr'); if (glueReadout) glueReadout.textContent = `GR ${(Number.isFinite(glueGr)?glueGr:0).toFixed(1)} dB`;
      if (LGMDM.dom.byId('consoleOutputReadout')) LGMDM.dom.byId('consoleOutputReadout').textContent = _lastMetrics.output_lufs != null ? `${Number(_lastMetrics.output_lufs).toFixed(1)} LUFS` : (LGMDM.dom.byId('consoleLufs')?.textContent || '-∞ LUFS');
    } finally {
      _metersSyncInFlight = false;
      if (_metersSyncPending) {
        _metersSyncPending = false;
        queueMicrotask(() => syncChainMeters(null));
      }
    }
  }

  root.console.syncChainMeters = syncChainMeters;

        function scheduleConsolePreview(){
    if (state.applying) return;
    clearTimeout(root.console.previewTimer);
    root.console.previewTimer = setTimeout(() => {
      window.LGMDM?.previewController?.request?.();
    }, 350);
  }

  let wired = false;
  function wire(){
    if (wired) return;
    wired = true;
    mirror(...refs.input); mirror(...refs.compThreshold); mirror(...refs.compRatio); mirror(...refs.stereo); mirror(...refs.limiter);
    // F5.5 — ResizeObserver DPR-aware para waveform canvas.
    const _waveformCanvas = LGMDM.dom.byId('lgmdmWaveformCanvas');
    if (_waveformCanvas && typeof window.setupCanvasResize === 'function') {
      state._waveformCleanup = window.setupCanvasResize(_waveformCanvas, () => drawWaveform());
    }
    LGMDM.dom.byId('consoleAnalyzeBtn')?.addEventListener('click',()=>{LGMDM.dom.byId('btnAnalyze')?.click();setStatus('Analizando audio…',true);});
    LGMDM.dom.byId('consoleMasterBtn')?.addEventListener('click',()=>{LGMDM.dom.byId('btnMasterAsync')?.click();setStatus('Mastering en cola…',true);});
    LGMDM.dom.byId('consolePlayBtn')?.addEventListener('click',()=>{
      const audio=getPreviewAudio();
      if(!audio || !window.LGMDM?.previewController?.isReady?.()) {
        return setStatus('El Preview todavía no está listo: debe terminar el procesamiento del servidor.');
      }
      const pb = LGMDM.dom.byId('consolePlayBtn');
      if(audio.paused){
        window.LGMDM?.playback?.stopAll?.(audio);
        audio.play().catch((e)=>setStatus('No se pudo reproducir el Preview: '+e.message));
        pb.textContent='❚❚';pb.setAttribute('aria-pressed','true');state.playing=true;state.start=performance.now();setStatus('Preview reproduciendo',true);
      }else{
        audio.pause();pb.textContent='▶';pb.setAttribute('aria-pressed','false');state.playing=false;setStatus('Preview en pausa');
      }
    });
    LGMDM.dom.byId('consoleStopBtn')?.addEventListener('click',()=>{
      window.LGMDM?.playback?.stopAll?.();
      const audio=getPreviewAudio();if(audio){audio.pause();audio.currentTime=0;}
      window.LGMDM?.previewController?.stop?.();
      state.playing=false;LGMDM.dom.byId('consolePlayBtn').textContent='▶';setStatus('Preview detenido');
    });
    const livePreviewToggle = LGMDM.dom.byId('s-livepreview');
    if (livePreviewToggle) {
      const bind = window.LGMDM.ui.bindOnce;
      bind(livePreviewToggle, 'change', (ev) => {
        if (ev && ev.isTrusted === false) return;
        if (livePreviewToggle.checked && LGMDM.state?.selectedFile) {
          setStatus('Preview habilitado · procesando en servidor…', true);
          window.LGMDM?.previewController?.request?.();
        } else if (!livePreviewToggle.checked) {
          window.LGMDM?.previewController?.stop?.();
          setStatus('Preview deshabilitado');
        }
      }, 'server-preview-toggle-console');
    }
        LGMDM.dom.byId('consoleABMaster')?.addEventListener('click',()=>setAB('master')); LGMDM.dom.byId('consoleABOriginal')?.addEventListener('click',()=>setAB('original')); LGMDM.dom.byId('consoleABToggle')?.addEventListener('click',toggleAB);
    document.querySelectorAll('.lg-stage-card').forEach(btn=>btn.addEventListener('click',()=>toggleStage(btn.dataset.stage)));
    document.querySelectorAll('.lg-chain-node').forEach(btn=>btn.addEventListener('click',()=>document.querySelector(`.sidebar-tab[data-pane="${btn.dataset.pane}"]`)?.click()));
    LGMDM.dom.byId('consoleShowChain')?.addEventListener('click',()=>document.querySelector('.sidebar-tab[data-pane="pane-cadena"]')?.click());
    LGMDM.dom.byId('btnAnalyze')?.addEventListener('click',()=>setStatus('Analizando audio…',true)); LGMDM.dom.byId('btnMasterAsync')?.addEventListener('click',()=>setStatus('Mastering en cola…',true)); LGMDM.dom.byId('btnMasterSync')?.addEventListener('click',()=>setStatus('Mastering en proceso…',true));
    LGMDM.dom.byId('fileInput')?.addEventListener('change',syncTrackInfo);
    window.addEventListener('lgmdm:preview-state', (ev) => {
      const btn = LGMDM.dom.byId('consolePlayBtn');
      const detail = ev.detail || {};
      if (btn) btn.disabled = detail.state !== 'ready';
      if (detail.state === 'ready') setStatus('Preview completo listo para reproducir', true);
      else if (detail.state === 'processing') setStatus(detail.text || 'Procesando Preview en servidor…', true);
      else if (detail.state === 'disabled') setStatus(detail.text || 'Preview deshabilitado');
    });
    syncTrackInfo(); updateReadouts(); updateStageCards();
    const observer=new MutationObserver(syncTrackInfo); const fileName=LGMDM.dom.byId('fileName'); if(fileName)observer.observe(fileName,{childList:true,subtree:true,characterData:true});
    state._fileNameObserver = observer;
    const tick=()=>{
      if (!wired) return;
      if (window.LGMDM.utils.prefersReducedMotion()) {
        state.raf = 0;
        return;
      }
      const onConsole = (document.body.dataset.workspace || 'console') === "console";
      if(onConsole){ drawWaveform(); updateConsoleStereoVu(); drawConsoleSpectrum(); }
      state.audio=getPreviewAudio();
      const audio=state.audio;
      if (audio && onConsole) {
        LGMDM.dom.byId('consoleTime').textContent = formatTime(audio.currentTime);
        LGMDM.dom.byId('consoleDuration').textContent = formatTime(audio.duration);
        const ph = LGMDM.dom.byId('consolePlayhead');
        if (Number.isFinite(audio.duration) && audio.duration > 0 && ph) ph.style.left = `${audio.currentTime / audio.duration * 100}%`;
      }
      state.raf = requestAnimationFrame(tick);
    };
    state.raf=requestAnimationFrame(tick);
    // Consume the shared Metrics Store instead of wrapping another producer.
    const metricsStore = window.LGMDM?.metrics;
    if (metricsStore) {
      state.unsubscribeMetrics?.();
      state.unsubscribeMetrics = metricsStore.subscribe(({ metrics }) => {
        updateConsoleMetrics(metrics);
      });
    }
  }
  root.console.setStageBypass = (stage, bypass) => {
    if (!(stage in state.stageBypass)) throw new Error(`[Master Console] etapa desconocida: ${stage}`);
    state.stageBypass[stage] = Boolean(bypass);
    const related = {
      comp: ['s-thresh', 's-ratio'],
      stereo: ['s-width'],
      limiter: ['s-ceiling'],
    }[stage] || [];
    related.forEach((controlId) => {
      const el = LGMDM.dom.byId(controlId);
      if (!el) throw new Error(`[Master Console] falta control técnico #${controlId}`);
      if (state.stageBypass[stage]) {
        if (el.dataset.consoleSaved == null) el.dataset.consoleSaved = el.value;
        if (stage === 'comp') el.value = controlId === 's-ratio' ? '1' : '0';
        if (stage === 'stereo') el.value = '1';
        if (stage === 'limiter') el.value = '0.999';
      } else if (el.dataset.consoleSaved != null) {
        el.value = el.dataset.consoleSaved;
        delete el.dataset.consoleSaved;
      }
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    updateReadouts(); updateStageCards();
    scheduleConsolePreview();
  };
  root.console.getChainOverrides = () => ({
    comp_bypass: !!state.stageBypass.comp,
    stereo_bypass: !!state.stageBypass.stereo,
    limiter_bypass: !!state.stageBypass.limiter,
  });
  root.console.setAB=setAB; root.console.toggleAB=toggleAB; root.console.schedulePreview=scheduleConsolePreview;
  function teardown(){
    if(state.raf){ cancelAnimationFrame(state.raf); state.raf=0; }
    if(state._fileNameObserver){ state._fileNameObserver.disconnect(); state._fileNameObserver=null; }
    if(state._waveformCleanup){ state._waveformCleanup(); state._waveformCleanup=null; }
    wired=false;
  }
  root.console.teardown=teardown;
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',wire,{once:true});else wire();
})();
