// reverb.ts — pro widget

import { clamp } from '../../../core/utils';

interface ReverbType { id: string; label: string; note: string; }

const REVERB_TYPES: readonly ReverbType[] = [
  { id: 'Hall',    label: '🏛 Hall',    note: 'Iglesia / catedral' },
  { id: 'Plate',   label: '🎚 Plate',   note: 'Placa metálica vintage' },
  { id: 'Room',    label: '🏠 Room',    note: 'Sala acústica pequeña' },
  { id: 'Chamber', label: '🎻 Chamber', note: 'Cámara de eco clásica' },
];

type KnobId = 'room_size' | 'pre_delay_ms' | 'decay_sec' | 'wet';

interface KnobSpec {
  id: KnobId;
  label: string;
  min: number;
  max: number;
  step: number;
  unit: string;
  fmt: (v: number) => string;
}

// Knob specs: id, label, min, max, step, unit, formatter
const KNOBS: readonly KnobSpec[] = [
  { id: 'room_size',    label: 'Room Size',  min: 0,   max: 1,   step: 0.01, unit: '',  fmt: (v) => `${(v * 100).toFixed(0)}%` },
  { id: 'pre_delay_ms', label: 'Pre-delay',  min: 0,   max: 200, step: 1,    unit: 'ms', fmt: (v) => `${v.toFixed(0)} ms` },
  { id: 'decay_sec',    label: 'Decay',      min: 0.1, max: 10,  step: 0.1,  unit: 's',  fmt: (v) => `${v.toFixed(2)} s` },
  { id: 'wet',          label: 'Wet (mix)',  min: 0,   max: 1,   step: 0.01, unit: '',  fmt: (v) => `${(v * 100).toFixed(0)}%` },
];

// ── Types ──────────────────────────────────────────────────────
export interface ReverbState {
  room_size: number;
  pre_delay_ms: number;
  decay_sec: number;
  wet: number;
  reverb_type: string;
  spectrogram: number[][] | null;
}

interface DragState {
  knobId: KnobId;
  knobSpec: KnobSpec;
  startY: number;
  startVal: number;
  range: number;
  rect: DOMRect;
  cx: number;
  cy: number;
  pointerId: number;
}

interface LgmdmUi {
  ui?: { showToast?: (msg: string, kind: string, ms: number) => void };
}

// ── Widget ─────────────────────────────────────────────────────
export class ReverbWidget {
  canvas: HTMLCanvasElement | null = null;
  root: HTMLElement | null = null;
  cardEl: HTMLDivElement | null = null;
  specCanvas: HTMLCanvasElement | null = null;
  specCtx: CanvasRenderingContext2D | null = null;
  rafId: number | null = null;

  state: ReverbState = {
    room_size: 0.7,
    pre_delay_ms: 30,
    decay_sec: 2.5,
    wet: 0.3,
    reverb_type: 'Hall',
    spectrogram: null,
  };

  private _values: ReverbState = { ...this.state };
  private _drag: DragState | null = null;
  private _ro: ResizeObserver | null = null;
  private _ac: AbortController | null = null;
  private _beforeUnload: (() => void) | null = null;
  private _destroyed = false;

  static Insert?: unknown;

  constructor() { /* noop */ }

  init(canvas: HTMLCanvasElement, options: Partial<ReverbState> = {}): void {
    this.canvas = canvas;
    this.root = canvas.parentElement;
    if (!this.root) return;

    this._ac = new AbortController();
    const signal = this._ac.signal;

    this._applyOptions(options);

    const card = document.createElement('div');
    card.className = 'pro-meter-card reverb-widget';
    card.innerHTML = `
      <div class="reverb-widget__head">
        <strong class="pro-card-title" style="font-size:.78rem;">
          🌫 Automatic Reverb Designer
        </strong>
        <span class="reverb-widget__head-meta">
          Room Size · Pre-delay · Decay · Wet Mix
        </span>
      </div>

      <div style="display:flex;gap:1rem;flex-wrap:wrap;align-items:flex-start;">
        <div id="rvKnoBbox" class="reverb-widget__knob-box">
          ${KNOBS.map((k) => this._knobHtml(k)).join('')}
        </div>
      </div>

      <div class="pro-control-row reverb-widget__types-row"
           style="display:grid;grid-template-columns:140px 1fr;align-items:center;gap:.8rem;">
        <label style="font-size:.72rem;color:var(--ui-muted);">Reverb Type</label>
        <div id="rvTypes" class="reverb-widget__types">
          ${REVERB_TYPES.map((t) => `
            <button type="button" class="rv-type-btn" data-type="${t.id}">
              <div class="rv-type-btn__label">${t.label}</div>
              <div class="rv-type-btn__note">${t.note}</div>
            </button>
          `).join('')}
        </div>
      </div>

      <div class="reverb-widget__actions">
        <button id="rvGenerateIR" class="pro-secondary">
          🌫 Generate IR
        </button>
        <button id="rvApply" class="pro-primary">
          ⚡ Apply Reverb
        </button>
      </div>

      <div class="pro-meter-card reverb-widget__spectrogram-wrap">
        <span>
          Spectrogram preview (audio con reverb)
        </span>
        <canvas id="rvSpectrogram" class="reverb-widget__spectrogram" width="400" height="100"></canvas>
      </div>
    `;
    this.cardEl = card;

    if (this.canvas.parentElement === this.root) {
      this.canvas.insertAdjacentElement('afterend', card);
    } else {
      this.root.appendChild(card);
    }

    this._setupSpectrogramCanvas();
    this._renderStatic();
    this._wireEvents(signal);
    this._bindResize(signal);

    this._beforeUnload = () => { try { this.teardown(); } catch (_) { /* noop */ } };
    window.addEventListener('beforeunload', this._beforeUnload, { once: true, signal });
  }

  private _bindResize(signal: AbortSignal): void {
    if (typeof ResizeObserver === 'undefined' || !this.specCanvas) return;
    this._ro = new ResizeObserver(() => this._drawSpectrogram());
    this._ro.observe(this.specCanvas);
    signal.addEventListener('abort', () => {
      try { this._ro?.disconnect(); } catch (_) { /* noop */ }
      this._ro = null;
    });
  }

  update(data: Partial<ReverbState> = {}): void {
    if (!data) return;
    if (Number.isFinite(Number(data.room_size))) this._values.room_size = clamp(Number(data.room_size), 0, 1);
    if (Number.isFinite(Number(data.pre_delay_ms))) this._values.pre_delay_ms = clamp(Number(data.pre_delay_ms), 0, 200);
    if (Number.isFinite(Number(data.decay_sec))) this._values.decay_sec = clamp(Number(data.decay_sec), 0.1, 10);
    if (Number.isFinite(Number(data.wet))) this._values.wet = clamp(Number(data.wet), 0, 1);
    if (typeof data.reverb_type === 'string') this._values.reverb_type = data.reverb_type;
    if (Array.isArray(data.spectrogram)) this._values.spectrogram = data.spectrogram;

    // Snapshot to state
    this.state.room_size = this._values.room_size;
    this.state.pre_delay_ms = this._values.pre_delay_ms;
    this.state.decay_sec = this._values.decay_sec;
    this.state.wet = this._values.wet;
    this.state.reverb_type = this._values.reverb_type;
    this.state.spectrogram = this._values.spectrogram;

    this._syncControls();
    this._drawSpectrogram();
  }

  destroy(): void { this.teardown(); }

  teardown(): void {
    if (this._destroyed) return;
    this._destroyed = true;
    if (this.rafId != null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    try { this._ac?.abort(); } catch (_) { /* noop */ }
    this._ac = null;
    this._ro = null;
    this._beforeUnload = null;
    this._drag = null;
    if (this.cardEl && this.cardEl.parentElement) {
      try { this.cardEl.parentElement.removeChild(this.cardEl); } catch (_) { /* noop */ }
    }
    this.cardEl = null;
    this.specCanvas = null;
    this.specCtx = null;
    this.canvas = null;
    this.root = null;
  }

  getControls(): string {
    return `
      <div style="display:flex;flex-direction:column;gap:.75rem;">
        <div style="display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.6rem;">
          ${KNOBS.map((k) => this._knobHtml(k)).join('')}
        </div>
        <div style="display:flex;gap:.35rem;flex-wrap:wrap;">
          ${REVERB_TYPES.map((t) => `
            <button type="button" data-type="${t.id}"
                    style="flex:1;min-width:80px;padding:.45rem .55rem;border-radius:9px;
                           border:1px solid rgba(255,255,255,.08);
                           background:rgba(255,255,255,.03);color:var(--ui-muted,#9ba6c4);
                           cursor:pointer;font-size:.72rem;">
              <div style="font-weight:750;">${t.label}</div>
            </button>
          `).join('')}
        </div>
        <div style="display:flex;gap:.5rem;flex-wrap:wrap;justify-content:flex-end;">
          <button data-role="generate-ir"
                  style="border-radius:10px;padding:.6rem 1.1rem;cursor:pointer;
                         border:1px solid rgba(255,255,255,.12);
                         background:rgba(255,255,255,.04);color:var(--ui-text,#eef3ff);
                         font-weight:750;">
            🌫 Generate IR
          </button>
          <button data-role="apply"
                  style="border-radius:10px;padding:.6rem 1.1rem;cursor:pointer;
                         border:1px solid rgba(92,232,255,.35);
                         background:linear-gradient(135deg,#42d9ff,#9b59ff);
                         color:#071018;font-weight:750;">
            ⚡ Apply Reverb
          </button>
        </div>
      </div>
    `;
  }

  // ── internals ───────────────────────────────────────────────────
  private _applyOptions(options: Partial<ReverbState>): void {
    if (Number.isFinite(Number(options.room_size))) this._values.room_size = clamp(Number(options.room_size), 0, 1);
    if (Number.isFinite(Number(options.pre_delay_ms))) this._values.pre_delay_ms = clamp(Number(options.pre_delay_ms), 0, 200);
    if (Number.isFinite(Number(options.decay_sec))) this._values.decay_sec = clamp(Number(options.decay_sec), 0.1, 10);
    if (Number.isFinite(Number(options.wet))) this._values.wet = clamp(Number(options.wet), 0, 1);
    if (typeof options.reverb_type === 'string') this._values.reverb_type = options.reverb_type;
    this.state.room_size = this._values.room_size;
    this.state.pre_delay_ms = this._values.pre_delay_ms;
    this.state.decay_sec = this._values.decay_sec;
    this.state.wet = this._values.wet;
    this.state.reverb_type = this._values.reverb_type;
  }

  private _knobHtml(k: KnobSpec): string {
    const v = this._values[k.id];
    const min = k.min;
    const max = k.max;
    const t = (v - min) / (max - min);
    const angle = -135 + t * 270; // 270° sweep from -135° to +135°
    return `
      <div class="rv-knob-wrap" data-knob="${k.id}"
           style="display:flex;flex-direction:column;align-items:center;gap:.25rem;
                  padding:.45rem .35rem;border-radius:10px;
                  background:rgba(255,255,255,.02);
                  border:1px solid rgba(255,255,255,.05);
                  user-select:none;">
        <div class="rv-knob" data-knob="${k.id}"
             role="slider" aria-label="${k.label}" tabindex="0"
             style="position:relative;width:54px;height:54px;border-radius:50%;
                    background:radial-gradient(circle at 30% 30%, #1c2438 0%, #0a0f1e 70%);
                    border:1.5px solid rgba(125,232,255,.25);
                    box-shadow:0 0 12px rgba(82,242,189,.18), inset 0 2px 4px rgba(0,0,0,.6);
                    cursor:grab;outline:none;">
          <span class="rv-knob-indicator" data-knob="${k.id}"
                style="position:absolute;left:50%;top:6px;width:2px;height:14px;
                       background:#52f2bd;border-radius:2px;
                       box-shadow:0 0 4px #52f2bd;
                       transform-origin:50% 21px;
                       transform:translate(-50%, 0) rotate(${angle}deg);
                       pointer-events:none;"></span>
        </div>
        <strong style="font-size:.62rem;color:#dcfbff;font-weight:750;">${k.label}</strong>
        <output class="rv-knob-val" data-knob="${k.id}"
                style="font-size:.68rem;color:#bdf8ff;font-family:monospace;">
          ${k.fmt(v)}
        </output>
      </div>
    `;
  }

  private _setupSpectrogramCanvas(): void {
    const c = this.cardEl?.querySelector<HTMLCanvasElement>('#rvSpectrogram') ?? null;
    this.specCanvas = c;
    this.specCtx = c ? c.getContext('2d') : null;
    if (!c || !this.specCtx) return;
    const cssW = c.clientWidth || c.width;
    const cssH = c.clientHeight || c.height;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (c.width !== Math.floor(cssW * dpr) || c.height !== Math.floor(cssH * dpr)) {
      c.width = Math.max(1, Math.floor(cssW * dpr));
      c.height = Math.max(1, Math.floor(cssH * dpr));
      this.specCtx.setTransform(1, 0, 0, 1, 0, 0);
      this.specCtx.scale(dpr, dpr);
    }
  }

  private _renderStatic(): void {
    this._syncControls();
    this._drawSpectrogram();
  }

  private _syncControls(): void {
    if (!this.cardEl) return;
    // Update knob angles and value outputs
    KNOBS.forEach((k) => {
      const v = this._values[k.id];
      const t = (v - k.min) / (k.max - k.min);
      const angle = -135 + t * 270;
      const ind = this.cardEl?.querySelector<HTMLElement>(`.rv-knob-indicator[data-knob="${k.id}"]`) ?? null;
      if (ind) ind.style.transform = `translate(-50%, 0) rotate(${angle}deg)`;
      const out = this.cardEl?.querySelector<HTMLElement>(`.rv-knob-val[data-knob="${k.id}"]`) ?? null;
      if (out) out.textContent = k.fmt(v);
    });
    // Update active type button
    this.cardEl.querySelectorAll<HTMLButtonElement>('.rv-type-btn').forEach((btn) => {
      const active = btn.dataset.type === this._values.reverb_type;
      btn.style.background = active
        ? 'rgba(82,242,189,.18)'
        : 'rgba(255,255,255,.03)';
      btn.style.borderColor = active
        ? 'rgba(82,242,189,.55)'
        : 'rgba(255,255,255,.08)';
      btn.style.color = active ? '#dcfbff' : 'var(--ui-muted,#9ba6c4)';
    });
  }

  private _wireEvents(signal: AbortSignal): void {
    if (!this.cardEl) return;
    const card = this.cardEl;

    // Knob drag (mouse + touch + wheel + keyboard)
    KNOBS.forEach((k) => {
      const knob = card.querySelector<HTMLDivElement>(`.rv-knob[data-knob="${k.id}"]`);
      if (!knob) return;

      const onPointerDown = (e: PointerEvent): void => {
        e.preventDefault();
        const rect = knob.getBoundingClientRect();
        const cx = rect.left + rect.width / 2;
        const cy = rect.top + rect.height / 2;
        const startY = e.clientY;
        const startVal = this._values[k.id];
        this._drag = {
          knobId: k.id,
          knobSpec: k,
          startY,
          startVal,
          range: k.max - k.min,
          rect,
          cx, cy,
          pointerId: e.pointerId,
        };
        knob.style.cursor = 'grabbing';
        try { knob.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      };

      const onPointerMove = (e: PointerEvent): void => {
        if (!this._drag || this._drag.knobId !== k.id) return;
        const cy = e.clientY;
        const dy = this._drag.startY - cy;
        // 200 px de desplazamiento vertical = rango completo
        const delta = (dy / 200) * this._drag.range;
        let next = this._drag.startVal + delta;
        next = Math.round(next / k.step) * k.step;
        next = clamp(next, k.min, k.max);
        this._values[k.id] = next;
        this._syncControls();
      };

      const onPointerUp = (e: PointerEvent): void => {
        if (!this._drag || this._drag.knobId !== k.id) return;
        this._drag = null;
        knob.style.cursor = 'grab';
        try { knob.releasePointerCapture(e.pointerId); } catch (_) { /* noop */ }
      };

      const onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        const step = (e.shiftKey ? k.step * 0.2 : k.step) * (e.deltaY < 0 ? 1 : -1);
        const next = clamp(this._values[k.id] + step * 10, k.min, k.max);
        this._values[k.id] = Math.round(next / k.step) * k.step;
        this._syncControls();
      };

      const onKey = (e: KeyboardEvent): void => {
        let delta = 0;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') delta = +k.step;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') delta = -k.step;
        else if (e.key === 'PageUp') delta = +k.step * 10;
        else if (e.key === 'PageDown') delta = -k.step * 10;
        else if (e.key === 'Home') { this._values[k.id] = k.min; this._syncControls(); return; }
        else if (e.key === 'End') { this._values[k.id] = k.max; this._syncControls(); return; }
        else return;
        e.preventDefault();
        const next = clamp(this._values[k.id] + delta, k.min, k.max);
        this._values[k.id] = Math.round(next / k.step) * k.step;
        this._syncControls();
      };

      const onDblClick = (): void => {
        // Doble click → reset al mínimo
        this._values[k.id] = k.min;
        this._syncControls();
      };

      knob.addEventListener('pointerdown', onPointerDown, { signal });
      knob.addEventListener('pointermove', onPointerMove, { signal });
      knob.addEventListener('pointerup', onPointerUp, { signal });
      knob.addEventListener('pointercancel', onPointerUp, { signal });
      knob.addEventListener('wheel', onWheel, { passive: false, signal });
      knob.addEventListener('keydown', onKey, { signal });
      knob.addEventListener('dblclick', onDblClick, { signal });
    });

    // Type buttons
    card.querySelectorAll<HTMLButtonElement>('.rv-type-btn').forEach((btn) => {
      const handler = (): void => {
        this._values.reverb_type = btn.dataset.type ?? 'Hall';
        this._syncControls();
      };
      btn.addEventListener('click', handler, { signal });
    });

    // Generate IR
    const genBtn = card.querySelector<HTMLButtonElement>('#rvGenerateIR');
    if (genBtn) {
      const handler = (): void => this._emitGenerateIR();
      genBtn.addEventListener('click', handler, { signal });
    }
    // Apply
    const applyBtn = card.querySelector<HTMLButtonElement>('#rvApply');
    if (applyBtn) {
      const handler = (): void => this._emitApply();
      applyBtn.addEventListener('click', handler, { signal });
    }
  }

  private _emitGenerateIR(): void {
    const payload = {
      room_size: this._values.room_size,
      pre_delay_ms: this._values.pre_delay_ms,
      decay_sec: this._values.decay_sec,
      wet: this._values.wet,
      reverb_type: this._values.reverb_type,
    };
    window.dispatchEvent(new CustomEvent('reverb-generate-ir', { detail: payload }));
    const toast = (window as Window & { LGMDM?: LgmdmUi }).LGMDM?.ui?.showToast;
    if (typeof toast === 'function') {
      toast(
        `Generando IR ${this._values.reverb_type} (room=${payload.room_size.toFixed(2)}, decay=${payload.decay_sec.toFixed(2)}s)…`,
        'info',
        2500,
      );
    }
  }

  private _emitApply(): void {
    const payload = {
      room_size: this._values.room_size,
      pre_delay_ms: this._values.pre_delay_ms,
      decay_sec: this._values.decay_sec,
      wet: this._values.wet,
      reverb_type: this._values.reverb_type,
    };
    window.dispatchEvent(new CustomEvent('reverb-apply', { detail: payload }));
    const toast = (window as Window & { LGMDM?: LgmdmUi }).LGMDM?.ui?.showToast;
    if (typeof toast === 'function') {
      toast('Reverb aplicado.', 'success', 2500);
    }
  }

  private _drawSpectrogram(): void {
    if (!this.specCtx || !this.specCanvas) return;
    const cssW = this.specCanvas.clientWidth || this.specCanvas.width;
    const cssH = this.specCanvas.clientHeight || this.specCanvas.height;
    const ctx = this.specCtx;
    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, cssW, cssH);

    const data = this._values.spectrogram;
    if (data === null || data.length === 0) {
      this._drawSpectrogramPlaceholder(cssW, cssH);
      return;
    }
    // data: 2D array [time][freq] con magnitudes normalizadas [0..1]
    const timeBins = data.length;
    const freqBins = data[0].length;
    if (timeBins === 0 || freqBins === 0) {
      this._drawSpectrogramPlaceholder(cssW, cssH);
      return;
    }

    // Dibujo: freq en Y (alta arriba), time en X
    const cellW = cssW / timeBins;
    const cellH = cssH / freqBins;
    for (let t = 0; t < timeBins; t++) {
      const row = data[t];
      for (let f = 0; f < freqBins; f++) {
        const mag = clamp(Number(row[f]), 0, 1);
        if (mag <= 0) continue;
        const [r, g, b] = this._magColor(mag);
        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${0.25 + mag * 0.75})`;
        const x = Math.floor(t * cellW);
        const y = cssH - Math.floor((f + 1) * cellH);
        ctx.fillRect(x, y, Math.ceil(cellW) + 1, Math.ceil(cellH) + 1);
      }
    }
  }

  private _drawSpectrogramPlaceholder(w: number, h: number): void {
    if (!this.specCtx) return;
    const ctx = this.specCtx;
    ctx.fillStyle = '#070912';
    ctx.fillRect(0, 0, w, h);
    // Gradiente de fallback con la "firma" del tipo de reverb
    const type = this._values.reverb_type;
    const PALETTES: Record<string, [number, number, number][]> = {
      Hall:    [[7, 12, 36], [82, 242, 189], [255, 216, 77]],
      Plate:   [[7, 12, 36], [125, 232, 255], [255, 95, 114]],
      Room:    [[7, 12, 36], [155, 89, 255], [82, 242, 189]],
      Chamber: [[7, 12, 36], [255, 159, 67], [82, 242, 189]],
    };
    const palette = PALETTES[type] || PALETTES.Hall;
    const grd = ctx.createLinearGradient(0, 0, 0, h);
    grd.addColorStop(0, `rgba(${palette[0].join(',')},1)`);
    grd.addColorStop(0.55, `rgba(${palette[1].join(',')},0.45)`);
    grd.addColorStop(1, `rgba(${palette[2].join(',')},0.9)`);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, w, h);
    // Texto de "no data"
    ctx.fillStyle = 'rgba(7,9,18,0.78)';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Esperando spectrogram (${type})`, w / 2, h / 2);
  }

  private _magColor(mag: number): [number, number, number] {
    // Mismo gradiente perceptual que colorForMagnitude en 34-premium-suite
    const stops: { t: number; r: number; g: number; b: number }[] = [
      { t: 0.00, r: 7,   g: 12,  b: 36  },
      { t: 0.20, r: 26,  g: 63,  b: 138 },
      { t: 0.50, r: 82,  g: 242, b: 189 },
      { t: 0.78, r: 255, g: 216, b: 77  },
      { t: 1.00, r: 255, g: 95,  b: 114 },
    ];
    const t = clamp(mag, 0, 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i].t && t <= stops[i + 1].t) { a = stops[i]; b = stops[i + 1]; break; }
    }
    const lt = (t - a.t) / Math.max(1e-6, (b.t - a.t));
    return [
      Math.round(a.r + (b.r - a.r) * lt),
      Math.round(a.g + (b.g - a.g) * lt),
      Math.round(a.b + (b.b - a.b) * lt),
    ];
  }
}

// ── LGMDM namespace registration ───────────────────────────────
interface ProInsertRack {
  create?: (spec: { id: string; title: string; widget: unknown }) => unknown;
  CATALOG?: Record<string, unknown>;
  registry?: Record<string, unknown>;
}

interface ProFeaturesNs {
  widgets?: Record<string, unknown>;
  reverbWidget?: typeof ReverbWidget;
}

interface LgmdmGlobal {
  proFeatures?: ProFeaturesNs;
  proInsertRack?: ProInsertRack;
}

function ensureLgmdm(): LgmdmGlobal {
  const w = window as Window & { LGMDM?: LgmdmGlobal };
  if (!w.LGMDM) w.LGMDM = {} as LgmdmGlobal;
  return w.LGMDM;
}

function registerInRack(): void {
  try {
    const rack = ensureLgmdm().proInsertRack;
    if (!rack || typeof rack.create !== 'function' || !rack.CATALOG || !rack.CATALOG['reverb']) return;
    const inst = rack.create({
      id: 'reverb',
      title: '🌫 Reverb Designer',
      widget: ReverbWidget,
    });
    if (inst) {
      ReverbWidget.Insert = inst;
      rack.registry = rack.registry || {};
      rack.registry['reverb'] = inst;
    }
  } catch { /* insert-migration ya ejecutado */ }
}

let _registered = false;
function bootstrap(): void {
  if (_registered) return;
  _registered = true;
  try {
    const ns = ensureLgmdm();
    ns.proFeatures = ns.proFeatures || ({} as ProFeaturesNs);
    ns.proFeatures.widgets = ns.proFeatures.widgets || {};
    ns.proFeatures.widgets['reverb'] = ReverbWidget;
    // Legacy camelCase key — 34-premium-suite reads `proFeatures.reverbWidget`.
    ns.proFeatures.reverbWidget = ReverbWidget;
    registerInRack();
  } catch (e) {
    _registered = false;
  }
}

bootstrap();
