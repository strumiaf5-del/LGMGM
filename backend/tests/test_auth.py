"""Tests del flujo de auth: login, /auth/me, logout."""
def test_login_success(client):
    """Login con admin de test → 200 + access_token."""
    resp = client.post(
        "/auth/login",
        json={"email": "test-admin@lgmdm.test", "password": "TestAdmin1234"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "access_token" in data
    assert len(data["access_token"]) > 50
    assert data.get("token_type") in ("bearer", "Bearer")


def test_login_wrong_password(client):
    """Login con password incorrecta → 401."""
    resp = client.post(
        "/auth/login",
        json={"email": "test-admin@lgmdm.test", "password": "wrong-password"},
    )
    assert resp.status_code == 401


def test_login_unknown_email(client):
    """Login con email inexistente → 401."""
    resp = client.post(
        "/auth/login",
        json={"email": "nobody@nowhere.test", "password": "TestAdmin1234"},
    )
    assert resp.status_code == 401


def test_auth_me(client, auth_headers):
    """GET /auth/me con token válido → 200 + datos del user."""
    resp = client.get("/auth/me", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["email"] == "test-admin@lgmdm.test"
    assert data["role"] == "admin"
    assert data["status"] == "approved"


def test_auth_me_no_token(clean_client):
    """GET /auth/me sin token → 401."""
    resp = clean_client.get("/auth/me")
    assert resp.status_code == 401


def test_auth_me_invalid_token(clean_client):
    """GET /auth/me con token inválido → 401."""
    resp = clean_client.get("/auth/me", headers={"Authorization": "Bearer fake-token-12345"})
    assert resp.status_code == 401
