from __future__ import annotations

from fastapi import APIRouter, HTTPException


def create_info_router(*, app, jobs, upload_dir: str, processed_dir: str, stems_dir: str,
                       max_file_size: int, mastering_presets: dict, get_preset,
                       platform_loudness_targets: dict, frontend_origin: str | None = None,
                       reference_library_module=None) -> APIRouter:
    router = APIRouter()

    @router.get("/", tags=["Info"])
    def root():
        return {
            "service": "Audio Mastering API",
            "version": app.version,
            "max_file_mb": max_file_size // 1024 // 1024,
            "endpoints": [
                "/master", "/master/sync", "/master/reference", "/master/reference/sync",
                "/preview", "/analyze", "/spectrum",
                "/mix-advice", "/job/{id}", "/download/{id}", "/report/{id}", "/report/{id}/visual",
                "/stems/separate", "/stems/download/{id}/{stem}",
                "/presets", "/preset/{name}", "/platform-targets",
                "/dashboard", "/ws/dashboard", "/ws/master-stream", "/ws/mix-stream",
            ],
        }

    @router.get("/health", tags=["Info"])
    def health():
        import time, os
        # D-2: métricas livianas vía psutil (ya presente en venv) — < 100ms, sin deps pesadas
        try:
            import psutil
            process = psutil.Process()
            rss_mb = process.memory_info().rss / 1024 / 1024
            up_dir = os.path.dirname(os.path.normpath(upload_dir))
            disk_mb = psutil.disk_usage(up_dir).free / 1024 / 1024
        except Exception:
            rss_mb = -1.0
            disk_mb = -1.0
        # D-2: dependencias críticas (imports ya cargados en el proceso — rápidos)
        deps = {}
        for name in ("numpy", "scipy", "soundfile", "librosa", "torch"):
            try:
                mod = __import__(name)
                deps[name] = getattr(mod, "__version__", "present")
            except Exception:
                deps[name] = None
        running = [j for j in jobs.get_all().values() if j.get("status") == "processing"]
        # D-2: uptime desde START_TIME del lifespan (expuesto en app.state)
        st = getattr(app.state, "START_TIME", None)
        uptime_seconds = round(time.time() - st, 3) if st else 0.0
        payload = {
            "status": "ok",
            "service": "Audio Mastering API",
            "version": app.version,
            # D-2: uptime desde START_TIME del lifespan (app.py)
            "uptime_seconds": uptime_seconds,
            # D-2: jobs en curso (status processing)
            "jobs_active": len(running),
            "jobs_total": len(jobs.get_all()),
            "max_file_size_mb": max_file_size // 1024 // 1024,
            "frontend_origin": frontend_origin,
            # D-2: memoria RSS y espacio libre en disco (mb)
            "memory_mb": rss_mb,
            "disk_space_mb": disk_mb,
            # D-2: disponibilidad de deps críticas
            "dependencies": deps,
        }
        if reference_library_module is not None:
            payload["reference_library"] = reference_library_module.diagnostics()
        return payload

    @router.get("/presets", tags=["Presets"])
    def list_presets():
        return {name: preset for name, preset in mastering_presets.items()}

    @router.get("/preset/{name}", tags=["Presets"])
    def get_preset_endpoint(name: str):
        try:
            return get_preset(name)
        except KeyError as exc:
            raise HTTPException(404, str(exc)) from exc

    @router.get("/platform-targets", tags=["Mastering"])
    def platform_targets():
        return platform_loudness_targets

    return router
