"""Fixtures compartidas para tests del backend LGMDM.

Uso:
    cd /root/nuevito/backend
    /root/nuevito/backend/.venv/bin/pytest tests/ -v

Los tests corren contra el backend importándolo directo (no levantan un
server separado). FastAPI TestClient maneja el HTTP via httpx in-process.
"""
import os
import sys
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Asegurar que el backend está en el path
BACKEND_DIR = Path(__file__).parent.parent
sys.path.insert(0, str(BACKEND_DIR))


@pytest.fixture(scope="session")
def temp_users_db(tmp_path_factory):
    """Crea un users_db.json temporal aislado para los tests."""
    db_path = tmp_path_factory.mktemp("users") / "users_db.json"
    # Setear antes de importar app (auth.py lee USERS_DB_PATH al importar)
    os.environ["USERS_DB_PATH"] = str(db_path)
    yield db_path
    if db_path.exists():
        db_path.unlink()


@pytest.fixture(scope="session")
def client(temp_users_db):
    """TestClient de FastAPI. Importa app DESPUÉS de setear USERS_DB_PATH."""
    # Setear ADMIN_EMAIL/PASSWORD para que bootstrap_admin cree un admin predecible
    os.environ["ADMIN_EMAIL"] = "test-admin@lgmdm.test"
    os.environ["ADMIN_PASSWORD"] = "TestAdmin1234"
    # Desactivar rate limiter en tests (slowapi limita 5 logins/min y los tests
    # hacen >8 logins → fallan con "5 per 1 minute"). Seteamos TESTING=1 que
    # el app respeta para desactivar el limiter.
    os.environ["TESTING"] = "1"
    # Re-importar app con el env ya seteado
    import importlib

    import app as app_module
    importlib.reload(app_module)
    with TestClient(app_module.app) as c:
        yield c


@pytest.fixture
def auth_token(client):
    """Login con el admin de test → retorna el access_token.
    Limpia cookies antes del test para que no herede sesión de tests anteriores."""
    client.cookies.clear()
    resp = client.post(
        "/auth/login",
        json={"email": "test-admin@lgmdm.test", "password": "TestAdmin1234"},
    )
    assert resp.status_code == 200, f"Login failed: {resp.text}"
    return resp.json()["access_token"]


@pytest.fixture
def auth_headers(auth_token):
    """Headers con Authorization Bearer para endpoints protegidos."""
    return {"Authorization": f"Bearer {auth_token}"}


@pytest.fixture
def clean_client(client):
    """Client con cookies limpias (para tests que verifican 401 sin token)."""
    client.cookies.clear()
    return client
