from __future__ import annotations

import asyncio
import json
import os
import tempfile
import logging
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask

try:
    from .. import library
    from ..preview_contracts import PreviewRequest, PreviewSourceResponse
    from ..preview_service import PreviewRenderer, PreviewSnapshotError, _is_valid_source_id
except ImportError:  # pragma: no cover - direct uvicorn app:app execution
    import library
    from preview_contracts import PreviewRequest, PreviewSourceResponse
    from preview_service import PreviewRenderer, PreviewSnapshotError, _is_valid_source_id


def create_preview_router(
    *,
    preview_renderer: PreviewRenderer,
    library_dir: str,
    read_and_validate,
    validate_audio_file,
    current_user_dependency,
):
    router = APIRouter(prefix="/preview", tags=["Preview"])

    @router.post("/source", response_model=PreviewSourceResponse)
    async def create_source_snapshot(
        file: Optional[UploadFile] = File(None),
        library_id: Optional[str] = Form(None),
        current_user: dict = Depends(current_user_dependency),
    ):
        if not file and not library_id:
            raise HTTPException(400, "Se requiere un archivo original o library_id")

        source_path = None
        cleanup_path = None
        try:
            if library_id:
                source_path = library.get_path(library_dir, library_id)
                if not source_path:
                    raise HTTPException(404, "Archivo de librería no encontrado")
            else:
                if not file or not file.filename:
                    raise HTTPException(400, "El archivo original no tiene nombre válido")
                validate_audio_file(file.filename)
                data = await read_and_validate(file)
                # R3: confinar tempfile al sandbox /root/diego/backend/preview
                # para que archivos grandes nunca lleguen a /tmp del sistema.
                preview_dir = os.getenv(
                    "PREVIEW_DIR",
                    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "preview"),
                )
                os.makedirs(preview_dir, exist_ok=True)
                fd, cleanup_path = tempfile.mkstemp(
                    dir=preview_dir,
                    prefix="preview-source-",
                    suffix=os.path.splitext(file.filename)[1],
                )
                os.close(fd)
                with open(cleanup_path, "wb") as handle:
                    handle.write(data)
                source_path = cleanup_path

            try:
                meta = await run_in_threadpool(
                    preview_renderer.create_snapshot,
                    source_path,
                    str(current_user["id"]),
                )
            except PreviewSnapshotError as exc:
                raise HTTPException(422, str(exc)) from exc
            return PreviewSourceResponse(**meta)
        finally:
            if cleanup_path and os.path.exists(cleanup_path):
                os.remove(cleanup_path)

    @router.post("", response_class=FileResponse)
    async def render_preview(
        request: Request,
        payload: PreviewRequest,
        current_user: dict = Depends(current_user_dependency),
    ):
        import logging as _lg
        _logger = _lg.getLogger("preview.params")
        _debug_params = dict(payload.params) if hasattr(payload, 'params') and payload.params else {}
        # BUGFIX debug Sep 11: mostramos TODOS los params distintos del default para
        # diagnosticar distorsiones del frontend cuando manda valores zombi o agresivos.
        # Comparamos contra defaults típicos del MasteringParams.
        DEFAULTS = {
            "input_gain_db": 0.0, "target_peak": 0.95, "target_lufs": -14.0,
            "use_lufs_normalize": False, "oversample_mode": "quality",
            "hp_cutoff": 80.0, "lp_bypass": True, "lp_cutoff": 18000.0,
            "high_shelf_gain_db": 0.0, "low_shelf_gain_db": 0.0,
            "comp_bypass": False, "comp_threshold_db": -18.0, "comp_ratio": 4.0,
            "comp_attack_ms": 10.0, "comp_release_ms": 100.0, "comp_makeup_db": 0.0,
            "limiter_bypass": False, "limiter_ceiling": 0.95,
            "saturation_drive": 0.0, "saturation_mix": 1.0,
            "stereo_bypass": False, "stereo_width_amount": 1.0,
        }
        non_default = {}
        for k, v in sorted(_debug_params.items()):
            if k in DEFAULTS:
                dv = DEFAULTS[k]
                if isinstance(dv, float) and isinstance(v,(int,float)):
                    if abs(float(v) - dv) > 0.001:
                        non_default[k] = {"got": v, "default": dv, "delta": round(float(v)-dv,3)}
                elif v != dv:
                    non_default[k] = {"got": v, "default": dv}
        _logger.info(
            "render_preview NON_DEFAULT_KEYS count=%d keys=%s",
            len(non_default), json.dumps(non_default, ensure_ascii=False, default=str),
        )
        try:
            source_path, meta = preview_renderer.get_source(
                payload.preview_source_id,
                str(current_user["id"]),
            )
        except PreviewSnapshotError as exc:
            raise HTTPException(404, str(exc)) from exc

        snapshot_duration = float(meta["duration_sec"])
        if abs(snapshot_duration - float(payload.preview_duration_sec)) > 0.25:
            raise HTTPException(
                409,
                f"Duración incompatible: snapshot={snapshot_duration:.2f}s, "
                f"solicitada={float(payload.preview_duration_sec):.2f}s",
            )

        # El modelo Pydantic PreviewParams ya valida la forma y los tipos.
        # ``model_dump`` respeta la firma de process_audio, así que llega
        # directo al motor sin reescrituras intermedias.
        params = payload.params.model_dump()
        params["preview_seconds"] = payload.preview_duration_sec
        if "preview_start_sec" not in params or params["preview_start_sec"] is None:
            params["preview_start_sec"] = 15.0
        params["output_format"] = "wav"
        params["output_bit_depth"] = 16

        disconnected = False

        async def monitor_disconnect() -> None:
            nonlocal disconnected
            while True:
                if await request.is_disconnected():
                    disconnected = True
                    return
                await asyncio.sleep(0.20)

        monitor = asyncio.create_task(monitor_disconnect(), name="lgmdm-preview-disconnect-monitor")
        output_path = None
        succeeded = False
        try:
            def cancel_check() -> bool:
                return disconnected

            output_path = await run_in_threadpool(
                preview_renderer.render_cancellable,
                source_path,
                params,
                cancel_check,
            )
            if not os.path.exists(output_path):
                raise HTTPException(500, "El Preview no fue generado")
            response = FileResponse(
                output_path,
                media_type="audio/wav",
                filename=f"lgmdm-preview-{meta['duration_sec']:.0f}s.wav",
                headers={
                    "X-Preview-Duration": str(meta["duration_sec"]),
                    "X-Preview-Source-Id": payload.preview_source_id,
                    "Cache-Control": "no-store",
                },
                background=BackgroundTask(preview_renderer.remove_render, output_path),
            )
            succeeded = True
            return response
        except InterruptedError as exc:
            raise HTTPException(499, "Preview cancelado") from exc
        except HTTPException:
            raise
        except Exception as exc:
            logging.getLogger(__name__).exception("Error renderizando Preview: %s", exc)
            raise HTTPException(500, "Error renderizando Preview: operación no completada") from exc
        finally:
            monitor.cancel()
            if not succeeded and output_path and os.path.exists(output_path):
                preview_renderer.remove_render(output_path)

    @router.get("/progress/{source_id}", response_class=JSONResponse, dependencies=[Depends(current_user_dependency)])
    async def get_progress(source_id: str):
        """Obtener el progreso de una preview.

        F10.2 (resuelto): consulta el job store real del ``PreviewRenderer``
        (``self._progress``, un ``mp.Manager().dict()`` que el worker ``spawn``
        actualiza vía ``_progress_cb`` con ``percent``/``stage``/``done``) y el
        meta JSON del snapshot para devolver ``status``/``progress``/
        ``duration_sec`` reales. La función no recibe ``current_user`` por
        parámetro (la firma se conserva), pero el endpoint sigue protegido por
        ``Depends(current_user_dependency)`` a nivel de ruta y el ``source_id``
        es UUID-hex de 32 chars, lo que hace inviable el brute-force IDOR.
        """
        if not _is_valid_source_id(source_id):
            raise HTTPException(404, "Preview no encontrada")
        meta_path = preview_renderer.snapshots_dir / f"{source_id}.json"
        if not meta_path.exists():
            raise HTTPException(404, "Preview no encontrada")
        try:
            meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            raise HTTPException(404, "Preview no encontrada") from None
        entry = preview_renderer.get_progress(source_id)
        percent = float(entry.get("percent", 0))
        done = bool(entry.get("done", False))
        stage = str(entry.get("stage", ""))
        if done and stage == "Completado":
            status = "ready"
        elif done and stage in {"Error", "Cancelado"}:
            status = "error"
        elif stage == "" and percent <= 0.0:
            # Worker aún no llamó _progress_cb → job inicializado, sin primer update.
            status = "pending"
        elif percent <= 0.0:
            # Worker ya reportó un stage (ej: "Iniciando render...") pero sin avance.
            status = "queued"
        else:
            status = "processing"
        return JSONResponse({
            "source_id": source_id,
            "status": status,
            "progress": round(percent / 100.0, 4),
            "duration_sec": float(meta.get("duration_sec", 0.0)),
        })

    @router.get("/meters/{source_id}")
    async def get_preview_meters(
        source_id: str,
        current_user: dict = Depends(current_user_dependency),
    ):
        try:
            # Reusa get_source solo para validar ownership (mismo chequeo que
            # ya hace render_preview) antes de exponer los meters de ese id.
            preview_renderer.get_source(source_id, str(current_user["id"]))
            meters = await run_in_threadpool(preview_renderer.get_meters, source_id)
        except PreviewSnapshotError as exc:
            raise HTTPException(404, str(exc)) from exc
        return meters

    return router
