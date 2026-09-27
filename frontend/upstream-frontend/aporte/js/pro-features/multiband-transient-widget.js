// ============================================================
// multiband-transient-widget.js — F4.1 Multiband Transient Designer
// ============================================================
// UI lógica: 3 columnas (low/mid/high) con faders Attack/Release,
// LED meter por banda, slider global de Amount y botón Apply.
// Sigue convención IIFE del resto de 34-premium-suite.js.
(function (global) {
  'use strict';

  const LG = global.LGMDM = global.LGMDM || {};
  LG.proFeatures = LG.proFeatures || {};

  const BAND_LABELS = { low: 'Low', mid: 'Mid', high: 'High' };
  const LED_THRESHOLDS = [0.55, 0.82]; // green / yellow / red transitions

  let _mtwUid = 0;

  function ledColor(level) {
    if (!Number.isFinite(level)) return '#52f2bd';
    if (level < LED_THRESHOLDS[0]) return '#52f2bd';
    if (level < LED_THRESHOLDS[1]) return '#ffd84d';
    return '#ff5f72';
  }

  function clampPct(n) {
    n = Number(n);
    if (!Number.isFinite(n)) return 0;
    return Math.max(-100, Math.min(100, n));
  }

  class multibandTransientWidget {
    constructor() {
      this.canvas = null;
      this.root = null;
      this._uid = ++_mtwUid;
      this.controlsEl = null;
      this.rafId = null;
      this.levels = [0, 0, 0]; // LED meter levels [0..1]
      this.state = {
        bands: ['low', 'mid', 'high'],
        attack_ms: [10, 10, 10],
        release_ms: [100, 100, 100],
        amount: 0.5
      };
      // Internal user-set values for faders; scaled by Amount on output.
      this._user = { attack: [0, 0, 0], release: [0, 0, 0] };
      this._amount = 0.5;
      this._listeners = [];
      this._onApply = null;
    }

    // ── public API ──────────────────────────────────────────────────────
    init(canvas, options = {}) {
      this.canvas = canvas || null;
      this.root = (canvas && canvas.parentElement) || null;
      if (!this.root) return;

      this._amount = clamp01(options.amount != null ? options.amount : 0.5);
      if (Array.isArray(options.attack_ms) && options.attack_ms.length >= 3) {
        this.state.attack_ms = options.attack_ms.slice(0, 3).map(Number);
      }
      if (Array.isArray(options.release_ms) && options.release_ms.length >= 3) {
        this.state.release_ms = options.release_ms.slice(0, 3).map(Number);
      }
      if (Array.isArray(options.bands) && options.bands.length >= 3) {
        this.state.bands = options.bands.slice(0, 3);
      }

      // Build controls wrapper
      const controls = document.createElement('div');
      controls.className = 'pro-meter-card pro-multiband-transient-controls';
      controls.style.cssText = 'display:flex;flex-direction:column;gap:.9rem;';
      controls.innerHTML = this.getControls();
      this.controlsEl = controls;

      // Place controls after the canvas (canvas is optional / unused here)
      if (this.canvas && this.canvas.parentElement === this.root) {
        this.canvas.insertAdjacentElement('afterend', controls);
      } else {
        this.root.appendChild(controls);
      }

      this._wireEvents();
      this._renderLedSnapshot();
      this._bindResize();
      this._startRaf();

      if (typeof options.onApply === 'function') this._onApply = options.onApply;
    }

    update(data = {}) {
      if (!data) return;
      if (Array.isArray(data.bands) && data.bands.length >= 3) {
        this.state.bands = data.bands.slice(0, 3);
      }
      if (Array.isArray(data.attack_ms) && data.attack_ms.length >= 3) {
        this.state.attack_ms = data.attack_ms.slice(0, 3).map(Number);
      }
      if (Array.isArray(data.release_ms) && data.release_ms.length >= 3) {
        this.state.release_ms = data.release_ms.slice(0, 3).map(Number);
      }
      if (Number.isFinite(Number(data.amount))) {
        this._amount = clamp01(data.amount);
        const amtEl = this.root.querySelector(`#mtw-amount-${this._uid}`);
        if (amtEl) amtEl.value = String(Math.round(this._amount * 100));
        const amtOut = this.root.querySelector(`#mtw-amount-val-${this._uid}`);
        if (amtOut) amtOut.textContent = `${Math.round(this._amount * 100)}%`;
      }
      // Pulse meters if backend provides per-band levels
      if (Array.isArray(data.levels)) {
        for (let i = 0; i < 3 && i < data.levels.length; i++) {
          const v = clamp01(data.levels[i]);
          if (v > this.levels[i]) this.levels[i] = v;
        }
        if (!this.rafId && this.levels.some((v) => v >= 0.01)) {
          this._startRaf();
        }
      }
      this._syncControlsFromState();
    }

    destroy() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
      if (this._ro) { try { this._ro.disconnect(); } catch (_) {} this._ro = null; }
      this._listeners.forEach((rec) => {
        try { rec.target.removeEventListener(rec.type, rec.handler, rec.options); }
        catch (_) { /* noop */ }
      });
      this._listeners = [];
      if (this.controlsEl && this.controlsEl.parentElement) {
        this.controlsEl.parentElement.removeChild(this.controlsEl);
      }
      this.controlsEl = null;
      this.canvas = null;
      this.root = null;
    }

    getControls() {
      const bands = (this.state.bands || ['low', 'mid', 'high']).slice(0, 3);
      const amountPct = Math.round(this._amount * 100);
      const u = this._uid;
      const cols = bands.map((b, i) => {
        const label = BAND_LABELS[b] || b;
        const initA = clampPct(this._user.attack[i] != null ? this._user.attack[i] : 0);
        const initR = clampPct(this._user.release[i] != null ? this._user.release[i] : 0);
        return `
          <div class="pro-mtw-col" data-band-idx="${i}" data-band="${b}">
            <div class="pro-mtw-col__head">
              <strong>${label}</strong>
              <span>band ${i + 1}</span>
            </div>
            <div>
              <label for="mtw-attack-${u}-${i}">
                Attack
              </label>
              <input id="mtw-attack-${u}-${i}" type="range" class="mtw-fader-attack" data-idx="${i}"
                     min="-100" max="100" step="1" value="${initA}" aria-label="Attack (${label} band)">
              <output class="mtw-attack-out" data-idx="${i}">
                ${initA > 0 ? '+' : ''}${initA}%
              </output>
            </div>
            <div>
              <label for="mtw-release-${u}-${i}">
                Release
              </label>
              <input id="mtw-release-${u}-${i}" type="range" class="mtw-fader-release" data-idx="${i}"
                     min="-100" max="100" step="1" value="${initR}" aria-label="Release (${label} band)">
              <output class="mtw-release-out" data-idx="${i}">
                ${initR > 0 ? '+' : ''}${initR}%
              </output>
            </div>
            <div class="mtw-led-wrap" data-idx="${i}">
              <span class="mtw-led" data-idx="${i}"></span>
              <span class="mtw-led-bar" data-idx="${i}"
                    style="flex:1;height:6px;border-radius:3px;background:rgba(255,255,255,.06);
                           overflow:hidden;position:relative;">
                <span class="mtw-led-fill" data-idx="${i}"
                      style="display:block;height:100%;width:0%;background:#52f2bd;
                             transition:width .12s, background-color .12s;"></span>
              </span>
            </div>
          </div>
        `;
      }).join('');

      return `
        <div style="display:flex;flex-direction:column;gap:.75rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;gap:.6rem;flex-wrap:wrap;">
            <strong class="pro-card-title" style="font-size:.78rem;">
              ⚡ Multiband Transient Designer
            </strong>
            <span style="font-size:.6rem;color:var(--ui-muted,#9ba6c4);">
              Per-band envelope shaping · 3 bandas
            </span>
          </div>

          <div class="pro-mtw-cols"
               style="display:flex;gap:.7rem;align-items:stretch;flex-wrap:wrap;">
            ${cols}
          </div>

          <div class="pro-control-row" style="display:grid;grid-template-columns:140px 1fr 90px;
                                              align-items:center;gap:.8rem;margin:.4rem 0 0;">
            <label for="mtw-amount-${u}" style="font-size:.72rem;color:var(--ui-muted,#9ba6c4);">Amount</label>
            <input type="range" id="mtw-amount-${u}" min="0" max="100" step="1" value="${amountPct}"
                   style="width:100%;" aria-label="Amount">
            <output id="mtw-amount-val-${u}"
                    style="text-align:right;color:#bdf8ff;font-size:.72rem;">
              ${amountPct}%
            </output>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:.5rem;">
            <button id="mtw-apply-${u}" class="pro-primary"
                    style="border-radius:10px;padding:.6rem 1.1rem;cursor:pointer;
                           border:1px solid rgba(92,232,255,.35);
                           background:linear-gradient(135deg,#42d9ff,#9b59ff);
                           color:#071018;font-weight:750;"
                    aria-label="Apply transient designer">
              ⚡ Apply Transient
            </button>
          </div>
        </div>
      `;
    }

    // ── internals ───────────────────────────────────────────────────────
    _wireEvents() {
      if (!this.root || !this.controlsEl) return;
      const root = this.controlsEl;

      // Attack faders
      root.querySelectorAll('.mtw-fader-attack').forEach((el) => {
        const handler = (e) => {
          const idx = Number(e.target.dataset.idx);
          if (!Number.isInteger(idx)) return;
          const v = clampPct(e.target.value);
          this._user.attack[idx] = v;
          const out = root.querySelector(`.mtw-attack-out[data-idx="${idx}"]`);
          if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`;
        };
        el.addEventListener('input', handler);
        this._listeners.push({ target: el, type: 'input', handler });
      });

      // Release faders
      root.querySelectorAll('.mtw-fader-release').forEach((el) => {
        const handler = (e) => {
          const idx = Number(e.target.dataset.idx);
          if (!Number.isInteger(idx)) return;
          const v = clampPct(e.target.value);
          this._user.release[idx] = v;
          const out = root.querySelector(`.mtw-release-out[data-idx="${idx}"]`);
          if (out) out.textContent = `${v > 0 ? '+' : ''}${v}%`;
        };
        el.addEventListener('input', handler);
        this._listeners.push({ target: el, type: 'input', handler });
      });

      // Amount slider
      const amtEl = root.querySelector(`#mtw-amount-${this._uid}`);
      if (amtEl) {
        const handler = (e) => {
          this._amount = clamp01(Number(e.target.value) / 100);
          const out = root.querySelector(`#mtw-amount-val-${this._uid}`);
          if (out) out.textContent = `${Math.round(this._amount * 100)}%`;
        };
        amtEl.addEventListener('input', handler);
        this._listeners.push({ target: amtEl, type: 'input', handler });
      }

      // Apply button
      const applyBtn = root.querySelector(`#mtw-apply-${this._uid}`);
      if (applyBtn) {
        const handler = () => this._emitApply();
        applyBtn.addEventListener('click', handler);
        this._listeners.push({ target: applyBtn, type: 'click', handler });
      }
    }

    _emitApply() {
      const scaledAttack = this._user.attack.map((v) => clampPct(v * this._amount));
      const scaledRelease = this._user.release.map((v) => clampPct(v * this._amount));
      const payload = {
        bands: this.state.bands.slice(0, 3),
        attack_pct: scaledAttack,
        release_pct: scaledRelease,
        amount: this._amount,
        // Mapeo aproximado a ms (rangos razonables de transient designer)
        attack_ms: scaledAttack.map((p) => Math.max(0.5, 10 * Math.pow(10, p / 100))),
        release_ms: scaledRelease.map((p) => Math.max(5, 100 * Math.pow(10, p / 100)))
      };
      // Pulse LEDs to acknowledge apply
      for (let i = 0; i < 3; i++) this.levels[i] = 1.0;
      if (typeof this._onApply === 'function') {
        try { this._onApply(payload); } catch (_) { /* noop */ }
      }
      if (LG && LG.ui && typeof LG.ui.showToast === 'function') {
        LG.ui.showToast('Transient Designer: parámetros aplicados.', 'success', 2500);
      }
    }

    _syncControlsFromState() {
      if (!this.controlsEl) return;
      // Reflect attack_ms/release_ms as percentages (log scale vs 10ms/100ms)
      for (let i = 0; i < 3; i++) {
        const aIn = this.controlsEl.querySelector(`.mtw-fader-attack[data-idx="${i}"]`);
        const rIn = this.controlsEl.querySelector(`.mtw-fader-release[data-idx="${i}"]`);
        if (aIn && Number.isFinite(this.state.attack_ms[i])) {
          const ms = Math.max(0.001, Number(this.state.attack_ms[i]));
          const pct = clampPct(Math.log10(ms / 10) * 100);
          aIn.value = String(Math.round(pct));
          this._user.attack[i] = pct;
          const out = this.controlsEl.querySelector(`.mtw-attack-out[data-idx="${i}"]`);
          if (out) out.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
        }
        if (rIn && Number.isFinite(this.state.release_ms[i])) {
          const ms = Math.max(0.001, Number(this.state.release_ms[i]));
          const pct = clampPct(Math.log10(ms / 100) * 100);
          rIn.value = String(Math.round(pct));
          this._user.release[i] = pct;
          const out = this.controlsEl.querySelector(`.mtw-release-out[data-idx="${i}"]`);
          if (out) out.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;
        }
      }
    }

    _bindResize() {
      if (typeof ResizeObserver === 'undefined' || !this.controlsEl) return;
      this._ro = new ResizeObserver(() => this._renderLedSnapshot());
      this._ro.observe(this.controlsEl);
    }

    _renderLedSnapshot() {
      if (!this.controlsEl) return;
      for (let i = 0; i < 3; i++) {
        const led = this.controlsEl.querySelector(`.mtw-led[data-idx="${i}"]`);
        const fill = this.controlsEl.querySelector(`.mtw-led-fill[data-idx="${i}"]`);
        const level = this.levels[i] || 0;
        const color = ledColor(level);
        if (led) {
          led.style.backgroundColor = color;
          led.style.boxShadow = level > 0
            ? `0 0 ${6 + level * 14}px ${color}`
            : '0 0 6px rgba(82,242,189,.45)';
        }
        if (fill) {
          fill.style.width = `${Math.round(level * 100)}%`;
          fill.style.backgroundColor = color;
        }
      }
    }

    _startRaf() {
      if (this.rafId) cancelAnimationFrame(this.rafId);
      const FRAME_INTERVAL = 1000 / 60;
      let last = 0;
        const tick = (now) => {
          this.rafId = null;
          if (window.LGMDM.utils.prefersReducedMotion()) return;
          if (!this.controlsEl) return;
        if (now - last < FRAME_INTERVAL) {
          this.rafId = requestAnimationFrame(tick);
          return;
        }
        last = now;
        // Decay meters (peak-hold style)
        for (let i = 0; i < 3; i++) {
          this.levels[i] = Math.max(0, this.levels[i] * 0.93 - 0.005);
        }
        // FIX CRÍTICO — Detener RAF cuando todos los levels cayeron a ~0
        // (después de ~2s de decay sin update, idle a 60fps para siempre).
        // update() lo reactiva automáticamente seteando levels[i] > 0.
        if (this.levels.every((v) => v < 0.01)) {
          this._renderLedSnapshot();
          return;
        }
        this._renderLedSnapshot();
        this.rafId = requestAnimationFrame(tick);
      };
      this.rafId = requestAnimationFrame(tick);
    }
  }

  LG.proFeatures.multibandTransientWidget = multibandTransientWidget;
  if (typeof module !== 'undefined' && module.exports) module.exports = { multibandTransientWidget };

  // ── MX-01 — Migrate to Insert abstraction ────────────────────────────
  // Frontend-only: attack/release por banda + amount, sin /dsp/* directo.
  try {
    const rack = window.LGMDM && window.LGMDM.proInsertRack;
    if (rack && typeof rack.create === 'function'
        && rack.CATALOG && rack.CATALOG['multiband-transient']) {
      const inst = rack.create({
        id: 'multiband-transient', title: '🥁 Multiband Transient', widget: multibandTransientWidget
      });
      if (inst) {
        multibandTransientWidget.Insert = inst;
        rack.registry = rack.registry || {};
        rack.registry['multiband-transient'] = inst;
      }
    }
  } catch (e) {
    if (typeof console !== 'undefined') console.debug('[insert-migration]', 'multiband-transient', e);
  }
})(typeof window !== 'undefined' ? window : globalThis);

