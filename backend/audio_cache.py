"""
Caché de audio en memoria para el preview WebSocket.

Problema que resuelve:
  En cada cambio de slider, el frontend re-enviaba el archivo de audio completo
  al backend (hasta 200 MB) antes de que el servidor pudiera procesar los nuevos
  parámetros. Esto causaba:
  - Latencia de red innecesaria (100-500 ms por preview en LAN, segundos en WAN)
  - Picos de CPU por re-decodificar el mismo archivo cada vez
  - Picos de RAM al tener N uploads simultáneos del mismo archivo

Solución:
  El cliente genera un session_id (UUID) cuando carga un archivo. Al primer
  preview envía el archivo completo + session_id. En los siguientes previews
  del mismo archivo solo envía session_id + parámetros, y el backend reutiliza
  el array numpy ya decodificado y recortado del caché.

  El caché es LRU con TTL: entradas que no se usaron en MAX_AGE_SEC se
  expiran automáticamente — lazy en cada acceso (put/get) y además un
  daemon thread hace un sweep cada _EVICT_PERIOD_SEC. Tiene un límite de
  MAX_ENTRIES entradas para no crecer sin límite.
"""
import threading
import time
from typing import Optional, Tuple
import numpy as np

MAX_ENTRIES = 20          # máx. sesiones simultáneas cacheadas
# TTL (time-to-live): cualquier entrada sin accesos en MAX_AGE_SEC segundos
# se evicta al siguiente get()/put() vía _evict_expired(). Se eligió un dict
# custom + lock en lugar de functools.lru_cache (que no soporta TTL) o
# cachetools.TTLCache (dep extra) para mantener el módulo zero-deps.
MAX_AGE_SEC = 600.0       # 10 minutos de inactividad → evicción
_EVICT_PERIOD_SEC = 60.0  # sweep periódico en background (1 min)

_lock = threading.Lock()
# { session_id: {"audio": np.ndarray, "sr": int, "last_access": float} }
_cache: dict = {}
_evict_stop = threading.Event()
_evict_thread: Optional[threading.Thread] = None


def _evict_expired() -> None:
    """Elimina entradas viejas. Debe llamarse con _lock sostenido por el caller."""
    now = time.monotonic()
    expired = [k for k, v in _cache.items() if now - v["last_access"] > MAX_AGE_SEC]
    for k in expired:
        del _cache[k]


def _eviction_loop() -> None:
    """Sweep periódico de evicción (daemon). Muere con el proceso."""
    while not _evict_stop.wait(_EVICT_PERIOD_SEC):
        with _lock:
            _evict_expired()


def _ensure_eviction_thread() -> None:
    """Arranca el thread de evicción una sola vez por proceso (idempotente)."""
    global _evict_thread
    if _evict_thread is not None and _evict_thread.is_alive():
        return
    _evict_thread = threading.Thread(
        target=_eviction_loop,
        name="audio_cache_evict",
        daemon=True,
    )
    _evict_thread.start()


def put(session_id: str, audio: np.ndarray, sr: int) -> None:
    """Almacena (o actualiza) el audio de una sesión."""
    _ensure_eviction_thread()
    with _lock:
        _evict_expired()
        # Si ya llegamos al límite, sacar el más antiguo (LRU simplificado)
        if len(_cache) >= MAX_ENTRIES and session_id not in _cache:
            oldest = min(_cache, key=lambda k: _cache[k]["last_access"])
            del _cache[oldest]
        _cache[session_id] = {
            "audio": audio,
            "sr": sr,
            "last_access": time.monotonic(),
        }


def get(session_id: str) -> Optional[Tuple[np.ndarray, int]]:
    """Devuelve (audio, sr) si el session_id existe y no expiró, o None."""
    _ensure_eviction_thread()
    with _lock:
        entry = _cache.get(session_id)
        if entry is None:
            return None
        now = time.monotonic()
        if now - entry["last_access"] > MAX_AGE_SEC:
            del _cache[session_id]
            return None
        entry["last_access"] = now  # Usar el mismo timestamp
        return entry["audio"], entry["sr"]


def evict(session_id: str) -> None:
    """Elimina manualmente una sesión (ej. cuando el cliente sube un archivo nuevo)."""
    with _lock:
        _cache.pop(session_id, None)


def stats() -> dict:
    """Para el dashboard: cuántas sesiones hay en caché y cuánta RAM usan aprox."""
    with _lock:
        n = len(_cache)
        mb = sum(
            v["audio"].nbytes for v in _cache.values()
            if isinstance(v.get("audio"), np.ndarray)
        ) / 1024 / 1024
    return {"cached_sessions": n, "estimated_mb": round(mb, 1)}
