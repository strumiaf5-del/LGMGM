"""Tests de K10: POST /pitch-correct + GET /pitch-correct/{job_id}.

Verifica el flujo async + polling + download que implementamos en K10 Opción B.
Usa un WAV sine de test generado con soundfile.
"""
import io
import time

import numpy as np
import soundfile as sf


def _make_sine_wav(freq: float = 440.0, duration: float = 1.0, sr: int = 22050) -> bytes:
    """Genera un WAV sine en memoria para enviar como upload."""
    t = np.linspace(0, duration, int(sr * duration), endpoint=False)
    audio = (0.3 * np.sin(2 * np.pi * freq * t)).astype(np.float32)
    buf = io.BytesIO()
    sf.write(buf, audio, sr, subtype="PCM_16", format="WAV")
    buf.seek(0)
    return buf.read()


def test_pitch_correct_post_returns_job_id(client, auth_headers):
    """POST /pitch-correct → 200 + job_id (NO vacío)."""
    wav = _make_sine_wav()
    resp = client.post(
        "/pitch-correct?mode=manual&corrections=2",
        headers=auth_headers,
        files={"file": ("test.wav", wav, "audio/wav")},
    )
    assert resp.status_code == 200, f"Expected 200, got {resp.status_code}: {resp.text}"
    data = resp.json()
    assert data["status"] == "processing"
    assert "job_id" in data
    assert len(data["job_id"]) > 10
    assert data["mode"] == "manual"


def test_pitch_correct_download_not_found(client, auth_headers):
    """GET /pitch-correct/{job_id_inexistente} → 404."""
    resp = client.get("/pitch-correct/nonexistent-job-id-12345", headers=auth_headers)
    # 404 si el job no existe, o 500 si el handler falla. Debe ser 4xx.
    assert resp.status_code in (404, 500), f"Expected 404/500, got {resp.status_code}"


def test_pitch_correct_full_flow(client, auth_headers):
    """Flujo completo: POST → poll GET → 200 + WAV válido con pitch cambiado.

    Este es el test end-to-end del bug de librosa 2D que fixeamos.
    Antes del fix, el audio 2D mono fallaba con ParameterError y el job
    marcaba done pero el WAV era idéntico al input. Ahora el pitch sí cambia.
    """
    # 1. POST con corrections=2 (200 cents = 2 semitonos)
    wav = _make_sine_wav(freq=440.0)
    resp = client.post(
        "/pitch-correct?mode=manual&corrections=2",
        headers=auth_headers,
        files={"file": ("test.wav", wav, "audio/wav")},
    )
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]

    # 2. Poll GET hasta que esté done (max 30 intentos x 1s = 30s)
    download_resp = None
    for _ in range(30):
        poll = client.get(f"/pitch-correct/{job_id}", headers=auth_headers)
        if poll.status_code == 200:
            download_resp = poll
            break
        if poll.status_code == 409:
            time.sleep(1)
            continue
        # 404, 500, u otro → fail
        assert False, f"Poll returned {poll.status_code}: {poll.text}"
    assert download_resp is not None, "Job never completed (timeout 30s)"

    # 3. Verificar que la respuesta es un WAV válido
    assert download_resp.headers["content-type"] == "audio/wav"
    wav_bytes = download_resp.content
    assert len(wav_bytes) > 100, "WAV response too small"
    assert wav_bytes[:4] == b"RIFF", "WAV header missing RIFF"

    # 4. Verificar que el pitch efectivamente cambió (440 → ~494 = 2 semitonos)
    shifted_audio, sr = sf.read(io.BytesIO(wav_bytes))
    # Estimar fundamental con FFT
    if shifted_audio.ndim > 1:
        shifted_audio = shifted_audio.mean(axis=1)
    Y = np.fft.rfft(shifted_audio)
    freqs = np.fft.rfftfreq(len(shifted_audio), 1 / sr)
    f_shifted = freqs[np.argmax(np.abs(Y))]
    # 2 semitonos = 200 cents → ratio 2^(200/1200) ≈ 1.122
    # 440 * 1.122 ≈ 494 Hz
    assert 480 < f_shifted < 510, (
        f"Pitch no cambió como esperado: original 440 Hz, shifted {f_shifted:.1f} Hz "
        f"(esperado ~494 Hz = +2 semitonos). Bug del librosa 2D sigue presente?"
    )
