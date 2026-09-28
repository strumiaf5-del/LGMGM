// visualizer-helpers.ts — FFT/EQ/preview/A-B helpers

import { audioEngine } from '../../core/audio-engine';

// TODO(U-2): quedan ~21 `as any` y ~15 `: any` en este archivo. La raíz es
// `lgmdm(): any` (línea 6) + `const LGMDM: any = lgmdm()` (línea 10), que
// alimentan ~60 accesos `LGMDM.ui.*`/`LGMDM.dom.*` sin `?.` (misma cascada que
// params-builder/reference-mastering). Las render functions que hacen
// aritmética/anidación sobre `a.X` (`renderProfessionalMeter`,
// `perceptualPanelHtml`, `renderFFT`, `drawFFTOnCanvas`) también requieren
// migración dedicada (unknown no soporta `>` ni `.map`). Ya migradas a
// `Record<string, unknown>`: metricsHtml, renderAnalysisSingle,
// renderAnalysisComparison, renderPerceptualStandalone (alinean con las
// declaraciones globales en mastering-actions.ts:82-84).
function lgmdm(): any {
  return window.LGMDM || (window.LGMDM = {} as any);
}

(function () {
  const LGMDM: any = lgmdm();
  function themeColors(): any { return (window as any).themeColors?.() ?? {}; }
  function xFromFreq(f: number, padL: number, plotW: number, logMin: number, logMax: number): number {
    return (window as any).xFromFreq?.(f, padL, plotW, logMin, logMax) ?? padL;
  }

// DOM cache centralizado en 00-api.js.
// ── FFT ──────────────────────────────────────────────────────
// ── Visualizador de espectro en tiempo real (streaming chunk a chunk) ─────────
// Recibe el array bands_db (32 bandas log) que viene en metrics.spectrum
// y dibuja un bar graph animado sobre el canvas jobSpectrumCanvas.
// función de más abajo (canvas, dataL, dataR, sampleRate) que dibuja el
// espectro del monitor de entrada en vivo. Al haber DOS declaraciones
// "function drawLiveSpectrum" en el mismo scope global, la segunda
// pisaba a la primera (hoisting), y la llamada de acá (con 1 solo
// argumento, bandsDb) terminaba ejecutando la función equivocada —
// tratando el array bandsDb como si fuera un elemento <canvas>, lo que
// tiraba "canvas.getContext is not a function" cada vez que llegaba
// espectro por streaming durante el render. Se renombra a drawJobSpectrum
// para que ambas funciones convivan sin pisarse.
// ── Dynamic EQ — recomendación en vivo (resonancias / sibilancia) ───────────
// El servidor puede devolver recomendaciones de EQ junto con el análisis completo.
// (ver streaming_engine.py). Se recalcula cada ~6s de audio, no en cada chunk,
// así que comparamos por "summary" para no re-renderizar (y resetear el botón
// "Aplicado") en cada uno de los chunks que repiten la misma detección.
// ── FFT rendering ────────────────────────────────────────────
function drawFFTOnCanvas(canvas: HTMLCanvasElement, series: any[]) {
  const dpr = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || 600,
    cssHeight = 220;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  const allDb: number[] = series.flatMap((s: any) => s.data?.magnitudes_db ?? []);
  const minDb = Math.min(...allDb, -80),
    maxDb = Math.max(...allDb, -10);
  const padL = 36,
    padB = 18,
    padT = 8,
    padR = 8;
  const plotW = cssWidth - padL - padR,
    plotH = cssHeight - padT - padB;
  const theme = themeColors();
  const colorOf = (c: string): string => {
    if (!c) return theme.accent;
    const m = c.match(/var\((--[a-z0-9-]+)\)/);
    return m ? theme.get(m[1]) : c;
  };
  const borderColor = theme.border,
    mutedColor = theme.muted;
  ctx.strokeStyle = borderColor;
  ctx.fillStyle = mutedColor;
  ctx.font = "10px monospace";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const db = maxDb - (i / 4) * (maxDb - minDb);
    const y = padT + (i / 4) * plotH;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();
    ctx.fillText(Math.round(db) + "dB", 2, y + 3);
  }
  const freqs = series[0].data.frequencies_hz;
  const fMin = Math.max(freqs[0], 20),
    fMax = freqs[freqs.length - 1];
  [20, 100, 1000, 10000, 20000].forEach((f) => {
    if (f < fMin || f > fMax) return;
    const x = window.xFromFreq(f, padL, plotW, Math.log10(fMin), Math.log10(fMax));
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.stroke();
    ctx.fillText(f >= 1000 ? String(f / 1000) + "k" : String(f), x - 8, cssHeight - 4);
  });
  series.forEach((s: any) => {
    const freqs = s.data.frequencies_hz,
      mags = s.data.magnitudes_db;
    ctx.beginPath();
    ctx.strokeStyle = colorOf(s.color);
    ctx.lineWidth = 2;
    freqs.forEach((f: number, i: number) => {
      const x = (window as any).xFromFreq(Math.max(f, fMin), padL, plotW, Math.log10(fMin), Math.log10(fMax));
      const norm = (mags[i] - minDb) / (maxDb - minDb);
      const y = padT + plotH - Math.max(0, Math.min(1, norm)) * plotH;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  });
  let lx = padL + 6,
    ly = padT + 6;
  series.forEach((s: any) => {
    ctx.fillStyle = colorOf(s.color);
    ctx.fillRect(lx, ly - 7, 8, 8);
    ctx.fillStyle = mutedColor;
    ctx.fillText(s.label, lx + 12, ly);
    lx += 12 + ctx.measureText(s.label).width + 16;
  });
}

function renderFFT(series: any): void {
  const wrap = document.createElement("div");
  wrap.className = "fft-wrap";
  const legendHtml = series
    .map(
      (s: any) =>
        `<span style="color:${s.color || "var(--ui-accent)"}">■</span> <span class="lgjs-s-e8faeec7">${s.label}</span>`,
    )
    .join("");
  wrap.innerHTML = `<h3>Spectrum Analyzer (FFT)</h3><canvas></canvas><div class="lgjs-s-acef0958">${legendHtml}</div>`;
  LGMDM.ui.getContent().appendChild(wrap);
  drawFFTOnCanvas(wrap.querySelector("canvas") as HTMLCanvasElement, series);
}

// F10.x: renderSpectrum (spectrum bars per-bandas) estaba duplicando info del
// FFT y saturando el tab Análisis. Sus callers (renderAnalysisSingle y
// renderAnalysisComparison) ya no la invocan — stub conservado por si se
// reactiva más tarde con una visualización alternativa.
function renderSpectrum(/* datasets, labels */) {
  /* no-op */
}

function metricsHtml(a: Record<string, unknown>, b: Record<string, unknown> | null): string {
  const rows: any[] = [
    [
      "LUFS",
      a.lufs,
      b?.lufs,
      (v: any) => `${v} LUFS`,
      (v: any) => (v >= -14 && v <= -8 ? "good" : v >= -18 && v < -14 ? "warn" : "bad"),
    ],
    ["RMS", a.rms_db, b?.rms_db, (v: any) => `${v} dB`, () => "neutral"],
    ["Peak", a.peak_db, b?.peak_db, (v: any) => `${v} dBFS`, (v: any) => (v > -0.5 ? "warn" : "good")],
    [
      "Rango dinámico",
      a.dynamic_range_db,
      b?.dynamic_range_db,
      (v: any) => `${v} dB`,
      (v: any) => (v < 6 ? "bad" : v <= 12 ? "good" : "warn"),
    ],
    ["BPM", a.bpm, b?.bpm, (v: any) => `${v}`, () => "neutral"],
    ["Duración", a.duration_sec, null, (v: any) => `${v} s`, () => "neutral"],
    ["Sample rate", a.sample_rate, null, (v: any) => `${v} Hz`, () => "neutral"],
    ["Canales", a.channels, null, (v: any) => (v === 1 ? "Mono" : "Estéreo"), () => "neutral"],
  ];
  return rows
    .map(
      ([label, va, vb, fmt, cls]) =>
        `<div class="metric-row"><span class="metric-label">${label}</span><span class="metric-value ${cls(va)}">${fmt(va)}${b && vb != null ? ' <span class="delta ' + (vb > va ? "up" : "down") + '">' + (vb > va ? "+" : "") + (vb - va).toFixed(1) + "</span>" : ""}</span></div>`,
    )
    .join("");
}

// ── Análisis perceptual ("oídos" de Laia) ────────────────────────
const PERCEPTUAL_LABELS = {
  clarity: "Claridad",
  dynamic_feel: "Dinámica",
  tonal_balance: "Balance tonal",
  stereo_coherence: "Coherencia estéreo",
  instrumental_definition: "Definición",
  presence_feel: "Presencia",
  mix_cohesion: "Cohesión de mezcla",
  frequency_balance: "Balance de frecuencias",
  headroom_feel: "Headroom",
};

// Qué valor de cada dimensión se considera "problemático" a simple vista
// (colorea la fila en rojo/amarillo); el resto queda neutral (no hay un
// valor objetivamente "malo" — depende del género).
const PERCEPTUAL_BAD_VALUES = {
  clarity: ["muddy", "harsh"],
  stereo_coherence: ["phase_issues"],
  mix_cohesion: ["over_compressed", "disconnected"],
  headroom_feel: ["cramped"],
};
const PERCEPTUAL_WARN_VALUES = {
  presence_feel: ["in_your_face"],
};

function perceptualValueClass(key: string, value: string): string {
  if ((PERCEPTUAL_BAD_VALUES as any)[key]?.includes(value)) return "bad";
  if ((PERCEPTUAL_WARN_VALUES as any)[key]?.includes(value)) return "warn";
  return "neutral";
}

function perceptualPanelHtml(a: any, titleSuffix?: string): string {
  if (!a || !a.perceptual) return "";
  const p = a.perceptual;
  const genre = a.genre_detected;
  const genreConf = a.genre_confidence != null ? Math.round(a.genre_confidence * 100) : null;
  const diagnosis = a.perceptual_diagnosis;
  const fatigue = Math.round((p.fatigue_risk ?? 0) * 100);
  const fatigueClass = fatigue >= 70 ? "bad" : fatigue >= 40 ? "warn" : "good";

  const rows = Object.entries(PERCEPTUAL_LABELS)
    .map(([key, label]) => {
      const val = p[key];
      if (val == null || val === "unknown") return "";
      const cls = perceptualValueClass(key, val);
      const text = LGMDM.ui.escapeHtml(String(val).replace(/_/g, " "));
      return `<div class="metric-row"><span class="metric-label">${LGMDM.ui.escapeHtml(label)}</span><span class="metric-value ${cls}">${text}</span></div>`;
    })
    .join("");

  return `
    <div class="analysis-panel perceptual-panel">
      <h3>👂 Cómo suena${titleSuffix ? " " + titleSuffix : ""}</h3>
      ${genre ? `<div class="perceptual-genre"><span class="perceptual-genre-tag">${LGMDM.ui.escapeHtml(genre)}</span>${genreConf != null ? `<span class="perceptual-genre-conf">${LGMDM.ui.escapeHtml(genreConf)}% confianza</span>` : ""}</div>` : ""}
      ${diagnosis ? `<p class="perceptual-diagnosis">${LGMDM.ui.escapeHtml(diagnosis)}</p>` : ""}
      <div class="perceptual-fatigue">
        <span class="metric-label">Riesgo de fatiga</span>
        <div class="perceptual-fatigue-bar">
          <div class="perceptual-fatigue-fill ${fatigueClass}" style="width:${fatigue}%"></div>
        </div>
        <span class="metric-value ${fatigueClass}">${fatigue}%</span>
      </div>
      ${rows}
    </div>`;
}

function renderPerceptualStandalone(a: Record<string, unknown>): void {
  if (!a || !a.perceptual) return;
  const grid = document.createElement("div");
  grid.className = "analysis-grid";
  grid.innerHTML = perceptualPanelHtml(a);
  LGMDM.ui.getContent().appendChild(grid);
}

function renderAnalysisSingle(a: Record<string, unknown>): void {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";
  grid.innerHTML = `<div class="analysis-panel"><h3>Métricas del audio</h3>${metricsHtml(a, null)}</div>${perceptualPanelHtml(a)}`;
  const target = document.getElementById("analysisDynamicContent") || LGMDM.ui.getContent();
  target.appendChild(grid);
  renderProfessionalMeter(a);
}

function renderAnalysisComparison(before: Record<string, unknown>, after: Record<string, unknown>): void {
  const grid = document.createElement("div");
  grid.className = "analysis-grid";
  grid.innerHTML = `<div class="analysis-panel"><h3>Antes</h3>${metricsHtml(before, null)}</div><div class="analysis-panel"><h3>Después</h3>${metricsHtml(after, before)}</div>${perceptualPanelHtml(after, "— Después")}`;
  const target = document.getElementById("analysisDynamicContent") || LGMDM.ui.getContent();
  target.appendChild(grid);
  renderProfessionalMeter(after);
  if (before.fft_spectrum && after.fft_spectrum) {
    renderFFT([
      { label: "Antes", data: before.fft_spectrum, color: "var(--ui-muted)" },
      { label: "Después", data: after.fft_spectrum, color: "var(--ui-accent)" },
    ]);
  }
}

// ── A/B Player con waveforms superpuestas ────────────────────
let _abOriginalBuf: AudioBuffer | null = null;   // AudioBuffer del original decodificado
let _abMasterBuf: AudioBuffer | null = null;   // AudioBuffer del master decodificado
let _abMode: "master" | "original" = "master";
let _abNode: AudioBufferSourceNode | null = null;   // AudioBufferSourceNode activo
let _abStartTime: number = 0;      // AudioContext.currentTime cuando arrancó la reproducción
let _abOffset: number = 0;      // posición en el buffer al momento de arrancar
let _abPlaying: boolean = false;
let _abRafId: number | null = null;
// FIX A7: handle del setTimeout(40) del crossfade A/B. Antes no se guardaba
// → si teardownAB corría en esos 40ms, _abPlay re-creaba _abNode y arrancaba
// playback post-teardown.
let _abFadeTimer: ReturnType<typeof setTimeout> | null = null;
let _abGain: GainNode | null = null;
let _abUiTimer: ReturnType<typeof setInterval> | null = null;

function renderABWaveforms(originalBuffer: AudioBuffer | null, masterBuffer: AudioBuffer | null): void {
  const canvas = document.getElementById("abWaveformCanvas") as HTMLCanvasElement | null;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = canvas.clientHeight || 120;
  canvas.width  = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const theme = themeColors();
  ctx.fillStyle = theme.surface2;
  ctx.fillRect(0, 0, W, H);

  // Línea central
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();

  function drawBufferWaveform(buf: AudioBuffer, color: string, alpha: number, label: string): void {
    const data = buf.getChannelData(0);
    const step = Math.ceil(data.length / W);
    ctx.strokeStyle = color.startsWith("var(") ? theme.get(color.slice(4, -1)) : color;
    ctx.lineWidth = 1.2;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = 0; i < W; i++) {
      let min = 1, max = -1;
      for (let j = 0; j < step; j++) {
        const v = data[i * step + j] || 0;
        if (v < min) min = v;
        if (v > max) max = v;
      }
      const yMin = (1 - (min + 1) / 2) * H;
      const yMax = (1 - (max + 1) / 2) * H;
      if (i === 0) ctx.moveTo(i, yMin);
      else ctx.lineTo(i, yMin);
      ctx.lineTo(i, yMax);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Etiqueta de leyenda en el canvas
    ctx.fillStyle = color.startsWith("var(") ? theme.get(color.slice(4, -1)) : color;
    ctx.font = "10px monospace";
    ctx.fillText(label, W - 80, 14);
  }

  if (originalBuffer) drawBufferWaveform(originalBuffer, "var(--ui-muted)", 0.6, "Original");
  if (masterBuffer) drawBufferWaveform(masterBuffer, "var(--ui-accent-2)", 0.9, "Master");
}

// ── A/B player existente con integración de waveforms ────────
function _abGetCtx(): AudioContext {
  // V1: usar audioEngine.getContext() — antes leía (window.LGMDM).audio que
  // nunca se asigna → TypeError en el primer click A/B. Esto también consume
  // el import `audioEngine` de la línea 3 (antes dead import).
  const ctx = audioEngine.getContext();
  if (!_abGain || _abGain.context !== ctx) {
    _abGain = ctx.createGain();
    _abGain.connect(ctx.destination);
  }
  return ctx;
}

function _abCurrentPosition(): number {
  const ctx: AudioContext | undefined = (window.LGMDM as any)?.state?.audio?.context;
  if (!_abPlaying || !ctx) return _abOffset;
  return _abOffset + (ctx.currentTime - _abStartTime);
}

function _abStop(): void {
  const wasPlaying = _abPlaying;
  if (_abNode) {
    try { _abNode.stop(); } catch(e) {}
    _abNode.disconnect();
    _abNode = null;
  }
  _abPlaying = false;
  if (wasPlaying) {
    try { window.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { source: 'ab-player' } })); } catch (_) {}
  }
}

function _abPlay(buf: AudioBuffer, offset: number): void {
  if (!buf) return;
  (window.LGMDM as any)?.playback?.stopAll?.();
  const ctx = _abGetCtx();
  // W2: ctx.resume() devuelve Promise flotante — atrapar reject para que no
  // quede "unhandled rejection" si el ctx se cierra entre el check y el resume.
  if (ctx.state === "suspended") void ctx.resume().catch(() => {});
  _abStop();
  _abOffset = Math.max(0, Math.min(offset, buf.duration - 0.01));
  _abNode = ctx.createBufferSource();
  _abNode.buffer = buf;
  _abNode.connect(_abGain!);
  _abNode.start(0, _abOffset);
  _abStartTime = ctx.currentTime;
  _abPlaying = true;
  try { window.dispatchEvent(new CustomEvent('lgmdm:playback-started', { detail: { source: 'ab-player' } })); } catch (_) {}
  _abNode.onended = () => {
    _abPlaying = false;
    _abOffset = 0;
    if (_abNode) { try { _abNode.disconnect(); } catch (_) {} _abNode = null; }
    try { window.dispatchEvent(new CustomEvent('lgmdm:playback-stopped', { detail: { source: 'ab-player' } })); } catch (_) {}
    _updateABUI();
  };
}

function _abSetMode(mode: "master" | "original"): void {
  if (mode !== "master" && mode !== "original") return;
  const pos = _abCurrentPosition();
  _abMode = mode;
  const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
  if (_abPlaying && buf) {
    _abStop();
    _abPlay(buf, pos);
    const ctx = _abGetCtx();
    if (_abGain && ctx) {
      _abGain.gain.cancelScheduledValues(ctx.currentTime);
      _abGain.gain.setValueAtTime(1, ctx.currentTime);
    }
  } else {
    _abOffset = buf ? Math.max(0, Math.min(pos, Math.max(0, buf.duration - 0.01))) : pos;
  }
  _updateABUI();
}

function _abToggle(): void {
  const pos = _abCurrentPosition();
  const ctx = _abGetCtx();
  _abMode = _abMode === "master" ? "original" : "master";
  const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
  if (_abPlaying) {
    // Fade out suave 30ms, cambia buffer, fade in — sin corte audible
    if (_abGain && ctx) {
      _abGain.gain.setTargetAtTime(0, ctx.currentTime, 0.015);
      _abFadeTimer = setTimeout(() => {
        _abFadeTimer = null;
        _abPlay(buf!, pos);
        const currentCtx = _abGetCtx();
        if (currentCtx && _abGain) _abGain.gain.setTargetAtTime(1, currentCtx.currentTime, 0.015);
        _updateABUI();
      }, 40);
    } else {
      _abPlay(buf!, pos);
      _updateABUI();
    }
  } else {
    _abOffset = pos;
    _updateABUI();
  }
}

function _updateABUI(): void {
  const isMaster = _abMode === "master";
  const buf = isMaster ? _abMasterBuf : _abOriginalBuf;
  const label = isMaster ? "🎚 Master" : "🎵 Original";
  const toggleLabel = isMaster ? "⇄ Escuchar Original" : "⇄ Escuchar Master";
  const pos = _abCurrentPosition();
  const dur = buf ? buf.duration : 0;
  const pct = dur > 0 ? Math.min(100, (pos / dur) * 100) : 0;

  const labelEl  = document.getElementById("abLabel");
  const toggleEl = document.getElementById("btnABToggle");
  const barEl    = document.getElementById("abProgressBar");
  const timeEl   = document.getElementById("abTimeReadout");
  const playEl   = document.getElementById("btnABPlay");

  if (labelEl)  labelEl.textContent = label;
  if (labelEl)  labelEl.style.color = isMaster ? "var(--ui-accent)" : "var(--ui-muted)";
  if (toggleEl) toggleEl.textContent = toggleLabel;
  if (barEl)    barEl.style.width = pct.toFixed(1) + "%";
  if (timeEl && dur > 0) {
    const fmt = (s: number): string => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
    timeEl.textContent = fmt(pos) + " / " + fmt(dur);
  }
  if (playEl)   playEl.textContent = _abPlaying ? "⏸" : "▶";

  // Actualizar waveform overlay
  const waveformCanvas = document.getElementById("abWaveformCanvas");
  if (waveformCanvas && _abOriginalBuf && _abMasterBuf) {
    renderABWaveforms(_abOriginalBuf, _abMasterBuf);
  }
}

window.LGMDM = window.LGMDM || {};
(window.LGMDM as any).ab = (window.LGMDM as any).ab || {};
(window.LGMDM as any).ab.setMode = _abSetMode;
(window.LGMDM as any).ab.getGainNode = () => _abGain;
(window.LGMDM as any).ab.isPlaying = () => _abPlaying;

function _renderABPlayer() {
  const wrap = document.getElementById("previewAudioWrap");
  if (!wrap) return;
  wrap.innerHTML = `
    <div class="lgjs-ab-wrap">
      <div class="lgjs-ab-row">
        <span id="abLabel" class="lgjs-ab-label">🎚 Master</span>
        <button id="btnABToggle" class="lgjs-ab-toggle">⇄ Escuchar Original</button>
        <span class="lgjs-ab-meta">toggle sin corte</span>
      </div>
      <div class="lgjs-s-d98eb85f">
        <button id="btnABPlay" class="lgjs-s-e7d3420f">▶</button>
        <button id="btnABStop" class="lgjs-s-7ed332e9">⏹</button>
        <div class="lgjs-s-e5af5485" id="abProgressWrap" role="slider" tabindex="0" aria-label="Posición de reproducción A/B" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div id="abProgressBar" class="lgjs-s-5b664f9d"></div>
        </div>
        <span id="abTimeReadout" class="lgjs-s-cdc6f85e">0:00 / 0:00</span>
      </div>
      <div class="lgjs-s-edd2b65b">
        <canvas id="abWaveformCanvas" class="lgjs-s-13c00b3f"></canvas>
      </div>
    </div>`;

  document.getElementById("btnABToggle")?.addEventListener("click", _abToggle);
  document.getElementById("btnABPlay")?.addEventListener("click", () => {
    if (_abPlaying) {
      _abOffset = _abCurrentPosition();
      _abStop();
    } else {
      const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
      if (buf) _abPlay(buf, _abOffset);
    }
    _updateABUI();
  });
  document.getElementById("btnABStop")?.addEventListener("click", () => {
    _abOffset = 0;
    _abStop();
    _updateABUI();
  });
  document.getElementById("abProgressWrap")?.addEventListener("click", (e) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const pct  = (e.clientX - rect.left) / rect.width;
    const buf  = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
    if (!buf) return;
    const newPos = pct * buf.duration;
    if (_abPlaying) { _abPlay(buf, newPos); }
    else            { _abOffset = newPos; }
    _updateABUI();
  });
  document.getElementById("abProgressWrap")?.addEventListener("keydown", (e) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const buf = _abMode === "master" ? _abMasterBuf : _abOriginalBuf;
    if (!buf) return;
    const delta = e.key === "ArrowLeft" ? -2 : 2;
    const newPos = Math.max(0, Math.min(buf.duration, _abCurrentPosition() + delta));
    if (_abPlaying) _abPlay(buf, newPos);
    else _abOffset = newPos;
    _updateABUI();
  });

  if (_abUiTimer) clearInterval(_abUiTimer);
  _abUiTimer = setInterval(() => {
    if (LGMDM.utils.prefersReducedMotion()) return;
    if (_abPlaying) _updateABUI();
  }, 200);
  _updateABUI();
}

async function setupABPlayer(masterBlob: Blob): Promise<void> {
  try {
    const cachedBuf = (window.LGMDM as any)?.state?.cachedFileBuffer;
    const origBlob = cachedBuf
      ? new Blob([cachedBuf], { type: (window.LGMDM as any).state.selectedFile?.type || "audio/wav" })
      : null;
    if (!origBlob) return;

    const ctx = _abGetCtx();

    // FIX M-NEW-12: usar Promise.allSettled en vez de Promise.all para que
    // una decodificación fallida no deje la otra pendiente. Antes Promise.all
    // era fail-fast → si una fallaba, la otra quedaba corriendo sin cancelación.
    const [origRes, masterRes] = await Promise.allSettled([
      origBlob.arrayBuffer().then(ab => ctx.decodeAudioData(ab)),
      masterBlob.arrayBuffer().then(ab => ctx.decodeAudioData(ab)),
    ]);
    if (origRes.status !== 'fulfilled' || masterRes.status !== 'fulfilled') {
      console.debug("Error en setupABPlayer (decode):", origRes.status === 'rejected' ? origRes.reason : masterRes.status === 'rejected' ? masterRes.reason : 'unknown');
      return;
    }
    const origAB = origRes.value;
    const masterAB = masterRes.value;

    _abOriginalBuf = origAB;
    _abMasterBuf   = masterAB;
    _abMode        = "master";
    _abOffset      = 0;
    _abPlaying     = false;

    _renderABPlayer();
  } catch (e) {
    console.debug("Error en setupABPlayer:", e);
  }
}

// ── Estado y UI del preview ──────────────────────────────────
function setPreviewStatus(text: string): void {
  const el = document.getElementById("previewStatus");
  if (el) el.textContent = text;
  const panel = document.getElementById("previewPanelStatus");
  if (panel) panel.textContent = text;
}
function renderProfessionalMeter(a: any): void {
  if (!a) return;
  const existing = document.querySelector(".professional-meter");
  if (existing) existing.remove();
  const wrap = document.createElement("div");
  wrap.className = "professional-meter";
  const rows = [
    {
      label: "True Peak",
      value: a.true_peak_db,
      unit: "dBTP",
      status: a.true_peak_db > -0.5 ? "bad" : a.true_peak_db > -1.2 ? "warn" : "good",
      hint: "Inter-sample peak real",
    },
    {
      label: "PLR",
      value: a.plr_db,
      unit: "dB",
      status: a.plr_db > 10 ? "good" : a.plr_db > 6 ? "warn" : "bad",
      hint: "Peak-to-Loudness Ratio",
    },
    {
      label: "Dinámica",
      value: a.dynamic_range_db,
      unit: "dB",
      status: a.dynamic_range_db >= 10 ? "good" : a.dynamic_range_db >= 6 ? "warn" : "bad",
      hint: "Rango dinámico global",
    },
    {
      label: "Correlación estéreo",
      value: a.stereo_correlation,
      unit: "",
      status: a.stereo_correlation < 0.85 ? "warn" : "good",
      hint: "L/R total",
    },
    {
      label: "Mono compatibilidad",
      value: a.mono_compatibility_db,
      unit: "dB",
      status: a.mono_compatibility_db < -5 ? "bad" : a.mono_compatibility_db < -3 ? "warn" : "good",
      hint: "Pérdida al sumar L+R",
    },
    {
      label: "Loudness",
      value: a.lufs,
      unit: "LUFS",
      status: a.lufs >= -14 && a.lufs <= -9 ? "good" : a.lufs >= -18 && a.lufs < -14 ? "warn" : "bad",
      hint: "LUFS integrado",
    },
  ];
  const cards = rows
    .map((item) => {
      const suffix = item.unit ? ` ${item.unit}` : "";
      return `<div class="professional-meter-card"><strong>${item.label}</strong><span class="metric-value ${item.status}">${item.value != null ? item.value.toFixed(item.unit === "" ? 3 : 1) + suffix : "--"}</span><em>${item.hint}</em></div>`;
    })
    .join("");
  const warnings = [];
  if (a.true_peak_db != null && a.true_peak_db > -0.5) warnings.push("True peak peligroso: ajustá el ceiling para evitar clipping inter-sample.");
  if (a.mono_compatibility_db != null && a.mono_compatibility_db < -5) warnings.push("Compatibilidad mono baja: el mix puede colapsar al sumarlo a mono.");
  if (a.stereo_correlation != null && a.stereo_correlation < 0.8) warnings.push("Correlación estéreo baja: el paneo o los efectos pueden generar huecos o cancelaciones.");
  if (a.dynamic_range_db != null && a.dynamic_range_db < 6) warnings.push("Dinámica muy comprimida: cuidado con el limiteador para no aplastar el groove.");
  if (a.lufs != null && a.lufs > -9) warnings.push("El loudness ya es alto para streaming, mantené el ceiling conservador.");
  wrap.innerHTML = `
    <h3>Professional Metering</h3>
    <div class="professional-meter-grid">${cards}</div>
    ${warnings.length ? `<div class="professional-meter-warning">${warnings.map((line) => `• ${line}`).join("<br>")}</div>` : ""}
  `;
  LGMDM.ui.getContent().appendChild(wrap);
}





// ── Array de IDs que disparan preview (se usa en 10) ────────

// Expose externally-consumed functions as window globals for retrocompatibility
(window as any).renderFFT = renderFFT;
(window as any).renderAnalysisSingle = renderAnalysisSingle;
(window as any).renderAnalysisComparison = renderAnalysisComparison;
(window as any).renderPerceptualStandalone = renderPerceptualStandalone;
(window as any).setupABPlayer = setupABPlayer;
(window as any).stopABPlayer = _abStop;
(window as any).setPreviewStatus = setPreviewStatus;
window.LGMDM = window.LGMDM || {};
(window.LGMDM as any).visualizers = Object.assign((window.LGMDM as any).visualizers || {}, { renderFFT, renderAnalysisSingle, renderAnalysisComparison, renderPerceptualStandalone, setupABPlayer, stopAB: _abStop, setPreviewStatus });

// FIX: teardown — cancel RAF, UI timer, fade timer, disconnect gain, abort node.
function teardownAB() {
  try { _abStop(); } catch (_) {}
  if (_abRafId) { cancelAnimationFrame(_abRafId); _abRafId = null; }
  // FIX A7: cancelar el timer del crossfade para evitar playback post-teardown.
  if (_abFadeTimer) { clearTimeout(_abFadeTimer); _abFadeTimer = null; }
  if (_abUiTimer) { clearInterval(_abUiTimer); _abUiTimer = null; }
  if (_abGain) { try { _abGain.disconnect(); } catch (_) {} _abGain = null; }
  if (_abNode) { try { _abNode.stop(); _abNode.disconnect(); } catch (_) {} _abNode = null; }
}
window.LGMDM.ab = window.LGMDM.ab || {};
(window.LGMDM as any).ab.teardown = teardownAB;
// FIX C2: expose ab.stop so master-console's stopAllPlayback can halt A/B playback.
(window.LGMDM as any).ab.stop = _abStop;
window.addEventListener('beforeunload', teardownAB, { once: true });

})();

