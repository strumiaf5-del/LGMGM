// ============================================================
// 06-params-builder.js — Armado de parámetros y vista previa antes de masterizar
// ============================================================
(function () {
      function getParamVal(id) {
        const el = LGMDM.dom.requireById(id, "06-params-builder.js");
        return (el.dataset && el.dataset.consoleSaved != null) ? el.dataset.consoleSaved : el.value;
      }
      function collectMasterParamsObj() {
        const platform = LGMDM.dom.requireById("s-platform", "06-params-builder.js").value;
        const obj = {
          input_gain_db: LGMDM.dom.requireById("s-ingain", "06-params-builder.js").value,
          target_peak: LGMDM.dom.requireById("s-peak", "06-params-builder.js").value,
          use_lufs_normalize: LGMDM.dom.requireById("s-uselufs", "06-params-builder.js").checked,
          target_lufs: LGMDM.dom.requireById("s-lufstarget", "06-params-builder.js").value,
          // MEJORA: LUFS adaptativo a la sensibilidad del oído humano (ISO 226),
          // el mismo mecanismo que ya existía solo para reference matching
          // (ver 08-reference-mastering.js) — ahora también disponible acá.
          adaptive_loudness_weighting: LGMDM.dom.byId("s-uselufs-adaptive")?.checked ?? false,
          loudness_sensitivity_amount: ((parseFloat(LGMDM.dom.byId("s-uselufs-sensitivity")?.value || "65") / 100)).toFixed(2),
          comp_threshold_db: getParamVal("s-thresh"),
          comp_ratio: getParamVal("s-ratio"),
          comp_attack_ms: LGMDM.dom.requireById("s-cattack", "06-params-builder.js").value,
          comp_release_ms: LGMDM.dom.requireById("s-crelease", "06-params-builder.js").value,
          comp_makeup_db: LGMDM.dom.requireById("s-cmakeup", "06-params-builder.js").value,
          comp_pdr: LGMDM.dom.requireById("s-comp-pdr", "06-params-builder.js").checked,
          comp_pdr_hold_ms: LGMDM.dom.requireById("s-comp-pdr-hold", "06-params-builder.js").value,
          comp_stereo_link: LGMDM.dom.requireById("s-comp-link", "06-params-builder.js").checked,
          oversample_mode: LGMDM.dom.requireById("s-oversample", "06-params-builder.js").value,
          nr_bypass: LGMDM.dom.requireById("s-nr-bypass", "06-params-builder.js").checked,
          nr_strength: LGMDM.dom.requireById("s-nr-strength", "06-params-builder.js").value,
          nr_noise_sample_sec: LGMDM.dom.requireById("s-nr-noise-sample-sec", "06-params-builder.js").value,
          glue_bypass: LGMDM.dom.requireById("s-glue-bypass", "06-params-builder.js").checked,
          glue_threshold_db: LGMDM.dom.requireById("s-glue-thresh", "06-params-builder.js").value,
          glue_ratio: LGMDM.dom.requireById("s-glue-ratio", "06-params-builder.js").value,
          glue_attack_ms: LGMDM.dom.requireById("s-glue-attack", "06-params-builder.js").value,
          glue_release_ms: LGMDM.dom.requireById("s-glue-release", "06-params-builder.js").value,
          glue_makeup_db: LGMDM.dom.requireById("s-glue-makeup", "06-params-builder.js").value,
          glue_pdr: LGMDM.dom.requireById("s-glue-pdr", "06-params-builder.js").checked,
          glue_pdr_hold_ms: LGMDM.dom.requireById("s-glue-pdr-hold", "06-params-builder.js").value,
          clipper_bypass: LGMDM.dom.requireById("s-clip-bypass", "06-params-builder.js").checked,
          clipper_mode: LGMDM.dom.requireById("s-clip-mode", "06-params-builder.js").value,
          clipper_ceiling: LGMDM.dom.requireById("s-clip-ceiling", "06-params-builder.js").value,
          clipper_drive_db: LGMDM.dom.requireById("s-clip-drive", "06-params-builder.js").value,
          hp_cutoff: LGMDM.dom.requireById("s-hp", "06-params-builder.js").value,
          lp_bypass: LGMDM.dom.requireById("s-lp-bypass", "06-params-builder.js").checked,
          lp_cutoff: LGMDM.dom.requireById("s-lp-cutoff", "06-params-builder.js").value,
          high_shelf_gain_db: LGMDM.dom.requireById("s-air", "06-params-builder.js").value,
          high_shelf_freq_hz: LGMDM.dom.requireById("s-shelf-freq", "06-params-builder.js").value,
          low_shelf_gain_db: LGMDM.dom.requireById("s-lowshelf", "06-params-builder.js").value,
          low_shelf_freq_hz: LGMDM.dom.requireById("s-lowshelf-freq", "06-params-builder.js").value,
          eq1_freq: LGMDM.dom.requireById("s-eq1freq", "06-params-builder.js").value,
          eq1_gain: LGMDM.dom.requireById("s-eq1gain", "06-params-builder.js").value,
          eq1_q: LGMDM.dom.requireById("s-eq1q", "06-params-builder.js").value,
          eq2_freq: LGMDM.dom.requireById("s-eq2freq", "06-params-builder.js").value,
          eq2_gain: LGMDM.dom.requireById("s-eq2gain", "06-params-builder.js").value,
          eq2_q: LGMDM.dom.requireById("s-eq2q", "06-params-builder.js").value,
          eq3_freq: LGMDM.dom.requireById("s-eq3freq", "06-params-builder.js").value,
          eq3_gain: LGMDM.dom.requireById("s-eq3gain", "06-params-builder.js").value,
          eq3_q: LGMDM.dom.requireById("s-eq3q", "06-params-builder.js").value,
          eq4_freq: LGMDM.dom.requireById("s-eq4freq", "06-params-builder.js").value,
          eq4_gain: LGMDM.dom.requireById("s-eq4gain", "06-params-builder.js").value,
          eq4_q: LGMDM.dom.requireById("s-eq4q", "06-params-builder.js").value,
          eq5_freq: LGMDM.dom.requireById("s-eq5freq", "06-params-builder.js").value,
          eq5_gain: LGMDM.dom.requireById("s-eq5gain", "06-params-builder.js").value,
          eq5_q: LGMDM.dom.requireById("s-eq5q", "06-params-builder.js").value,
          eq6_freq: LGMDM.dom.requireById("s-eq6freq", "06-params-builder.js").value,
          eq6_gain: LGMDM.dom.requireById("s-eq6gain", "06-params-builder.js").value,
          eq6_q: LGMDM.dom.requireById("s-eq6q", "06-params-builder.js").value,
          transient_attack: LGMDM.dom.requireById("s-tatt", "06-params-builder.js").value,
          transient_sustain: LGMDM.dom.requireById("s-tsus", "06-params-builder.js").value,
          saturation_drive: LGMDM.dom.requireById("s-satdrive", "06-params-builder.js").value,
          saturation_mode: LGMDM.dom.requireById("s-satmode", "06-params-builder.js").value,
          saturation_mix: LGMDM.dom.requireById("s-satmix", "06-params-builder.js").value,
          mid_gain_db: LGMDM.dom.requireById("s-mgain", "06-params-builder.js").value,
          side_gain_db: LGMDM.dom.requireById("s-sgain", "06-params-builder.js").value,
          stereo_width_amount: getParamVal("s-width"),
          use_stereo_enhancer: LGMDM.dom.requireById("s-enhancer", "06-params-builder.js").checked,
          haas_delay_ms: LGMDM.dom.requireById("s-haas", "06-params-builder.js").value,
          enhancer_bass_mono_freq: LGMDM.dom.requireById("s-bassmono", "06-params-builder.js").value,
          reverb_size: LGMDM.dom.requireById("s-rsize", "06-params-builder.js").value,
          reverb_wet: LGMDM.dom.requireById("s-rwet", "06-params-builder.js").value,
          limiter_ceiling: getParamVal("s-ceiling"),
          limiter_release_ms: LGMDM.dom.requireById("s-lrelease", "06-params-builder.js").value,
          output_format: LGMDM.dom.requireById("s-format", "06-params-builder.js").value,
          output_bit_depth: LGMDM.dom.requireById("s-bitdepth", "06-params-builder.js").value,
          dither_mode: LGMDM.dom.requireById("s-dither-mode", "06-params-builder.js").value,
          // multiband
          mb_low_crossover: LGMDM.dom.requireById("s-mb-lowx", "06-params-builder.js").value,
          mb_high_crossover: LGMDM.dom.requireById("s-mb-highx", "06-params-builder.js").value,
          mb_low_threshold_db: LGMDM.dom.requireById("s-mb-low-th", "06-params-builder.js").value,
          mb_low_ratio: LGMDM.dom.requireById("s-mb-low-ratio", "06-params-builder.js").value,
          mb_low_attack_ms: LGMDM.dom.requireById("s-mb-low-att", "06-params-builder.js").value,
          mb_low_release_ms: LGMDM.dom.requireById("s-mb-low-rel", "06-params-builder.js").value,
          mb_low_makeup_db: LGMDM.dom.requireById("s-mb-low-mu", "06-params-builder.js").value,
          mb_mid_threshold_db: LGMDM.dom.requireById("s-mb-mid-th", "06-params-builder.js").value,
          mb_mid_ratio: LGMDM.dom.requireById("s-mb-mid-ratio", "06-params-builder.js").value,
          mb_mid_attack_ms: LGMDM.dom.requireById("s-mb-mid-att", "06-params-builder.js").value,
          mb_mid_release_ms: LGMDM.dom.requireById("s-mb-mid-rel", "06-params-builder.js").value,
          mb_mid_makeup_db: LGMDM.dom.requireById("s-mb-mid-mu", "06-params-builder.js").value,
          mb_high_threshold_db: LGMDM.dom.requireById("s-mb-high-th", "06-params-builder.js").value,
          mb_high_ratio: LGMDM.dom.requireById("s-mb-high-ratio", "06-params-builder.js").value,
          mb_high_attack_ms: LGMDM.dom.requireById("s-mb-high-att", "06-params-builder.js").value,
          mb_high_release_ms: LGMDM.dom.requireById("s-mb-high-rel", "06-params-builder.js").value,
          mb_high_makeup_db: LGMDM.dom.requireById("s-mb-high-mu", "06-params-builder.js").value,
          mb_pdr: LGMDM.dom.requireById("s-mb-pdr", "06-params-builder.js").checked,
          mb_pdr_hold_ms: LGMDM.dom.requireById("s-mb-pdr-hold", "06-params-builder.js").value,
          mb_bypass: LGMDM.dom.requireById("mb-bypass", "06-params-builder.js").checked,
          // Multiband Stereo Width
          mb_stereo_bypass: LGMDM.dom.requireById("mb-stereo-bypass", "06-params-builder.js").checked,
          mb_stereo_low_width: LGMDM.dom.requireById("s-mb-sw-low", "06-params-builder.js").value,
          mb_stereo_mid_width: LGMDM.dom.requireById("s-mb-sw-mid", "06-params-builder.js").value,
          mb_stereo_high_width: LGMDM.dom.requireById("s-mb-sw-high", "06-params-builder.js").value,
          mb_stereo_low_crossover: LGMDM.dom.requireById("s-mb-sw-lowx", "06-params-builder.js").value,
          mb_stereo_high_crossover: LGMDM.dom.requireById("s-mb-sw-highx", "06-params-builder.js").value,
        };
        // Master console overrides (A/B + per-stage bypass)
        const consoleOverrides = window.LGMDM?.console?.getChainOverrides?.() || {};
        Object.assign(obj, consoleOverrides);
        // Dynamic EQ
        obj.parallel_bypass = LGMDM.dom.requireById("parallelBypass", "06-params-builder.js").checked;
        obj.parallel_mix = LGMDM.dom.requireById("parallelMix", "06-params-builder.js").value;
        obj.parallel_threshold_db = LGMDM.dom.requireById("parallelThresh", "06-params-builder.js").value;
        obj.parallel_ratio = LGMDM.dom.requireById("parallelRatio", "06-params-builder.js").value;
        obj.parallel_attack_ms = LGMDM.dom.requireById("parallelAttack", "06-params-builder.js").value;
        obj.parallel_release_ms = LGMDM.dom.requireById("parallelRelease", "06-params-builder.js").value;
        obj.ms_eq_bypass = LGMDM.dom.requireById("s-mseq-bypass", "06-params-builder.js").checked;
        obj.ms_mid_freq = LGMDM.dom.requireById("s-mseq-mid-freq", "06-params-builder.js").value;
        obj.ms_mid_gain = LGMDM.dom.requireById("s-mseq-mid-gain", "06-params-builder.js").value;
        obj.ms_mid_q = LGMDM.dom.requireById("s-mseq-mid-q", "06-params-builder.js").value;
        obj.ms_side_freq = LGMDM.dom.requireById("s-mseq-side-freq", "06-params-builder.js").value;
        obj.ms_side_gain = LGMDM.dom.requireById("s-mseq-side-gain", "06-params-builder.js").value;
        obj.ms_side_q = LGMDM.dom.requireById("s-mseq-side-q", "06-params-builder.js").value;
        obj.ms_comp_bypass = LGMDM.dom.requireById("s-mscomp-bypass", "06-params-builder.js").checked;
        obj.ms_comp_mid_threshold_db = LGMDM.dom.requireById("s-mscomp-mid-thresh", "06-params-builder.js").value;
        obj.ms_comp_mid_ratio = LGMDM.dom.requireById("s-mscomp-mid-ratio", "06-params-builder.js").value;
        obj.ms_comp_mid_attack_ms = LGMDM.dom.requireById("s-mscomp-mid-attack", "06-params-builder.js").value;
        obj.ms_comp_mid_release_ms = LGMDM.dom.requireById("s-mscomp-mid-release", "06-params-builder.js").value;
        obj.ms_comp_mid_makeup_db = LGMDM.dom.requireById("s-mscomp-mid-makeup", "06-params-builder.js").value;
        obj.ms_comp_side_threshold_db = LGMDM.dom.requireById("s-mscomp-side-thresh", "06-params-builder.js").value;
        obj.ms_comp_side_ratio = LGMDM.dom.requireById("s-mscomp-side-ratio", "06-params-builder.js").value;
        obj.ms_comp_side_attack_ms = LGMDM.dom.requireById("s-mscomp-side-attack", "06-params-builder.js").value;
        obj.ms_comp_side_release_ms = LGMDM.dom.requireById("s-mscomp-side-release", "06-params-builder.js").value;
        obj.ms_comp_side_makeup_db = LGMDM.dom.requireById("s-mscomp-side-makeup", "06-params-builder.js").value;
        obj.ms_comp_pdr = LGMDM.dom.requireById("s-mscomp-pdr", "06-params-builder.js").checked;
        obj.ms_comp_pdr_hold_ms = LGMDM.dom.requireById("s-mscomp-pdr-hold", "06-params-builder.js").value;
        obj.dyneq_bypass = LGMDM.dom.requireById("s-dyneq-bypass", "06-params-builder.js").checked;
        obj.dyneq_freq = LGMDM.dom.requireById("s-dyneq-freq", "06-params-builder.js").value;
        obj.dyneq_q = LGMDM.dom.requireById("s-dyneq-q", "06-params-builder.js").value;
        obj.dyneq_threshold_db = LGMDM.dom.requireById("s-dyneq-thresh", "06-params-builder.js").value;
        obj.dyneq_ratio = LGMDM.dom.requireById("s-dyneq-ratio", "06-params-builder.js").value;
        obj.dyneq_attack_ms = LGMDM.dom.requireById("s-dyneq-attack", "06-params-builder.js").value;
        obj.dyneq_release_ms = LGMDM.dom.requireById("s-dyneq-release", "06-params-builder.js").value;
        obj.dyneq_max_reduction_db = LGMDM.dom.requireById("s-dyneq-maxred", "06-params-builder.js").value;
        // Dynamic EQ — banda de resonancias (etapa 3)
        obj.reso_bypass = LGMDM.dom.requireById("s-reso-bypass", "06-params-builder.js").checked;
        obj.reso_freq = LGMDM.dom.requireById("s-reso-freq", "06-params-builder.js").value;
        obj.reso_q = LGMDM.dom.requireById("s-reso-q", "06-params-builder.js").value;
        obj.reso_threshold_db = LGMDM.dom.requireById("s-reso-thresh", "06-params-builder.js").value;
        obj.reso_ratio = LGMDM.dom.requireById("s-reso-ratio", "06-params-builder.js").value;
        obj.reso_attack_ms = LGMDM.dom.requireById("s-reso-attack", "06-params-builder.js").value;
        obj.reso_release_ms = LGMDM.dom.requireById("s-reso-release", "06-params-builder.js").value;
        obj.reso_max_reduction_db = LGMDM.dom.requireById("s-reso-maxred", "06-params-builder.js").value;
        // Low-End Mono Maker
        obj.low_end_mono_freq = LGMDM.dom.requireById("s-mono-freq", "06-params-builder.js").value;
        obj.low_end_mono_amount = LGMDM.dom.requireById("s-mono-amount", "06-params-builder.js").value;
        // EQ Mode
        obj.eq_mode = LGMDM.dom.requireById("s-eq-mode", "06-params-builder.js").value;
        obj.linear_phase_taps = LGMDM.dom.requireById("s-lp-taps", "06-params-builder.js").value;
        obj.tonal_balance_bypass = LGMDM.dom.requireById("s-tonalbal-bypass", "06-params-builder.js").checked;
        obj.tonal_balance_amount = LGMDM.dom.requireById("s-tonalbal-amount", "06-params-builder.js").value;
        obj.tonal_balance_max_boost_db = LGMDM.dom.requireById("s-tonalbal-boost", "06-params-builder.js").value;
        obj.tonal_balance_max_cut_db = LGMDM.dom.requireById("s-tonalbal-cut", "06-params-builder.js").value;
        obj.tonal_balance_max_bands = LGMDM.dom.requireById("s-tonalbal-bands", "06-params-builder.js").value;
        const platformTargetVal = LGMDM.dom.requireById("s-platform", "06-params-builder.js")?.value || "";
        if (platformTargetVal) obj.platform_target = platformTargetVal;
        // FIX G: arrancar preview desde segundo 30 del track (no desde el
        // segundo 15 default). Backend ya soporta este parámetro en
        // POST /preview (routers/preview.py:188-189). Si en el futuro se
        // quiere parametrizable, mover a un slider en la UI.
        obj.preview_start_sec = 30;
        return obj;
      }
      function buildParams() {
        const obj = collectMasterParamsObj();
        // URLSearchParams convierte null/undefined en el string literal "null"/"undefined",
        // lo cual rompe la validación de FastAPI (pattern regex). Se filtran esos valores
        // para que el backend reciba el parámetro directamente omitido y use su default.
        Object.keys(obj).forEach((k) => {
          if (obj[k] === null || obj[k] === undefined) delete obj[k];
        });
        return new URLSearchParams(obj);
      }

      // ── Vista previa de parámetros corregidos antes de masterizar ───────────────
      const PARAM_PREVIEW_GROUPS = [
        {
          title: "Entrada / Loudness",
          keys: ["input_gain_db", "target_peak", "use_lufs_normalize", "target_lufs",
                 "adaptive_loudness_weighting", "loudness_sensitivity_amount", "platform_target"],
        },
        {
          title: "Compresor",
          keys: [
            "comp_threshold_db",
            "comp_ratio",
            "comp_attack_ms",
            "comp_release_ms",
            "comp_makeup_db",
            "comp_pdr",
            "comp_pdr_hold_ms",
            "comp_stereo_link",
            "oversample_mode",
          ],
        },
        {
          title: "EQ",
          keys: [
            "hp_cutoff",
            "high_shelf_gain_db",
            "high_shelf_freq_hz",
            "low_shelf_gain_db",
            "low_shelf_freq_hz",
            "eq1_freq",
            "eq1_gain",
            "eq1_q",
            "eq2_freq",
            "eq2_gain",
            "eq2_q",
            "eq3_freq",
            "eq3_gain",
            "eq3_q",
            "eq4_freq",
            "eq4_gain",
            "eq4_q",
            "eq5_freq",
            "eq5_gain",
            "eq5_q",
            "eq6_freq",
            "eq6_gain",
            "eq6_q",
          ],
        },
        {
          title: "Transient / Saturación",
          keys: ["transient_attack", "transient_sustain", "saturation_drive", "saturation_mode", "saturation_mix"],
        },
        {
          title: "Estéreo",
          keys: [
            "mid_gain_db",
            "side_gain_db",
            "stereo_width_amount",
            "use_stereo_enhancer",
            "haas_delay_ms",
            "enhancer_bass_mono_freq",
          ],
        },
        {
          title: "Glue Compressor",
          keys: [
            "glue_bypass",
            "glue_threshold_db",
            "glue_ratio",
            "glue_attack_ms",
            "glue_release_ms",
            "glue_makeup_db",
            "glue_pdr",
            "glue_pdr_hold_ms",
          ],
        },
        {
          title: "Reverb / Limiter / Salida",
          keys: [
            "reverb_size",
            "reverb_wet",
            "limiter_ceiling",
            "limiter_release_ms",
            "output_format",
            "output_bit_depth",
          ],
        },
        {
          title: "Multibanda — Compresión",
          keys: [
            "mb_bypass",
            "mb_low_crossover",
            "mb_high_crossover",
            "mb_low_threshold_db",
            "mb_low_ratio",
            "mb_low_attack_ms",
            "mb_low_release_ms",
            "mb_low_makeup_db",
            "mb_mid_threshold_db",
            "mb_mid_ratio",
            "mb_mid_attack_ms",
            "mb_mid_release_ms",
            "mb_mid_makeup_db",
            "mb_high_threshold_db",
            "mb_high_ratio",
            "mb_high_attack_ms",
            "mb_high_release_ms",
            "mb_high_makeup_db",
            "mb_pdr",
            "mb_pdr_hold_ms",
          ],
        },
        {
          title: "Multibanda — Ancho estéreo",
          keys: [
            "mb_stereo_bypass",
            "mb_stereo_low_width",
            "mb_stereo_mid_width",
            "mb_stereo_high_width",
            "mb_stereo_low_crossover",
            "mb_stereo_high_crossover",
          ],
        },
        {
          title: "Dynamic EQ / De-esser",
          keys: [
            "dyneq_bypass",
            "dyneq_freq",
            "dyneq_q",
            "dyneq_threshold_db",
            "dyneq_ratio",
            "dyneq_attack_ms",
            "dyneq_release_ms",
            "dyneq_max_reduction_db",
          ],
        },
        {
          title: "Dynamic EQ / Resonancias",
          keys: [
            "reso_bypass",
            "reso_freq",
            "reso_q",
            "reso_threshold_db",
            "reso_ratio",
            "reso_attack_ms",
            "reso_release_ms",
            "reso_max_reduction_db",
          ],
        },
        { title: "Low-End Mono Maker", keys: ["low_end_mono_freq", "low_end_mono_amount"] },
        {
          title: "EQ Mid/Side",
          keys: [
            "ms_eq_bypass", "ms_mid_freq", "ms_mid_gain", "ms_mid_q", "ms_side_freq", "ms_side_gain", "ms_side_q",
            "ms_comp_bypass",
            "ms_comp_mid_threshold_db", "ms_comp_mid_ratio", "ms_comp_mid_attack_ms",
            "ms_comp_mid_release_ms", "ms_comp_mid_makeup_db",
            "ms_comp_side_threshold_db", "ms_comp_side_ratio", "ms_comp_side_attack_ms",
            "ms_comp_side_release_ms", "ms_comp_side_makeup_db",
            "ms_comp_pdr", "ms_comp_pdr_hold_ms",
          ],
        },
        { title: "Modo EQ", keys: ["eq_mode", "linear_phase_taps"] },
      ];
      const PARAM_LABELS = {
        input_gain_db: "Ganancia entrada (dB)",
        target_peak: "Peak objetivo",
        use_lufs_normalize: "Normalizar LUFS",
        target_lufs: "LUFS objetivo",
        adaptive_loudness_weighting: "LUFS adaptativo al oído",
        loudness_sensitivity_amount: "Sensibilidad auditiva 3-6kHz",
        platform_target: "Plataforma",
        comp_threshold_db: "Threshold (dB)",
        comp_ratio: "Ratio",
        comp_attack_ms: "Attack",
        comp_release_ms: "Release",
        comp_makeup_db: "Makeup",
        comp_pdr: "PDR (banda ancha)",
        comp_pdr_hold_ms: "PDR Hold (banda ancha)",
        comp_stereo_link: "Stereo link L/R",
        oversample_mode: "Oversampling",
        hp_cutoff: "High-pass (Hz)",
        high_shelf_gain_db: "Shelf ganancia (dB)",
        high_shelf_freq_hz: "Shelf freq (Hz)",
        low_shelf_gain_db: "Low shelf ganancia (dB)",
        low_shelf_freq_hz: "Low shelf freq (Hz)",
        eq1_freq: "EQ1 freq",
        eq1_gain: "EQ1 ganancia",
        eq1_q: "EQ1 Q",
        eq2_freq: "EQ2 freq",
        eq2_gain: "EQ2 ganancia",
        eq2_q: "EQ2 Q",
        eq3_freq: "EQ3 freq",
        eq3_gain: "EQ3 ganancia",
        eq3_q: "EQ3 Q",
        eq4_freq: "EQ4 freq",
        eq4_gain: "EQ4 ganancia",
        eq4_q: "EQ4 Q",
        eq5_freq: "EQ5 freq",
        eq5_gain: "EQ5 ganancia",
        eq5_q: "EQ5 Q",
        eq6_freq: "EQ6 freq",
        eq6_gain: "EQ6 ganancia",
        eq6_q: "EQ6 Q",
        transient_attack: "Transient attack",
        transient_sustain: "Transient sustain",
        saturation_drive: "Saturación drive",
        saturation_mode: "Saturación modo",
        saturation_mix: "Saturación mix",
        mid_gain_db: "Mid gain (dB)",
        side_gain_db: "Side gain (dB)",
        stereo_width_amount: "Ancho estéreo",
        use_stereo_enhancer: "Stereo enhancer",
        haas_delay_ms: "Haas delay (ms)",
        enhancer_bass_mono_freq: "Bass mono freq",
        nr_bypass: "Bypass noise reduction",
        nr_strength: "Intensidad NR",
        nr_noise_sample_sec: "Muestra ruido (s)",
        glue_bypass: "Bypass glue",
        glue_threshold_db: "Threshold (dB)",
        glue_ratio: "Ratio",
        glue_attack_ms: "Attack",
        glue_release_ms: "Release",
        glue_makeup_db: "Makeup",
        glue_pdr: "PDR (glue)",
        glue_pdr_hold_ms: "PDR Hold (glue)",
        reverb_size: "Reverb tamaño",
        reverb_wet: "Reverb wet",
        limiter_ceiling: "Limiter ceiling",
        limiter_release_ms: "Limiter release (ms)",
        output_format: "Formato salida",
        output_bit_depth: "Bit depth",
        dither_mode: "Modo de dither",
        mb_bypass: "Bypass multibanda",
        mb_low_crossover: "Cruce low (Hz)",
        mb_high_crossover: "Cruce high (Hz)",
        mb_low_threshold_db: "Low threshold (dB)",
        mb_low_ratio: "Low ratio",
        mb_low_attack_ms: "Low attack",
        mb_low_release_ms: "Low release",
        mb_low_makeup_db: "Low makeup",
        mb_mid_threshold_db: "Mid threshold (dB)",
        mb_mid_ratio: "Mid ratio",
        mb_mid_attack_ms: "Mid attack",
        mb_mid_release_ms: "Mid release",
        mb_mid_makeup_db: "Mid makeup",
        mb_high_threshold_db: "High threshold (dB)",
        mb_high_ratio: "High ratio",
        mb_high_attack_ms: "High attack",
        mb_high_release_ms: "High release",
        mb_high_makeup_db: "High makeup",
        mb_pdr: "PDR (multibanda)",
        mb_pdr_hold_ms: "PDR Hold (multibanda)",
        mb_stereo_bypass: "Bypass ancho MB",
        mb_stereo_low_width: "Ancho low",
        mb_stereo_mid_width: "Ancho mid",
        mb_stereo_high_width: "Ancho high",
        dyneq_bypass: "Bypass Dynamic EQ",
        dyneq_freq: "Freq (Hz)",
        dyneq_q: "Q",
        dyneq_threshold_db: "Threshold (dB)",
        dyneq_ratio: "Ratio",
        dyneq_attack_ms: "Attack (ms)",
        dyneq_release_ms: "Release (ms)",
        dyneq_max_reduction_db: "Reducción máx. (dB)",
        reso_bypass: "Bypass Resonancias",
        reso_freq: "Freq (Hz)",
        reso_q: "Q",
        reso_threshold_db: "Threshold (dB)",
        reso_ratio: "Ratio",
        reso_attack_ms: "Attack (ms)",
        reso_release_ms: "Release (ms)",
        reso_max_reduction_db: "Reducción máx. (dB)",
        low_end_mono_freq: "Corte mono (Hz)",
        low_end_mono_amount: "Cantidad mono",
        ms_eq_bypass: "Bypass EQ M/S",
        ms_mid_freq: "Mid freq (Hz)",
        ms_mid_gain: "Mid ganancia",
        ms_mid_q: "Mid Q",
        ms_side_freq: "Side freq (Hz)",
        ms_side_gain: "Side ganancia",
        ms_side_q: "Side Q",
        ms_comp_bypass: "Bypass Comp M/S",
        ms_comp_mid_threshold_db: "Mid threshold (dB)",
        ms_comp_mid_ratio: "Mid ratio",
        ms_comp_mid_attack_ms: "Mid attack",
        ms_comp_mid_release_ms: "Mid release",
        ms_comp_mid_makeup_db: "Mid makeup",
        ms_comp_side_threshold_db: "Side threshold (dB)",
        ms_comp_side_ratio: "Side ratio",
        ms_comp_side_attack_ms: "Side attack",
        ms_comp_side_release_ms: "Side release",
        ms_comp_side_makeup_db: "Side makeup",
        ms_comp_pdr: "PDR (M/S)",
        ms_comp_pdr_hold_ms: "PDR Hold (M/S)",
        eq_mode: "Modo EQ",
        linear_phase_taps: "FIR Taps",
        mb_stereo_low_crossover: "Cruce low (Hz)",
        mb_stereo_high_crossover: "Cruce high (Hz)",
      };
      const DITHER_MODE_LABELS = { tpdf: "TPDF plano", high_shelf: "High-shelf", f_weighted: "F-weighted" };
      function formatParamValue(v, key) {
        if (key === "dither_mode") return DITHER_MODE_LABELS[v] || v;
        if (Array.isArray(v)) {
          if (key === "band_gains_array") {
            const activas = v.filter((b) => b && b.gain_db && Math.abs(b.gain_db) > 0).length;
            return `${v.length} bandas (${activas} con ganancia)`;
          }
          return `${v.length} elementos`;
        }
        const n = parseFloat(v);
        if (key && key.includes("ratio") && !Number.isNaN(n)) return `Ratio ${n.toFixed(1)}:1`;
        if (key && key.includes("threshold_db") && !Number.isNaN(n)) return `Threshold ${formatDbValue(n)}`;
        if (key && key.includes("attack_ms") && !Number.isNaN(n)) return `Attack ${n.toFixed(1)} ms`;
        if (key && key.includes("release_ms") && !Number.isNaN(n)) return `Release ${Math.round(n)} ms`;
        if (key && key.includes("makeup_db") && !Number.isNaN(n))
          return `Makeup ${n >= 0 ? "+" : ""}${n.toFixed(1)} dB`;
        if (v === true) return "Sí";
        if (v === false) return "No";
        if (v === "" || v == null) return "—";
        return v;
      }

      function renderParamsPreview(
        paramsObj,
        {
          onConfirm,
          onCancel,
          confirmLabel = "✅ Confirmar y masterizar",
          readOnly = false,
          title = "🔎 Parámetros corregidos — revisá antes de masterizar",
        } = {},
      ) {
        // BUGFIX: getContent() devuelve #analysisDynamicContent (dentro del tab
        // Analysis). Si el usuario está en el tab Console al clickear MASTER, el
        // modal aparece en un tab oculto y no se ve. Renderizamos en el workspace
        // activo (console/analysis/presets) o caemos a body si no hay ninguno.
        const activeWs = document.querySelector('.lg-workspace-workspace.active')
          || document.querySelector('.lg-workspace-workspace:not([hidden])');
        const container = activeWs || document.body;
        const oldPanel = container.querySelector(".params-preview");
        if (oldPanel) oldPanel.remove();

        const panel = document.createElement("div");
        panel.className = "params-preview";
        let html = `<h3>${LGMDM.ui.escapeHtml(title)}</h3>`;
        PARAM_PREVIEW_GROUPS.forEach((group) => {
          const items = group.keys.filter((k) => paramsObj[k] !== undefined);
          if (!items.length) return;
          html += `<div class="pp-group"><div class="pp-group-title">${LGMDM.ui.escapeHtml(group.title)}</div><div class="pp-grid">`;
          items.forEach((k) => {
            html += `<div class="pp-item"><span>${LGMDM.ui.escapeHtml(PARAM_LABELS[k] || k)}</span><span>${LGMDM.ui.escapeHtml(formatParamValue(paramsObj[k], k))}</span></div>`;
          });
          html += `</div></div>`;
        });
        if (!readOnly) {
          html += `<div class="pp-actions">
      <button class="btn btn-secondary" id="ppCancelBtn">✕ Cancelar</button>
      <button class="btn btn-primary" id="ppConfirmBtn">${LGMDM.ui.escapeHtml(confirmLabel)}</button>
    </div>`;
        }
        panel.innerHTML = html;
        container.prepend(panel);
        if (!readOnly) {
          panel.querySelector("#ppConfirmBtn").addEventListener("click", () => {
            panel.remove();
            onConfirm && onConfirm();
          });
          panel.querySelector("#ppCancelBtn").addEventListener("click", () => {
            panel.remove();
            onCancel && onCancel();
          });
        }
        return panel;
      }

(function(){ const LG=window.LGMDM=window.LGMDM||{}; LG.params=Object.assign(LG.params||{}, { collect: collectMasterParamsObj, build: buildParams, renderPreview: renderParamsPreview }); })();

})();
