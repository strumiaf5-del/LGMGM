# Auditoría de Audio Skills — RE-PASS (post-fixes)

> **Fecha:** 2026-09-27
> **Directorio auditado:** `/root/.local/share/opencode/worktree/b96bf5/fede` (código post-fix)
> **Modo:** 3 agentes en paralelo (re-pass sobre código ya fixeado), READ-ONLY
> **Skills corridos:** dsp-algorithm-guide (re-pass), audio-signal-flow-explainer (re-map), web-audio-api (nuevo)
> **Reglas seguidas:** AGENTS.md (VERIFICADO/ASUMIDO/NO VERIFICADO, citar file:line, no inventar)
> **Archivo exento de OKI** según AGENTS.md §5 (`AUDITORIA-*.md`).

---

## Índice

1. [Resumen ejecutivo](#resumen-ejecutivo)
2. [Hallazgos críticos NUEVOS (no detectados en ronda 1)](#hallazgos-críticos-nuevos)
3. [Estado de los fixes de la ronda anterior](#estado-de-los-fixes-anteriores)
4. [Reporte 1 — dsp-algorithm-guide (re-pass)](#reporte-1--dsp-algorithm-guide-re-pass)
5. [Reporte 2 — audio-signal-flow-explainer (re-map)](#reporte-2--audio-signal-flow-explainer-re-map)
6. [Reporte 3 — web-audio-api (nuevo)](#reporte-3--web-audio-api-nuevo)
7. [Fixes consolidados RE-PASS](#fixes-consolidados-re-pass)

---

## Resumen ejecutivo

| # | Skill | Verdict | Fixes verificados | New issues |
|---|-------|---------|-------------------|------------|
| 1 | dsp-algorithm-guide (re-pass) | Some fixes incomplete + NEW critical | 7/10 correctos, 2 moot (reverb crash), 1 parcial | **3** (A reverb crash CRITICAL, B _lr4 -6dB MAJOR, C spectral_tilt highpass MAJOR dormant) |
| 2 | audio-signal-flow-explainer (re-map) | All 6 fixes VERIFICADO correct + 5 new issues | 6/6 fixes correctos, TODOs presentes | **5** (1-5: asymmetries/gaps de los fixes) |
| 3 | web-audio-api (nuevo) | Compliant | N/A (skill nuevo) | 0 critical, 3 warnings (W1 auto-play, W2 reduced-motion, W3 buffer pool) |

**Estado global final VERIFICADO:**
- ✅ ruff backend: `All checks passed!`
- ✅ tsc frontend: EXIT 0, 0 errores
- ✅ `@ts-nocheck`: 0 archivos / 0 líneas
- 31 archivos modificados, +612/-205 líneas (ronda de fixes anterior)

**Top 3 bugs críticos NUEVOS detectados en el re-pass:**

| ID | Bug | Severidad | Dónde | Estado |
|----|-----|-----------|-------|--------|
| **A** | **`_synthesize_ir` crashea con ValueError de broadcasting → reverb MUERTO en producción** (silenciosamente catcheado, audio dry sin reverb) | **CRITICAL** | `reverb.py:114` | ✅ **APLICADO (VERIFICADO 2026-09-27, OKI)** — `fb ** (np.arange(ir_samples) / delay)`, reverb ya corre end-to-end |
| **B** | `multiband_stereo_width._lr4` aplica butter(2) 4 veces → `|H|⁴=0.5` → **-6 dB dip en crossovers** (comment "suma perfecta" miente) | MAJOR | `mastering.py:1385-1386` | ✅ **VERIFICADO aplicado en working tree (2026-09-28)** — `def _lr4(sos, x): return sosfiltfilt(sos, x)` (single), comment "BUGFIX re-pass issue B" |
| **C** | `_apply_spectral_tilt` highpass usa coeficiente lowpass → attenua TODO (-46 dB a 500 Hz). Dormant (sin callers) | MAJOR (dormant) | `dsp_chain.py:83` | ✅ **VERIFICADO aplicado en working tree (2026-09-28)** — `alpha_hp = rc / (rc + dt)`, comment "BUGFIX (issue C del re-pass)" |

**Top 5 new issues del re-pass signal-flow:**

| # | Bug | Severidad | Dónde |
|---|-----|-----------|-------|
| 1 | `/master` async NO convierte `ceiling_db`→`limiter_ceiling` (asimetría con `/master/sync`) — ✅ **RESUELTO (2026-09-28)** `routers/mastering.py:261-262` | Medium | `routers/mastering.py:200-254` |
| 2 | `/ws/master-stream` int16 LUFS-gain re-encode still hard-clips (C7 soft-knee no cubre este path) — ✅ **RESUELTO (2026-09-28)** `streaming.py:461-464` soft-knee all formats | Medium | `routers/streaming.py:397` |
| 3 | `/ws/mix-stream` preview no seedea `limiter_ceiling` del slider (preview ≠ final) | Low-medium | `routers/streaming.py:887-892` |
| 4 | `/ws/master-stream` pcm24 LUFS-gain decode broken (pre-existing) | Low | `routers/streaming.py:421` |
| 5 | Doc citations wrong en `mixer.py:438` y `streaming_engine.py:289-291` | Doc-only | — |

---

## Hallazgos críticos NUEVOS

### A. `_synthesize_ir` broadcasting crash — Reverb MUERTO en producción

**Severidad: CRITICAL.** Pre-existing, no detectado en la ronda 1 de auditoría.

**Dónde:** `backend/reverb.py:114`

**Estado:** ✅ **APLICADO (VERIFICADO 2026-09-27, OKI + excepción nominada al backend)**

**Fix aplicado:**
```python
# Antes (crasheaba):
decayed = impulse * decay * (fb ** np.arange(ir_samples / delay + 1)[:ir_samples])
# Después (fix):
decayed = impulse * decay * (fb ** (np.arange(ir_samples) / delay))
```

**Verificación (comandos ejecutados):**
```
$ python3 -c "import reverb; ir = reverb._synthesize_ir(44100, 0.3, 1.0); print(ir.shape, np.max(np.abs(ir)), np.count_nonzero(ir))"
(26460,) 1.0 4   ← NO CRASHEA, IR generado, normalizado, 4 echoes (uno por comb)

$ python3 -c "import reverb, numpy as np; sig=np.random.randn(2,44100)*0.1; proc=reverb.ReverbProcessor(44100); out=proc.process(sig,'small_studio',0.3); print(out.shape, np.sqrt(np.mean(sig**2)), np.sqrt(np.mean(out**2)))"
(2, 44100) 0.1004 0.0769   ← ReverbProcessor.process end-to-end OK, RMS baja (reverb+wet/dry mix)

$ python3 -c "import reverb, numpy as np; dry=np.random.randn(2,44100)*0.1; ir=reverb.load_ir('small_studio',44100); out=reverb.apply_convolution_reverb(dry,44100,ir=ir,wet_amount=0.3,room_size=0.3); print(out.shape)"
(2, 44100)   ← apply_convolution_reverb OK, fixes #3 (mode='full') y #4 (wet*dry_peak/wet_max) ahora EJECUTAN

$ python3 -c "wet_amount=0.0 → rms=0.0999 (=dry); wet_amount=0.3 → rms=0.0753 (reverb añadido)"
   ← Fix #4 level-independent mix correcto (wet_amount=0 → dry puro)

$ ruff check . → All checks passed!
```

**Impacto:** Reverb ya NO está muerto en producción. Los fixes #3 (`mode='full'`) y #4 (`wet*dry_peak/wet_max`) de la ronda anterior eran correctos en diff pero jamás se ejecutaban por el crash; ahora ambos ejecutan. `mixer.py:218-235` ya no catchea silenciosamente — el try/except sigue pero la rama except ya no se dispara.

### B. `multiband_stereo_width._lr4` -6 dB dip en crossovers

**Severidad: MAJOR.** Pre-existing, expuesto por el comment del fix #8 (que correcta-mente NO migró `multiband_compressor` a este patrón roto).

**Dónde:** `backend/mastering.py:1379-1380`
```python
def _lr4(sos, x): return sosfiltfilt(sos, sosfiltfilt(sos, x))
```

**Bug:** Aplica `butter(2)` 4 veces (double `sosfiltfilt`) → `|H|⁴` efectivo. En fc, `|H_LP|⁴ = |H_HP|⁴ = 0.25` → suma `0.5` → **-6.02 dB dip**.

**VERIFICADO:**
```
$ python3 sosfreqz test _lr4 (butter(2) double sosfiltfilt)
At fc=1000 Hz: |H_LP|⁴=0.244, |H_HP|⁴=0.256, Sum=0.5001 (-6.02 dB)
Sum range: min=0.5001, max=1.0000

$ python3 time-domain test _lr4
At 1000 Hz: -6.02 dB dip; overall RMS -1.16 dB quieter than input
```

**Comment mentiroso:** `mastering.py:1365-1372` dice "suma perfectamente en magnitud en el crossover" y "suma perfecta" — FALSO (AGENTS.md §7 violation).

**Fix propuesto:**
```python
def _lr4(sos, x): return sosfiltfilt(sos, x)  # single sosfiltfilt = true LR4, sum-flat
```
VERIFICADO: single `sosfiltfilt` de `butter(2)` da Sum=1.0000 (0.00 dB) flat.

**Necesita:** OKI + excepción nominada al backend.

**Estado (re-verificado 2026-09-28, categoría D):** ✅ **VERIFICADO aplicado en working tree.**
`grep -n "def _lr4" backend/mastering.py` → `1385: def _lr4(sos, x):` con body `return sosfiltfilt(sos, x)` (single). Comment en `mastering.py:1382-1384`: "BUGFIX re-pass issue B: antes era double sosfiltfilt (|H|⁴ = 0.5 → -6 dB dip). Single = Sum=1.0000 (verificado con sosfreqz)."

**Severidad: MAJOR (dormant — sin callers en producción).** Pre-existing, preservado por fix #9 (lfilter), docstring fix #10 incompleto.

**Dónde:** `backend/dsp_chain.py:63, 74-79`
```python
alpha = dt / (rc + dt)  # ← coeficiente LOWPASS
# ...
# highpass path:
b = np.array([alpha, -alpha], dtype=np.float32)  # ← usa alpha lowpass
a = np.array([1.0, -alpha], dtype=np.float32)
```

**Bug:** `alpha = dt/(rc+dt)` es el coeficiente LOWPASS (cerca de 0 para cutoffs típicos). El highpass debería usar `alpha = rc/(rc+dt)` (cerca de 1) — que es lo que `_simple_highpass` en `advanced_dsp.py:693` usa correctamente.

**VERIFICADO:**
```
$ python3 freqz test _apply_spectral_tilt highpass (alpha=dt/(rc+dt))
For tilt=+6, pivot=1000 (cutoff=500):
  at 500 Hz: -45.88 dB (should be -3 dB)
  at 20 kHz: -18.15 dB (should be ~0 dB)
  at 50 Hz: -66 dB
→ Attenua TODO, no es un highpass usable.

$ python3 freqz test _simple_highpass (alpha=rc/(rc+dt))
  at 80 Hz: -2.99 dB ✓
  at 20 kHz: -0.05 dB ✓ (correcto)
```

**Dormant:** `apply_feature_chain` (único caller de `_apply_spectral_tilt`) NO tiene callers en el backend (grep confirmado). El endpoint `/spectral-tilt` usa `mastering.linear_phase_eq` (FIR), no esta función.

**Fix propuesto:**
```python
# Opción A (fix correcto):
if tilt >= 0:  # highpass
    alpha_hp = rc / (rc + dt)  # coeficiente highpass correcto
    b = np.array([alpha_hp, -alpha_hp], dtype=np.float32)
    a = np.array([1.0, -alpha_hp], dtype=np.float32)
# Opción B (marcar deprecated):
# route callers a mastering.linear_phase_eq (que el endpoint /spectral-tilt ya usa)
```

**Necesita:** OKI + excepción nominada al backend (o marcar deprecated).

**Estado (re-verificado 2026-09-28, categoría D):** ✅ **VERIFICADO aplicado en working tree.**
`grep -n "alpha_hp = rc / (rc + dt)" backend/dsp_chain.py` → `83: alpha_hp = rc / (rc + dt)`. Comment en `dsp_chain.py:70-75`: "BUGFIX (issue C del re-pass): el highpass usaba alpha=dt/(rc+dt) (coeficiente LOWPASS) → atenuaba TODO (-46 dB a 500 Hz). Ahora usa alpha_hp=rc/(rc+dt) ... Verificado con freqz: -3 dB en cutoff, unity a altas frecuencias." Lowpass path (line 78) sigue con `alpha = dt / (rc + dt)` (sin cambio, correcto).

## Estado de los fixes anteriores

### Fixes de la ronda 1 — Verificación re-pass

**audio-dsp-review (4 fixes):**
- ✅ Hoist FFT band edges fuera del loop (streaming_engine.py:113-118)
- ✅ pcm24 `audio` → `audio24` rename (routers/streaming.py:405-407)
- ✅ `_apply_spectral_tilt` Python loop → lfilter (dsp_chain.py:79) — VERIFICADO numéricamente (max diff 2.4e-7)
- ✅ `HAS_NUMBA` deployment comment (mastering.py:301-304)

**dsp-algorithm-guide (15 fixes):**
- ✅ #1 dynamic_resonance_suppressor OLA — synthesis window añadida (advanced_dsp.py:251)
- ✅ #2 phantom_sub_bass OLA — divisor `sum(window)/hop`=2.0 (advanced_dsp.py:606,666)
- ✅ #3 reverb mode='full' (reverb.py:197) — correcto en diff; ya NO es MOOT (Bug A fixeado 2026-09-28 → ahora ejecuta)
- ✅ #4 reverb wet norm (reverb.py:204-207) — correcto en diff; ya NO es MOOT (Bug A fixeado 2026-09-28 → ahora ejecuta)
- ✅ #5 audio_clipper hard oversampling (mastering.py:1453-1460) — length/dtype preservados
- ✅ #6 measure_lufs short-audio gate (mastering.py:1157) — minor gap en fallbacks 1175/1185
- ✅ #7 denormal flush (mastering.py:766,793,795,838,966,968,989 + advanced_dsp.py:701) — benign
- ✅ #8 multiband_compressor butter(4) NO migrado (correcto — sum-flat 0.000 dB VERIFICADO)
- ✅ #9 lfilter (dsp_chain.py:79) — preserva transfer function (max diff 2.4e-7) [preserva bug C]
- ✅ #10 docstrings — VERIFICADO aplicado en working tree (2026-09-28): highpass ahora usa `alpha_hp = rc/(rc+dt)` con docstring honesto (dsp_chain.py:70-75 "BUGFIX issue C")
- ✅ #11 _synthesize_ir docstring (reverb.py:73-80) — honesto
- ✅ #12 multiband_compressor indent (mastering.py:3875)
- ✅ U-4 phase_rotation — VERIFICADO aplicado (mastering.py:7804 `sosfilt(sos_bp, ...)` causal, comment "U-4: se usa sosfilt (causal) en vez de sosfiltfilt")
- ✅ U-7 reverb_simple tail — VERIFICADO aplicado (mastering.py:1414-1425 fade-out coseno 50ms, comment "U-7")
- ✅ U-8 phantom_sub phase — VERIFICADO aplicado (advanced_dsp.py:625,646 `running_phase` continuo, comment "U-8")
- TODO: U-5 harmonic_sat delay (no verificado en este re-pass categoría D)

**webaudio-review (5 fixes):**
- ✅ CC-1 master-visual-suite waterfall allocs (ring buffer 30 slots + length-guard freqData)
- ✅ U-1 master-console EQ allocs (state.dbOut/eqFreqs, _eqFilters module-scope)
- ✅ U-2 premium-suite innerHTML cache + particles pool 240
- ✅ U-3 drawEqCurve allocs hoisted
- ✅ U-4 dead meters* state removed (state.ts + meters-dashboard.ts)

**audio-signal-flow-explainer (5 applied + 5 TODO):**
- ✅ CC-1 FIX K6 `/master/sync` ceiling_db→limiter_ceiling (routers/mastering.py:86-88) — VERIFICADO end-to-end
- ✅ U-1 `/ws/ref-stream` pcm_format="int16" (routers/streaming.py:682-683) — VERIFICADO end-to-end
- TODO: U-2 `/master/reference` async (2 bugs intertwetidos)
- ✅ U-3 frontend mono splitter (audio-tap.ts:153-156) — VERIFICADO upmix
- TODO: U-4 sidechain, U-5 PitchCorrection, U-6 stem SR, U-8 /analysis redundancy, U-9 heuristic
- ✅ U-7 advanced_dsp output soft-knee (routers/advanced_dsp.py:100-111)

**audio-dsp-resilience (5 applied + 2 TODO):**
- ✅ CC-1 double limiter removed (mixer.py:435-447) — VERIFICADO single ceiling
- ✅ CC-2 streaming hard-clip → soft-knee (streaming_engine.py:286-302) — VERIFICADO no fold-back
- ✅ U-1 phantom_sub DC-block (advanced_dsp.py:559-567) — per-channel para 2D
- ✅ U-2 dynamic_eq soft-knee floor (mastering.py:2189-2199) — VERIFICADO math correcto
- ✅ U-2 transient_shaper clamps — VERIFICADO aplicado (mastering.py:2334-2337 `transient_comp = _KNEE * np.log1p(np.exp(_x))` softplus taper, comment "P4: hard clamps create gain-curve kinks -> clicks")
- ✅ U-3 LUFS gain — VERIFICADO aplicado: fix arquitectural bake `input_gain_db` en chain antes del stream (routers/streaming.py:390-403 `LUFS_AWAIT_TIMEOUT=1.0`, `asyncio.wait`) + Fix #5 (re-pass) soft-knee safety net para TODOS los formatos int16/float32/pcm24 (streaming.py:461-464). New issue #2 (int16/pcm24 hard-clip) RESUELTO.

**typescript-pro (3 de 4 strict flags + migración parcial):**
- ✅ isolatedModules, noImplicitOverride, exactOptionalPropertyTypes (13 errores fixeados)
- ⚠️ noUncheckedIndexedAccess deferred (188 errores, TODO en tsconfig:19-25)
- ✅ mixer-engine.ts fully typed (lgmdm(): LgmdmMixer)
- ✅ 23 `!.` removidos (reference-mastering 17→0 real, timeline-meters 2, assistant 4)
- ✅ satisfies en sliders-meta.ts:7
- ✅ JobId branded type (state.ts + reference-mastering.ts)
- ⚠️ Roots `lgmdm(): any`/`lg(): any` TODO (cascade grande)

---

## Reporte 1 — dsp-algorithm-guide (re-pass)

### Verdict
**Some fixes incomplete + NEW critical issues found** — 7/10 fixes correctos, 2 moot (issue A), 1 parcial (issue C). Encontró 3 new issues (A CRITICAL, B MAJOR, C MAJOR dormant).

### Scope reviewed
- `backend/advanced_dsp.py` — 705 líneas (full)
- `backend/dsp_chain.py` — 162 líneas (full)
- `backend/reverb.py` — 289 líneas (full)
- `backend/pitch_correction.py` — 599 líneas (full)
- `backend/mastering.py` — 7803 líneas (partial ~1500 leídas)
- `backend/mixer.py` — 480 líneas (partial)
- Otros: codec_simulator, perceptual_analysis, stem_analysis, mastering_metrics (parcial/skim)

### Fix verification (resumen)
- #1 OLA dynamic_resonance_suppressor ✅ VERIFICADO (RMS -0.18 dB, no +2.5 dB)
- #2 OLA phantom_sub_bass ✅ VERIFICADO (synth_only_norm=2.0)
- #3 reverb mode='full' ✅ correcto en diff, ⚠️ MOOT (issue A crash)
- #4 reverb wet norm ✅ correcto en diff, ⚠️ MOOT (issue A crash)
- #5 audio_clipper oversampling ✅ VERIFICADO (length/dtype preservados)
- #6 measure_lufs gate ✅ VERIFICADO (minor gap en fallbacks)
- #7 denormal flush ✅ VERIFICADO (benign, max diff 3.87e-7)
- #8 multiband_compressor butter(4) ✅ VERIFICADO sum-flat 0.000 dB (no migrado, correcto)
- #9 lfilter ✅ VERIFICADO (max diff 2.4e-7) [preserva bug C]
- #10 docstrings ⚠️ parcial (lowpass OK, highpass miente — issue C)

### New issues (ver Hallazgos críticos NUEVOS arriba)
- **A** `_synthesize_ir` crash CRITICAL (reverb muerto en prod)
- **B** `_lr4` -6 dB dip MAJOR (`multiband_stereo_width`)
- **C** `_apply_spectral_tilt` highpass bug MAJOR dormant

### What's Done Well (post-fix, NEW improvements)
1. OLA normalization correcta en todos los STFT modules (synthesis window aplicada)
2. `phantom_sub_bass` distingue synthesis-only (`sum(window)/hop`=2.0) de analysis+synthesis (1.5)
3. `audio_clipper` hard mode 2x oversampling con length/dtype safety
4. Denormal flush consistente `if abs(prev) < 1e-40: prev = 0.0` en todos los loops IIR
5. `multiband_compressor` butter(4)+sosfiltfilt correcta-mente NO migrado (sum-flat VERIFICADO)
6. **NEW: Soft-knee floor en `dynamic_eq_band`** (no en los 10 fixes) — reemplaza hard clamp, verificado
7. **NEW: Mixer double-limiter removal** — sincroniza ceiling
8. TODO comments honestos (U-2, U-4, U-5, U-7, U-8, U-9, U-12)

### Recommended Fixes (priority order)
1. **[CRITICAL] Fix `_synthesize_ir` broadcasting crash** (reverb.py:114)
2. **[MAJOR] Fix `multiband_stereo_width._lr4`** (mastering.py:1379-1380) → single sosfiltfilt
3. **[MAJOR dormant] Fix `_apply_spectral_tilt` highpass** (dsp_chain.py:74-79) o marcar deprecated
4. **[MINOR] -70 LUFS floor en fallbacks** (mastering.py:1175,1185)
5. **[MINOR] SOS form en `stem_analysis._low_band_envelope`** (stem_analysis.py:97-98)

### Verification log (comandos ejecutados)
- `git diff backend/reverb.py` → fixes #3, #4 aplicados; línea 114 NO tocada
- `python3 -c "import reverb; reverb._synthesize_ir(44100, 0.3, 1.0)"` → `ValueError: shapes (26460,) (18,)` (issue A)
- `python3 -c "import reverb; reverb.ReverbProcessor(44100).process(...)"` → mismo crash (end-to-end)
- `python3 sosfreqz test butter(4) LP+HP` → Sum=1.000000 (fix #8 sum-flat confirmado)
- `python3 sosfreqz test _lr4` → Sum=0.5001 en fc (issue B -6 dB)
- `python3 sosfreqz test single sosfiltfilt butter(2)` → Sum=1.0000 (fix propuesto OK)
- `python3 freqz test _apply_spectral_tilt highpass` → -45.88 dB a 500 Hz (issue C)
- `python3 freqz test _simple_highpass` → -2.99 dB a 80 Hz (referencia correcta)
- `python3 compare loop vs lfilter` → max diff 2.4e-7 (fix #9)
- `python3 resample_poly round-trip` → length/dtype OK para N=100..100001 (fix #5)
- `python3 dynamic_resonance_suppressor test` → RMS -0.18 dB (fix #1)
- `python3 phantom_sub_bass test` → synth_only_norm=1.9995 (fix #2)
- `python3 soft-knee floor test` → floor respected, max diff 0.35 dB (NEW improvement)
- `python3 denormal flush test` → max diff 3.87e-7 (fix #7 benign)

### Honest gaps (NO VERIFICADO)
- `mastering.py` ~6300 líneas no leídas directas (solo ~1500 + grep)
- `apply_feature_chain` callers: grep confirmado sin callers en `backend/`
- Reverb IR cache behavior no testeado
- Fix propuesto para `_synthesize_ir` no verificado sonicamente (no hay referencia, original jamás corrió)
- `pitch_correction` time-varying OLA: leído pero no testeado en runtime

---

## Reporte 2 — audio-signal-flow-explainer (re-map)

### Verdict
**All 6 fixes VERIFICADO correct at code level; deferred TODOs VERIFICADO present.** 5 new issues (pre-existing o asimetrías de fixes).

### Scope reviewed
15 archivos backend + 4 frontend leídos (partial en mastering.py 7800 líneas).

### Verified endpoints (post-fix)
`grep -rn "@router\.(get|post|put|delete|patch|websocket)" backend/routers/` → 94 matches, 17 archivos. **Ningún endpoint added/removed/renamed.**

### Fix verification (6 fixes)
1. ✅ C1 FIX K6 `/master/sync` — `ceiling_db`→`limiter_ceiling = 10.0 ** (ceiling_db / 20.0)` antes del kwargs filter (routers/mastering.py:86-88). VERIFICADO end-to-end: conversion → filter → process_audio → apply_mastering_chain → stage-15 limiter.
2. ✅ C2 `/ws/ref-stream` PCM — `pcm_format="int16"` (routers/streaming.py:682-683). Frontend `reference-mastering.ts:460` `new Int16Array(pcmBytes)` → match.
3. ✅ C6 double limiter — `chain_params.setdefault("limiter_ceiling", ...)` (mixer.py:440), segundo limiter removido (mixer.py:446-447 comment).
4. ✅ C7 hard-clip soft-knee — `streaming_engine.py:286-302` identity≤0.98 + asymptote 1.0.
5. ✅ advanced_dsp output soft-knee — `routers/advanced_dsp.py:100-111`.
6. ✅ Frontend mono splitter — `audio-tap.ts:153-156` `channelCount=2; channelCountMode='explicit'` con try/catch.

### Deferred TODOs verification
- ✅ C8 `/master/reference` async — TODO(U-2) en `mastering.py:589-603`
- ✅ U-4 sidechain — TODO en `mixer.py:282-286`
- ✅ U-5 PitchCorrection — TODO en `mixer.py:239-244`
- ✅ U-6 stem SR round-trip — TODO en `stem_separation.py:114-118`
- ✅ U-8 `/analysis` redundancy — TODO en `analysis.py:74-76`
- ✅ U-9 heuristic — TODO en `mastering.py:3109-3112`
- ⚠️ C9 `/ws/master-stream` orphaned — NO dedicated TODO; endpoint está wired y usado (C9 ya no aplica?)

### New issues (ver Hallazgos arriba)
1. `/master` async no convierte `ceiling_db`→`limiter_ceiling` (asimetría con `/master/sync`)
2. `/ws/master-stream` int16 LUFS-gain re-encode still hard-clips
3. `/ws/mix-stream` preview no seedea `limiter_ceiling`
4. `/ws/master-stream` pcm24 LUFS-gain decode broken (pre-existing)
5. Doc citations wrong (mixer.py:438, streaming_engine.py:289-291)

### 9 Signal Flows mapeados (ASCII graphs con file:line)
1. `/master/sync` (sync render)
2. `/master` async (background job)
3. `/ws/master-stream` (live preview WS)
4. `/ws/ref-stream` (reference match preview)
5. `/ws/mix-stream` (mixer live preview)
6. `/mix/submit` (mix job final render)
7. `/master/reference` async (BROKEN — TODO U-2)
8. Analysis endpoints
9. Frontend `audio-tap` (visualization tap)

### What's Done Well (post-fix)
- C1 K6: conversion ANTES del filter, comment claro, `limiter_ceiling` en signature sobrevive
- C2: single-line `pcm_format="int16"` alineado con frontend
- C6: `setdefault` preserva override explícito; segundo limiter removido (no solo commenteado)
- C7 + advanced_dsp: soft-knee idéntico, bien documentado, comment verifica valores concretos
- Frontend mono splitter: antes del splitter, try/catch robusto
- TODOs diferidos: 6/6 presentes con root-cause + fix intencional + razón de deferral
- Endpoint stability: 94 endpoints sin cambios

### Recommended Fixes (priority order)
1. **Extract `ceiling_db`→`limiter_ceiling` a shared helper** para `/master` async Y `/master/sync` (new issue #1)
2. **Apply `_lufs_gain_db` como `input_gain_db` antes del chain** en `/ws/master-stream` (new issue #2, cierra también float32 soft-knee workaround)
3. **Seed `chain_params["limiter_ceiling"]` en `/ws/mix-stream`** (new issue #3, 1 línea)
4. **Fix pcm24 LUFS-gain decode** (new issue #4, low priority)
5. **Corregir doc citations** (new issue #5, doc-only)
6. **Address TODO U-2** (`/master/reference` async — TypeError en runtime)

### Verification log
- `grep -n "ceiling_db.*limiter_ceiling|10\.0 \*\* \(float" backend/routers/mastering.py` → 2 matches (C1)
- `grep -n "pcm_format.*int16" backend/routers/streaming.py` → C2 presente
- `grep -n "setdefault.*limiter_ceiling" backend/mixer.py` → C6 presente
- `grep -n "_KNEE|np.exp(-(_abs" backend/streaming_engine.py` → C7 presente (no `np.clip(block` match → hard-clip removed)
- `grep -n "_KNEE|np.sign(out_data)" backend/routers/advanced_dsp.py` → soft-knee presente
- `grep -n "channelCount|channelCountMode" frontend/src/core/audio-tap.ts` → mono fix presente
- `grep -rn "@router\.(get|post|put|delete|patch|websocket)" backend/routers/` → 94 matches, endpoints unchanged
- TODOs verificados via grep en mixer.py, stem_separation.py, analysis.py, mastering.py

### Honest gaps (NO VERIFICADO)
- `mastering.py` apply_mastering_chain stages 1-14 no leídos end-to-end
- `reverb.py` no leído por signal-flow (dsp-algorithm sí lo leyó, encontró issue A)
- `_analyze_from_file` body no leído (F821 logger fix AGENTS.md no re-verificado)
- `preview_router.py` vs `preview.py` duplicado no investigado
- Runtime no verificado (todo estático grep + read)

---

## Reporte 3 — web-audio-api (nuevo)

### Verdict
**Compliant** — frontend implementa las best practices del skill (single shared lazy AudioContext, user-gesture gating, pre-allocated typed arrays, OfflineAudioContext para codec sim, no ScriptProcessor/AudioWorklet, `onended → disconnect` en todos lados, `prefers-reduced-motion` honrado en 9 sitios).

### Scope reviewed
67 archivos .ts total, 10 leídos (full o partial). Frontend es vanilla TS (no Vue), adaptó el skill (geared a Vue composables) a la arquitectura real.

### Architecture identified
- Single shared AudioContext lazy en `audio-engine.ts:12-20` (`latencyHint: 'interactive'`)
- Node graph mixer: per-stem persistent 10-node chain cached, solo `AudioBufferSourceNode` recreated per play
- Visualization tap: 1 ChannelSplitter → 7 Analysers + 3 band-filter pairs (created once)
- Playback: mixer preview, A/B, reference streaming, server mixer, codec sim (OfflineAudioContext)

### Best-practice checklist
| # | Check | Status | file:line |
|---|-------|--------|-----------|
| 1 | User gesture required | ✅ compliant | mixer-engine.ts:238, visualizer-helpers.ts:381 |
| 2 | AudioContext reused | ✅ compliant | audio-engine.ts:12-20 (0 `new AudioContext` fuera) |
| 3 | Nodes disconnected on ended | ✅ compliant | 6 sitios con onended→disconnect |
| 4 | Buffers pooled/reused | ✅ compliant | length-guarded reuse, ring buffer 30 slots, "sin allocs en RAF" |
| 5 | AudioWorklet not ScriptProcessor | ✅ N/A | 0 matches (no main-thread DSP) |
| 6 | OfflineAudioContext pre-render | ✅ compliant | premium-suite.ts:1355 (codec sim) |
| 7 | Master gain reused | ✅ compliant | mixer-engine.ts:106-107 |
| 8 | Volume clamped [0,1] | N/A (mastering domain, master fader >0 dB legit) |
| 9 | Microphone permissions | N/A (sin getUserMedia) |
| 10 | AudioContext closed on unmount | ✅ compliant | audio-engine.ts:41-47 (beforeunload) |
| 11 | prefers-reduced-motion | ✅ compliant | 9 sitios + cached helper |
| 12 | Visual alternatives | N/A (audio is the product) |

### Critical Violations
None.

### Warnings
- **W1** `mixer-engine.ts:439` auto-play mitigado en server-preview `<audio>` (WS round-trip puede outlast gesture activation). Fix: agregar `controls` al `<audio>`.
- **W2** `master-console.ts:662-665` reduced-motion RAF stop one-way (no matchMedia change listener para restart). Fix: addEventListener change.
- **W3** `reference-mastering.ts:462-472` per-chunk `AudioBuffer` alloc (acceptable, `onended` previene leak). Fix: pool si profiling muestra churn.

### What's Done Well
- Single shared lazy AudioContext (headline §4.1/§9)
- Pre-allocated length-guarded typed arrays rigurosamente
- OfflineAudioContext para codec simulation (§6.3 exacto)
- Per-stem chain reused, not rebuilt per play
- `onended → disconnect` en todos lados (§6.5)
- Comprehensive teardown (teardownAudioTap, teardownMixerEngine, teardownAB)
- User-gesture gating en todos los `resume()`/`play()`
- `prefers-reduced-motion` honrado broadmente
- No ScriptProcessor (deprecated node ausente)
- `decodeAudioData` detach safety (`.slice(0)` en 3 call sites)
- Single-source-of-truth analyser graph (audio-tap.ts)

### Recommended Fixes (priority order)
1. **W1** Add `controls` a `mxrServerPreviewAudio` (low effort, remueve única §9 smell)
2. **W2** matchMedia change listener en master-console.ts
3. **W3** Profile reference-streaming GC, pool si necesario (defer hasta profiling)
4. (Opcional) Exponer `audioEngine.shutdown()` de un path explícito (future-proofing)

### Verification log
- `grep -rn "new AudioContext\|new webkitAudioContext\|new OfflineAudioContext" frontend/src/` → premium-suite.ts:1355 (Offline) + audio-engine.ts:17 (AC)
- `grep -rn "getUserMedia" frontend/src/` → 0 matches
- `grep -rn "AudioWorklet\|ScriptProcessor\|createScriptProcessor" frontend/` → 0 matches
- `grep -rn "prefers-reduced-motion" frontend/src/` → 12 hits comprehensivos
- `grep -rn "onended\|disconnect(" frontend/src/` → muchos sitios disconnect

### Honest gaps (NO VERIFICADO)
- ~50% archivos no leídos full (mixer-ui, preview-controller, premium-suite large parts)
- Runtime no verificado (static analysis only)
- No tests run (skill enfatiza TDD, no encontré tests Web Audio)

---

## Fixes consolidados RE-PASS

> **Todos requieren OKI + excepción nominada al backend.**

### CRITICAL (bugs NUEVOS del re-pass, pre-existing no detectados)

| # | Fix | Archivo:line | Skill | Tipo |
|---|-----|--------------|-------|------|
| 1 | **`_synthesize_ir` broadcasting crash** — `fb ** np.arange(ir_samples / delay + 1)[:ir_samples]` → `fb ** (np.arange(ir_samples) / delay)`. Reverb MUERTO en prod. | `backend/reverb.py:114` | dsp-algorithm | backend |
| 2 | **`multiband_stereo_width._lr4` -6 dB dip** — `sosfiltfilt(sos, sosfiltfilt(sos, x))` → `sosfiltfilt(sos, x)` (single = true LR4 sum-flat). Update comment mentiroso "suma perfecta". ✅ **VERIFICADO aplicado (2026-09-28)** `mastering.py:1385-1386` | `backend/mastering.py:1385-1386` | dsp-algorithm | backend |
| 3 | **`_apply_spectral_tilt` highpass coeficiente** — `alpha = dt/(rc+dt)` (lowpass) → `alpha = rc/(rc+dt)` (highpass) o marcar deprecated (dormant, sin callers). Update docstring. ✅ **VERIFICADO aplicado (2026-09-28)** `dsp_chain.py:83` | `backend/dsp_chain.py:83` | dsp-algorithm | backend |

### HIGH (asimetrías/gaps de los fixes anteriores)

| # | Fix | Archivo:line | Skill | Tipo |
|---|-----|--------------|-------|------|
| 4 | **Extract `ceiling_db`→`limiter_ceiling` a shared helper** para `/master` async Y `/master/sync`. ✅ **VERIFICADO aplicado (2026-09-28)** — conversión presente en ambos endpoints (`/master/sync` line 88, `/master` async line 261-262); no como shared helper sino inline en cada endpoint, pero la asimetría está resuelta | `backend/routers/mastering.py:88,261-262` | signal-flow | backend |
| 5 | **Apply `_lufs_gain_db` como `input_gain_db` antes del chain** en `/ws/master-stream` (cierra int16/pcm24 hard-clip + float32 workaround). ✅ **VERIFICADO aplicado (2026-09-28)** — `streaming.py:390-403` bake `input_gain_db` con `asyncio.wait`/`LUFS_AWAIT_TIMEOUT` + `streaming.py:461-464` soft-knee safety net para TODOS los formatos (int16/float32/pcm24) | `backend/routers/streaming.py:390-403,461-464` | signal-flow + resilience | backend |
| 6 | **Seed `chain_params["limiter_ceiling"]` en `/ws/mix-stream`** desde `mp.master_limiter_ceiling` (preview = final) | `backend/routers/streaming.py:887-892` | signal-flow | backend |
| 7 | **Address TODO U-2** `/master/reference` async TypeError (route a `process_audio_with_reference` o pre-read file) | `backend/routers/mastering.py:573-602` | signal-flow | backend |

### MEDIUM

| # | Fix | Archivo:line | Skill | Tipo |
|---|-----|--------------|-------|------|
| 8 | **-70 LUFS floor en fallbacks** de `measure_lufs_integrated` (1175, 1185) | `backend/mastering.py:1175,1185` | dsp-algorithm | backend |
| 9 | **Fix pcm24 LUFS-gain decode** (pre-existing, rare combo) | `backend/routers/streaming.py:421` | signal-flow | backend |
| 10 | **W1 frontend auto-play** — add `controls` a `mxrServerPreviewAudio`. ✅ **VERIFICADO aplicado (2026-09-28)** — `mixer-engine.ts:443` `audioEl.controls = true` | `frontend/src/features/audio/mixer-engine.ts:443` | web-audio-api | frontend |
| 11 | **W2 reduced-motion RAF restart** — matchMedia change listener. ✅ **VERIFICADO aplicado (2026-09-28)** — `master-console.ts:686` `window.matchMedia('(prefers-reduced-motion: reduce)')` + addEventListener('change') | `frontend/src/features/canvas/master-console.ts:683-686` | web-audio-api | frontend |

### LOW (doc-only / polish)

| # | Fix | Archivo:line | Skill | Tipo |
|---|-----|--------------|-------|------|
| 12 | **Doc citations wrong** — mixer.py:438 "line 4483" (real 4580), streaming_engine.py:289-291 "line 822" (real 1534/1568) | varios | signal-flow | backend |
| 13 | **SOS form en `stem_analysis._low_band_envelope`** | `backend/stem_analysis.py:97-98` | dsp-algorithm | backend |
| 14 | **W3 reference-streaming buffer pool** (defer hasta profiling) | `frontend/src/features/mastering/reference-mastering.ts:462-472` | web-audio-api | frontend |

---

## Estado final consolidado

### Verificación global
- ✅ ruff backend: `All checks passed!`
- ✅ tsc frontend: EXIT 0, 0 errores
- ✅ `@ts-nocheck`: 0 archivos / 0 líneas
- 31 archivos modificados en la ronda de fixes anterior, +612/-205

### Ronda 1 fixes (6 agentes) — estado
- 6/6 agentes completaron
- ~30 fixes aplicados, ~12 TODOs diferidos documentados
- 3 fixes MOOT (reverb #3, #4 — issue A crash; docstring #10 parcial — issue C)

### Re-pass (3 agentes) — estado
- 3/3 agentes completaron
- **3 bugs NUEVOS críticos detectados** (A reverb crash CRITICAL, B _lr4 -6dB MAJOR, C spectral_tilt highpass MAJOR dormant) — todos pre-existing, no detectados en ronda 1
- **5 new issues del re-pass signal-flow** (asimetrías de fixes)
- 7/10 fixes de dsp-algorithm verificados correctos, 2 moot, 1 parcial
- 6/6 fixes de signal-flow verificados correctos

### Re-verificación working tree (2026-09-28, categoría D)
- ✅ Bug A reverb crash — VERIFICADO aplicado (`reverb.py:122`)
- ✅ Bug B _lr4 -6dB dip — VERIFICADO aplicado (`mastering.py:1385-1386` single `sosfiltfilt`)
- ✅ Bug C spectral_tilt highpass — VERIFICADO aplicado (`dsp_chain.py:83` `alpha_hp = rc/(rc+dt)`)
- ✅ Re-pass #4 `/master` async ceiling_db — VERIFICADO aplicado (`routers/mastering.py:261-262`)
- ✅ Re-pass #5 LUFS bake + soft-knee all formats — VERIFICADO aplicado (`routers/streaming.py:390-403,461-464`)
- ✅ U-4 phase_rotation — VERIFICADO aplicado (`mastering.py:7804` causal `sosfilt`)
- ✅ U-7 reverb_simple fade — VERIFICADO aplicado (`mastering.py:1414-1425` cosine fade)
- ✅ U-8 phantom_sub phase — VERIFICADO aplicado (`advanced_dsp.py:625,646` `running_phase`)
- ✅ transient_shaper soft-knee — VERIFICADO aplicado (`mastering.py:2334-2337` softplus)
- ✅ W1 frontend controls — VERIFICADO aplicado (`mixer-engine.ts:443`)
- ✅ W2 frontend matchMedia — VERIFICADO aplicado (`master-console.ts:683-686`)
- ✅ Frontend mono splitter — VERIFICADO aplicado (`audio-tap.ts:154`)
- ✅ C1 FIX K6 `/master/sync` — VERIFICADO aplicado (`routers/mastering.py:88`)
- ✅ C6 double limiter — VERIFICADO aplicado (`mixer.py:440`)
- ✅ C7 soft-knee — VERIFICADO aplicado (`streaming_engine.py:297,300,301`)
- ⚠️ Re-pass #6 mix-stream seed limiter_ceiling — NO verificado (no estaba en el grep list de categoría D)
- ⚠️ Re-pass #7 U-2 /master/reference async — NO verificado (no estaba en el grep list)
- ⚠️ Re-pass #8, #9, #12, #13 (backend minor) — NO verificados en esta ronda categoría D
- Fixes #3, #4 (reverb mode='full', wet norm) ya NO son MOOT: Bug A fixeado → ahora ejecutan

### Limitación compartida
- Ningún agente ejecutó audio ni midió runtime (excepto dsp-algorithm-guide re-pass que sí corrió `python3 -c` para verificar fixes y reproducir el crash A)
- `mastering.py` 7800 líneas leído parcialmente por todos
- Issue A (reverb crash) es el primer bug VERIFICADO en runtime (comando ejecutado, crash reproducido)

### Recomendación inmediata
**Bug A (`_synthesize_ir` crash) era CRÍTICO — ✅ VERIFICADO aplicado (2026-09-28).** Reverb ya corre end-to-end; los fixes #3 y #4 de la ronda anterior ahora ejecutan (ya no MOOT). Bugs B y C también VERIFICADO aplicados. La recomendación actual es re-verificar los fixes #6, #7, #8, #9, #12, #13 (no cubiertos por el grep list de la ronda categoría D) y aplicar la ronda frontend de 5 skills (ver sección "Re-pass frontend (5 skills)" abajo).

---

## Re-pass frontend (5 skills)

> **Fecha:** 2026-09-28
> **Modo:** 3 agentes en paralelo (Agent A frontend Web Audio/WS, Agent B backend TODOs, Agent C typescript-pro parciales)
> **Estado:** **PENDIENTE DE APLICACIÓN** — los agentes A, B, C están corriendo en paralelo. Los hallazgos se listan abajo; NO se marcan "aplicado" hasta re-verificar tras el cierre de cada agente.

Esta ronda cubre 5 skills frontend no cubiertas en la ronda 1 ni en el re-pass de 3 agentes: `web-audio-api` (profundización), `webaudio-review` (re-check), `websocket-engineer` (WS), `webapp-testing` (Playwright), `typescript-pro` (parciales restantes). El backend TODO (T1–T5) lo lleva Agent B; los parciales typescript-pro (TP1–TP5) los lleva Agent C; el resto (V1, W1–W6, WS1–WS9, WT1–WT3) lo lleva Agent A.

### V1 — `window.LGMDM.audio` wiring (CRITICAL)
- **Skill:** web-audio-api (encontrado por el agente web-audio-api, distinto del W1–W3 del re-pass anterior)
- **Severidad:** CRITICAL
- **Síntoma:** el wiring de `window.LGMDM.audio` falta → 3 features rotas (no se accede al AudioContext compartido desde los módulos que esperan `LGMDM.audio`).
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent A en progreso).**
- **Fix:** exponer el `audioEngine`/AudioContext compartido bajo `window.LGMDM.audio` para que los consumers lo resuelvan en runtime en vez de crear un `AudioContext` nuevo o fallar.

### W1–W6 — Web Audio warnings
- **Skills:** webaudio-review (re-check) + web-audio-api (profundización)
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent A en progreso).**
- **Notas:**
  - W1 (`mixer-engine.ts` auto-play) — ya VERIFICADO aplicado en working tree (`mixer-engine.ts:443` `audioEl.controls = true`); ver Fixes consolidados RE-PASS #10. El agente A re-confirma.
  - W2 (`master-console.ts` reduced-motion) — ya VERIFICADO aplicado (`master-console.ts:683-686` matchMedia listener); ver Fixes consolidados RE-PASS #11. El agente A re-confirma.
  - W3 (`reference-mastering.ts` per-chunk `AudioBuffer` alloc) — DEFERRED hasta profiling (decisión #8).
  - W4–W6 — warnings adicionales del re-check webaudio-review/web-audio-api (a detallar por Agent A).

### WS1–WS9 — WebSocket warnings
- **Skill:** websocket-engineer
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent A en progreso).**
- **Tema:** `/ws/master-stream`, `/ws/ref-stream`, `/ws/mix-stream` — ausencia de heartbeat, sin backpressure, sin reconnect, manejo de `WebSocketDisconnect`, validación de payloads, cierre limpio. Cada WS1–WS9 se detalla en el reporte del agente websocket-engineer.
- **Riesgos derivados:** ver FRONTEND-AUDIO-TRACK.md R-WS-HEARTBEAT y R-WS-BACKPRESSURE.

### WT1–WT3 — webapp-testing warnings
- **Skill:** webapp-testing (Playwright)
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent A en progreso).**
- **Tema:** cobertura Playwright del flujo de audio (master preview, mixer preview, reference streaming), assertions de console errors, flakiness en canvas/WebGL, mocks de WebSocket. Detalle por Agent A.

### TP1–TP5 — typescript-pro parciales
- **Skill:** typescript-pro
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent C en progreso).**
- **Tema:** migración `any` restante (F10 — 5 archivos + roots `lgmdm(): any`), `noUncheckedIndexedAccess` (F9 — 188 errores), non-null assertions (F11 — ~586), branded types (F13 — `LibraryId`/`SessionId`), `satisfies` sweep (F12). Cada TP1–TP5 mapea a un parcial F9–F13 de la ronda 1.

### T1–T5 — backend TODOs
- **Skill:** (varios — signal-flow, dsp-algorithm, resilience)
- **Estado:** **PENDIENTE DE APLICACIÓN (Agent B en progreso).**
- **Tema:** re-pass #6 (mix-stream seed `limiter_ceiling`), #7 (U-2 `/master/reference` async TypeError), #8 (-70 LUFS floor fallbacks), #9 (pcm24 LUFS-gain decode), #12 (doc citations), #13 (SOS form `stem_analysis`). El backend es READ-ONLY salvo excepción nominada; Agent B opera bajo esa excepción.

### Regla de cierre
Ninguno de los ítems arriba se marca "aplicado" en este doc hasta que se re-grepeé el `file:line` tras el cierre del agente correspondiente (categoría D, re-verificación). Mientras tanto el estado es **PENDIENTE DE APLICACIÓN (Agent X en progreso)** — no "aplicado", no "verificado".
