"""
Configuración de performance para 8 CPUs / 32GB RAM.
Importar en app.py si se quiere override de los defaults.
"""
import os


def _env_int(name: str, default: int) -> int:
    """Lee una variable de entorno como int, cayendo al default si no es parseable."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return int(raw)
    except (TypeError, ValueError):
        return default


def _env_float(name: str, default: float) -> float:
    """Lee una variable de entorno como float, cayendo al default si no es parseable."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        return float(raw)
    except (TypeError, ValueError):
        return default


# Workers del process pool para apply_mastering_chain
# 6 = 8 CPUs - 2 (reservar para event loops del servidor)
CHAIN_POOL_WORKERS = _env_int("CHAIN_POOL_WORKERS", 6)

# Cache de audio en RAM — con 32GB podemos cachear muchos tracks
# 512MB de caché = ~50 tracks de 3min a 44100 stereo float32
AUDIO_CACHE_MAX_MB = _env_int("AUDIO_CACHE_MAX_MB", 512)

# Chunks del preview WS — 1s = respuesta más rápida
WS_PREVIEW_CHUNK_SEC = _env_float("WS_PREVIEW_CHUNK_SEC", 1.0)

# Prefetch de chunks paralelos
WS_PREFETCH_CHUNKS = _env_int("WS_PREFETCH_CHUNKS", 3)
