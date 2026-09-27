"""Smoke test: /health responde y el backend arranca sin ImportError."""
def test_health(client):
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "Audio Mastering API"
    # Verificar que las deps críticas están reportadas
    deps = data.get("dependencies", {})
    assert "numpy" in deps
    assert "librosa" in deps
    assert "soundfile" in deps
