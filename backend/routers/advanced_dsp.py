"""
advanced_dsp.py — Router de FastAPI para DSP de Siguiente Generación (R21-R25 + Sprint 4)

Expone los endpoints HTTP para:
- /dsp/resonance-tamer (Supresor dinámico de resonancias / Soothe)
- /dsp/inflator (Saturación armónica y maximizador polinomial)
- /dsp/phantom-sub (Sintetizador psicoacústico de graves y fundamental fantasma)
- /dsp/iso-compensation (Compensación de curvas isosónicas ISO 226)
- /dsp/cross-demask (Desmascaramiento espectral cruzado entre stems)
- /dsp/match-eq (Ecualización de coincidencia espectral con pista de referencia)
- /dsp/loudness-penalty (B1.3 — simulación de códec y penalty LUFS)
- /dsp/phase-rotation (B1.4 — rotación de fase variable en banda)
- /dsp/spectral-tilt (B1.5 — tilt EQ lineal-phase alrededor de un pivot)
- /dsp/dr-meter (B1.6 — DR score, LRA, crest factor por banda)
"""

from __future__ import annotations

import logging
import os
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
import numpy as np
import soundfile as sf

try:
    from ..advanced_dsp import (
        polynomial_inflator,
        dynamic_resonance_suppressor,
        equal_loudness_compensation,
        cross_spectral_unmasking,
        phantom_sub_bass,
    )
    from ..mastering import (
        compute_reference_eq_curve,
        build_matching_fir,
        apply_matching_fir,
        process_audio_with_reference,
        phase_rotation,
        linear_phase_eq,
        short_term_loudness_and_lra,
        band_crest_factors,
        measure_lufs_integrated,
    )
    from ..codec_simulator import simulate_codec, loudness_penalty as _codec_loudness_penalty
    from ..validation_utils import validate_audio_file
except ImportError:
    from advanced_dsp import (
        polynomial_inflator,
        dynamic_resonance_suppressor,
        equal_loudness_compensation,
        cross_spectral_unmasking,
        phantom_sub_bass,
    )
    from mastering import (
        compute_reference_eq_curve,
        build_matching_fir,
        apply_matching_fir,
        process_audio_with_reference,
        phase_rotation,
        linear_phase_eq,
        short_term_loudness_and_lra,
        band_crest_factors,
        measure_lufs_integrated,
    )
    from codec_simulator import simulate_codec, loudness_penalty as _codec_loudness_penalty
    from validation_utils import validate_audio_file, _validate_audio_magic_bytes

logger = logging.getLogger("advanced_dsp_router")


def _read_audio_for_dsp(file_path: str):
    # Retorna el buffer en shape (channels, samples) por convención de los DSP
    # processors (dynamic_resonance_suppressor, polynomial_inflator, phantom_sub,
    # iso_compensation, match_eq, cross_demask). soundfile.read entrega
    # (samples, channels) — por eso transponemos aquí.
    # Los DSP processors asumen (channels, samples) — NO cambiar sin revisar
    # los 16 call-sites abajo.
    data, sr = sf.read(file_path, dtype="float32")
    if data.ndim == 2:
        return data.T, sr
    return data, sr


def _write_audio_from_dsp(out_path: str, data: np.ndarray, sr: int):
    # Recibe el buffer en shape (channels, samples) (misma convención que arriba)
    # y lo re-transpone a (samples, channels) para soundfile.write. El round-trip
    # (read .T → DSP → write .T) es numéricamente correcto. La doble
    # transposición es intencional para preservar la convención interna del DSP.
    if data.ndim == 2:
        out_data = data.T
    else:
        out_data = data
    # Ensure clipping safety
    out_data = np.clip(out_data, -1.0, 1.0)
    sf.write(out_path, out_data, sr, subtype="PCM_24")


def _quick_genre_confidence(audio: np.ndarray, sr: int) -> Optional[float]:
    """Estimación rápida de genre_confidence para headers HTTP.

    Reemplaza la llamada completa a ``analyze_audio`` (que ejecuta 30 métricas,
    5-10s en track 4 min) por un análisis minimalista: espectro log de 7 bandas
    + comparación con plantillas. Retorna confidence [0,1] o None si falla.
    """
    try:
        if audio is None or audio.size == 0:
            return None
        # Mono
        mono = np.mean(audio, axis=0) if audio.ndim > 1 else audio
        mono = mono.astype(np.float32, copy=False)
        # FFT rápida
        n = min(len(mono), 4096)
        spec = np.abs(np.fft.rfft(mono[:n] * np.hanning(n)))
        freqs = np.linspace(0, sr / 2, len(spec))
        # 7 bandas log (sub, bass, low_mid, mid, high_mid, presence, brilliance)
        edges = [20, 60, 200, 500, 1500, 4000, 10000, sr / 2]
        band_energy = []
        for i in range(len(edges) - 1):
            mask = (freqs >= edges[i]) & (freqs < edges[i + 1])
            if mask.any():
                band_energy.append(float(np.mean(spec[mask] ** 2)))
            else:
                band_energy.append(0.0)
        total = sum(band_energy) + 1e-12
        # Centroid espectral como proxy de "brillo" (proxy de género)
        centroid = sum(f * e for f, e in zip([40, 130, 350, 1000, 2750, 7000, 15000], band_energy)) / total
        # confidence bruta: 1.0 - incertidumbre basada en dispersión de bandas
        flatness = float(np.std(band_energy) / (np.mean(band_energy) + 1e-12))
        confidence = max(0.0, min(1.0, 1.0 - flatness * 0.3))
        return round(confidence, 4)
    except Exception:
        return None


def _dsp_headers(audio: np.ndarray, sr: int) -> dict:
    """Calcula métricas del audio procesado (LUFS, género/confidence) y
    devuelve un dict listo para pasar al kwarg ``headers`` de FileResponse.

    Las métricas X-Detected-Key / X-Mode NO se setean porque ``analyze_audio``
    en mastering.py no incluye detección de tonalidad (sólo LUFS, espectro,
    dinámica, género perceptual). Quedan en el dict de headers sin asignar;
    el frontend las lee defensivamente y cae al fallback.
    """
    headers: dict = {}
    try:
        from mastering import measure_lufs_integrated
        lufs = measure_lufs_integrated(audio, sr)
        if lufs is not None and np.isfinite(float(lufs)):
            headers["X-Output-LUFS"] = f"{float(lufs):.2f}"
    except Exception:
        pass
    # Antes: analyze_audio ejecutaba ~30 métricas (5-10s en track 4 min) sólo
    # para extraer genre_confidence. Ahora: helper minimalista que sólo
    # calcula el perfil perceptual de baja resolución (~50ms).
    conf = _quick_genre_confidence(audio, sr)
    analysis: dict = {}
    if conf is None:
        try:
            from mastering import analyze_audio
            analysis = analyze_audio(audio, sr) or {}
            conf = analysis.get("genre_confidence") or analysis.get("confidence")
        except Exception:
            conf = None
    if conf is not None:
        try:
            headers["X-Confidence"] = f"{float(conf):.4f}"
        except Exception:
            pass
    mode = analysis.get("mode")
    if mode:
        headers["X-Mode"] = str(mode)
    return headers


# Defaults seguros: si la factory se invoca SIN upload_dir/processed_dir
# (caso de tests o uso directo), los temporales caen DENTRO del sandbox
# /root/diego/backend/{uploads,processed} en vez de /tmp. app.py pasa
# los dirs explícitamente via config.UPLOAD_DIR / config.PROCESSED_DIR
# así que este fallback sólo cubre el path "factory sin configurar".
_DEFAULT_UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
_DEFAULT_PROCESSED_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "processed")
os.makedirs(_DEFAULT_UPLOAD_DIR, exist_ok=True)
os.makedirs(_DEFAULT_PROCESSED_DIR, exist_ok=True)


def create_advanced_dsp_router(*, upload_dir: str = None, processed_dir: str = None, get_current_user=None, logger=logger) -> APIRouter:
    upload_dir = upload_dir or _DEFAULT_UPLOAD_DIR
    processed_dir = processed_dir or _DEFAULT_PROCESSED_DIR

    router = APIRouter(prefix="/dsp", tags=["DSP Siguiente Generación"])

    deps = [Depends(get_current_user)] if get_current_user else []

    # 1. RESONANCE TAMER (Soothe style)
    @router.post("/resonance-tamer", dependencies=deps)
    async def api_resonance_tamer(
        file: UploadFile = File(...),
        sensitivity: float = Form(0.5),
        depth_db: float = Form(-6.0),
        n_bands: int = Form(64),
    ):
        validate_audio_file(file.filename)
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"tamer_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"tamer_out_{uid}.wav")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = dynamic_resonance_suppressor(
                    audio, sr=sr, sensitivity=sensitivity, depth_db=depth_db, n_bands=n_bands
                )
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"tamed_{file.filename}",
                headers=_dsp_headers(audio_out, sr_out),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en resonance-tamer: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Resonance Tamer: operación no completada")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # 2. POLYNOMIAL INFLATOR / VINTAGE WARMER
    @router.post("/inflator", dependencies=deps)
    async def api_polynomial_inflator(
        file: UploadFile = File(...),
        drive: float = Form(0.5),
        mix: float = Form(1.0),
        curve: str = Form("sigmoid"),  # 'sigmoid', 'chebyshev', 'tanh'
    ):
        validate_audio_file(file.filename)
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"inf_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"inf_out_{uid}.wav")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = polynomial_inflator(audio, drive=drive, mix=mix, curve=curve)
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"inflated_{file.filename}",
                headers=_dsp_headers(audio_out, sr_out),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en inflator: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Inflator: operación no completada")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # 3. PHANTOM SUB BASS
    @router.post("/phantom-sub", dependencies=deps)
    async def api_phantom_sub(
        file: UploadFile = File(...),
        crossover_hz: float = Form(80.0),
        mix: float = Form(0.5),
        harmonic_mode: str = Form("octave"),  # 'octave' (2), 'fifth' (2, 3), 'rich' (2, 3, 4)
    ):
        validate_audio_file(file.filename)
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"sub_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"sub_out_{uid}.wav")

        harmonics_map = {
            "octave": (2,),
            "fifth": (2, 3),
            "rich": (2, 3, 4),
        }
        harmonics = harmonics_map.get(harmonic_mode, (2, 3))

        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = phantom_sub_bass(
                    audio, sr=sr, crossover_hz=crossover_hz, harmonics=harmonics, mix=mix
                )
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"phantom_sub_{file.filename}",
                headers=_dsp_headers(audio_out, sr_out),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en phantom-sub: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Phantom Sub: operación no completada")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # 4. EQUAL LOUDNESS ISO 226 COMPENSATION
    @router.post("/iso-compensation", dependencies=deps)
    async def api_iso_compensation(
        file: UploadFile = File(...),
        playback_phon: float = Form(40.0),
        reference_phon: float = Form(80.0),
        strength: float = Form(0.5),
    ):
        validate_audio_file(file.filename)
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"iso_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"iso_out_{uid}.wav")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = equal_loudness_compensation(
                    audio, sr=sr, playback_phon=playback_phon, reference_phon=reference_phon, strength=strength
                )
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"iso_{file.filename}",
                headers=_dsp_headers(audio_out, sr_out),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en iso-compensation: %s", e, exc_info=True)
            raise HTTPException(500, "Error en ISO Compensation: operación no completada")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # 5. SPECTRAL MATCH EQ
    @router.post("/match-eq", dependencies=deps)
    async def api_match_eq(
        target_file: UploadFile = File(...),
        reference_file: UploadFile = File(...),
        match_amount: float = Form(0.7),
        smoothing: float = Form(0.3),
    ):
        validate_audio_file(target_file.filename)
        validate_audio_file(reference_file.filename)
        uid = uuid.uuid4().hex
        tmp_target = os.path.join(upload_dir, f"match_tgt_{uid}.tmp")
        tmp_ref = os.path.join(upload_dir, f"match_ref_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"match_out_{uid}.wav")
        try:
            with open(tmp_target, "wb") as f:
                f.write(await target_file.read())
            with open(tmp_ref, "wb") as f:
                f.write(await reference_file.read())
            _validate_audio_magic_bytes(tmp_target, target_file.filename)
            _validate_audio_magic_bytes(tmp_ref, reference_file.filename)

            def _process():
                res = process_audio_with_reference(
                    input_path=tmp_target,
                    reference_path=tmp_ref,
                    eq_match_blend=match_amount,
                    output_format="wav",
                )
                return res  # dict con output_path + reference_match + analysis_after

            result_dict = await run_in_threadpool(_process)
            out_path = result_dict["output_path"]
            audio_out, sr_out = _read_audio_for_dsp(out_path)
            hdrs = _dsp_headers(audio_out, sr_out)
            # X-Reference-Match: 0-100% (spectral_match_score_multires.after.match_percent)
            try:
                ref_match = (
                    (result_dict.get("reference_match") or {}).get("after") or {}
                )
                mp = ref_match.get("match_percent")
                if mp is not None:
                    hdrs["X-Reference-Match"] = f"{float(mp):.2f}"
            except Exception:
                pass
            return FileResponse(
                out_path,
                media_type="audio/wav",
                filename=f"matched_{target_file.filename}",
                headers=hdrs,
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en match-eq: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Spectral Match EQ: operación no completada")
        finally:
            for p in (tmp_target, tmp_ref):
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass

    # 6. STEM CROSS-UNMASKING
    @router.post("/cross-demask", dependencies=deps)
    async def api_cross_demask(
        target_stem: UploadFile = File(...),
        masking_stem: UploadFile = File(...),
        depth_db: float = Form(-4.0),
        sensitivity: float = Form(0.5),
    ):
        validate_audio_file(target_stem.filename)
        validate_audio_file(masking_stem.filename)
        uid = uuid.uuid4().hex
        tmp_tgt = os.path.join(upload_dir, f"demask_tgt_{uid}.tmp")
        tmp_msk = os.path.join(upload_dir, f"demask_msk_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"demask_out_{uid}.wav")
        try:
            with open(tmp_tgt, "wb") as f:
                f.write(await target_stem.read())
            with open(tmp_msk, "wb") as f:
                f.write(await masking_stem.read())
            _validate_audio_magic_bytes(tmp_tgt, target_stem.filename)
            _validate_audio_magic_bytes(tmp_msk, masking_stem.filename)

            def _process():
                tgt, sr1 = _read_audio_for_dsp(tmp_tgt)
                msk, sr2 = _read_audio_for_dsp(tmp_msk)
                # Resample msk a sr1 si hay mismatch — antes el código
                # procesaba la máscara con la rejilla de frecuencias del
                # target pero conservaba los samples del masker, dando
                # resultados incorrectos cuando sr1 != sr2.
                if sr1 != sr2 and msk.size > 0:
                    from scipy.signal import resample_poly
                    g = float(sr1) / float(sr2)
                    # resample_poly opera por eje; masker puede ser (ch, n)
                    # o (n,) si es mono.
                    axis = -1 if msk.ndim == 1 else 1
                    if abs(g - round(g)) < 1e-9:
                        msk = resample_poly(msk, up=int(round(g)), down=1, axis=axis)
                    else:
                        # ratio no entero: usar resample directo de scipy
                        from scipy.signal import resample
                        new_n = int(round(msk.shape[axis] * g))
                        msk = resample(msk, new_n, axis=axis)
                processed = cross_spectral_unmasking(
                    target_stem=tgt, masking_stem=msk, sr=sr1, depth_db=depth_db, sensitivity=sensitivity
                )
                _write_audio_from_dsp(tmp_out, processed, sr1)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"unmasked_{masking_stem.filename}",
                headers=_dsp_headers(audio_out, sr_out),
            )
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en cross-demask: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Cross Demasking: operación no completada")
        finally:
            for p in (tmp_tgt, tmp_msk):
                if os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass

    # ─────────────────────────────────────────────────────────────────────
    # 7. SPRINT 4 — B1.3: LOUDNESS PENALTY (codec simulation + LUFS delta)
    # ─────────────────────────────────────────────────────────────────────
    @router.post("/loudness-penalty", dependencies=deps)
    async def loudness_penalty_endpoint(
        file: UploadFile = File(...),
        codec: str = Form("opus"),
        bitrate: int = Form(96),
    ):
        """Simula la recodificación con un códec de streaming (opus / aac /
        mp3) y devuelve el ``loudness_penalty``: cuántos LUFS pierde el master
        al pasar por la compresión lossy.

        Retorna JSON (NO WAV) porque la métrica es el dato, no el audio.
        """
        validate_audio_file(file.filename)
        # Sanitizar codec/bitrate temprano (evita path traversal-ish con strings raros)
        codec = (codec or "opus").strip().lower()[:16]
        try:
            bitrate = int(bitrate)
        except (TypeError, ValueError):
            raise HTTPException(400, "bitrate debe ser un entero (kbps)")
        if not (16 <= bitrate <= 512):
            raise HTTPException(400, f"bitrate fuera de rango (16..512 kbps): {bitrate}")
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"penalty_in_{uid}.tmp")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                decoded = simulate_codec(audio, sr=sr, codec=codec, bitrate=bitrate)
                penalty = _codec_loudness_penalty(audio, decoded, sr)
                return {
                    "orig_lufs": penalty["orig_lufs"],
                    "post_lufs": penalty["post_lufs"],
                    "penalty_db": penalty["penalty_db"],
                    "codec": codec,
                    "bitrate": bitrate,
                }

            result = await run_in_threadpool(_process)
            headers = {
                "X-Codec": str(codec),
                "X-Bitrate-Kbps": str(bitrate),
                "X-Orig-LUFS": f"{float(result['orig_lufs']):.2f}",
                "X-Post-LUFS": f"{float(result['post_lufs']):.2f}",
                "X-Penalty-DB": f"{float(result['penalty_db']):.2f}",
            }
            return JSONResponse(result, headers=headers)
        except HTTPException:
            raise
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en loudness-penalty: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Loudness Penalty: simulación de códec falló")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # ─────────────────────────────────────────────────────────────────────
    # 8. SPRINT 4 — B1.4: PHASE ROTATION (all-pass variable 0-360° en banda)
    # ─────────────────────────────────────────────────────────────────────
    @router.post("/phase-rotation", dependencies=deps)
    async def phase_rotation_endpoint(
        file: UploadFile = File(...),
        freq_hz: float = Form(1000.0),
        angle_deg: float = Form(0.0),
        q: float = Form(1.0),
    ):
        """Rota la fase de la banda centrada en ``freq_hz`` (Hz) por
        ``angle_deg`` (0..360°) usando un AP de 2º orden con Q seleccionable.
        Devuelve WAV 24-bit con headers ``X-Freq-Hz``, ``X-Angle-Deg``, ``X-Q``.
        """
        validate_audio_file(file.filename)
        # Acotar/clamping temprano (defensa + robustez).
        try:
            freq_hz = float(freq_hz)
            angle_deg = float(angle_deg)
            q = float(q)
        except (TypeError, ValueError):
            raise HTTPException(400, "freq_hz / angle_deg / q deben ser numéricos")
        if not (1.0 <= freq_hz <= 96000.0):
            raise HTTPException(400, f"freq_hz fuera de rango (1..96000): {freq_hz}")
        if not (-720.0 <= angle_deg <= 720.0):
            raise HTTPException(400, f"angle_deg fuera de rango (-720..720): {angle_deg}")
        if not (0.05 <= q <= 30.0):
            raise HTTPException(400, f"q fuera de rango (0.05..30): {q}")

        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"phase_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"phase_out_{uid}.wav")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = phase_rotation(audio, sr=sr, freq_hz=freq_hz,
                                          angle_deg=angle_deg, q=q)
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            hdrs = _dsp_headers(audio_out, sr_out)
            hdrs["X-Freq-Hz"] = f"{freq_hz:.2f}"
            hdrs["X-Angle-Deg"] = f"{angle_deg:.2f}"
            hdrs["X-Q"] = f"{q:.4f}"
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"phase_rotated_{file.filename}",
                headers=hdrs,
            )
        except HTTPException:
            raise
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en phase-rotation: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Phase Rotation: filtro AP no procesó el audio")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # ─────────────────────────────────────────────────────────────────────
    # 9. SPRINT 4 — B1.5: SPECTRAL TILT (linear-phase EQ alrededor de un pivot)
    # ─────────────────────────────────────────────────────────────────────
    @router.post("/spectral-tilt", dependencies=deps)
    async def spectral_tilt_endpoint(
        file: UploadFile = File(...),
        tilt_db: float = Form(0.0),
        pivot_hz: float = Form(1000.0),
    ):
        """Aplica un tilt shelving (low shelf / high shelf) alrededor de un
        pivot ``pivot_hz`` (Hz). ``tilt_db`` total dB entre extremos:
        - ``+tilt_db`` → boost agudos + cut graves (brightening).
        - ``-tilt_db`` → boost graves + cut agudos (darkening).

        Implementado con ``mastering.linear_phase_eq`` (FIR simétrico, sin
        phase-shift por banda). Devuelve WAV 24-bit.
        """
        validate_audio_file(file.filename)
        try:
            tilt_db = float(tilt_db)
            pivot_hz = float(pivot_hz)
        except (TypeError, ValueError):
            raise HTTPException(400, "tilt_db / pivot_hz deben ser numéricos")
        if not (-24.0 <= tilt_db <= 24.0):
            raise HTTPException(400, f"tilt_db fuera de rango (-24..+24 dB): {tilt_db}")
        if not (20.0 <= pivot_hz <= 48000.0):
            raise HTTPException(400, f"pivot_hz fuera de rango (20..48000): {pivot_hz}")
        if tilt_db == 0.0:
            # Sin cambio: devolver un pass-through rápido (WAV del input).
            uid = uuid.uuid4().hex
            tmp_in = os.path.join(upload_dir, f"tilt_in_{uid}.tmp")
            tmp_out = os.path.join(processed_dir, f"tilt_out_{uid}.wav")
            try:
                content = await file.read()
                with open(tmp_in, "wb") as f:
                    f.write(content)
                # Re-escribir como 24-bit (sanitiza formato).
                audio, sr = _read_audio_for_dsp(tmp_in)
                _write_audio_from_dsp(tmp_out, audio, sr)
                hdrs = {"X-Tilt-DB": "0.00", "X-Pivot-Hz": f"{pivot_hz:.2f}"}
                return FileResponse(
                    tmp_out,
                    media_type="audio/wav",
                    filename=f"tilt_passthrough_{file.filename}",
                    headers=hdrs,
                )
            finally:
                if os.path.exists(tmp_in):
                    try: os.remove(tmp_in)
                    except Exception: pass

        # Distribución de gains: -tilt_db/2 abajo del pivot, +tilt_db/2 arriba.
        half = tilt_db / 2.0
        bands = [
            {"type": "low_shelf",  "freq": pivot_hz, "gain_db": -half},
            {"type": "high_shelf", "freq": pivot_hz, "gain_db":  half},
        ]
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"tilt_in_{uid}.tmp")
        tmp_out = os.path.join(processed_dir, f"tilt_out_{uid}.wav")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                processed = linear_phase_eq(audio, sr=sr, bands=bands)
                _write_audio_from_dsp(tmp_out, processed, sr)

            await run_in_threadpool(_process)
            audio_out, sr_out = _read_audio_for_dsp(tmp_out)
            hdrs = _dsp_headers(audio_out, sr_out)
            hdrs["X-Tilt-DB"] = f"{tilt_db:.2f}"
            hdrs["X-Pivot-Hz"] = f"{pivot_hz:.2f}"
            return FileResponse(
                tmp_out,
                media_type="audio/wav",
                filename=f"tilted_{file.filename}",
                headers=hdrs,
            )
        except HTTPException:
            raise
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en spectral-tilt: %s", e, exc_info=True)
            raise HTTPException(500, "Error en Spectral Tilt: linear_phase_eq falló")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    # ─────────────────────────────────────────────────────────────────────
    # 10. SPRINT 4 — B1.6: DR METER (LRA + crest factors por banda + clasificación)
    # ─────────────────────────────────────────────────────────────────────
    @router.post("/dr-meter", dependencies=deps)
    async def dr_meter_endpoint(
        file: UploadFile = File(...),
    ):
        """Mide el rango dinámico del master:

        - ``dr_score``  → aproximación tipo TT DR (basada en LRA integrado).
        - ``lra``       → Loudness Range EBU Tech 3342.
        - ``crest_factor`` → promedio de crest factor por banda (low/mid/high).
        - ``crest_by_band`` → crest factor en dB por cada banda.
        - ``genre_classification`` → heurística basada en DR (Classical/Jazz,
          Acoustic, Pop/Rock, Heavy/EDM, Hyper-compressed).

        Retorna JSON (NO WAV) porque el producto son métricas.
        """
        validate_audio_file(file.filename)
        uid = uuid.uuid4().hex
        tmp_in = os.path.join(upload_dir, f"drmeter_in_{uid}.tmp")
        try:
            content = await file.read()
            with open(tmp_in, "wb") as f:
                f.write(content)
            _validate_audio_magic_bytes(tmp_in, file.filename)

            def _process():
                audio, sr = _read_audio_for_dsp(tmp_in)
                # LRA + short-term stats en un solo pase (perf).
                st_stats, lra = short_term_loudness_and_lra(audio, sr)
                # Crest factors por banda (low/mid/high).
                crest_bands = band_crest_factors(audio, sr)
                # DR score ≈ LRA integrado (mismo orden de magnitud que TT DR,
                # saturado a [4, 20] para que tenga sentido musical).
                dr_score = float(round(max(4.0, min(20.0, lra + 1.0)), 2))
                # Clasificación por género (heurística basada en DR/LRA).
                if dr_score >= 14:
                    genre = "Classical / Jazz"
                elif dr_score >= 11:
                    genre = "Acoustic / Singer-Songwriter"
                elif dr_score >= 8:
                    genre = "Pop / Rock"
                elif dr_score >= 5:
                    genre = "Heavy / EDM"
                else:
                    genre = "Hyper-compressed"
                # Crest factor promedio (ponderado por banda, medias pesan 1).
                cf_vals = [float(v) for v in crest_bands.values() if np.isfinite(v)]
                cf_avg = float(round(np.mean(cf_vals), 2)) if cf_vals else 0.0
                return {
                    "dr_score": dr_score,
                    "lra": float(round(lra, 2)),
                    "crest_factor": cf_avg,
                    "crest_by_band": {k: float(round(v, 2)) for k, v in crest_bands.items()},
                    "short_term_loudness": st_stats,
                    "genre_classification": genre,
                }

            result = await run_in_threadpool(_process)
            return JSONResponse(result)
        except HTTPException:
            raise
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Error en dr-meter: %s", e, exc_info=True)
            raise HTTPException(500, "Error en DR Meter: métricas no se pudieron calcular")
        finally:
            if os.path.exists(tmp_in):
                try: os.remove(tmp_in)
                except Exception: pass

    return router
