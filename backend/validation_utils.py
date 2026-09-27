import os
from typing import Optional
import numpy as np

from fastapi import HTTPException

# Importar MAX_FILE_SIZE desde config.py (fuente única de verdad)
try:
    from .config import MAX_FILE_SIZE
except ImportError:
    from config import MAX_FILE_SIZE

ALLOWED_EXTENSIONS = {".wav", ".mp3", ".flac", ".ogg", ".aiff", ".aif"}

_BOOL_QUERY_KEYS = {
    "use_lufs_normalize", "comp_stereo_link", "comp_bypass", "stereo_bypass", "limiter_bypass", "mb_bypass", "mb_stereo_bypass",
    "use_stereo_enhancer", "glue_bypass",
    # BUGFIX: faltaban estas — sin estar en el set, coerce_ws_chain_params()
    # dejaba pasar el string literal "false" (truthy en Python) en vez de
    # convertirlo a bool, así que dynamic_eq_band() siempre veía bypass=True
    # sin importar el checkbox. Esto rompía los meters de GR de de-esser y
    # resonancias dinámicas (y potencialmente lp/ms_eq/clipper/nr) solo en
    # el preview en vivo por WebSocket — el render final vía /master no se
    # veía afectado porque ahí FastAPI parsea los Query(bool) correctamente.
    "dyneq_bypass", "reso_bypass", "lp_bypass", "ms_eq_bypass", "ms_comp_bypass",
    "clipper_bypass", "nr_bypass",
    "parallel_bypass",   # BUGFIX: faltaba — sin esto, el string "false" llegaba truthy por WS
    # Toggles de PDR (Program-Dependent Release) agregados en el compresor
    # de banda ancha/paralela, glue, multibanda y M/S — mismo bug potencial
    # que los bypass de arriba si no se declaran acá.
    "comp_pdr", "glue_pdr", "mb_pdr", "ms_comp_pdr",
}


def validate_audio_file(filename: str) -> None:
    if not filename or not isinstance(filename, str):
        raise HTTPException(400, "Nombre de archivo inválido o faltante.")
    # El nombre se usa posteriormente para construir rutas temporales.
    # Rechazar separadores evita path traversal en archivos multipart maliciosos.
    if "/" in filename or "\\" in filename:
        raise HTTPException(400, "Nombre de archivo inválido.")
    if filename in {".", ".."} or "\x00" in filename:
        raise HTTPException(400, "Nombre de archivo inválido.")
    ext = os.path.splitext(filename)[-1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Formato '{ext}' no soportado. Válidos: {sorted(ALLOWED_EXTENSIONS)}")


# Magic bytes de los formatos permitidos. Un .wav malformado o .exe renombrado
# a .wav pasaba la validación de extensión pero corrompía el DSP. Ahora se
# verifica el header al abrir el archivo (en _validate_audio_magic_bytes).
_AUDIO_MAGIC = {
    b"RIFF": "wav",      # RIFF + WAVE (verificar en bytes 8-12 también)
    b"fLaC": "flac",
    b"\xff\xd8\xff": "jpg",  # accidental — JPEG pasa por error
    b"OggS": "ogg",
    b"ID3": "mp3",       # tag ID3 al inicio
    b"\xff\xfb": "mp3",  # frame header MPEG sin ID3
    b"FORM": "aiff",
}


def _validate_audio_magic_bytes(file_path: str, filename: str) -> None:
    """Verifica que el header del archivo coincida con la extensión declarada.

    Antes: validate_audio_file sólo checaba el nombre → un .exe renombrado a
    .wav entraba al DSP y producía NaN/Inf. Ahora: tras la lectura inicial,
    se inspeccionan los primeros 4 bytes; si no matchean ningún formato
    conocido, se rechaza con 400.
    """
    try:
        with open(file_path, "rb") as f:
            head = f.read(12)
    except OSError:
        return  # el DSP fallará luego; no bloquear aquí

    ext = os.path.splitext(filename or "")[-1].lower()
    # WAV requiere RIFF ... WAVE en los primeros 12 bytes
    if ext in {".wav"}:
        if not (head[:4] == b"RIFF" and head[8:12] == b"WAVE"):
            raise HTTPException(400, "El archivo no es un WAV válido (header RIFF/WAVE ausente).")
    # AIFF requiere FORM ... AIFF
    elif ext in {".aif", ".aiff"}:
        if not (head[:4] == b"FORM" and head[8:12] in {b"AIFF", b"AIFC"}):
            raise HTTPException(400, "El archivo no es un AIFF válido (header FORM/AIFF ausente).")
    # FLAC
    elif ext == ".flac":
        if head[:4] != b"fLaC":
            raise HTTPException(400, "El archivo no es un FLAC válido (header fLaC ausente).")
    # OGG
    elif ext == ".ogg":
        if head[:4] != b"OggS":
            raise HTTPException(400, "El archivo no es un OGG válido (header OggS ausente).")
    # MP3 — puede tener ID3 o frame MPEG directo
    elif ext == ".mp3":
        if not (head[:3] == b"ID3" or (head[0] == 0xFF and (head[1] & 0xE0) == 0xE0)):
            raise HTTPException(400, "El archivo no es un MP3 válido (header ID3 o MPEG frame ausente).")


def coerce_ws_chain_params(params: dict) -> dict:
    """Convierte params recibidos por WebSocket desde URLSearchParams/JSON."""
    out = {}
    for key, value in params.items():
        if key in _BOOL_QUERY_KEYS:
            if isinstance(value, str):
                out[key] = value.strip().lower() in {"1", "true", "yes", "on", "sí", "si"}
            else:
                out[key] = bool(value)
            continue
        if isinstance(value, str):
            value = value.strip()
            if value == "":
                continue
            try:
                fval = float(value)
                # BUGFIX: rechazar NaN e Inf que podrían romper el procesamiento
                if not np.isfinite(fval):
                    raise ValueError(f"Valor inválido para {key}: {value} (NaN o Inf)")
                out[key] = fval
                continue
            except ValueError:
                pass
        out[key] = value
    return out


def read_and_validate_upload(file, max_file_size: int = MAX_FILE_SIZE) -> bytes:
    data = file.read()
    if len(data) > max_file_size:
        raise HTTPException(413, f"Archivo demasiado grande. Máximo: {max_file_size // 1024 // 1024} MB")
    return data
