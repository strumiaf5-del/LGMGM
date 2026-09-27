from __future__ import annotations

import os
import uuid

import numpy as np
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.concurrency import run_in_threadpool

try:
    from ..audio_service import AudioService
    from ..mastering import mix_advice, spectrum_analysis_fft, normalize_to_streaming_target, evaluate_streaming_compliance
    from ..validation_utils import validate_audio_file
except ImportError:  # pragma: no cover
    from audio_service import AudioService
    from mastering import mix_advice, spectrum_analysis_fft, normalize_to_streaming_target, evaluate_streaming_compliance
    from validation_utils import validate_audio_file


def _spectrum_from_file(file_path: str, n_fft: int, n_bins: int):
    service = AudioService()
    return service.spectrum_file(file_path, n_fft=n_fft, n_bins=n_bins)


def _analyze_from_file(file_path: str) -> dict:
    try:
        return AudioService().analyze_file(file_path)
    except Exception as e:
        raise RuntimeError(f"Error analizando archivo: {e}") from e


def create_analysis_router(*, upload_dir: str, read_and_validate, logger, current_user_dependency, audio_service: AudioService | None = None) -> APIRouter:
    router = APIRouter(tags=["Análisis"])

    @router.post("/analysis")
    async def analyze_complete(
        file: UploadFile = File(...),
        n_fft: int = Query(4096, ge=256, le=16384),
        n_bins: int = Query(64, ge=8, le=256),
        current_user: dict = Depends(current_user_dependency),
    ):
        logger.info("🔍 %s análisis server-side: %s", current_user["email"], file.filename)
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"analysis_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            if audio_service:
                result = await run_in_threadpool(audio_service.analyze_with_spectrum, tmp, n_fft, n_bins)
            else:
                result = await run_in_threadpool(AudioService().analyze_with_spectrum, tmp, n_fft, n_bins)
            logger.info("✓ Análisis completo server-side: %s", file.filename)
            return result
        except Exception as exc:
            logger.error("❌ Error análisis server-side %s: %s", file.filename, exc, exc_info=True)
            raise HTTPException(500, "Error análisis server-side: operación no completada") from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/analyze")
    async def analyze_legacy(file: UploadFile = File(...), current_user: dict = Depends(current_user_dependency)):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"analyze_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            return await run_in_threadpool(audio_service.analyze_file if audio_service else _analyze_from_file, tmp)
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/mix-advice")
    async def get_mix_advice(file: UploadFile = File(...), current_user: dict = Depends(current_user_dependency)):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"advice_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            analysis = await run_in_threadpool(audio_service.analyze_file if audio_service else _analyze_from_file, tmp)
            return {"analysis": analysis, **mix_advice(analysis)}
        except Exception as exc:
            logger.exception("Error en mix-advice: %s", exc)
            raise HTTPException(500, "Error en mix-advice: operación no completada") from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/spectrum")
    async def spectrum(
        file: UploadFile = File(...),
        n_fft: int = Query(4096, ge=256, le=16384),
        n_bins: int = Query(64, ge=8, le=256),
        current_user: dict = Depends(current_user_dependency),
    ):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"spectrum_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)
            if audio_service:
                return await run_in_threadpool(audio_service.spectrum_file, tmp, n_fft, n_bins)
            return await run_in_threadpool(_spectrum_from_file, tmp, n_fft, n_bins)
        except Exception as exc:
            logger.exception("Error en spectrum: %s", exc)
            raise HTTPException(500, "Error en spectrum: operación no completada") from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    @router.post("/normalize-streaming-target")
    async def normalize_streaming_endpoint(
        file: UploadFile = File(...),
        platform: str = Query("spotify"),
        ceiling_dbtp: float = Query(-1.0),
        current_user: dict = Depends(current_user_dependency),
    ):
        logger.info("🎯 %s normalización a streaming target (%s): %s", current_user.get("email"), platform, file.filename)
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        tmp = os.path.join(upload_dir, f"norm_{uuid.uuid4().hex}")
        try:
            with open(tmp, "wb") as fh:
                fh.write(data)

            def _process():
                import soundfile as sf
                from mastering import measure_lra
                audio, sr = sf.read(tmp, always_2d=True)
                audio_ch = audio.T
                norm_audio, info = normalize_to_streaming_target(
                    audio_ch, sr, platform=platform, ceiling_dbtp=ceiling_dbtp, return_info=True
                )
                if not info or norm_audio is None:
                    return {"status": "error", "detail": "normalize_to_streaming_target returned no info"}
                # Mide DR real desde el audio normalizado (peak_db - rms_db en LUFS-weighted)
                # y LRA real vía pyloudnorm. Si la medición falla, cae a defaults y
                # marca "partial" para que el frontend sepa que la compliance no es exacta.
                peak_db = float(info.get("output_true_peak_dbtp", -1.0))
                rms_db = 20.0 * float(np.log10(max(np.sqrt(np.mean(norm_audio.astype(np.float64) ** 2)), 1e-9)))
                dynamic_range_db = max(0.0, round(peak_db - rms_db, 2))
                lra_val = measure_lra(norm_audio, sr)
                compliance = evaluate_streaming_compliance(
                    integrated_lufs=info["output_lufs"],
                    true_peak_dbtp=info["output_true_peak_dbtp"],
                    dynamic_range_db=dynamic_range_db,
                    lra=lra_val,
                )
                info["platform_compliance"] = compliance
                info["dynamic_range_db"] = dynamic_range_db
                info["loudness_range_lu"] = lra_val
                input_lufs = float(info.get("input_lufs", -100.0))
                # success sólo si el pipeline midió DR y LRA reales con valores > 0
                measured_ok = dynamic_range_db > 0.0 and lra_val > 0.0
                info["status"] = "success" if (input_lufs > -70.0 and measured_ok) else "partial"
                return info

            return await run_in_threadpool(_process)
        except Exception as exc:
            logger.error("❌ Error en normalización a streaming target: %s", exc, exc_info=True)
            raise HTTPException(500, "Error en normalización a streaming target: operación no completada") from exc
        finally:
            if os.path.exists(tmp):
                os.remove(tmp)

    return router
