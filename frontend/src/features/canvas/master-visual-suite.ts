// master-visual-suite.ts — 20 visual enhancements
// Pragma de supresión TS REMOVIDO 2026-09-27 (FIX FINAL): tipar los 156 errores TS restantes.

import { audioTap } from '../../core/audio-tap';
import { metricsStore } from '../../core/metrics-store';

type AnyEl = HTMLElement | null;

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

// FIX FINAL 2026-09-27: helpers para castear elementos a su tipo correcto.
// El $() original retorna HTMLElement|null, pero muchos elementos son
// HTMLCanvasElement (width/height/getContext), HTMLInputElement (value/checked),
// HTMLSelectElement (value) o HTMLButtonElement (click). Sin estos casts,
// tsc reporta TS2339 "Property X does not exist on type HTMLElement/Element".
function $canvas(id: string): HTMLCanvasElement | null {
  return document.getElementById(id) as HTMLCanvasElement | null;
}
function $input(id: string): HTMLInputElement | null {
  return document.getElementById(id) as HTMLInputElement | null;
}
function $select(id: string): HTMLSelectElement | null {
  return document.getElementById(id) as HTMLSelectElement | null;
}
function $button(id: string): HTMLButtonElement | null {
  return document.getElementById(id) as HTMLButtonElement | null;
}

// Bridge to the (loosely-typed) LGMDM global namespace.
function lgmdm(): Record<string, any> {
  return (window as unknown as { LGMDM?: Record<string, any> }).LGMDM || {};
}

  const CHASSIS_THEMES = ["slate", "neve", "ssl", "obsidian"];
  const CHASSIS_STORAGE_KEY = "lgmdm_chassis_theme";

  function initChassisTheme(signal: AbortSignal) {
    let saved = "slate";
    try {
      saved = localStorage.getItem(CHASSIS_STORAGE_KEY) || "slate";
    } catch (_) {}
    if (!CHASSIS_THEMES.includes(saved)) saved = "slate";
    applyChassisTheme(saved);

    const container = $("consoleChassisSelector");
    if (!container) return;
    container.addEventListener("click", (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest(".chassis-btn");
      if (!btn) return;
      const theme = (btn as HTMLElement).dataset.chassis;
      if (theme && CHASSIS_THEMES.includes(theme)) {
        applyChassisTheme(theme);
      }
    }, { signal });
  }

  function applyChassisTheme(theme: string) {
    document.documentElement.setAttribute("data-chassis-theme", theme);
    const consoleEl = $("lgMasterConsole");
    if (consoleEl) consoleEl.setAttribute("data-chassis-theme", theme);

    try {
      localStorage.setItem(CHASSIS_STORAGE_KEY, theme);
    } catch (_) {}

    document.querySelectorAll<HTMLElement>(".chassis-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.chassis === theme);
    });
  }

  const CRT_STORAGE_KEY = "lgmdm_crt_mode";

  function initCrtToggle(signal: AbortSignal) {
    const toggleBtnEl = $("consoleCrtToggle");
    const consoleEl = $("lgMasterConsole");
    if (!toggleBtnEl || !consoleEl) return;
    // FIX FINAL 2026-09-27: TS no estrecha tipos dentro de closures (updateCrt).
    // Re-asignamos a const no-null para que el closure las capture con tipo no-null.
    const toggleBtn: HTMLElement = toggleBtnEl;
    const consoleEl2: HTMLElement = consoleEl;

    let crtActive = true;
    try {
      const saved = localStorage.getItem(CRT_STORAGE_KEY);
      if (saved !== null) crtActive = saved === "true";
    } catch (_) {}

    function updateCrt(state: boolean) {
      crtActive = state;
      consoleEl2.classList.toggle("crt-enabled", crtActive);
      toggleBtn.classList.toggle("active", crtActive);
      const dot = toggleBtn.querySelector?.(".crt-led-dot");
      if (dot) dot.classList?.toggle?.("active", crtActive);
      try {
        localStorage.setItem(CRT_STORAGE_KEY, String(crtActive));
      } catch (_) {}
    }

    updateCrt(crtActive);
    toggleBtn.addEventListener("click", () => updateCrt(!crtActive), { signal });
  }

  let activeMeterView = "vu"; // 'vu' | 'bars' | 'gonio' | 'sphere'

  function initMeterSwitcher(signal: AbortSignal) {
    const rack = $("consoleMeterRack");
    if (!rack) return;

    const btns = rack.querySelectorAll<HTMLElement>(".meter-view-btn");
    const modeLabel = $("consoleMeterMode");

    function setView(view: string) {
      activeMeterView = view;
      btns.forEach((b: HTMLElement) => b.classList.toggle("active", b.dataset.view === view));

      const viewBars = $("meterViewBars");
      const viewVu = $("meterViewVu");
      const viewGonio = $("meterViewGonio");
      const viewSphere = $("meterViewSphere");

      if (viewBars) viewBars.style.display = view === "bars" ? "flex" : "none";
      if (viewVu) viewVu.style.display = view === "vu" ? "flex" : "none";
      if (viewGonio) viewGonio.style.display = view === "gonio" ? "flex" : "none";
      if (viewSphere) viewSphere.style.display = view === "sphere" ? "flex" : "none";

      if (modeLabel) {
        modeLabel.textContent =
          view === "bars"
            ? "DIGITAL BARS"
            : view === "vu"
            ? "ANALOG VU"
            : view === "gonio"
            ? "GONIOMETER 360°"
            : "VECTORSPHERE 3D";
      }
    }

    btns.forEach((b: HTMLElement) => {
      b.addEventListener("click", () => setView(b.dataset.view || ""), { signal });
    });

    setView("vu");
  }

  // ANSI C16.5 Galvanometer Physics: 300ms rise time with damped mechanical inertia
  const needlePhysics = {
    left: { angle: -45, velocity: 0, target: -45 },
    right: { angle: -45, velocity: 0, target: -45 },
  };

  function dbToVuAngle(db: number): number {
    if (!Number.isFinite(db) || db <= -45) return -45;
    if (db >= 3) return 25;
    if (db <= -20) {
      const norm = (db + 45) / 25;
      return -45 + norm * 15;
    }
    if (db <= 0) {
      const norm = (db + 20) / 20;
      return -30 + norm * 30;
    }
    const norm = db / 3;
    return norm * 25;
  }

// FIX FINAL 2026-09-27: tipo de metrics que pasa el backend (routers/info.py /analysis)
// y metricsStore. Es un subset — los campos opcionales porque no todos los endpoints los devuelven.
interface MetricsShape {
  peak_db?: number | null;
  rms_db?: number | null;
  true_peak_dbtp?: number | null;
  stereo_correlation?: number | null;
  lufs_short?: number | null;
  lufs_integrated?: number | null;
  lufs_range?: number | null;
  crest_factor_db?: number | null;
  thd_pct?: number | null;
  [key: string]: unknown;
}

  function updateVuNeedles(metrics: MetricsShape | null | undefined) {
    const needleL = $("vuNeedleL");
    const needleR = $("vuNeedleR");
    if (!needleL || !needleR) return;

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const rms = Number(m.rms_db ?? -60);
    const corr = Math.max(-1, Math.min(1, Number(m.stereo_correlation ?? 1)));
    const spread = (1 - Math.max(0, corr)) * 3;

    const vuL_db = Math.max(-60, rms * 0.7 + peak * 0.3 + spread);
    const vuR_db = Math.max(-60, rms * 0.7 + peak * 0.3 - spread);

    needlePhysics.left.target = dbToVuAngle(vuL_db);
    needlePhysics.right.target = dbToVuAngle(vuR_db);
  }

  function stepVuBallistics() {
    const spring = 0.16;
    const damping = 0.68;

    (["left", "right"] as const).forEach((ch: 'left' | 'right') => {
      const p = needlePhysics[ch];
      const force = (p.target - p.angle) * spring;
      p.velocity = (p.velocity + force) * damping;
      p.angle += p.velocity;
      p.angle = Math.max(-48, Math.min(28, p.angle));
    });

    const needleL = $("vuNeedleL");
    const needleR = $("vuNeedleR");
    const shadowL = $("vuNeedleShadowL");
    const shadowR = $("vuNeedleShadowR");

    if (needleL) needleL.style.transform = `rotate(${needlePhysics.left.angle.toFixed(2)}deg)`;
    if (needleR) needleR.style.transform = `rotate(${needlePhysics.right.angle.toFixed(2)}deg)`;
    if (shadowL) shadowL.style.transform = `rotate(${needlePhysics.left.angle.toFixed(2)}deg)`;
    if (shadowR) shadowR.style.transform = `rotate(${needlePhysics.right.angle.toFixed(2)}deg)`;
  }

  let gonioPhaseAngle = 0;

  function drawGoniometer(metrics: MetricsShape | null | undefined) {
    if (activeMeterView !== "gonio") return;
    const canvas = $canvas("lgmdmGoniometerCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 220;
    const w = size * dpr;
    const h = size * dpr;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.fillStyle = "rgba(7, 11, 20, 0.28)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const r = Math.min(cx, cy) - 14 * dpr;

    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75, 1.0].forEach((ratio: number, idx: number) => {
      ctx.strokeStyle = idx === 3 ? "rgba(0, 229, 255, 0.35)" : "rgba(0, 229, 255, 0.12)";
      ctx.beginPath();
      ctx.arc(cx, cy, r * ratio, 0, Math.PI * 2);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(0, 229, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx, cy + r);
    ctx.moveTo(cx - r, cy);
    ctx.lineTo(cx + r, cy);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 202, 101, 0.18)";
    ctx.setLineDash([3 * dpr, 3 * dpr]);
    const diag = r * 0.7071;
    ctx.beginPath();
    ctx.moveTo(cx - diag, cy + diag);
    ctx.lineTo(cx + diag, cy - diag);
    ctx.moveTo(cx - diag, cy - diag);
    ctx.lineTo(cx + diag, cy + diag);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.font = `${Math.round(8 * dpr)}px monospace`;
    ctx.fillStyle = "rgba(0, 229, 255, 0.65)";
    ctx.textAlign = "center";
    ctx.fillText("+M", cx, cy - r + 11 * dpr);
    ctx.fillText("-M", cx, cy + r - 4 * dpr);
    ctx.fillText("+S", cx + r - 8 * dpr, cy + 3 * dpr);
    ctx.fillText("-S", cx - r + 8 * dpr, cy + 3 * dpr);
    ctx.fillStyle = "rgba(255, 202, 101, 0.65)";
    ctx.fillText("L", cx - diag + 6 * dpr, cy - diag + 10 * dpr);
    ctx.fillText("R", cx + diag - 6 * dpr, cy - diag + 10 * dpr);

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const rms = Number(m.rms_db ?? -60);
    const corr = Math.max(-1, Math.min(1, Number(m.stereo_correlation ?? 0.95)));

    const badge = $("gonioPhaseBadge");
    if (badge) {
      const corrVal = corr.toFixed(2);
      badge.textContent = `${corr >= 0 ? "+" : ""}${corrVal} ${corr > 0.4 ? "OK" : corr > 0 ? "WIDE" : "PHASE!"}`;
      badge.className = `gonio-phase-badge ${corr < 0 ? "phase-danger" : corr < 0.3 ? "phase-wide" : "phase-ok"}`;
    }

    const isActive = peak > -55 || rms > -55;
    gonioPhaseAngle += 0.05;

    ctx.beginPath();
    if (!isActive) {
      const idleR = r * 0.28 + Math.sin(gonioPhaseAngle * 1.5) * (3 * dpr);
      ctx.strokeStyle = "rgba(0, 229, 255, 0.45)";
      ctx.arc(cx, cy, idleR, 0, Math.PI * 2);
      ctx.stroke();
      return;
    }

    const amp = Math.max(0.1, (peak + 60) / 60);
    const widthFactor = (1 - corr) * 0.7;
    const midFactor = (1 + corr) * 0.5;
    const numPoints = 140;

    ctx.strokeStyle = corr < 0 ? "rgba(255, 68, 68, 0.85)" : "rgba(0, 240, 255, 0.85)";
    ctx.lineWidth = Math.max(1, 1.4 * dpr);

    for (let i = 0; i < numPoints; i++) {
      const t = (i / numPoints) * Math.PI * 2;
      const noise1 = Math.sin(t * 7 + gonioPhaseAngle * 2.2);
      const noise2 = Math.cos(t * 11 - gonioPhaseAngle * 1.8);
      const l = Math.sin(t * 3 + gonioPhaseAngle) * 0.6 + noise1 * 0.4;
      const r_sample = Math.sin(t * 3 + gonioPhaseAngle + (1 - corr) * Math.PI * 0.5) * 0.6 + noise2 * 0.4;

      const side = (r_sample - l) * r * amp * (0.8 + widthFactor);
      const mid = -(r_sample + l) * r * amp * (0.8 + midFactor);

      const px = cx + side;
      const py = cy + mid;

      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(cx, cy, 2 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }

  const KNOB_CONFIGS: Record<string, {
    inputControlId: string;
    rotorId: string;
    arcId: string;
    valId: string;
    min: number;
    max: number;
    step: number;
    format: (v: number) => string;
  }> = {
    cellKnobInput: {
      inputControlId: "s-ingain",
      rotorId: "rotorInputGain",
      arcId: "arcInputGain",
      valId: "valInputGain",
      min: -12,
      max: 12,
      step: 0.1,
      format: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)} dB`,
    },
    cellKnobComp: {
      inputControlId: "s-thresh",
      rotorId: "rotorCompThresh",
      arcId: "arcCompThresh",
      valId: "valCompThresh",
      min: -40,
      max: 0,
      step: 0.5,
      format: (v: number) => `${v.toFixed(1)} dB`,
    },
    cellKnobWidth: {
      inputControlId: "s-width",
      rotorId: "rotorStereoWidth",
      arcId: "arcStereoWidth",
      valId: "valStereoWidth",
      min: 0,
      max: 3,
      step: 0.05,
      format: (v: number) => `${v.toFixed(2)}x`,
    },
    cellKnobDrive: {
      inputControlId: "s-satdrive",
      rotorId: "rotorTubeDrive",
      arcId: "arcTubeDrive",
      valId: "valTubeDrive",
      min: 0,
      max: 1,
      step: 0.01,
      format: (v: number) => `${Math.round(v * 100)}%`,
    },
    cellKnobCeil: {
      inputControlId: "s-ceiling",
      rotorId: "rotorLimiterCeil",
      arcId: "arcLimiterCeil",
      valId: "valLimiterCeil",
      min: 0.1,
      max: 1.0,
      step: 0.01,
      format: (v: number) => {
        const db = 20 * Math.log10(Math.max(0.01, Number(v)));
        return `${db.toFixed(1)} dB`;
      },
    },
  };

  const ARC_CIRCUMFERENCE = 2 * Math.PI * 42;
  const ARC_SPAN_DEG = 270;
  const ARC_TOTAL_LENGTH = (ARC_SPAN_DEG / 360) * ARC_CIRCUMFERENCE;

  function initKnobs(signal: AbortSignal) {
    Object.entries(KNOB_CONFIGS).forEach(([cellId, cfg]) => {
      const cell = $(cellId);
      const rotor = $(cfg.rotorId);
      const arc = $(cfg.arcId);
      const valPill = $(cfg.valId);
      const inputEl = $input(cfg.inputControlId);

      if (!cell || !rotor || !arc || !valPill) return;
      // FIX FINAL 2026-09-27: TS no estrecha tipos dentro de closures.
      // Re-asignamos a const no-null.
      const rotorEl: HTMLElement = rotor;
      const arcEl: HTMLElement = arc;
      const valPillEl: HTMLElement = valPill;

      arcEl.style.strokeDasharray = `${ARC_TOTAL_LENGTH} ${ARC_CIRCUMFERENCE}`;

      function updateKnobDisplay(val: number) {
        const clamped = Math.max(cfg.min, Math.min(cfg.max, Number(val)));
        const norm = (clamped - cfg.min) / (cfg.max - cfg.min);
        const angle = -135 + norm * 270;
        rotorEl.style.transform = `rotate(${angle.toFixed(1)}deg)`;

        const offset = ARC_TOTAL_LENGTH * (1 - norm);
        arcEl.style.strokeDashoffset = offset.toFixed(2);

        valPillEl.textContent = cfg.format(clamped);
        rotorEl.setAttribute("aria-valuenow", clamped.toFixed(2));
      }

      if (inputEl) {
        updateKnobDisplay(Number(inputEl.value));
        inputEl.addEventListener("input", () => updateKnobDisplay(Number(inputEl.value)), { signal });
        inputEl.addEventListener("change", () => updateKnobDisplay(Number(inputEl.value)), { signal });
      }

      let startY = 0;
      let startVal = 0;
      let isDragging = false;

      function onPointerDown(e: PointerEvent) {
        e.preventDefault();
        isDragging = true;
        startY = e.clientY ?? 0;
        startVal = inputEl ? Number(inputEl.value) : (cfg.min + cfg.max) / 2;
        rotorEl.focus();
        rotorEl.classList.add("dragging");
        window.addEventListener("pointermove", onPointerMove, { signal });
        window.addEventListener("pointerup", onPointerUp, { signal });
        window.addEventListener("pointercancel", onPointerUp, { signal });
      }

      function onPointerMove(e: PointerEvent) {
        if (!isDragging) return;
        const currentY = e.clientY ?? 0;
        const deltaY = startY - currentY;
        const sensitivity = (cfg.max - cfg.min) / 160;
        let newVal = startVal + deltaY * sensitivity;
        newVal = Math.max(cfg.min, Math.min(cfg.max, newVal));

        if (inputEl) {
          inputEl.value = String(newVal);
          inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        } else {
          updateKnobDisplay(newVal);
        }
      }

      function onPointerUp() {
        if (!isDragging) return;
        isDragging = false;
        rotorEl.classList.remove("dragging");
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
        window.removeEventListener("pointercancel", onPointerUp);
        if (inputEl) {
          inputEl.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      rotorEl.addEventListener("pointerdown", onPointerDown, { signal });

      rotorEl.addEventListener(
        "wheel",
        (e: WheelEvent) => {
          e.preventDefault();
          const step = (cfg.max - cfg.min) * 0.02 * (e.deltaY < 0 ? 1 : -1);
          const current = inputEl ? Number(inputEl.value) : Number(rotorEl.getAttribute("aria-valuenow") || 0);
          const newVal = Math.max(cfg.min, Math.min(cfg.max, current + step));
          if (inputEl) {
            inputEl.value = String(newVal);
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          } else {
            updateKnobDisplay(newVal);
          }
        },
        { passive: false, signal }
      );

      rotorEl.addEventListener("keydown", (e: KeyboardEvent) => {
        let step = (cfg.max - cfg.min) * 0.05;
        if (e.key === "ArrowUp" || e.key === "ArrowRight") {
          e.preventDefault();
          const current = inputEl ? Number(inputEl.value) : cfg.min;
          const newVal = Math.min(cfg.max, current + step);
          if (inputEl) {
            inputEl.value = String(newVal);
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
          e.preventDefault();
          const current = inputEl ? Number(inputEl.value) : cfg.max;
          const newVal = Math.max(cfg.min, current - step);
          if (inputEl) {
            inputEl.value = String(newVal);
            inputEl.dispatchEvent(new Event("input", { bubbles: true }));
            inputEl.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
      }, { signal });
    });
  }

  function updateTubeFilamentGlow(metrics: MetricsShape | null | undefined) {
    const consoleGlow = $("consoleFilamentGlow");
    const consoleCorona = $("consoleFilamentCorona");
    const rackGlow = $("rackFilamentGlow");
    const rackCorona = $("rackFilamentCorona");
    const tempStatus = $("tubeFilamentTemp");

    const driveEl = $input("s-satdrive");
    const clipDriveEl = $input("s-clip-drive");
    const driveVal = Math.max(
      Number(driveEl?.value ?? 0),
      Number(clipDriveEl?.value ?? 0) / 24
    );

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const audioActivity = Math.max(0, (peak + 48) / 48);

    const totalGlow = Math.min(1.0, 0.35 + driveVal * 0.45 + audioActivity * 0.2);
    const coronaSpread = 8 + totalGlow * 18;

    const glowStyle = `opacity: ${totalGlow.toFixed(2)}; filter: drop-shadow(0 0 ${coronaSpread.toFixed(1)}px #ff6600);`;

    if (consoleGlow) consoleGlow.style.cssText = glowStyle;
    if (consoleCorona) consoleCorona.style.opacity = (totalGlow * 0.8).toFixed(2);
    if (rackGlow) rackGlow.style.cssText = glowStyle;
    if (rackCorona) rackCorona.style.opacity = (totalGlow * 0.8).toFixed(2);

    if (tempStatus) {
      if (driveVal > 0.7) tempStatus.textContent = "HOT · TUBE OVERDRIVE ACTIVE";
      else if (driveVal > 0.2) tempStatus.textContent = "WARM · HARMONIC SATURATION";
      else tempStatus.textContent = "IDLE · CLASS A TRIODE BIAS";
    }
  }

  const VFD_TICKER_MESSAGES = [
    "CALIBRATED MASTER BUS · 64-BIT DUAL PRECISION · READY",
    "TRUE PEAK INTERPOLATION 4X · ZERO CLIP DRIFT",
    "ANALOG MODELING ACTIVE · THERMIONIC VALVE ECC83 ENGAGED",
    "EBU R128 COMPLIANCE ENGINE ACTIVE · BROADCAST SAFE",
    "PHASE CORRELATION OPTIMAL · LOW-END MONO INTEGRITY VERIFIED",
  ];
  let vfdTickerIdx = 0;
  // Module-scope so teardown can clearInterval.
  let vfdTickerTimer: ReturnType<typeof setInterval> | null = null;

  function initVfdStrip() {
    const ticker = $("vfdTicker");
    if (!ticker) return;

    if (vfdTickerTimer) clearInterval(vfdTickerTimer);
    vfdTickerTimer = setInterval(() => {
      vfdTickerIdx = (vfdTickerIdx + 1) % VFD_TICKER_MESSAGES.length;
      ticker.style.opacity = "0.2";
      setTimeout(() => {
        ticker.textContent = VFD_TICKER_MESSAGES[vfdTickerIdx];
        ticker.style.opacity = "1";
      }, 300);
    }, 8000);
  }

  function updateVfdMetrics(metrics: MetricsShape | null | undefined) {
    const m = metrics || {};
    const dyn = $("vfdDynRange");
    const headroom = $("vfdHeadroom");
    const sr = $("vfdSampleRate");
    const stages = $("vfdStages");

    if (dyn) {
      const peak = Number(m.peak_db ?? 0);
      const lufs = Number(m.lufs_integrated ?? m.lufs ?? -14);
      const dr = Math.max(0, Math.abs(lufs - peak));
      dyn.textContent = `${dr.toFixed(1)} LU`;
    }

    if (headroom) {
      const tp = Number(m.true_peak_db ?? -0.1);
      const diff = 0 - tp;
      headroom.textContent = `${diff >= 0 ? "+" : ""}${diff.toFixed(1)} dB`;
    }

    const file = lgmdm().state?.selectedFile;
    if (sr && file) {
      sr.textContent = file.sampleRate ? `${(file.sampleRate / 1000).toFixed(1)} kHz` : "48.0 kHz";
    }

    if (stages) {
      const activeCount = 16 - Object.values(lgmdm().console?.getChainOverrides?.() || {}).filter(Boolean).length;
      stages.textContent = `${activeCount}/16 ON`;
    }
  }

  function initSignalFlowRibbon(signal: AbortSignal) {
    const ribbon = $("dspSignalFlow");
    if (!ribbon) return;

    ribbon.querySelectorAll<HTMLElement>(".dsp-node").forEach((btn) => {
      btn.addEventListener("click", () => {
        const pane = btn.dataset.pane;
        const stageNum = btn.dataset.stage;

        if (pane) {
          const tab = document.querySelector<HTMLElement>(`.sidebar-tab[data-pane="${pane}"]`);
          if (tab) tab.click();
        }

        if (stageNum && stageNum !== "in") {
          const card =
            document.querySelector<HTMLElement>(`.lg-stage-card[data-stage="${stageNum}"]`) ||
            document.querySelector<HTMLElement>(`[data-stage="${stageNum}"]`);
          if (card) {
            card.scrollIntoView({ behavior: "smooth", block: "center" });
            card.classList.add("pulse-highlight");
            setTimeout(() => card.classList.remove("pulse-highlight"), 1200);
          }
        }
      }, { signal });
    });
  }

  function updateMsHeatmap(metrics: MetricsShape | null | undefined) {
    const m = metrics || {};
    const corr = Math.max(-1, Math.min(1, Number(m.stereo_correlation ?? 0.95)));
    const badge = $("heatmapCorrBadge");
    if (badge) {
      badge.textContent = corr < 0 ? "OUT OF PHASE!" : corr < 0.4 ? "DIFFUSE WIDE" : "MONO-SAFE";
      badge.className = `heatmap-badge ${corr < 0 ? "danger" : corr < 0.4 ? "wide" : "safe"}`;
    }

    const wLow = Number($input("s-mb-sw-low")?.value ?? 0.9);
    const wMid = Number($input("s-mb-sw-mid")?.value ?? 1.2);
    const wHigh = Number($input("s-mb-sw-high")?.value ?? 1.5);

    const statLow = $("msStatLowMid");
    const statMid = $("msStatHighMid");
    const statAir = $("msStatAir");

    if (statLow) statLow.textContent = `${wLow.toFixed(2)}x SPREAD`;
    if (statMid) statMid.textContent = `${wMid.toFixed(2)}x SPREAD`;
    if (statAir) statAir.textContent = `${wHigh.toFixed(2)}x DIFFUSE`;

    const elLow = $("hmSpreadLowMid");
    const elMid = $("hmSpreadHighMid");
    const elAir = $("hmSpreadAir");

    if (elLow) elLow.style.transform = `scale(${Math.max(0.5, Math.min(2.0, wLow))}, 1)`;
    if (elMid) elMid.style.transform = `scale(${Math.max(0.5, Math.min(2.5, wMid))}, 1)`;
    if (elAir) elAir.style.transform = `scale(${Math.max(0.5, Math.min(3.0, wHigh))}, 1)`;
  }

  function isAudioPlaying() {
    // FIX: use the dedicated audio elements instead of `document.querySelector("audio")`
    // which could match an unrelated <audio> (login page, tutorial, etc.).
    const audio =
      document.querySelector<HTMLAudioElement>('#previewAudioWrap audio[data-preview-ready="true"]')
      || document.querySelector<HTMLAudioElement>('#previewAudioWrap audio')
      || document.querySelector<HTMLAudioElement>('#mxrServerPreviewAudio');
    if (audio && !audio.paused && audio.currentTime > 0) return true;
    const pb = $("consolePlayBtn");
    if (pb && (pb.getAttribute("aria-pressed") === "true" || pb.classList.contains("playing"))) return true;
    if (lgmdm().console?.isPlaying?.()) return true;
    return false;
  }

  function updateTapeDeck() {
    const deck = $("tapeDeckViewport");
    const statusText = $("tapeStatusText");
    if (!deck) return;

    const playing = isAudioPlaying();
    if (playing) {
      if (!deck.classList.contains("playing")) {
        deck.classList.add("playing");
      }
      if (statusText && statusText.textContent !== "TAPE ROLLING · 30 IPS · NAB") {
        statusText.textContent = "TAPE ROLLING · 30 IPS · NAB";
        statusText.style.color = "#00f0ff";
      }
    } else {
      if (deck.classList.contains("playing")) {
        deck.classList.remove("playing");
      }
      if (statusText && statusText.textContent !== "TAPE STOPPED") {
        statusText.textContent = "TAPE STOPPED";
        statusText.style.color = "#f97316";
      }
    }
  }

  function initTapeDeck(signal: AbortSignal) {
    const deck = $("tapeDeckViewport");
    if (!deck) return;
    deck.style.cursor = "pointer";
    deck.addEventListener("click", () => {
      const playBtn = $("consolePlayBtn");
      if (playBtn) playBtn.click();
    }, { signal });
  }

  let activeSpecView: "2d" | "3d" = "2d";
  // FIX FINAL 2026-09-27: tipar waterfallHistory como array de Float32Array (slices del waterfall 3D).
  const waterfallHistory: Float32Array[] = [];
  const WATERFALL_SLICES = 30;
  const WATERFALL_BINS = 64;
  let waterfallFrameCounter = 0;

  function initWaterfallSpectrogram(signal: AbortSignal) {
    const btn2d = $button("btnSpec2d");
    const btn3d = $button("btnSpec3d");
    const spec2d = $("lgmdmConsoleSpectrum");
    const spec3d = $canvas("lgmdmWaterfallCanvas");

    if (!btn2d || !btn3d || !spec3d) return;
    // FIX FINAL 2026-09-27: TS no estrecha tipos dentro de closures (setSpecView).
    const btn2dEl: HTMLButtonElement = btn2d;
    const btn3dEl: HTMLButtonElement = btn3d;
    const spec3dEl: HTMLCanvasElement = spec3d;

    function setSpecView(view: "2d" | "3d") {
      activeSpecView = view;
      btn2dEl.classList.toggle("active", view === "2d");
      btn3dEl.classList.toggle("active", view === "3d");

      if (view === "2d") {
        spec3dEl.style.display = "none";
        if (spec2d) spec2d.style.display = "block";
      } else {
        if (spec2d) spec2d.style.display = "none";
        spec3dEl.style.display = "block";
      }
    }

    btn2dEl.addEventListener("click", () => setSpecView("2d"), { signal });
    btn3dEl.addEventListener("click", () => setSpecView("3d"), { signal });
  }

  function drawWaterfallSpectrogram(metrics: MetricsShape | null | undefined) {
    if (activeSpecView !== "3d") return;
    const canvas = $canvas("lgmdmWaterfallCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round((rect.width || 800) * dpr);
    const h = Math.round((rect.height || 200) * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const isPlaying = isAudioPlaying() || peak > -50;

    // (The early `if (activeSpecView !== "3d") return;` above already guards
    // this code path, so waterfall slices only accumulate when 3D is visible.)

    waterfallFrameCounter++;
    if (waterfallFrameCounter % 2 === 0) {
      const slice = new Float32Array(WATERFALL_BINS);
      const tap = audioTap.ensure();
      const analyser = tap?.analyserWaterfall ?? null;
      let hasRealData = false;

      if (analyser && isPlaying) {
        try {
          const freqData = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(freqData);
          if (freqData.length > 0) {
            const step = Math.max(1, Math.floor(freqData.length / WATERFALL_BINS));
            for (let b = 0; b < WATERFALL_BINS; b++) {
              slice[b] = (freqData[b * step] || 0) / 255;
            }
            hasRealData = true;
          }
        } catch (_) {}
      }

      if (!hasRealData) {
        const time = performance.now() * 0.003;
        const amp = isPlaying ? Math.max(0.18, (peak + 60) / 60) : 0.06;
        for (let b = 0; b < WATERFALL_BINS; b++) {
          const normFreq = b / WATERFALL_BINS;
          const pinkSlope = Math.pow(1 - normFreq, 0.65);
          const ripple1 = Math.sin(normFreq * 14 + time * 1.6) * 0.18;
          const ripple2 = Math.cos(normFreq * 26 - time * 2.1) * 0.14;
          const noise = Math.sin(b * 31 + time) * 0.08;
          slice[b] = Math.max(0.02, Math.min(1.0, (pinkSlope * 0.6 + ripple1 + ripple2 + noise + 0.1) * amp));
        }
      }

      waterfallHistory.unshift(slice);
      if (waterfallHistory.length > WATERFALL_SLICES) {
        waterfallHistory.pop();
      }
    }

    ctx.fillStyle = "#04060d";
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = "rgba(0, 229, 255, 0.08)";
    ctx.lineWidth = 1;
    for (let g = 0; g <= 4; g++) {
      const xRatio = g / 4;
      const xTop = w * 0.2 + xRatio * w * 0.6;
      const xBottom = w * 0.05 + xRatio * w * 0.9;
      ctx.beginPath();
      ctx.moveTo(xTop, 18 * dpr);
      ctx.lineTo(xBottom, h - 14 * dpr);
      ctx.stroke();
    }

    // Render slices back-to-front for realistic depth occlusion
    const numSlices = waterfallHistory.length;
    for (let s = numSlices - 1; s >= 0; s--) {
      const slice = waterfallHistory[s];
      const zNorm = s / (WATERFALL_SLICES - 1 || 1);

      const yBase = (18 + (1 - zNorm) * 135) * dpr;
      const widthScale = 0.62 + (1 - zNorm) * 0.38;
      const startX = ((1 - widthScale) * 0.5) * w;
      const availableW = w * widthScale;
      const heightScale = (45 + (1 - zNorm) * 35) * dpr;

      ctx.beginPath();
      ctx.moveTo(startX, yBase);

      for (let b = 0; b < WATERFALL_BINS; b++) {
        const bx = startX + (b / (WATERFALL_BINS - 1)) * availableW;
        const val = slice[b];
        const by = yBase - val * heightScale;
        ctx.lineTo(bx, by);
      }

      ctx.lineTo(startX + availableW, yBase);
      ctx.closePath();

      ctx.fillStyle = "#070b14";
      ctx.fill();

      const alpha = 0.35 + (1 - zNorm) * 0.65;
      const strokeGrad = ctx.createLinearGradient(startX, yBase, startX + availableW, yBase);
      strokeGrad.addColorStop(0.0, `rgba(56, 189, 248, ${alpha})`);
      strokeGrad.addColorStop(0.3, `rgba(0, 240, 255, ${alpha})`);
      strokeGrad.addColorStop(0.65, `rgba(234, 179, 8, ${alpha})`);
      strokeGrad.addColorStop(1.0, `rgba(236, 72, 153, ${alpha})`);
      ctx.strokeStyle = strokeGrad;
      ctx.lineWidth = Math.max(1, (1.8 - zNorm * 0.8) * dpr);
      ctx.stroke();
    }

    ctx.font = `${Math.round(8 * dpr)}px monospace`;
    ctx.fillStyle = "rgba(0, 229, 255, 0.45)";
    ctx.fillText("3D TOPOGRAPHICAL WATERFALL · 30 SLICES", 10 * dpr, 14 * dpr);
  }

  const MARCONI_STEPS = [
    { val: 30, deg: -90 },
    { val: 60, deg: -45 },
    { val: 100, deg: 0 },
    { val: 150, deg: 45 },
    { val: 250, deg: 90 },
  ];

  function initMarconiSwitch(signal: AbortSignal) {
    const pointer = $("marconiShelfFreq");
    const valPill = $("marconiShelfVal");
    const inputEl = $input("s-lowshelf-freq");
    if (!pointer || !valPill) return;
    // FIX FINAL 2026-09-27: TS no estrecha tipos dentro de closures (setStep).
    const pointerEl: HTMLElement = pointer;
    const valPillEl: HTMLElement = valPill;

    let currentVal = 100;
    if (inputEl) {
      const v = Number(inputEl.value);
      if (Number.isFinite(v) && v > 0) currentVal = v;
    }

    function setStep(val: number, triggerChange: boolean) {
      const step =
        MARCONI_STEPS.find((s) => s.val === val) ||
        MARCONI_STEPS.reduce((prev, curr) =>
          Math.abs(curr.val - val) < Math.abs(prev.val - val) ? curr : prev
        );

      currentVal = step.val;
      pointerEl.style.transform = `rotate(${step.deg}deg)`;
      pointerEl.setAttribute("aria-valuenow", String(step.val));
      valPillEl.textContent = `${step.val} Hz`;

      if (inputEl && (triggerChange || Number(inputEl.value) !== step.val)) {
        inputEl.value = String(step.val);
        inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        if (triggerChange) inputEl.dispatchEvent(new Event("change", { bubbles: true }));
      }
    }

    setStep(currentVal, false);

    document.querySelectorAll<HTMLElement>(".step-tick").forEach((tick) => {
      tick.style.cursor = "pointer";
      tick.style.pointerEvents = "auto";
      tick.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        const v = Number(tick.dataset.val);
        if (v) setStep(v, true);
      }, { signal });
    });

    pointerEl.addEventListener("click", () => {
      const idx = MARCONI_STEPS.findIndex((s) => s.val === currentVal);
      const nextIdx = (idx + 1) % MARCONI_STEPS.length;
      setStep(MARCONI_STEPS[nextIdx].val, true);
    }, { signal });

    pointerEl.addEventListener(
      "wheel",
      (e: WheelEvent) => {
        e.preventDefault();
        const idx = MARCONI_STEPS.findIndex((s) => s.val === currentVal);
        const delta = e.deltaY < 0 ? 1 : -1;
        const nextIdx = Math.max(0, Math.min(MARCONI_STEPS.length - 1, idx + delta));
        setStep(MARCONI_STEPS[nextIdx].val, true);
      },
      { passive: false, signal }
    );

    pointer.addEventListener("keydown", (e) => {
      const idx = MARCONI_STEPS.findIndex((s) => s.val === currentVal);
      if (e.key === "ArrowUp" || e.key === "ArrowRight") {
        e.preventDefault();
        const nextIdx = Math.min(MARCONI_STEPS.length - 1, idx + 1);
        setStep(MARCONI_STEPS[nextIdx].val, true);
      } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
        e.preventDefault();
        const nextIdx = Math.max(0, idx - 1);
        setStep(MARCONI_STEPS[nextIdx].val, true);
      }
    }, { signal });

    if (inputEl) {
      inputEl.addEventListener("input", () => {
        const v = Number(inputEl.value);
        if (Number.isFinite(v)) setStep(v, false);
      }, { signal });
    }
  }

  let sphereRotY = 0;

  function drawVectorsphere(metrics: MetricsShape | null | undefined) {
    if (activeMeterView !== "sphere") return;
    const canvas = $canvas("lgmdmVectorsphereCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const size = 220;
    const w = size * dpr;
    const h = size * dpr;

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.fillStyle = "rgba(4, 8, 16, 0.32)";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const corr = Math.max(-1, Math.min(1, Number(m.stereo_correlation ?? 0.95)));
    const widthEl = $input("s-width");
    const stereoWidth = Number(widthEl?.value ?? 1.2);

    const badge = $("sphereWidthBadge");
    if (badge) {
      badge.textContent = `STEREO ${stereoWidth.toFixed(2)}x · CORR ${corr >= 0 ? "+" : ""}${corr.toFixed(2)}`;
    }

    const amp = Math.max(0.1, (peak + 60) / 60);
    const baseR = (75 * dpr) * (0.85 + amp * 0.25);

    const scaleX = (1 - corr * 0.45) * (stereoWidth * 0.7 + 0.3);
    const scaleY = (1 + corr * 0.25);
    const scaleZ = 1.0;

    sphereRotY += 0.02;
    const tiltX = 0.32;
    const cosTilt = Math.cos(tiltX);
    const sinTilt = Math.sin(tiltX);
    const cosY = Math.cos(sphereRotY);
    const sinY = Math.sin(sphereRotY);

    function project3d(x: number, y: number, z: number): { x: number; y: number; z: number; factor: number } {
      const sx = x * scaleX;
      const sy = y * scaleY;
      const sz = z * scaleZ;

      const rx = sx * cosY + sz * sinY;
      const rz = -sx * sinY + sz * cosY;

      const py = sy * cosTilt - rz * sinTilt;
      const pz = sy * sinTilt + rz * cosTilt;

      const fov = 260 * dpr;
      const factor = fov / (fov + pz);
      return {
        x: cx + rx * factor,
        y: cy + py * factor,
        z: pz,
        factor,
      };
    }

    const latAngles = [-60, -35, -15, 0, 15, 35, 60];
    latAngles.forEach((latDeg) => {
      const latRad = (latDeg * Math.PI) / 180;
      const ringR = Math.cos(latRad) * baseR;
      const ringY = Math.sin(latRad) * baseR;
      const isEquator = latDeg === 0;

      ctx.beginPath();
      const numPts = 36;
      for (let p = 0; p <= numPts; p++) {
        const phi = (p / numPts) * Math.PI * 2;
        const px = Math.cos(phi) * ringR;
        const pz = Math.sin(phi) * ringR;
        const proj = project3d(px, ringY, pz);
        if (p === 0) ctx.moveTo(proj.x, proj.y);
        else ctx.lineTo(proj.x, proj.y);
      }

      if (isEquator) {
        ctx.strokeStyle = "rgba(0, 240, 255, 0.75)";
        ctx.lineWidth = Math.max(1, 1.8 * dpr);
      } else {
        ctx.strokeStyle = "rgba(168, 85, 247, 0.35)";
        ctx.lineWidth = 1;
      }
      ctx.stroke();
    });

    const numMeridians = 8;
    for (let mIdx = 0; mIdx < numMeridians; mIdx++) {
      const phi = (mIdx / numMeridians) * Math.PI;
      ctx.beginPath();
      const numPts = 32;
      for (let p = 0; p <= numPts; p++) {
        const lat = -Math.PI / 2 + (p / numPts) * Math.PI;
        const px = Math.cos(lat) * Math.sin(phi) * baseR;
        const py = Math.sin(lat) * baseR;
        const pz = Math.cos(lat) * Math.cos(phi) * baseR;
        const proj = project3d(px, py, pz);
        if (p === 0) ctx.moveTo(proj.x, proj.y);
        else ctx.lineTo(proj.x, proj.y);
      }
      ctx.strokeStyle = "rgba(168, 85, 247, 0.28)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    ctx.fillStyle = corr < 0 ? "#ef4444" : "#00f0ff";
    const numParticles = 24;
    for (let i = 0; i < numParticles; i++) {
      const angle = (i / numParticles) * Math.PI * 2 + sphereRotY * 1.5;
      const dist = (Math.sin(angle * 3 + sphereRotY) * 0.4 + 0.6) * baseR * 0.45 * amp;
      const pX = Math.cos(angle) * dist;
      const pY = Math.sin(angle * 2) * dist * 0.5;
      const pZ = Math.sin(angle) * dist;
      const proj = project3d(pX, pY, pZ);

      ctx.beginPath();
      ctx.arc(proj.x, proj.y, Math.max(1, 1.6 * dpr * proj.factor), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawEqCurve() {
    const canvas = $canvas("lgmdmEqCurveCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round((rect.width || 600) * dpr);
    const h = Math.round((rect.height || 160) * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.fillStyle = "#04060c";
    ctx.fillRect(0, 0, w, h);

    const minFreq = 20;
    const maxFreq = 20000;
    const logMin = Math.log10(minFreq);
    const logMax = Math.log10(maxFreq);

    function freqToX(f: number): number {
      const norm = (Math.log10(Math.max(minFreq, f)) - logMin) / (logMax - logMin);
      return norm * w;
    }

    const minDb = -18;
    const maxDb = 15;
    const zeroY = h * (maxDb / (maxDb - minDb));

    function dbToY(db: number): number {
      const norm = (db - minDb) / (maxDb - minDb);
      return h - norm * h;
    }

    const gridFreqs = [50, 100, 250, 500, 1000, 2500, 5000, 10000];
    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    gridFreqs.forEach((f) => {
      const gx = freqToX(f);
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.lineTo(gx, h);
      ctx.stroke();
    });

    ctx.strokeStyle = "rgba(0, 240, 255, 0.22)";
    ctx.beginPath();
    ctx.moveTo(0, zeroY);
    ctx.lineTo(w, zeroY);
    ctx.stroke();

    const hpCutoff = Number($input("s-hp")?.value ?? 30);
    const lowShelfGain = Number($input("s-lowshelf")?.value ?? 0);
    const lowShelfFreq = Number($input("s-lowshelf-freq")?.value ?? 100);

    const b1Gain = Number($input("s-eq1gain")?.value ?? 0);
    const b1Freq = Number($input("s-eq1freq")?.value ?? 100);
    const b1Q = Number($input("s-eq1q")?.value ?? 1.0);

    const b3Gain = Number($input("s-eq3gain")?.value ?? 0);
    const b3Freq = Number($input("s-eq3freq")?.value ?? 1000);
    const b3Q = Number($input("s-eq3q")?.value ?? 1.2);

    const b6Gain = Number($input("s-eq6gain")?.value ?? 0);
    const b6Freq = Number($input("s-eq6freq")?.value ?? 12000);
    const b6Q = Number($input("s-eq6q")?.value ?? 0.8);

    const airGain = Number($input("s-air")?.value ?? 0);

    const dbVal1 = $("dynBellVal1");
    const dbVal3 = $("dynBellVal3");
    const dbVal6 = $("dynBellVal6");
    if (dbVal1) dbVal1.textContent = `${b1Gain >= 0 ? "+" : ""}${b1Gain.toFixed(1)} dB`;
    if (dbVal3) dbVal3.textContent = `${b3Gain >= 0 ? "+" : ""}${b3Gain.toFixed(1)} dB`;
    if (dbVal6) dbVal6.textContent = `${b6Gain >= 0 ? "+" : ""}${b6Gain.toFixed(1)} dB`;

    const numPoints = 180;
    const curvePoints = [];

    for (let i = 0; i <= numPoints; i++) {
      const norm = i / numPoints;
      const freq = Math.pow(10, logMin + norm * (logMax - logMin));
      let totalDb = 0;

      if (freq < hpCutoff) {
        const octaves = Math.log2(hpCutoff / Math.max(1, freq));
        totalDb -= octaves * 24;
      }

      if (lowShelfGain !== 0) {
        const shelfRatio = 1 / (1 + Math.pow(freq / lowShelfFreq, 2));
        totalDb += lowShelfGain * shelfRatio;
      }

      const bells = [
        { f: b1Freq, g: b1Gain, q: b1Q },
        { f: b3Freq, g: b3Gain, q: b3Q },
        { f: b6Freq, g: b6Gain, q: b6Q },
      ];
      bells.forEach(({ f, g, q }) => {
        if (g === 0) return;
        const bw = Math.max(0.1, 1 / (q * 1.5));
        const diff = Math.log(freq / f);
        totalDb += g * Math.exp(-(diff * diff) / (2 * bw * bw));
      });

      if (airGain !== 0) {
        const airRatio = 1 / (1 + Math.pow(16000 / freq, 2));
        totalDb += airGain * airRatio;
      }

      const cx = freqToX(freq);
      const cy = dbToY(Math.max(-28, Math.min(20, totalDb)));
      curvePoints.push({ x: cx, y: cy });
    }

    ctx.beginPath();
    ctx.moveTo(curvePoints[0].x, zeroY);
    curvePoints.forEach((p) => ctx.lineTo(p.x, p.y));
    ctx.lineTo(curvePoints[curvePoints.length - 1].x, zeroY);
    ctx.closePath();

    const fillGrad = ctx.createLinearGradient(0, 0, 0, h);
    fillGrad.addColorStop(0, "rgba(0, 240, 255, 0.22)");
    fillGrad.addColorStop(0.5, "rgba(0, 240, 255, 0.08)");
    fillGrad.addColorStop(1, "rgba(0, 240, 255, 0)");
    ctx.fillStyle = fillGrad;
    ctx.fill();

    ctx.beginPath();
    curvePoints.forEach((p, idx) => {
      if (idx === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
    ctx.strokeStyle = "#00f0ff";
    ctx.lineWidth = Math.max(1.5, 2.2 * dpr);
    ctx.stroke();

    const nodes = [
      { name: "B1", f: b1Freq, g: b1Gain, color: "#38bdf8" },
      { name: "B3", f: b3Freq, g: b3Gain, color: "#a855f7" },
      { name: "B6", f: b6Freq, g: b6Gain, color: "#ec4899" },
    ];

    nodes.forEach((nd) => {
      const nx = freqToX(nd.f);
      const ny = dbToY(nd.g);

      ctx.fillStyle = nd.color;
      ctx.beginPath();
      ctx.arc(nx, ny, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(nx, ny, 2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  function initEqCurve(signal: AbortSignal) {
    const canvas = $canvas("lgmdmEqCurveCanvas");
    if (!canvas) return;

    const eqControls = [
      "s-hp",
      "s-lowshelf",
      "s-lowshelf-freq",
      "s-eq1gain",
      "s-eq1freq",
      "s-eq1q",
      "s-eq3gain",
      "s-eq3freq",
      "s-eq3q",
      "s-eq6gain",
      "s-eq6freq",
      "s-eq6q",
      "s-air",
    ];

    eqControls.forEach((id) => {
      const el = $(id);
      if (el) {
        el.addEventListener("input", drawEqCurve, { signal });
        el.addEventListener("change", drawEqCurve, { signal });
      }
    });

    drawEqCurve();
  }

  function initAircraftSafetySwitches(signal: AbortSignal) {
    const coverClipper = $("safetyCoverClipper");
    const leverClipper = $("safetyLeverClipper");
    const ledClipper = $("safetyLedClipper");
    const statusClipper = $("safetyStatusClipper");
    const clipModeSelect = $select("s-clip-mode");

    let clipperArmed = false;

    function updateClipperVisuals() {
      leverClipper?.classList.toggle("active", clipperArmed);
      leverClipper?.setAttribute("aria-checked", String(clipperArmed));
      ledClipper?.classList.toggle("active", clipperArmed);
      if (statusClipper) {
        if (!coverClipper?.classList.contains("open")) {
          statusClipper.textContent = "COVER LOCKED · TRANSPARENT SOFT CLIP";
        } else if (clipperArmed) {
          statusClipper.textContent = "ARMED · HARD CLIP BRICKWALL ACTIVE";
        } else {
          statusClipper.textContent = "COVER OPEN · TRANSPARENT SOFT CLIP";
        }
      }
    }

    if (coverClipper && leverClipper) {
      coverClipper.addEventListener("click", () => {
        const isOpen = coverClipper.classList.toggle("open");
        if (!isOpen && clipperArmed) {
          clipperArmed = false;
          if (clipModeSelect) {
            clipModeSelect.value = "soft";
            clipModeSelect.dispatchEvent(new Event("change", { bubbles: true }));
          }
        }
        updateClipperVisuals();
      }, { signal });

      leverClipper.addEventListener("click", () => {
        if (!coverClipper.classList.contains("open")) {
          coverClipper.style.transform = "perspective(300px) rotateX(10deg)";
          setTimeout(() => {
            coverClipper.style.transform = "";
          }, 150);
          return;
        }

        clipperArmed = !clipperArmed;
        if (clipModeSelect) {
          clipModeSelect.value = clipperArmed ? "hard" : "soft";
          clipModeSelect.dispatchEvent(new Event("change", { bubbles: true }));
        }
        updateClipperVisuals();
      }, { signal });

      if (clipModeSelect) {
        clipModeSelect.addEventListener("change", () => {
          clipperArmed = clipModeSelect.value === "hard";
          if (clipperArmed && !coverClipper.classList.contains("open")) {
            coverClipper.classList.add("open");
          }
          updateClipperVisuals();
        }, { signal });
      }
    }

    const coverMaster = $("safetyCoverMaster");
    const leverMaster = $("safetyLeverMaster");
    const ledMaster = $("safetyLedMaster");
    let masterArmed = false;

    if (coverMaster && leverMaster) {
      coverMaster.addEventListener("click", () => {
        const isOpen = coverMaster.classList.toggle("open");
        if (!isOpen && masterArmed) {
          masterArmed = false;
          leverMaster.classList.remove("active");
          ledMaster?.classList.remove("active");
        }
      }, { signal });

      leverMaster.addEventListener("click", () => {
        if (!coverMaster.classList.contains("open")) {
          coverMaster.style.transform = "perspective(300px) rotateX(10deg)";
          setTimeout(() => {
            coverMaster.style.transform = "";
          }, 150);
          return;
        }
        masterArmed = !masterArmed;
        leverMaster.classList.toggle("active", masterArmed);
        ledMaster?.classList.toggle("active", masterArmed);
      }, { signal });
    }
  }

  function updateThdMatrix(metrics: MetricsShape | null | undefined) {
    const card = $("thdHarmonicMatrix");
    if (!card) return;

    const driveEl = $input("s-satdrive");
    const clipDriveEl = $input("s-clip-drive");
    const clipMode = $input("s-clip-mode")?.value || "soft";

    const drive = Number(driveEl?.value ?? 0.2);
    const clipDrive = Number(clipDriveEl?.value ?? 0);
    const isHard = clipMode === "hard";

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const signalAmp = Math.max(0, (peak + 50) / 50);

    const h2 = Math.min(96, Math.max(8, 12 + drive * 65 + signalAmp * 15));
    const db2 = -60 + (h2 / 100) * 44;

    const h3 = Math.min(92, Math.max(6, 8 + (clipDrive / 24) * 60 + drive * 24 + (isHard ? 20 : 0) + signalAmp * 12));
    const db3 = -68 + (h3 / 100) * 46;

    const h4 = Math.min(78, Math.max(4, 5 + drive * 35 + signalAmp * 8));
    const db4 = -76 + (h4 / 100) * 38;

    const h5 = Math.min(68, Math.max(3, 4 + (clipDrive / 24) * 38 + (isHard ? 18 : 0) + signalAmp * 6));
    const db5 = -82 + (h5 / 100) * 36;

    const bar2 = $("thdBar2");
    const bar3 = $("thdBar3");
    const bar4 = $("thdBar4");
    const bar5 = $("thdBar5");

    if (bar2) bar2.style.height = `${h2.toFixed(1)}%`;
    if (bar3) bar3.style.height = `${h3.toFixed(1)}%`;
    if (bar4) bar4.style.height = `${h4.toFixed(1)}%`;
    if (bar5) bar5.style.height = `${h5.toFixed(1)}%`;

    const val2 = $("thdVal2");
    const val3 = $("thdVal3");
    const val4 = $("thdVal4");
    const val5 = $("thdVal5");

    if (val2) val2.textContent = `${db2.toFixed(0)} dB`;
    if (val3) val3.textContent = `${db3.toFixed(0)} dB`;
    if (val4) val4.textContent = `${db4.toFixed(0)} dB`;
    if (val5) val5.textContent = `${db5.toFixed(0)} dB`;

    const thdVal = Math.max(0.04, 0.04 + drive * 0.48 + (clipDrive / 24) * 0.38 + (isHard ? 0.42 : 0));
    const thdBadge = $("thdPercentBadge");
    if (thdBadge) thdBadge.textContent = `THD: ${thdVal.toFixed(2)}%`;

    const evenSum = h2 + h4;
    const oddSum = h3 + h5;
    const evenPct = Math.round((evenSum / (evenSum + oddSum)) * 100);
    const oddPct = 100 - evenPct;

    const balanceText = $("thdBalanceText");
    if (balanceText) {
      balanceText.textContent = `EVEN TUBE WARMTH: ${evenPct}% · ODD TAPE PUNCH: ${oddPct}%`;
    }
  }

  // Module-scope so teardown can clearTimeout.
  let jewelFlashTimer: ReturnType<typeof setTimeout> | null = null;

  function updateJewelLamp(metrics: MetricsShape | null | undefined) {
    const lamp = $("jewelLampBeacon");
    if (!lamp) return;

    const m = metrics || {};
    const tp = Number(m.true_peak_db ?? -60);
    const peak = Number(m.peak_db ?? -60);

    const isClipping = tp > -0.1 || peak >= 0;

    if (isClipping) {
      lamp.classList.add("flashing");
      if (jewelFlashTimer) clearTimeout(jewelFlashTimer);
      jewelFlashTimer = setTimeout(() => {
        lamp.classList.remove("flashing");
      }, 320);
    }
  }

  function updateCrestFactor(metrics: MetricsShape | null | undefined) {
    const container = $("crestFactorContainer");
    if (!container) return;

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -1);
    const rms = Number(m.rms_db ?? -14);

    const dr = Math.max(3, Math.min(20, Math.abs(peak - rms)));
    const valEl = $("crestFactorVal");
    const bar = $("crestBar");

    if (valEl) valEl.textContent = `DR ${dr.toFixed(1)}`;

    if (bar) {
      const norm = Math.max(0, Math.min(1, (dr - 4) / 12));
      bar.style.left = `${(norm * 100).toFixed(1)}%`;
    }
  }

  // FIX FINAL 2026-09-27: tipar roomWaves como array de ondas circulares que emiten los speakers.
  interface RoomWave { r: number; alpha: number; amp: number; isLeft: boolean; }
  const roomWaves: RoomWave[] = [];
  let roomWaveSpawnCounter = 0;

  function drawMasteringRoom(metrics: MetricsShape | null | undefined) {
    const canvas = $canvas("lgmdmRoomCanvas");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const w = Math.round((rect.width || 480) * dpr);
    const h = Math.round((rect.height || 150) * dpr);

    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    ctx.fillStyle = "#04060c";
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const sweetY = h * 0.72;

    const widthEl = $input("s-width");
    const haasEl = $input("s-haas");
    const enhancerEl = $input("s-enhancer");

    const stereoWidth = Number(widthEl?.value ?? 1.2);
    const haasDelay = Number(haasEl?.value ?? 0);
    const isEnhancer = enhancerEl?.checked ?? false;

    const speakerSpread = (75 * dpr) * (0.8 + stereoWidth * 0.2);
    const spkLeft = { x: cx - speakerSpread, y: h * 0.22 };
    const spkRight = { x: cx + speakerSpread, y: h * 0.22 };

    ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
    ctx.lineWidth = 1;
    ctx.strokeRect(10 * dpr, 10 * dpr, w - 20 * dpr, h - 20 * dpr);

    ctx.fillStyle = "rgba(0, 240, 255, 0.06)";
    [[10, 10], [w / dpr - 10, 10], [10, h / dpr - 10], [w / dpr - 10, h / dpr - 10]].forEach(([bx, by]) => {
      ctx.beginPath();
      ctx.arc(bx * dpr, by * dpr, 18 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });

    const m = metrics || {};
    const peak = Number(m.peak_db ?? -60);
    const isPlaying = isAudioPlaying() || peak > -50;
    const amp = Math.max(0.1, (peak + 60) / 60);

    roomWaveSpawnCounter++;
    if (isPlaying && roomWaveSpawnCounter % 14 === 0) {
      roomWaves.push({ r: 4 * dpr, alpha: 0.8, amp, isLeft: true });
      const rightDelay = haasDelay > 0 ? haasDelay * 0.2 : 0;
      setTimeout(() => {
        roomWaves.push({ r: 4 * dpr, alpha: 0.8, amp, isLeft: false });
      }, rightDelay * 10);
    }

    for (let i = roomWaves.length - 1; i >= 0; i--) {
      const wave = roomWaves[i];
      wave.r += 1.8 * dpr;
      wave.alpha -= 0.015;

      if (wave.alpha <= 0) {
        roomWaves.splice(i, 1);
        continue;
      }

      const spk = wave.isLeft ? spkLeft : spkRight;
      ctx.strokeStyle = wave.isLeft
        ? `rgba(0, 240, 255, ${wave.alpha.toFixed(2)})`
        : `rgba(168, 85, 247, ${wave.alpha.toFixed(2)})`;
      ctx.lineWidth = Math.max(1, 1.4 * dpr);

      ctx.beginPath();
      const startAngle = wave.isLeft ? 0.2 * Math.PI : 0.4 * Math.PI;
      const endAngle = wave.isLeft ? 0.6 * Math.PI : 0.8 * Math.PI;
      ctx.arc(spk.x, spk.y, wave.r, startAngle, endAngle);
      ctx.stroke();
    }

    [
      { pt: spkLeft, label: "L", angle: 0.35, color: "#00f0ff" },
      { pt: spkRight, label: "R", angle: -0.35, color: "#a855f7" },
    ].forEach(({ pt, angle, color }) => {
      ctx.save();
      ctx.translate(pt.x, pt.y);
      ctx.rotate(angle);

      ctx.fillStyle = "#1e293b";
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.strokeRect(-12 * dpr, -8 * dpr, 24 * dpr, 16 * dpr);
      ctx.fillRect(-12 * dpr, -8 * dpr, 24 * dpr, 16 * dpr);

      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      ctx.arc(0, 0, 5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(0, -4 * dpr, 1.5 * dpr, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    });

    ctx.strokeStyle = "rgba(16, 185, 129, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, sweetY, 10 * dpr, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(cx - 14 * dpr, sweetY);
    ctx.lineTo(cx + 14 * dpr, sweetY);
    ctx.moveTo(cx, sweetY - 14 * dpr);
    ctx.lineTo(cx, sweetY + 14 * dpr);
    ctx.stroke();

    ctx.fillStyle = "#10b981";
    ctx.font = `${Math.round(7 * dpr)}px monospace`;
    ctx.textAlign = "center";
    ctx.fillText("SWEET SPOT", cx, sweetY + 18 * dpr);

    const crossfeedEl = $("roomCrossfeedVal");
    const diffEl = $("roomDiffVal");
    if (crossfeedEl) {
      crossfeedEl.textContent = `${Math.round(12 + (haasDelay > 0 ? haasDelay * 1.5 : 0))}%`;
    }
    if (diffEl) {
      diffEl.textContent = isEnhancer ? "OPTIMAL" : "HIGH";
    }
  }

  // Module-scope state (so teardown at the end of the file can access them).
  // FIX FINAL 2026-09-27: tipar explícitamente lastMetricsRef y metricsUnsub.
  let lastMetricsRef: MetricsShape | null = null;
  let animFrameId = 0;
  let metricsUnsub: (() => void) | null = null;
  let visualSuiteController: AbortController | null = null;

  // FIX: respect `prefers-reduced-motion` by throttling the RAF loop to a
  // low rate. The visualizers are decorative; a slow frame rate is acceptable.
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  let lastTickTs = 0;

  function visualSuiteTick(ts: number) {
    // FIX: wrap the per-frame work in try/catch so one bad frame (e.g. a
    // canvas whose context was lost) doesn't permanently kill the suite.
    try {
      // Throttle when the user asked for reduced motion (~10 fps).
      if (reducedMotion && ts - lastTickTs < 100) {
        animFrameId = requestAnimationFrame(visualSuiteTick);
        return;
      }
      lastTickTs = ts;

      stepVuBallistics();
      drawGoniometer(lastMetricsRef);
      drawVectorsphere(lastMetricsRef);
      drawWaterfallSpectrogram(lastMetricsRef);
      drawMasteringRoom(lastMetricsRef);
      updateTubeFilamentGlow(lastMetricsRef);
      updateTapeDeck();
    } catch (err) {
      // Log once and stop the loop so we don't spam the console at 60fps.
      console.error('[visual-suite] tick failed, stopping loop:', err);
      teardownVisualSuite();
      return;
    }

    animFrameId = requestAnimationFrame(visualSuiteTick);
  }

  function handleMetricsUpdate(metrics: MetricsShape | null | undefined) {
    if (!metrics) return;
    lastMetricsRef = metrics;
    updateVuNeedles(metrics);
    updateVfdMetrics(metrics);
    updateMsHeatmap(metrics);
    updateThdMatrix(metrics);
    updateJewelLamp(metrics);
    updateCrestFactor(metrics);
  }

  function initVisualSuite() {
    // Idempotency guard (global) — survives HMR reloads without re-registering
    // listeners or re-subscribing to the metrics store.
    const g = lgmdm();
    if (g.visualSuiteBound) return;
    g.visualSuiteBound = true;
    // FIX 26-sep-2026: resetear el latch de teardown para que el suite pueda
    // apagarse y volver a prender (era one-shot, lo dejaba muerto).
    resetTeardownLatch();

    // Abort any previous controller (HMR re-init) and create a fresh one.
    if (visualSuiteController) visualSuiteController.abort();
    visualSuiteController = new AbortController();
    const signal = visualSuiteController.signal;

    initChassisTheme(signal);
    initCrtToggle(signal);
    initMeterSwitcher(signal);
    initKnobs(signal);
    initVfdStrip();
    initSignalFlowRibbon(signal);
    initTapeDeck(signal);
    initWaterfallSpectrogram(signal);
    initMarconiSwitch(signal);
    initEqCurve(signal);
    initAircraftSafetySwitches(signal);

    if (metricsUnsub) { metricsUnsub(); metricsUnsub = null; }
    metricsUnsub = metricsStore.subscribe((event) => {
      if (event.metrics) handleMetricsUpdate(event.metrics);
    });

    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(visualSuiteTick);
  }

  let teardownDone = false;
  function teardownVisualSuite() {
    if (teardownDone) return;
    teardownDone = true;
    if (visualSuiteController) { visualSuiteController.abort(); visualSuiteController = null; }
    if (animFrameId) { cancelAnimationFrame(animFrameId); animFrameId = 0; }
    if (vfdTickerTimer) { clearInterval(vfdTickerTimer); vfdTickerTimer = null; }
    if (jewelFlashTimer) { clearTimeout(jewelFlashTimer); jewelFlashTimer = null; }
    if (metricsUnsub) { metricsUnsub(); metricsUnsub = null; }
    // Disconnect the audio tap so analysers/splitter are released.
    audioTap.teardown();
    const g = lgmdm();
    g.visualSuiteBound = false;
  }
  // FIX 26-sep-2026: resetear teardownDone en initVisualSuite para que un
  // teardown (incluido el del catch del RAF tick) no deje el suite muerto
  // para siempre. Antes el latch era one-shot: una vez hecho teardown,
  // initVisualSuite re-registraba todo pero la próxima teardown era no-op.
  function resetTeardownLatch() { teardownDone = false; }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initVisualSuite, { once: true });
  } else {
    initVisualSuite();
  }

  const gg = lgmdm();
  gg.visualSuite = gg.visualSuite || {};
  gg.visualSuite.updateMetrics = handleMetricsUpdate;
  gg.visualSuite.applyChassisTheme = applyChassisTheme;

  window.addEventListener("beforeunload", teardownVisualSuite, { once: true });

  export { initVisualSuite, teardownVisualSuite };
