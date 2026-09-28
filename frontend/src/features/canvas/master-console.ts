// master-console.ts — main mastering console. Port of dist/js/15-master-console.js.

import { audioTap } from '../../core/audio-tap';

// Bridge to the LGMDM global namespace.
// TODO(U-2): `lgmdm(): any` es la raíz `any` de este archivo; alimenta ~20
// accesos `(window.LGMDM as any)?.X` (ab, previewController, mixerEngine,
// mixer, reference, proFeatures.audioTap, visualizerRender, params, state, ui,
// utils, metrics, console). Migrar a un slice tipado cascada a todos esos
// usos y choca con el trabajo de allocs de Agent 3 (per-frame draw, ~líneas
// 250-450). Migración dedicada pendiente. Se migraron los 4 `as any`
// aislados fuera de la región de draw (líneas 136, 644, 795) abajo.
function lgmdm(): any {
  return window.LGMDM || (window.LGMDM = {} as any);
}

(() => {
  'use strict';
  const root: any = window.LGMDM = window.LGMDM || {};
  root.masterConsole = root.masterConsole || {};
  const LGMDM = root;
  const state: any = {
    raf: 0, start: performance.now(), playing: false, audio: null,
    ab: 'master', applying: false,
    stageBypass: { input: false, comp: false, stereo: false, limiter: false },
    metrics: null, spectrum: [],
    // W1: ring buffer pre-asignado (90 objetos fijos) — elimina push/shift
    // y el alloc por frame. El consumer itera en orden cronológico.
    waveHistory: (() => { const a: Array<{ peak: number; rms: number; gr: number }> = []; for (let i = 0; i < 90; i++) a.push({ peak: 0, rms: 0, gr: 0 }); return a; })(),
    waveHistoryWriteIdx: 0,
    waveHistoryLen: 0,
  };

  const refs = {
    input: ['s-ingain', 'consoleInputFader'],
    compThreshold: ['s-thresh', 'consoleCompThreshold'],
    compRatio: ['s-ratio', 'consoleCompRatio'],
    stereo: ['s-width', 'consoleStereoFader'],
    limiter: ['s-ceiling', 'consoleLimiterFader'],
  };

  function mirror(srcId: string, dstId: string) {
    const src = LGMDM.dom.byId(srcId) as HTMLInputElement | null, dst = LGMDM.dom.byId(dstId) as HTMLInputElement | null;
    if (!src || !dst) return;
    dst.value = src.value;
    const event: string = dst.tagName === 'SELECT' || dst.type === 'checkbox' ? 'change' : 'input';
    dst.addEventListener(event, () => {
      src.value = dst.value;
      src.dispatchEvent(new Event(event, { bubbles: true }));
      updateReadouts();
      updateStageCards();
    });
    src.addEventListener('input', () => { dst.value = src.value; updateReadouts(); });
    src.addEventListener('change', () => { dst.value = src.value; updateReadouts(); updateStageCards(); });
  }

    function formatDb(v: number | string): string { return `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(1)} dB`; }
  function ceilingDb(v: number | string): number { return 20 * Math.log10(Math.max(0.01, Number(v))); }

      function toggleStage(stage: 'input' | 'comp' | 'stereo' | 'limiter') {
    state.stageBypass[stage] = !state.stageBypass[stage];
    const relatedMap: Record<string, string[]> = {
      comp: ['s-thresh', 's-ratio'],
      stereo: ['s-width'],
      limiter: ['s-ceiling'],
    };
    const related = relatedMap[stage] || [];
    related.forEach((id: string) => {
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
    document.querySelectorAll('.lg-stage-card').forEach((card: Element) => {
      const stage = (card as HTMLElement).dataset.stage as keyof typeof state.stageBypass | undefined;
      if (!stage) return;
      card.classList.toggle('bypassed', !!state.stageBypass[stage]);
      const em = card.querySelector('em');
      if (em) em.textContent = state.stageBypass[stage] ? 'BYPASS' : 'ACTIVE';
    });
  }

  function setAB(mode: 'master' | 'original') {
    state.ab = mode;
    LGMDM.dom.byId('consoleABReadout')?.replaceChildren(document.createTextNode(mode === 'master' ? 'MASTER' : 'ORIGINAL'));
    LGMDM.dom.byId('consoleABMaster')?.classList.toggle('active', mode === 'master');
    LGMDM.dom.byId('consoleABOriginal')?.classList.toggle('active', mode === 'original');
    if (typeof (window.LGMDM as any)?.ab?.setMode === 'function') {
      try { (window.LGMDM as any).ab.setMode(mode); return; } catch (_) {}
    }
    const audio = getPreviewAudio();
    if (audio) audio.dataset.abMode = mode;
  }

  function toggleAB() { setAB(state.ab === 'master' ? 'original' : 'master'); }

  function getPreviewAudio(): HTMLAudioElement | null {
    return document.querySelector('#previewAudioWrap audio, #mxrServerPreviewAudio') as HTMLAudioElement | null;
  }

  function stopAllPlayback() {
    document.querySelectorAll('#previewAudioWrap audio, #mxrServerPreviewAudio').forEach((a) => {
      try { (a as HTMLAudioElement).pause(); (a as HTMLAudioElement).currentTime = 0; } catch (_) {}
    });
    (window.LGMDM as any)?.previewController?.stop?.();
    // FIX C2: mixer.stopPreview doesn't exist (it's on mixerEngine or mixer.functions).
    (window.LGMDM as any)?.mixerEngine?.stopPreview?.(true);
    (window.LGMDM as any)?.mixer?.functions?.stopPreview?.(true);
    // FIX C2: ab.stop doesn't exist — use the global stopABPlayer or ab.teardown.
    if (typeof (window as any).stopABPlayer === 'function') (window as any).stopABPlayer();
    (window.LGMDM as any)?.ab?.stop?.();
    (window.LGMDM as any)?.reference?.stopRefPreview?.();
  }
  function formatTime(sec: number): string {
    if (!Number.isFinite(sec)) return '--:--';
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function metricAmp(db: number | null | undefined, floor: number = -72): number { return window.clamp01((Number(db ?? floor) - floor) / (0 - floor)); }

  function ensureScopeTap(): any {
    const tapApi = (window.LGMDM as any)?.proFeatures?.audioTap;
    if (!tapApi?.ensure) return null;
    try { return tapApi.ensure(); } catch (_) { return null; }
  }

  function isSignalPlaying(): boolean {
    const a = (state.audio || getPreviewAudio()) as HTMLAudioElement | null;
    return !!(a && !a.paused && !a.ended);
  }

  function drawIdleWaveform(ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, label: string) {
    ctx.fillStyle = 'rgba(116,230,255,.28)';
    ctx.font = `${Math.max(10, 11 * dpr)}px ${getComputedStyle(document.documentElement).getPropertyValue('--ui-font-mono') || 'monospace'}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.strokeStyle = 'rgba(116,230,255,.18)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  function drawWaveform() {
    const canvas = LGMDM.dom.byId('lgmdmWaveformCanvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr)), h = Math.max(120, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    // FIX M11: reset the transform so we operate in device pixels (setupCanvasResize
    // may have left a dpr-scale transform that would double our drawing).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = 'rgba(116,230,255,.09)'; ctx.lineWidth = 1;
    for (let i = 1; i < 8; i++) { const y = h / 8 * i; ctx.beginPath(); ctx.moveTo(0,y); ctx.lineTo(w,y); ctx.stroke(); }
    const mid = h / 2;
    const playing = isSignalPlaying();
    const tap = playing ? ensureScopeTap() : null;
    const analyser = tap?.analyserWaterfall || null;
    if (!playing || !analyser) {
      drawIdleWaveform(ctx, w, h, dpr, 'Sin señal — reproducí el Preview');
      return;
    }
    if (!state.timeBuf || state.timeBuf.length !== analyser.fftSize) {
      state.timeBuf = new Float32Array(analyser.fftSize);
    }
    try { analyser.getFloatTimeDomainData(state.timeBuf); } catch (_) {
      drawIdleWaveform(ctx, w, h, dpr, 'Sin señal — reproducí el Preview');
      return;
    }
    const buf = state.timeBuf;
    const n = buf.length;
    // Envelope history from real peak/rms metrics (for the amber RMS trail)
    const m = state.metrics || {};
    const peakAmp = metricAmp(m.peak_db, -72);
    const rmsAmp = metricAmp(m.rms_db, -72);
    // W1: escribe en el slot del ring (objeto fijo, muta in-place — cero alloc).
    {
      const wi = state.waveHistoryWriteIdx;
      const wh = state.waveHistory[wi] as { peak: number; rms: number; gr: number };
      wh.peak = peakAmp;
      wh.rms = rmsAmp;
      wh.gr = Math.max(0, Math.min(1, Math.abs(Number(m.comp_gr_db ?? 0)) / 12));
      state.waveHistoryWriteIdx = (wi + 1) % 90;
      if (state.waveHistoryLen < 90) state.waveHistoryLen++;
    }
    const grad = ctx.createLinearGradient(0,0,w,0);
    grad.addColorStop(0,'rgba(87,230,255,.35)'); grad.addColorStop(.5,'rgba(169,140,255,.95)'); grad.addColorStop(1,'rgba(87,230,255,.35)');
    ctx.strokeStyle = grad; ctx.lineWidth = Math.max(1, 1.4 * dpr);
    ctx.beginPath();
    const step = Math.max(1, Math.floor(n / w));
    for (let x = 0; x < w; x++) {
      const i = Math.min(n - 1, x * step);
      const v = Math.max(-1, Math.min(1, buf[i]));
      const y = mid - v * (h * 0.42);
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.stroke();
    // Mirror half (filled envelope from |sample|)
    ctx.beginPath();
    for (let x = 0; x < w; x++) {
      const i = Math.min(n - 1, x * step);
      const a = Math.abs(buf[i]);
      const y = mid + a * (h * 0.42);
      x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    }
    ctx.strokeStyle = 'rgba(87,230,255,.28)'; ctx.lineWidth = Math.max(1, 1 * dpr); ctx.stroke();
    // Amber RMS history trail (real metrics, not fake texture)
    // W1: itera el ring en orden cronológico (oldest→newest). Si el ring
    // está lleno (90), el oldest está en writeIdx; sino, en 0..len-1.
    const hlen = state.waveHistoryLen;
    if (hlen > 1) {
      const start = (hlen === 90) ? state.waveHistoryWriteIdx : 0;
      const ring = state.waveHistory;
      ctx.beginPath();
      for (let i = 0; i < hlen; i++) {
        const item = ring[(start + i) % 90] as { peak: number; rms: number; gr: number };
        const x = i / (hlen - 1) * w;
        const y = mid - item.rms * h * 0.36;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.strokeStyle = 'rgba(255,202,101,.85)'; ctx.lineWidth = Math.max(1, 1 * dpr); ctx.stroke();
    }
  }

  function drawWaterfall() {
    const canvas = LGMDM.dom.byId('lgmdmWaterfallCanvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect(); const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr)), h = Math.max(80, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const playing = isSignalPlaying();
    const tap = playing ? ensureScopeTap() : null;
    const an = tap?.analyserWaterfall;
    if (!playing || !an) {
      ctx.fillStyle = '#070c24';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(116,230,255,.35)';
      ctx.font = `${Math.max(9, 10 * dpr)}px monospace`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('Sin señal', w / 2, h / 2);
      return;
    }
    if (!state.wfBuf || state.wfBuf.length !== an.frequencyBinCount) {
      state.wfBuf = new Uint8Array(an.frequencyBinCount);
    }
    try { an.getByteFrequencyData(state.wfBuf); } catch (_) { return; }
    const vr = (window.LGMDM as any)?.visualizerRender;
    if (vr?.drawWaterfallFrame) {
      vr.drawWaterfallFrame(canvas, ctx, state.wfBuf);
      return;
    }
    const img = ctx.getImageData(0, 0, w, h);
    ctx.putImageData(img, 0, 1);
    const bins = state.wfBuf.length;
    for (let x = 0; x < w; x++) {
      const binIdx = Math.min(bins - 1, Math.floor(Math.pow(x / w, 1.5) * (bins - 1)));
      const mag = state.wfBuf[binIdx] / 255;
      const r = Math.min(255, mag * 320) | 0;
      const g = Math.min(255, mag * 220) | 0;
      const b = Math.min(255, 40 + mag * 180) | 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, 0, 1, 1);
    }
  }

  // U-1: reusable filters array — `.length = 0` per call instead of `[]`,
  // eliminating per-frame array alloc on the EQ response hot path.
  const _eqFilters: Array<{ kind: string; freq: number; gain: number; Q: number }> = [];

  // EQ Chain Response — cascada de 10 biquads: 6 peak + LS + HS + HP + LP.
  // Usa RBJ Audio EQ Cookbook. Multiplica magnitudes, devuelve dB por bin.
  // FIX: usa `wCut` (cutoff) para los coeficientes del biquad y `w` (eval)
  // para evaluar la respuesta — antes los dos usaban la misma variable.
  function computeEqChainResponse(params: Record<string, unknown>, freqs: Float32Array, fs: number): Float32Array {
    const N = freqs.length;
    // U-1: length-guarded reuse (mirrors state.timeBuf pattern at L183-184).
    if (!state.dbOut || state.dbOut.length !== N) state.dbOut = new Float32Array(N);
    const dbOut = state.dbOut;
    function magnitudeAt(f: number, type: { kind: string; freq: number; gain: number; Q: number }): number {
      let b0 = 0, b1 = 0, b2 = 0, a0 = 0, a1 = 0, a2 = 0;
      // Coeficientes: usan la frecuencia de CORTE del filtro (type.freq)
      const wCut = 2 * Math.PI * type.freq / fs;
      const cwCut = Math.cos(wCut), swCut = Math.sin(wCut);
      // Respuesta: usa la frecuencia de EVALUACIÓN (f)
      const w = 2 * Math.PI * f / fs;
      const cw = Math.cos(w), sw = Math.sin(w);
      const A = Math.pow(10, type.gain / 40);
      const alpha = type.Q ? (swCut / (2 * type.Q)) : 0;
      if (type.kind === 'peak') {
        b0 = 1 + alpha * A; b1 = -2 * cwCut; b2 = 1 - alpha * A;
        a0 = 1 + alpha / A; a1 = -2 * cwCut; a2 = 1 - alpha / A;
      } else if (type.kind === 'lowshelf') {
        const sqA = Math.sqrt(A);
        b0 = A * ((A + 1) - (A - 1) * cwCut + 2 * sqA * alpha);
        b1 = 2 * A * ((A - 1) - (A + 1) * cwCut);
        b2 = A * ((A + 1) - (A - 1) * cwCut - 2 * sqA * alpha);
        a0 = (A + 1) + (A - 1) * cwCut + 2 * sqA * alpha;
        a1 = -2 * ((A - 1) + (A + 1) * cwCut);
        a2 = (A + 1) + (A - 1) * cwCut - 2 * sqA * alpha;
      } else if (type.kind === 'highshelf') {
        const sqA = Math.sqrt(A);
        b0 = A * ((A + 1) + (A - 1) * cwCut + 2 * sqA * alpha);
        b1 = -2 * A * ((A - 1) + (A + 1) * cwCut);
        b2 = A * ((A + 1) + (A - 1) * cwCut - 2 * sqA * alpha);
        a0 = (A + 1) - (A - 1) * cwCut + 2 * sqA * alpha;
        a1 = 2 * ((A - 1) - (A + 1) * cwCut);
        a2 = (A + 1) - (A - 1) * cwCut - 2 * sqA * alpha;
      } else if (type.kind === 'lpf') {
        b0 = (1 - cwCut) / 2; b1 = 1 - cwCut; b2 = (1 - cwCut) / 2;
        a0 = 1 + alpha; a1 = -2 * cwCut; a2 = 1 - alpha;
      } else if (type.kind === 'hpf') {
        b0 = (1 + cwCut) / 2; b1 = -(1 + cwCut); b2 = (1 + cwCut) / 2;
        a0 = 1 + alpha; a1 = -2 * cwCut; a2 = 1 - alpha;
      }
      if (!Number.isFinite(a0) || a0 === 0) return 1;
      b0 /= a0; b1 /= a0; b2 /= a0; a1 /= a0; a2 /= a0;
      // |H(e^jw)| = |b0 + b1·e^-jw + b2·e^-j2w| / |1 + a1·e^-jw + a2·e^-j2w|
      const cos2w = Math.cos(2 * w), sin2w = Math.sin(2 * w);
      const numRe = b0 + b1 * cw + b2 * cos2w;
      const numIm = -b1 * sw - b2 * sin2w;
      const denRe = 1 + a1 * cw + a2 * cos2w;
      const denIm = -a1 * sw - a2 * sin2w;
      const numMag = Math.sqrt(numRe * numRe + numIm * numIm);
      const denMag = Math.sqrt(denRe * denRe + denIm * denIm);
      if (denMag < 1e-12 || !Number.isFinite(numMag) || !Number.isFinite(denMag)) return 1;
      return numMag / denMag;
    }
    _eqFilters.length = 0;
    const numF = (v: unknown, fb: number): number => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : fb; };
    const hpF = numF(params.hp_cutoff, 0);
    if (hpF >= 20 && hpF <= 20000) _eqFilters.push({ kind: 'hpf', freq: hpF, gain: 0, Q: 0.707 });
    for (let i = 1; i <= 6; i++) {
      const f = numF(params[`eq${i}_freq`], 0);
      const g = numF(params[`eq${i}_gain`], 0);
      const q = numF(params[`eq${i}_q`], 1);
      if (f >= 20 && f <= 20000 && Math.abs(g) > 0.01) {
        _eqFilters.push({ kind: 'peak', freq: f, gain: g, Q: Math.max(0.1, q) });
      }
    }
    const lsF = numF(params.low_shelf_freq_hz, 0);
    const lsG = numF(params.low_shelf_gain_db, 0);
    if (lsF >= 20 && lsF <= 20000 && Math.abs(lsG) > 0.01) {
      _eqFilters.push({ kind: 'lowshelf', freq: lsF, gain: lsG, Q: 0.707 });
    }
    const hsF = numF(params.high_shelf_freq_hz, 0);
    const hsG = numF(params.high_shelf_gain_db, 0);
    if (hsF >= 20 && hsF <= 20000 && Math.abs(hsG) > 0.01) {
      _eqFilters.push({ kind: 'highshelf', freq: hsF, gain: hsG, Q: 0.707 });
    }
    const lpF = numF(params.lp_cutoff, 0);
    const lpBypass = params.lp_bypass === true || params.lp_bypass === 'true';
    if (!lpBypass && lpF >= 20 && lpF <= 20000) {
      _eqFilters.push({ kind: 'lpf', freq: lpF, gain: 0, Q: 0.707 });
    }
    // Compute dB per freq bin (clamp a [-60, +60] para evitar log10(0))
    for (let i = 0; i < N; i++) {
      let H = 1;
      for (let j = 0; j < _eqFilters.length; j++) {
        H *= magnitudeAt(freqs[i], _eqFilters[j]);
      }
      let db = 20 * Math.log10(Math.max(1e-6, H));
      if (!Number.isFinite(db)) db = 0;
      dbOut[i] = Math.max(-60, Math.min(60, db));
    }
    return dbOut;
  }

  function drawEqChainResponse() {
    const canvas = LGMDM.dom.byId('eqChainResponseCanvas'); if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = Math.floor(rect.width * dpr), H = Math.floor(rect.height * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const N = 256;
    // U-1: length-guarded reuse (N is constant 256; mirrors state.wfBuf L251-252).
    if (!state.eqFreqs || state.eqFreqs.length !== N) state.eqFreqs = new Float32Array(N);
    const freqs = state.eqFreqs;
    const fMin = Math.log10(20), fMax = Math.log10(20000);
    for (let i = 0; i < N; i++) freqs[i] = Math.pow(10, fMin + (fMax - fMin) * i / (N - 1));
    let params: Record<string, any> = {};
    try { params = ((window.LGMDM as any)?.params?.collect?.() || {}); } catch (_) {}
    const audio: any = state.audio || document.querySelector('#previewAudioWrap audio');
    const fs = (audio && Number.isFinite(audio.sampleRate) && audio.sampleRate > 0) ? audio.sampleRate : 48000;
    const dbMin = -24, dbMax = 24;
    const dbArr = computeEqChainResponse(params, freqs, fs);
    const cw = rect.width, ch = rect.height;
    const xOf = (f: number): number => (Math.log10(f) - fMin) / (fMax - fMin) * cw;
    const yOf = (db: number): number => (dbMax - db) / (dbMax - dbMin) * ch;
    ctx.strokeStyle = 'rgba(120, 130, 160, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yOf(0)); ctx.lineTo(cw, yOf(0));
    ctx.stroke();
    ctx.strokeStyle = 'rgba(120, 130, 160, 0.2)';
    [100, 1000, 10000].forEach((f) => {
      const x = xOf(f);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, ch); ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(0, yOf(0));
    for (let i = 0; i < N; i++) ctx.lineTo(xOf(freqs[i]), yOf(dbArr[i]));
    ctx.lineTo(cw, yOf(0));
    ctx.closePath();
    const grad = ctx.createLinearGradient(0, 0, 0, ch);
    grad.addColorStop(0, 'rgba(66, 232, 255, 0.25)');
    grad.addColorStop(0.5, 'rgba(66, 232, 255, 0.10)');
    grad.addColorStop(1, 'rgba(66, 232, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i < N; i++) {
      const x = xOf(freqs[i]), y = yOf(dbArr[i]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = '#42e8ff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  function drawConsoleSpectrum() {
    const canvas = LGMDM.dom.byId('lgmdmConsoleSpectrum'); if (!canvas) return;
    const m = state.metrics || {};
    // El backend emite varios formatos según el endpoint:
    //   1) analysis → m.spectrum_bands_db (28 objetos {freq_hz, db}) y m.fft_spectrum.magnitudes_db
    //   2) preview live → m.meters.spectrum.bands_db (32 bandas con freq_edges)
    //   3) master chain → m.chain_meters no tiene spectrum
    const s28 = Array.isArray(m.spectrum_bands_db) ? m.spectrum_bands_db : null;
    const fftMags = Array.isArray(m.fft_spectrum?.magnitudes_db) ? m.fft_spectrum.magnitudes_db : null;
    const s7 = (m.spectrum && typeof m.spectrum === 'object') ? m.spectrum : null;
    let bands = null; let edges = null;
    if (s28 && s28.length > 0 && typeof s28[0] === 'object' && 'db' in s28[0]) {
      bands = s28.map((b: any) => Number(b.db));
      edges = [s28[0].freq_hz * 0.9, ...s28.map((b: any) => Number(b.freq_hz))];
    } else if (fftMags) {
      bands = fftMags.map((v: any) => Number(v));
    } else if (s7) {
      const order = ['sub_bass', 'bass', 'low_mid', 'mid', 'upper_mid', 'presence', 'air'];
      bands = order.map((k) => Number((s7 as any)[k])).filter(Number.isFinite);
      edges = [20, 80, 250, 500, 2000, 4000, 8000];
    }
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(320, Math.floor(rect.width * dpr)), h = Math.max(120, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!bands || bands.length === 0) return;
    const N = bands.length;
    const minDb = -90, maxDb = 0;
    const xForBand = (i: number): [number, number] => {
      const lo = edges && edges[i] != null ? edges[i] : Math.pow(10, Math.log10(20) + (i / N) * (Math.log10(20000) - Math.log10(20)));
      const hi = edges && edges[i + 1] != null ? edges[i + 1] : Math.pow(10, Math.log10(20) + ((i + 1) / N) * (Math.log10(20000) - Math.log10(20)));
      const logLo = Math.log10(Math.max(20, lo)), logHi = Math.log10(Math.max(20, hi));
      const xLo = ((logLo - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
      const xHi = ((logHi - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * w;
      return [xLo, xHi];
    };
    for (let i = 0; i < N; i++) {
      const v = Number(bands[i]);
      const [xLo, xHi] = xForBand(i);
      const barH = Number.isFinite(v) ? Math.max(2, ((v - minDb) / (maxDb - minDb)) * h) : 2;
      const xCenter = (xLo + xHi) / 2;
      const barW = Math.max(2, (xHi - xLo) * 0.85);
      const y = h - barH;
      const grad = ctx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, 'rgba(125,232,255,0.95)');
      grad.addColorStop(1, 'rgba(87,180,255,0.55)');
      ctx.fillStyle = grad;
      ctx.fillRect(xCenter - barW / 2, y, barW, barH);
      ctx.fillStyle = 'rgba(125,232,255,0.45)';
      ctx.fillRect(xCenter - 0.5, 0, 1, h);
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

  function setStatus(text: string, active: boolean = false): void { LGMDM.dom.byId('consoleStatus')?.replaceChildren(document.createTextNode(text)); document.querySelector('.lg-status-dot')?.classList.toggle('active', active); }
  function syncTrackInfo() {
    const file = (LGMDM as any).state?.selectedFile ?? null;
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
  // Re-entry guards (MX-13). syncChainMeters can be invoked multiple times per
  // frame: from updateConsoleMetrics (metrics subscriber) which can fire every
  // preview tick. JS is single-threaded, so the worst case is duplicated work +
  // "last-call-wins"; coalesce via guard + queueMicrotask so we collapse bursts
  // into one re-execution.
  let _metersSyncInFlight = false;
  let _metersSyncPending = false;
  let _lastMetrics: Record<string, any> | null = null;

  function updateConsoleMetrics(metrics: Record<string, any> | null): void {
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
  }

  function syncChainMeters(metrics: Record<string, any> | null): void {
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

  root.masterConsole.syncChainMeters = syncChainMeters;

        function scheduleConsolePreview(){
    if (state.applying) return;
    clearTimeout(root.masterConsole.previewTimer);
    root.masterConsole.previewTimer = setTimeout(() => {
      (window.LGMDM as any)?.previewController?.request?.();
    }, 350);
  }

  let wired = false;
  function wire(){
    if (wired) return;
    wired = true;
    mirror(refs.input[0], refs.input[1]); mirror(refs.compThreshold[0], refs.compThreshold[1]); mirror(refs.compRatio[0], refs.compRatio[1]); mirror(refs.stereo[0], refs.stereo[1]); mirror(refs.limiter[0], refs.limiter[1]);
    const _waveformCanvas = LGMDM.dom.byId('lgmdmWaveformCanvas');
    if (_waveformCanvas && typeof window.setupCanvasResize === 'function') {
      state._waveformCleanup = window.setupCanvasResize(_waveformCanvas, () => drawWaveform());
    }
    const _waterfallCanvas = LGMDM.dom.byId('lgmdmWaterfallCanvas');
    if (_waterfallCanvas && typeof window.setupCanvasResize === 'function') {
      state._waterfallCleanup = window.setupCanvasResize(_waterfallCanvas, () => drawWaterfall());
    }
    const _eqChainCanvas = LGMDM.dom.byId('eqChainResponseCanvas');
    if (_eqChainCanvas && typeof window.setupCanvasResize === 'function') {
      state._eqChainCleanup = window.setupCanvasResize(_eqChainCanvas, () => drawEqChainResponse());
    }
    drawEqChainResponse();
    // FIX A5: guardamos un AbortController para los window listeners y así
    // teardown() puede removerlos (antes no había forma — acumulaban en HMR).
    if (!state._windowListeners) {
      state._windowListeners = new AbortController();
    }
    const wl = state._windowListeners;
    window.addEventListener('lgmdm:preview-ready', () => { ensureScopeTap(); }, { signal: wl.signal });
    LGMDM.dom.byId('consoleAnalyzeBtn')?.addEventListener('click',()=>{LGMDM.dom.byId('btnAnalyze')?.click();setStatus('Analizando audio…',true);});
    LGMDM.dom.byId('consoleMasterBtn')?.addEventListener('click',()=>{LGMDM.dom.byId('btnMasterAsync')?.click();setStatus('Mastering en cola…',true);});
    LGMDM.dom.byId('consolePlayBtn')?.addEventListener('click',()=>{
      const audio=getPreviewAudio();
      if(!audio || !(window.LGMDM as any)?.previewController?.isReady?.()) {
        return setStatus('El Preview todavía no está listo: debe terminar el procesamiento del servidor.');
      }
      const pb = LGMDM.dom.byId('consolePlayBtn');
      if(audio.paused){audio.play().catch((e: Error)=>setStatus('No se pudo reproducir el Preview: '+e.message));pb.textContent='❚❚';pb.setAttribute('aria-pressed','true');state.playing=true;state.start=performance.now();setStatus('Preview reproduciendo',true);}else{audio.pause();pb.textContent='▶';pb.setAttribute('aria-pressed','false');state.playing=false;setStatus('Preview en pausa');}
    });
    LGMDM.dom.byId('consoleStopBtn')?.addEventListener('click',()=>{
      stopAllPlayback();
      state.playing=false;LGMDM.dom.byId('consolePlayBtn').textContent='▶';setStatus('Preview detenido');
    });
    const livePreviewToggle = LGMDM.dom.byId('s-livepreview');
    if (livePreviewToggle) {
      const bind = (window.LGMDM as any).ui.bindOnce;
      bind(livePreviewToggle, 'change', (ev: Event) => {
        if (ev && ev.isTrusted === false) return;
        if (livePreviewToggle.checked && (LGMDM as any).state?.selectedFile) {
          setStatus('Preview habilitado · procesando en servidor…', true);
          (window.LGMDM as any)?.previewController?.request?.();
        } else if (!livePreviewToggle.checked) {
          (window.LGMDM as any)?.previewController?.stop?.();
          setStatus('Preview deshabilitado');
        }
      }, 'server-preview-toggle-console');
    }
        LGMDM.dom.byId('consoleABMaster')?.addEventListener('click',()=>setAB('master')); LGMDM.dom.byId('consoleABOriginal')?.addEventListener('click',()=>setAB('original')); LGMDM.dom.byId('consoleABToggle')?.addEventListener('click',toggleAB);
    document.querySelectorAll('.lg-stage-card').forEach((btn: Element) => btn.addEventListener('click', () => toggleStage((btn as HTMLElement).dataset.stage as 'input' | 'comp' | 'stereo' | 'limiter')));
    document.querySelectorAll('.lg-chain-node').forEach((btn: Element) => btn.addEventListener('click', () => (document.querySelector(`.sidebar-tab[data-pane="${(btn as HTMLElement).dataset.pane}"]`) as HTMLElement | null)?.click()));
    LGMDM.dom.byId('consoleShowChain')?.addEventListener('click', () => (document.querySelector('.sidebar-tab[data-pane="pane-cadena"]') as HTMLElement | null)?.click());
    LGMDM.dom.byId('btnAnalyze')?.addEventListener('click',()=>setStatus('Analizando audio…',true)); LGMDM.dom.byId('btnMasterAsync')?.addEventListener('click',()=>setStatus('Mastering en cola…',true)); LGMDM.dom.byId('btnMasterSync')?.addEventListener('click',()=>setStatus('Mastering en proceso…',true));
    LGMDM.dom.byId('fileInput')?.addEventListener('change',syncTrackInfo);
    window.addEventListener('lgmdm:preview-state', (ev: Event) => {
      const btn = LGMDM.dom.byId('consolePlayBtn');
      const detail = ((ev as CustomEvent).detail || {}) as { state?: string; text?: string };
      if (btn) btn.disabled = detail.state !== 'ready';
      if (detail.state === 'ready') setStatus('Preview completo listo para reproducir', true);
      else if (detail.state === 'processing') setStatus(detail.text || 'Procesando Preview en servidor…', true);
      else if (detail.state === 'disabled') setStatus(detail.text || 'Preview deshabilitado');
    }, { signal: wl.signal });
    syncTrackInfo(); updateReadouts(); updateStageCards();
    const observer=new MutationObserver(syncTrackInfo); const fileName=LGMDM.dom.byId('fileName'); if(fileName)observer.observe(fileName,{childList:true,subtree:true,characterData:true});
    state._fileNameObserver = observer;
    const tick=()=>{
      if (!wired) return;
      if ((window.LGMDM as any).utils.prefersReducedMotion()) {
        state.raf = 0;
        return;
      }
      const onConsole = document.body.dataset.workspace === "console";
      if(onConsole){ drawWaveform(); updateConsoleStereoVu(); drawConsoleSpectrum(); drawEqChainResponse(); }
      // FIX C3: drawWaterfall() removed — the visual-suite owns lgmdmWaterfallCanvas
      // with real FFT data (audioTap.ensure()?.analyserWaterfall). Running both
      // renderers caused flicker (two owners on the same canvas).
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
    // W2 fix (web-audio-api re-pass): reduced-motion RAF stop era one-way.
    // matchMedia listener para restart el RAF si el user togglea reduced-motion
    // de "reduce" a "no-preference". Sin esto, una vez que el tick hace
    // state.raf=0 por prefersReducedMotion(), el loop nunca se reinicia.
    const _mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (_mqReduced.addEventListener) {
      _mqReduced.addEventListener('change', (e) => {
        if (!e.matches && wired && state.raf === 0) {
          state.raf = requestAnimationFrame(tick);
        }
      });
    }
    // Consume the shared Metrics Store instead of wrapping another producer.
    const metricsStore = (window.LGMDM as any)?.metrics;
    if (metricsStore) {
      state.unsubscribeMetrics?.();
      state.unsubscribeMetrics = metricsStore.subscribe(({ metrics }: any) => {
        updateConsoleMetrics(metrics);
      });
    }
  }
  root.masterConsole.setStageBypass = (stage: 'input' | 'comp' | 'stereo' | 'limiter', bypass: boolean) => {
    if (!(stage in state.stageBypass)) throw new Error(`[Master Console] etapa desconocida: ${stage}`);
    state.stageBypass[stage] = Boolean(bypass);
    const relatedMap: Record<string, string[]> = {
      comp: ['s-thresh', 's-ratio'],
      stereo: ['s-width'],
      limiter: ['s-ceiling'],
    };
    const related = relatedMap[stage] || [];
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
  root.masterConsole.getChainOverrides = () => ({
    comp_bypass: !!state.stageBypass.comp,
    stereo_bypass: !!state.stageBypass.stereo,
    limiter_bypass: !!state.stageBypass.limiter,
  });
  root.masterConsole.setAB=setAB; root.masterConsole.toggleAB=toggleAB; root.masterConsole.schedulePreview=scheduleConsolePreview;
  root.masterConsole.stopAllPlayback=stopAllPlayback;
  root.console = root.masterConsole;
  function teardown(){
    if(state.raf){ cancelAnimationFrame(state.raf); state.raf=0; }
    // FIX A5: limpiar previewTimer (línea 572) que antes no se cancelaba en
    // teardown → podía disparar previewController.request() post-teardown.
    if(root.masterConsole.previewTimer){ clearTimeout(root.masterConsole.previewTimer); root.masterConsole.previewTimer=null; }
    if(state._windowListeners){ try { state._windowListeners.abort(); } catch (_) {} state._windowListeners=null; }
    if(state._fileNameObserver){ state._fileNameObserver.disconnect(); state._fileNameObserver=null; }
    if(state._waveformCleanup){ state._waveformCleanup(); state._waveformCleanup=null; }
    if(state._waterfallCleanup){ state._waterfallCleanup(); state._waterfallCleanup=null; }
    if(state._eqChainCleanup){ state._eqChainCleanup(); state._eqChainCleanup=null; }
    if(state.unsubscribeMetrics){ state.unsubscribeMetrics(); state.unsubscribeMetrics=null; }
    state.timeBuf = null; state.wfBuf = null;
    // W1: resetear contadores del ring (los objetos quedan para reusar tras HMR).
    state.waveHistoryWriteIdx = 0; state.waveHistoryLen = 0;
    // U-1: release the EQ-response reusable buffers too.
    state.dbOut = null; state.eqFreqs = null; _eqFilters.length = 0;
    wired=false;
  }
  root.masterConsole.teardown=teardown;

  // FIX A5: el comentario decía "idempotent wire guard (global) — survives
  // HMR reloads" pero `consoleWired` era `let` dentro del IIFE → se reseteaba
  // en cada re-ejecución del módulo (HMR) → NO sobrevivía. Lo movemos a
  // root.masterConsole.consoleWired (global, persiste entre reloads) para que
  // el comentario sea verdad. (Regla 7: comentario que miente = prohibido.)
  function wireOnce() {
    if ((root.masterConsole as Record<string, unknown>).consoleWired) return;
    (root.masterConsole as Record<string, unknown>).consoleWired = true;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', wire, { once: true });
    } else {
      wire();
    }
  }

  function teardownAll() {
    teardown();
    try { audioTap.teardown(); } catch (_) {}
    (root.masterConsole as Record<string, unknown>).consoleWired = false;
  }
  window.addEventListener('beforeunload', teardownAll, { once: true });

  wireOnce();
})();

// Public surface (typed) — consumed by visual suite, params-builder, etc.
export interface ChainOverrides {
  comp_bypass: boolean;
  stereo_bypass: boolean;
  limiter_bypass: boolean;
}

export function getChainOverrides(): ChainOverrides {
  const g = lgmdm();
  return (g.masterConsole?.getChainOverrides?.() ?? {
    comp_bypass: false,
    stereo_bypass: false,
    limiter_bypass: false,
  }) as ChainOverrides;
}

export function isPlaying(): boolean {
  const g = lgmdm();
  return Boolean(g.masterConsole?.isPlaying?.());
}

export function teardown(): void {
  const g = lgmdm();
  g.masterConsole?.teardown?.();
}

export type MasterConsole = {
  getChainOverrides: typeof getChainOverrides;
  isPlaying: typeof isPlaying;
  teardown: typeof teardown;
  setStageBypass: (stage: string, bypass: boolean) => void;
};

const g = lgmdm();
g.console = g.masterConsole;
