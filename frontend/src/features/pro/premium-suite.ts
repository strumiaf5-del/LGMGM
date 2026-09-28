// premium-suite.ts — 23 pro modules
// Pragma TS REMOVIDO 2026-09-27 (FIX FINAL): tipar los 323 errores TS restantes.
// drawWaterfallFrame fuera del IIFE) ya fixeado el 26-sep-2026. Resto de types
// pendiente de migración gradual. Ver AGENTS.md regla 2.

import type { BandSpec } from '../../core/audio-tap';
import { audioEngine } from '../../core/audio-engine';

(function (global) {
  'use strict';

  const LG: any = global.LGMDM = global.LGMDM || {};
  const el = (id: string): HTMLElement | null => document.getElementById(id) || document.querySelector(`[data-status-id="${id}"]`);

  const $canvas = (id: string): HTMLCanvasElement | null => (document.getElementById(id) || document.querySelector(`[data-status-id="${id}"]`)) as HTMLCanvasElement | null;
  const $input = (id: string): HTMLInputElement | null => (document.getElementById(id) || document.querySelector(`[data-status-id="${id}"]`)) as HTMLInputElement | null;
  const $select = (id: string): HTMLSelectElement | null => (document.getElementById(id) || document.querySelector(`[data-status-id="${id}"]`)) as HTMLSelectElement | null;
  const $button = (id: string): HTMLButtonElement | null => (document.getElementById(id) || document.querySelector(`[data-status-id="${id}"]`)) as HTMLButtonElement | null;

  // Tipos locales para los fixes TS (no cambian runtime).
  type CompliancePreset = { name: string; label: string; target_lufs: number; target_peak: number };
  type ComplianceMetrics = { lufs: number; tp: number; lra: number; isLive: boolean };
  type GonioParticle = { x: number; y: number; vx: number; vy: number; life: number; maxLife: number; active: boolean };
  const escapeHtml = LG.ui?.escapeHtml || ((str: unknown) => String(str ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m] as string)));
  const getSelectedFile = (): any => (typeof LGMDM !== 'undefined' && LGMDM.state?.getSelectedFile?.()) || null;
  const getLastAnalysis = (): any => (typeof LGMDM !== 'undefined' && LGMDM.state?.getLastAnalysis?.()) || null;
  const LGMDM = LG;

  const STORAGE_KEY_DEMASK = 'lg_premium_demask_settings';

  const state = {
    activeTab: 'compliance',
    abx: {
      slotA: 'Original',
      slotB: 'Master',
      hiddenX: null as string | null,
      score: 0,
      trials: 0,
      gainMatch: true,
      currentPlaying: null as string | null,
      lastFeedback: ''
    },
    codec: {
      activeCodec: 'bypass',
      ispWarning: false
    },
    stereo: {
      monoSafeActive: null as boolean | null,
      bands: { sub: 0, lowMid: 0.85, highMid: 1.15, air: 1.3 },
      rafId: null as number | null,
      available: false
    },
    waterfall: {
      animating: false,
      history: [],
      rafId: null as number | null,
      available: false
    },
    demask: {
      kickDepth: 45,
      voxDepth: 30
    },
    compliancePresets: [] as CompliancePreset[],
    compliancePresetsLoading: false,
    compliancePresetsLoaded: false,
    compliancePresetSelected: '',
    audio: { tap: null }
  };

  const _audioTap = LGMDM.proFeatures.audioTap;
  const ensureAudioTap = _audioTap.ensure;
  const teardownAudioTap = _audioTap.teardown;
  const _bandSpecs: BandSpec[] = _audioTap.bandSpecs;

  // Correlación Pearson sobre vectores de [-1..1]. Barata: O(n) con n ≤ 512.
  function pearsonCorrelation(x: ArrayLike<number>, y: ArrayLike<number>) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return 0;
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      sx += xi; sy += yi;
      sxy += xi * yi;
      sxx += xi * xi;
      syy += yi * yi;
    }
    const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    if (!Number.isFinite(denom) || denom === 0) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  // Gradient azul (silencio) → cyan (medio, --accent) → rojo (clipping, --danger).
  // F5.10 — LUT pre-computada 256×1 (offscreen canvas) para que el waterfall
  // pinte cada pixel con un solo drawImage, evitando el triple lerp por muestra.
  const _WATERFALL_LUT = (() => {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1;
    const g = c.getContext('2d');
    if (!g) return c;
    const grd = g.createLinearGradient(0, 0, 256, 0);
    grd.addColorStop(0.00, '#070c24');
    grd.addColorStop(0.20, '#1a3f8a');
    grd.addColorStop(0.50, '#52f2bd');
    grd.addColorStop(0.78, '#ffd84d');
    grd.addColorStop(1.00, '#ff5f72');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 1);
    return c;
  })();

  function colorForMagnitude(mag: number) {
    // Mantenido por compatibilidad con consumidores que esperan [r,g,b].
    const idx = Math.max(0, Math.min(255, Math.round(mag * 255)));
    const gctx = _WATERFALL_LUT.getContext('2d');
    if (!gctx) return [0, 0, 0];
    const px = gctx.getImageData(idx, 0, 1, 1).data;
    return [px[0], px[1], px[2]];
  }

  // U-2: pre-allocated particle pool (240 slots, reused via `active` flag).
  // Eliminates 2 object allocs/frame + splice churn on the stereo scope.
  const GONIO_PARTICLE_POOL_SIZE = 240;
  const _gonioParticles: GonioParticle[] = (() => {
    const arr: GonioParticle[] = [];
    for (let i = 0; i < GONIO_PARTICLE_POOL_SIZE; i++) {
      arr.push({ x: 0, y: 0, vx: 0, vy: 0, life: 0, maxLife: 0, active: false });
    }
    return arr;
  })();
  let _haloPulse = 0;
  let _gonioScratchL = new Float32Array(1024);
  let _gonioScratchR = new Float32Array(1024);
  // U-2: cache last-written innerHTML per stereo band — avoids 3 DOM re-parses
  // per frame when corr/verdict are unchanged. Reset on tab re-render (see tick).
  const _stereoBandLastHtml: string[] = [];
  // TODO(U-2): tipar `drawGoniometerFrame(canvas, ctx, size, dataL, dataR,
  // pearson)` (6 `: any`) requiere arreglar el caller (línea ~1024, en la
  // región activa de Agent 3): `liveCanvas` viene de `el('lissajousCanvas')`
  // (HTMLElement, no HTMLCanvasElement) y `ctx` de `getContext('2d')` (sin
  // narrows `| null`). El body usa `canvas.width`/`ctx.X` sin guards. Migración
  // pendiente: estrechar el caller con `as HTMLCanvasElement` + guard `ctx`, y
  // firmar `drawGoniometerFrame(canvas: HTMLCanvasElement, ctx:
  // CanvasRenderingContext2D, size: number, dataL: Uint8Array, dataR: Uint8Array,
  // pearson: number = 0)`. Se tipó `renderCodecCard` (4 `: any` → `string`) que
  // sí está fuera de la región de Agent 3.
  function drawGoniometerFrame(canvas: any, ctx: any, size: any, dataL: any, dataR: any, pearson: any = 0) {
    // FIX M5: use CSS size (the `size` arg) instead of canvas.width/height
    // (device pixels) — the caller applies ctx.scale(dpr,dpr), so the user
    // space is CSS. Using canvas.width double-scales on Retina.
    const w = size || canvas.width;
    const h = size || canvas.height;
    const cx = w / 2;
    const cy = h / 2;
    const radius = Math.min(w, h) * 0.42;

    // F5.9 — Glow acumulativo: compositing aditivo + fade corto del frame previo
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = 'rgba(7, 9, 18, 0.18)';
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = 'rgba(82, 242, 189, 0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, cy); ctx.lineTo(w, cy);
    ctx.moveTo(cx, 0); ctx.lineTo(cx, h);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(82, 242, 189, 0.28)';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    // línea mono-safe a 45° (donde L=R cae)
    ctx.strokeStyle = 'rgba(255, 216, 77, 0.32)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(cx - radius * 0.72, cy + radius * 0.72);
    ctx.lineTo(cx + radius * 0.72, cy - radius * 0.72);
    ctx.stroke();
    ctx.setLineDash([]);

    // Plot L (X) vs R (Y). dataL/dataR son byteTimeDomainData [0..255]; 128 = silencio.
    const n = Math.min(dataL.length, dataR.length);
    ctx.strokeStyle = '#52f2bd';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    let lastLX = 0, lastLY = 0;
    for (let i = 0; i < n; i++) {
      const lx = (dataL[i] / 128) - 1;
      const ly = (dataR[i] / 128) - 1;
      const px = cx + lx * radius;
      const py = cy - ly * radius;   // Y invertido para coordenadas de pantalla
      if (i === 0) ctx.moveTo(px, py);
      else         ctx.lineTo(px, py);
      lastLX = lx; lastLY = ly;
    }
    ctx.stroke();

    if (Math.abs(lastLX) > 0.02 || Math.abs(lastLY) > 0.02) {
      for (let p = 0; p < 2; p++) {
        // U-2: reuse a dead slot from the pool instead of allocating.
        let slot = -1;
        for (let k = 0; k < GONIO_PARTICLE_POOL_SIZE; k++) {
          if (!_gonioParticles[k].active) { slot = k; break; }
        }
        if (slot < 0) break; // pool full — drop (decorative; 240 is plenty)
        const j = (Math.random() - 0.5) * 0.18;
        const pt = _gonioParticles[slot];
        pt.active = true;
        pt.x = cx + lastLX * radius + j;
        pt.y = cy - lastLY * radius + j;
        pt.vx = lastLX * 28 + (Math.random() - 0.5) * 8;
        pt.vy = -lastLY * 28 + (Math.random() - 0.5) * 8;
        pt.life = 0.8;
        pt.maxLife = 0.8;
      }
    }
    const dt = 1 / 60;
    // U-2: iterate the fixed pool; additive ('lighter') blend makes draw order
    // irrelevant, so forward iteration is safe. No splice — dead slots are
    // flagged inactive and reused on the next spawn.
    for (let i = 0; i < GONIO_PARTICLE_POOL_SIZE; i++) {
      const pt = _gonioParticles[i];
      if (!pt.active) continue;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vx *= 0.96; pt.vy *= 0.96;
      pt.life -= dt;
      if (pt.life <= 0) { pt.active = false; continue; }
      const alpha = Math.max(0, pt.life / pt.maxLife);
      ctx.fillStyle = `rgba(82, 242, 189, ${alpha * 0.85})`;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 1.4 + alpha * 1.6, 0, Math.PI * 2);
      ctx.fill();
    }

    if (Math.abs(pearson) > 0.85) {
      _haloPulse += 0.08;
      const haloR = (Math.sin(_haloPulse) + 1) * 15; // 0..30 px
      ctx.fillStyle = `rgba(66, 232, 255, ${0.18 * (1 - haloR / 30)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, haloR, 0, Math.PI * 2);
      ctx.fill();
    } else {
      _haloPulse = 0;
    }

    ctx.globalCompositeOperation = prevOp;
  }

  function drawWaterfallFrame(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, waterfallRow: Uint8Array): void {
    // FIX M5: use CSS size (clientWidth/Height) since the caller applies
    // ctx.scale(dpr,dpr), making user space = CSS. Using canvas.width double-scales.
    const w = canvas.clientWidth || canvas.width;
    const h = canvas.clientHeight || canvas.height;

    // Cascada vertical: copia contenido existente desplazando 1px hacia abajo
    ctx.drawImage(canvas, 0, 0, w, h - 1, 0, 1, w, h - 1);

    const bins = waterfallRow.length;
    for (let x = 0; x < w; x++) {
      // Mapeo log-ish: las frecuencias bajas ocupan más espacio horizontal
      const binIdx = Math.min(bins - 1, Math.floor(Math.pow(x / w, 1.5) * (bins - 1)));
      const mag = waterfallRow[binIdx] / 255;
      const srcX = Math.max(0, Math.min(255, Math.round(mag * 255)));
      ctx.drawImage(_WATERFALL_LUT, srcX, 0, 1, 1, x, 0, 1, 1);
    }
  }

  function loadDemaskSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY_DEMASK);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Number.isFinite(Number(parsed.kickDepth))) {
          state.demask.kickDepth = Math.max(0, Math.min(100, Number(parsed.kickDepth)));
        }
        if (Number.isFinite(Number(parsed.voxDepth))) {
          state.demask.voxDepth = Math.max(0, Math.min(100, Number(parsed.voxDepth)));
        }
      } else {
        const k = localStorage.getItem('lg_demask_kick');
        const v = localStorage.getItem('lg_demask_vox');
        if (Number.isFinite(Number(k))) state.demask.kickDepth = Math.max(0, Math.min(100, Number(k)));
        if (Number.isFinite(Number(v))) state.demask.voxDepth = Math.max(0, Math.min(100, Number(v)));
      }
    } catch (_) {}
  }

  function saveDemaskSettings() {
    try {
      localStorage.setItem(STORAGE_KEY_DEMASK, JSON.stringify(state.demask));
    } catch (_) {}
  }

  const PLATFORMS = [
    { id: 'spotify', name: 'Spotify', targetLufs: -14.0, maxTp: -1.0, tolLufs: 1.0, icon: 'SPT', note: 'Normalización Loudness por defecto' },
    { id: 'apple', name: 'Apple Music', targetLufs: -16.0, maxTp: -1.0, tolLufs: 1.0, icon: 'APL', note: 'Sound Check optimizado (-16 LUFS)' },
    { id: 'youtube', name: 'YouTube', targetLufs: -14.0, maxTp: -1.0, tolLufs: 1.0, icon: 'YT', note: 'Loudness Penalty si excede -14' },
    { id: 'tidal', name: 'Tidal HiFi', targetLufs: -14.0, maxTp: -1.0, tolLufs: 1.0, icon: 'TDL', note: 'Flac 24b / High Res path' },
    { id: 'broadcast', name: 'EBU R128 (TV/Radio)', targetLufs: -23.0, maxTp: -1.0, tolLufs: 0.5, icon: 'EBU', note: 'Estándar Broadcast Europa' },
    { id: 'club', name: 'Club / DJ Master', targetLufs: -8.0, maxTp: -0.1, tolLufs: 1.5, icon: 'CLB', note: 'Alta energía y pegada en pista' }
  ];

  function ensureModal() {
    if (el('premiumSuiteModal')) return;

    const modal = document.createElement('div');
    modal.id = 'premiumSuiteModal';
    modal.className = 'pro-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="pro-dialog pro-dialog-shell">
        <div class="pro-dialog-head">
          <div>
            <div class="pro-eyebrow pro-eyebrow-accent">MASTERING STUDIO PRO</div>
            <h3 class="pro-headline-title">Suite de Funciones Premium</h3>
            <p class="pro-caption-muted">Herramientas avanzadas de certificación, análisis científico y acústica inteligente.</p>
          </div>
          <button class="pro-close" id="closePremiumSuite" aria-label="Cerrar modal">&times;</button>
        </div>
        
        <!-- Navegación de pestañas premium -->
        <div class="pro-tab-header">
          <button class="pro-tab-btn active" data-premium-tab="compliance"><span class="tab-num">01</span> Compliance</button>
          <button class="pro-tab-btn" data-premium-tab="abx"><span class="tab-num">02</span> Blind ABX</button>
          <button class="pro-tab-btn" data-premium-tab="stereo"><span class="tab-num">03</span> Stereo & Mono</button>
          <button class="pro-tab-btn" data-premium-tab="codec"><span class="tab-num">04</span> Codecs</button>
          <button class="pro-tab-btn" data-premium-tab="waterfall"><span class="tab-num">05</span> Waterfall 3D</button>
          <button class="pro-tab-btn" data-premium-tab="doctor"><span class="tab-num">06</span> AI Doctor</button>
          <button class="pro-tab-btn" data-premium-tab="demask"><span class="tab-num">07</span> Demasking</button>
          <button class="pro-tab-btn" data-premium-tab="tamer"><span class="tab-num">08</span> Resonance Tamer</button>
          <button class="pro-tab-btn" data-premium-tab="warmer"><span class="tab-num">09</span> Vintage Warmer</button>
          <button class="pro-tab-btn" data-premium-tab="matcheq"><span class="tab-num">10</span> Match EQ</button>
          <button class="pro-tab-btn" data-premium-tab="phantomsub"><span class="tab-num">11</span> Phantom Sub</button>
          <button class="pro-tab-btn" data-premium-tab="stemsep"><span class="tab-num">12</span> AI Stem Separator</button>
          <button class="pro-tab-btn" data-premium-tab="loudness-penalty"><span class="tab-num">13</span> Loudness Penalty</button>
          <button class="pro-tab-btn" data-premium-tab="spectral-tilt"><span class="tab-num">14</span> Spectral Tilt</button>
          <button class="pro-tab-btn" data-premium-tab="multiband-transient"><span class="tab-num">15</span> Multiband Transient</button>
          <button class="pro-tab-btn" data-premium-tab="ms-imager"><span class="tab-num">16</span> M/S Imager</button>
          <button class="pro-tab-btn" data-premium-tab="reference-match"><span class="tab-num">17</span> Reference Match</button>
          <button class="pro-tab-btn" data-premium-tab="dr-meter"><span class="tab-num">18</span> DR Meter</button>
          <button class="pro-tab-btn" data-premium-tab="saturation"><span class="tab-num">19</span> Saturation</button>
          <button class="pro-tab-btn" data-premium-tab="phase-rotation"><span class="tab-num">20</span> Phase Rotation</button>
          <button class="pro-tab-btn" data-premium-tab="reverb"><span class="tab-num">21</span> Reverb</button>
          <button class="pro-tab-btn" data-premium-tab="loudness-war"><span class="tab-num">22</span> Loudness War</button>
          <button class="pro-tab-btn" data-premium-tab="iso-compensation"><span class="tab-num">23</span> ISO 226 Comp</button>
        </div>

        <!-- Cuerpo dinámico de la pestaña activa -->
        <div class="pro-dialog-body pro-dialog-content" id="premiumTabContent">
          <!-- Se inyecta dinámicamente -->
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    el('closePremiumSuite')?.addEventListener('click', () => close());
    modal.addEventListener('click', (e) => { if (e.target === modal) close(); });

    modal.querySelectorAll<HTMLElement>('[data-premium-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.querySelectorAll<HTMLElement>('[data-premium-tab]').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const prevTab = state.activeTab;
        if (prevTab !== btn.dataset.premiumTab) {
          teardownProFeatures();
        }
        state.activeTab = btn.dataset.premiumTab || 'compliance';
        modal.classList.add('pro-tab-leaving');
        requestAnimationFrame(() => {
          renderActiveTab();
          requestAnimationFrame(() => {
            modal.classList.remove('pro-tab-leaving');
            // F5.1/F5.2 — Inicializar widget del nuevo tab DESPUÉS de render
            // (antes el canvas aún no existía → setupProFeatures salía con null).
            setupProFeatures(state.activeTab);
          });
        });
      });
    });
  }

  function open(tabName: any = 'compliance') {
    ensureModal();
    const modal = el('premiumSuiteModal');
    if (!modal) return;
    state.activeTab = tabName;
    modal.querySelectorAll<HTMLElement>('[data-premium-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.premiumTab === tabName);
    });
    modal.classList.add('is-open');
    LGMDM.ui.openModal({
      modalEl: modal,
      openerEl: document.getElementById('btnOpenPremiumSuite') || document.activeElement,
      closeOnBackdrop: true,
      trapFocus: true,
      closeOnEscape: true,
      onClose: () => doCloseCleanup(),
    });
    renderActiveTab();
    setupProFeatures(state.activeTab);
  }

  function close() {
    const modal = el('premiumSuiteModal');
    if (modal && LGMDM?.ui?.isModalOpen?.(modal)) {
      LGMDM.ui.closeModal(modal);
    } else {
      doCloseCleanup();
    }
  }

  function doCloseCleanup() {
    el('premiumSuiteModal')?.classList.remove('is-open');
    if (state.waterfall.animating) {
      state.waterfall.animating = false;
    }
    // Cancelar todos los RAF y liberar el tap de audio para que no queden
    // AnalyserNode conectados ni requestAnimationFrame colgados tras cerrar.
    if (state.stereo.rafId) {
      cancelAnimationFrame(state.stereo.rafId);
      state.stereo.rafId = null;
    }
    if (state.waterfall.rafId) {
      cancelAnimationFrame(state.waterfall.rafId);
      state.waterfall.rafId = null;
    }
    teardownProFeatures();
  }

  function renderActiveTab() {
    const container = el('premiumTabContent');
    if (!container) return;

    const analysis = getLastAnalysis() || LG.state?.analysis || (window as any).analysisData || null;
    const isLive = Boolean(analysis && (
      Number.isFinite(Number(analysis.lufs)) ||
      Number.isFinite(Number(analysis.integrated_lufs)) ||
      Number.isFinite(Number(analysis.lufs_integrated)) ||
      Number.isFinite(Number(analysis.true_peak_db)) ||
      Number.isFinite(Number(analysis.peak_db))
    ));
    const lufs = Number.isFinite(Number(analysis?.lufs ?? analysis?.integrated_lufs ?? analysis?.lufs_integrated))
      ? Number(analysis.lufs ?? analysis.integrated_lufs ?? analysis.lufs_integrated)
      : -14.2;
    const tp = Number.isFinite(Number(analysis?.true_peak_db ?? analysis?.true_peak_dbtp ?? analysis?.peak_db))
      ? Number(analysis.true_peak_db ?? analysis.true_peak_dbtp ?? analysis.peak_db)
      : -0.8;
    const lra = Number.isFinite(Number(analysis?.lra ?? analysis?.loudness_range_lra ?? analysis?.loudness_range))
      ? Number(analysis.lra ?? analysis.loudness_range_lra ?? analysis.loudness_range)
      : 6.5;

    // F5.15 — Los 4 tabs más grandes (compliance, abx, codec, waterfall)
    // están disponibles como stubs externos (40/41/42/43-tab-*.js) que
    // delegan a las funciones originales aquí definidas. El dispatch
    // llama primero al stub namespaced, y si está disponible lo usa;
    // caso contrario, llama a la función local.
    const tab = (key: string): any => LGMDM?.proFeatures?.tabs?.[key] || (globalThis as any)[`_lgmdmRender${key.charAt(0).toUpperCase() + key.slice(1)}Tab`];
    const TAB_RENDERERS: Record<string, (c: HTMLElement) => void> = {
      'compliance':       (c: HTMLElement) => (tab('compliance') || renderComplianceTab)(c, { lufs, tp, lra, isLive }),
      'abx':              (c: HTMLElement) => (tab('abx') || renderAbxTab)(c),
      'stereo':           (c: HTMLElement) => renderStereoTab(c),
      'codec':            (c: HTMLElement) => (tab('codec') || renderCodecTab)(c),
      'waterfall':        (c: HTMLElement) => (tab('waterfall') || renderWaterfallTab)(c),
      'doctor':           (c: HTMLElement) => renderDoctorTab(c, { lufs, tp, lra, isLive }),
      'demask':           (c: HTMLElement) => renderDemaskTab(c),
      'tamer':            (c: HTMLElement) => renderTamerTab(c),
      'warmer':           (c: HTMLElement) => renderSaturationTab(c),
      'matcheq':          (c: HTMLElement) => renderReferenceMatchTab(c),
      'phantomsub':       (c: HTMLElement) => renderPhantomSubTab(c),
      'stemsep':          (c: HTMLElement) => renderStemSepTab(c),
      'loudness-penalty': (c: HTMLElement) => renderLoudnessPenaltyTab(c),
      'spectral-tilt':    (c: HTMLElement) => renderSpectralTiltTab(c),
      'multiband-transient': (c: HTMLElement) => renderMultibandTransientTab(c),
      'ms-imager':        (c: HTMLElement) => renderMsImagerTab(c),
      'reference-match':  (c: HTMLElement) => renderReferenceMatchTab(c),
      'dr-meter':         (c: HTMLElement) => renderDrMeterTab(c),
      'saturation':       (c: HTMLElement) => renderSaturationTab(c),
      'phase-rotation':   (c: HTMLElement) => renderPhaseRotationTab(c),
      'reverb':           (c: HTMLElement) => renderReverbTab(c),
      'loudness-war':     (c: HTMLElement) => renderLoudnessWarTab(c),
      'iso-compensation': (c: HTMLElement) => renderIsoCompensationTab(c),
    };
    const render = TAB_RENDERERS[state.activeTab];
    if (render) {
      render(container);
    } else {
      state.activeTab = 'compliance';
      TAB_RENDERERS['compliance'](container);
    }
  }

  function renderComplianceTab(container: HTMLElement, metrics: ComplianceMetrics) {
    const rows = PLATFORMS.map((p) => {
      const lufsDelta = metrics.lufs - p.targetLufs;
      const tpOk = metrics.tp <= p.maxTp + 0.05;
      const lufsOk = Math.abs(lufsDelta) <= p.tolLufs;
      const statusClass = tpOk && lufsOk ? 'good' : tpOk ? 'warning' : 'danger';
      const statusLabel = tpOk && lufsOk ? 'PASS' : tpOk ? 'WARN' : 'CLIP RISK';

      return `
        <div class="pro-table-row">
          <span class="pro-table-row-icon">${p.icon}</span>
          <strong>${p.name}</strong>
          <span>${p.targetLufs.toFixed(1)} LUFS</span>
          <span>${p.maxTp.toFixed(1)} dBTP</span>
          <span class="pro-badge-${statusClass} pro-badge-status-center">${statusLabel}</span>
          <small class="pro-table-row-note">${p.note} (${lufsDelta > 0 ? '+' : ''}${lufsDelta.toFixed(1)} LUFS delta)</small>
        </div>
      `;
    }).join('');

    const statusBadge = metrics.isLive
      ? '<span class="pro-badge-good pro-badge-status">● Análisis de Pista Activo</span>'
      : '<span class="pro-badge-warning pro-badge-status">⏳ Esperando análisis de archivo de audio</span>';

    const statusDescription = metrics.isLive
      ? `Evaluación del master actual: <b>${metrics.lufs.toFixed(1)} LUFS</b> · <b>${metrics.tp.toFixed(1)} dBTP</b> · <b>${metrics.lra.toFixed(1)} LRA</b>`
      : `Valores de referencia (esperando análisis de audio): <b>${metrics.lufs.toFixed(1)} LUFS</b> · <b>${metrics.tp.toFixed(1)} dBTP</b> · <b>${metrics.lra.toFixed(1)} LRA</b>`;

    const presetOptions = (state.compliancePresets || [])
      .map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.label || p.name)}</option>`)
      .join('');

    container.innerHTML = `
      <div class="pro-flex-between-mb-wrap">
        <div>
          <div class="pro-title-section">
            <h4 class="pro-h4">Auditoría de Normas de Distribución</h4>
            ${statusBadge}
          </div>
          <p class="pro-metrics-line">${statusDescription}</p>
        </div>
        <div class="pro-flex-between-center" style="gap:.5rem;flex-wrap:wrap;">
          <select id="compliancePreset" class="pro-select-dark" ${presetOptions ? '' : 'disabled'}>
            <option value="">${presetOptions ? 'Preset de comparación…' : 'Presets no disponibles'}</option>
            ${presetOptions}
          </select>
          <button class="pro-secondary" id="btnRefreshCompliance" type="button">🔄 Re-analizar</button>
          <button class="pro-primary pro-cert-export" id="btnExportCert">📜 Descargar Certificado Técnico</button>
        </div>
      </div>

      <div class="pro-compliance-table-wrap pro-compliance-frame">
        <div class="pro-table-min">
          <div class="pro-table-head">
            <span></span><span>Plataforma</span><span>Target LUFS</span><span>Max True Peak</span><span>Estado</span><span>Diagnóstico</span>
          </div>
          ${rows}
          <div id="compliancePresetRow"></div>
        </div>
      </div>
      <div id="certNotice" class="pro-status-mini" role="status" aria-live="polite"></div>
      <!-- A/B compare: oculto por defecto. Compliance solo emite reporte JSON
           sin audio procesado; queda como placeholder visual para futuras
           integraciones que comparen el master contra una versión "limpia". -->
      <div id="complianceABCompare" class="pro-a-b-compare" hidden>
        <span class="pro-a-b-label">A/B Compare (certificado)</span>
        <button class="pro-action-btn" id="compliancePlayOrig" type="button" disabled>▶ Original</button>
        <button class="pro-action-btn active" id="compliancePlayProc" type="button" disabled>▶ Procesado</button>
      </div>
    `;

    el('btnExportCert')?.addEventListener('click', () => {
      exportQualityCertificate(metrics);
    });

    el('btnRefreshCompliance')?.addEventListener('click', () => {
      runComplianceRefresh(container);
    });

    const presetSel = $select('compliancePreset');
    if (presetSel) {
      presetSel.addEventListener('change', () => {
        const name = presetSel.value;
        state.compliancePresetSelected = name;
        const p = (state.compliancePresets || []).find((x) => x.name === name);
        const slot = el('compliancePresetRow');
        if (!slot) return;
        if (!p) { slot.innerHTML = ''; return; }
        const targetLufs = Number(p.target_lufs);
        const targetPeak = Number(p.target_peak);
        const tpDbtp = targetPeak > 0 ? 20 * Math.log10(targetPeak) : -1.0;
        const lufsDelta = metrics.lufs - targetLufs;
        const tpOk = metrics.tp <= tpDbtp + 0.05;
        const lufsOk = Math.abs(lufsDelta) <= 1.0;
        const statusClass = tpOk && lufsOk ? 'good' : tpOk ? 'warning' : 'danger';
        const statusLabel = tpOk && lufsOk ? 'PASS' : tpOk ? 'WARN' : 'CLIP RISK';
        slot.innerHTML = `
          <div class="pro-table-row" style="background:rgba(125,232,255,.06);">
            <span class="pro-table-row-icon">🎚</span>
            <strong>Preset: ${escapeHtml(p.label || p.name)}</strong>
            <span>${targetLufs.toFixed(1)} LUFS</span>
            <span>${tpDbtp.toFixed(1)} dBTP</span>
            <span class="pro-badge-${statusClass} pro-badge-status-center">${statusLabel}</span>
            <small class="pro-table-row-note">(${lufsDelta > 0 ? '+' : ''}${lufsDelta.toFixed(1)} LUFS delta)</small>
          </div>
        `;
      });
      if (state.compliancePresetSelected) {
        presetSel.value = state.compliancePresetSelected;
        presetSel.dispatchEvent(new Event('change'));
      }
    }

    if (!state.compliancePresetsLoaded && !state.compliancePresetsLoading) {
      loadCompliancePresets();
    }
  }

  async function runComplianceRefresh(container: HTMLElement) {
    const file = getSelectedFile();
    if (!file) {
      LGMDM.ui?.showToast?.('Cargá un archivo antes de re-analizar.', 'warning', 4000);
      return;
    }
    // Guard contra cambio de tab: si el usuario navega a otro tab durante
    // el await del backend, abortamos para no mutar un DOM detached.
    const startedTab = state.activeTab;
    const btn = $button('btnRefreshCompliance');
    const status = el('certNotice');
    try {
      if (btn) btn.disabled = true;
      if (status) status.textContent = '⏳ Re-analizando pista en backend…';
      const fd = new FormData();
      fd.append('file', file);
      const res = await apiPostDsp('/analysis', fd);
      if (state.activeTab !== startedTab) return;
      const data = await res.json();
      const lufs = Number(data?.integrated_lufs ?? data?.lufs);
      const tp = Number(data?.true_peak_dbtp ?? data?.true_peak_db);
      const lra = Number(data?.lra);
      if (!Number.isFinite(lufs) || !Number.isFinite(tp)) {
        throw new Error('Respuesta del backend sin métricas utilizables.');
      }
      if (LG.state) LG.state.lastAnalysisData = data;
      else if (window.LGMDM?.state) window.LGMDM.state.lastAnalysisData = data;
      window.dispatchEvent(new CustomEvent('analysis-updated', { detail: data }));
      const safeLra = Number.isFinite(lra) ? lra : 6.5;
      renderComplianceTab(container, { lufs, tp, lra: safeLra, isLive: true });
      if (status) status.textContent = `✓ Re-análisis OK · LUFS ${lufs.toFixed(1)} · TP ${tp.toFixed(1)} dBTP`;
      LGMDM.ui?.showToast?.(`Re-análisis completado · LUFS ${lufs.toFixed(1)} · TP ${tp.toFixed(1)} dBTP`, 'success', 3500);
    } catch (err: unknown) {
      const e = err as any;
      if (status) status.textContent = `❌ Error en re-análisis: ${e.message || e}`;
      const safeMessage = (e.message && e.message.length < 200 && !e.message.includes("\n"))
        ? `Error en re-análisis: ${e.message}`
        : "Error del servidor. Verificá tu conexión.";
      LGMDM.ui?.showToast?.(safeMessage, 'error', 5000);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function loadCompliancePresets() {
    if (state.compliancePresetsLoading) return;
    state.compliancePresetsLoading = true;
    try {
      const res = await LGMDM.api.apiFetch('/presets', { method: 'GET' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const presets = Object.entries(data || {}).map(([name, conf]: [string, any]) => ({
        name,
        label: conf?.label || name,
        target_lufs: Number(conf?.target_lufs ?? -14.0),
        target_peak: Number(conf?.target_peak ?? 0.95)
      }));
      state.compliancePresets = presets;
      state.compliancePresetsLoaded = true;
      if (state.activeTab === 'compliance') {
        const container = el('premiumTabContent');
        if (container) renderComplianceTab(container, _currentMetrics());
      }
    } catch (_) {
      // Falla silenciosa: el selector queda disabled. Sin toast (UX limpia).
      state.compliancePresetsLoaded = false;
    } finally {
      state.compliancePresetsLoading = false;
    }
  }

  function _currentMetrics() {
    const analysis = getLastAnalysis();
    const lufs = Number(analysis?.integrated_lufs ?? analysis?.lufs ?? -14.2);
    const tp = Number(analysis?.true_peak_dbtp ?? analysis?.true_peak_db ?? analysis?.peak_db ?? -0.8);
    const lra = Number(analysis?.lra ?? analysis?.loudness_range_lra ?? 6.5);
    return { lufs, tp, lra, isLive: Number.isFinite(lufs) && Number.isFinite(tp) };
  }

  function exportQualityCertificate(metrics: ComplianceMetrics) {
    const filename = getSelectedFile()?.name || 'Master_Track';
    const dateStr = new Intl.DateTimeFormat('es', { dateStyle: 'long', timeStyle: 'short' }).format(new Date());
    const certData = {
      title: 'CERTIFICADO TÉCNICO DE MASTERIZACIÓN',
      project: filename,
      date: dateStr,
      metrics: {
        integrated_lufs: metrics.lufs.toFixed(1),
        true_peak_dbtp: metrics.tp.toFixed(1),
        loudness_range_lra: metrics.lra.toFixed(1)
      },
      streaming_compliance: PLATFORMS.map((p) => ({
        platform: p.name,
        target_lufs: p.targetLufs,
        max_dbtp: p.maxTp,
        status: metrics.tp <= p.maxTp && Math.abs(metrics.lufs - p.targetLufs) <= p.tolLufs ? 'PASS' : 'REVIEW'
      }))
    };

    const blob = new Blob([JSON.stringify(certData, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    // FIX M-NEW-7: trackear el URL en _proObjectUrls para que teardownProFeatures
    // lo revoque si se cierra antes del setTimeout (1s).
    _trackObjectUrl(a.href);
    a.download = `Certificado_Calidad_${filename.replace(/\.[^/.]+$/, '')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);

    const notice = el('certNotice');
    if (notice) notice.textContent = '✓ Certificado técnico descargado con éxito.';
  }

  function renderAbxTab(container: HTMLElement) {
    container.innerHTML = `
      <div class="pro-abx-wrap">
        <h4 class="pro-h4">Prueba a Ciegas ABX con Nivelación Perceptual</h4>
        <p class="pro-section-subtitle-wide">
          Determina si puedes identificar objetivamente la pista procesada (Master) frente al Original sin sesgo visual.
        </p>

        <div class="pro-flex-center-14">
          <button class="pro-action-btn pro-action-btn-center" id="abxPlayA">▶ Pista A</button>
          <button class="pro-action-btn pro-action-btn-center" id="abxPlayB">▶ Pista B</button>
          <button class="pro-primary pro-action-btn-b" id="abxPlayX">❓ Pista X</button>
        </div>

        <div class="pro-abx-block">
          <div class="pro-abx-prompt">¿A qué pista corresponde <b>Pista X</b>?</div>
          <div class="pro-flex-between-center">
            <button class="pro-secondary pro-secondary-b" id="abxGuessA">X es Pista A</button>
            <button class="pro-secondary pro-secondary-b" id="abxGuessB">X es Pista B</button>
          </div>
          <div id="abxFeedback" class="pro-status-feedback"></div>
        </div>

        <div class="pro-feedback-row">
          <div>Aciertos: <strong id="abxScore" class="pro-text-strong">0 / 0</strong></div>
          <div>Confianza Estadística: <strong id="abxConfidence" class="pro-text-accent">0.0%</strong></div>
          <div><label class="pro-checker"><input type="checkbox" id="abxGainMatch"> Gain Matching Activo</label></div>
          <button class="pro-secondary pro-abx-reset" id="abxReset" title="Reiniciar ronda de prueba">↺ Reiniciar</button>
        </div>
      </div>
    `;

    // Initialize hiddenX only if not set, do NOT re-randomize on renderAbxTab calls
    if (!state.abx.hiddenX) {
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
    }

    const fbEl = el('abxFeedback');
    if (fbEl && state.abx.lastFeedback) {
      fbEl.textContent = state.abx.lastFeedback;
    }

    const updatePlayButtonsUI = () => {
      const current = state.abx.currentPlaying;
      const playA = el('abxPlayA');
      const playB = el('abxPlayB');
      const playX = el('abxPlayX');

      [
        { btn: playA, slot: 'A', label: 'Pista A' },
        { btn: playB, slot: 'B', label: 'Pista B' },
        { btn: playX, slot: 'X', label: 'Pista X' }
      ].forEach(({ btn, slot, label }) => {
        if (!btn) return;
        const isPlaying = (current === slot);
        btn.classList.toggle('active', isPlaying);
        if (isPlaying) {
          btn.style.outline = '2px solid var(--ui-accent, #52f2bd)';
          btn.style.boxShadow = '0 0 14px rgba(82, 242, 189, 0.45)';
          btn.textContent = `🔊 ${label} (Activo)`;
        } else {
          btn.style.outline = 'none';
          btn.style.boxShadow = 'none';
          btn.textContent = slot === 'X' ? `❓ ${label}` : `▶ ${label}`;
        }
      });
    };

    const playAbxSlot = (slot: string) => {
      if (!state.abx.hiddenX) {
        state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      }
      state.abx.currentPlaying = slot;
      updatePlayButtonsUI();

      const targetMode = slot === 'X'
        ? (state.abx.hiddenX === 'A' ? 'original' : 'master')
        : (slot === 'A' ? 'original' : 'master');

      if (typeof LGMDM?.ab?.setMode === 'function') {
        try { LGMDM.ab.setMode(targetMode); } catch (_) {}
      }
      if (typeof LGMDM?.console?.setAB === 'function') {
        try { LGMDM.console.setAB(targetMode); } catch (_) {}
      }

      try {
        const audio = document.querySelector('#previewAudioWrap audio, #mxrServerPreviewAudio') || LG.previewController?.getAudio?.();
        if (audio && audio.paused) {
          audio.play().catch(() => {});
        }
        const btnPlay = el('btnABPlay');
        if (btnPlay && btnPlay.textContent.includes('▶')) {
          btnPlay.click();
        }
        const consolePlayBtn = el('consolePlayBtn');
        if (consolePlayBtn && consolePlayBtn.textContent.includes('▶')) {
          consolePlayBtn.click();
        }
      } catch (_) {}
    };

    const updateStats = () => {
      const scoreEl = el('abxScore');
      const confEl = el('abxConfidence');
      if (scoreEl) scoreEl.textContent = `${state.abx.score} / ${state.abx.trials}`;
      const pctNum = state.abx.trials > 0 ? (state.abx.score / state.abx.trials) * 100 : 0;
      const pct = pctNum.toFixed(1);
      if (confEl) confEl.textContent = `${pct}% ${state.abx.trials >= 5 && pctNum >= 80 ? '✓ (Significativo)' : ''}`;
    };

    el('abxPlayA')?.addEventListener('click', () => playAbxSlot('A'));
    el('abxPlayB')?.addEventListener('click', () => playAbxSlot('B'));
    el('abxPlayX')?.addEventListener('click', () => playAbxSlot('X'));

    const gainMatchCb = $input('abxGainMatch');
    if (gainMatchCb) {
      gainMatchCb.checked = !!state.abx.gainMatch;
      ['change', 'input'].forEach((evt) => {
        gainMatchCb.addEventListener(evt, (e) => {
          state.abx.gainMatch = (e.target as HTMLInputElement).checked;
        });
      });
    }

    updatePlayButtonsUI();
    updateStats();

    el('abxReset')?.addEventListener('click', () => {
      state.abx.score = 0;
      state.abx.trials = 0;
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      state.abx.currentPlaying = null;
      state.abx.lastFeedback = '';
      const fb = el('abxFeedback');
      if (fb) fb.innerHTML = '';
      updatePlayButtonsUI();
      updateStats();
    });

    el('abxGuessA')?.addEventListener('click', () => {
      state.abx.trials++;
      const correct = state.abx.hiddenX === 'A';
      if (correct) state.abx.score++;
      const msg = correct
        ? '<span class="pro-tag-feedback">✓ ¡Correcto! X era la Pista A.</span>'
        : '<span class="pro-tag-feedback-bad">✗ Incorrecto. X era la Pista B.</span>';
      state.abx.lastFeedback = msg;
      const fb = el('abxFeedback');
      if (fb) fb.innerHTML = msg;
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      state.abx.currentPlaying = null;
      updatePlayButtonsUI();
      updateStats();
    });

    el('abxGuessB')?.addEventListener('click', () => {
      state.abx.trials++;
      const correct = state.abx.hiddenX === 'B';
      if (correct) state.abx.score++;
      const msg = correct
        ? '<span class="pro-tag-feedback">✓ ¡Correcto! X era la Pista B.</span>'
        : '<span class="pro-tag-feedback-bad">✗ Incorrecto. X era la Pista A.</span>';
      state.abx.lastFeedback = msg;
      const fb = el('abxFeedback');
      if (fb) fb.innerHTML = msg;
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      state.abx.currentPlaying = null;
      updatePlayButtonsUI();
      updateStats();
    });
  }

  function renderStereoTab(container: HTMLElement) {
    if (state.stereo.monoSafeActive === null) {
      const monoAmt = $input('s-mono-amount');
      state.stereo.monoSafeActive = Boolean(monoAmt && Number(monoAmt.value) >= 0.99);
    }
    const isMonoSafe = !!state.stereo.monoSafeActive;

    if (state.stereo.rafId) {
      cancelAnimationFrame(state.stereo.rafId);
      state.stereo.rafId = null;
    }

    const tap = ensureAudioTap();
    state.stereo.available = !!tap;

    const bandCardsHtml = _bandSpecs.map((spec, i) => `
      <div class="pro-meter-card">
        <span class="pro-meter-status-info">${spec.label}</span>
        <strong id="stereoBand${i}" class="pro-stereo-band-strong">${tap ? 'corr: +0.00' : '— esperando audio —'}</strong>
      </div>
    `).join('');

    container.innerHTML = `
      <div class="pro-stereo-content">
        <div>
          <h4 class="pro-h4">Goniómetro Polar y Correlación Multibanda</h4>
          <p class="pro-section-desc">Análisis de ancho y compatibilidad mono en 3 bandas frecuenciales, sobre el audio real en reproducción.</p>

          <div class="pro-grid-stack">
            <div class="pro-meter-card">
              <div class="pro-grid-mb-14">
                <span>Sub (< 90 Hz)</span>
                <strong id="monoSafeStatus" class="${isMonoSafe ? 'pro-tag-mono-safe-on' : 'pro-tag-mono-safe-off'}">
                  ${isMonoSafe ? 'MONO FORZADO (SEGURO)' : 'ESTÉREO DETECTADO'}
                </strong>
              </div>
              <div class="pro-grid-mt-6">
                <button class="pro-primary pro-btn-fixed" id="btnToggleMonoSafe" data-action="toggle-mono-safe">
                  ${isMonoSafe ? 'Desactivar Mono-Safe' : '🛡 Activar Mono-Safe (<90 Hz Mono)'}
                </button>
              </div>
            </div>

            ${bandCardsHtml}

            <div id="stereoTapStatus" class="pro-stereo-status">
              ${tap
                ? `🔊 Tap activo · fuente: ${tap.sourceType === 'mixer' ? 'Mixer masterGain' : 'Preview &lt;audio&gt;'} · ${tap.ctx.sampleRate} Hz`
                : '⏳ Sin audio en reproducción. Activá el Live Preview en la consola principal y reproducí una pista.'}
            </div>
          </div>
        </div>

        <div class="pro-stereo-caption">
          <div class="pro-scope-label">Lissajous Polar Scope (L/R Phase)</div>
          <canvas id="lissajousCanvas" class="pro-lissajous-canvas pro-scope-canvas" width="320" height="320"></canvas>
          <div id="stereoScopeCaption" class="pro-scope-caption">
            ${tap ? 'Trazando L vs R en tiempo real · Pearson se actualiza por banda.' : 'El goniómetro se activará al detectar audio.'}
          </div>
        </div>
      </div>
    `;

    const canvas = $canvas('lissajousCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const cssSize = 320;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = cssSize * dpr;
    canvas.height = cssSize * dpr;
    canvas.style.width = cssSize + 'px';
    canvas.style.height = cssSize + 'px';
    ctx.scale(dpr, dpr);

    if (!tap) {
      ctx.fillStyle = 'rgba(7, 9, 18, 1)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#52f2bd';
      ctx.font = '14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Esperando audio…', cssSize / 2, cssSize / 2 - 8);
      ctx.fillStyle = 'rgba(155, 166, 196, 0.85)';
      ctx.font = '11px monospace';
      ctx.fillText('Reproducí la pista en la consola', cssSize / 2, cssSize / 2 + 12);
      ctx.fillText('para ver el goniómetro en vivo.', cssSize / 2, cssSize / 2 + 28);
    } else {
      // Buffers reutilizables (sin allocs en RAF) — Uint8 para los bytes del
      // AnalyserNode, Float32 para el cómputo Pearson en [-1..1].
      const N_GONIO = tap.analyserGonioL.fftSize;
      const N_BAND  = tap.bandAnalysers[0][0].fftSize;
      const bufGonioL = new Uint8Array(N_GONIO);
      const bufGonioR = new Uint8Array(N_GONIO);
      const u8L = _bandSpecs.map(() => new Uint8Array(N_BAND));
      const u8R = _bandSpecs.map(() => new Uint8Array(N_BAND));
      const fL  = _bandSpecs.map(() => new Float32Array(N_BAND));
      const fR  = _bandSpecs.map(() => new Float32Array(N_BAND));

      // Throttle: cap a 60 FPS (~16.67ms). En monitores 120/144Hz rAF llega
      // más rápido; este guard evita gastar CPU sin cambio visual real.
      let _lastFrame = 0;
      const _FRAME_INTERVAL = 1000 / 60;

      const tick = (now: any) => {
        if (!state.stereo.rafId) return; // fue cancelado
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          cancelAnimationFrame(state.stereo.rafId);
          state.stereo.rafId = null;
          return; // skip animation (P0 accessibility)
        }
        const liveCanvas = el('lissajousCanvas');
        if (!liveCanvas) { state.stereo.rafId = null; return; }

        if (now && _lastFrame && (now - _lastFrame) < _FRAME_INTERVAL) {
          // demasiado pronto — reagendar sin redibujar
          state.stereo.rafId = requestAnimationFrame(tick);
          return;
        }
        _lastFrame = now || 0;

        tap.analyserGonioL.getByteTimeDomainData(bufGonioL);
        tap.analyserGonioR.getByteTimeDomainData(bufGonioR);
        // Pearson global sobre los buffers del goniómetro (para halo pulsante)
        let overallCorr = 0;
        {
          const nG = bufGonioL.length;
          const gl = _gonioScratchL;
          const gr = _gonioScratchR;
          for (let k = 0; k < nG; k++) {
            gl[k] = (bufGonioL[k] / 128) - 1;
            gr[k] = (bufGonioR[k] / 128) - 1;
          }
          overallCorr = pearsonCorrelation(gl, gr);
        }
        drawGoniometerFrame(liveCanvas, ctx, cssSize, bufGonioL, bufGonioR, overallCorr);

        // 2) Correlación Pearson por banda — byte[0..255] → [-1..1] → coef
        _bandSpecs.forEach((spec, i) => {
          tap.bandAnalysers[i][0].getByteTimeDomainData(u8L[i]);
          tap.bandAnalysers[i][1].getByteTimeDomainData(u8R[i]);
          for (let k = 0; k < N_BAND; k++) {
            fL[i][k] = (u8L[i][k] / 128) - 1;
            fR[i][k] = (u8R[i][k] / 128) - 1;
          }
          const corr = pearsonCorrelation(fL[i], fR[i]);
          const sign = corr >= 0 ? '+' : '';
          let verdict, color;
          if (corr >= 0.85)      { verdict = 'mono-safe';    color = '#52f2bd'; }
          else if (corr >= 0.55)  { verdict = 'wide OK';      color = '#7dffd1'; }
          else if (corr >= -0.20) { verdict = 'phasey';       color = '#ffd84d'; }
          else                    { verdict = 'OUT OF PHASE'; color = '#ff5f72'; }
          const card = el(`stereoBand${i}`);
          if (card) {
            const html = `
              <span class="pro-stereo-band">${spec.label}</span>
              <strong class="pro-stereo-band-strong" style="color: ${color};">
                corr: ${sign}${corr.toFixed(2)}
                <small class="pro-stereo-band-info">${verdict}</small>
              </strong>
            `;
            // U-2: only re-parse the DOM when the string actually changed —
            // corr/verdict drift slowly, so this skips the write most frames.
            if (_stereoBandLastHtml[i] !== html) {
              card.innerHTML = html;
              _stereoBandLastHtml[i] = html;
            }
          }
        });

        state.stereo.rafId = requestAnimationFrame(tick);
      };
      // U-2: invalidate the innerHTML cache so freshly-created band cards get
      // their first write (the tick skips unchanged strings thereafter).
      _stereoBandLastHtml.length = 0;
      state.stereo.rafId = requestAnimationFrame(tick);
    }

    el('btnToggleMonoSafe')?.addEventListener('click', () => {
      state.stereo.monoSafeActive = !state.stereo.monoSafeActive;
      if (state.stereo.monoSafeActive) {
        const monoFreq = $input('s-mono-freq');
        if (monoFreq) {
          monoFreq.value = '90';
          monoFreq.dispatchEvent(new Event('input', { bubbles: true }));
          monoFreq.dispatchEvent(new Event('change', { bubbles: true }));
        }
        const monoAmount = $input('s-mono-amount');
        if (monoAmount) {
          monoAmount.value = '1.0';
          monoAmount.dispatchEvent(new Event('input', { bubbles: true }));
          monoAmount.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        const monoAmount = $input('s-mono-amount');
        if (monoAmount) {
          monoAmount.value = '0';
          monoAmount.dispatchEvent(new Event('input', { bubbles: true }));
          monoAmount.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      renderActiveTab();
      LG.ui?.showStatus?.(null, state.stereo.monoSafeActive ? 'Mono-Safe <90Hz Activado (Faders consola actualizados)' : 'Mono-Safe Desactivado', 'info');
    });
  }

  // Perfiles de pre-éco (BiquadFilterNode) para emular la pérdida de altas/bajas frecuencias
  // característica de cada códec. NO usamos librerías externas — sólo el
  // Web Audio nativo (OfflineAudioContext + BiquadFilterNode).
  type CodecProfile = { label: string; fileSlug: string; filters: { type: BiquadFilterType; frequency: number; gain: number; q: number }[]; ispPenaltyDb: number };
  const CODEC_PROFILES: Record<string, CodecProfile> = {
    bypass: {
      label: 'ORIGINAL LOSSLESS',
      fileSlug: 'lossless',
      filters: [],
      ispPenaltyDb: 0
    },
    aac256: {
      label: 'AAC 256 kbps',
      fileSlug: 'aac_256',
      filters: [{ type: 'highshelf', frequency: 17000, gain: -2.0, q: 0.7 }],
      ispPenaltyDb: 0.3
    },
    ogg160: {
      label: 'OGG 160 kbps',
      fileSlug: 'ogg_160',
      filters: [{ type: 'highshelf', frequency: 15500, gain: -3.0, q: 0.7 }],
      ispPenaltyDb: 0.5
    },
    mp3128: {
      label: 'MP3 128 kbps',
      fileSlug: 'mp3_128',
      filters: [{ type: 'highshelf', frequency: 16000, gain: -3.0, q: 0.7 }],
      ispPenaltyDb: 0.8
    },
    opus96: {
      label: 'Opus 96 kbps',
      fileSlug: 'opus_96',
      filters: [
        { type: 'lowshelf', frequency: 200, gain: -1.0, q: 0.7 },
        { type: 'highshelf', frequency: 12000, gain: -4.0, q: 0.7 }
      ],
      ispPenaltyDb: 1.2
    },
    mp3320: {
      label: 'MP3 320 kbps',
      fileSlug: 'mp3_320',
      filters: [{ type: 'highshelf', frequency: 18000, gain: -1.0, q: 0.7 }],
      ispPenaltyDb: 0.1
    }
  };

  function audioBufferToWavBlob(audioBuffer: any, bitDepth: any = 16) {
    const numCh = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const numFrames = audioBuffer.length;
    const bytesPerSample = bitDepth / 8;
    const blockAlign = numCh * bytesPerSample;
    const dataBytes = numFrames * blockAlign;
    const headerBytes = 44;
    const buffer = new ArrayBuffer(headerBytes + dataBytes);
    const view = new DataView(buffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataBytes, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);             // PCM chunk size
    view.setUint16(20, 1, true);              // PCM format
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);  // byte rate
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataBytes, true);

    const channels = [];
    for (let c = 0; c < numCh; c++) channels.push(audioBuffer.getChannelData(c));
    let offset = headerBytes;
    const maxAmp = bitDepth === 16 ? 0x7fff : 0x7fffff;
    for (let i = 0; i < numFrames; i++) {
      for (let c = 0; c < numCh; c++) {
        const s = Math.max(-1, Math.min(1, channels[c][i]));
        // Asimétrico (signed PCM) — el driver rechaza [-1] exacto en 16-bit
        const val = Math.round(s < 0 ? s * maxAmp : s * (maxAmp - 1));
        if (bitDepth === 16) {
          view.setInt16(offset, val, true);
          offset += 2;
        } else {
          view.setInt32(offset, val, true);
          offset += 4;
        }
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }
  function writeString(view: any, offset: any, str: any) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  // Cuenta "inter-sample peaks" > 0 dBFS (penalty artificial por códec).
  // Para un WAV renderizado por OfflineAudioContext, los samples quedan en
  // [-1..1]; los que están exactamente en +1 ya son clipping. Sumamos el
  // penalty configurable del códec para reflejar los inter-sample peaks
  // que el códec real podría producir tras el re-encoding.
  function countInterSamplePeaks(audioBuffer: AudioBuffer, penaltyDb: number) {
    let count = 0;
    const channels = audioBuffer.numberOfChannels;
    for (let c = 0; c < channels; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        if (data[i] >= 1.0) count++;
      }
    }
    // Aplicamos un factor empírico: penalty 1dB ⇒ ~0.5% más de picos ISP
    // sobre el total de samples (heurística, no medición real).
    const total = audioBuffer.length * channels;
    const extra = Math.round(total * 0.005 * Math.max(0, penaltyDb));
    return count + extra;
  }

  function rmsDbfs(audioBuffer: AudioBuffer) {
    let sumSq = 0;
    let n = 0;
    const ch = audioBuffer.numberOfChannels;
    for (let c = 0; c < ch; c++) {
      const data = audioBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const v = data[i];
        sumSq += v * v;
        n++;
      }
    }
    if (n === 0) return -Infinity;
    const rms = Math.sqrt(sumSq / n);
    if (rms <= 0) return -Infinity;
    return 20 * Math.log10(rms);
  }

  function renderCodecTab(container: HTMLElement) {
    container.innerHTML = `
      <div>
        <h4 class="pro-h4">Simulador de Compresión de Codecs (Lossy Preview)</h4>
        <p class="pro-section-subtitle">Anticipa distorsión inter-sample y artefactos generados por la compresión en plataformas. Procesamiento offline con BiquadFilterNode, sin librerías externas.</p>

        <div class="pro-grid-codecs">
          ${renderCodecCard('bypass', 'Original Lossless', 'WAV / FLAC 24-bit', 'Bypass')}
          ${renderCodecCard('aac256', 'AAC 256 kbps', 'Apple Music / YouTube HQ', 'Emular')}
          ${renderCodecCard('ogg160', 'OGG 160 kbps', 'Spotify Free / Web', 'Emular')}
          ${renderCodecCard('mp3128', 'MP3 128 kbps', 'Streaming agresivo', 'Emular')}
        </div>

        <div class="pro-codec-status">
          <div class="pro-flex-between">
            <div>
              <span class="pro-codec-isp-line">ESTADO DEL MOTOR DE CODEC</span>
              <div class="pro-codec-stats-label">
                Codec Activo: <span id="codecActiveLabel" class="pro-codec-active-label">${(CODEC_PROFILES[state.codec.activeCodec] || CODEC_PROFILES.bypass).label.toUpperCase()}</span>
              </div>
            </div>
            <div class="pro-right">
              <span class="pro-codec-isp-line">INTER-SAMPLE PEAK OVERS</span>
              <div id="codecIspValue" class="pro-codec-isp-value">— esperando proceso —</div>
            </div>
          </div>
        </div>

        <div class="pro-mt-14 pro-flex-between-mb-wrap">
          <div>
            <strong class="pro-card-title">📁 Archivo de Audio</strong>
            <p class="pro-caption-muted">
              Pista actual: <span id="codecCurrentFile" class="pro-current-file">${getSelectedFile() ? escapeHtml(getSelectedFile().name) : 'Ningún archivo cargado en consola'}</span>
            </p>
          </div>
          <button class="pro-primary" id="btnRunCodec" style="padding: 8px 18px;">⚡ Procesar Códec</button>
        </div>

        <div id="codecOutputArea" class="pro-output-area pro-codec-output-card">
          <strong id="codecOutputTitle" class="pro-card-title-accent">✓ Audio Procesado Listo</strong>
          <div class="pro-codec-output-row">
            <audio id="codecAudioPlayer" controls class="pro-audio-player"></audio>
            <a id="codecDownloadBtn" class="pro-action-btn pro-download-link" download="codec_master.wav">📥 Descargar WAV</a>
          </div>
          <div class="pro-codec-metrics">
            <div class="pro-codec-metric-cell">
              <span class="pro-codec-metric-label">RMS Est.</span>
              <strong id="codecRmsMetric" class="pro-codec-metric-value">— dBFS</strong>
            </div>
            <div class="pro-codec-metric-cell">
              <span class="pro-codec-metric-label">Picos ISP</span>
              <strong id="codecIspMetric" class="pro-codec-metric-value">—</strong>
            </div>
            <div class="pro-codec-metric-cell">
              <span class="pro-codec-metric-label">Sample Rate</span>
              <strong id="codecSrMetric" class="pro-codec-metric-value">— Hz</strong>
            </div>
          </div>
          <div id="codecMetaInfo" class="pro-codec-meta"></div>
          <div id="codecABCompare" class="pro-a-b-compare" hidden>
            <span class="pro-a-b-label">A/B Compare (pre-codec vs post-codec)</span>
            <button class="pro-action-btn" id="codecPlayOrig" type="button">▶ Original (pre-codec)</button>
            <button class="pro-action-btn active" id="codecPlayProc" type="button">▶ Procesado (post-codec)</button>
          </div>
        </div>

        <div id="codecStatus" class="pro-status"></div>
      </div>
    `;

    function renderCodecCard(id: string, title: string, sub: string, btnLabel: string) {
      const isActive = state.codec.activeCodec === id;
      return `
        <div class="pro-meter-card ${isActive ? 'pro-codec-card-active' : 'pro-codec-card'}">
          <strong>${title}</strong>
          <small>${sub}</small>
          <button class="pro-action-btn pro-codec-emulate" data-codec="${id}">${btnLabel}</button>
        </div>
      `;
    }

    container.querySelectorAll<HTMLElement>('[data-codec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.codec.activeCodec = btn.dataset.codec || 'bypass';
        renderActiveTab();
      });
    });

    el('btnRunCodec')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile(null);
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá un archivo de audio en la consola para emular el códec.', 'warning', 4000);
        return;
      }
      const codecId = state.codec.activeCodec || 'bypass';
      const profile = CODEC_PROFILES[codecId] || CODEC_PROFILES.bypass;
      const status = el('codecStatus');
      const btn = $button('btnRunCodec');
      const outArea = el('codecOutputArea');
      const activeLbl = el('codecActiveLabel');
      if (activeLbl) activeLbl.textContent = profile.label.toUpperCase();
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = `⏳ Decodificando audio y aplicando perfil "${profile.label}"…`;

        const ctx = audioEngine.getContext();
        if (!ctx) throw new Error('AudioContext no disponible');

        const arrayBuffer = await file.arrayBuffer();
        const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));

        if (status) status.textContent = `⏳ Renderizando ${decoded.duration.toFixed(1)}s con ${profile.filters.length} filtro(s)…`;

        // OfflineAudioContext propio (no comparte contexto en vivo)
        const offline = new OfflineAudioContext(
          decoded.numberOfChannels,
          decoded.length,
          decoded.sampleRate
        );
        const source = offline.createBufferSource();
        source.buffer = decoded;

        let chain: AudioNode = source;
        for (const f of profile.filters) {
          const node = offline.createBiquadFilter();
          node.type = f.type;
          node.frequency.value = f.frequency;
          node.gain.value = f.gain;
          if (Number.isFinite(f.q)) node.Q.value = f.q;
          chain.connect(node);
          chain = node;
        }
        chain.connect(offline.destination);
        source.start(0);

        const rendered = await offline.startRendering();

        // Calcular métricas básicas para UI (no son mediciones LUFS reales)
        const isp = countInterSamplePeaks(rendered, profile.ispPenaltyDb);
        const rms = rmsDbfs(rendered);
        const blob = audioBufferToWavBlob(rendered, 16);

        // WAV "pre-codec" para A/B compare — re-encodeamos el AudioBuffer
        // decodificado sin filtros para garantizar misma SR/canales/duración
        // que el procesado y permitir switch sin pops ni drift de timing.
        const originalBlob = audioBufferToWavBlob(decoded, 16);

        const baseName = (file.name || 'master').replace(/\.[^/.]+$/, '');
        const dlName = `${baseName}_${profile.fileSlug}.wav`;

        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('codecAudioPlayer') as HTMLAudioElement | null;
        const dl = el('codecDownloadBtn') as HTMLAnchorElement | null;
        const abArea = el('codecABCompare');
        if (player) player.src = url;
        if (dl) {
          dl.href = url;
          dl.setAttribute('download', dlName);
        }
        if (abArea) abArea.hidden = false;

        const ispVal = el('codecIspValue');
        const ispMet = el('codecIspMetric');
        const rmsMet = el('codecRmsMetric');
        const srMet = el('codecSrMetric');
        const meta = el('codecMetaInfo');
        if (ispVal) ispVal.textContent = `${isp} Picos > 0 dBFS`;
        if (ispMet) ispMet.textContent = `${isp}`;
        if (rmsMet) rmsMet.textContent = Number.isFinite(rms) ? `${rms.toFixed(1)} dBFS` : '−∞ dBFS';
        if (srMet) srMet.textContent = `${rendered.sampleRate} Hz`;
        if (meta) meta.textContent =
          `Canales: ${rendered.numberOfChannels} · Duración: ${rendered.duration.toFixed(2)}s · ` +
          `Tamaño: ${(blob.size / 1024).toFixed(1)} KB`;

        if (outArea) outArea.style.display = 'block';
        if (status) status.textContent =
          `✓ Códec "${profile.label}" aplicado. ${isp} picos ISP · RMS ${rms.toFixed(1)} dBFS.`;
        LGMDM.ui?.showToast?.(`Audio procesado con códec ${profile.label}.`, 'success', 3000);
        setupABCompare('codec', originalBlob, url);
      } catch (err) {
        if (status) status.textContent = `❌ Error: simulador de códec falló`;
        LGMDM.errors?.safeToast?.('Simulador de códec', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderWaterfallTab(container: HTMLElement) {
    if (state.waterfall.rafId) {
      cancelAnimationFrame(state.waterfall.rafId);
      state.waterfall.rafId = null;
    }

    const tap = ensureAudioTap();
    state.waterfall.available = !!tap;

    container.innerHTML = `
      <div>
        <div class="pro-flex-between-mb-10">
          <div>
            <h4 class="pro-h4">Espectrograma 3D Cascada (Waterfall Spectrogram)</h4>
            <p class="pro-section-subtitle-tight">Topografía frecuencial en profundidad temporal y densidad espectral sobre el audio real.</p>
          </div>
          <button class="pro-action-btn" id="btnToggle3D">${state.waterfall.animating ? '⏸ Pausar 3D' : '▶ Reanudar 3D'}</button>
        </div>

        <canvas id="waterfallCanvas" width="940" height="340" class="pro-waterfall-canvas"></canvas>
        <div id="waterfallStatus" class="pro-waterfall-status">
          ${tap
            ? `🔊 Tap activo · fuente: ${tap.sourceType === 'mixer' ? 'Mixer masterGain' : 'Preview &lt;audio&gt;'} · FFT ${tap.analyserWaterfall.fftSize} bins · ${tap.ctx.sampleRate} Hz`
            : '⏳ Sin audio en reproducción. Activá el Live Preview y reproducí una pista para ver el waterfall en vivo.'}
        </div>
      </div>
    `;

    const canvas = $canvas('waterfallCanvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const cssW = canvas.clientWidth || 940;
    const cssH = 340;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    ctx.scale(dpr, dpr);

    state.waterfall.animating = !!tap;

    if (!tap) {
      // Mensaje de espera — no se inicia ningún RAF para evitar fuga silenciosa.
      ctx.fillStyle = '#070912';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#52f2bd';
      ctx.font = `${14 * dpr}px monospace`;
      ctx.textAlign = 'center';
      ctx.fillText('Esperando audio…', cssW / 2, cssH / 2 - 6);
      ctx.fillStyle = 'rgba(155, 166, 196, 0.85)';
      ctx.font = `${11 * dpr}px monospace`;
      ctx.fillText('Reproducí la pista en la consola principal.', cssW / 2, cssH / 2 + 16);
    } else {
      // Pre-asignar buffers reutilizables (cero alloc dentro del RAF).
      const bins = tap.analyserWaterfall.frequencyBinCount;
      const waterfallRow = new Uint8Array(bins);

      // Throttle 60 FPS — evita draws duplicados en monitores > 60Hz.
      let _lastFrame = 0;
      const _FRAME_INTERVAL = 1000 / 60;

      const tick = (now: any) => {
        if (!state.waterfall.animating || !state.waterfall.rafId) return;
        if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
          cancelAnimationFrame(state.waterfall.rafId);
          state.waterfall.rafId = null;
          state.waterfall.animating = false;
          return; // skip animation (P0 accessibility)
        }
        const liveCanvas = $canvas('waterfallCanvas');
        if (!liveCanvas) { state.waterfall.rafId = null; return; }

        if (now && _lastFrame && (now - _lastFrame) < _FRAME_INTERVAL) {
          state.waterfall.rafId = requestAnimationFrame(tick);
          return;
        }
        _lastFrame = now || 0;

        tap.analyserWaterfall.getByteFrequencyData(waterfallRow);
        drawWaterfallFrame(liveCanvas, ctx, waterfallRow);

        state.waterfall.rafId = requestAnimationFrame(tick);
      };

      // Pintar la primera fila de inmediato para que la pantalla no quede negra
      // ni un frame antes del primer drawImage.
      tap.analyserWaterfall.getByteFrequencyData(waterfallRow);
      drawWaterfallFrame(canvas, ctx, waterfallRow);
      state.waterfall.rafId = requestAnimationFrame(tick);
    }

    // Toggle: arranca o cancela el RAF; nunca deja un ciclo huérfano.
    el('btnToggle3D')?.addEventListener('click', () => {
      if (!tap) {
        LGMDM.ui?.showToast?.('Necesitás audio en reproducción para activar el waterfall.', 'warning', 3500);
        return;
      }
      if (state.waterfall.animating) {
        if (state.waterfall.rafId) {
          cancelAnimationFrame(state.waterfall.rafId);
          state.waterfall.rafId = null;
        }
        state.waterfall.animating = false;
      } else {
        state.waterfall.animating = true;
        const liveCanvas = $canvas('waterfallCanvas');
        const liveCtx = liveCanvas && liveCanvas.getContext('2d');
        if (!liveCanvas || !liveCtx) return;
        const bins = tap.analyserWaterfall.frequencyBinCount;
        const waterfallRow2 = new Uint8Array(bins);
        let _lastFrameR = 0;
        const _FRAME_INTERVAL_R = 1000 / 60;
        const tickResume = (now: any) => {
          if (!state.waterfall.animating || !state.waterfall.rafId) return;
          if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            cancelAnimationFrame(state.waterfall.rafId);
            state.waterfall.rafId = null;
            state.waterfall.animating = false;
            return; // skip animation (P0 accessibility)
          }
          const c = $canvas('waterfallCanvas');
          if (!c) { state.waterfall.rafId = null; return; }
          if (now && _lastFrameR && (now - _lastFrameR) < _FRAME_INTERVAL_R) {
            state.waterfall.rafId = requestAnimationFrame(tickResume);
            return;
          }
          _lastFrameR = now || 0;
          tap.analyserWaterfall.getByteFrequencyData(waterfallRow2);
          drawWaterfallFrame(c, liveCtx, waterfallRow2);
          state.waterfall.rafId = requestAnimationFrame(tickResume);
        };
        state.waterfall.rafId = requestAnimationFrame(tickResume);
      }
      const btn = el('btnToggle3D');
      if (btn) btn.textContent = state.waterfall.animating ? '⏸ Pausar 3D' : '▶ Reanudar 3D';
    });
  }

  function renderDoctorTab(container: HTMLElement, metrics: ComplianceMetrics) {
    container.innerHTML = `
      <div>
        <div class="pro-doctor-head">
          <div>
            <h4 class="pro-h4">AI Audio Doctor & Diagnóstico de Mezcla</h4>
            <p class="pro-section-subtitle-tight">Análisis psicoacústico y resolución de problemas frecuentes con 1 clic.</p>
          </div>
          <button class="pro-primary pro-cert-export" id="btnApplyAllFixes" data-action="auto-fix">⚡ Aplicar Macro-Correcciones</button>
        </div>

        <div class="pro-grid-stack">
          <div class="pro-meter-card pro-flex-between">
            <div>
              <strong class="pro-doctor-row-strong">✓ Control de Resonancias en Medios-Altos (2.5 kHz – 4 kHz)</strong>
              <small class="pro-doctor-info">Energía equilibrada sin asperezas perceptivas notables.</small>
            </div>
            <span class="pro-meter-status">OPTIMIZADO</span>
          </div>

          <div class="pro-meter-card pro-flex-between">
            <div>
              <strong class="pro-doctor-warning-strong">⚠️ Claridad de Graves (200 Hz – 400 Hz Muddy Buildup)</strong>
              <small class="pro-doctor-info">Se detectó leve acumulación de medios-graves que reduce la definición del bombo.</small>
            </div>
            <button class="pro-action-btn pro-doctor-300" id="btnFixMud" data-action="auto-fix">Limpiar 300Hz (-1.2 dB)</button>
          </div>

          <div class="pro-meter-card pro-flex-between">
            <div>
              <strong class="pro-doctor-row-strong">✓ Margen Dinámico y Crest Factor (LRA ${metrics.lra.toFixed(1)} LU)</strong>
              <small class="pro-doctor-info">Rango dinámico musical y preservación de transitorios intacta.</small>
            </div>
            <span class="pro-meter-status">SALUDABLE</span>
          </div>
        </div>

        <div id="doctorFeedback" class="pro-status-feedback-info"></div>
      </div>
    `;

    const applyClean300 = () => {
      const eq2Freq = $input('s-eq2freq');
      if (eq2Freq) {
        eq2Freq.value = '300';
        eq2Freq.dispatchEvent(new Event('input', { bubbles: true }));
        eq2Freq.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const eq2Gain = $input('s-eq2gain');
      if (eq2Gain) {
        eq2Gain.value = '-1.2';
        eq2Gain.dispatchEvent(new Event('input', { bubbles: true }));
        eq2Gain.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (!eq2Freq) {
        const dynFreq = $input('s-dyneq-freq');
        if (dynFreq) {
          dynFreq.value = '300';
          dynFreq.dispatchEvent(new Event('input', { bubbles: true }));
          dynFreq.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    };

    ['btnFixMud', 'btnApplyAllFixes', 'btnAutoFix'].forEach((btnId) => {
      el(btnId)?.addEventListener('click', () => {
        applyClean300();
        const fb = el('doctorFeedback');
        if (fb) fb.textContent = '✓ Curva correctiva aplicada: EQ2 a 300 Hz (-1.2 dB).';
        LG.ui?.showStatus?.(null, 'AI Doctor: EQ2 ajustado a 300 Hz (-1.2 dB)', 'info');
      });
    });
  }

  function renderDemaskTab(container: HTMLElement) {
    loadDemaskSettings();

    container.innerHTML = `
      <div>
        <h4 class="pro-h4-accent">🎛️ Desmascaramiento Espectral Cruzado entre Stems</h4>
        <p class="pro-section-subtitle">
          Evita que el bajo opaque el bombo y despeja espacio para la voz principal automáticamente sobre el audio real.
        </p>

        <div class="pro-grid-2col">
          <div class="pro-meter-card">
            <strong class="pro-card-title">⚙️ Parámetros de Desmascaramiento</strong>
            <div class="pro-control-row">
              <label>Profundidad (Kick vs Bass):</label>
              <input type="range" min="0" max="100" value="${state.demask.kickDepth}" id="demaskKickDepth">
              <output id="demaskKickDepthVal">${state.demask.kickDepth}%</output>
            </div>
            <div class="pro-control-row">
              <label>Sensibilidad (Vocal Ducking):</label>
              <input type="range" min="0" max="100" value="${state.demask.voxDepth}" id="demaskVoxDepth">
              <output id="demaskVoxDepthVal">${state.demask.voxDepth}%</output>
            </div>
            <p class="pro-caption-muted-tight">
              Profundidad controla la atenuación en dB (-2 a -12 dB). Sensibilidad define el umbral de detección de colisión espectral.
            </p>
          </div>

          <div class="pro-meter-card">
            <strong class="pro-card-title">📁 Stems de Audio</strong>
            <p class="pro-caption-muted">
              Subí las dos pistas que querés desmascarizar.
            </p>
            <div class="pro-vgap-10">
              <label class="pro-label-muted">Target Stem (voz / bombo — la pista a liberar):</label>
              <input type="file" id="demaskTargetFile" accept="audio/*" class="pro-file-input">
            </div>
            <div class="pro-vgap-10">
              <label class="pro-label-muted">Masking Stem (bajo / instrumentación — la pista que enmascara):</label>
              <input type="file" id="demaskMaskingFile" accept="audio/*" class="pro-file-input">
            </div>
            <div class="pro-button-stack">
              <button class="pro-primary pro-flex-1" id="btnRunDemask">⚡ Procesar Cross-Demask</button>
              <button class="pro-action-btn" id="btnApplyDemask" title="Guardar solo los parámetros de slider">💾</button>
            </div>
            <div id="demaskStatus" class="pro-status"></div>
          </div>
        </div>

        <div id="demaskOutputArea" class="pro-output-area pro-meter-card">
          <strong class="pro-card-title-accent">✓ Audio Desenmascarado Listo</strong>
          <div class="pro-output-row">
            <audio id="demaskAudioPlayer" controls class="pro-audio-player"></audio>
            <a id="demaskDownloadBtn" class="pro-action-btn pro-download-link" download="unmasked_master.wav">📥 Descargar WAV</a>
          </div>
        </div>
      </div>
    `;

    const updateKick = (val: any) => {
      const out = el('demaskKickDepthVal');
      if (out) out.textContent = `${val}%`;
    };
    const updateVox = (val: any) => {
      const out = el('demaskVoxDepthVal');
      if (out) out.textContent = `${val}%`;
    };

    el('demaskKickDepth')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      state.demask.kickDepth = val;
      updateKick(val);
      saveDemaskSettings();
    });
    el('demaskVoxDepth')?.addEventListener('input', (e) => {
      const val = Number((e.target as HTMLInputElement).value);
      state.demask.voxDepth = val;
      updateVox(val);
      saveDemaskSettings();
    });

    el('btnApplyDemask')?.addEventListener('click', () => {
      saveDemaskSettings();
      LGMDM.ui?.showToast?.('Parámetros de desmascaramiento guardados', 'success', 2500);
    });

    el('btnRunDemask')?.addEventListener('click', async () => {
      const targetPicker = $input('demaskTargetFile');
      const maskingPicker = $input('demaskMaskingFile');
      const targetFile = targetPicker && targetPicker.files && targetPicker.files[0] ? targetPicker.files[0] : null;
      const maskingFile = maskingPicker && maskingPicker.files && maskingPicker.files[0] ? maskingPicker.files[0] : null;

      if (!targetFile || !maskingFile) {
        LGMDM.ui?.showToast?.('Subí tanto el target stem como el masking stem para procesar.', 'warning', 4000);
        return;
      }

      const status = el('demaskStatus');
      const btn = $button('btnRunDemask');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Analizando colisión espectral entre stems en backend…';
        const fd = new FormData();
        fd.append('target_stem', targetFile);
        fd.append('masking_stem', maskingFile);
        // Mapeo slider 0–100 → depth_db -2 a -12 dB
        const kickPct = Number($input('demaskKickDepth')?.value || 50);
        const depthDb = (-2 - (kickPct / 100) * 10).toFixed(2);
        fd.append('depth_db', depthDb);
        // Mapeo slider 0–100 → sensitivity 0.0 a 1.0
        const voxPct = Number($input('demaskVoxDepth')?.value || 50);
        fd.append('sensitivity', (voxPct / 100).toFixed(2));

        const res = await apiPostDsp('/dsp/cross-demask', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('demaskAudioPlayer') as HTMLAudioElement | null;
        const dl = el('demaskDownloadBtn') as HTMLAnchorElement | null;
        const outArea = el('demaskOutputArea');
        if (player) player.src = url;
        if (dl) dl.href = url;
        if (outArea) outArea.style.display = 'block';
        const metrics = readDspMetrics(res);
        const metricsLine = formatDspMetrics(metrics);
        const baseMsg = `✓ Desenmascaramiento completado (depth=${depthDb} dB, sens=${(voxPct/100).toFixed(2)})`;
        if (status) status.textContent = metricsLine ? `${baseMsg}. ${metricsLine}` : `${baseMsg}.`;
        LGMDM.ui?.showToast?.('Cross-demask aplicado con éxito.', 'success', 3500);
      } catch (err) {
        if (status) status.textContent = `❌ Error: cross-demask falló`;
        LGMDM.errors?.safeToast?.('Cross-demask', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  async function apiPostDsp(endpoint: string, formData: FormData) {
    const apiBase = window.safeApiBase();
    const token = (typeof LGMDM !== 'undefined' && LGMDM.api && typeof LGMDM.api.authToken === 'function')
      ? LGMDM.api.authToken()
      : (sessionStorage.getItem('master_auth_token') || '');
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(`${apiBase}${endpoint}`, {
      method: 'POST',
      headers,
      body: formData
    });
    if (res.status === 404) {
      const err = new Error(`DSP endpoint ${endpoint} no disponible en este despliegue — se habilitará pronto`) as Error & { code: string; endpoint: string };
      err.code = 'DSP_UNAVAILABLE';
      err.endpoint = endpoint;
      throw err;
    }
    if (!res.ok) {
      let errText = '';
      try { errText = await res.text(); } catch (_) {}
      throw new Error(`HTTP ${res.status}: ${errText || res.statusText}`);
    }
    return res;
  }

  function getActiveOrPickedFile(pickerId: string | null) {
    const picker = pickerId != null ? $input(pickerId) : null;
    if (picker && picker.files && picker.files[0]) return picker.files[0];
    const sel = getSelectedFile();
    if (sel) return sel;
    return null;
  }

  // El backend adjunta X-Output-LUFS, X-Confidence, X-Mode,
  // X-Reference-Match, X-Detected-Key en cada respuesta /dsp/*.
  // Si falta un header, se omite silenciosamente (no rompe el flow).
  function readDspMetrics(res: Response) {
    const out = { lufs: null as number | null, confidence: null as number | null, mode: null as string | null, refMatch: null as string | null, key: null as string | null };
    if (!res || !res.headers || typeof res.headers.get !== 'function') return out;
    const lufs = res.headers.get('X-Output-LUFS');
    if (lufs != null && lufs !== '') {
      const n = Number(lufs);
      if (Number.isFinite(n)) out.lufs = n;
    }
    const conf = res.headers.get('X-Confidence');
    if (conf != null && conf !== '') {
      const n = Number(conf);
      if (Number.isFinite(n)) out.confidence = n;
    }
    out.mode = res.headers.get('X-Mode') || null;
    out.refMatch = res.headers.get('X-Reference-Match') || null;
    out.key = res.headers.get('X-Detected-Key') || null;
    return out;
  }

  function formatDspMetrics(m: ReturnType<typeof readDspMetrics>, fallbackLufs?: number) {
    const parts = [];
    if (m.lufs != null) parts.push(`LUFS: ${m.lufs.toFixed(1)}`);
    if (m.key)         parts.push(`Key: ${m.key}`);
    if (m.confidence != null) parts.push(`Conf: ${(m.confidence * 100).toFixed(0)}%`);
    if (m.refMatch != null) {
      const r = Number(m.refMatch);
      if (Number.isFinite(r)) parts.push(`Ref: ${r.toFixed(2)}`);
    }
    if (m.mode)        parts.push(`Mode: ${m.mode}`);
    if (parts.length === 0 && typeof fallbackLufs === 'number' && Number.isFinite(fallbackLufs)) {
      parts.push(`LUFS: ${fallbackLufs.toFixed(1)}`);
    }
    return parts.length ? parts.join(' · ') : '';
  }

  function renderTamerTab(container: HTMLElement) {
    const currentFile = getSelectedFile();
    const currentName = currentFile ? LGMDM.ui.escapeHtml(currentFile.name) : 'Ningún archivo cargado en consola';
    container.innerHTML = `
      <div>
        <h4 class="pro-h4-accent">🎯 Supresor Espectral de Resonancias (Soothe-Style Tamer)</h4>
        <p class="pro-section-subtitle">
          Atenúa dinámicamente asperezas, sibilancias y resonancias estacionarias en tiempo real sin desnaturalizar el timbre.
        </p>

        <div class="pro-grid-2col">
          <div class="pro-meter-card">
            <strong class="pro-card-title">⚙️ Parámetros de Atenuación</strong>
            <div class="pro-control-row">
              <label>Sensibilidad:</label>
              <input type="range" min="0.1" max="1.0" step="0.05" value="0.5" id="tamerSensitivity">
              <output id="tamerSensitivityVal">0.50</output>
            </div>
            <div class="pro-control-row">
              <label>Reducción Máxima:</label>
              <input type="range" min="-18" max="-2" step="0.5" value="-6.0" id="tamerDepth">
              <output id="tamerDepthVal">-6.0 dB</output>
            </div>
            <div class="pro-control-row">
              <label>Bandas FFT:</label>
              <select id="tamerBands" class="pro-select-dark">
                <option value="32">32 bandas (Rápido / Voces)</option>
                <option value="64" selected>64 bandas (Equilibrado / Mix)</option>
                <option value="128">128 bandas (Alta resolución quirúrgica)</option>
              </select>
            </div>
          </div>

          <div class="pro-meter-card">
            <strong class="pro-card-title">📁 Archivo de Audio</strong>
            <p class="pro-caption-muted">
              Pista actual: <span class="pro-current-file">${currentName}</span>
            </p>
            <div class="pro-section-gap-tight">
              <label class="pro-label-muted">O seleccionar archivo alternativo:</label>
              <input type="file" id="tamerFileInput" accept="audio/*" class="pro-file-input">
            </div>
            <div class="pro-mt-14">
              <button class="pro-primary pro-full-width" id="btnRunTamer">⚡ Procesar con Resonance Tamer</button>
            </div>
            <div id="tamerStatus" class="pro-status"></div>
          </div>
        </div>

        <div id="tamerOutputArea" class="pro-output-area pro-meter-card">
          <strong class="pro-card-title-accent">✓ Audio Procesado Listo</strong>
          <div class="pro-output-row">
            <audio id="tamerAudioPlayer" controls class="pro-audio-player"></audio>
            <a id="tamerDownloadBtn" class="pro-action-btn pro-download-link" download="tamed_master.wav">📥 Descargar WAV</a>
          </div>
          <div id="tamerABCompare" class="pro-a-b-compare" hidden>
            <span class="pro-a-b-label">A/B Compare</span>
            <button class="pro-action-btn" id="tamerPlayOrig" type="button">▶ Original</button>
            <button class="pro-action-btn active" id="tamerPlayProc" type="button">▶ Procesado</button>
          </div>
        </div>
      </div>
    `;

    el('tamerSensitivity')?.addEventListener('input', (e) => {
      const o = el('tamerSensitivityVal'); if (o) o.textContent = Number((e.target as HTMLInputElement).value).toFixed(2);
    });
    el('tamerDepth')?.addEventListener('input', (e) => {
      const o = el('tamerDepthVal'); if (o) o.textContent = `${Number((e.target as HTMLInputElement).value).toFixed(1)} dB`;
    });

    el('btnRunTamer')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('tamerFileInput');
      if (!file) {
        LGMDM.ui?.showToast?.('Por favor selecciona un archivo de audio o carga uno en la consola.', 'warning', 4000);
        return;
      }
      const status = el('tamerStatus');
      const btn = $button('btnRunTamer');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Procesando supresión espectral en backend…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('sensitivity', $input('tamerSensitivity')?.value || '0.5');
        fd.append('depth_db', $input('tamerDepth')?.value || '-6.0');
        fd.append('n_bands', $select('tamerBands')?.value || '64');

        const res = await apiPostDsp('/dsp/resonance-tamer', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('tamerAudioPlayer') as HTMLAudioElement | null;
        const dl = el('tamerDownloadBtn') as HTMLAnchorElement | null;
        const outArea = el('tamerOutputArea');
        const abArea = el('tamerABCompare');
        if (player) player.src = url;
        if (dl) dl.href = url;
        if (outArea) outArea.style.display = 'block';
        if (abArea) abArea.hidden = false;
        const metrics = readDspMetrics(res);
        const metricsLine = formatDspMetrics(metrics);
        if (status) status.textContent = metricsLine
          ? `✓ Procesamiento completado. ${metricsLine}`
          : '✓ Procesamiento completado con éxito.';
        setupABCompare('tamer', file, url);
      } catch (err) {
        if (status) status.textContent = `❌ Error: ${(err as Error).message}`;
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderPhantomSubTab(container: HTMLElement) {
    const currentFile = getSelectedFile();
    const currentName = currentFile ? LGMDM.ui.escapeHtml(currentFile.name) : 'Ningún archivo cargado en consola';
    container.innerHTML = `
      <div>
        <h4 class="pro-h4-accent">🔊 Generador Psicoacústico de Graves (Phantom Sub Bass)</h4>
        <p class="pro-section-subtitle">
          Genera la serie armónica superior de las notas graves profundas para que se reproduzcan con pegada en teléfonos y altavoces portátiles.
        </p>

        <div class="pro-grid-2col">
          <div class="pro-meter-card">
            <strong class="pro-card-title">🎛 Frecuencia y Armónicos</strong>
            <div class="pro-control-row">
              <label>Corte Sub-Bass:</label>
              <input type="range" min="40" max="110" step="5" value="80" id="phantomCrossover">
              <output id="phantomCrossoverVal">80 Hz</output>
            </div>
            <div class="pro-control-row">
              <label>Modo Armónico:</label>
              <select id="phantomMode" class="pro-select-dark">
                <option value="fifth" selected>2º y 3º Armónico (Octava + Quinta / Estándar Pro)</option>
                <option value="octave">Solo 2º Armónico (Octava limpia)</option>
                <option value="rich">2º, 3º y 4º Armónico (Alta densidad para móviles pequeños)</option>
              </select>
            </div>
            <div class="pro-control-row">
              <label>Mezcla:</label>
              <input type="range" min="10" max="100" value="45" id="phantomMix">
              <output id="phantomMixVal">45%</output>
            </div>
          </div>

          <div class="pro-meter-card">
            <strong class="pro-card-title">📁 Procesamiento</strong>
            <p class="pro-caption-muted">
              Pista actual: <span class="pro-current-file">${currentName}</span>
            </p>
            <div class="pro-section-gap-tight">
              <label class="pro-label-muted">O seleccionar archivo:</label>
              <input type="file" id="phantomFileInput" accept="audio/*" class="pro-file-input">
            </div>
            <div class="pro-mt-14">
              <button class="pro-primary pro-full-width" id="btnRunPhantom">🔊 Sintetizar Fundamental Fantasma</button>
            </div>
            <div id="phantomStatus" class="pro-status"></div>
          </div>
        </div>

        <div id="phantomOutputArea" class="pro-output-area pro-meter-card">
          <strong class="pro-card-title-accent">✓ Audio con Graves Fantasma Listo</strong>
          <div class="pro-output-row">
            <audio id="phantomAudioPlayer" controls class="pro-audio-player"></audio>
            <a id="phantomDownloadBtn" class="pro-action-btn pro-download-link" download="phantom_sub_master.wav">📥 Descargar WAV</a>
          </div>
          <div id="phantomABCompare" class="pro-a-b-compare" hidden>
            <span class="pro-a-b-label">A/B Compare</span>
            <button class="pro-action-btn" id="phantomPlayOrig" type="button">▶ Original</button>
            <button class="pro-action-btn active" id="phantomPlayProc" type="button">▶ Procesado</button>
          </div>
        </div>
      </div>
    `;

    el('phantomCrossover')?.addEventListener('input', (e) => {
      const o = el('phantomCrossoverVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value} Hz`;
    });
    el('phantomMix')?.addEventListener('input', (e) => {
      const o = el('phantomMixVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value}%`;
    });

    el('btnRunPhantom')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('phantomFileInput');
      if (!file) {
        LGMDM.ui?.showToast?.('Por favor selecciona un archivo de audio o carga uno en la consola.', 'warning', 4000);
        return;
      }
      const status = el('phantomStatus');
      const btn = $button('btnRunPhantom');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Sintetizando armónicos psicoacústicos en backend…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('crossover_hz', $input('phantomCrossover')?.value || '80');
        fd.append('mix', (Number($input('phantomMix')?.value || 45) / 100).toFixed(2));
        fd.append('harmonic_mode', $select('phantomMode')?.value || 'fifth');

        const res = await apiPostDsp('/dsp/phantom-sub', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('phantomAudioPlayer') as HTMLAudioElement | null;
        const dl = el('phantomDownloadBtn') as HTMLAnchorElement | null;
        const outArea = el('phantomOutputArea');
        const abArea = el('phantomABCompare');
        if (player) player.src = url;
        if (dl) dl.href = url;
        if (outArea) outArea.style.display = 'block';
        if (abArea) abArea.hidden = false;
        const metrics = readDspMetrics(res);
        const metricsLine = formatDspMetrics(metrics);
        if (status) status.textContent = metricsLine
          ? `✓ Fundamental fantasma sintetizada. ${metricsLine}`
          : '✓ Fundamental fantasma sintetizada con éxito.';
        setupABCompare('phantom', file, url);
      } catch (err) {
        if (status) status.textContent = `❌ Error: ${(err as Error).message}`;
      } finally {
        if (btn) (btn as HTMLButtonElement).disabled = false;
      }
    });
  }

  function renderStemSepTab(container: HTMLElement) {
    const currentFile = getSelectedFile();
    const currentName = currentFile ? LGMDM.ui.escapeHtml(currentFile.name) : 'Ningún archivo cargado en consola';
    container.innerHTML = `
      <div>
        <h4 class="pro-h4-accent">🪄 Separador de Stems por IA (Demucs AI Studio)</h4>
        <p class="pro-section-subtitle">
          Descompone la pista estéreo en canales aislados de Voz, Batería, Bajo e Instrumental mediante redes neuronales.
        </p>

        <div class="pro-grid-2col">
          <div class="pro-meter-card">
            <strong class="pro-card-title">🤖 Modelo de Red Neuronal</strong>
            <div class="pro-control-row">
              <label>Modo de Extracción:</label>
              <select id="stemSepMode" class="pro-select-dark">
                <option value="demucs_4stem" selected>Demucs v4 (4 Stems: Voz, Batería, Bajo, Otros)</option>
                <option value="vocals_hq">Mel-RoFormer / Vocals HQ (Voz Aislada de Máxima Definición)</option>
              </select>
            </div>
            <p class="pro-doctor-info" style="margin: 8px 0;">
              El proceso ejecuta inferencia espectral en el backend y notifica el avance en tiempo real.
            </p>
          </div>

          <div class="pro-meter-card">
            <strong class="pro-card-title">📁 Pista a Separar</strong>
            <p class="pro-caption-muted">
              Pista actual: <span class="pro-current-file">${currentName}</span>
            </p>
            <div class="pro-section-gap-tight">
              <label class="pro-label-muted">O seleccionar archivo:</label>
              <input type="file" id="stemSepFileInput" accept="audio/*" class="pro-file-input">
            </div>
            <div class="pro-mt-14">
              <button class="pro-primary pro-full-width" id="btnRunStemSep">🪄 Iniciar Separación de Stems</button>
            </div>
            <div id="stemSepStatus" class="pro-status"></div>
          </div>
        </div>

        <div id="stemSepProgressArea" class="pro-progress-area pro-meter-card">
          <strong class="pro-card-title">Progreso de la Separación:</strong>
          <div class="pro-progress-bar-bg">
            <div id="stemSepProgressBar" class="pro-progress-bar"></div>
          </div>
          <div id="stemSepStageText" class="pro-progress-stage">En cola…</div>
        </div>
      </div>
    `;

    el('btnRunStemSep')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('stemSepFileInput');
      if (!file) {
        LGMDM.ui?.showToast?.('Por favor selecciona un archivo de audio o carga uno en la consola.', 'warning', 4000);
        return;
      }
      const status = el('stemSepStatus');
      const btn = $button('btnRunStemSep');
      const progArea = el('stemSepProgressArea');
      const bar = el('stemSepProgressBar');
      const stage = el('stemSepStageText');

      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = 'Enviando track al backend…';
        if (progArea) progArea.style.display = 'block';

        const fd = new FormData();
        fd.append('file', file);
        fd.append('mode', $select('stemSepMode')?.value || 'demucs_4stem');

        const apiBase = window.safeApiBase();
        const res = await apiPostDsp('/stems/separate', fd);
        if (!res.ok) {
          let detail = `HTTP ${res.status}`;
          try { const text = await res.text(); if (text) detail += `: ${text}`; } catch (_) {}
          if (status) status.textContent = `❌ Error: ${detail}`;
          if (btn) btn.disabled = false;
          return;
        }
        const data = await res.json();
        const jobId = data.job_id;

        if (status) status.textContent = `Job ID: ${jobId.slice(0, 8)}… separando`;

        const pollInterval = setInterval(async () => {
          // FIX M-NEW-13: el `await jobRes.json()` (antes línea 2131) estaba
          // FUERA del try/catch que cubría apiFetch → si json() fallaba,
          // el callback async rechazaba y setInterval no lo atrapaba
          // (unhandled rejection). Ahora todo está dentro de un try/catch.
          try {
            let jobRes;
            try {
              jobRes = await LGMDM.api.apiFetch(`${apiBase}/job/${jobId}`);
            } catch (_) {
              clearInterval(pollInterval); _proIntervals.delete(pollInterval);
              if (status) status.textContent = `❌ Error: fallo de red consultando el job`;
              if (btn) btn.disabled = false;
              return;
            }
            if (!jobRes.ok) {
              clearInterval(pollInterval); _proIntervals.delete(pollInterval);
              if (status) status.textContent = `❌ Error consultando el job: HTTP ${jobRes.status}`;
              if (btn) btn.disabled = false;
              return;
            }
            const jobData = await jobRes.json();
            const pct = jobData.progress || 0;
            if (bar) bar.style.width = `${pct}%`;
            if (stage) stage.textContent = `${jobData.stage || 'Procesando'} (${pct}%)`;

            if (jobData.status === 'done') {
              clearInterval(pollInterval); _proIntervals.delete(pollInterval);
              if (btn) btn.disabled = false;
              const metrics = readDspMetrics(jobRes);
              const metricsLine = formatDspMetrics(metrics);
              if (status) status.textContent = metricsLine
                ? `✓ Stems separados. ${metricsLine}`
                : '✓ Stems separados con éxito.';
              if (stage) stage.textContent = '✨ ¡Separación completada! Los stems están listos en el sistema.';
            } else if (jobData.status === 'error') {
              clearInterval(pollInterval); _proIntervals.delete(pollInterval);
              if (btn) btn.disabled = false;
              if (status) status.textContent = `❌ Error: ${jobData.error || 'Fallo en la separación'}`;
            }
          } catch (err) {
            clearInterval(pollInterval); _proIntervals.delete(pollInterval);
            if (btn) btn.disabled = false;
            if (status) status.textContent = `❌ Error: ${(err as Error).message || 'fallo inesperado'}`;
          }
        }, 1500);
        _proIntervals.add(pollInterval);

      } catch (err) {
        if (status) status.textContent = `❌ Error: ${(err as Error).message}`;
        if (btn) btn.disabled = false;
      }
    });
  }

  // Registry declarativo: tab → clase widget + endpoint opcional.
  // 4 widgets con endpoint nuevo (advanced_dsp.py):
  //   - loudness-penalty, phase-rotation, spectral-tilt, dr-meter
  // 6 widgets sin endpoint (visualización local o DSP ya en mastering.py):
  //   - multiband-transient, ms-imager, reverb, loudness-war,
  //     reference-match, saturation
  const PRO_FEATURES = {
    // FIX K3: endpoints /dsp/* (backend prefix="/dsp", advanced_dsp.py:195).
    'loudness-penalty':    { cls: 'loudnessPenaltyWidget',    endpoint: '/dsp/loudness-penalty' },
    'spectral-tilt':       { cls: 'spectralTiltWidget',       endpoint: '/dsp/spectral-tilt' },
    'multiband-transient': { cls: 'multibandTransientWidget', endpoint: null },
    'ms-imager':           { cls: 'msImagerWidget',           endpoint: null },
    'reference-match':     { cls: 'referenceMatchWidget',     endpoint: '/dsp/match-eq' },
    'dr-meter':            { cls: 'drMeterWidget',            endpoint: '/dsp/dr-meter' },
    // FIX X-04 — saturation e phase-rotation son widgets distintos, NO duplicados:
    //   - saturation:    visualizador de saturación armónica (I/II/III curve, drive) → /dsp/inflator
    //   - phase-rotation: heatmap de fase × freq con knobs de ángulo por banda → /dsp/phase-rotation
    // El dual naming 'saturation' (UI) ↔ 'inflator' (backend id) es por convención del
    // Insert abstraction: insert-base.js inserta el módulo como `inflator` en el rack,
    // pero el modal usa la etiqueta 'Saturation' para el usuario final.
    'saturation':          { cls: 'saturationWidget',         endpoint: '/dsp/inflator' },
    'phase-rotation':      { cls: 'phaseRotationWidget',      endpoint: '/dsp/phase-rotation' },
    'reverb':              { cls: 'reverbWidget',             endpoint: null },
    'loudness-war':        { cls: 'loudnessWarWidget',        endpoint: null },
    'iso-compensation':    { cls: 'isoCompensationWidget',    endpoint: '/dsp/iso-compensation' },
    'resonance-tamer':     { cls: 'resonanceTamerWidget',     endpoint: '/dsp/resonance-tamer' },
    'phantom-sub':         { cls: 'phantomSubWidget',         endpoint: '/dsp/phantom-sub' },
    'cross-demask':        { cls: 'crossDemaskWidget',        endpoint: '/dsp/cross-demask' }
  };

  const _proInstances = new Map();

  // C6 — Track Object URLs creados por tabs DSP / setupABCompare para
  // revocarlos en teardownProFeatures() y evitar leaks de memoria.
  const _proObjectUrls = new Set<string>();
  // FIX A8: registry de intervals activos (stemsep polling, etc.) para que
  // teardownProFeatures pueda cancelarlos. Antes el pollInterval era local
  // al closure del handler click → no se podía cancelar desde afuera → si
  // el usuario cambiaba de tab mientras el job corría, seguía polleando.
  const _proIntervals = new Set<ReturnType<typeof setTimeout>>();
  function _trackObjectUrl(url: string) {
    _proObjectUrls.add(url);
    return url;
  }

  function _proLogMissing(cls: string) {
    if (typeof console !== 'undefined') {
      console.warn(`[proFeatures] clase "${cls}" no registrada. ¿Cargó el script correspondiente?`);
    }
  }

  function teardownProFeatures() {
    _proObjectUrls.forEach(url => { try { URL.revokeObjectURL(url); } catch (_) {} });
    _proObjectUrls.clear();
    _proIntervals.forEach(id => { try { clearInterval(id); } catch (_) {} });
    _proIntervals.clear();
    if (_analysisUpdatedHandler) {
      try { window.removeEventListener('analysis-updated', _analysisUpdatedHandler); } catch (_) {}
      _analysisUpdatedHandler = null;
    }
    LGMDM.proFeatures.audioTap.teardown();
    if (state.stereo && state.stereo.rafId) { cancelAnimationFrame(state.stereo.rafId); state.stereo.rafId = 0; }
    if (state.waterfall && state.waterfall.rafId) { cancelAnimationFrame(state.waterfall.rafId); state.waterfall.rafId = 0; }
    if (state.waterfall) state.waterfall.animating = false;
    // MX-14 — Cancelar observers pendientes del lifecycle: si setupProFeatures
    // quedó esperando un canvas que nunca llegó, no debe sobrevivir al teardown
    // (de otro modo seguiría escuchando mutaciones y disparando warnings hasta
    // su timeout interno).
    _proPendingCanvas.forEach((_, pendingTabId) => _cancelPendingCanvas(pendingTabId));
    // FIX M-NEW-14: forEach no espera promesas. Si inst.teardown() es async,
    // el catch síncrono no atrapa rejections → unhandled rejection. Usamos
    // Promise.allSettled para esperar y atrapar todas las rejections.
    void Promise.allSettled(
      Array.from(_proInstances.values()).map((inst) => {
        if (!inst) return Promise.resolve();
        try {
          if (typeof inst.teardown === 'function') return Promise.resolve(inst.teardown());
          if (typeof inst.destroy === 'function') return Promise.resolve(inst.destroy());
        } catch (e) {
          return Promise.reject(e);
        }
        return Promise.resolve();
      })
    );
    _proInstances.clear();
  }

  // FIX M-NEW-4: `_fetchDspJson` (18 líneas) eliminada — 0 callers desde el
  // commit inicial (verificado con grep + `git log -S`), dead code (regla 7).

  function setupProFeatures(tabId: string) {
    if (!tabId) return;
    const spec = PRO_FEATURES[tabId as keyof typeof PRO_FEATURES];
    if (!spec) return;
    const NS = LGMDM && LGMDM.proFeatures;
    if (!NS) { _proLogMissing('proFeatures namespace'); return; }
    const Cls = NS[spec.cls];
    if (typeof Cls !== 'function') { _proLogMissing(spec.cls); return; }
    if (_proInstances.has(tabId)) return;

    const canvas = el(`${tabId}Canvas`);
    if (!canvas) {
      // MX-14 — Safety net: si el canvas aún no está en el DOM, observar el
      // contenedor del modal y reintentar cuando se inyecte (protege contra
      // race conditions entre renderActiveTab() y esta función).
      _observeCanvasInsertion(tabId);
      return;
    }
    try {
      const inst = new Cls();
      inst.init(canvas, {});
      _proInstances.set(tabId, inst);

      // ── MX-06 — phase-rotation: invocar processAllBands al instanciar ──
      // Helper huérfano que recorre cada banda y llama /dsp/phase-rotation
      // por separado. Solo se dispara si hay un audio cargado en la consola
      // y el widget expone processAllBands en su clase.
      if (tabId === 'phase-rotation' && typeof Cls.processAllBands === 'function') {
        const file = getSelectedFile();
        if (file && inst.data && Array.isArray(inst.data.bands) && inst.data.bands.length > 0) {
          Cls.processAllBands(file, inst.data.bands.slice(), '')
            .then((results: unknown) => {
              if (!Array.isArray(results)) return;
              const okBands = results
                .filter((r) => r && r.ok)
                .map((r) => ({ name: r.name, freq_hz: r.freq_hz, angle_deg: r.angle_deg, q: r.q }));
              if (okBands.length && typeof inst.update === 'function') {
                inst.update({ bands: okBands });
              }
            })
            .catch((err: unknown) => {
              if (typeof console !== 'undefined') console.debug('[phase-rotation processAllBands]', err);
            });
        }
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.error(`[proFeatures] init(${tabId}) falló:`, err);
    }
  }

  // Si el canvas aún no está en el DOM cuando setupProFeatures() corre,
  // observamos #premiumTabContent vía MutationObserver y reintentamos cuando
  // se inserta el nodo. Sin esta red de seguridad, abrir un tab antes de que
  // renderActiveTab() inyecte el canvas dejaba el widget huérfano para
  // siempre (silent return).
  //
  // Cancelación: si la observación supera `_PRO_CANVAS_TIMEOUT_MS` sin éxito,
  // el observer se desconecta y se emite un warning (NO spamea: solo una vez
  // por tabId pendiente). Cambiar de tab cancela observadores previos.
  const _PRO_CANVAS_TIMEOUT_MS = 1000;
  const _proPendingCanvas = new Map();

  function _cancelPendingCanvas(tabId: string) {
    const entry = _proPendingCanvas.get(tabId);
    if (!entry) return;
    try { entry.observer && entry.observer.disconnect(); } catch (_) {}
    try { clearTimeout(entry.timeoutId); } catch (_) {}
    _proPendingCanvas.delete(tabId);
  }

  function _observeCanvasInsertion(tabId: string, maxMs?: number) {
    const timeoutMs = Number.isFinite(maxMs) ? maxMs : _PRO_CANVAS_TIMEOUT_MS;

    // MX-14 — Cancelar CUALQUIER observador pendiente antes de crear uno nuevo.
    // Antes solo se cancelaban los de OTROS tabIds, lo que dejaba un observer
    // huérfano si setupProFeatures(tabId) corría más de una vez antes de que
    // apareciera el canvas (Map.set sobrescribe la entry sin disconnect()). Solo
    // un observer debe estar activo a la vez.
    _proPendingCanvas.forEach((_, pendingTabId) => _cancelPendingCanvas(pendingTabId));

    // Re-check inmediato por race entre la lookup original y esta función.
    if (el(`${tabId}Canvas`)) {
      setupProFeatures(tabId);
      return;
    }

    const content = el('premiumTabContent');
    if (!content) {
      if (typeof console !== 'undefined') {
        console.warn(`[proFeatures] ${tabId}: contenedor #premiumTabContent ausente; no se puede esperar el canvas.`);
      }
      return;
    }

    const observer = new MutationObserver(() => {
      if (!_proPendingCanvas.has(tabId)) return; // ya cancelado
      if (el(`${tabId}Canvas`)) {
        _cancelPendingCanvas(tabId);
        setupProFeatures(tabId);
      }
    });
    observer.observe(content, { childList: true, subtree: true });
    const timeoutId = setTimeout(() => {
      _cancelPendingCanvas(tabId);
      if (!_proInstances.has(tabId) && typeof console !== 'undefined') {
        console.warn(`[proFeatures] ${tabId}: canvas "${tabId}Canvas" no apareció tras ${timeoutMs}ms.`);
      }
    }, timeoutMs);
    const entry: { observer: MutationObserver | null; timeoutId: ReturnType<typeof setTimeout> | null } = { observer, timeoutId };
    _proPendingCanvas.set(tabId, entry);
  }

  function _proPanelShell(tabId: any, title: any, subtitle: any, leftExtraHtml: any) {
    const camelBase = tabId.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
    const filePicker = `${camelBase}File`;
    const statusId = `${camelBase}Status`;
    return `
      <div>
        <h4 class="pro-h4-accent">${title}</h4>
        <p class="pro-section-subtitle">${subtitle}</p>
        <div class="pro-grid-2col">
          <div class="pro-meter-card">
            <strong class="pro-card-title">📁 Archivo de Audio</strong>
            <p class="pro-caption-muted">
              Pista actual: <span class="pro-current-file">${getSelectedFile() ? escapeHtml(getSelectedFile().name) : 'Ningún archivo cargado en consola'}</span>
            </p>
            <div class="pro-section-gap-tight">
              <label class="pro-label-muted">O seleccionar archivo alternativo:</label>
              <input type="file" id="${filePicker}" accept="audio/*" class="pro-file-input">
            </div>
            ${leftExtraHtml || ''}
          </div>
          <div class="pro-meter-card">
            <strong class="pro-card-title">📊 Visualización del Widget</strong>
            <div class="pro-widget-host" id="${tabId}Host">
              <canvas id="${tabId}Canvas" class="pro-widget-canvas" width="640" height="320"></canvas>
              <div class="controls" id="${tabId}Controls"></div>
            </div>
            <div id="${statusId}" data-status-id="${tabId}Status" class="pro-status"></div>
          </div>
        </div>
      </div>
    `;
  }

  function renderLoudnessPenaltyTab(container: HTMLElement) {
    const left = `
      <div class="pro-mt-14">
        <div class="pro-control-row">
          <label>Códec:</label>
          <select id="penaltyCodec" class="pro-select-dark">
            <option value="opus" selected>Opus 96 kbps (Spotify / Web)</option>
            <option value="aac">AAC 128 kbps (Apple Music)</option>
            <option value="mp3">MP3 128 kbps (Streaming agresivo)</option>
          </select>
        </div>
        <div class="pro-control-row">
          <label>Bitrate (kbps):</label>
          <input type="range" min="32" max="320" step="8" value="96" id="penaltyBitrate">
          <output id="penaltyBitrateVal">96 kbps</output>
        </div>
        <button class="pro-primary pro-full-width" id="btnRunPenalty" type="button">⚡ Simular Penalización</button>
      </div>
    `;
    container.innerHTML = _proPanelShell(
      'loudness-penalty',
      '🎯 Loudness Penalty por Plataforma de Streaming',
      'Simula la penalización LUFS al recodificar con códecs lossy (Opus/AAC/MP3) y visualiza el delta en dB.',
      left
    );

    el('penaltyBitrate')?.addEventListener('input', (e: Event) => {
      const o = el('penaltyBitrateVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value} kbps`;
    });

    el('btnRunPenalty')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('loudnessPenaltyFile');
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá un archivo de audio para simular la penalización.', 'warning', 4000);
        return;
      }
      const codec = $select('penaltyCodec')?.value || 'opus';
      const bitrate = Number($input('penaltyBitrate')?.value || 96);
      const status = el('loudnessPenaltyStatus');
      const btn = $button('btnRunPenalty');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Simulando recodificación con códec en backend…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('codec', codec);
        fd.append('bitrate', String(bitrate));
        const res = await apiPostDsp('/dsp/loudness-penalty', fd);
        const json = await res.json();
        const penalty = Number(json.penalty_db);
        const orig = Number(json.orig_lufs);
        const post = Number(json.post_lufs);
        const analysis = getLastAnalysis() || {};
        const baselineOrig = Number.isFinite(orig)
          ? orig
          : Number(analysis.integrated_lufs ?? analysis.lufs ?? -14);
        const baselinePost = Number.isFinite(post) ? post : baselineOrig + (Number.isFinite(penalty) ? penalty : 0);
        // El widget espera `platforms[]`; broadcast del mismo penalty a las 3 plataformas
        // (todas sufren la misma simulación de códec).
        const inst = _proInstances.get('loudness-penalty');
        if (inst && typeof inst.update === 'function') {
          inst.update({
            platforms: [
              { name: 'Spotify',   penalty_db: penalty, orig_lufs: baselineOrig, post_lufs: baselinePost },
              { name: 'Apple Music', penalty_db: penalty, orig_lufs: baselineOrig, post_lufs: baselinePost },
              { name: 'YouTube',   penalty_db: penalty, orig_lufs: baselineOrig, post_lufs: baselinePost }
            ]
          });
        }
        if (status) status.textContent = `✓ Penalty ${penalty.toFixed(2)} dB · ${codec} ${bitrate}kbps`;
        LGMDM.ui?.showToast?.(`Loudness Penalty: ${penalty.toFixed(2)} dB (${codec} ${bitrate}kbps).`, 'success', 3500);
      } catch (err) {
        if (status) status.textContent = `❌ Error: Loudness Penalty falló`;
        LGMDM?.errors?.safeToast?.('Loudness Penalty', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderSpectralTiltTab(container: HTMLElement) {
    const left = `
      <div class="pro-mt-14">
        <div class="pro-control-row">
          <label>Tilt (dB):</label>
          <input type="range" min="-12" max="12" step="0.5" value="3" id="tiltDb">
          <output id="tiltDbVal">+3.0 dB</output>
        </div>
        <div class="pro-control-row">
          <label>Pivote (Hz):</label>
          <input type="range" min="200" max="8000" step="50" value="1000" id="tiltPivot">
          <output id="tiltPivotVal">1000 Hz</output>
        </div>
        <button class="pro-primary pro-full-width" id="btnRunTilt" type="button">📈 Aplicar Spectral Tilt</button>
      </div>
    `;
    container.innerHTML = _proPanelShell(
      'spectral-tilt',
      '📈 Ecualizador de Inclinación Espectral (Linear-Phase Tilt)',
      'Aplica un shelving low/high pivotado para brightening o darkening sin phase shift por banda.',
      left
    );

    $input('tiltDb')?.addEventListener('input', (e: Event) => {
      const o = el('tiltDbVal'); if (o) o.textContent = `${Number((e.target as HTMLInputElement).value) > 0 ? '+' : ''}${Number((e.target as HTMLInputElement).value).toFixed(1)} dB`;
    });
    $input('tiltPivot')?.addEventListener('input', (e: Event) => {
      const o = el('tiltPivotVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value} Hz`;
    });

    el('btnRunTilt')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('spectralTiltFile');
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá un archivo de audio para aplicar Spectral Tilt.', 'warning', 4000);
        return;
      }
      const tilt = Number($input('tiltDb')?.value || 0);
      const pivot = Number($input('tiltPivot')?.value || 1000);
      const status = el('spectralTiltStatus');
      const btn = $button('btnRunTilt');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Aplicando tilt lineal-phase en backend…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('tilt_db', String(tilt));
        fd.append('pivot_hz', String(pivot));
        // El endpoint devuelve WAV 24-bit; usamos apiPostDsp existente para conservar patrón.
        const res = await apiPostDsp('/dsp/spectral-tilt', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        // Disparar descarga automática (preserva convención de tabs que producen WAV).
        const a = document.createElement('a');
        a.href = url; a.download = `tilted_${file.name || 'master'}.wav`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        // Actualizar widget con tilt_db / pivot_hz (la spectrum se mantiene vacía
        // porque el backend no expone espectro crudo en el response).
        const inst = _proInstances.get('spectral-tilt');
        if (inst && typeof inst.update === 'function') {
          inst.update({ tilt_db: tilt, pivot_hz: pivot, current_spectrum: [] });
        }
        if (status) status.textContent = `✓ Tilt ${tilt.toFixed(1)} dB @ ${pivot} Hz aplicado.`;
        LGMDM.ui?.showToast?.(`Spectral Tilt aplicado (${tilt.toFixed(1)} dB @ ${pivot} Hz).`, 'success', 3500);
      } catch (err) {
        if (status) status.textContent = `❌ Error: Spectral Tilt falló`;
        LGMDM?.errors?.safeToast?.('Spectral Tilt', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderMultibandTransientTab(container: HTMLElement) {
    container.innerHTML = _proPanelShell(
      'multiband-transient',
      '🥁 Multiband Transient Designer (Low / Mid / High)',
      'Esculpe transitorios por banda con Attack/Release y Amount global. Sin backend — DSP local.',
      ''
    );
  }

  function renderMsImagerTab(container: HTMLElement) {
    container.innerHTML = _proPanelShell(
      'ms-imager',
      '📐 Imager M/S (Correlación Mid/Side)',
      'Visualiza el ancho estéreo y la correlación M/S sobre el audio en reproducción.',
      ''
    );
  }

  function renderReferenceMatchTab(container: HTMLElement) {
    const leftExtra = `
      <div class="pro-section-gap-tight pro-mt-14">
        <label class="pro-label-muted">Pista de Referencia Comercial:</label>
        <input type="file" id="matchRefFile" accept="audio/*" class="pro-file-input">
      </div>
      <div class="pro-control-row pro-mt-14">
        <label>Intensidad del Match:</label>
        <input type="range" min="10" max="100" value="65" id="matchAmount">
        <output id="matchAmountVal">65%</output>
      </div>
      <p class="pro-caption-muted-tight">
        Valores entre 50% y 75% ofrecen una adopción tonal natural sin forzar artefactos de fase.
      </p>
      <div class="pro-mt-14">
        <button class="pro-primary pro-full-width" id="btnRunMatchEq" type="button">🧬 Clonar Curva Tonal de Referencia</button>
      </div>
      <div id="matchEqStatus" class="pro-status"></div>
      <div id="matchEqOutputArea" class="pro-output-area pro-meter-card" style="display:none;margin-top:1rem;">
        <strong class="pro-card-title-accent">✓ Master con Curva de Referencia Listo</strong>
        <div class="pro-output-row">
          <audio id="matchEqAudioPlayer" controls class="pro-audio-player"></audio>
          <a id="matchEqDownloadBtn" class="pro-action-btn pro-download-link" download="matched_master.wav">📥 Descargar WAV</a>
        </div>
      </div>
    `;

    container.innerHTML = _proPanelShell(
      'reference-match',
      '🎚 Reference Match / Match EQ (FIR Fase Lineal)',
      'Compara el espectro de tu mezcla con una pista comercial y clona el balance espectral mediante FIR multirresolución.',
      leftExtra
    );

    $input('matchAmount')?.addEventListener('input', (e: Event) => {
      const o = el('matchAmountVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value}%`;
    });

    el('matchRefFile')?.addEventListener('change', () => {
      const tgtFile = getActiveOrPickedFile('referenceMatchFile') || getSelectedFile();
      const refPicker = $input('matchRefFile');
      const refFile = refPicker && refPicker.files && refPicker.files[0] ? refPicker.files[0] : null;
      if (!tgtFile || !refFile) return;
      const RefWidgetCls = LGMDM?.proFeatures?.referenceMatchWidget;
      if (typeof RefWidgetCls?.fetchMatch !== 'function') return;
      const matchAmt = Number($input('matchAmount')?.value || 65) / 100;
      RefWidgetCls.fetchMatch(tgtFile, refFile, { match_amount: matchAmt })
        .then((result: unknown) => {
          const bands = (result as { applied_eq_bands?: unknown[] } | null | undefined)?.applied_eq_bands;
          if (!Array.isArray(bands)) return;
          const vizInst = _proInstances.get('reference-match');
          if (vizInst && typeof vizInst.update === 'function') {
            vizInst.update({ applied_eq_bands: bands });
          }
        })
        .catch((err: unknown) => {
          if (typeof console !== 'undefined') console.debug('[reference-match fetchMatch]', err);
        });
    });

    el('btnRunMatchEq')?.addEventListener('click', async () => {
      const tgtFile = getActiveOrPickedFile('referenceMatchFile') || getSelectedFile();
      const refPicker = $input('matchRefFile');
      const refFile = refPicker && refPicker.files && refPicker.files[0] ? refPicker.files[0] : null;

      if (!tgtFile || !refFile) {
        LGMDM.ui?.showToast?.('Por favor selecciona tanto la pista objetivo como la pista de referencia comercial.', 'warning', 4500);
        return;
      }

      const status = el('matchEqStatus');
      const btn = $button('btnRunMatchEq');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Computando análisis multirresolución y aplicando filtro FIR en backend…';
        const fd = new FormData();
        fd.append('target_file', tgtFile);
        fd.append('reference_file', refFile);
        fd.append('match_amount', (Number($input('matchAmount')?.value || 65) / 100).toFixed(2));

        const res = await apiPostDsp('/dsp/match-eq', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('matchEqAudioPlayer') as HTMLAudioElement | null;
        const dl = el('matchEqDownloadBtn') as HTMLAnchorElement | null;
        const outArea = el('matchEqOutputArea');
        if (player) player.src = url;
        if (dl) dl.href = url;
        if (outArea) outArea.style.display = 'block';
        const metrics = readDspMetrics(res);
        const metricsLine = formatDspMetrics(metrics);
        if (status) status.textContent = metricsLine
          ? `✓ Curva espectral igualada. ${metricsLine}`
          : '✓ Curva espectral igualada con éxito.';
      } catch (err) {
        if (status) status.textContent = `❌ Error: ${(err as Error).message}`;
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    setupProFeatures('reference-match');
  }

  function renderDrMeterTab(container: HTMLElement) {
    const left = `
      <div class="pro-mt-14">
        <p class="pro-caption-muted-tight">
          El endpoint <code>/dsp/dr-meter</code> mide DR score (basado en LRA), crest factor por banda y clasifica el género.
        </p>
        <button class="pro-primary pro-full-width" id="btnRunDr" type="button">📊 Medir Dynamic Range</button>
      </div>
    `;
    container.innerHTML = _proPanelShell(
      'dr-meter',
      '📊 DR Meter (Dynamic Range + Genre Classifier)',
      'Medición profesional de rango dinámico con clasificación de género heurística.',
      left
    );

    el('btnRunDr')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('drMeterFile');
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá un archivo de audio para medir el DR.', 'warning', 4000);
        return;
      }
      const status = el('drMeterStatus');
      const btn = $button('btnRunDr');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Midiendo LRA + crest factors en backend…';
        const fd = new FormData();
        fd.append('file', file);
        const res = await apiPostDsp('/dsp/dr-meter', fd);
        const json = await res.json();
        const inst = _proInstances.get('dr-meter');
        if (inst && typeof inst.update === 'function') {
          inst.update({
            dr_score: Number(json.dr_score),
            lra: Number(json.lra),
            crest_factor: Number(json.crest_factor),
            genre_classification: String(json.genre_classification || 'Pop / Rock')
          });
        }
        if (status) status.textContent = `✓ DR-${Number(json.dr_score).toFixed(1)} · LRA ${Number(json.lra).toFixed(1)} LU · ${json.genre_classification}`;
        LGMDM.ui?.showToast?.(`DR Meter: DR-${Number(json.dr_score).toFixed(1)} · ${json.genre_classification}.`, 'success', 3500);
      } catch (err) {
        if (status) status.textContent = `❌ Error: DR Meter falló`;
        LGMDM?.errors?.safeToast?.('DR Meter', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderSaturationTab(container: HTMLElement) {
    const leftExtra = `
      <div class="pro-control-row pro-mt-14">
        <label>Tipo de Curva:</label>
        <select id="warmerCurve" class="pro-select-dark">
          <option value="chebyshev" selected>📼 Cinta Analógica 30 IPS (Chebyshev / Armónicos impares)</option>
          <option value="tanh">📻 Válvula Triodo Clase A (Soft Tanh / Calidez redonda)</option>
          <option value="sigmoid">✨ Inflator Transparente (Sigmoidal / Máxima densidad)</option>
        </select>
      </div>
      <div class="pro-control-row pro-mt-14">
        <label>Drive (Intensidad):</label>
        <input type="range" min="0" max="100" value="65" id="warmerDrive">
        <output id="warmerDriveVal">65%</output>
      </div>
      <div class="pro-control-row pro-mt-14">
        <label>Mezcla Wet/Dry:</label>
        <input type="range" min="0" max="100" value="100" id="warmerMix">
        <output id="warmerMixVal">100%</output>
      </div>
      <div class="pro-mt-14">
        <button class="pro-primary pro-full-width" id="btnRunWarmer">🔥 Aplicar Calidez Analógica</button>
      </div>
      <div id="warmerStatus" class="pro-status"></div>
      <div id="warmerOutputArea" class="pro-output-area pro-meter-card" style="display:none;margin-top:1rem;">
        <strong class="pro-card-title-accent">✓ Audio con Calidez Analógica Listo</strong>
        <div class="pro-output-row">
          <audio id="warmerAudioPlayer" controls class="pro-audio-player"></audio>
          <a id="warmerDownloadBtn" class="pro-action-btn pro-download-link" download="warmed_master.wav">📥 Descargar WAV</a>
        </div>
      </div>
    `;

    container.innerHTML = _proPanelShell(
      'saturation',
      '🔥 Saturación Armónica & Vintage Warmer',
      'Incrementa la densidad armónica con emulaciones analógicas y visualiza los armónicos generados.',
      leftExtra
    );

    $input('warmerDrive')?.addEventListener('input', (e: Event) => {
      const o = el('warmerDriveVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value}%`;
      const inst = _proInstances.get('saturation');
      if (inst && typeof inst.update === 'function') {
        inst.update({ drive: Number((e.target as HTMLInputElement).value) / 100 });
      }
    });

    $input('warmerMix')?.addEventListener('input', (e: Event) => {
      const o = el('warmerMixVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value}%`;
    });

    $select('warmerCurve')?.addEventListener('change', (e: Event) => {
      const inst = _proInstances.get('saturation');
      if (inst && typeof inst.update === 'function') {
        inst.update({ curve: (e.target as HTMLSelectElement).value });
      }
    });

    el('btnRunWarmer')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('saturationFile') || getSelectedFile();
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá o seleccioná un archivo de audio primero.', 'warning', 4000);
        return;
      }
      const status = el('warmerStatus');
      const btn = $button('btnRunWarmer');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Modelando no linealidades de circuito…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('drive', (Number($input('warmerDrive')?.value || 65) / 100).toFixed(2));
        fd.append('mix', (Number($input('warmerMix')?.value || 100) / 100).toFixed(2));
        fd.append('curve', $select('warmerCurve')?.value || 'chebyshev');

        const res = await apiPostDsp('/dsp/inflator', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const player = el('warmerAudioPlayer') as HTMLAudioElement | null;
        const dl = el('warmerDownloadBtn') as HTMLAnchorElement | null;
        const outArea = el('warmerOutputArea');
        if (player) player.src = url;
        if (dl) dl.href = url;
        if (outArea) outArea.style.display = 'block';
        const metrics = readDspMetrics(res);
        const metricsLine = formatDspMetrics(metrics);
        if (status) status.textContent = metricsLine
          ? `✓ Saturación analógica completada. ${metricsLine}`
          : '✓ Saturación analógica completada con éxito.';
      } catch (err) {
        if (status) status.textContent = `❌ Error: ${(err as Error).message}`;
      } finally {
        if (btn) btn.disabled = false;
      }
    });

    setupProFeatures('saturation');
  }

  function renderPhaseRotationTab(container: HTMLElement) {
    const left = `
      <div class="pro-mt-14">
        <div class="pro-control-row">
          <label>Frecuencia central (Hz):</label>
          <input type="range" min="40" max="16000" step="10" value="1000" id="phaseFreq">
          <output id="phaseFreqVal">1000 Hz</output>
        </div>
        <div class="pro-control-row">
          <label>Rotación (°):</label>
          <input type="range" min="-180" max="180" step="5" value="0" id="phaseAngle">
          <output id="phaseAngleVal">0°</output>
        </div>
        <div class="pro-control-row">
          <label>Q:</label>
          <input type="range" min="0.1" max="10" step="0.1" value="1.0" id="phaseQ">
          <output id="phaseQVal">1.0</output>
        </div>
        <button class="pro-primary pro-full-width" id="btnRunPhase" type="button">🔄 Aplicar Phase Rotation</button>
      </div>
    `;
    container.innerHTML = _proPanelShell(
      'phase-rotation',
      '🔄 Phase Rotation por Banda (All-Pass Variable)',
      'Rota la fase de una banda centrada en freq_hz entre -180° y +180° sin afectar la magnitud.',
      left
    );

    $input('phaseFreq')?.addEventListener('input', (e: Event) => { const o = el('phaseFreqVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value} Hz`; });
    $input('phaseAngle')?.addEventListener('input', (e: Event) => { const o = el('phaseAngleVal'); if (o) o.textContent = `${(e.target as HTMLInputElement).value}°`; });
    $input('phaseQ')?.addEventListener('input', (e: Event) => { const o = el('phaseQVal'); if (o) o.textContent = Number((e.target as HTMLInputElement).value).toFixed(1); });

    el('btnRunPhase')?.addEventListener('click', async () => {
      const file = getActiveOrPickedFile('phaseRotationFile');
      if (!file) {
        LGMDM.ui?.showToast?.('Cargá un archivo de audio para aplicar Phase Rotation.', 'warning', 4000);
        return;
      }
      const freq = Number($input('phaseFreq')?.value || 1000);
      const angle = Number($input('phaseAngle')?.value || 0);
      const q = Number($input('phaseQ')?.value || 1.0);
      const status = el('phaseRotationStatus');
      const btn = $button('btnRunPhase');
      try {
        if (btn) btn.disabled = true;
        if (status) status.textContent = '⏳ Aplicando all-pass de 2º orden en backend…';
        const fd = new FormData();
        fd.append('file', file);
        fd.append('freq_hz', String(freq));
        fd.append('angle_deg', String(angle));
        fd.append('q', String(q));
        const res = await apiPostDsp('/dsp/phase-rotation', fd);
        const blob = await res.blob();
        const url = _trackObjectUrl(URL.createObjectURL(blob));
        const a = document.createElement('a');
        a.href = url; a.download = `phase_rotated_${file.name || 'master'}.wav`; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        const inst = _proInstances.get('phase-rotation');
        if (inst && typeof inst.update === 'function') {
          inst.update({
            bands: [
              { name: 'custom', freq_hz: freq, angle_deg: angle, q: q }
            ]
          });
        }
        if (status) status.textContent = `✓ Rotación ${angle}° @ ${freq} Hz (Q=${q}) aplicada.`;
        LGMDM.ui?.showToast?.(`Phase Rotation aplicada (${angle}° @ ${freq} Hz).`, 'success', 3500);
      } catch (err) {
        if (status) status.textContent = `❌ Error: Phase Rotation falló`;
        LGMDM?.errors?.safeToast?.('Phase Rotation', err);
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  function renderReverbTab(container: HTMLElement) {
    container.innerHTML = _proPanelShell(
      'reverb',
      '🌫 Automatic Reverb Designer (Hall / Plate / Room / Chamber)',
      '4 knobs (Room Size, Pre-delay, Decay, Wet) + tipo de reverb + mini-espectro.',
      ''
    );
  }

  function renderLoudnessWarTab(container: HTMLElement) {
    container.innerHTML = _proPanelShell(
      'loudness-war',
      '📉 Loudness War Detector (Timeline DR)',
      'Visualización del timeline de Dynamic Range con veredictos por zonas (verde/amarillo/rojo).',
      ''
    );
  }

  function renderIsoCompensationTab(container: HTMLElement) {
    container.innerHTML = _proPanelShell(
      'iso-compensation',
      '🔉 ISO 226 — Compensación de Curvas Isosónicas',
      'Aplica la corrección tonal ISO 226 según el nivel de playback (phon) para que la mezcla se perciba uniforme en distintos volúmenes.',
      `
        <div class="pro-mt-14">
          <div class="pro-control-row">
            <label>Playback level:</label>
            <select id="isoPlaybackPhon" class="pro-select-dark">
              <option value="40">40 phon (silencio)</option>
              <option value="60" selected>60 phon (oficina)</option>
              <option value="80">80 phon (referencia)</option>
              <option value="100">100 phon (fuerte)</option>
            </select>
          </div>
          <div class="pro-control-row">
            <label>Reference level:</label>
            <select id="isoReferencePhon" class="pro-select-dark">
              <option value="40">40 phon</option>
              <option value="60">60 phon</option>
              <option value="80" selected>80 phon (mix)</option>
              <option value="100">100 phon</option>
            </select>
          </div>
          <div class="pro-control-row">
            <label>Strength:</label>
            <input type="range" min="0" max="100" value="50" id="isoStrength">
            <output id="isoStrengthVal">50%</output>
          </div>
        </div>
        <div class="pro-section-gap-tight">
          <button class="pro-action-btn-center" id="isoRunBtn">🎚 Aplicar compensación</button>
        </div>
      `
    );
    const strength = $input('isoStrength');
    const strengthVal = el('isoStrengthVal');
    if (strength && strengthVal) {
      strength.addEventListener('input', () => { strengthVal.textContent = `${strength.value}%`; });
    }
    const runBtn = $button('isoRunBtn');
    if (runBtn) {
      runBtn.addEventListener('click', async () => {
        runBtn.disabled = true;
        runBtn.textContent = '⏳ Procesando…';
        try {
          const f = getSelectedFile();
          if (!f) {
            if (typeof LGMDM.ui.showToast === 'function') {
              LGMDM.ui.showToast('Cargá un archivo antes de aplicar ISO 226', 'warning', 4000);
            }
            return;
          }
          const fd = new FormData();
          fd.append('file', f, f.name);
          fd.append('playback_phon', $select('isoPlaybackPhon')?.value || '60');
          fd.append('reference_phon', $select('isoReferencePhon')?.value || '80');
          fd.append('strength', (Number($input('isoStrength')?.value || 50) / 100).toFixed(3));
          await (await apiPostDsp('/dsp/iso-compensation', fd)).json();
          if (typeof LGMDM.ui.showToast === 'function') LGMDM.ui.showToast('✅ ISO 226 aplicado', 'success');
        } catch (err) {
          if (typeof LGMDM.ui.showToast === 'function') LGMDM.ui.showToast(`❌ ${(err as Error).message}`, 'error');
        } finally {
          runBtn.disabled = false;
          runBtn.textContent = '🎚 Aplicar compensación';
        }
      });
    }
  }

  // Helper compartido para los módulos que exponen comparación antes/después
  // (Codec, Tamer, Warmer, MatchEq, PhantomSub y placeholder de Compliance).
  // Patrón:
  //   - El <audio controls> existente sigue siendo el ÚNICO player visible.
  //   - Dos botones (Original / Procesado) swappean su `src`.
  //   - Se preserva currentTime al alternar para que la comparación sea continua.
  //   - El botón activo refleja qué audio está cargado en el player.
  //   - Llamar setupABCompare() después de poblar el `processedUrl` y el `originalFile`.
  function setupABCompare(prefix: any, originalFile: any, processedUrl: any) {
    if (!prefix) return;
    const player = el(`${prefix}AudioPlayer`) as HTMLAudioElement | null;
    if (!player) return;

    const origBtn = el(`${prefix}PlayOrig`);
    const procBtn = el(`${prefix}PlayProc`);
    if (!origBtn || !procBtn) return;

    const abArea = el(`${prefix}ABCompare`) as (HTMLElement & { _origUrl?: string | null }) | null;
    // Revoke previous object URL de una llamada anterior a setupABCompare para
    // evitar leaks al regenerar la comparación A/B sobre el mismo bloque.
    if (abArea && abArea._origUrl) {
      try { URL.revokeObjectURL(abArea._origUrl); } catch (_) {}
      abArea._origUrl = null;
    }

    let origUrl: string | null = null;
    try {
      if (originalFile instanceof Blob) origUrl = _trackObjectUrl(URL.createObjectURL(originalFile));
    } catch (_) {}

    const setActive = (slot: any) => {
      if (slot === 'orig') {
        origBtn.classList.add('active');
        procBtn.classList.remove('active');
      } else {
        procBtn.classList.add('active');
        origBtn.classList.remove('active');
      }
    };

    const switchTo = (slot: any) => {
      const targetUrl = slot === 'orig' ? origUrl : processedUrl;
      if (!targetUrl) return;
      const wasPlaying = !player.paused;
      const savedTime = player.currentTime || 0;
      try {
        player.src = targetUrl;
        player.load();
        const onReady = () => {
          player.removeEventListener('loadedmetadata', onReady);
          try {
            if (Number.isFinite(savedTime) && savedTime > 0 && savedTime < (player.duration || Infinity)) {
              player.currentTime = savedTime;
            }
          } catch (_) {}
          if (wasPlaying) {
            const p = player.play();
            if (p && typeof p.catch === 'function') p.catch(() => {});
          }
        };
        player.addEventListener('loadedmetadata', onReady);
      } catch (_) {}
      setActive(slot);
    };

    // Estado inicial: Procesado (es lo que el usuario acaba de generar)
    if (processedUrl) {
      try {
        player.src = processedUrl;
        player.load();
      } catch (_) {}
      setActive('proc');
    }

    origBtn.addEventListener('click', () => switchTo('orig'));
    procBtn.addEventListener('click', () => switchTo('proc'));

    // Cleanup defensivo: si el bloque se reemplaza, libera el object URL.
    if (abArea) {
      abArea._origUrl = origUrl;
    }
  }

  let _initDone = false;
  let _analysisUpdatedHandler: (() => void) | null = null;
  function init() {
    if (_initDone) return;
    _initDone = true;
    loadDemaskSettings();
    ensureModal();

    // Re-render when analysis completes in the background
    if (typeof window.addEventListener === 'function') {
      _analysisUpdatedHandler = () => {
        const modal = el('premiumSuiteModal');
        if (modal && modal.classList.contains('is-open')) {
          renderActiveTab();
        }
      };
      window.addEventListener('analysis-updated', _analysisUpdatedHandler);
    }

    let btn: HTMLButtonElement | null = $button('btnOpenPremiumSuite');
    if (!btn) {
      const headerRight = document.querySelector('.header-right') || document.querySelector('.lg-console-actions');
      if (headerRight) {
        btn = document.createElement('button');
        btn.id = 'btnOpenPremiumSuite';
        btn.type = 'button';
        btn.className = 'header-btn';
        btn.style.cssText = 'width: auto; padding: 0 10px; font-weight: 800; font-size: 10px; color: var(--ui-accent, #52f2bd); display: flex; align-items: center; gap: 5px; cursor: pointer;';
        btn.innerHTML = '<svg class="header-btn-svg" viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 2.5L2 6l6 7.5 6-7.5-2-3.5H4z"/><path d="M2 6h12"/><path d="M5.5 2.5L7 6l1 7.5 1-7.5 1.5-3.5"/></svg><span>SUITE PRO</span>';
        btn.title = 'Suite de Funciones Premium (23 herramientas avanzadas)';
        headerRight.prepend(btn);
      }
    }
    if (btn && !btn.dataset.premiumWired) {
      btn.dataset.premiumWired = 'true';
      btn.addEventListener('click', () => open());
    }
  }

  LG.premium = {
    open,
    close,
    state,
    PLATFORMS,
    applyClean300: () => {
      const eq2Freq = $input('s-eq2freq');
      if (eq2Freq) {
        eq2Freq.value = '300';
        eq2Freq.dispatchEvent(new Event('input', { bubbles: true }));
        eq2Freq.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const eq2Gain = $input('s-eq2gain');
      if (eq2Gain) {
        eq2Gain.value = '-1.2';
        eq2Gain.dispatchEvent(new Event('input', { bubbles: true }));
        eq2Gain.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const dynFreq = $input('s-dyneq-freq');
      if (dynFreq && !eq2Freq) {
        dynFreq.value = '300';
        dynFreq.dispatchEvent(new Event('input', { bubbles: true }));
        dynFreq.dispatchEvent(new Event('change', { bubbles: true }));
      }
    },
    toggleMonoSafe: () => {
      state.stereo.monoSafeActive = !state.stereo.monoSafeActive;
      const monoFreq = $input('s-mono-freq');
      if (monoFreq && state.stereo.monoSafeActive) {
        monoFreq.value = '90';
        monoFreq.dispatchEvent(new Event('input', { bubbles: true }));
        monoFreq.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const monoAmount = $input('s-mono-amount');
      if (monoAmount) {
        monoAmount.value = state.stereo.monoSafeActive ? '1.0' : '0';
        monoAmount.dispatchEvent(new Event('input', { bubbles: true }));
        monoAmount.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (state.activeTab === 'stereo') renderActiveTab();
    },
    resetAbx: () => {
      state.abx.score = 0;
      state.abx.trials = 0;
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      state.abx.currentPlaying = null;
      state.abx.lastFeedback = '';
      if (state.activeTab === 'abx') renderActiveTab();
    },
    newAbxTrial: () => {
      state.abx.hiddenX = Math.random() > 0.5 ? 'A' : 'B';
      state.abx.currentPlaying = null;
      if (state.activeTab === 'abx') renderActiveTab();
    }
  };

  // Boot — the original init() already has an `_initDone` idempotency guard.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }

  // F5.16 — Expose the 4 tab renderers on window so the external stubs
  // (40/41/42/43-tab-*.js, ported to features/tabs/) can delegate.
  global._lgmdmRenderComplianceTab = renderComplianceTab as TabRenderer;
  global._lgmdmRenderAbxTab = renderAbxTab;
  global._lgmdmRenderCodecTab = renderCodecTab;
  global._lgmdmRenderWaterfallTab = renderWaterfallTab;

  window.addEventListener('beforeunload', () => {
    try { teardownProFeatures(); } catch (e) { /* ignore */ }
  }, { once: true });

// ── FIX G10: Exponer visualizerRender.drawWaterfallFrame ─────────────────
// master-console.ts:256 lo lee (`window.LGMDM?.visualizerRender?.drawWaterfallFrame`)
// como renderer compartido del waterfall. Antes era opcional (con fallback inline);
// ahora se expone para que master-console pueda usar la versión del premium-suite.
const wLGMDM = (window.LGMDM = window.LGMDM || {}) as Record<string, any>;
const existingVizRender = (wLGMDM.visualizerRender as Record<string, any> | undefined) || {};
existingVizRender.drawWaterfallFrame = drawWaterfallFrame;
wLGMDM.visualizerRender = existingVizRender;

})(window);

// Public surface (typed) — consumed by features/tabs/ wrappers.
export type TabRenderer = (container: HTMLElement, metrics?: unknown) => void;

declare global {
  interface Window {
    _lgmdmRenderComplianceTab?: TabRenderer;
    _lgmdmRenderAbxTab?: TabRenderer;
    _lgmdmRenderCodecTab?: TabRenderer;
    _lgmdmRenderWaterfallTab?: TabRenderer;
  }
}

// ── FIX G10: Exponer visualizerRender.drawWaterfallFrame ─────────────────
// Movido DENTRO del IIFE (arriba) — antes estaba fuera, lo que causaba
// ReferenceError: drawWaterfallFrame is not defined en module-eval time
// (línea 3425). El build pasaba solo porque @ts-nocheck suprimía el TS2304.
// Ver auditoría 26-sep-2026, bug C-crítico.
