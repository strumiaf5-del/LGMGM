// ============================================================
// 03-presets.js — Presets (guardar/cargar/JSON)
// ============================================================
      let activePreset = null;
      const sliderIdToParam = {
        "s-ingain": "input_gain_db",
        "s-peak": "target_peak",
        "s-thresh": "comp_threshold_db",
        "s-ratio": "comp_ratio",
        "s-cattack": "comp_attack_ms",
        "s-crelease": "comp_release_ms",
        "s-cmakeup": "comp_makeup_db",
        "s-glue-thresh": "glue_threshold_db",
        "s-glue-ratio": "glue_ratio",
        "s-glue-attack": "glue_attack_ms",
        "s-glue-release": "glue_release_ms",
        "s-glue-makeup": "glue_makeup_db",
        "s-hp": "hp_cutoff",
        "s-air": "high_shelf_gain_db",
        "s-shelf-freq": "high_shelf_freq_hz",
        "s-eq1freq": "eq1_freq",
        "s-eq1gain": "eq1_gain",
        "s-eq1q": "eq1_q",
        "s-eq2freq": "eq2_freq",
        "s-eq2gain": "eq2_gain",
        "s-eq2q": "eq2_q",
        "s-eq3freq": "eq3_freq",
        "s-eq3gain": "eq3_gain",
        "s-eq3q": "eq3_q",
        "s-eq4freq": "eq4_freq",
        "s-eq4gain": "eq4_gain",
        "s-eq4q": "eq4_q",
        "s-eq5freq": "eq5_freq",
        "s-eq5gain": "eq5_gain",
        "s-eq5q": "eq5_q",
        "s-eq6freq": "eq6_freq",
        "s-eq6gain": "eq6_gain",
        "s-eq6q": "eq6_q",
        "s-tatt": "transient_attack",
        "s-tsus": "transient_sustain",
        "s-satdrive": "saturation_drive",
        "s-satmix": "saturation_mix",
        "s-mgain": "mid_gain_db",
        "s-sgain": "side_gain_db",
        "s-width": "stereo_width_amount",
        "s-haas": "haas_delay_ms",
        "s-bassmono": "enhancer_bass_mono_freq",
        "s-rsize": "reverb_size",
        "s-rwet": "reverb_wet",
        "s-ceiling": "limiter_ceiling",
        "s-lrelease": "limiter_release_ms",
        "s-lufstarget": "target_lufs",
        // multiband
        "s-mb-lowx": "mb_low_crossover",
        "s-mb-highx": "mb_high_crossover",
        "s-mb-low-th": "mb_low_threshold_db",
        "s-mb-low-ratio": "mb_low_ratio",
        "s-mb-low-att": "mb_low_attack_ms",
        "s-mb-low-rel": "mb_low_release_ms",
        "s-mb-low-mu": "mb_low_makeup_db",
        "s-mb-mid-th": "mb_mid_threshold_db",
        "s-mb-mid-ratio": "mb_mid_ratio",
        "s-mb-mid-att": "mb_mid_attack_ms",
        "s-mb-mid-rel": "mb_mid_release_ms",
        "s-mb-mid-mu": "mb_mid_makeup_db",
        "s-mb-high-th": "mb_high_threshold_db",
        "s-mb-high-ratio": "mb_high_ratio",
        "s-mb-high-att": "mb_high_attack_ms",
        "s-mb-high-rel": "mb_high_release_ms",
        "s-mb-high-mu": "mb_high_makeup_db",
        "s-dyneq-freq": "dyneq_freq",
        "s-dyneq-q": "dyneq_q",
        "s-dyneq-thresh": "dyneq_threshold_db",
        "s-dyneq-ratio": "dyneq_ratio",
        "s-dyneq-attack": "dyneq_attack_ms",
        "s-dyneq-release": "dyneq_release_ms",
        "s-dyneq-maxred": "dyneq_max_reduction_db",
        "s-reso-freq": "reso_freq",
        "s-reso-q": "reso_q",
        "s-reso-thresh": "reso_threshold_db",
        "s-reso-ratio": "reso_ratio",
        "s-reso-attack": "reso_attack_ms",
        "s-reso-release": "reso_release_ms",
        "s-reso-maxred": "reso_max_reduction_db",
        "s-mono-freq": "low_end_mono_freq",
        "s-mono-amount": "low_end_mono_amount",
        "s-lp-taps": "linear_phase_taps",
        "s-mseq-mid-freq": "ms_mid_freq",
        "s-mseq-mid-gain": "ms_mid_gain",
        "s-mseq-mid-q": "ms_mid_q",
        "s-mseq-side-freq": "ms_side_freq",
        "s-mseq-side-gain": "ms_side_gain",
        "s-mseq-side-q": "ms_side_q",
        "s-mscomp-mid-thresh": "ms_comp_mid_threshold_db",
        "s-mscomp-mid-ratio": "ms_comp_mid_ratio",
        "s-mscomp-mid-attack": "ms_comp_mid_attack_ms",
        "s-mscomp-mid-release": "ms_comp_mid_release_ms",
        "s-mscomp-mid-makeup": "ms_comp_mid_makeup_db",
        "s-mscomp-side-thresh": "ms_comp_side_threshold_db",
        "s-mscomp-side-ratio": "ms_comp_side_ratio",
        "s-mscomp-side-attack": "ms_comp_side_attack_ms",
        "s-mscomp-side-release": "ms_comp_side_release_ms",
        "s-mscomp-side-makeup": "ms_comp_side_makeup_db",
      };

      window.LGMDM = window.LGMDM || {}; window.LGMDM.sliderIdToParam = sliderIdToParam;

      function applyPresetToUI(presetData) {
        Object.entries(sliderIdToParam).forEach(([sliderId, paramKey]) => {
          if (presetData[paramKey] == null) return;
          const el = document.getElementById(sliderId);
          if (!el) return;
          el.value = presetData[paramKey];
          el.dispatchEvent(new Event("input"));
        });
        if (presetData.use_lufs_normalize != null)
          LGMDM.dom.requireById("s-uselufs", "03-presets.js").checked = !!presetData.use_lufs_normalize;
        if (presetData.adaptive_loudness_weighting != null)
          LGMDM.dom.requireById("s-uselufs-adaptive", "03-presets.js").checked = !!presetData.adaptive_loudness_weighting;
        if (presetData.loudness_sensitivity_amount != null) {
          const pct = Math.round(parseFloat(presetData.loudness_sensitivity_amount) * 100);
          const el = LGMDM.dom.requireById("s-uselufs-sensitivity", "03-presets.js");
          if (el) { el.value = pct; LGMDM.dom.requireById("v-uselufs-sensitivity", "03-presets.js").textContent = pct + "%"; }
        }
        if (presetData.use_stereo_enhancer != null)
          LGMDM.dom.requireById("s-enhancer", "03-presets.js").checked = !!presetData.use_stereo_enhancer;
        if (presetData.comp_stereo_link != null)
          LGMDM.dom.requireById("s-comp-link", "03-presets.js").checked = !!presetData.comp_stereo_link;
        if (presetData.nr_bypass != null) LGMDM.dom.requireById("s-nr-bypass", "03-presets.js").checked = !!presetData.nr_bypass;
        if (presetData.nr_strength != null) {
          LGMDM.dom.requireById("s-nr-strength", "03-presets.js").value = presetData.nr_strength;
          LGMDM.dom.requireById("v-nr-strength", "03-presets.js").textContent = parseFloat(presetData.nr_strength).toFixed(2);
        }
        if (presetData.nr_noise_sample_sec != null) {
          LGMDM.dom.requireById("s-nr-noise-sample-sec", "03-presets.js").value = presetData.nr_noise_sample_sec;
          LGMDM.dom.requireById("v-nr-noise-sample-sec", "03-presets.js").textContent =
            parseFloat(presetData.nr_noise_sample_sec).toFixed(1) + "s";
        }
        if (presetData.parallel_bypass != null) {
          const cb = LGMDM.dom.requireById("parallelBypass", "03-presets.js");
          cb.checked = !!presetData.parallel_bypass;
          cb.dispatchEvent(new Event("change"));  // trigger visual dim
        }
        if (presetData.parallel_mix != null) {
          const el = LGMDM.dom.requireById("parallelMix", "03-presets.js");
          if (el) { el.value = presetData.parallel_mix; el.dispatchEvent(new Event("input")); }
        }
        if (presetData.parallel_threshold_db != null) {
          const el = LGMDM.dom.requireById("parallelThresh", "03-presets.js");
          if (el) { el.value = presetData.parallel_threshold_db; el.dispatchEvent(new Event("input")); }
        }
        if (presetData.glue_bypass != null) LGMDM.dom.requireById("s-glue-bypass", "03-presets.js").checked = !!presetData.glue_bypass;
        if (presetData.saturation_mode) LGMDM.dom.requireById("s-satmode", "03-presets.js").value = presetData.saturation_mode;
        if (presetData.oversample_mode) LGMDM.dom.requireById("s-oversample", "03-presets.js").value = presetData.oversample_mode;
        if (presetData.mb_bypass != null) LGMDM.dom.requireById("mb-bypass", "03-presets.js").checked = !!presetData.mb_bypass;
        if (presetData.dyneq_bypass != null)
          LGMDM.dom.requireById("s-dyneq-bypass", "03-presets.js").checked = !!presetData.dyneq_bypass;
        if (presetData.reso_bypass != null)
          LGMDM.dom.requireById("s-reso-bypass", "03-presets.js").checked = !!presetData.reso_bypass;
        // bandeada nunca se actualizaba al cargar un preset (mismo patrón
        // de bug que parallel_bypass/parallel_mix/parallel_threshold_db,
        // arreglado antes).
        if (presetData.ms_eq_bypass != null)
          LGMDM.dom.requireById("s-mseq-bypass", "03-presets.js").checked = !!presetData.ms_eq_bypass;
        if (presetData.ms_comp_bypass != null)
          LGMDM.dom.requireById("s-mscomp-bypass", "03-presets.js").checked = !!presetData.ms_comp_bypass;
        if (presetData.eq_mode) LGMDM.dom.requireById("s-eq-mode", "03-presets.js").value = presetData.eq_mode;
        drawEQCurve();
        window.LGMDM?.previewController?.request?.();
      }

      async function loadAndApplyPreset(name) {
        try {
          const res = await LGMDM.api.apiFetch(`${LGMDM.api.apiBase()}/preset/${name}`);
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          applyPresetToUI(data);
          activePreset = name;
          document
            .querySelectorAll(".preset-btn")
            .forEach((b) => b.classList.toggle("active", b.dataset.preset === name));
        } catch (e) {
          console.debug("Preset error:", e);
        }
      }
      document.querySelectorAll(".preset-btn").forEach((btn) => {
        btn.addEventListener("click", () => loadAndApplyPreset(btn.dataset.preset));
      });

      // ── Cargar preset desde archivo JSON ────────────────────────────────────────
      LGMDM.dom.requireById("btnLoadPresetJson", "03-presets.js")?.addEventListener("click", () => {
        LGMDM.dom.requireById("presetJsonInput", "03-presets.js").click();
      });
      LGMDM.dom.requireById("presetJsonInput", "03-presets.js")?.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        const statusEl = LGMDM.dom.requireById("presetLoadStatus", "03-presets.js");
        if (!file) return;
        statusEl.style.color = "var(--ui-muted)";
        statusEl.textContent = "Leyendo " + file.name + "…";
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          // admite tanto { params: {...} } / { settings: {...} } como el objeto plano de parámetros
          const presetData = data.params || data.settings || data;
          applyPresetToUI(presetData);
          document.querySelectorAll(".preset-btn.active").forEach((b) => b.classList.remove("active"));
          activePreset = data.name || file.name.replace(/\.json$/i, "");
          statusEl.style.color = "var(--ui-warn)";
          statusEl.textContent = `✓ Preset "${activePreset}" cargado desde JSON`;
        } catch (err) {
          console.debug("Error cargando preset JSON:", err);
          statusEl.style.color = "var(--ui-danger)";
          statusEl.textContent = "Error: JSON inválido o parámetros no reconocidos";
        } finally {
          e.target.value = "";
        }
      });
      ["input", "change"].forEach((evt) => {
        document.querySelectorAll(".param input[type=range], select, input[type=checkbox]").forEach((el) => {
          el.addEventListener(evt, () => {
            if (!el.dataset.fromPreset) {
              document.querySelectorAll(".preset-btn.active").forEach((b) => b.classList.remove("active"));
              activePreset = null;
            }
          });
        });
      });

      // Targets de loudness por plataforma — debe coincidir con
      // PLATFORM_LOUDNESS_TARGETS en mastering.py (backend). Se usa para
      // auto-configurar la normalización LUFS al elegir una plataforma:
      // antes, elegir "Apple Music (−16 LUFS)" en el combo solo ajustaba el
      // techo del limiter (true_peak_db) — el checkbox "Normalizar por LUFS"
      // y su target quedaban totalmente desconectados del selector, así que
      // el loudness real del master nunca terminaba de acercarse al target
      // que la propia etiqueta del combo prometía.
      const PLATFORM_LUFS_TARGETS = {
        spotify: -14.0,
        youtube: -14.0,
        apple_music: -16.0,
        tidal: -14.0,
        club: -9.0,
        cd: -9.0,
      };
      LGMDM.dom.requireById("s-platform", "03-presets.js")?.addEventListener("change", (e) => {
        const lufsTarget = PLATFORM_LUFS_TARGETS[e.target.value];
        if (lufsTarget == null) return; // "— Manual —": no tocar la config existente
        const lufsSlider = LGMDM.dom.requireById("s-lufstarget", "03-presets.js");
        lufsSlider.value = lufsTarget;
        lufsSlider.dispatchEvent(new Event("input", { bubbles: true }));
        const useLufsChk = LGMDM.dom.requireById("s-uselufs", "03-presets.js");
        if (!useLufsChk.checked) {
          useLufsChk.checked = true;
          useLufsChk.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      LGMDM.dom.requireById("s-platform", "03-presets.js")?.addEventListener("change", () => window.LGMDM?.previewController?.request?.());

      // ── File handling ────────────────────────────────────────────────────────────
