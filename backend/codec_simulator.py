"""
codec_simulator.py — Lossy-codec simulator (B1.1 / Sprint 4).

B1.1 reemplaza el cuerpo del ``simulate_codec`` con el modelo ffmpeg-based de
alta fidelidad (pipe numpy → s16le → ffmpeg con el códec pedido → WAV → pipe →
soundfile.read). El wrapper de cache (``simulate_codec_cached``) sigue intacto:
los llamadores existentes no cambian.

Responsabilidades:
1. ``simulate_codec(audio, sr, codec, bitrate)`` — codifica el audio con ffmpeg
   y devuelve la versión decodificada, lista para comparar LUFS / espectro.
2. ``loudness_penalty(audio_orig, audio_post, sr)`` — mide la pérdida de loudness
   integrado entre el audio original y el post-codec usando el motor LUFS del
   backend (``mastering.measure_lufs_integrated``).
3. ``simulate_codec_cached(...)`` + helpers — memoización por contenido; se
   mantiene tal cual para no romper consumidores existentes.

Notas:
- Solo se soporta un conjunto acotado de códecs (opus / aac / mp3) y rangos
  razonables de bitrate (32..320 kbps). ffmpeg se valida con ``shutil.which``
  al primer uso y se degrada a "devolver original" si no está disponible, para
  no romper un master por un códec mal configurado.
"""

from __future__ import annotations

import hashlib
import logging
import shutil
import subprocess
import tempfile
import os
from typing import Any, Dict, Optional

import numpy as np


# Directorio confinado para tempfiles de codec_simulator. Antes usaba
# /tmp por default (riesgo cross-user en hosts multi-tenant y
# violación del confinement rule del workspace).
_CODEC_TMP_DIR = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "tmp"
)
os.makedirs(_CODEC_TMP_DIR, exist_ok=True)
import soundfile as sf

logger = logging.getLogger("codec_simulator")


# ── Cache de resultados por contenido (helpers existentes, no modificados) ──
_CODEC_CACHE: Dict[str, np.ndarray] = {}


def _cache_key(audio: np.ndarray, sr: int, codec: str, bitrate: int) -> str:
    """sha256 truncado del buffer + (sr, codec, bitrate). Idéntico contenido
    reusa el resultado cacheado."""
    arr_bytes = np.ascontiguousarray(audio).tobytes()
    h = hashlib.sha256(arr_bytes).hexdigest()[:16]
    return f"{h}_{int(sr)}_{(codec or '').lower()}_{int(bitrate)}"


def simulate_codec_cached(audio: np.ndarray, sr: int,
                          codec: str = "opus", bitrate: int = 96) -> np.ndarray:
    """Memoised wrapper sobre :func:`simulate_codec`. Inputs idénticos
    (contenido + sr + codec + bitrate) hacen short-circuit a una copia del
    cache. El caller nunca puede mutar la entrada cacheada por accidente."""
    key = _cache_key(audio, sr, codec, bitrate)
    cached = _CODEC_CACHE.get(key)
    if cached is None:
        cached = simulate_codec(audio, sr, codec, bitrate)
        _CODEC_CACHE[key] = cached
    return cached.copy()


def clear_codec_cache() -> None:
    """Borra todos los resultados cacheados."""
    _CODEC_CACHE.clear()


def codec_cache_size() -> int:
    """Cantidad de entradas cacheadas (tests / métricas)."""
    return len(_CODEC_CACHE)


# ── B1.1: simulate_codec con ffmpeg real ───────────────────────────────────
# Mapa de códec lógico (aceptado por la API) → nombre de encoder ffmpeg.
# Solo lossy/perceptual: opus, aac, mp3. WAV/FLAC serían identidad.
_CODEC_TO_ENCODER: Dict[str, str] = {
    "opus": "libopus",
    "libopus": "libopus",
    "aac": "aac",
    "mp3": "libmp3lame",
    "libmp3lame": "libmp3lame",
}

# Contenedor para cada códec. Importante: opus y AAC NO son codecs válidos
# para WAV (rc=218 de ffmpeg si se les pide WAV). Hay que usar el contenedor
# nativo. mp3 SÍ puede ir en WAV técnicamente, pero usamos mp3 nativo para
# mantener consistencia con el resto.
#
# "needs_seekable" → True si el contenedor requiere un archivo con seek
# (mp4/m4a necesitan el moov box al final o con faststart; no se puede pipe).
_CODEC_TO_OUTPUT_FORMAT: Dict[str, tuple] = {
    "libopus": ("ogg", False),
    "aac": ("mp4", True),   # MP4/M4A: necesita tempfile (seekable)
    "libmp3lame": ("mp3", False),
}

# Extensión por formato (para tempfile).
_FMT_TO_EXT = {
    "ogg": ".ogg",
    "mp4": ".m4a",
    "mp3": ".mp3",
}

# Rango de bitrates (kbps) por códec. Acotamos conservadoramente a un rango
# audible/útil; ffmpeg acepta más pero los extremos no son representativos.
_CODEC_BITRATE_RANGE: Dict[str, tuple] = {
    "libopus": (32, 320),
    "aac": (32, 320),
    "libmp3lame": (32, 320),
}


def _resolve_encoder(codec: str) -> Optional[str]:
    return _CODEC_TO_ENCODER.get(str(codec).lower().strip())


def _resolve_output_format(codec_encoder: str) -> tuple:
    return _CODEC_TO_OUTPUT_FORMAT.get(codec_encoder, ("wav", False))


def _resolve_bitrate(codec_encoder: str, bitrate: int) -> int:
    lo, hi = _CODEC_BITRATE_RANGE.get(codec_encoder, (32, 320))
    return int(np.clip(int(bitrate), lo, hi))


def _to_pcm16_bytes(audio: np.ndarray) -> bytes:
    """Float [-1, 1] → bytes PCM16 little-endian para stdin de ffmpeg.
    Acepta [channels, samples] (estéreo) o [samples] (mono). Para estéreo
    hay que interleavar L/R; ``np.ascontiguousarray`` lo hace."""
    pcm = np.clip(np.asarray(audio, dtype=np.float32), -1.0, 1.0)
    pcm = (pcm * 32767.0).astype(np.int16)
    if pcm.ndim not in (1, 2):
        pcm = pcm.reshape(-1)
    return np.ascontiguousarray(pcm).tobytes()


def is_ffmpeg_available() -> bool:
    """True si ``ffmpeg`` está en PATH."""
    return shutil.which("ffmpeg") is not None


def simulate_codec(audio: np.ndarray, sr: int,
                   codec: str = "opus", bitrate: int = 96) -> np.ndarray:
    """Codifica ``audio`` con el códec pedido a ``bitrate`` kbps y devuelve
    la versión decodificada (PCM). Permite estimar lo que oirá el usuario
    final cuando el servicio de streaming recodifique el master.

    Args:
        audio: numpy array ``[channels, samples]`` (estéreo) o ``[samples]``
            (mono), rango [-1, 1] float. Otros rangos se clipean.
        sr: sample rate en Hz (cualquiera que ffmpeg acepte).
        codec: nombre del códec lógico. Soportados: ``"opus"``, ``"aac"``,
            ``"mp3"``. Aliases ``libopus``/``libmp3lame`` también.
        bitrate: kbps objetivo, se acota al rango válido del códec.

    Returns:
        numpy array con la misma cantidad de canales que la entrada,
        dtype ``float32``, rango [-1, 1]. Si ffmpeg no está disponible o
        el códec no es soportado, retorna una copia del audio ORIGINAL
        (penalty = 0) — la API no rompe un master por un códec mal
        configurado, simplemente no simula.

    Raises:
        RuntimeError: solo si ffmpeg está disponible, el códec es soportado,
            y aún así falla la recodificación (timeout / exit code != 0).
            El router mapea esto a HTTP 500.
    """
    if audio is None:
        raise RuntimeError("simulate_codec: audio is None")
    if audio.size == 0:
        return np.asarray(audio, dtype=np.float32).copy()

    codec_encoder = _resolve_encoder(codec)
    if codec_encoder is None:
        logger.warning("simulate_codec: códec '%s' no soportado, devolviendo original.", codec)
        return np.asarray(audio, dtype=np.float32).copy()

    if not is_ffmpeg_available():
        logger.warning("simulate_codec: ffmpeg no está en PATH, devolviendo original.")
        return np.asarray(audio, dtype=np.float32).copy()

    bitrate_kbps = _resolve_bitrate(codec_encoder, bitrate)
    n_channels = 2 if np.asarray(audio).ndim == 2 else 1
    pcm_bytes = _to_pcm16_bytes(audio)

    output_format, needs_seekable = _resolve_output_format(codec_encoder)
    ext = _FMT_TO_EXT.get(output_format, f".{output_format}")

    # Codificar a stdin → contenedor nativo. Si el contenedor es seekable
    # (mp4/m4a necesita moov box), usamos tempfile en vez de pipe:1.
    enc_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", "s16le",
        "-ar", str(int(sr)),
        "-ac", str(int(n_channels)),
        "-i", "pipe:0",
        "-c:a", codec_encoder,
        "-b:a", f"{bitrate_kbps}k",
    ]
    if output_format == "mp4":
        enc_cmd.extend(["-movflags", "+faststart"])

    try:
        if needs_seekable:
            fd, tmp_enc_path = tempfile.mkstemp(suffix=ext, dir=_CODEC_TMP_DIR)
            os.close(fd)
            tmp_enc = type("T", (), {"name": tmp_enc_path})()
            enc_cmd.extend(["-f", output_format, tmp_enc_path])
            enc_proc = subprocess.run(
                enc_cmd, input=pcm_bytes, capture_output=True,
                timeout=120, check=False,
            )
            if enc_proc.returncode != 0:
                err = enc_proc.stderr.decode(errors="replace").strip()
                try:
                    import os as _os
                    _os.unlink(tmp_enc_path)
                except OSError:
                    pass
                raise RuntimeError(f"ffmpeg (encode) falló (rc={enc_proc.returncode}): {err[:400]}")
            with open(tmp_enc_path, "rb") as fh:
                encoded_bytes = fh.read()
            try:
                import os as _os
                _os.unlink(tmp_enc_path)
            except OSError:
                pass
        else:
            enc_cmd.extend(["-f", output_format, "pipe:1"])
            enc_proc = subprocess.run(
                enc_cmd, input=pcm_bytes, capture_output=True,
                timeout=120, check=False,
            )
            if enc_proc.returncode != 0:
                err = enc_proc.stderr.decode(errors="replace").strip()
                raise RuntimeError(f"ffmpeg (encode) falló (rc={enc_proc.returncode}): {err[:400]}")
            encoded_bytes = enc_proc.stdout
    except FileNotFoundError as exc:
        raise RuntimeError(f"ffmpeg no encontrado en PATH: {exc}") from exc
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg timeout (>120s) codificando el audio") from exc

    if not encoded_bytes:
        raise RuntimeError("ffmpeg encode devolvió bytes vacíos.")

    # Decodificar el contenedor → WAV PCM → soundfile.
    dec_cmd = [
        "ffmpeg",
        "-hide_banner",
        "-loglevel", "error",
        "-y",
        "-f", output_format,
        "-i", "pipe:0",
        "-c:a", "pcm_s16le",
        "-f", "wav",
        "pipe:1",
    ]
    try:
        dec_proc = subprocess.run(
            dec_cmd,
            input=encoded_bytes,
            capture_output=True,
            timeout=120,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("ffmpeg timeout (>120s) decodificando el audio") from exc

    if dec_proc.returncode != 0:
        err = dec_proc.stderr.decode(errors="replace").strip()
        raise RuntimeError(f"ffmpeg (decode) falló (rc={dec_proc.returncode}): {err[:400]}")

    wav_bytes = dec_proc.stdout
    if not wav_bytes:
        raise RuntimeError("ffmpeg decode devolvió stdout vacío (WAV).")

    # soundfile necesita un file-like con seek → tempfile confinado al workspace.
    fd, tmp_path = tempfile.mkstemp(suffix=".wav", dir=_CODEC_TMP_DIR)
    os.close(fd)
    with open(tmp_path, "wb") as tmp:
        tmp.write(wav_bytes)
        tmp.flush()
    try:
        try:
            decoded, decoded_sr = sf.read(tmp_path, dtype="float32", always_2d=False)
        except Exception as exc:
            raise RuntimeError(f"No se pudo decodificar el WAV de ffmpeg: {exc}") from exc
    finally:
        try: os.remove(tmp_path)
        except OSError: pass

    if decoded_sr != int(sr):
        # ffmpeg garantiza preservar sr para s16le → cualquier códec; por
        # defensa, lo reportamos (no resampleamos — eso metería OTRO efecto
        # que no queremos en la simulación).
        logger.warning(
            "simulate_codec: sr cambió tras el round-trip (%d → %d).", int(sr), int(decoded_sr)
        )

    # Garantizar shape consistente con la entrada.
    src_ndim = np.asarray(audio).ndim
    if src_ndim == 1 and decoded.ndim == 2:
        decoded = decoded.mean(axis=1).astype(np.float32, copy=False)
    if src_ndim == 2 and decoded.ndim == 1:
        decoded = np.stack([decoded, decoded], axis=-1).astype(np.float32, copy=False)

    return decoded.astype(np.float32, copy=False)


# ── B1.1: loudness_penalty (helper para /dsp/loudness-penalty) ──────────────
def loudness_penalty(
    audio_orig: np.ndarray,
    audio_post: np.ndarray,
    sr: int,
) -> Dict[str, float]:
    """Calcula el "loudness penalty" entre un audio y su versión post-codec.

    Usa ``mastering.measure_lufs_integrated`` (mismo motor LUFS que el resto
    del backend) para mantener consistencia con ``/mastering/...``.

    Args:
        audio_orig: audio pre-codec.
        audio_post: audio post-codec (mismo sr / num canales).
        sr: sample rate en Hz.

    Returns:
        Dict con ``orig_lufs``, ``post_lufs`` y ``penalty_db = orig - post``.
        Si LUFS falla, devuelve 0.0 (la API no rompe un endpoint por un
        silencio / clipping / overflow del medidor).
    """
    try:
        from mastering import measure_lufs_integrated
    except ImportError:
        from .mastering import measure_lufs_integrated  # type: ignore

    def _safe_lufs(buf: np.ndarray) -> float:
        try:
            val = float(measure_lufs_integrated(np.asarray(buf), int(sr)))
        except Exception as exc:
            logger.warning("measure_lufs_integrated falló: %s", exc)
            return 0.0
        if not np.isfinite(val):
            return 0.0
        # -70 LUFS es el piso de silencio del estándar BS.1770; valores más
        # bajos son ruido de fondo del gate y los tratamos como 0 penalty.
        if val < -70.0:
            return 0.0
        return round(val, 2)

    orig_lufs = _safe_lufs(audio_orig)
    post_lufs = _safe_lufs(audio_post)
    penalty_db = round(orig_lufs - post_lufs, 2)
    return {
        "orig_lufs": orig_lufs,
        "post_lufs": post_lufs,
        "penalty_db": penalty_db,
    }


__all__ = [
    "simulate_codec",
    "simulate_codec_cached",
    "clear_codec_cache",
    "codec_cache_size",
    "loudness_penalty",
    "is_ffmpeg_available",
]
