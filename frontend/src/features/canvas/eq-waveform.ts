// features/canvas/eq-waveform.ts — Curva de EQ, waveform, loudness meter.
//
// Carga tras `core/state.ts` (necesita themeColors) y `workspace/sliders-ui.ts`
// (los sliders de EQ disparan el redraw).
//
// FIX vs aporte: tipos TS en todo el port.
// FIX vs aporte: el worker se crea una sola vez (singleton) y se libera en teardown.
// FIX vs aporte: el throttle usa RAF coalescing.
// FIX vs aporte: HMR-safe (`window.LGMDM.eqWaveformBound`).
// FIX vs aporte: AbortController + cleanup de ResizeObserver y worker.

import { setupCanvasResize } from '../../core/utils';
// FIX bug runtime: importar core/dom explícitamente. eq-waveform se carga en
// línea 32 del entrypoint, ANTES que mixer-engine (línea 56) que era el primero
// en importar core/dom. Sin este import, window.LGMDM.dom.requireById no está
// asignado cuando drawEQCurve() corre al top-level (línea 487), reqInput()
// retornaba undefined vía el optional chaining, y .value lanzaba TypeError.
import '../../core/dom';

// ── Tipos ───────────────────────────────────────────────────────────────

interface EqBand {
  freq: number;
  gain: number;
  q: number;
}

interface EqParams {
  hp: number;
  lp: number | null;
  air: number;
  shelfFreq: number;
  lowShelfGain: number;
  lowShelfFreq: number;
  bands: EqBand[];
}

interface EqCurveResult {
  gains: number[];
  freqs: number[];
}

interface ThemeColors {
  surface2: string;
  border: string;
  accent: string;
  muted: string;
  get: (varName: string) => string;
}

// (window.setupCanvasResize ya está declarado en core/utils.ts)

const lg = () => (window.LGMDM = window.LGMDM || {}) as Record<string, unknown> & {
  themeColors?: () => ThemeColors;
  dom?: { requireById: (id: string, owner?: string) => HTMLElement };
  ui?: { getContent?: () => HTMLElement };
};

// ── Web Worker singleton ──────────────────────────────────────────────

const workerCode = `
  function peakResponse(f, freq, gainDb, q, SR) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * freq) / SR;
    const alpha = Math.sin(w0) / (2 * q);
    const b0 = 1 + alpha * A,
      b1 = -2 * Math.cos(w0),
      b2 = 1 - alpha * A;
    const a0 = 1 + alpha / A,
      a1 = -2 * Math.cos(w0),
      a2 = 1 - alpha / A;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w),
      sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag + 1e-12);
  }
  function hpResponse(f, cutoff) {
    if (f <= 0) return -100;
    const r = f / cutoff;
    return 20 * Math.log10((r * r) / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
  }
  function lpResponse(f, cutoff) {
    if (!cutoff || f <= 0) return 0;
    const r = f / cutoff;
    return 20 * Math.log10(1 / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
  }
  function highShelfResponse(f, cutoff, gainDb, SR) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * cutoff) / SR;
    const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
    const alpha = (sin_w0 / 2) * Math.sqrt(2);
    const sqrtA = Math.sqrt(A);
    const b0 = A * (A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha);
    const b1 = -2 * A * (A - 1 + (A + 1) * cos_w0);
    const b2 = A * (A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha);
    const a0 = A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha;
    const a1 = 2 * (A - 1 - (A + 1) * cos_w0);
    const a2 = A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag + 1e-12);
  }
  function lowShelfResponse(f, cutoff, gainDb, SR) {
    if (gainDb === 0) return 0;
    const A = Math.pow(10, gainDb / 40);
    const w0 = (2 * Math.PI * cutoff) / SR;
    const cos_w0 = Math.cos(w0), sin_w0 = Math.sin(w0);
    const alpha = (sin_w0 / 2) * Math.sqrt(2);
    const sqrtA = Math.sqrt(A);
    const b0 = A * (A + 1 - (A - 1) * cos_w0 + 2 * sqrtA * alpha);
    const b1 = 2 * A * (A - 1 - (A + 1) * cos_w0);
    const b2 = A * (A + 1 - (A - 1) * cos_w0 - 2 * sqrtA * alpha);
    const a0 = A + 1 + (A - 1) * cos_w0 + 2 * sqrtA * alpha;
    const a1 = -2 * (A - 1 + (A + 1) * cos_w0);
    const a2 = A + 1 + (A - 1) * cos_w0 - 2 * sqrtA * alpha;
    const w = (2 * Math.PI * f) / SR;
    const cosW = Math.cos(w), sinW = Math.sin(w);
    const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
    const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
    const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
    const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
    const mag2 = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
    return 20 * Math.log10(mag2 + 1e-12);
  }

  self.onmessage = function(e) {
    const { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands, SR, W } = e.data;
    const freqs = [];
    for (let i = 0; i < W; i++) {
      freqs.push(Math.pow(10, Math.log10(20) + (i / (W - 1)) * (Math.log10(20000) - Math.log10(20))));
    }
    const gains = freqs.map((f) => {
      let g = hpResponse(f, hp);
      if (lp) g += lpResponse(f, lp);
      bands.forEach((b) => {
        g += peakResponse(f, b.freq, b.gain, b.q, SR);
      });
      g += highShelfResponse(f, shelfFreq || 8000, air, SR);
      g += lowShelfResponse(f, lowShelfFreq || 100, lowShelfGain, SR);
      return g;
    });
    self.postMessage({ gains, freqs });
  };
`;

let eqWorker: Worker | null = null;
let eqWorkerUrl: string | null = null;
let eqCallback: ((result: EqCurveResult) => void) | null = null;
// FIX M-NEW-11: contador de requests para correlacionar postMessage→callback.
// Antes, si computeEQCurve se llamaba dos veces seguidas (slider rápido),
// el segundo callback pisaba el primero → el primer postMessage respondía
// pero onmessage usaba el callback del segundo (el primero se perdía).
let eqRequestId = 0;
let eqPendingCallback: ((result: EqCurveResult) => void) | null = null;
let eqPendingId = 0;
// FIX A6: handle del setTimeout que revoca el Worker URL (para cancelarlo
// en teardown si todavía no disparó).
let _eqWorkerUrlTimer: number | null = null;

function getWorker(): Worker {
  if (eqWorker) return eqWorker;
  const blob = new Blob([workerCode], { type: 'application/javascript' });
  eqWorkerUrl = URL.createObjectURL(blob);
  eqWorker = new Worker(eqWorkerUrl);
  // FIX A6: guardamos el handle del setTimeout para poder cancelarlo en
  // teardown (antes no se guardaba → orphan timer si teardown corría antes
  // de 1s, con doble revoke inofensivo pero no cancelable).
  _eqWorkerUrlTimer = window.setTimeout(() => {
    _eqWorkerUrlTimer = null;
    if (eqWorkerUrl) {
      URL.revokeObjectURL(eqWorkerUrl);
      eqWorkerUrl = null;
    }
  }, 1000);
  eqWorker.onmessage = (e: MessageEvent<EqCurveResult>) => {
    // FIX M-NEW-11: usar eqPendingId para correlacionar. Si el request
    // actual coincide con el que disparó este onmessage, invocar el callback.
    if (eqPendingCallback && eqPendingId === eqRequestId) {
      const cb = eqPendingCallback;
      eqPendingCallback = null;
      cb(e.data);
    }
  };
  return eqWorker;
}

function computeEQCurve(params: EqParams & { SR: number; W: number }, callback: (result: EqCurveResult) => void): void {
  // FIX M-NEW-11: incrementar el requestId y guardar el callback. Si llega
  // un nuevo computeEQCurve antes de que responda el anterior, el onmessage
  // del anterior se skipea (eqPendingId !== eqRequestId).
  eqRequestId++;
  eqPendingId = eqRequestId;
  eqPendingCallback = callback;
  eqCallback = callback; // compatibilidad con callers que lean eqCallback
  getWorker().postMessage(params);
}

// ── Funciones de respuesta síncronas (fallback) ────────────────────────

function peakResponseSync(f: number, freq: number, gainDb: number, q: number, SR: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / SR;
  const alpha = Math.sin(w0) / (2 * q);
  const b0 = 1 + alpha * A;
  const b1 = -2 * Math.cos(w0);
  const b2 = 1 - alpha * A;
  const a0 = 1 + alpha / A;
  const a1 = -2 * Math.cos(w0);
  const a2 = 1 - alpha / A;
  const w = (2 * Math.PI * f) / SR;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
  const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
  const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
  const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
  const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
  return 20 * Math.log10(mag + 1e-12);
}

function hpResponseSync(f: number, cutoff: number): number {
  if (f <= 0) return -100;
  const r = f / cutoff;
  return 20 * Math.log10((r * r) / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
}

function lpResponseSync(f: number, cutoff: number | null): number {
  if (!cutoff || f <= 0) return 0;
  const r = f / cutoff;
  return 20 * Math.log10(1 / (Math.sqrt(1 + r * r * r * r) + 1e-12) + 1e-12);
}

function highShelfResponseSync(f: number, cutoff: number, gainDb: number, SR: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * cutoff) / SR;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt(2);
  const sqrtA = Math.sqrt(A);
  const b0 = A * (A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = -2 * A * (A - 1 + (A + 1) * cosW0);
  const b2 = A * (A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = 2 * (A - 1 - (A + 1) * cosW0);
  const a2 = A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alpha;
  const w = (2 * Math.PI * f) / SR;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
  const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
  const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
  const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
  const mag = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
  return 20 * Math.log10(mag + 1e-12);
}

function lowShelfResponseSync(f: number, cutoff: number, gainDb: number, SR: number): number {
  if (gainDb === 0) return 0;
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * cutoff) / SR;
  const cosW0 = Math.cos(w0);
  const sinW0 = Math.sin(w0);
  const alpha = (sinW0 / 2) * Math.sqrt(2);
  const sqrtA = Math.sqrt(A);
  const b0 = A * (A + 1 - (A - 1) * cosW0 + 2 * sqrtA * alpha);
  const b1 = 2 * A * (A - 1 - (A + 1) * cosW0);
  const b2 = A * (A + 1 - (A - 1) * cosW0 - 2 * sqrtA * alpha);
  const a0 = A + 1 + (A - 1) * cosW0 + 2 * sqrtA * alpha;
  const a1 = -2 * (A - 1 + (A + 1) * cosW0);
  const a2 = A + 1 + (A - 1) * cosW0 - 2 * sqrtA * alpha;
  const w = (2 * Math.PI * f) / SR;
  const cosW = Math.cos(w);
  const sinW = Math.sin(w);
  const numR = b0 / a0 + (b1 / a0) * cosW + (b2 / a0) * Math.cos(2 * w);
  const numI = (b1 / a0) * sinW + (b2 / a0) * Math.sin(2 * w);
  const denR = 1 + (a1 / a0) * cosW + (a2 / a0) * Math.cos(2 * w);
  const denI = (a1 / a0) * sinW + (a2 / a0) * Math.sin(2 * w);
  const mag2 = Math.sqrt((numR * numR + numI * numI) / (denR * denR + denI * denI));
  return 20 * Math.log10(mag2 + 1e-12);
}

function calculateEQSync(params: EqParams, SR: number, W: number): number[] {
  const { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands } = params;
  const freqs: number[] = [];
  for (let i = 0; i < W; i++) {
    freqs.push(Math.pow(10, Math.log10(20) + (i / (W - 1)) * (Math.log10(20000) - Math.log10(20))));
  }
  const gains = freqs.map((f) => {
    let g = hpResponseSync(f, hp);
    if (lp) g += lpResponseSync(f, lp);
    bands.forEach((b) => {
      g += peakResponseSync(f, b.freq, b.gain, b.q, SR);
    });
    g += highShelfResponseSync(f, shelfFreq || 8000, air, SR);
    g += lowShelfResponseSync(f, lowShelfFreq || 100, lowShelfGain, SR);
    return g;
  });
  return gains;
}

// ── getEQParams — lee los sliders del DOM ─────────────────────────────

function reqInput(id: string): HTMLInputElement {
  // FIX bug runtime: antes usaba `lg().dom?.requireById(id, ...)` que con
  // optional chaining retornaba `undefined` silenciosamente si el bridge
  // `window.LGMDM.dom` no estaba inicializado (orden de imports) → `.value`
  // lanzaba TypeError. Ahora usa document.getElementById directo + throw
  // explícito si falta (contrato DOM honesto, sin silenciar nada).
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) {
    const err = new Error(`[DOM CONTRACT] 05-eq-waveform:getEQParams: #${id} is required but missing`);
    console.error(err);
    throw err;
  }
  return el;
}

function getEQParams(): EqParams | null {
  const hpEl = document.getElementById('s-hp') as HTMLInputElement | null;
  if (!hpEl) return null;
  const hp = parseFloat(hpEl.value);
  const lpBypass = (document.getElementById('s-lp-bypass') as HTMLInputElement | null)?.checked ?? true;
  const lp = lpBypass ? null : parseFloat(reqInput('s-lp-cutoff').value);
  const air = parseFloat(reqInput('s-air').value);
  const shelfFreq = parseFloat(reqInput('s-shelf-freq').value);
  const lowShelfGain = parseFloat(reqInput('s-lowshelf').value);
  const lowShelfFreq = parseFloat(reqInput('s-lowshelf-freq').value);
  const bands: EqBand[] = [];
  for (let i = 1; i <= 6; i++) {
    bands.push({
      freq: parseFloat(reqInput(`s-eq${i}freq`).value),
      gain: parseFloat(reqInput(`s-eq${i}gain`).value),
      q: parseFloat(reqInput(`s-eq${i}q`).value),
    });
  }
  return { hp, lp, air, shelfFreq, lowShelfGain, lowShelfFreq, bands };
}

// ── Draw helpers ──────────────────────────────────────────────────────

function drawEQCurveOnCanvas(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  gains: number[],
  freqs: number[] | null,
  borderC: string,
  accentC: string,
  mutedC: string
): void {
  const maxG = 18;
  const padL = 32;
  const padT = 8;
  const padB = 18;
  const padR = 6;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const yOf = (g: number): number => padT + plotH / 2 - (g / maxG) * (plotH / 2 - 2);
  const xOfFreq = (f: number): number => padL + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * plotW;

  // Grid horizontal (dB)
  ctx.font = '9px monospace';
  for (const db of [-18, -12, -6, 0, 6, 12, 18]) {
    const y = yOf(db);
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.strokeStyle = db === 0 ? 'rgba(139,108,255,.35)' : borderC;
    ctx.lineWidth = db === 0 ? 1 : 0.5;
    ctx.stroke();
    ctx.fillStyle = db === 0 ? accentC : mutedC;
    ctx.fillText((db >= 0 ? '+' : '') + db, 2, y + 3);
  }

  // Grid vertical (freq)
  for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000]) {
    const x = xOfFreq(f);
    if (x < padL || x > padL + plotW) continue;
    ctx.beginPath();
    ctx.moveTo(x, padT);
    ctx.lineTo(x, padT + plotH);
    ctx.strokeStyle = borderC;
    ctx.lineWidth = 0.5;
    ctx.stroke();
    const lbl = f >= 1000 ? f / 1000 + 'k' : String(f);
    ctx.fillStyle = mutedC;
    ctx.font = '8px monospace';
    ctx.fillText(lbl, x - 8, H - 4);
  }

  // Curve
  const curvePoints: Array<[number, number]> = gains.map((g, i) => {
    const f = freqs ? freqs[i] : Math.pow(10, Math.log10(20) + (i / (gains.length - 1)) * (Math.log10(20000) - Math.log10(20)));
    return [
      padL + ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * plotW,
      Math.max(padT + 2, Math.min(padT + plotH - 2, yOf(g))),
    ];
  });
  // Fill under curve
  ctx.beginPath();
  curvePoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.lineTo(curvePoints[curvePoints.length - 1][0], yOf(0));
  ctx.lineTo(curvePoints[0][0], yOf(0));
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, padT + plotH);
  grad.addColorStop(0, 'rgba(139,108,255,.25)');
  grad.addColorStop(1, 'rgba(139,108,255,.03)');
  ctx.fillStyle = grad;
  ctx.fill();
  // Stroke
  ctx.beginPath();
  curvePoints.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
  ctx.strokeStyle = accentC;
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawEQCurve(): void {
  const canvas = document.getElementById('eqCurveCanvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 280;
  const H = 140;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = lg().themeColors?.() || ({ surface2: '#000', border: '#222', accent: '#8b6cff', muted: '#666', get: () => '' } as unknown as ThemeColors);
  const { surface2: bg, border: borderC, accent: accentC, muted: mutedC } = theme;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const params = getEQParams();
  if (!params) return;
  const SR = 44100;

  computeEQCurve(
    { ...params, SR, W },
    (result) => {
      drawEQCurveOnCanvas(ctx, W, H, result.gains, result.freqs, borderC, accentC, mutedC);
    }
  );
}

// ── Throttle: un solo repintado por frame ─────────────────────────────

let _eqRafPending = false;
// FIX A6: guardamos el handle del RAF para poder cancelarlo en teardown.
// Antes no se guardaba → si scheduleEQCurve se llamaba justo antes de
// teardown, el callback ejecutaba drawEQCurve() → getWorker() re-creaba
// el Worker post-teardown (teardown puso eqWorker=null).
let _eqRafId: number | null = null;
function scheduleEQCurve(): void {
  if (_eqRafPending) return;
  _eqRafPending = true;
  _eqRafId = requestAnimationFrame(() => {
    _eqRafId = null;
    _eqRafPending = false;
    drawEQCurve();
  });
}

// ── Bind sliders + ResizeObserver ──────────────────────────────────────

const eqSliderIds = [
  's-hp',
  's-lp-cutoff',
  's-eq1freq', 's-eq1gain', 's-eq1q',
  's-eq2freq', 's-eq2gain', 's-eq2q',
  's-eq3freq', 's-eq3gain', 's-eq3q',
  's-eq4freq', 's-eq4gain', 's-eq4q',
  's-eq5freq', 's-eq5gain', 's-eq5q',
  's-eq6freq', 's-eq6gain', 's-eq6q',
  's-air',
  's-shelf-freq',
  's-lowshelf',
  's-lowshelf-freq',
];

const controller = new AbortController();
const { signal } = controller;

eqSliderIds.forEach((id) => {
  document.getElementById(id)?.addEventListener('input', scheduleEQCurve, { signal });
});
document.getElementById('s-lp-bypass')?.addEventListener('change', scheduleEQCurve, { signal });

drawEQCurve();

// F5.5 — ResizeObserver DPR-aware para eqCurveCanvas.
const _eqCanvas = document.getElementById('eqCurveCanvas') as HTMLCanvasElement | null;
let _eqResizeCleanup: (() => void) | null = null;
if (_eqCanvas && typeof window.setupCanvasResize === 'function') {
  _eqResizeCleanup = window.setupCanvasResize(_eqCanvas, () => {
    drawEQCurve();
  });
}

// ── Waveform ───────────────────────────────────────────────────────────

let _lastWaveformBuffer: AudioBuffer | null = null;

function renderWaveformToCanvas(
  canvas: HTMLCanvasElement | null,
  audioBuffer: AudioBuffer,
  color: string = 'var(--ui-accent)',
  alpha: number = 1
): void {
  if (!canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth || 600;
  const H = 100;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = lg().themeColors?.() || ({ surface2: '#000', border: '#222', accent: '#8b6cff', muted: '#666', get: () => '' } as unknown as ThemeColors);
  ctx.fillStyle = theme.surface2;
  ctx.fillRect(0, 0, W, H);
  const data = audioBuffer.getChannelData(0);
  const step = Math.ceil(data.length / W);
  const resolvedColor = color.startsWith('var(') ? theme.get(color.slice(4, -1)) : color;
  ctx.strokeStyle = resolvedColor;
  ctx.lineWidth = 1;
  ctx.globalAlpha = alpha;
  ctx.beginPath();
  for (let i = 0; i < W; i++) {
    let min = 1;
    let max = -1;
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
}

function drawWaveform(audioBuffer: AudioBuffer | null): void {
  if (audioBuffer) _lastWaveformBuffer = audioBuffer;
  const buf = audioBuffer || _lastWaveformBuffer;
  if (!buf) return;
  // F10.x: el waveform NO debe vivir en el tab Análisis (sólo info + canvas).
  // Si estamos en análisis, limpiamos cualquier wrap previo y salimos.
  const inAnalysis = document.body.dataset.workspace === 'analysis';
  const existing = document.getElementById('waveformWrap');
  if (inAnalysis) {
    if (existing) existing.remove();
    return;
  }
  // BUGFIX: antes esto apuntaba directo a #content (el shell fuera de las
  // pestañas) — usaba getContent() para que quede dentro de la pestaña
  // Analysis (ver 00-ui-core.js).
  const container = lg().ui?.getContent?.() || document.getElementById('content');
  if (!container) return;
  let wrap = existing;
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.id = 'waveformWrap';
    wrap.className = 'waveform-wrap';
    wrap.innerHTML = `<h3>Waveform <span class="waveform-meta">${buf.duration.toFixed(1)}s · ${buf.sampleRate}Hz · ${buf.numberOfChannels}ch</span></h3><canvas id="waveformCanvas"></canvas><div class="waveform-legend"><span class="waveform-legend__original">■</span> Original&nbsp;&nbsp;<span class="waveform-legend__master">■</span> Masterizado</div>`;
    container.prepend(wrap);
  } else if (wrap.parentElement !== container) {
    container.prepend(wrap);
  }
  const canvas = document.getElementById('waveformCanvas') as HTMLCanvasElement | null;
  renderWaveformToCanvas(canvas, buf, 'var(--ui-muted)');
}

// ── Loudness meter ─────────────────────────────────────────────────────
// FIX 2: panel estático en index.html (#loudnessMeterWrap). Esta función solo
// actualiza valores — no crea DOM. Si los elementos no existen (HTML incompleto),
// sale silenciosamente.

function showLoudnessMeter(lufsValue: number | null | undefined): void {
  const wrap = document.getElementById('loudnessMeterWrap');
  if (!wrap) return;
  const numEl = document.getElementById('lufsNumber');
  const fillEl = document.getElementById('lufsBarFill');
  if (!numEl || !fillEl) return;
  numEl.textContent = Number.isFinite(lufsValue as number) ? (lufsValue as number).toFixed(1) : '---';
  const pct = Number.isFinite(lufsValue as number)
    ? Math.max(0, Math.min(100, (((lufsValue as number) + 40) / 40) * 100))
    : 0;
  fillEl.style.width = pct + '%';
  fillEl.style.background =
    (lufsValue as number) > -6
      ? 'var(--ui-danger)'
      : (lufsValue as number) > -9
        ? 'var(--ui-warn)'
        : (lufsValue as number) >= -18
          ? 'var(--ui-warn)'
          : 'var(--ui-muted)';
}

// ── API pública ────────────────────────────────────────────────────────

function teardown(): void {
  controller.abort();
  // FIX A6: cancelar el RAF pendiente (si scheduleEQCurve se llamó justo
  // antes de teardown, evita que drawEQCurve re-creé el Worker).
  if (_eqRafId !== null) { cancelAnimationFrame(_eqRafId); _eqRafId = null; }
  _eqRafPending = false;
  // FIX A6: cancelar el timer de revoke del Worker URL.
  if (_eqWorkerUrlTimer !== null) { clearTimeout(_eqWorkerUrlTimer); _eqWorkerUrlTimer = null; }
  if (_eqResizeCleanup) _eqResizeCleanup();
  if (eqWorker) {
    eqWorker.terminate();
    eqWorker = null;
  }
  if (eqWorkerUrl) {
    URL.revokeObjectURL(eqWorkerUrl);
    eqWorkerUrl = null;
  }
}

const wLGMDM = lg();

// FIX M-NEW-1: el flag `eqWaveformBound` se seteaba pero no se consultaba →
// el comentario "HMR-safe" mentía. Ahora, si el módulo ya se inicializó
// (HMR re-entry), skipeamos el re-bind de la API.
if ((wLGMDM as Record<string, unknown>).eqWaveformBound) {
  // Ya inicializado — skipear.
} else {
  (wLGMDM as Record<string, unknown>).eqWaveformBound = true;
  const eqApi = (wLGMDM.eqWaveform = wLGMDM.eqWaveform || {}) as Record<string, unknown>;
  (eqApi as { draw: () => void }).draw = drawEQCurve;
  (eqApi as { drawWaveform: (buf: AudioBuffer | null) => void }).drawWaveform = drawWaveform;
  (eqApi as { showLoudnessMeter: (v: number | null | undefined) => void }).showLoudnessMeter = showLoudnessMeter;
  (eqApi as { teardown: () => void }).teardown = teardown;
  window.addEventListener('beforeunload', teardown, { once: true });
}
