from __future__ import annotations

import inspect
import logging
import os
import time
import uuid
from typing import List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

logger = logging.getLogger(__name__)


# FIX K10 (Opción B): registry en memoria para los jobs de pitch-correct async.
# El endpoint POST /pitch-correct genera un job_id, lo guarda acá con
# status="processing", y el job runner lo actualiza a "done"/"error" cuando
# termina. El endpoint GET /pitch-correct/{job_id} consulta este registry.
# Cleanup: los jobs se borran del registry (y su archivo de disco) cuando
# se descargan o cuando superan PITCH_JOB_TTL_SECONDS (1 hora).
PITCH_JOBS: dict = {}
PITCH_JOB_TTL_SECONDS = 3600  # 1 hora


# Cache de parámetros válidos de `process_audio`, computada una sola vez.
# Los endpoints /master y /master/preset arman `params` iterando locals();
# si filtran contra este set, nunca se cuelan free variables del closure
# (como `dependencies` o `router`) que romperían process_audio(**params).
def _load_process_audio_params() -> set:
    try:
        from mastering import process_audio
        return set(inspect.signature(process_audio).parameters)
    except Exception:
        # Fallback: vacío => el loop no agrega nada => params queda solo con
        # output_format/output_bit_depth (comportamiento seguro).
        return set()


_PROCESS_AUDIO_PARAMS = _load_process_audio_params()


async def _run_mastering_sync(
    file: UploadFile,
    params: dict,
    reference_file: Optional[UploadFile] = None,
):
    """Helper común para los endpoints /master/* sync.

    Persiste el (o los) UploadFile a disco dentro de UPLOAD_DIR (no usa /tmp),
    llama a ``process_audio(input_path, **filtered_params)`` con solo kwargs
    válidos según la firma real, y devuelve un ``FileResponse`` con el WAV
    procesado en 24-bit. Limpia los temporales en el ``finally``.
    """
    import uuid

    from mastering import process_audio

    upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
    )
    os.makedirs(upload_dir, exist_ok=True)

    uid = uuid.uuid4().hex
    input_filename = os.path.basename(file.filename or "input.wav") or "input.wav"
    input_path = os.path.join(upload_dir, f"sync_in_{uid}_{input_filename}")
    with open(input_path, "wb") as fh:
        fh.write(await file.read())

    ref_path = None
    if reference_file is not None:
        ref_filename = os.path.basename(reference_file.filename or "reference.wav") or "reference.wav"
        ref_path = os.path.join(upload_dir, f"sync_ref_{uid}_{ref_filename}")
        with open(ref_path, "wb") as fh:
            fh.write(await reference_file.read())
        params = dict(params)
        params["reference"] = {"path": ref_path, "filename": ref_filename}

    try:
        # Filtramos los kwargs contra la firma real para no romper process_audio
        # con keys desconocidas (los presets viejos guardan cosas como 'label').
        valid_keys = _PROCESS_AUDIO_PARAMS
        kwargs = {k: v for k, v in params.items() if k in valid_keys and v is not None}
        result = process_audio(input_path, **kwargs)
        output_path = result["output_path"] if isinstance(result, dict) else result

        # Calcular métricas del WAV procesado para setear headers DSP.
        # Best-effort: si measure_lufs falla, igual devolvemos el archivo sin
        # headers (frontend usa el fallback "Procesamiento completado").
        extra_headers: dict = {}
        try:
            import soundfile as _sf

            from mastering import measure_lufs_integrated as _measure_lufs
            _audio, _sr = _sf.read(output_path), _sf.info(output_path).samplerate
            _lufs = _measure_lufs(_audio, _sr)
            if _lufs is not None:
                extra_headers["X-Output-LUFS"] = f"{float(_lufs):.2f}"
        except Exception:
            pass
        # X-Reference-Match solo aplica cuando hay reference_file.
        if reference_file is not None and isinstance(result, dict):
            try:
                _mp = (((result.get("reference_match") or {}).get("after") or {}).get("match_percent"))
                if _mp is not None:
                    extra_headers["X-Reference-Match"] = f"{float(_mp):.2f}"
            except Exception:
                pass

        base, ext = os.path.splitext(input_filename)
        if reference_file is not None:
            out_name = f"matched_{base}{ext or '.wav'}"
        else:
            out_name = f"mastered_{base}{ext or '.wav'}"
        return FileResponse(
            output_path,
            media_type="audio/wav",
            filename=out_name,
            headers=extra_headers,
        )
    finally:
        for p in (input_path, ref_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass


def create_router(**dependencies):
    router: APIRouter = dependencies.get("router", APIRouter())
    get_current_user = dependencies.get("get_current_user")

    # ─── /master/preset/{preset_name} ──────────────────────────────────
    @router.post("/master/preset/{preset_name}", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_with_preset(
        preset_name: str,
        file: UploadFile = File(...),
        platform_target: str = Query(None, description="spotify|youtube|apple_music|tidal|club|cd"),
        output_format: str = Form("wav", pattern="^(wav|flac|mp3)$"),
        output_bit_depth: int = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
        mb_low_crossover: float = Query(None, ge=20.0, le=2000.0),
        mb_high_crossover: float = Query(None, ge=500.0, le=20000.0),
        mb_low_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_low_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_low_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_low_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_low_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_mid_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_mid_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_mid_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_mid_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_mid_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_high_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_high_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_high_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_high_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_high_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_bypass: Optional[bool] = Query(None),
        input_gain_db: Optional[float] = Query(None, ge=-24.0, le=24.0),
    ):
        from mastering import get_preset
        try:
            params = get_preset(preset_name)
        except KeyError:
            logger.exception("Preset '%s' no encontrado", preset_name)
            raise HTTPException(404, "Preset no encontrado")
        params.pop("label", None)
        params["output_format"] = output_format
        params["output_bit_depth"] = output_bit_depth
        if platform_target:
            params["platform_target"] = platform_target
        for key in ["mb_low_crossover", "mb_high_crossover", "mb_low_threshold_db", "mb_low_ratio",
                    "mb_low_attack_ms", "mb_low_release_ms", "mb_low_makeup_db",
                    "mb_mid_threshold_db", "mb_mid_ratio", "mb_mid_attack_ms", "mb_mid_release_ms",
                    "mb_mid_makeup_db", "mb_high_threshold_db", "mb_high_ratio", "mb_high_attack_ms",
                    "mb_high_release_ms", "mb_high_makeup_db"]:
            val = locals().get(key)
            if val is not None:
                params[key] = val
        if mb_bypass is not None:
            params["mb_bypass"] = mb_bypass
        if input_gain_db is not None:
            params["input_gain_db"] = input_gain_db

        # Sync: ejecutar el mastering ahora y devolver el WAV. Antes este endpoint
        # respondía JSON con job_id (engañoso bajo el nombre /master/preset).
        return await _run_mastering_sync(file, params)

    # ─── /master ──────────────────────────────────────────────────────
    @router.post("/master", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_async(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        platform_target: str = Query(None, description="spotify|youtube|apple_music|tidal|club|cd"),
        output_format: str = Form("wav", pattern="^(wav|flac|mp3)$"),
        output_bit_depth: int = Query(24, description="Bit depth de salida (WAV/FLAC): 16, 24 o 32 (float). Se aplica dither TPDF si baja de 32."),
        loudness_target: Optional[float] = Query(None, ge=-30.0, le=-4.0, description="Si se especifica fija el LUFS de salida a este valor."),
        mb_low_crossover: float = Query(None, ge=20.0, le=2000.0),
        mb_high_crossover: float = Query(None, ge=500.0, le=20000.0),
        mb_low_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_low_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_low_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_low_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_low_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_mid_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_mid_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_mid_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_mid_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_mid_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_high_threshold_db: float = Query(None, ge=-60.0, le=0.0),
        mb_high_ratio: float = Query(None, ge=1.0, le=20.0),
        mb_high_attack_ms: float = Query(None, ge=0.1, le=200.0),
        mb_high_release_ms: float = Query(None, ge=10.0, le=1000.0),
        mb_high_makeup_db: float = Query(None, ge=-12.0, le=24.0),
        mb_bypass: Optional[bool] = Query(None),
        input_gain_db: Optional[float] = Query(None, ge=-24.0, le=24.0),
        headroom_db: float = Query(-1.0, ge=-3.0, le=0.0),
        ceiling_db: float = Query(-0.3, ge=-1.0, le=0.0),
        limiter_ceiling: Optional[float] = Query(None, ge=0.5, le=1.0, description="Limiter ceiling lineal 0.5-1.0 (lo que acepta el motor). Si se envía, sobreescribe ceiling_db."),
    ):
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth}
        if loudness_target:
            params["loudness_target"] = loudness_target
        if platform_target:
            params["platform_target"] = platform_target
        # Whitelist contra la signature real de process_audio: solo pasamos
        # parámetros que la función acepta. Esto evita que free variables del
        # closure (dependencies, router, get_current_user) contaminen params
        # via locals() y rompan process_audio(**params) con TypeError.
        if _PROCESS_AUDIO_PARAMS:
            for key, val in locals().items():
                if val is not None and key in _PROCESS_AUDIO_PARAMS:
                    params[key] = val
        else:
            # Fallback si la signature no pudo leerse: exclusión explícita
            # de las free variables conocidas del closure.
            for key, val in locals().items():
                if val is not None and key not in (
                    "file", "background_tasks", "platform_target", "output_format",
                    "output_bit_depth", "loudness_target", "params",
                    "dependencies", "router", "get_current_user",
                    "headroom_db", "ceiling_db",
                ):
                    params[key] = val

        jobs = dependencies.get("jobs")
        run_mastering_job = dependencies.get("run_mastering_job")
        upload_dir = dependencies.get("UPLOAD_DIR")
        validate_audio_file_fn = dependencies.get("validate_audio_file")
        read_and_validate_fn = dependencies.get("read_and_validate")

        validate_audio_file_fn(file.filename)
        data = await read_and_validate_fn(file)
        job_id = uuid.uuid4().hex
        input_path = os.path.join(upload_dir, f"{job_id}_{file.filename}")
        with open(input_path, "wb") as fh:
            fh.write(data)

        jobs.create_job(job_id, {
            "status": "queued",
            "filename": file.filename,
            "created_at": time.time(),
            "params": params,
            "progress": 0,
            "stage": "En cola",
        })
        background_tasks.add_task(run_mastering_job, job_id, input_path, params)
        return {"job_id": job_id, "status": "queued", "poll_url": f"/job/{job_id}"}

    # ─── /master/sync ─────────────────────────────────────────────────
    @router.post("/master/sync", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_sync(
        file: UploadFile = File(...),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
        loudness_target: Optional[float] = Query(None, ge=-30.0, le=-4.0),
        headroom_db: float = Query(-1.0, ge=-3.0, le=0.0),
        ceiling_db: float = Query(-0.3, ge=-1.0, le=0.0),
    ):
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth,
                  "headroom_db": headroom_db, "ceiling_db": ceiling_db}
        if loudness_target is not None:
            params["loudness_target"] = loudness_target
        if platform_target:
            params["platform_target"] = platform_target
        return await _run_mastering_sync(file, params)

    # ─── Helper: resolve reference params ──────────────────────────────
    async def _read_reference_params(reference_file: Optional[UploadFile], reference_source: str, reference_library_id: Optional[str]) -> dict:
        """Resuelve los params de referencia a partir de los Form fields del request.

        F10.1/F10.2-fix: antes leía atributos inexistentes del objeto ``fastapi.Request``
        (``request.reference_file``, ``request.reference_source``), que devolvía AttributeError
        cuando los endpoints async eran invocados. Ahora el caller declara los Form fields
        y los pasa explícitamente.
        """
        if reference_source == "library":
            if not reference_library_id:
                raise HTTPException(400, "reference_library_id required when reference_source=library")
            from library import library as _lib
            upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
                os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
            )
            ref_path = _lib.get_path(upload_dir, reference_library_id)
            if not ref_path or not os.path.exists(ref_path):
                raise HTTPException(404, "Reference file not found")
            return {"path": str(ref_path), "filename": os.path.basename(ref_path)}
        elif reference_source == "upload":
            if reference_file is None:
                raise HTTPException(400, "reference_file required when reference_source=upload")
            data = await reference_file.read()
            filename = os.path.basename(getattr(reference_file, "filename", "reference.wav")) or "reference.wav"
            return {"data": data, "filename": filename}
        raise HTTPException(400, "Invalid reference_source")

    # ─── /master/reference ─────────────────────────────────────────────
    @router.post("/master/reference", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_with_reference(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        reference_file: Optional[UploadFile] = File(None),
        reference_source: str = Form("upload"),
        reference_library_id: Optional[str] = Form(None),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
    ):
        ref_params = await _read_reference_params(reference_file, reference_source, reference_library_id)
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth, "reference": ref_params}
        if platform_target:
            params["platform_target"] = platform_target
        background_tasks.add_task(_run_reference_job, file, params)
        return {"status": "processing"}

    # ─── /master/reference/sync ───────────────────────────────────────
    @router.post("/master/reference/sync", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_with_reference_sync(
        file: UploadFile = File(...),
        reference_file: UploadFile = File(...),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
        loudness_target: Optional[float] = Query(None, ge=-30.0, le=-4.0),
    ):
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth}
        if loudness_target is not None:
            params["loudness_target"] = loudness_target
        if platform_target:
            params["platform_target"] = platform_target
        return await _run_mastering_sync(file, params, reference_file=reference_file)

    # ─── /master/multi-reference (FIX K8) ───────────────────────────────
    # Endpoint NUEVO: masteriza `file` contra una combinación ponderada de
    # N (1-5) referencias. El FE manda reference_files[] + reference_weights
    # (comma-separated). El backend combina las referencias en un único WAV
    # (weighted average) y llama a process_audio_with_reference.
    # Ver frontend/src/features/mastering/reference-mastering.ts:1311
    @router.post("/master/multi-reference", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_with_multi_reference(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        reference_files: List[UploadFile] = File(...),
        reference_weights: str = Form("1.0"),
        reference_source: str = Form("upload"),
        reference_library_ids: Optional[str] = Form(None),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
    ):
        # 1. Validar cantidad de referencias (1-5)
        if not reference_files or len(reference_files) < 1:
            raise HTTPException(400, "At least 1 reference file required")
        if len(reference_files) > 5:
            raise HTTPException(400, "Maximum 5 reference files")

        # 2. Parsear reference_weights: comma-separated floats, clamp [0,1],
        #    normalizar para que sumen 1.0. Si el conteo no matchea, default uniforme.
        try:
            weights = [float(w) for w in reference_weights.split(",") if w.strip() != ""]
        except ValueError:
            raise HTTPException(400, "Invalid reference_weights format (comma-separated floats expected)")
        if len(weights) != len(reference_files):
            weights = [1.0 / len(reference_files)] * len(reference_files)
        else:
            weights = [max(0.0, min(1.0, w)) for w in weights]
            total = sum(weights)
            weights = [w / total for w in weights] if total > 0 else [1.0 / len(reference_files)] * len(reference_files)

        # 3. Resolver paths de las referencias (leer a disco si upload, o de library)
        upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
        )
        os.makedirs(upload_dir, exist_ok=True)
        ref_paths: list = []
        if reference_source == "library":
            if not reference_library_ids:
                raise HTTPException(400, "reference_library_ids required when reference_source=library")
            from library import library as _lib
            for lib_id in reference_library_ids.split(","):
                lib_id = lib_id.strip()
                if not lib_id:
                    continue
                p = _lib.get_path(upload_dir, lib_id)
                if not p or not os.path.exists(p):
                    raise HTTPException(404, f"Reference library file not found: {lib_id}")
                ref_paths.append(str(p))
        elif reference_source == "upload":
            for rf in reference_files:
                data = await rf.read()
                fn = os.path.basename(getattr(rf, "filename", "reference.wav")) or "reference.wav"
                p = os.path.join(upload_dir, f"multiref_in_{uuid.uuid4().hex}_{fn}")
                with open(p, "wb") as fh:
                    fh.write(data)
                ref_paths.append(p)
        else:
            raise HTTPException(400, "Invalid reference_source (must be 'upload' or 'library')")

        if len(ref_paths) < 1:
            raise HTTPException(400, "Could not resolve any reference path")

        # 4. Combinar las N referencias en un único WAV (weighted average).
        #    Si falla la combinación (SR/channels incompatibles sin resample),
        #    hacemos cleanup de los temporales y 500.
        try:
            combined_path = _combine_references_weighted(ref_paths, weights, upload_dir)
        except Exception as exc:
            logger.exception("/master/multi-reference: combine failed: %s", exc)
            for p in ref_paths:
                try: os.remove(p)
                except Exception: pass
            raise HTTPException(500, f"Could not combine references: {exc}")

        # 5. Encolar el job async (como /master/reference). El job runner
        #    limpia los temporales (ref_paths + combined_path) al final.
        params = {
            "output_format": output_format,
            "output_bit_depth": output_bit_depth,
        }
        if platform_target:
            # process_audio_with_reference NO acepta platform_target; lo
            # ignoramos con warning para no romper el kwarg filter.
            logger.warning("/master/multi-reference: platform_target=%r ignorado (process_audio_with_reference no lo soporta)", platform_target)
        background_tasks.add_task(
            _run_multi_reference_job, file, params, combined_path, ref_paths
        )
        return {
            "status": "processing",
            "mode": "multi-reference",
            "reference_count": len(ref_paths),
            "weights": [round(w, 4) for w in weights],
        }

    # ─── /master/normalize ─────────────────────────────────────────────
    @router.post("/master/normalize", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_normalize(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        reference_file: Optional[UploadFile] = File(None),
        reference_source: str = Form("upload"),
        reference_library_id: Optional[str] = Form(None),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
    ):
        # FIX ruff F841: ref_params se leía pero no se aplicaba. El endpoint
        # /master/normalize solo normaliza loudness, no aplica matching de
        # referencia (para eso está /master). Los params reference_* se aceptan
        # por compatibilidad de API pero no se procesan en este endpoint.
        # El FE solo usa /master/normalize/sync (verificado con grep).
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth, "normalize": True}
        if platform_target:
            params["platform_target"] = platform_target
        background_tasks.add_task(_run_normalize_job, file, params)
        return {"status": "processing"}

    # ─── /master/normalize/sync ────────────────────────────────────────
    @router.post("/master/normalize/sync", tags=["Mastering"], dependencies=[Depends(get_current_user)])
    async def master_normalize_sync(
        file: UploadFile = File(...),
        platform_target: str = Query(None),
        output_format: str = Form("wav"),
        output_bit_depth: int = Query(24),
        loudness_target: float = Query(-14.0, ge=-30.0, le=-4.0),
    ):
        params = {"output_format": output_format, "output_bit_depth": output_bit_depth,
                  "normalize": True, "loudness_target": loudness_target}
        if platform_target:
            params["platform_target"] = platform_target
        return await _run_mastering_sync(file, params)

    # ─── /pitch-correct ───────────────────────────────────────────────
    # B-S4: este endpoint era el único /master/* SIN auth — un agujero P0
    # conocido. Sin `dependencies=`, cualquiera podía disparar correcciones de
    # pitch costosas (CPU/GPU) sobre archivos arbitrarios sin presentar un JWT
    # válido, abriendo abuso de recursos y exfiltración de archivos ajenos.
    # `Depends(get_current_user)` valida firma Y exp del Bearer token antes de
    # tocar _run_pitch_job. Mismo patrón que los otros /master/* (línea 337).
    @router.post("/pitch-correct", tags=["Audioprocesamiento"], dependencies=[Depends(get_current_user)])
    async def pitch_correct(
        background_tasks: BackgroundTasks,
        file: UploadFile = File(...),
        mode: str = Query("auto", description="auto|manual"),
        scale: Optional[str] = Query(None, description="e.g. C major, A minor"),
        corrections: Optional[int] = Query(None, ge=1, le=10),
    ):
        # FIX K10 (Opción B): generar job_id, guardarlo en PITCH_JOBS con
        # status="processing", y encolar el job. El cliente recibe job_id
        # y pollea GET /pitch-correct/{job_id} hasta que esté "done".
        job_id = uuid.uuid4().hex
        PITCH_JOBS[job_id] = {
            "status": "processing",
            "path": None,
            "created": time.time(),
            "mode": mode,
            "scale": scale,
        }
        background_tasks.add_task(_run_pitch_job, job_id, file, mode, scale, corrections)
        return {"status": "processing", "job_id": job_id, "mode": mode, "scale": scale}

    @router.get("/pitch-correct/{job_id}", tags=["Audioprocesamiento"], dependencies=[Depends(get_current_user)])
    async def pitch_correct_download(job_id: str):
        # FIX K10 (Opción B): endpoint de descarga. Mapea job_id → path
        # internamente, NUNCA expone out_path al cliente.
        job = PITCH_JOBS.get(job_id)
        if not job:
            raise HTTPException(404, "Pitch job not found (or expired)")
        # Cleanup de jobs expirados (lazy GC on-access)
        if time.time() - job.get("created", 0) > PITCH_JOB_TTL_SECONDS:
            path = job.get("path")
            if path and os.path.exists(path):
                try: os.remove(path)
                except Exception: pass
            PITCH_JOBS.pop(job_id, None)
            raise HTTPException(404, "Pitch job expired")
        status = job.get("status")
        if status == "processing":
            raise HTTPException(409, "Pitch job still processing")
        if status == "error":
            PITCH_JOBS.pop(job_id, None)
            raise HTTPException(500, job.get("error", "Pitch correction failed"))
        if status == "done":
            path = job.get("path")
            if not path or not os.path.exists(path):
                PITCH_JOBS.pop(job_id, None)
                raise HTTPException(404, "Pitch result file missing")
            # Una vez descargado, limpiar el job del registry (el archivo se
            # sirve vía FileResponse que lo lee antes de que el handler retorne).
            PITCH_JOBS.pop(job_id, None)
            return FileResponse(
                path,
                media_type="audio/wav",
                filename=f"pitch_corrected_{job_id[:8]}.wav",
            )
        raise HTTPException(500, f"Unknown job status: {status}")

    return router


# ─── Job runners (called by background_tasks) ─────────────────────────────────
# NOTA: /master y /master/reference async siguen usando el run_mastering_job
# real de job_runners.py (el que pasa por dependencies), que crea el job_id,
# trackea progreso y llama process_audio(**params) desempaquetado. Los
# endpoints /master/*/sync ya no necesitan runners propios: comparten
# _run_mastering_sync() definida arriba, que persiste a disco bajo
# /root/diego/backend/uploads (NO usa /tmp) y devuelve el WAV.

async def _run_reference_job(file: UploadFile, params: dict):
    """Job runner para /master/reference (async).

    F10.1-fix: antes recibía ``request`` y leía atributos inexistentes (``request.reference_file``);
    ahora recibe el ``UploadFile`` principal y el dict ``params`` ya resuelto por
    ``_read_reference_params`` (incluye ``reference`` con ``path`` o ``data``+``filename``).
    """
    from mastering import process_audio
    try:
        ref_meta = params.get("reference") or {}
        upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
        )
        os.makedirs(upload_dir, exist_ok=True)
        if "path" in ref_meta:
            input_path = ref_meta["path"]
            filename = ref_meta.get("filename") or os.path.basename(input_path)
        else:
            uid = uuid.uuid4().hex
            filename = os.path.basename(ref_meta.get("filename", "reference.wav")) or "reference.wav"
            input_path = os.path.join(upload_dir, f"job_in_{uid}_{filename}")
            with open(input_path, "wb") as fh:
                fh.write(ref_meta.get("data") or b"")
        params = dict(params)
        params["reference"] = {"path": input_path, "filename": filename}
        result = process_audio(input_path, **params)
        return {"status": "done", "path": result}
    except Exception as exc:
        logger.exception("Reference job failed: %s", exc)
        return {"status": "error", "error": "Reference mastering failed", "code": 500}


# ─── FIX K8: helpers para /master/multi-reference ────────────────────────
def _combine_references_weighted(ref_paths: list, weights: list, upload_dir: str) -> str:
    """Combina N referencias en un único WAV (weighted average).

    Lee cada referencia con soundfile, resamplea al SR de la primera con
    librosa si difieren, normaliza channels al máximo, pad al largo del
    más corto, suma ponderada, escribe un único WAV temporal.
    Retorna el path del WAV combinado.
    """
    import librosa
    import numpy as np
    import soundfile as sf

    if not ref_paths:
        raise ValueError("No reference paths to combine")

    audios: list = []
    sr_common = None
    for p in ref_paths:
        audio, sr = sf.read(p, always_2d=True, dtype="float32")
        if sr_common is None:
            sr_common = sr
        elif sr != sr_common:
            # Resamplear al sr_common (librosa.resample espera shape (channels, frames))
            audio = librosa.resample(audio.T, orig_sr=sr, target_sr=sr_common).T
        audios.append((audio, sr_common))

    # Normalizar channels: todo al max_ch (expandir mono a multichannel)
    max_ch = max(a.shape[1] for a, _ in audios)
    normalized: list = []
    for a, _ in audios:
        if a.shape[1] < max_ch:
            # Expandir mono → multichannel repitiendo el canal
            a = np.tile(a, (1, max_ch // a.shape[1]))
        normalized.append(a)

    # Pad/truncate al largo del más corto (para sumar sample a sample)
    min_len = min(a.shape[0] for a in normalized)
    combined = np.zeros((min_len, max_ch), dtype=np.float32)
    for a, w in zip(normalized, weights):
        combined += a[:min_len] * w

    # Clamp por seguridad (la suma ponderada normalizada no debería exceder 1.0
    # pero referencias con peaks altos podrían sumar >1 transitoriamente).
    combined = np.clip(combined, -1.0, 1.0)

    out_path = os.path.join(upload_dir, f"multiref_combined_{uuid.uuid4().hex}.wav")
    sf.write(out_path, combined, sr_common, subtype="PCM_24")
    return out_path


async def _run_multi_reference_job(
    file: UploadFile,
    params: dict,
    combined_ref_path: str,
    ref_paths_to_cleanup: list,
):
    """Job runner para /master/multi-reference (async).

    Combina las N referencias (ya hecha por el endpoint en
    ``combined_ref_path``) y llama a ``process_audio_with_reference`` con
    SOLO los kwargs que esa función acepta (filtrados via inspect). Limpia
    los temporales (input, ref_paths, combined) en el ``finally``.
    """
    from mastering import process_audio_with_reference
    try:
        upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
        )
        os.makedirs(upload_dir, exist_ok=True)
        uid = uuid.uuid4().hex
        input_filename = os.path.basename(file.filename or "input.wav") or "input.wav"
        input_path = os.path.join(upload_dir, f"multiref_in_{uid}_{input_filename}")
        with open(input_path, "wb") as fh:
            fh.write(await file.read())
        try:
            # Filtrar params a los que process_audio_with_reference acepta
            # (es distinto de process_audio). Cacheamos la signature una vez.
            global _PROCESS_AUDIO_WITH_REFERENCE_PARAMS
            try:
                _PROCESS_AUDIO_WITH_REFERENCE_PARAMS
            except NameError:
                try:
                    _PROCESS_AUDIO_WITH_REFERENCE_PARAMS = set(
                        inspect.signature(process_audio_with_reference).parameters
                    )
                except Exception:
                    _PROCESS_AUDIO_WITH_REFERENCE_PARAMS = set()
            filtered = {
                k: v for k, v in params.items()
                if k in _PROCESS_AUDIO_WITH_REFERENCE_PARAMS
            }
            result = process_audio_with_reference(
                input_path,
                reference_path=combined_ref_path,
                **filtered,
            )
            return {"status": "done", "path": result}
        finally:
            # Cleanup de todos los temporales (input + refs originales + combinado)
            for p in [input_path] + list(ref_paths_to_cleanup) + [combined_ref_path]:
                if p and os.path.exists(p):
                    try: os.remove(p)
                    except Exception: pass
    except Exception as exc:
        logger.exception("Multi-reference job failed: %s", exc)
        # Cleanup en caso de error (el finally de arriba no corre si file.read() falla)
        for p in list(ref_paths_to_cleanup) + [combined_ref_path]:
            if p and os.path.exists(p):
                try: os.remove(p)
                except Exception: pass
        return {"status": "error", "error": "Multi-reference mastering failed", "code": 500}


async def _run_normalize_job(file: UploadFile, params: dict):
    """Job runner para /master/normalize (async). Misma corrección que _run_reference_job."""
    from mastering import process_audio
    try:
        ref_meta = params.get("reference") or {}
        upload_dir = globals().get("UPLOAD_DIR") or os.path.join(
            os.path.dirname(os.path.abspath(__file__)), "..", "uploads"
        )
        os.makedirs(upload_dir, exist_ok=True)
        if "path" in ref_meta:
            input_path = ref_meta["path"]
            filename = ref_meta.get("filename") or os.path.basename(input_path)
        else:
            uid = uuid.uuid4().hex
            filename = os.path.basename(ref_meta.get("filename", "reference.wav")) or "reference.wav"
            input_path = os.path.join(upload_dir, f"job_in_{uid}_{filename}")
            with open(input_path, "wb") as fh:
                fh.write(ref_meta.get("data") or b"")
        params = dict(params)
        params["reference"] = {"path": input_path, "filename": filename}
        result = process_audio(input_path, **params)
        return {"status": "done", "path": result}
    except Exception as exc:
        logger.exception("Normalize job failed: %s", exc)
        return {"status": "error", "error": "Normalize mastering failed", "code": 500}

async def _run_pitch_job(job_id: str, file: UploadFile, mode: str, scale: Optional[str], corrections: Optional[int]):
    """Pitch correction global usando ``apply_pitch_shift``.

    FIX K10 (Opción B): ahora recibe ``job_id`` y actualiza el registry
    ``PITCH_JOBS`` con status="done"/"error" + path cuando termina. El
    endpoint GET /pitch-correct/{job_id} consulta ese registry.

    El helper ``correct_pitch`` ya no existe en ``pitch_correction.py`` (sólo
    ``apply_pitch_shift``, ``detect_pitch_contour`` y ``quantize_to_scale``);
    aquí se reaplica el shift global con ``cents = corrections * 100``.
    El parámetro ``scale`` se ignora con warning porque la cuantización a
    escala musical requiere el pipeline completo (``detect_pitch_contour`` →
    ``quantize_to_scale`` → ``apply_time_varying_pitch_shift``) que está fuera
    del alcance de este fix mínimo del P0 (ImportError bloqueante).
    """
    import soundfile as sf

    from pitch_correction import apply_pitch_shift
    if scale:
        logger.warning("/pitch-correct: scale=%r ignorado en este fix mínimo (cuantización fuera de scope)", scale)
    try:
        data = await file.read()
        upload_dir = globals().get("UPLOAD_DIR") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "uploads")
        in_path = os.path.join(upload_dir, f"pitch_in_{uuid.uuid4().hex}.tmp")
        out_path = os.path.join(upload_dir, f"pitch_out_{uuid.uuid4().hex}.wav")
        with open(in_path, "wb") as fh:
            fh.write(data)
        try:
            audio, sr = sf.read(in_path, always_2d=True, dtype="float32")
            cents = float((corrections or 0) * 100)
            # FIX K10-bug-pre-existente: `librosa.effects.pitch_shift` falla con
            # `ParameterError: Audio buffer is not finite everywhere` cuando el
            # audio es 2D (mono shape (N,1) o stereo shape (N,2)). Solo funciona
            # con audio 1D. Verificado con librosa 1.0.0 en Python 3.14.
            # Squeeze del mono (N,1) → (N,) antes de pasar a apply_pitch_shift.
            # Si es multichannel (N, C>1), aplico el shift canal por canal.
            if audio.ndim == 2:
                if audio.shape[1] == 1:
                    audio = audio[:, 0]  # (N,1) → (N,)
                else:
                    # Multichannel: shift por canal y re-stack
                    import numpy as np
                    shifted_channels = [
                        apply_pitch_shift(audio[:, c], sr, cents=cents, mode="librosa")
                        for c in range(audio.shape[1])
                    ]
                    shifted = np.column_stack(shifted_channels).astype(np.float32, copy=False)
                    sf.write(out_path, shifted, sr, subtype="PCM_24")
                    # Skip el apply_pitch_shift de abajo (ya lo hicimos por canal)
                    if job_id in PITCH_JOBS:
                        PITCH_JOBS[job_id].update({
                            "status": "done",
                            "path": out_path,
                            "cents": cents,
                        })
                    return {"status": "done", "path": out_path, "cents": cents}
            shifted = apply_pitch_shift(audio, sr, cents=cents, mode="librosa")
            sf.write(out_path, shifted, sr, subtype="PCM_24")
            # FIX K10: actualizar el registry con el resultado. El path
            # queda en disco (pitch_out_*.wav) hasta que el cliente lo
            # descarga vía GET /pitch-correct/{job_id} o expira por TTL.
            if job_id in PITCH_JOBS:
                PITCH_JOBS[job_id].update({
                    "status": "done",
                    "path": out_path,
                    "cents": cents,
                })
            return {"status": "done", "path": out_path, "cents": cents}
        finally:
            if os.path.exists(in_path):
                try: os.remove(in_path)
                except Exception: pass
    except Exception as exc:
        logger.exception("Pitch job failed: %s", exc)
        # FIX K10: marcar el job como error en el registry.
        if job_id in PITCH_JOBS:
            PITCH_JOBS[job_id].update({
                "status": "error",
                "error": "Pitch correction failed",
            })
        return {"status": "error", "error": "Pitch correction failed", "code": 500}
