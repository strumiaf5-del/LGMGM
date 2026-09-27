"""Tests de K8: POST /master/multi-reference.

Verifica que el endpoint responde con el contract esperado (job_id implícito
via status=processing). El job runner es async (background_tasks) y no
expone endpoint de descarga (deuda compartida con /master/reference original).
"""
import io

import numpy as np
import soundfile as sf


def _make_sine_wav(freq: float = 440.0, duration: float = 2.0, sr: int = 22050) -> bytes:
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, subtype="PCM_16", format="WAV")
    buf.seek(0)
    return buf.read()


def test_multi_reference_basic(client, auth_headers):
    """POST /master/multi-reference con 2 refs → 200 + processing + count + weights."""
    input_wav = _make_sine_wav(freq=220.0)
    ref1 = _make_sine_wav(freq=440.0)
    ref2 = _make_sine_wav(freq=330.0)
    resp = client.post(
        "/master/multi-reference",
        headers=auth_headers,
        files=[
            ("file", ("input.wav", input_wav, "audio/wav")),
            ("reference_files", ("ref1.wav", ref1, "audio/wav")),
            ("reference_files", ("ref2.wav", ref2, "audio/wav")),
        ],
        data={
            "reference_weights": "0.5,0.5",
            "reference_source": "upload",
            "output_format": "wav",
        },
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["status"] == "processing"
    assert data["mode"] == "multi-reference"
    assert data["reference_count"] == 2
    assert len(data["weights"]) == 2
    assert abs(sum(data["weights"]) - 1.0) < 0.01


def test_multi_reference_too_few_refs(client, auth_headers):
    """0 refs → 400 (debe fallar validación)."""
    input_wav = _make_sine_wav(freq=220.0)
    resp = client.post(
        "/master/multi-reference",
        headers=auth_headers,
        files=[("file", ("input.wav", input_wav, "audio/wav"))],
        data={
            "reference_weights": "1.0",
            "reference_source": "upload",
        },
    )
    # FastAPI responde 422 si falta un campo required, o 400 si la validación custom falla
    assert resp.status_code in (400, 422), f"Expected 400/422, got {resp.status_code}"


def test_multi_reference_too_many_refs(client, auth_headers):
    """6 refs → 400 (máximo es 5)."""
    input_wav = _make_sine_wav(freq=220.0)
    files = [("file", ("input.wav", input_wav, "audio/wav"))]
    for i in range(6):
        files.append(("reference_files", (f"ref{i}.wav", _make_sine_wav(freq=440.0), "audio/wav")))
    resp = client.post(
        "/master/multi-reference",
        headers=auth_headers,
        files=files,
        data={
            "reference_weights": "0.2,0.2,0.2,0.2,0.2",
            "reference_source": "upload",
        },
    )
    assert resp.status_code == 400


def test_multi_reference_invalid_weights(client, auth_headers):
    """weights malformados ("abc,0.5") → 400."""
    input_wav = _make_sine_wav(freq=220.0)
    ref1 = _make_sine_wav(freq=440.0)
    resp = client.post(
        "/master/multi-reference",
        headers=auth_headers,
        files=[
            ("file", ("input.wav", input_wav, "audio/wav")),
            ("reference_files", ("ref1.wav", ref1, "audio/wav")),
        ],
        data={
            "reference_weights": "abc,0.5",
            "reference_source": "upload",
        },
    )
    assert resp.status_code == 400
