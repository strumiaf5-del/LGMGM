from __future__ import annotations

import asyncio
import math
import os
import re
import time
import uuid
from typing import Any, Callable

import librosa
import numpy as np
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, Request, UploadFile
from pydantic import BaseModel, Field

try:
    from .. import ai_assistant
    from ..mastering import PLATFORM_LOUDNESS_TARGETS, analyze_audio, mix_advice
except ImportError:
    import ai_assistant
    from mastering import PLATFORM_LOUDNESS_TARGETS, analyze_audio, mix_advice


class _NoOpLimiter:
    """Drop-in fallback when no ``slowapi.Limiter`` is supplied.

    Mirrors the surface used here (``limiter.limit("...")`` returning a no-op
    decorator) so the AI router remains callable in unit tests and CLI
    contexts without requiring a global ``Limiter`` singleton.
    """

    @staticmethod
    def limit(_spec: str) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def _decorator(fn: Callable[..., Any]) -> Callable[..., Any]:
            return fn
        return _decorator


_DEFAULT_LIMITER: Any = _NoOpLimiter()


class AiChatMessage(BaseModel):
    role: str
    content: str


class AiChatRequest(BaseModel):
    message: str
    history: list[AiChatMessage] = Field(default_factory=list)
    analysis: dict | None = None
    preset: str | None = None
    platform: str | None = None


def _fix_ai_decision_params(decision: dict) -> dict:
    """Normaliza parámetros en formato legacy lineal a los nombres esperados por process_audio()."""
    linear_to_db = {
        "comp_threshold": "comp_threshold_db",
        "mb_low_threshold": "mb_low_threshold_db",
        "mb_mid_threshold": "mb_mid_threshold_db",
        "mb_high_threshold": "mb_high_threshold_db",
    }
    fixed = dict(decision)
    for linear_key, db_key in linear_to_db.items():
        if linear_key in fixed:
            linear_val = fixed.pop(linear_key)
            try:
                fixed[db_key] = round(20.0 * math.log10(max(float(linear_val), 1e-6)), 2)
            except (TypeError, ValueError):
                pass
    return fixed


def create_ai_router(*, upload_dir: str, read_and_validate, resolve_input_source, validate_audio_file, jobs, logger, run_mastering_job, current_user_dependency, limiter: Any = _DEFAULT_LIMITER) -> APIRouter:
    router = APIRouter()

    @router.get("/ai/status", tags=["Asistente IA"])
    async def ai_status():
        available = ai_assistant.is_available()
        return {
            "available": available,
            "model": ai_assistant.AI_MODEL if available else None,
            "reason": None if available else ai_assistant.get_unavailable_reason(),
        }

    @router.post("/ai/chat", tags=["Asistente IA"])
    @limiter.limit("15/minute")
    async def ai_chat(request: Request, req: AiChatRequest, current_user: dict = Depends(current_user_dependency)):
        if not req.message or not req.message.strip():
            raise HTTPException(400, "El mensaje no puede estar vacío.")
        try:
            result = await ai_assistant.chat(
                req.message,
                [(m.model_dump() if hasattr(m, "model_dump") else m.dict()) for m in req.history],
                req.analysis,
                req.preset,
                req.platform,
            )
            return result
        except RuntimeError as exc:
            logger.exception("RuntimeError en /ai/chat: %s", exc)
            raise HTTPException(503, "Asistente de IA temporalmente no disponible") from exc
        except ValueError as exc:
            logger.exception("ValueError en /ai/chat: %s", exc)
            raise HTTPException(400, "Solicitud inválida") from exc
        except Exception as exc:
            logger.error(f"Error en /ai/chat: {exc}", exc_info=True)
            raise HTTPException(500, "Error interno del asistente de IA.") from exc

    @router.post("/ai/suggest", tags=["Asistente IA"])
    @limiter.limit("10/minute")
    async def ai_suggest(
        request: Request,
        current_user: dict = Depends(current_user_dependency),
        file: UploadFile | None = File(None),
        library_id: str | None = Form(None),
    ):
        if file is None and not library_id:
            raise HTTPException(400, "Falta el archivo: mandá 'file' o 'library_id'.")

        data, filename = await resolve_input_source(file, library_id)
        safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(filename or "audio.wav"))
        if not safe_filename or len(safe_filename) > 255:
            raise HTTPException(400, "Invalid filename")
        tmp_path = os.path.join(upload_dir, f"aisuggest_{uuid.uuid4().hex}_{safe_filename}")
        # Verify path stays inside upload_dir
        real_upload = os.path.realpath(upload_dir)
        real_tmp = os.path.realpath(tmp_path)
        if not real_tmp.startswith(real_upload + os.sep):
            raise HTTPException(400, "Invalid path")
        with open(tmp_path, "wb") as fh:
            fh.write(data)
        try:
            audio, sr = await asyncio.to_thread(librosa.load, tmp_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            analysis = await asyncio.to_thread(analyze_audio, audio, sr)
            analysis["mix_advice"] = mix_advice(analysis)
            platform_options = list(PLATFORM_LOUDNESS_TARGETS.keys())
            decision = await ai_assistant.decide_mastering(analysis, platform_options, audio, sr)
        except ValueError as exc:
            logger.exception("ValueError en /ai/suggest: %s", exc)
            raise HTTPException(400, "Solicitud inválida") from exc
        except Exception as exc:
            logger.error(f"Error en /ai/suggest: {exc}", exc_info=True)
            raise HTTPException(500, "No se pudo analizar el track para sugerir parámetros.") from exc
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

        decision = _fix_ai_decision_params(decision)
        return {"ai_decision": decision, "analysis": analysis}

    @router.post("/ai/auto-master", tags=["Asistente IA"])
    @limiter.limit("5/minute")
    async def ai_auto_master(
        request: Request,
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        output_format: str = Form("wav", pattern="^(wav|flac|mp3)$"),
        output_bit_depth: int = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
        current_user: dict = Depends(current_user_dependency),
    ):
        validate_audio_file(file.filename)
        data = await read_and_validate(file)
        job_id = uuid.uuid4().hex
        safe_filename = re.sub(r'[^a-zA-Z0-9._-]', '_', os.path.basename(file.filename or "audio.wav"))
        if not safe_filename or len(safe_filename) > 255:
            raise HTTPException(400, "Invalid filename")
        input_path = os.path.join(upload_dir, f"{job_id}_{safe_filename}")
        # Verify path stays inside upload_dir
        real_upload = os.path.realpath(upload_dir)
        real_tmp = os.path.realpath(input_path)
        if not real_tmp.startswith(real_upload + os.sep):
            raise HTTPException(400, "Invalid path")
        with open(input_path, "wb") as fh:
            fh.write(data)

        try:
            audio, sr = await asyncio.to_thread(librosa.load, input_path, sr=None, mono=False)
            if audio.ndim == 1:
                audio = audio[np.newaxis, :]
            analysis = await asyncio.to_thread(analyze_audio, audio, sr)
            analysis["mix_advice"] = mix_advice(analysis)
            platform_options = list(PLATFORM_LOUDNESS_TARGETS.keys())
            decision = await ai_assistant.decide_mastering(analysis, platform_options, audio, sr)
        except ValueError as exc:
            if os.path.exists(input_path):
                os.remove(input_path)
            logger.exception("ValueError en /ai/auto-master: %s", exc)
            raise HTTPException(400, "Solicitud inválida") from exc
        except Exception as exc:
            if os.path.exists(input_path):
                os.remove(input_path)
            logger.error(f"Error en /ai/auto-master (análisis/decisión): {exc}", exc_info=True)
            raise HTTPException(500, "No se pudo analizar el track para el mastering automático.") from exc

        decision = _fix_ai_decision_params(decision)
        params = {k: v for k, v in decision.items() if k not in ("platform", "reasoning")}
        params["output_format"] = output_format
        params["output_bit_depth"] = output_bit_depth
        if decision.get("platform"):
            params["platform_target"] = decision["platform"]

        duration = None
        try:
            duration = librosa.get_duration(path=input_path)
        except Exception:
            duration = None

        job_params = {**params, "ai_decision": decision}
        if duration is not None:
            job_params["_input_duration_sec"] = duration

        jobs.create_job(job_id, {
            "status": "queued",
            "filename": file.filename,
            "created_at": time.time(),
            "params": job_params,
            "ai_decision": decision,
            "ai_analysis": analysis,
            "progress": 0,
            "stage": "En cola",
        })
        background_tasks.add_task(run_mastering_job, job_id, input_path, params)
        logger.info(f"Auto-mastering IA: job {job_id} -> parámetros calculados por IA, platform={decision.get('platform')}")
        return {
            "job_id": job_id,
            "status": "queued",
            "ai_decision": decision,
            "analysis": analysis,
            "poll_url": f"/job/{job_id}",
        }

    return router
