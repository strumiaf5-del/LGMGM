// ============================================================
// 02-sliders-ui.js — Sliders, tabs multiband, workflow rail
// ============================================================
(function () {
  'use strict';
      // F5.7 — Formatters canónicos (single source of truth).
      // Usado por 02-sliders-ui.js via lookup contra sliders-meta JSON
      // en index.html.
      const F = {
        signedDb:    (v) => (v >= 0 ? "+" : "") + v.toFixed(1) + " dB",
        signedDb2:   (v) => (v >= 0 ? "+" : "") + v.toFixed(2),
        db:          (v) => formatDbValue(v),
        hz:          (v) => Math.round(v) + " Hz",
        hzRaw:       (v) => v + " Hz",
        khz:         (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"),
        khzRaw:      (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz"),
        khzFloat1:   (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz"),
        ms:          (v) => Math.round(v) + " ms",
        ms1:         (v) => v.toFixed(1) + " ms",
        ratio:       (v) => v.toFixed(1) + ":1",
        q:           (v) => v.toFixed(1),
        lufs:        (v) => v.toFixed(1) + " LUFS",
        multi:       (v) => parseFloat(v).toFixed(2) + "x",
        multi2:      (v) => parseFloat(v).toFixed(2),
        pct:         (v) => Math.round(v * 100) + "%",
        int:         (v) => Math.round(v).toString(),
        intPct:      (v) => Math.round(v) + "%",
        linearToDbT: (v) => {
          const db = 20 * Math.log10(Math.max(Number(v), 1e-9));
          return (db >= 0 ? "+" : "") + db.toFixed(1) + " dBTP";
        },
        parseSignedDb: (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB",
        parseHzKhz:    (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"),
        parseRatio:    (v) => parseFloat(v).toFixed(1) + ":1",
        parseMs1:      (v) => parseFloat(v).toFixed(1) + " ms",
        parseMs:       (v) => Math.round(v) + " ms",
        parseRatio1:   (v) => parseFloat(v).toFixed(1) + ":1",
        parseHzKhzF:   (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : Math.round(v) + " Hz"),
        parseHzKhzRaw: (v) => (v >= 1000 ? (v / 1000).toFixed(1) + " kHz" : v + " Hz"),
        parseSignedDbAlt: (v) => (v >= 0 ? "+" : "") + parseFloat(v).toFixed(1) + " dB",
        float2: (v) => parseFloat(v).toFixed(2),
        float2_dB: (v) => parseFloat(v).toFixed(1) + " dB",
        float2_ms: (v) => parseFloat(v).toFixed(1) + " ms",
        float2_ratio: (v) => parseFloat(v).toFixed(1) + ":1",
        float1Db: (v) => v.toFixed(1) + " dB",
        float1s: (v) => parseFloat(v).toFixed(1) + " s",
        plusDb: (v) => "+" + v.toFixed(1) + " dB",
      };

      // Carga el catálogo de sliders desde el JSON inline en index.html.
      // Single source of truth: el archivo index.html (no el JS).
      const _slidersMetaEl = document.getElementById('sliders-meta');
      let sliders = [];
      if (_slidersMetaEl) {
        try {
          const entries = JSON.parse(_slidersMetaEl.textContent);
          sliders = entries.map(({ id, vid, fmt }) => [id, vid, F[fmt] || String]);
        } catch (err) {
          console.debug('[02-sliders-ui] sliders-meta JSON inválido:', err);
        }
      }
      // Bootstrap: pinta el valor inicial de cada slider. Los updates en vivo
      // los maneja LG.ui.syncRangeDisplay para los inputs declarativos —
      // ver 00-ui-core.js (initDeclarativeControls).
      sliders.forEach(([sid, vid, fmt]) => {
        const s = document.getElementById(sid),
          v = document.getElementById(vid);
        if (!s || !v) return;
        v.textContent = fmt(parseFloat(s.value));
        // Live update: actualizar el display en tiempo real al mover el slider
        s.addEventListener('input', () => {
          v.textContent = fmt(parseFloat(s.value));
        });
      });

      // Sliders con span inline (dentro del label o fuera del array principal)
      // que no tienen entrada en el array `sliders` pero necesitan live-update.
      const inlineSliders = [
        ['s-normalize-lufs',          'v-normalize-lufs',          (v) => parseFloat(v).toFixed(1)],
        ['s-uselufs-sensitivity',     'v-uselufs-sensitivity',     (v) => Math.round(v) + '%'],
        ['s-band-count',              'v-band-count',              (v) => Math.round(v).toString()],
        ['s-ref-loudness-sensitivity','v-ref-loudness-sensitivity', (v) => Math.round(v) + '%'],
        ['s-ref-fixed-lufs-value',    'v-ref-fixed-lufs',          (v) => parseFloat(v).toFixed(1)],
        ['s-ref-max-lufs',            'v-ref-max-lufs',            (v) => parseFloat(v).toFixed(1)],
        ['s-ref-eq-passes',           'v-ref-eq-passes',           (v) => Math.round(v).toString()],
        ['s-ref-crest-amount',        'v-ref-crest-amount',        (v) => Math.round(v).toString()],
        ['s-ref-spectral-dyn-amount', 'v-ref-spectral-dyn-amount', (v) => Math.round(v).toString()],
        ['s-ref-spectral-dyn-bins',   'v-ref-spectral-dyn-bins',   (v) => Math.round(v).toString()],
        ['s-ref-parallel-mix',        'v-ref-parallel-mix',        (v) => Math.round(v).toString()],
        ['s-ref-parallel-thr',        'v-ref-parallel-thr',        (v) => parseFloat(v).toFixed(0)],
        ['s-ref-parallel-ratio',      'v-ref-parallel-ratio',      (v) => parseFloat(v).toFixed(1)],
        ['s-ref-parallel-makeup',     'v-ref-parallel-makeup',     (v) => Math.round(v).toString()],
        ['s-ref-mb-sat-mix',          'v-ref-mb-sat-mix',          (v) => Math.round(v).toString()],
        ['s-ref-mb-sat-low',          'v-ref-mb-sat-low',          (v) => Math.round(v).toString()],
        ['s-ref-mb-sat-mid',          'v-ref-mb-sat-mid',          (v) => Math.round(v).toString()],
        ['s-ref-mb-sat-high',         'v-ref-mb-sat-high',         (v) => Math.round(v).toString()],
        ['s-ref-gentle-ceil',         'v-ref-gentle-ceil',         (v) => parseFloat(v).toFixed(1)],
        ['s-ref-gentle-rel',          'v-ref-gentle-rel',          (v) => Math.round(v).toString()],
      ];
      inlineSliders.forEach(([sid, vid, fmt]) => {
        const s = document.getElementById(sid);
        const v = document.getElementById(vid);
        if (!s || !v) return;
        // Bootstrap del valor inicial
        v.textContent = fmt(parseFloat(s.value));
        // Live update
        s.addEventListener('input', () => {
          v.textContent = fmt(parseFloat(s.value));
        });
      });

      // ── Multiband tabs (ARIA tablist + roving tabindex + arrow keys) ─────────
      const mbTabs = Array.from(document.querySelectorAll(".mb-tab"));
      function selectMbTab(idx) {
        const tab = mbTabs[idx];
        if (!tab) return;
        mbTabs.forEach((t, i) => {
          const selected = i === idx;
          t.classList.toggle("active", selected);
          t.setAttribute("aria-selected", String(selected));
          t.setAttribute("tabindex", selected ? "0" : "-1");
        });
        const band = tab.dataset.band;
        if (!band) {
          const error = new Error("[LGMDM DOM CONTRACT] 02-sliders-ui: .mb-tab is missing data-band");
          console.debug(error);
          throw error;
        }
        document.querySelectorAll(".mb-panel").forEach((p) => p.classList.remove("active"));
        const panel = LGMDM.dom.requireById("mb-panel-" + band, "02-sliders-ui:multiband");
        panel.classList.add("active");
      }
      mbTabs.forEach((tab, idx) => {
        tab.addEventListener("click", () => selectMbTab(idx));
        tab.addEventListener("keydown", (e) => {
          if (e.key === "ArrowRight" || e.key === "ArrowDown") {
            e.preventDefault();
            selectMbTab((idx + 1) % mbTabs.length);
            mbTabs[(idx + 1) % mbTabs.length].focus();
          } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
            e.preventDefault();
            selectMbTab((idx - 1 + mbTabs.length) % mbTabs.length);
            mbTabs[(idx - 1 + mbTabs.length) % mbTabs.length].focus();
          } else if (e.key === "Home") {
            e.preventDefault();
            selectMbTab(0);
            mbTabs[0].focus();
          } else if (e.key === "End") {
            e.preventDefault();
            selectMbTab(mbTabs.length - 1);
            mbTabs[mbTabs.length - 1].focus();
          }
        });
      });

      // ── Workflow rail / etapas ─────────────────────────────────────────────────
      const workflowCards = Array.from(document.querySelectorAll(".process-card-collapsible"));
      const workflowChips = Array.from(document.querySelectorAll(".workflow-chip"));
      function syncWorkflowState() {
        const openIndex = workflowCards.findIndex((card) => card.open);
        const currentIndex = openIndex >= 0 ? openIndex : 0;
        workflowChips.forEach((chip, index) => {
          chip.classList.toggle("active", index === currentIndex);
          chip.classList.toggle("done", index < currentIndex);
          chip.style.cursor = "pointer";
        });
      }
      workflowCards.forEach((card, index) => {
        card.addEventListener("toggle", syncWorkflowState);
        card.dataset.stageIndex = index;
      });
      workflowChips.forEach((chip, index) => {
        chip.setAttribute("role", "button");
        chip.setAttribute("tabindex", "0");
        chip.setAttribute("aria-label", `Ir al paso ${index + 1}`);
        chip.addEventListener("click", () => {
          workflowCards.forEach((card, cardIndex) => {
            card.open = cardIndex === index;
          });
          syncWorkflowState();
        });
        chip.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            chip.click();
          }
        });
      });
      syncWorkflowState();

      // ── CTA "Ir a Presets" desde empty state del workspace ─────────────────
      document.getElementById("gotoPresetsSidebar")?.addEventListener("click", () => {
        const grid = document.getElementById("presetGrid");
        if (grid) {
          grid.scrollIntoView({ behavior: "smooth", block: "start" });
          const first = grid.querySelector(".preset-btn");
          if (first) setTimeout(() => first.focus({ preventScroll: true }), 250);
        }
      });

      // ── Presets ──────────────────────────────────────────────────────────────────

})();
