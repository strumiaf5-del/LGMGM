# Auditoría de Audio Skills — LGMDM

> **Fecha:** 2026-09-27
> **Directorio auditado:** `/root/.local/share/opencode/worktree/b96bf5/fede` (todo el código)
> **Modo:** 6 agentes en paralelo, cada uno con un skill único, READ-ONLY sobre backend
> **Reglas seguidas:** AGENTS.md (distinguir VERIFICADO/ASUMIDO/NO VERIFICADO, citar file:line, no afirmar sin comando, no inventar)
> **Archivo exento de OKI** según AGENTS.md §5 (`AUDITORIA-*.md`).

---

## Índice

1. [Resumen ejecutivo](#resumen-ejecutivo)
2. [Hallazgos cruzados (bugs confirmados por múltiples agentes)](#hallazgos-cruzados)
3. [Reporte 1 — audio-dsp-review (Realtime Safety)](#reporte-1--audio-dsp-review)
4. [Reporte 2 — dsp-algorithm-guide (Algorithm Correctness)](#reporte-2--dsp-algorithm-guide)
5. [Reporte 3 — webaudio-review (Web Audio API Safety)](#reporte-3--webaudio-review)
6. [Reporte 4 — audio-signal-flow-explainer (Signal Flow)](#reporte-4--audio-signal-flow-explainer)
7. [Reporte 5 — audio-dsp-resilience (DSP Resilience)](#reporte-5--audio-dsp-resilience)
8. [Reporte 6 — typescript-pro (Type Safety)](#reporte-6--typescript-pro)
9. [Fixes consolidados por prioridad](#fixes-consolidados-por-prioridad)

---

## Resumen ejecutivo

| # | Skill | Verdict | Críticos | Warnings |
|---|-------|---------|----------|----------|
| 1 | audio-dsp-review | Warnings only | 0 | 7 |
| 2 | dsp-algorithm-guide | Has correctness issues | 3 | 11 |
| 3 | webaudio-review | Warnings only | 0 | 6 |
| 4 | audio-signal-flow-explainer | Partially mapped | 3 signal-integrity | 10 |
| 5 | audio-dsp-resilience | Has resilience risks | 3 | 5 |
| 6 | typescript-pro | Has type issues (warnings) | 0 | 5 |

**Tipos verificados:**
- `tsc --noEmit` → **exit 0, 0 errores** (VERIFICADO, TS 5.9.3)
- `@ts-nocheck`: **0 archivos / 0 líneas** suprimidas (VERIFICADO, coincide con AGENTS.md §2)
- Frontend **sin AudioWorkletProcessor ni ScriptProcessorNode** (VERIFICADO, grep 0 matches)
- Backend **no es hard-realtime**: es un chunk-generator con deadline soft de 1s/chunk
- Reverb es por convolución (FFT) → no feedback runtime, no DC-amplification en loop

**Bugs críticos consolidados (VERIFICADO por código fuente, no por runtime):**

| ID | Bug | Dónde | Quién lo encontró |
|----|-----|-------|-------------------|
| C1 | `/master/sync` descarta `ceiling_db` del usuario en silencio (FIX K6 incompleto, contradice AGENTS.md) | `routers/mastering.py:280-288` + `mastering.py:4653-4807` | signal-flow + resilience |
| C2 | `/ws/ref-stream` envía float32 pero frontend decodifica como int16 → ruido bit-pattern a half-speed | `routers/streaming.py:664` vs `reference-mastering.ts:432` | signal-flow |
| C3 | `dynamic_resonance_suppressor` sin synthesis window tras IFFT → +2.5 dB error de nivel constante | `advanced_dsp.py:244` | dsp-algorithm |
| C4 | `phantom_sub_bass` mismo bug OLA (synthesis-only) → +2.5 dB en armónicos | `advanced_dsp.py:633` | dsp-algorithm |
| C5 | `reverb.apply_convolution_reverb` usa `mode='same'` → wet precede al dry en el tiempo | `reverb.py:192` | dsp-algorithm |
| C6 | `mixer.py:430` doble limiter con ceilings divergentes (`master_limiter_ceiling` vs `chain_params["limiter_ceiling"]`) | `mixer.py:423-430` | signal-flow + resilience |
| C7 | `streaming_engine.py:285` hard `np.clip` después del limiter parchea overshoot del reset per-chunk → fold-back aliasing | `streaming_engine.py:127,285` + `mastering.py:822` | resilience + signal-flow |
| C8 | `/master/reference` async roto: pasa `reference={...}` a `process_audio` que no lo acepta → `TypeError` | `mastering.py:573-602` | signal-flow |
| C9 | `/ws/master-stream` orphaned — sin consumer frontend | `routers/streaming.py:194` | signal-flow |

**No verificado en runtime por ningún agente (limitación compartida):**
- No se ejecutó audio ni se midió wall-clock, level, aliasing, denormals.
- `mastering.py` (7689 líneas) leído parcialmente por todos (~10-50% según agente).
- Disponibilidad de numba en prod: NO VERIFICADO.
- Los +2.5 dB son aritmética analítica (`2.0/1.5 = 1.333 → +2.5 dB`), no medidos.

---

## Estado final post-fixes (VERIFICADO 2026-09-27)

Tras aplicar los fixes de los 6 agentes (OKI + excepción nominada al backend):

### Verificación global
- **ruff backend**: `All checks passed!` (VERIFICADO con `cd backend && /root/diego/backend/.venv/bin/ruff check .`)
- **tsc frontend**: `EXIT 0`, 0 errores (VERIFICADO con `cd frontend && /root/frontend/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`, TS 5.9.3)
- **`@ts-nocheck`**: sigue en 0 archivos / 0 líneas (VERIFICADO, sin regresión)
- **Diff total**: 31 archivos modificados, +612 / -205 líneas

### Estado por agente
| Agente | Aplicados | Diferidos (TODO) | Verificación |
|--------|-----------|------------------|--------------|
| audio-dsp-review | 4/4 | 0 | ruff OK |
| dsp-algorithm-guide | 9/13 + 2 cross-cutting | 4 TODO (phase_rotation, harmonic_sat delay, reverb_simple tail, phantom_sub f0 phase) + 1 NO APLICADO (U-12 falso positivo, ver abajo) | ruff OK + smoke test funcional |
| webaudio-review | 5/5 | 0 | tsc OK |
| audio-signal-flow-explainer | 4/9 + 1 cross-cutting (C1 FIX K6) | 5 TODO | ruff OK (sus 7 archivos) |
| audio-dsp-resilience | 3/5 + 2 cross-cutting (C6, C7) | 2 TODO (transient_shaper clamps, LUFS gain architectural) | ruff OK + bytecode compile |
| typescript-pro | 3/4 strict flags + migración any/`!.` parcial + 2/3 optional | `noUncheckedIndexedAccess` deferred (188 errores, >30 umbral, TODO documentado en tsconfig) | tsc OK |

### Corrección al audit — FALSO POSITIVO U-12/W10

**El warning W10 (y fix consolidado #10) sobre `multiband_compressor` `butter(4)` no sum-flat es FALSO.** Verificado empíricamente por el agente dsp-algorithm-guide con `scipy.signal.sosfreqz`:

- `butter(4)` + `sosfiltfilt` (lo que usa `multiband_compressor`) suma **EXACTAMENTE flat (0.000 dB deviation)** porque `sosfiltfilt` cuadra la magnitud (zero-phase) y Butterworth LP/HP son power-complementary (`|H_LP|² + |H_HP|² = 1`).
- El "+3 dB bump" del audit **solo existe para CAUSAL (one-pass `sosfilt`)**, no para `sosfiltfilt`.
- El fix propuesto (`butter(2)`+double-`sosfiltfilt`, patrón `_lr4`) daría `|H|⁴ = 0.25+0.25 = 0.5` → **-6 dB dip** (regression).
- El audit también decía que `_split_three_bands` usa `butter(2)` — **también falso**, usa `butter(4)`+`sosfiltfilt` (igual que `multiband_compressor`).
- `multiband_stereo_width` con `_lr4` (butter(2)+double-sosfiltfilt) en realidad tiene -6 dB dip, contradiciendo su propio comment "suma perfecta".

El agente aplicó AGENTS.md #1/#10/#11 (sinceridad innegociable): no aplicó un fix para un bug que no existe. Dejó verification note en el código. **W10 y fix #10 marcados como NO APLICADO — falso positivo.**

### Fixes críticos aplicados (VERIFICADO en código)
- ✅ C1 FIX K6 `/master/sync` — `ceiling_db` → `limiter_ceiling = 10.0 ** (ceiling_db / 20.0)` antes del kwargs filter (routers/mastering.py:79-88)
- ✅ C2 `/ws/ref-stream` PCM — `pcm_format="int16"` (routers/streaming.py:678-681)
- ✅ C3 `dynamic_resonance_suppressor` OLA — synthesis window añadida (advanced_dsp.py:244)
- ✅ C4 `phantom_sub_bass` OLA — divisor `sum(window)/hop`=2.0 (advanced_dsp.py:600,664)
- ✅ C5 `reverb` mode — `mode='full'[:len(dry)]` (reverb.py:192)
- ✅ C6 double limiter — segundo `limiter()` removido, `chain_params.setdefault("limiter_ceiling", ...)` (mixer.py:435-447)
- ✅ C7 hard-clip — soft-knee identity≤0.98 + asymptote 1.0 (streaming_engine.py:286)
- ⚠️ C8 `/master/reference` async — TODO (2 bugs intertwetidos, risky, deferred)
- ⚠️ C9 `/ws/master-stream` orphaned — pendiente de verificación (no se aplicó fix, solo documentación)

### Fixes diferidos (TODO en código, no aplicados)
- U-2 `/master/reference` async (signal-flow) — 2 bugs intertwetidos
- U-4 sidechain timing, U-5 PitchCorrection per-channel, U-6 stem SR round-trip (signal-flow)
- U-8 `/analysis` redundancy, U-9 normalize heuristic (signal-flow)
- U-4 phase_rotation causal/zero-phase, U-5 harmonic_sat polyphase delay, U-7 reverb_simple tail, U-8 phantom_sub f0 phase (dsp-algorithm)
- transient_shaper clamps, LUFS gain architectural, limiter state carry (resilience)
- `noUncheckedIndexedAccess` strict flag (typescript-pro, 188 errores)

---

## Hallazgos cruzados

Estos bugs fueron VERIFICADO de forma independiente por 2+ agentes, lo que refuerza la confianza:

### FIX K6 incompleto en `/master/sync` (C1)
- **audio-signal-flow-explainer**: rastreó `params-builder.ts:88-101` (frontend envía ambos `limiter_ceiling` y `ceiling_db`) → `/master/sync` (mastering.py:272) solo declara `ceiling_db` → `_run_mastering_sync` filtra contra `process_audio` signature (mastering.py:4653-4807) que tiene `limiter_ceiling` pero NO `ceiling_db` ni `headroom_db` → **ambos descartados**, limiter usa default 0.95. Citó `sed -n '4653,4810p'` + grep con 0 matches para `ceiling_db|headroom_db` en esa región.
- **audio-dsp-resilience**: confirmó lo mismo desde el ángulo P7 (single source of truth). Notó que AGENTS.md §3 afirma "FIX K6 ya agrega `ceiling_db`" pero **no lo encontró en el backend** → o es frontend-only o no aplicado.

### Doble limiter en `mixer.py:430` (C6)
- **audio-signal-flow-explainer**: mapeó `mix_and_master` → `apply_mastering_chain` (stage 15 = limiter en `chain_params["limiter_ceiling"]`) → segundo `limiter()` en `master_limiter_ceiling` (default 0.95). Dos ceilings no sincronizados.
- **audio-dsp-resilience**: mismo hallazgo desde P6 (limiter as last-5%). `MixParams.master_limiter_ceiling` (mixer.py:130) independiente de `chain_params["limiter_ceiling"]` → divergen sin enforcement.

### Hard-clip safety net en streaming (C7)
- **audio-dsp-resilience**: `streaming_engine.py:285` `np.clip(block, -1.0, 1.0)` parchea el overshoot del limiter cuyo `prev=1.0` se resetea por chunk (mastering.py:822) → fold-back → aliasing/clicks en cada boundary. Esto es el "symptom-patching trap".
- **audio-signal-flow-explainer**: confirmó el reset per-chunk (streaming_engine.py:114-127 llama `apply_mastering_chain` fresh; el `context` buffer solo prepends audio, no state) → GR jumps en chunk edges. OLA crossfade suaviza audio pero no control discontinuity.

### Sin denormal flush en ningún lado
- **audio-dsp-review**: grep `denormal|FTZ|flush|0x9E40` en backend → 0 matches reales.
- **dsp-algorithm-guide**: confirmó, solo `1e-30`/`1e-12` como divide guards. Offline así que bajo riesgo práctico.
- **audio-dsp-resilience**: `prev = 0.0` en `mastering.py:758,781,946,965`; `_simple_highpass` en `advanced_dsp.py:663`. Riesgo real en fade-outs >80s (100ms release) o >4.6s (40Hz HPF). Recomendó `if abs(prev) < 1e-40: prev = 0.0`.

### Frontend sin Web Audio realtime violations
- **webaudio-review**: 0 matches de `AudioWorkletProcessor|ScriptProcessorNode|process()|addModule()|SharedArrayBuffer` en `frontend/src/`. Arquitectura correcta: single `AudioContext` compartido, autoplay respetado, native nodes solo.
- **audio-dsp-review**: confirmó lo mismo para el ángulo realtime (no hard callback en frontend).

---

## Reporte 1 — audio-dsp-review

### Verdict
**Warnings only** — No hard-realtime callback exists (frontend sin AudioWorklet/ScriptProcessor; backend es chunk-generator con deadline soft). Per-chunk allocations y recomputación de constantes en el streaming hot loop.

### Scope reviewed
13 archivos backend (11 full + mastering.py partial ~10%) + 2 frontend full. mastering.py 7689 líneas solo ~900 leídas (~10%).

### Critical Violations
None.

### Warnings

**Per-chunk allocation en `iter_mastering_chunks`**
`backend/streaming_engine.py:121-255` — ~10 numpy arrays + 32-iter Python loop por chunk.
Why: GC pressure y jitter bajo concurrencia (threadpool absorbs el deadline).
Fix: Pre-allocate working buffers fuera del loop; vectorizar el 32-band loop con `np.add.reduceat`.

**Recomputed constants per chunk**
`backend/streaming_engine.py:215,217,223` — `freqs`, `edges`, `freq_edges` recomputados cada chunk (idénticos).
Fix: Hoist fuera del loop (junto a `_fft_window` que ya está bien en línea 112).

**`channels` metadata bug en pcm24**
`backend/routers/streaming.py:404-416` — `audio` se reasigna en pcm24 branch, luego `audio.shape[0]` da sample count no channel count.
Fix: Variable separada. Además pcm24 LUFS gain trunca a 16-bit precision (línea 407).

**No FTZ/denormal handling en IIR envelope loops**
`backend/mastering.py:935-971, 1476-1482, 1510-1517`; `backend/advanced_dsp.py:663-665`.
Fix: `if abs(prev) < 1e-30: prev = 0.0` o set MXCSR FTZ.

**Numba fallback es Python sample loop**
`backend/mastering.py:944-971` — si `HAS_NUMBA` False, ~176k samples/chunk en Python loop → ~decenas de ms.
Fix: Documentar `HAS_NUMBA` como hard requirement o fallback vectorizado numpy.

**`_apply_spectral_tilt` Python sample loop (no streaming path)**
`backend/dsp_chain.py:66-95` — solo en one-shot render.
Fix: `scipy.signal.lfilter`.

**Per-frame `Float32Array`/`Uint8Array` en frontend visualizers**
`frontend/src/features/canvas/master-visual-suite.ts:798,805` — allocs en rAF tick.
Fix: Hoist a module scope (patrón ya existe en `master-console.ts:183`).

### What's Done Well
- Numba JIT con `nogil=True` en envelope/gain loops (mastering.py:754-830).
- OLA crossfade cosine equal-power entre chunks (streaming_engine.py:146-156).
- Prefetch deque en `master_stream_to_pcm` (streaming_engine.py:312-330).
- Throttling: `_LUFS_EVERY_N_CHUNKS = 4`, `_HEAVY_METRICS_EVERY_N = 8`.
- `await run_in_threadpool(...)` para todo DSP (routers/streaming.py:387,675,884).
- LUFS gain async aplicado mid-stream (streaming.py:354).
- Stereo-linked limiter (mastering.py:1527-1529).
- Single shared `AudioContext` en frontend con `beforeunload` shutdown.

### Verification log
- `grep -rn "threading.Lock|asyncio.Lock|Lock()" backend/` → 10 matches, ninguno en audio path.
- `grep -rn "time.sleep|os.sleep" backend/` → 2 (preview_service, tests), no streaming.
- `grep -rn "AudioWorkletProcessor|ScriptProcessorNode|process\(inputs|AudioWorkletGlobalScope" frontend/src/` → 0 matches.
- `grep -rn "logger.|print(|logging." backend/streaming_engine.py` → 0 matches (no logging en hot loop).
- `grep -rn "denormal|FTZ|flush_to_zero|set_ftz|0x9E40|_MM_SET_FLUSH" backend/` → 2 matches (unrelated `denormalize_reverb_params`).

### Honest gaps (NO VERIFICADO)
- mastering.py ~90% no leído (noise_reduction, dynamic_eq_band, transient_shaper, harmonic_saturation, multiband body, etc.).
- No runtime profiling — todo ASUMIDO desde lectura.
- `HAS_NUMBA` en prod: NO VERIFICADO.
- Concurrency bajo carga: NO VERIFICADO.

---

## Reporte 2 — dsp-algorithm-guide

### Verdict
**Has correctness issues** — 2 OLA normalization bugs (+2.5 dB c/u), 1 convolution-reverb timing misalignment. Core mastering DSP sound (RBJ, soft-knee, lookahead limiter, K-weighting, true-peak, dither/noise-shaping).

### Scope reviewed
10 archivos (advanced_dsp, dsp_chain, reverb, pitch_correction, mixer, codec_simulator, perceptual_analysis, stem_analysis, mastering_metrics full + mastering.py partial ~4530/7689 líneas no leídas).

### Per-module analysis (resumen)

| Módulo | Familia | Familia OK | Estabilidad | Precisión | Denormales | Latencia | Init | Smooth | Oversamp |
|--------|---------|-----------|-----------|-----------|------------|----------|------|--------|----------|
| polynomial_inflator | Chebyshev/tanh | ✓ | ✓ peak-match | ASUMIDO | NO VERIF | N/A | ✓ `_ensure_finite` | NO VERIF | **NO** ⚠ |
| dynamic_resonance_suppressor | STFT+OLA | ✓ | ✓ clip-bounded | ASUMIDO | NO VERIF | N/A | ✓ | NO VERIF | N/A |
| equal_loudness_compensation | STFT filter+OLA | ✓ | ✓ ±8 dB clip | ASUMIDO | NO VERIF | N/A | ✓ | NO VERIF | N/A |
| cross_spectral_unmasking | STFT masking | ✓ | ✓ clip | ASUMIDO | NO VERIF | N/A | ✓ `frame_active` | NO VERIF | N/A |
| phantom_sub_bass | sub-extract+additive | partial (híbrido) | ✓ peak safety | ASUMIDO | NO VERIF | N/A | ✓ | NO VERIF | N/A |
| _simple_highpass | 1st-order RC | ✓ | ✓ alpha∈(0,1) | ASUMIDO | NO VERIF | N/A | ✓ `output[0]=signal[0]` | N/A | N/A |
| _apply_spectral_tilt | 1st-order shelf-ish | partial (no es shelf) | ✓ | ASUMIDO | NO VERIF riesgo | N/A | ✓ | NO VERIF | N/A |
| _synthesize_ir | Schroeder comb sum | partial (no es FDN real) | ✓ fb<1 | ASUMIDO | low risk | N/A | ✓ | N/A | N/A |
| apply_convolution_reverb | FFT convolution | ✓ | ✓ 1e-6 guard | ASUMIDO | low | N/A | ✓ | NO VERIF | N/A |
| apply_time_varying_pitch_shift | phase vocoder (librosa)+OLA | ✓ | ✓ 1e-6 guard | ASUMIDO | low | N/A | ✓ | N/A | N/A |
| process_stem/mix_and_master | multi-stem bus | ✓ | ✓ final limiter | ASUMIDO | NO VERIF | N/A | ✓ `_match_length` | ✓ pan law CP | N/A |
| simulate_codec | ffmpeg round-trip | ✓ | ✓ timeout 120s | ASUMIDO | N/A | N/A | ✓ | N/A | N/A |
| RBJ biquads (eq_*) | biquad IIR | ✓ | ✓ sosfiltfilt | ✓ float64 | NO VERIF | ✓ zero-phase | ✓ | NO VERIF | N/A |
| linear_phase_eq | FIR firwin2 | ✓ | ✓ FIR | ASUMIDO | N/A | ✓ mode='same' odd | ✓ odd taps | N/A | N/A |
| compressor | level+gain computer | ✓ | ✓ ratio<=1 return | ✓ float64 | NO VERIF riesgo | ✓ lookahead shift | ✓ prev=0 | NO VERIF | ✓ 4x |
| limiter | peak+gain computer | ✓ | ✓ clip 0..1 | ASUMIDO | NO VERIF | ✓ edge-hold BUGFIX | ✓ prev=1.0 | ✓ release smooth | ✓ 4x |
| harmonic_saturation | tanh+oversamp | ✓ | ✓ tanh bound | ✓ float64 | NO VERIF | ⚠ polyphase delay | ✓ | NO VERIF | ✓ 4x |
| audio_clipper | tanh soft / hard clip | ✓ | ✓ ceiling [0.1,1.0] | ASUMIDO | NO VERIF | N/A | ✓ | N/A | **NO** hard mode ⚠ |
| dynamic_eq_band | band split+comp | ✓ | ✓ max_reduction floor | ASUMIDO | NO VERIF | ✓ BUGFIX sosfilt/sosfiltfilt | ✓ | ✓ soft-knee | N/A |
| transient_shaper | envelope-diff gain | ✓ | ✓ 1e-9 denom | ASUMIDO | NO VERIF | N/A | ✓ | N/A | N/A |
| multiband_stereo_width / _split_three_bands | LR4 crossover | ✓ | ✓ butter(2)×filtfilt | ASUMIDO | NO VERIF | N/A | ✓ BUGFIX sum-flat | N/A | N/A |
| multiband_compressor | 3-band+comp | ✓ | ✓ | ASUMIDO | NO VERIF | N/A | ✓ | hereda comp | ✓ butter(4)+sosfiltfilt sum-flat (**W10 FALSO POSITIVO**, verificado con `sosfreqz`: 0.000 dB deviation) |
| measure_lufs_integrated / K-weighting | BS.1770-4 (pyloudnorm) | ✓ | ✓ -70 LUFS floor | ASUMIDO | N/A | N/A | ✓ channel weights | N/A | N/A |
| true_peak_dbfs | 4x resample | ✓ | ✓ -100 floor | ASUMIDO | N/A | ✓ edge trim | ✓ | N/A | ✓ 4x |
| _tpdf_dither / _noise_shaped_dither | TPDF+error-feedback | ✓ | ✓ bit_depth>=32 return | ✓ float64 | N/A | N/A | ✓ | N/A | N/A |
| phase_rotation / _design_phase_shift_ap | 2nd-order all-pass | ✓ | ✓ r∈(1e-3,0.999) | ✓ r² scaling | N/A | ⚠ causal vs zero-phase | ✓ fallback dry | N/A | N/A |
| build_matching_fir / apply_matching_fir | FIR freq-sampling | ✓ | ✓ FIR | ASUMIDO | N/A | ✓ mode='same' odd | ✓ odd | N/A | N/A |
| reverb_simple | synthetic IR conv | ✓ | ✓ | ASUMIDO | N/A | ⚠ mode='full' trunc tail | ✓ | N/A | N/A |

### Critical Issues

**1. `advanced_dsp.dynamic_resonance_suppressor`: OLA normalization mismatch (+2.5 dB)**
`backend/advanced_dsp.py:244` — `output[start:end] += processed_frame[:length]`
Why: Analysis window aplicada (línea 202) pero NO synthesis window tras IFFT. Divide por `_ola_normalization(window, hop)` = `sum(window²)/hop` = 1.5 (Hann 75%). Correcto para analysis+synthesis es 1.5; para analysis-only es `sum(window)/hop` = 2.0. Divide por 1.5 en vez de 2.0 → output ~1.33× too loud = **+2.5 dB constante**.
Fix: (a) agregar `* window[:length]` en línea 244 manteniendo divisor 1.5, o (b) cambiar divisor a `sum(window)/hop` = 2.0.

**2. `advanced_dsp.phantom_sub_bass`: mismo OLA mismatch en armónicos (+2.5 dB)**
`backend/advanced_dsp.py:629` — `harmonics_signal[start:h_end] += harmonic_frame[:h_len] * window[:h_len]`
Why: Armónicos sintetizados en time domain (cosines, línea 622) — NO analysis window. Solo synthesis window (línea 629). Divide por `sum(window²)/hop` = 1.5 pero con synthesis-only correcto es `sum(window)/hop` = 2.0. ~1.33× too loud. Mitigado por `scale = (signal_rms/sub_rms) · mix · 0.3` (línea 643) pero error persiste.
Fix: Cambiar divisor a `sum(window)/hop`.

**3. `reverb.apply_convolution_reverb`: `mode='same'` misaligns wet y dry**
`backend/reverb.py:192` — `wet = signal.fftconvolve(dry, ir_scaled, mode='same')`
Why: Para IR causal, `mode='full'` produce wet que empieza al inicio del dry y se extiende. `mode='same'` retorna los `len(dry)` samples centrales, desplazando el wet **antes** del dry por `(len(ir)-1)//2` samples. El reverb precede al dry. Pre-delay (línea 182-185) se come parcialmente por el centering.
Fix: `mode='full'[:len(dry)]` o realinear wet.

### Warnings
- **W1** `reverb.py:196-200` wet normalized a peak 1.0 independiente del dry level → para dry quiet, wet domina; para dry loud, mix puede clip.
- **W2** `mastering.py:7683` `phase_rotation` all-pass causal (`_lfilter`) sumado con residual zero-phase (`sosfiltfilt`) → comb-filter en band edges.
- **W3** `mastering.py:2284-2286` `harmonic_saturation` polyphase resample deja wet delayed sub-sample vs dry → phase mismatch en mix.
- **W4** `mastering.py:1404` `audio_clipper` hard mode `np.clip` sin oversampling → aliasing.
- **W5** `mastering.py:1373` `reverb_simple` `mode='full'[:len(audio)]` trunca el tail del reverb.
- **W6** `advanced_dsp.py:605-624` `phantom_sub_bass` per-frame f0 con cosines phase-locked → discontinuidad de fase en frame boundaries (OLA smooths amplitude no phase).
- **W7** `mastering.py:1117-1126` `measure_lufs_integrated` path corto (<0.4·sr) sin gating BS.1770 → inconsistencia short vs long.
- **W8** `dsp_chain.py:32-95` `_apply_spectral_tilt` docstring miente: dice "shelving slope 6 dB/oct" pero es 1st-order LP/HP (-3 dB at cutoff, -20 dB/decade asymptote). `pivot_hz` es el -3 dB point no unity-gain crossover.
- **W9** `reverb.py:72-119` `_synthesize_ir` docstring dice "FDN simplificado" pero es suma de 4 combs independientes sin mixing matrix. No es FDN real.
- **W10 — ❌ FALSO POSITIVO (verificado post-fix)** `mastering.py:3812-3815` `multiband_compressor` split usa `butter(4)`+`sosfiltfilt`. El audit afirmó "+3 dB en crossover, no sum-flat" pero la verificación empírica con `scipy.signal.sosfreqz` mostró **0.000 dB deviation** (sum-flat). El audit confundió causal (one-pass `sosfilt`, +3 dB) con zero-phase (`sosfiltfilt`, cuadra magnitud → power-complementary `|H_LP|²+|H_HP|²=1` → sum-flat). El fix propuesto (`butter(2)`+double-`sosfiltfilt` = patrón `_lr4`) daría `|H|⁴=0.5` → **-6 dB dip** (regression). NO se aplicó el fix. El audit también afirmó que `_split_three_bands` usa `butter(2)` — también falso, usa `butter(4)`+`sosfiltfilt` (igual que `multiband_compressor`). Y `multiband_stereo_width` con `_lr4` en realidad tiene -6 dB dip (su comment "suma perfecta" miente).
- **W11** `mastering.py:3791-3802` `multiband_compressor` bypass branch over-indentación 24 spaces (legible pero sospechoso).

### What's Done Well
- RBJ biquad formulas correctos (BUGFIX `alpha` high-shelf línea 1260).
- Soft-knee gain reduction Zölzer/Giannoulis exacto (líneas 880-921, 795-816) con boundary continuity.
- Lookahead limiter con edge-hold (BUGFIX de `np.roll` wrap), stereo-linked (BUGFIX de unlinked image shift), 4x oversample.
- PDR (Program-Dependent Release) en `_smooth_envelope` (SSL G-series / dbx 160 style).
- LR4 crossovers sum-flat en `multiband_stereo_width`/`_split_three_bands` (BUGFIX documentado).
- True-peak 4x con edge trim.
- TPDF dither + 9-tap f_weighted noise shaping (error-feedback form, ISO 226 @20phon).
- `harmonic_saturation` normaliza por `k` (small-signal gain) no por `tanh(k)` (BUGFIX documentado, previo convertía saturador en limiter).
- `_ensure_finite` guards reutilizados en los 5 advanced effects.
- BUGFIX comments en cada decisión no-obvia.

### Verification log
- `grep "biquad|lfilter|sosfilt|firwin|iirfilter" backend/` → 75 matches (todos en mastering.py).
- `grep "np.fft|fft|stft|istft|overlap" backend/` → 100+ matches.
- `grep "np.tanh|np.sin|np.cos|waveshape|saturat" backend/` → 97 matches.
- `grep "denormal|FTZ|flush|set_zero|1e-40|1e-30" backend/` → 16 matches, ninguno denormal-flush.
- `grep "latency|setLatency|delay_samples" backend/` → 6 matches (haas, pre-delay).

### Honest gaps (NO VERIFICADO)
- `mastering.py` ~4530 líneas no leídas: `apply_mastering_chain` body 3970-4530, reference-matching 5047-5624, `process_audio` 4530-5046, etc.
- No runtime: los +2.5 dB son aritmética analítica no medidos.
- No tests review.
- COLA constants computados analíticamente no verificados numéricamente.

---

## Reporte 3 — webaudio-review

### Verdict
**Warnings only** — No AudioWorklet/ScriptProcessor violations (frontend sin `process()`). Findings son main-thread per-frame allocations en `requestAnimationFrame` visualization loops → UI jank (dropped frames), no audio dropouts.

### Architecture identified
- Main-thread `AudioContext` (single shared, lazy) — `frontend/src/core/audio-engine.ts:17`.
- `OfflineAudioContext` (offline render, no deadline) — `premium-suite.ts:1316`.
- AnalyserNode tap (read-only, main thread) — `audio-tap.ts:149-222`: 1 ChannelSplitter → 6 Analysers + 3×2 BiquadFilters, created once.
- `AudioBufferSourceNode` playback (mixer, A/B, reference preview).
- NO `AudioWorkletProcessor`, NO `ScriptProcessorNode`, NO `addModule()`, NO `SharedArrayBuffer`/`Atomics` (VERIFICADO grep 0 matches).

### Scope reviewed
67 archivos .ts total, 7 full + 5 partial = 12 leídos. Resto filtrado por grep sin Web Audio.

### Critical Violations
None.

### Warnings

**Per-frame `Float32Array`/`Uint8Array` en master-console rAF tick**
`frontend/src/features/canvas/master-console.ts:280` — `const dbOut = new Float32Array(N)` en `computeEqChainResponse()`
`:381` — `const freqs = new Float32Array(N)` en `drawEqChainResponse()`
`:330` — `const filters = []` en `computeEqChainResponse()`
Why: 3 allocs/frame en rAF → GC pressure → dropped frames. Nota: `state.timeBuf` (línea 184) y `state.wfBuf` (línea 252) SÍ están pre-allocated con length guard — ese es el patrón correcto a seguir.
Fix: Hoist a module scope con length-guarded reallocation (mirror `state.timeBuf`).

**Per-frame `Uint8Array` en visual-suite waterfall**
`frontend/src/features/canvas/master-visual-suite.ts:805` — `const freqData = new Uint8Array(analyser.frequencyBinCount)` cada 2 frames.
Fix: Hoist a module scope, reallocate solo si `frequencyBinCount` cambia (patrón ya en `premium-suite.ts:1448`).

**Rolling-history `Float32Array` en waterfall**
`frontend/src/features/canvas/master-visual-suite.ts:798` — `const slice = new Float32Array(WATERFALL_BINS)` cada 2 frames, push a history (cap 30).
Fix: Ring buffer de 30 slots pre-allocated, rotar index en vez de `unshift`/`pop`.

**Per-frame object alloc + DOM re-parse en premium-suite stereo scope**
`frontend/src/features/pro/premium-suite.ts:180-188` — `_gonioParticles.push({x,y,vx,vy,life,maxLife})` 2 object literals/frame (bounded 240).
`:1023` — `card.innerHTML` 3×/frame (per band).
Fix: Pool de 240 particles pre-allocated con `active` flag. Cachear last-written `corr`/`verdict` por band, solo `innerHTML` si cambió (o `textContent` en child nodes static).

**Per-frame `Float32Array` + arrays en `drawEqCurve()`**
`frontend/src/features/canvas/master-visual-suite.ts:1203,1220,1264` — `curvePoints`, `bells`, `nodes` allocs en event-driven hot path (slider drag).
Fix: Hoist a module scope.

**Dead `AudioContext`/`AnalyserNode` state en `state.ts`**
`frontend/src/core/state.ts:126-132` — `metersAudioCtx`, `metersSourceNode`, etc. declarados pero grep encontró NINGÚN site que los crea/asigna (solo `|| null` y teardown `= null`). Leftover de implementación removida reemplazada por `timeline-meters.ts`. Contradice AGENTS.md §7 (no dead code).
Fix: Remover declaraciones + teardown branch, o documentar como reserved.

### What's Done Well
- Single shared `AudioContext` lazy con `beforeunload` shutdown.
- Autoplay respetado: `audioEngine.resume()` en `decode()` (audio-engine.ts:24-31) y `mixer-engine.playPreview()` (238), A/B player en click (visualizer-helpers.ts:371).
- Pre-allocation en hot loops: `premium-suite.ts:121-122,961-966,1448-1449` (gonio scratch, band buffers, waterfall row — comment "sin allocs en RAF"), `master-console.ts:183-184,251-252` (length-guarded reuse).
- Todos los rAF loops con `cancelAnimationFrame` teardown + re-entry guards.
- `prefers-reduced-motion` respetado.
- 60 FPS throttle en 120/144 Hz monitors.
- Analyser reading con typed-arrays correctos (`getByteFrequencyData`/`getFloatTimeDomainData`), no hardcoded 128-frame quantum.
- `decodeAudioData` usa `arrayBuffer.slice(0)` en los 3 call sites para no detachar el buffer.

### Verification log
- `grep -rn "AudioContext|AudioWorklet|ScriptProcessor|createScriptProcessor" frontend/src/` → 25 matches, no worklet/scriptprocessor.
- `grep -rn "port.postMessage|postMessage" frontend/src/` → 4 matches en `eq-waveform.ts` (Web Worker, no worklet).
- `grep -rn "SharedArrayBuffer|Atomics\." frontend/src/` → 0 matches.
- `grep -rn "ctx.resume|audioContext.resume|\.resume\(\)" frontend/src/` → 3 matches, todos user-gesture.
- `grep -rn "\.addModule\(|audioWorklet|AudioWorkletNode|registerProcessor" frontend/` → 0 matches.
- `ls frontend/public/` → solo `favicon.svg`.

### Honest gaps (NO VERIFICADO)
- `premium-suite.ts` (~3241 líneas) partial: goniometer 100-209, stereo tick 920-1079, waterfall 1430-1549. No leído: codec-preview 1300-1400, doctor tab, loudness widgets.
- `mixer-ui.ts`, `mixer-model.ts`, `preview-controller.ts` no full read (grep sin Web Audio creation).
- `features/analysis/view.ts` no leído (grep sin AudioContext).
- Runtime GC pauses no medidos (findings son static inspection).
- Safari `webkitAudioContext` fallback ASUMIDO.

---

## Reporte 4 — audio-signal-flow-explainer

### Verdict
**Partially mapped** — 15 backend + 3 frontend leídos. 3 signal-integrity bugs VERIFICADO en source: FIX K6 ceiling discard, `/ws/ref-stream` float32/int16 mismatch, `/ws/master-stream` orphaned.

### Scope reviewed
15 backend (excedió scope por 2 helpers) + 3 frontend. mastering.py 7689 partial (apply_mastering_chain 3901-4300, limiter 1423-1530, process_audio 4653-5067, process_audio_with_reference 6864-6993, normalize_to_streaming_target 2960-3079).

### Verified endpoints
`grep -rn "@router\.(get|post|put|delete|patch|websocket)" backend/routers/` → 75 endpoints. Audio-bearing:
- WS: `/ws/master-stream` (streaming.py:194), `/ws/ref-stream` (459), `/ws/mix-stream` (759)
- POST: `/master` (mastering.py:191), `/master/sync` (272), `/master/reference` (319), `/master/reference/sync` (338), `/master/multi-reference` (360), `/master/normalize` (458), `/master/normalize/sync` (481), `/master/preset/{name}` (135), `/pitch-correct` (502)
- POST: `/stems/separate` (stems.py:29), `/mix/upload-stem` (mixer.py:51), `/mix/ai-suggest` (139), `/mix/submit` (streaming.py:701), `/analysis` (analysis.py:45), `/analyze` (72), `/mix-advice` (85), `/spectrum` (102), `/normalize-streaming-target` (125, declara `ceiling_dbtp` línea 129 — NO `true_peak_ceiling_dbtp`)
- POST: 10 endpoints `/dsp/*` (advanced_dsp.py:200-756)

### Signal Flow: Mastering chain (offline)
#### Graph
```
UploadFile → disk → librosa.load(sr=None) [mastering.py:4828]
  → _crop_preview [4833] → audio_orig = audio.copy() [4840]
  → analyze_audio [4843] (side-tap, no altera)
  → noise_reduction (si !nr_bypass) [4952]
  → apply_mastering_chain [4961] (16 stages: HPF→EQ→dynEQ→M/S→comp→tonal→deEsser→MBcomp→transient→sat→stereo→lowMono→glue→clipper→limiter[4483]→meters)
  → run_lufs_safety_check (si use_lufs_normalize, re-render con input_gain_db) [4978]
  → _write_master_output [5017] (WAV/FLAC/MP3, TPDF dither)
```
#### Latency path
- IIR zero-phase (filtfilt) → 0 samples net.
- Lookahead via `maximum_filter1d` (forward max) + gain curve → 0 net delay (offline look-ahead, no delay line real).
- Total: **0 samples** (offline). ASUMIDO para stages 7-14 no leídos.
#### Issues
- **FIX K6 incomplete en `/master/sync`** (VERIFICADO, ver Cross-cutting #1).
- `audio_orig = audio.copy()` duplica track en RAM; LUFS safety check re-render hasta 4×.

### Signal Flow: Reference matching (offline)
#### Graph
```
Source + Reference(s) → _load_audio_any [5047]
  (multi-ref: _combine_references_weighted [606] sr-resample + weighted sum + clip[-1,1])
  → analyze_audio(src) + analyze_audio(ref) [6964-6965]
  → 8-dim match: tonal (EQ FIR), loudness (LUFS), dynamics (MB comp), stereo, transient, sub-bass, de-esser, saturation
  → two-stage limiter (gentle + brickwall, 5ms lookahead) [6117-6195, called 7401-7417]
  → _write_master_output
```
#### Issues
- **`/master/reference` async roto (VERIFICADO, C8)**: `_run_reference_job` (mastering.py:573-602) llama `process_audio(input_path, reference={...})` que NO acepta ese kwarg → `TypeError`. Solo `/master/reference/sync` funciona (usando `_run_mastering_sync` que filtra el kwarg, pero entonces la referencia nunca se usa — bug separado). Frontend AUDITORIA-K8-K10 doc ya flaggea esto.
- `_combine_references_weighted` hard-clips a [-1,1] (línea 649) → si references son hot, target distorsionado.

### Signal Flow: Streaming preview
#### Graph
```
/ws/master-stream (streaming.py:194):
  WS → librosa.load [255/312] → _crop_preview [259/320] → audio_cache_put
  → compute_lufs_corrected_gain (async, en paralelo) [354]
  → master_stream_to_pcm16(pcm_format=int16) [360-361]
      └─ iter_mastering_chunks [streaming_engine.py:57]
           per chunk: apply_mastering_chain [127] + OLA crossfade 50ms [146-150]
           → _to_pcm (clip[-1,1] → int16×32767) [287]
  → si LUFS gain ready: multiply PCM int16 × gain_linear [393-414]
  → ws.send_json(metrics) + ws.send_bytes(pcm) [416-417]

/ws/ref-stream (streaming.py:459):
  WS → load src + ref → _compute_matching (EQ FIR vs ref) [596-641]
  → derive_mb_chain_params_from_reference [658]
  → master_stream_to_pcm16 (NO pcm_format → default "float32") [664-665]
  → ws.send_bytes(float32 PCM)

/ws/mix-stream (streaming.py:759):
  WS → load N stems → librosa.resample to common sr [818]
  → _build_mix [836-862] → master_stream_to_pcm16(pcm_format="int16") [873-874]
  → ws.send_bytes(int16 PCM)
```
Frontend sinks:
- `/ws/mix-stream` → `mixer-engine.ts:407-441`: collect ALL → `wavBlobFromPcm16` → `<audio>` (collect-then-play, no real-time).
- `/ws/ref-stream` → `reference-mastering.ts:428-452`: `scheduleChunk` decodes `new Int16Array(pcmBytes)` → `createBuffer` → `createBufferSource` → `start(playTime)` (real-time, 0.30s buffer, 10ms fade/chunk).
- `/ws/master-stream` → **NO consumer frontend** (solo en API.md:169).
#### Issues
- **`/ws/ref-stream` PCM mismatch (VERIFICADO, C2, high severity)**: backend float32, frontend decodifica int16 → half-speed noise. Ver Cross-cutting #2.
- **`/ws/master-stream` orphaned (VERIFICADO, C9)**: grep solo en `frontend/API.md:169`.
- **Streaming chunk state reset (VERIFICADO)**: `iter_mastering_chunks` (streaming_engine.py:114-127) llama `apply_mastering_chain` fresh por chunk; compressor/limiter state reset → GR jumps en chunk edges. OLA smooths audio no control. Audible pumping en sustained ASUMIDO.
- **LUFS gain step (VERIFICADO)**: stream empieza antes que `compute_lufs_corrected_gain` complete. Primer chunks sin corrección, luego `_lufs_gain_db` aplicado → level step mid-stream sin fade.

### Signal Flow: Stem separation
#### Graph
```
UploadFile → disk → run_stems_job → separate_stems [stem_separation.py:64]
  → force stereo [89-109] → _resample(audio, sr, model_sr=44100) [114]
  → normalize: (wav-mean)/std [119]
  → apply_model(htdemucs_ft, split=True, overlap=0.25) [129-132]
  → denormalize: out×std+mean [142]
  → per stem: _resample(out_np[i], model_sr, sr) [158]
  → {drums, bass, other, vocals} → per-stem WAVs en STEMS_DIR/{job_id}/
```
#### Issues
- **SR round-trip artifacts (VERIFICADO)**: 48000→44100→48000 doble polyphase resample → pre-ringing/phase artifacts. Modelo nunca ve native SR.
- Normalización `(wav-mean)/std` global: transient loud infla `std` squashing el resto.

### Signal Flow: Mixer
#### Graph
```
N stems → mix_and_master [mixer.py:330] OR _build_mix [streaming.py:836]
  → per stem: _ensure_stereo → process_stem [mixer.py:139]:
       1. gain (10^(gain_db/20)) [159]
       2. HPF si >20Hz [163], LPF si <20kHz [165]
       3. EQ 4-band parametric [169-177]
       4. compressor (threshold LINEAL 0..1) [180-190]
       5. transient_shaper [194-199]
       6. stereo_width [202]
       7. pan (constant-power -45°..+45°) [206-213]
       8. ReverbProcessor.process (convolution) [216-230]
       9. PitchCorrectionProcessor.process (per-channel) [236-254]
  → apply_sidechain [260]: trigger_mono → _smooth_envelope → _soft_knee → target×gr_lin
  → _match_length (zero-pad) [400] → sum [401] → master_gain [404]
  → normalize_before_master: if peak>0.9 scale 0.9/peak [408-411]
  → apply_mastering_chain [423] ← 16-stage chain con su limiter interno
  → limiter(mastered, ceiling=master_limiter_ceiling) [430] ← SEGUNDO limiter
  → sf.write PCM_24 [442]
```
#### Issues
- **Sidechain timing (VERIFICADO, minor)**: GR de trigger causal aplicado a target sin delay → primeros ~5ms (attack_ms) de transient pasan sin ducking.
- **Double limiter (VERIFICADO, C6)**: chain stage 15 + mixer.py:430, dos ceilings no sincronizados.
- **PitchCorrectionProcessor per-channel (VERIFICADO)**: L y R procesados independientes → si chroma difiere, escalas diferentes → stereo pitch divergence (ASUMIDO chroma usualmente idéntico).

### Signal Flow: Analysis
#### Graph
```
UploadFile → sf.read → AudioService.analyze_file → librosa.load → analyze_audio → mix_advice → JSON
/normalize-streaming-target (analysis.py:125-179):
  → normalize_to_streaming_target(audio, sr, platform, ceiling_dbtp) [mastering.py:3029]
       measure_lufs → input_lufs, true_peak → input_tp
       gain_db = target_lufs - input_lufs → gained = audio×10^(gain_db/20)
       if projected_tp > ceiling_dbtp+0.01: limiter(gained, ceiling=10^(ceiling_dbtp/20))
  → measure_lra → evaluate_streaming_compliance → JSON (no audio file)
```
#### Issues
- `/analysis` y `/analyze` redundantes.
- `normalize_to_streaming_target` heurística `is_samples_first = (ndim==2 and shape[0]>shape[1] and shape[1]<=16)` frágil para tiny buffers.

### Signal Flow: Advanced DSP (10 endpoints)
#### Graph
```
UploadFile → _read_audio_for_dsp → sf.read → .T (channels, samples)
  → single processor (resonance-tamer/inflator/phantom-sub/iso-comp/match-eq/cross-demask/loudness-penalty/phase-rotation/spectral-tilt/dr-meter)
  → _write_audio_from_dsp: np.clip(out, -1, 1) [advanced_dsp.py:101] ← HARD CLIP
  → sf.write PCM_24 → FileResponse
```
#### Issues
- **Output hard-clip (VERIFICADO, W7)**: `np.clip(-1,1)` para todos los 10 endpoints → hard clipping en vez de soft limiting.

### Signal Flow: Pitch correction
#### Graph
```
UploadFile → sf.read(always_2d, float32) → squeeze mono / per-channel multichannel
  → apply_pitch_shift(librosa.effects.pitch_shift, global cents) [mastering.py:777-816]
  → sf.write PCM_24 → PITCH_JOBS → GET /pitch-correct/{job_id}
```
#### Issues
- **`scale` silently ignored (VERIFICADO)**: `mastering.py:767-768` log warning y ignora `scale`; solo `corrections` (semitone count) usado. Endpoint "pitch-correct" implies scale-aware que no pasa. `PitchCorrectionProcessor` (pitch_correction.py:478-592) SÍ implementa scale quantization pero `/pitch-correct` no lo llama. Discrepancia mixer path (usa Processor) vs standalone endpoint (no).

### Signal Flow: Frontend playback
#### Graph
```
Single shared AudioContext (latencyHint='interactive') [audio-engine.ts:12-20]
  Sources: custom AudioNode (mixer/A-B) OR media-element via createMediaElementSource → masterOut Gain → ctx.destination
  Tap (audio-tap.ts:149-222, PURELY MEASUREMENT, no altera signal):
    source → ChannelSplitter(2) ─┬→ analyserL (2048) [163]
                                ├→ analyserR (2048) [164]
                                ├→ analyserGonioL/R (1024) [177-178]
                                ├→ analyserWaterfall (2048, smooth 0.65) [186]
                                ├→ analyserAurora (2048, smooth 0.78) [193]
                                └→ 3× BiquadFilter(bandpass) → analyser pairs (512) [197-219]
                                    (lowMid 632Hz Q0.7, highMid 3464Hz Q1.0, air 9798Hz Q1.2)
  Sinks: ctx.destination (speakers), Analysers (visualizers read-only)
WS PCM sinks:
  - reference-mastering.ts:428-452 scheduleChunk: Int16Array → createBuffer → createBufferSource → connect → start
  - mixer-engine.ts:432-441 wavBlobFromPcm16: collect → WAV Blob → <audio>.src → play
  - visualizer-helpers.ts:556-557 decodeAudioData para A/B blobs
```
#### Issues
- **Mono splitter channel mismatch (VERIFICADO, W4)**: `audio-tap.ts:149` `ChannelSplitter(2)` hardcoded. Para source mono, output 1 = silence → `analyserR` ve silence → goniometer muestra "mono=hard left". Tap no query `source.channelCount`.
- **`/ws/ref-stream` Int16 decode de float32 (VERIFICADO, C2)**: `new Int16Array(pcmBytes)` pero backend float32 → cada float32 reinterpretado como 2 int16 → half-speed noise. Bug más serio de signal-integrity.

### Cross-cutting issues
1. **FIX K6 incomplete (VERIFICADO, contradice AGENTS.md)** — ver C1.
2. **`/ws/ref-stream` PCM format mismatch (VERIFICADO, high severity)** — ver C2.
3. **`/ws/master-stream` orphaned (VERIFICADO)** — ver C9.
4. **Reverb wet normalization gain staging (VERIFICADO)** — `reverb.py:195-197` wet normalized a peak 1.0 independiente del dry. Para dry -20 dB y wet_amount=0.3, wet boosted a 0 dBFS → output +11 dB sobre wet well-gained. Riesgo clip antes del chain limiter.
5. **Stem-separation SR round-trip (VERIFICADO)** — doble polyphase resample, modelo nunca ve native SR.
6. **dsp_chain.py one-pole denormal risk (VERIFICADO)** — `_apply_spectral_tilt:66-95` recursive sin flush, riesgo en silence. Bajo exposure (solo `/dsp/spectral-tilt`).
7. **advanced_dsp output hard-clip (VERIFICADO)** — `np.clip(-1,1)` para 10 endpoints.
8. **Sample-rate consistency (VERIFICADO, OK)** — `process_audio` sr=None, no internal resampling. Limiter 4x interno compensado. ✓
9. **DC blocking (VERIFICADO, OK)** — chain stage 2 HPF 80Hz bloquea DC. ✓
10. **Channel count consistency (VERIFICADO, mostly OK)** — único mismatch es frontend `ChannelSplitter(2)` para mono.

### What's Done Well
- Limiter stereo-linked true-peak con edge-hold BUGFIX.
- OLA crossfade cosine equal-power (sum-of-squares=1.0) entre chunks.
- HPF como DC blocker en stage 2 (antes de cualquier compressor).
- M/S processing antes que broadband compression (detector ve signal balanced).
- Parallel compression correcto (captura pre-comp dry, comprime dry, blend — no double-comp).
- `true_peak_ceiling_dbtp` vs `ceiling_dbtp` distinción real y consistente con AGENTS.md.
- `_PROCESS_AUDIO_PARAMS` whitelist previene unknown kwargs (lo que detiene `reference={...}` de crashear `/master/reference/sync` — pero `/master/reference` async bypass, ver C8).

### Recommended Fixes (priority order)
1. **Fix `/ws/ref-stream` PCM format** — `pcm_format="int16"` en streaming.py:664 (one-line), O cambiar frontend a `Float32Array`. High severity — actualmente preview de reference-matching reproduce noise.
2. **Complete FIX K6 en `/master/sync`** — declarar `limiter_ceiling` en route O convertir `ceiling_db`→`limiter_ceiling` en `_run_mastering_sync` antes del filter. Actualizar AGENTS.md.
3. **Fix `/master/reference` async** — routear a `process_audio_with_reference` o drop `reference` kwarg. Actualmente roto TypeError.
4. **Frontend mono splitter** — query `source.channelCount` en audio-tap.ts:149.
5. **Reverb wet gain** — normalizar wet a dry RMS/peak ratio, no peak 1.0 absoluto.
6. **advanced_dsp output** — reemplazar `np.clip(-1,1)` con tanh soft-clip o limiter 5ms lookahead.
7. **Streaming chunk state carry** — pasar state dicts a `apply_mastering_chain` y re-seed por chunk.
8. **LUFS gain fade** — ramp `_lufs_gain_db` ~50ms en vez de hard step.

### Verification log
- `grep -rn "@router\.(get|post|put|delete|patch|websocket)" backend/routers/` → 75 endpoints.
- `sed -n '4653,4810p' backend/mastering.py | grep -nE "ceiling_db|headroom_db|limiter_ceiling"` → `limiter_ceiling` en sig-line 108, NO `ceiling_db`/`headroom_db`.
- `grep "headroom_db|ceiling_db\b" backend/mastering.py` → 16 matches, todos en two-stage limiter (6117-6195) y process_audio_with_reference (6920, 7396-7417), none en process_audio.
- `grep "ceiling_db|headroom_db|true_peak_ceiling|ceiling_dbtp" backend/mastering.py` → confirma `ceiling_dbtp` (3011+) distinto de `true_peak_ceiling_dbtp` (2945-2994).
- `grep -rn "limiter_ceiling|ceiling_db|/master/sync" frontend/` → FIX K6 en `params-builder.ts:88-101`, envía ambos.
- `grep "pcm_format|stream_pcm_format|master_stream_to_pcm" backend/routers/streaming.py` → ref-stream NO pasa pcm_format → float32 default.
- `grep -rn "master-stream|masterStream|/ws/mast" frontend/` → solo `frontend/API.md:169`.
- `grep -rn "wsAuthUrl|new WebSocket" frontend/src` → solo ref-stream y mix-stream abiertos.

### Honest gaps (NO VERIFICADO)
- `mastering.py` stages 7-14 de `apply_mastering_chain` no full read — latency ASUMIDO.
- Runtime introspection de `process_audio` signature falló (librosa no instalado) — VERIFICADO via source reading (sed+grep).
- `run_stems_job` (job_runners.py) no leído.
- `preview_service.PreviewRenderer` (app.py:510) no leído — probable path de main-mastering preview (ya que /ws/master-stream orphaned).
- No audio output listened — `/ws/ref-stream` mismatch es code-level VERIFICADO, audible result ASUMIDO.
- `codec_simulator.py`, `stem_analysis.py` no leídos.
- 10 `/dsp/*` endpoint bodies no full read (común `_read/_write_audio_from_dsp` VERIFICADO, per-endpoint ASUMIDO).

---

## Reporte 5 — audio-dsp-resilience

### Verdict
**Has resilience risks** — DSP bien diseñado para level safety (lookahead limiter, true-peak, linked stereo, NaN/Inf guards, reverb por convolución sin feedback runtime). Pero 2 bugs single-source-of-truth, hard-clip safety net, sin denormal flush, DC en phantom_sub_bass, hard clamps en dynamics loops.

### Scope reviewed
8 archivos full (reverb, mixer, dsp_chain, advanced_dsp, pitch_correction, streaming_engine, routers/streaming, routers/mastering partial) + mastering.py partial (~7700/7689 líneas en sections, ~3500 no leídas).

### Per-module resilience audit (resumen)

| Módulo | P1 Fb<1 | P2 Gain-stage | P3 DC-block input | P4 Smooth/soft-sat | P5 Denormal | P6 Limiter last-5% | P7 Single truth |
|--------|---------|--------------|-------------------|--------------------|-------------|--------------------|-----------------|
| reverb.py | ✓ N/A (conv) | ✓ wet norm | ✓ N/A | partial (clip param) | ✓ low risk | N/A | ✓ |
| mixer.py | ✓ N/A | ⚠ normalize-before-master masks DC | partial HPF default 20Hz bypass | ✓ sidechain GR | ✓ inherits | ⚠ **double limiter** | ⚠ **bug: 2 ceilings** |
| dsp_chain.py | ✓ N/A | ✓ | N/A | ⚠ no smoothing | ⚠ risk | N/A | ✓ |
| advanced_dsp.py | ✓ N/A (FFT) | ✓ peak-safety | ⚠ **phantom_sub no input DC-block** | ✓ tanh good, ⚠ hard clamps per-frame | ⚠ **_simple_highpass risk** | N/A | ✓ `_ensure_finite` |
| pitch_correction.py | ✓ N/A | ✓ OLA norm | N/A | ✓ uniform_filter | ✓ low | N/A | ✓ MODES dict |
| streaming_engine.py | ✓ N/A | ⚠ **per-chunk state discontinuity** | ⚠ no DC-block entre chunks | ⚠ **hard clip patches limiter reset** | ✓ reset per-chunk | ⚠ **np.clip IS primary brickwall** | ✓ constants |
| routers/streaming.py | N/A | ⚠ LUFS gain after limiter | N/A | hard clip | N/A | ⚠ | ✓ |
| mastering.py (partial) | ✓ N/A reverb conv | ⚠ makeup gain into limiter | ✓ HPF stage 2; ⚠ reverb no input DC-block | ✓ soft-sat good; ⚠ hard clamps in dynamics | ⚠ **no flush, risk on tails** | ✓ limiter well-designed but chain feeds it heavy | ⚠ **BUG: 4 ceiling names** |

### Gotchas found
1. `streaming_engine.py:285` hard `np.clip` after limiter — patches per-chunk state-reset overshoot → fold-back → aliasing/clicks.
2. `streaming_engine.py:127` `apply_mastering_chain` per-chunk no state carry — limiter `prev=1.0` resets → first samples unlimitted → overshoot → hard clip catches.
3. `advanced_dsp.py:611` `sub_env = np.abs(sub_signal)` en `phantom_sub_bass` sin input DC-block → DC infla envelope.
4. `mixer.py:411` `if peak > 0.9: mix = mix * (0.9/peak)` pre-master normalize — masks DC/level bugs.
5. `mastering.py:2186` `gr_db = np.maximum(gr_db, -max_reduction_db)` hard floor en `dynamic_eq_band` → kink → click si hit/released rapid.
6. `mastering.py:2221-2222` `np.maximum`/`np.minimum` en `transient_shaper` envelope comparison → kinks.
7. `mastering.py:758,781,946,965` `prev = 0.0` no denormal flush → risk en fade-out >80s (100ms release).
8. `advanced_dsp.py:663` `_simple_highpass` single-pole IIR no flush → risk >4.6s silence (40Hz cutoff, bypassed por default).
9. `routers/mastering.py:280-288` + `mastering.py:4653-4808` `/master/sync` `ceiling_db` silently dropped (ver C1).
10. `mixer.py:430` segundo `limiter()` después de `apply_mastering_chain` — double limiter, 2 ceilings (ver C6).

### Critical Issues

**1. `/master/sync` silently drops `ceiling_db` (ver C1)**
`routers/mastering.py:280` — `ceiling_db: float = Query(-0.3, ge=-1.0, le=0.0)`
`routers/mastering.py:283` — `"ceiling_db": ceiling_db`
`routers/mastering.py:83` — `kwargs = {k: v for k, v in params.items() if k in valid_keys}`
`mastering.py:4760` — `limiter_ceiling: float = 0.95` (no `ceiling_db` en `process_audio`)
Why: `process_audio` no acepta `ceiling_db` → filter lo drops → limiter usa default 0.95 sin importar qué envía el usuario. Silent failure. AGENTS.md dice "FIX K6 ya agrega `ceiling_db`" pero no encontrado en backend.
Fix: Convertir `ceiling_db`→`limiter_ceiling = 10.0 ** (ceiling_db / 20.0)` en `_run_mastering_sync` antes del filter, o agregar `ceiling_db` param a `process_audio`. **Backend READ-ONLY — necesita OKI + excepción nominada.**

**2. `streaming_engine.py` hard `np.clip` after limiter masks per-chunk state-reset overshoot (ver C7)**
`streaming_engine.py:285` — `clipped = np.clip(block, -1.0, 1.0)`
`streaming_engine.py:127` — `apply_mastering_chain` per-chunk no state carry
`mastering.py:822` — `prev = 1.0` resets cada chunk
Why: Limiter `prev` empieza en 1.0 (no reduction) → first samples pasan unlimitted → hard clip catch overshoots → fold back → aliasing/clicks cada chunk boundary (cada 4s default). OLA crossfade smooths audio no gain envelope discontinuity. Symptom-patching trap.
Fix: (a) Carry limiter `prev` state across chunks (refactor `limiter` acepte/retorne state), O (b) reemplazar `np.clip` con `np.tanh(block)` (soft-sat no fold), O (c) reducir chunk size (peor: más DSP calls). Best: (a). **Backend READ-ONLY.**

**3. `mixer.py` double limiter con divergent ceilings (ver C6)**
`mixer.py:423` — `apply_mastering_chain` (chain limiter en `chain_params["limiter_ceiling"]`)
`mixer.py:430` — `limiter(mastered, ceiling=master_limiter_ceiling, release=60, lookahead=5)` (default 0.95)
Why: Dos limiters en series. Si user set `limiter_ceiling=0.89` pero `master_limiter_ceiling=0.95`, chain hace work, segundo no-op. O si solo set `master_limiter_ceiling`, chain (default 0.95) deja peaks que segundo catch. Ceilings no sincronizados → actual ceiling depende de cuál es menor, silently.
Fix: Remover segundo limiter (rely on chain), O assert `master_limiter_ceiling == chain_params.get("limiter_ceiling")` y warn si difieren. **Backend READ-ONLY.**

### Warnings

**`phantom_sub_bass` no input DC-block**
`advanced_dsp.py:611` — `sub_env = np.abs(sub_signal)`
Why: Input DC infla `sub_env` → harmonics escalados por DC-inflated envelope. Output highpass (línea 637) limpia output pero envelope ya está mal.
Fix: `audio = _simple_highpass(audio, sr, 20.0)` al inicio de `phantom_sub_bass`. Low priority (bypassed por default).

**Denormal risk on long fade-out tails**
`mastering.py:758,781,946,965`; `advanced_dsp.py:663`
Why: Envelope state puede entrar denormal range → numba/numpy loop slowdown 10-100×. No crash, no audible — CPU spike en tail.
Fix: `if abs(prev) < 1e-40: prev = 0.0` en cada loop, o FTZ/DAZ via `numba.config.FLUSH_TO_ZERO`. Low priority (raro en práctica, ASUMIDO no medido).

**Hard clamps en dynamics loops**
`mastering.py:2186` — `gr_db = np.maximum(gr_db, -max_reduction_db)` (dynamic_eq_band)
`mastering.py:2221-2222` — `np.maximum`/`np.minimum` (transient_shaper)
Why: Kinks en GR/gain curves en clamp points → clicks si hit/released rapid. No feedback loops, no fold-back, pero transient artifacts posibles.
Fix: Soft-knee taper cerca del limit (como `_soft_clip_curve`). Medium priority.

**LUFS gain applied after limiter**
`routers/streaming.py:393-402` — `pcm_data = np.clip(pcm_data * gain_linear, ...)`
Why: LUFS correction gain aplicado a PCM después del chain limiter → si gain positivo (boosting quiet), limiter ceiling excedido → `np.clip` (hard) catch. Mismo hard-clip issue que streaming_engine.py:285.
Fix: Apply LUFS gain antes del chain como `input_gain_db`. Medium priority.

### What's Done Well
1. Limiter design (mastering.py:1423-1530): true-peak 4x, lookahead 5ms, linked stereo, smooth release, edge-hold tail BUGFIX. High-quality.
2. Soft saturation donde importa: `audio_clipper` soft mode (tanh), `harmonic_saturation` (tanh + 4x oversampling), `_soft_clip_curve` para FIR.
3. NaN/Inf guards: `_ensure_finite` reutilizado en 5 advanced effects.
4. PDR (Program-Dependent Release) en `_smooth_envelope` — musical, no coeficiente fijo.
5. Soft-knee Zölzer/Giannoulis con BUGFIX notes.
6. Convolution reverb (FFT) → no runtime feedback loop → no feedback-gain, no DC-amplification, no denormal-in-loop por construcción.
7. OLA normalization con BUGFIX notes (divisor 2.67×/1.33× incorrecto previo).
8. Chain order explícito y documentado.
9. Linked stereo limiter con BUGFIX de unlinked image shift.
10. Lookahead shift tail BUGFIX (cambio de `gr[-1]` a `0.0`).

### Recommended Fixes (priority order)
1. **CRITICAL — `/master/sync` ceiling dropped**: convertir `ceiling_db`→`limiter_ceiling` antes del filter. **Necesita OKI + excepción backend.**
2. **CRITICAL — streaming hard-clip → soft-sat O state carryover**: `np.tanh(block)` en streaming_engine.py:285, O refactor `limiter` para carry `prev` state. **Necesita OKI + excepción.**
3. **HIGH — mixer double limiter**: remover segundo `limiter()` en mixer.py:430, O assert + warn. **Necesita OKI + excepción.**
4. **MEDIUM — phantom_sub_bass input DC-block**: `_simple_highpass(audio, sr, 20.0)` al inicio. **Necesita OKI + excepción.**
5. **MEDIUM — denormal flush en numba loops**: `if abs(prev) < 1e-40: prev = 0.0` en `_smooth_envelope_numba`, `_smooth_envelope_pdr_numba`, `_limiter_gain_numba`, fallbacks numpy. **Necesita OKI + excepción.**
6. **MEDIUM — LUFS gain before limiter**: aplicar `_lufs_gain_db` como `input_gain_db` antes del chain, no después. **Necesita OKI + excepción.**
7. **LOW — soft-knee en dynamic_eq/transient_shaper clamps**: soft-taper versions. **Necesita OKI + excepción.**

### Quality metrics que SHOULD be tested (audio-dsp-testing companion)
- Clicks at chunk boundaries (streaming_engine.py): sine + transient en boundary, medir discontinuities → catch C7.
- DC offset in/out (phantom_sub_bass): audio con DC conocido, medir DC en output y `sub_env` → catch phantom_sub DC.
- True-peak overshoot per chunk: hot audio en 4s chunks, medir true-peak en first 50ms → catch limiter state-reset.
- Denormal CPU on fade-out: 90s silence tail, medir wall-clock de `apply_mastering_chain` → catch denormal.
- Aliasing after hard clip: near-nyquist sine que overshoots, medir spectral content arriba → catch hard-clip aliasing.
- Ceiling compliance: `ceiling_db=-1.0` a `/master/sync`, medir true-peak output → debería ≤-1.0 dBTP pero default 0.95 (≈-0.45).
- Limiter GR curve smoothness: signal que hit `max_reduction_db` rapid, medir GR derivative → catch kinks.
- Double-limiter ceiling divergence: `chain limiter_ceiling=0.89` + `master_limiter_ceiling=0.95`, medir true-peak.

### Verification log
- `grep -rn "feedback|fb_gain|feedback_gain|decay|rt60" backend/` → 33 matches; reverb feedbacks solo en IR synthesis, no runtime.
- `grep -rn "np.clip|np.minimum|np.maximum|hard.*clip" backend/` → 100+; key: streaming_engine.py:285, mastering.py:2186,2221-2222,1404,1492.
- `grep -rn "np.tanh|soft.*sat|saturation|waveshape" backend/` → 84; soft-sat en audio_clipper, harmonic_saturation, _soft_clip_curve, polynomial_inflator.
- `grep -rn "highpass|hp|dc_block|sosfilt" backend/` → 100+; HPF stage 2, per-stem HPF, `_simple_highpass`. No DC-block en reverb/phantom_sub input.
- `grep -rn "denormal|FTZ|flush|1e-40|1e-30|1e-38" backend/` → 16, none denormal-flush.
- `grep -rn "makeup|make_up|gain.*compensat" backend/` → 100+; makeup en cada compressor, presets hasta +1.6 dB.
- `grep -rn "limiter_ceiling|ceiling_db|ceiling_dbtp" backend/` → 81; 4 ceiling names confirmados.
- `grep -rn "smooth|one_pole|one-pole|ramp|interp" backend/` → 81; `_smooth_envelope` one-pole reusado.
- `grep -rn "np.isfinite|nan_to_num|_ensure_finite" backend/` → 37; `_ensure_finite` guards input de 5 effects.
- `grep -rn "prev = 0\.0|prev=0\.0|denormal|FTZ|DAZ|set_flush" backend/mastering.py` → 4, todos `prev = 0.0` (758,781,946,965), no flush.

### Honest gaps (NO VERIFICADO)
1. `mastering.py` ~3500 líneas no leídas (300-755, 982-1363, 1582-2111, 2391-3630, 3860-3901, 4530-4653, 4852-5432, 5466-5964, 6033-6117, 6160-7689). Reference-matching path (6160-7689, ~1500 líneas) es la sección más grande no leída — probablemente tiene su propio limiter/ceiling handling (vi `_brickwall_ceiling_db` en 7396-7417, quinto concepto de ceiling NO VERIFICADO).
2. No audio rendered — todo ASUMIDO desde lectura.
3. Frontend no auditable — FIX K6 puede ser mitigado frontend-only NO VERIFICADO.
4. ruff/tsc no re-run (out of scope).
5. Numba JIT behavior ASUMIDO (no verifiqué compila o `fastmath=True` no cambia denormal behavior).
6. scipy `sosfilt`/`sosfiltfilt` denormal behavior ASUMIDO (conservador).
7. `process_audio_with_reference` (6160-7689) ceiling handling NO VERIFICADO.

---

## Reporte 6 — typescript-pro

### Verdict
**Has type issues (warnings only, no critical violations)** — `tsc --noEmit` exits 0 con 0 type errors (VERIFICADO), `@ts-nocheck` 0 archivos/0 líneas (VERIFICADO, coincide con AGENTS.md §2), pero tsconfig missing 4 strict flags y 121 `any` concentrados en 6 archivos legacy.

### Scope reviewed
64 archivos .ts total, 12 leídos full + 7 partial = 19 (~30% coverage). 45 no leídos full (assessment via grep).

### tsc result (VERIFICADO)
- Command: `cd frontend && /root/frontend/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (TypeScript 5.9.3; `npx tsc` falló porque `node_modules` no instalado en este worktree).
- Exit code: **0**
- Error count: **0**
- Output: empty (clean compile)

### @ts-nocheck suppression status (VERIFICADO)
- Files suppressed: **0**
- Lines suppressed: **0**
- Command: `grep -rn "@ts-nocheck" frontend/ --include="*.ts" --include="*.tsx"` → 4 matches, **todos en comments** (historical references a pragmas removed):
  - `premium-suite.ts:3230` — "El build pasaba solo porque @ts-nocheck suprimía el TS2304."
  - `analysis/view.ts:25` — "renderers legacy (`@ts-nocheck`)"
  - `analysis/view.ts:83` — "módulo `visualizer-helpers` (legacy, `@ts-nocheck`)"
  - `audio-tap.ts:280` — "isn't enough for @ts-nocheck consumers"
- Confirma AGENTS.md §2 claim: 0 archivos / 0 líneas suprimidas.

### tsconfig analysis
- `strict: true` ✓ (línea 9)
- `noImplicitAny: true` ✓ (línea 10, redundante con strict)
- `noUncheckedIndexedAccess: NOT SET` ⚠ (default false). `metrics-store.ts:64` `(m.spectrum as number[])` y `state.ts:132` indexed accesses dependen de esto.
- `noImplicitOverride: NOT SET` ⚠
- `exactOptionalPropertyTypes: NOT SET` ⚠. `auth.ts:17` `status?: UserStatus` con comment sobre distinción que beneficiaría.
- `isolatedModules: NOT SET` ⚠ (Vite/esbuild transpila per-file; protege cross-file type-only assumptions)
- `target: ES2022` ✓
- `module/moduleResolution: ESNext / bundler` (aceptable para Vite; reference usa NodeNext para Node libs)
- `skipLibCheck: true` ⚠ (reference: false). Minor con solo `@types/node` y `vite` como deps.
- `declaration: false` (reference: true). Aceptable: app, no lib publicada.
- `noUnusedLocals: false` ⚠, `noUnusedParameters: false` ⚠ (AGENTS.md §7 compensa con disciplina manual — los "17 void x; perks" removidos, VERIFICADO: `grep -rEn "^\s*void [a-zA-Z_]+;\s*$"` returned nothing)
- `allowJs: false` ✓
- `forceConsistentCasingInFileNames: true` ✓
- `include: src/**/*.ts` — no `.tsx`, pero 0 `.tsx` files (VERIFICADO: `find src -name "*.tsx"` → nothing), moot.

### Critical Issues
None. `tsc --noEmit` pasa clean, no `@ts-nocheck`, no NameError-class type holes que compilan.

### Warnings

**W1 — Missing strict compiler flags (tsconfig gaps): `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `isolatedModules`**
`frontend/tsconfig.json:2-20` — estos 4 flags del reference tsconfig ausentes.
Why: Array indexing y optional props no tan tight como podrían. `exactOptionalPropertyTypes` forzaría la `auth.ts:17` `status?` distinción que el comment documenta.
Fix: add los 4 flags, re-run `tsc --noEmit`, fix nuevos errores (likely low-count dado baseline clean).

**W2 — `any` usage concentrado en 6 archivos legacy-ported (121 matches, 67 de los cuales `as any`)**
`src/features/canvas/master-console.ts` (25 `as any`), `src/features/canvas/visualizer-helpers.ts` (25 `as any` + ~20 `: any` params), `src/features/mastering/reference-mastering.ts` (8 `as any`), `src/features/canvas/params-builder.ts` (5 `as any`), `src/features/pro/premium-suite.ts` (3 `as any` + ~18 `: any` params como `premium-suite.ts:123` `function drawGoniometerFrame(canvas: any, ctx: any, size: any, dataL: any, dataR: any, pearson: any = 0)`), `src/features/audio/mixer-engine.ts:539` `function lgmdm(): any`.
Why: Estos archivos se self-identifican como legacy ports (visualizer-helpers.ts comment "DOM cache centralizado en 00-api.js"; audio-tap.ts:280 los llama "@ts-nocheck consumers"). Type-eran el `window.LGMDM` global. Los pro widgets bien-tipados (`saturation.ts`, `loudness-penalty.ts`) usan el safe pattern `window as Window & { LGMDM?: SpecificType }` — prueba que el proyecto conoce el pattern pero no migró estos 6.
Fix: Reemplazar `lgmdm(): any` con file-local `LgmdmGlobal` slices (como `saturation.ts:84-96`); type canvas helpers params como `HTMLCanvasElement | null`, `CanvasRenderingContext2D | null`, `Float32Array`. Gradual, no pragma needed.

**W3 — Non-null assertions (`!.`): 609 occurrences**
`src/features/mastering/reference-mastering.ts` ~17 (`refWs!.send`, `container!.appendChild`, `st.jobs!.reference`, `abBtn!.textContent`...), `src/features/audio/timeline-meters.ts:286-287` `(flat as FlatTelemetry).chain_meters!.meters_timeline`, `src/features/ai/assistant.ts:428-429` `aside!.scrollHeight - aside!.scrollTop`.
Why: `!.` asserts non-null sin runtime check; if element missing code throws en runtime donde `!.` aparece. tsc acepta, no type errors, pero defeat strict null checks en call site. Muchos siguen `byId`/`getElementById` que podría returnar `null`.
Fix: Preferir `const el = byId('x'); if (!el) return; el.appendChild(...)` o usar `requireById` (ya en `dom.ts:88`) para contract-required elements.

**W4 — No `satisfies` operator usage (0 occurrences)**
`grep -rn "satisfies " frontend/src/` → 0.
Why: `satisfies` (TS 4.9+) deja assert value conforma type sin widening — útil para `SLIDERS_META` array (`data/sliders-meta.ts:7`) y `Object.freeze` namespaces en `state.ts:368`, `utils.ts:192`, `audio-engine.ts:49`. Actualmente rely on annotated type o `as` casts.
Fix: Opcional modernización, no correctness issue.

**W5 — No branded types for domain IDs**
No `type JobId = string & { __brand: 'JobId' }`-style. `state.ts:115` `currentJobId: string | null`, `api.ts` endpoints take plain `string`.
Why: `jobId` y `libraryId` son ambos `string` e intercambiables en el type system — typo mixing compila.
Fix: Opcional; branded types para `JobId`, `LibraryId`, `SessionId` si domain modeling hardening deseado.

### What's Done Well
- **`tsc --noEmit` pasa con 0 errors** contra real tsconfig (VERIFICADO). AGENTS.md §2 claim "0 files / 0 lines suppressed" es **accurate** (VERIFICADO).
- **No enums** (VERIFICADO — `grep -rEn "^enum | enum [A-Z]"` returned nothing). String-literal union types: `auth.ts:8-9` `UserRole = 'admin' | 'user'`, `UserStatus = 'pending' | 'approved' | 'rejected'`; `audio-tap.ts:28` `sourceType: 'custom-node' | 'ab-node' | 'mixer' | 'media-element' | null`. ✓
- **Discriminated unions**: `audio-tap.ts:22-39` `AudioTap` con `sourceType` discriminant; `auth.ts` role/status unions.
- **Type guards / Annotated pattern**: `metrics-store.ts:55` `function isSpectrum(value: unknown): value is Spectrum`; `api.ts:271` `(m): m is string => Boolean(m)` filter predicate; `api.ts:147` `isFormDataBody(body: unknown): boolean`.
- **Explicit return types en todas public core APIs**: `api.ts`, `state.ts`, `utils.ts`, `dom.ts`, `audio-tap.ts`, `metrics-store.ts`, `audio-engine.ts` — every exported function tiene `: ReturnType`.
- **Safe `as` casts (32 occurrences) son correct pattern**: `window as Window & { LGMDM?: SpecificType }` para global augmentation (`loudness-penalty.ts:93`, `saturation.ts:17`), `document.getElementById(id) as HTMLCanvasElement | null` para querySelector narrowing. Necesarios, no violations.
- **`unknown` over `any` para untrusted payloads**: `analysis/view.ts:25` comment explicit "`unknown` (nunca `any`)"; `api.ts:248-275` `parseResponse` y `extractDetail` usan `unknown` y narrow con type guards. ✓
- **Perks rule enforced (AGENTS.md §7)**: 0 `void x;`-style unused-silencing (VERIFICADO). `state.ts:140-145` comment documenta 17 perks removidos.
- **`declare global` augmentation** consistente (`state.ts:68-104`, `utils.ts:215-228`, `api.ts` via local slices, `view.ts:85-91`) — correct way to type `window.LGMDM` bridge.
- **`Object.freeze` + `Readonly<>`** para constants y namespaces (`sliders-meta.ts:7` `readonly SliderMetaEntry[]`, `audio-tap.ts:14` `BAND_SPECS: readonly BandSpec[]`, `state.ts:368` `Object.freeze`).
- **Error type discriminated**: `api.ts:20-24` `ApiError extends Error` con `status: number` y optional `code`, named per status (`ApiServerError`/`ApiClientError`).

### Recommended Fixes (priority order)
1. **Enable los 4 missing strict flags** (`noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `isolatedModules`) en `tsconfig.json` y fix nuevos errores. Likely low-count dado baseline clean.
2. **Migrar los 6 legacy `any`-heavy files** (`master-console.ts`, `visualizer-helpers.ts`, `reference-mastering.ts`, `params-builder.ts`, `premium-suite.ts`, `mixer-engine.ts`) al `window as Window & { LGMDM?: LocalSlice }` pattern ya usado por pro widgets. Reemplazar `function lgmdm(): any` con `function lgmdm(): LgmdmGlobal`. Reemplazar `: any` params en canvas helpers con concrete DOM/Web Audio types.
3. **Reducir non-null assertions** en `reference-mastering.ts` (17) y `assistant.ts` — prefer early-return null guards o `requireById`.
4. *(Optional)* Adopt `satisfies` en `SLIDERS_META` y `Object.freeze` namespaces.
5. *(Optional)* Introducir branded types para `JobId`/`LibraryId`/`SessionId`.

### Verification log
- `read frontend/tsconfig.json`, `package.json`, `vite.config.ts` — full.
- `grep -rn "@ts-nocheck" frontend/ --include="*.ts" --include="*.tsx" | wc -l` → `4`; full grep shows all 4 en comments. 0 directives.
- `cd frontend && /root/frontend/node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` → exit 0, no output. (`npx tsc` falló: "This is not the tsc command you are looking for" — `node_modules` no instalado en worktree.)
- `grep -rn ": any\b\|<any>\|as any\| any\[\]" frontend/src/ --include="*.ts" --include="*.tsx" | wc -l` → `121`.
- `grep -rn "as any" frontend/src/ --include="*.ts" --include="*.tsx" | wc -l` → `67`; per-file: master-console 25, visualizer-helpers 25, reference-mastering 8, params-builder 5, premium-suite 3, mixer-engine 1.
- `grep -rn " as [A-Z]" frontend/src/ --include="*.ts" --include="*.tsx" | wc -l` → `32` (safe specific-type casts).
- `grep -rEn "^enum | enum [A-Z]" frontend/src/ --include="*.ts" --include="*.tsx"` → no output (0 enums).
- `grep -rn "satisfies " frontend/src/ --include="*.ts" --include="*.tsx" | wc -l` → `0`.
- `grep -rn "\!\." frontend/src/ --include="*.ts" --include="*.tsx" | wc -l` → `609`.
- `grep -n "type-coverage" frontend/package.json` → no output (not installed).
- `grep -rEn "^\s*void [a-zA-Z_]+;\s*$" frontend/src/ --include="*.ts" --include="*.tsx"` → no output (0 perks).

### Honest gaps (NO VERIFICADO)
- **`npx tsc --noEmit` no corrió as-is**: `node_modules` no instalado en worktree (`npm install` no run). Corrí tsc via binary de `/root/frontend/node_modules/typescript/bin/tsc` (v5.9.3, matches `package.json` `^5.0.0`). Path diferente pero mismo compiler version y project `tsconfig.json`. Resultado (exit 0, 0 errors) debería ser equivalente; si querés exact `npx tsc --noEmit` de AGENTS.md §2, run `npm install` primero en `frontend/`.
- **45/64 files no full read** (mostly `src/features/**`). Assessment via grep counts + 2 sampled pro widgets, no full reads. `any` count captured por grep; quality de type definitions solo inferred de los 2 samples (saturation, loudness-penalty), ambos well-typed.
- **No runtime/Playwright verification**: static type audit only. No app load ni console errors check (AGENTS.md §2 menciona Playwright 0-console-error como verificación separada).
- **`type-coverage` no medido**: tool no en `devDependencies`; exact % typed expressions ASUMIDO from grep.
- **Incremental cache / build performance no tested**: single cold `--noEmit`; no `--incremental` ni project-reference behavior (project no references configured).
- **Declaration files**: `declaration: false` → no `.d.ts` emitidos. Para app fine; no chequeé si algún consumer los espera (NO VERIFICADO).

---

## Fixes consolidados por prioridad

> **Nota:** Todos los fixes al backend requieren OKI + excepción nominada (AGENTS.md §5). El backend es READ-ONLY. Fixes al frontend también requieren OKI salvo `AUDITORIA-*.md` (exento).

### CRITICAL (bugs de signal-integrity o correctness VERIFICADO)

| # | Fix | Archivo:line | Skill que lo encontró | Tipo |
|---|-----|--------------|----------------------|------|
| 1 | **`/ws/ref-stream` PCM format mismatch** — pasar `pcm_format="int16"` en `streaming.py:664` (one-line), O cambiar frontend `reference-mastering.ts:432` a `Float32Array`. Actualmente reproduce noise a half-speed. | `backend/routers/streaming.py:664` vs `frontend/src/features/mastering/reference-mastering.ts:432` | signal-flow | backend O frontend |
| 2 | **Complete FIX K6 en `/master/sync`** — declarar `limiter_ceiling` en route O convertir `ceiling_db`→`limiter_ceiling` en `_run_mastering_sync` antes del filter. Actualmente ceiling del usuario silently descartado (contradice AGENTS.md §3). Actualizar AGENTS.md para match realidad. | `backend/routers/mastering.py:280-288` + `backend/mastering.py:4653-4807` | signal-flow + resilience | backend |
| 3 | **`dynamic_resonance_suppressor` OLA normalization (+2.5 dB)** — agregar `* window[:length]` en `advanced_dsp.py:244` manteniendo divisor 1.5, O cambiar divisor a `sum(window)/hop`=2.0. | `backend/advanced_dsp.py:244` | dsp-algorithm | backend |
| 4 | **`phantom_sub_bass` OLA normalization (+2.5 dB)** — cambiar divisor en `advanced_dsp.py:633` a `sum(window)/hop`=2.0. | `backend/advanced_dsp.py:633` | dsp-algorithm | backend |
| 5 | **`reverb.apply_convolution_reverb` timing misalignment** — `mode='full'[:len(dry)]` en vez de `mode='same'`, O realinear wet. Actualmente reverb precede al dry. | `backend/reverb.py:192` | dsp-algorithm | backend |
| 6 | **`mixer.py:430` double limiter con divergent ceilings** — remover segundo `limiter()` (rely on chain), O assert `master_limiter_ceiling == chain_params["limiter_ceiling"]` + warn. | `backend/mixer.py:423-430` | signal-flow + resilience | backend |
| 7 | **`streaming_engine.py:285` hard clip → soft-sat O state carryover** — reemplazar `np.clip(block, -1.0, 1.0)` con `np.tanh(block)` (soft-sat no fold), Y/O refactor `limiter` para carry `prev` state across chunks. Parchea overshoot del limiter reset por chunk → fold-back aliasing. | `backend/streaming_engine.py:285` + `backend/mastering.py:822` | resilience + signal-flow | backend |
| 8 | **`/master/reference` async roto** — `_run_reference_job` (mastering.py:573-602) pasa `reference={...}` a `process_audio` que no lo acepta → `TypeError`. Routear a `process_audio_with_reference` o drop kwarg. | `backend/mastering.py:573-602` | signal-flow | backend |

### HIGH (resilience/efficiency, VERIFICADO en código)

| # | Fix | Archivo:line | Skill |
|---|-----|--------------|-------|
| 9 | **Denormal flush en numba loops** — `if abs(prev) < 1e-40: prev = 0.0` en `_smooth_envelope_numba`, `_smooth_envelope_pdr_numba`, `_limiter_gain_numba` (mastering.py:758,781,946,965) y `_simple_highpass` (advanced_dsp.py:663). Risk CPU spike en fade-out >80s. | `backend/mastering.py:758,781,946,965`; `backend/advanced_dsp.py:663` | dsp-review + dsp-algorithm + resilience | backend |
| 10 | ~~**`multiband_compressor` split no sum-flat**~~ — ❌ **FALSO POSITIVO, NO APLICADO**. Verificado empíricamente con `sosfreqz`: `butter(4)`+`sosfiltfilt` suma EXACTAMENTE flat (0.000 dB deviation) porque `sosfiltfilt` cuadra magnitud y Butterworth LP/HP son power-complementary. El "+3 dB bump" solo existe para causal `sosfilt`, no `sosfiltfilt`. El fix propuesto (`butter(2)`+double-`sosfiltfilt` = LR4) daría -6 dB dip (regression). El agente dsp-algorithm-guide se negó a aplicar el fix (AGENTS.md #1/#10/#11). | `backend/mastering.py:3812-3815` | dsp-algorithm | NO APLICADO (bug falso) |
| 11 | **Hoist `edges` y precompute bin→band masks fuera del per-chunk loop** — `streaming_engine.py:215,217,223` recomputados cada chunk (idénticos). One-line move. | `backend/streaming_engine.py:215-223` | dsp-review | backend |
| 12 | **`phantom_sub_bass` input DC-block** — `audio = _simple_highpass(audio, sr, 20.0)` al inicio. DC infla `sub_env` → harmonics mal escalados. | `backend/advanced_dsp.py:555` | resilience | backend |
| 13 | **LUFS gain before limiter** — aplicar `_lufs_gain_db` como `input_gain_db` al chain params en `routers/streaming.py` antes del processing, no después en PCM. Actualmente si gain positivo excede ceiling → `np.clip` hard catch. | `backend/routers/streaming.py:393-402` | resilience | backend |
| 14 | **Frontend mono splitter** — query `source.channelCount` en `audio-tap.ts:149`, crear `ChannelSplitter(min(2, channelCount))` o branch analyser wiring para mono. Actualmente mono sources muestran false "hard-left" image. | `frontend/src/core/audio-tap.ts:149` | signal-flow | frontend |

### MEDIUM (UI/efficiency, VERIFICADO en código)

| # | Fix | Archivo:line | Skill |
|---|-----|--------------|-------|
| 15 | **Per-frame allocs en `master-visual-suite.ts` waterfall** — hoist `freqData` (línea 805) a module scope, reallocate solo si `frequencyBinCount` cambia (patrón `premium-suite.ts:1448`). Ring buffer de 30 slots pre-allocated para `slice` (línea 798). | `frontend/src/features/canvas/master-visual-suite.ts:798,805` | webaudio + dsp-review | frontend |
| 16 | **Per-frame allocs en `master-console.ts` EQ response** — hoist `freqs` (381), `dbOut` (280), `filters` (330) a module scope con length-guarded reallocation (mirror `state.timeBuf:183`). | `frontend/src/features/canvas/master-console.ts:280,330,381` | webaudio | frontend |
| 17 | **`premium-suite.ts` per-frame DOM re-parse** — cachear last-written `corr`/`verdict` por band en `card.innerHTML` (línea 1023), solo escribir si cambió (o `textContent` en child nodes static). Pool de 240 goniometer particles (líneas 180-188). | `frontend/src/features/pro/premium-suite.ts:180-188,1023` | webaudio | frontend |
| 18 | **`audio_clipper` hard mode sin oversampling** — agregar 2× oversampling antes de `np.clip` (mastering.py:1404) para suprimir aliasing. | `backend/mastering.py:1404` | dsp-algorithm | backend |
| 19 | **`measure_lufs_integrated` short-audio path sin gating** — aplicar -70 LUFS absolute gate en fallback (mastering.py:1117-1126) para consistencia con long-audio path. | `backend/mastering.py:1117-1126` | dsp-algorithm | backend |
| 20 | **`phase_rotation` causal vs zero-phase mismatch** — aplicar all-pass al residual too, o usar zero-phase all-pass approximation, para evitar comb-filter en band edges. | `backend/mastering.py:7683` | dsp-algorithm | backend |
| 21 | **Soft-knee en dynamic_eq/transient_shaper clamps** — reemplazar `np.maximum(gr_db, -max_reduction_db)` (mastering.py:2186) y `np.maximum`/`np.minimum` (transient_shaper 2221-2222) con soft-taper versions para evitar kinks → clicks. | `backend/mastering.py:2186,2221-2222` | resilience | backend |
| 22 | **Reverb wet normalization** — normalizar wet a dry RMS/peak ratio, no peak 1.0 absoluto (reverb.py:196-197). Para dry quiet, wet domina; para dry loud, mix puede clip. | `backend/reverb.py:195-197` | signal-flow + dsp-algorithm | backend |
| 23 | **`_apply_spectral_tilt` docstring miente** — actualizar a "1st-order LP/HP at -3 dB point" en vez de "shelving slope 6 dB/oct" (dsp_chain.py:32-95). | `backend/dsp_chain.py:32-95` | dsp-algorithm | backend |
| 24 | **`advanced_dsp` output hard-clip** — reemplazar `np.clip(-1,1)` (advanced_dsp.py:101) con tanh soft-clip o 5ms lookahead limiter para todos los 10 `/dsp/*` endpoints. | `backend/advanced_dsp.py:101` | signal-flow | backend |
| 25 | **Dead `meters*` state en `state.ts`** — remover declaraciones (126-132) y teardown branch en `meters-dashboard.ts:339-351`, o documentar como reserved. Leftover de implementación removida, contradice AGENTS.md §7. | `frontend/src/core/state.ts:126-132` + `frontend/src/features/workspace/meters-dashboard.ts:339-351` | webaudio | frontend |

### LOW (type-safety/quality, VERIFICADO en código)

| # | Fix | Archivo:line | Skill |
|---|-----|--------------|-------|
| 26 | **Enable 4 missing strict flags** en `tsconfig.json`: `noUncheckedIndexedAccess`, `noImplicitOverride`, `exactOptionalPropertyTypes`, `isolatedModules`. Re-run `tsc --noEmit`, fix nuevos errores (likely low-count dado baseline clean 0 errors). | `frontend/tsconfig.json:2-20` | typescript-pro | frontend |
| 27 | **Migrar 6 legacy `any`-heavy files** (`master-console.ts`, `visualizer-helpers.ts`, `reference-mastering.ts`, `params-builder.ts`, `premium-suite.ts`, `mixer-engine.ts`) al `window as Window & { LGMDM?: LocalSlice }` pattern ya usado por pro widgets. Reemplazar `lgmdm(): any` con `lgmdm(): LgmdmGlobal`. Reemplazar `: any` canvas params con concrete DOM/Web Audio types. 121 `any` total, 67 `as any`. | `frontend/src/features/canvas/*`, `frontend/src/features/pro/premium-suite.ts`, `frontend/src/features/audio/mixer-engine.ts` | typescript-pro | frontend |
| 28 | **Reducir non-null assertions** (609 `!.`) — prefer early-return null guards o `requireById` (ya en `dom.ts:88`). Concentrados en `reference-mastering.ts` (17), `assistant.ts`, `timeline-meters.ts:286-287`. | `frontend/src/features/mastering/reference-mastering.ts`, `frontend/src/features/ai/assistant.ts`, `frontend/src/features/audio/timeline-meters.ts` | typescript-pro | frontend |
| 29 | **Streaming chunk state carry** — pasar compressor/limiter state dicts a `apply_mastering_chain` y re-seed por chunk (actualmente reset cada chunk → GR jumps en edges). Lower priority (OLA mitigates). | `backend/streaming_engine.py:114-127` + `backend/mastering.py` (limiter state) | signal-flow + resilience | backend |
| 30 | **LUFS gain fade** — ramp `_lufs_gain_db` ~50ms en `routers/streaming.py:393-414` en vez de hard step. Actualmente level step mid-stream sin fade. | `backend/routers/streaming.py:393-414` | signal-flow | backend |
| 31 | **`polynomial_inflator` sin oversampling** — agregar ≥2× oversampling antes del Chebyshev/tanh (advanced_dsp.py:59-128) para suprimir alias en content near Nyquist. | `backend/advanced_dsp.py:59-128` | dsp-algorithm | backend |
| 32 | **`harmonic_saturation` polyphase delay mismatch** — compensar group delay del `resample_poly` round-trip (mastering.py:2284-2286) para que wet no esté sub-sample delayed vs dry. | `backend/mastering.py:2284-2286` | dsp-algorithm | backend |
| 33 | **`reverb_simple` tail truncation** — `mode='full'[:len(audio)]` (mastering.py:1373) trunca reverb tail. Considerar extender o documentar limit. | `backend/mastering.py:1373` | dsp-algorithm | backend |
| 34 | **`_synthesize_ir` nombre misleading** — docstring dice "FDN simplificado" pero es suma de 4 combs sin mixing matrix (reverb.py:72-119). Actualizar docstring a "Schroeder comb sum". | `backend/reverb.py:72-119` | dsp-algorithm | backend |
| 35 | **Adopt `satisfies` operator** en `SLIDERS_META` (`data/sliders-meta.ts:7`) y `Object.freeze` namespaces (`state.ts:368`, `utils.ts:192`, `audio-engine.ts:49`). 0 usos actualmente. | `frontend/src/data/sliders-meta.ts:7` y otros | typescript-pro | frontend |
| 36 | **Branded types para domain IDs** — `JobId`, `LibraryId`, `SessionId` como `string & { __brand: '...' }` para prevenir typo mixing. | `frontend/src/core/state.ts:115`, `frontend/src/core/api.ts` | typescript-pro | frontend |
| 37 | **`/ws/master-stream` orphaned** — verificar si endpoint debe usarse o remover. Si frontend usa `preview_service.PreviewRenderer` (app.py:510) en su lugar, documentar. | `backend/routers/streaming.py:194` | signal-flow | backend O frontend |
| 38 | **`/analysis` y `/analyze` redundantes** — consolidar o documentar diferencia (analysis.py:45,72). | `backend/routers/analysis.py:45,72` | signal-flow | backend |

---

## Métricas de calidad que SHOULD be tested (audio-dsp-testing companion)

> Ningún agente ejecutó audio ni midió runtime. Estas son las pruebas que verificarían cada finding:

- **Clicks at chunk boundaries** (C7): sine + transient en boundary, medir discontinuities.
- **DC offset in/out** (phantom_sub): audio con DC conocido, medir DC en output y `sub_env`.
- **True-peak overshoot per chunk** (C7): hot audio en 4s chunks, medir true-peak en first 50ms.
- **Denormal CPU on fade-out** (#9): 90s silence tail, medir wall-clock de `apply_mastering_chain`.
- **Aliasing after hard clip** (C7): near-nyquist sine que overshoots, medir spectral content arriba.
- **Ceiling compliance** (C1): `ceiling_db=-1.0` a `/master/sync`, medir true-peak output (debería ≤-1.0 dBTP pero default 0.95≈-0.45).
- **Limiter GR curve smoothness** (#21): signal que hit `max_reduction_db` rapid, medir GR derivative para kinks.
- **Double-limiter ceiling divergence** (C6): `chain limiter_ceiling=0.89` + `master_limiter_ceiling=0.95`, medir true-peak.
- **OLA normalization level** (C3, C4): medir output level de `dynamic_resonance_suppressor`/`phantom_sub_bass` vs input, debería ser +2.5 dB alto.
- **Reverb timing** (C5): impulse en dry, medir wet onset time — debería ser ≥0 (post-dry), no <0 (pre-dry).
- **`/ws/ref-stream` audible check** (C2): conectar WS, reproducir, confirmar noise vs audio correcto.

---

## Estado final

- **6/6 agentes completaron**, cada uno con su skill único asignado.
- **9 bugs críticos VERIFICADO en código** (no runtime) listados arriba.
- **0 fixes aplicados** — todos requieren OKI + excepción nominada (backend READ-ONLY, frontend OKI salvo docs).
- **Archivo escrito sin OKI** — exento según AGENTS.md §5 (`AUDITORIA-*.md`).
- **Limitación compartida**: ningún agente ejecutó audio ni midió runtime. Todos los "+2.5 dB", "aliasing", "denormal risk", "overshoot" son ASUMIDO desde lectura de código, no medidos. Las métricas de la sección anterior son las que verificarían cada finding.
- **AGENTS.md §2 claim sobre FIX K6 es INEXACTO**: afirma "FIX K6 ya agrega `ceiling_db`" pero 2 agentes (signal-flow + resilience) VERIFICADO que el backend no lo aplica. Recomendación: actualizar AGENTS.md §3 para match realidad, o aplicar el fix backend.
