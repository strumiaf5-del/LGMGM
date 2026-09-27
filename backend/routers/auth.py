from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

try:
    from ..auth import (
        get_admin_user,
        get_current_user,
        clear_auth_cookie,
        handle_approve_user,
        handle_change_password,
        handle_delete_user,
        handle_list_users,
        handle_login,
        handle_me,
        handle_ws_ticket,
        handle_register,
        handle_reject_user,
        set_auth_cookie,
    )
except ImportError:
    from auth import (
        get_admin_user,
        get_current_user,
        clear_auth_cookie,
        handle_approve_user,
        handle_change_password,
        handle_delete_user,
        handle_list_users,
        handle_login,
        handle_me,
        handle_ws_ticket,
        handle_register,
        handle_reject_user,
        set_auth_cookie,
    )


class RegisterRequest(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginRequest(BaseModel):
    email: str
    password: str


def _request_is_https(request: Request) -> bool:
    """True si el usuario llegó por HTTPS.

    Detrás de Caddy el backend ve HTTP plano (TLS termina en el proxy):
    request.url.scheme es 'http' aunque el usuario esté en https://.
    Caddy setea X-Forwarded-Proto automáticamente en reverse_proxy.
    Sin este check la cookie salía Secure=false → SameSite=Lax → el
    browser no la mandaba en el fetch cross-site (duckdns.org PSL) →
    login 200 pero /auth/me 401 y redirect loop a login."""
    proto = request.headers.get("x-forwarded-proto", request.url.scheme)
    return proto.lower() == "https"


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


def create_auth_router(*, logger, limiter) -> APIRouter:
    router = APIRouter()

    # ── /auth/register ──────────────────────────────────────────────────
    # B-S2 rate limit: 3 por hora, máx. 10 por día por IP — bloquea abuso de
    # registro (bot spamming cuentas en pending para saturar la cola de
    # aprobación del admin). Frena el vector antes de tocar handle_register.
    @router.post("/auth/register", tags=["Auth"])
    @limiter.limit("3/hour;10/day")
    def register(request: Request, req: RegisterRequest):
        logger.info(f"📝 Registro: {req.email}")
        try:
            result = handle_register(req.email, req.password, req.name)
            logger.info(f"✓ Registro exitoso: {req.email}")
            return result
        except HTTPException as exc:
            logger.warning(f"⚠️  Registro rechazado: {req.email} - {exc.detail}")
            raise

    # ── /auth/login ─────────────────────────────────────────────────────
    # B-S2 rate limit: 5 por minuto por IP — bloquea fuerza bruta de
    # credenciales. Sin esto, un atacante podía probar miles de passwords por
    # minuto contra handle_login (PBKDF2 es lento pero la IP sin throttle es
    # gratis). Frena el vector antes de verificar el JWT.
    # SEC-A-01: además del access_token en el body, setea cookie HttpOnly.
    # SameSite: Lax — producción sirve la API bajo /api en el mismo origin
    # que el frontend (proxy de Caddy), así que la cookie es first-party.
    # Secure=False en HTTP (localhost dev), True en producción (vía
    # X-Forwarded-Proto, ver _request_is_https).
    @router.post("/auth/login", tags=["Auth"])
    @limiter.limit("5/minute")
    def login(request: Request, response: Response, req: LoginRequest):
        try:
            result = handle_login(req.email, req.password)
            token = result.get("access_token")
            if token:
                set_auth_cookie(response, token, secure=_request_is_https(request))
            logger.info(f"🔓 Login exitoso: {req.email}")
            return result
        except HTTPException as exc:
            logger.warning(f"❌ Login fallido: {req.email} - {exc.detail}")
            raise

    # ── /auth/logout ────────────────────────────────────────────────────
    # SEC-A-01: limpia la cookie HttpOnly. Frontend también borra
    # sessionStorage en su lado, pero la cookie es server-controlled.
    @router.post("/auth/logout", tags=["Auth"])
    def logout(request: Request, response: Response):
        clear_auth_cookie(response, secure=_request_is_https(request))
        logger.info("🚪 Sesión cerrada (cookie limpiada)")
        return {"logged_out": True}

    @router.get("/auth/ws-ticket", tags=["Auth"])
    def ws_ticket(current_user: dict = Depends(get_current_user)):
        return handle_ws_ticket(current_user)

    @router.get("/auth/me", tags=["Auth"])
    def me(current_user: dict = Depends(get_current_user)):
        return handle_me(current_user)

    @router.post("/auth/change-password", tags=["Auth"])
    def change_password(req: ChangePasswordRequest, current_user: dict = Depends(get_current_user)):
        logger.info(f"🔐 Cambio de contraseña: {current_user['email']}")
        try:
            result = handle_change_password(req.current_password, req.new_password, current_user)
            logger.info(f"✓ Contraseña cambiada: {current_user['email']}")
            return result
        except HTTPException:
            logger.warning(f"⚠️  Cambio de contraseña fallido: {current_user['email']}")
            raise

    @router.get("/auth/admin/users", tags=["Auth"])
    def list_users(admin: dict = Depends(get_admin_user)):
        logger.info(f"📋 Admin {admin['email']} listó usuarios")
        return handle_list_users(admin)

    @router.post("/auth/admin/approve/{user_id}", tags=["Auth"])
    def approve_user(user_id: str, admin: dict = Depends(get_admin_user)):
        logger.info(f"✅ Admin {admin['email']} aprobó usuario {user_id}")
        try:
            result = handle_approve_user(user_id, admin)
            logger.info(f"✓ Usuario {user_id} aprobado")
            return result
        except Exception as exc:
            logger.error(f"❌ Error aprobando usuario {user_id}: {exc}")
            raise

    @router.post("/auth/admin/reject/{user_id}", tags=["Auth"])
    def reject_user(user_id: str, admin: dict = Depends(get_admin_user)):
        logger.info(f"🚫 Admin {admin['email']} rechazó usuario {user_id}")
        try:
            result = handle_reject_user(user_id, admin)
            logger.info(f"✓ Usuario {user_id} rechazado")
            return result
        except Exception as exc:
            logger.error(f"❌ Error rechazando usuario {user_id}: {exc}")
            raise

    @router.delete("/auth/admin/users/{user_id}", tags=["Auth"])
    def delete_user(user_id: str, admin: dict = Depends(get_admin_user)):
        logger.warning(f"🗑️  Admin {admin['email']} eliminó usuario {user_id}")
        try:
            result = handle_delete_user(user_id, admin)
            logger.info(f"✓ Usuario {user_id} eliminado")
            return result
        except Exception as exc:
            logger.error(f"❌ Error eliminando usuario {user_id}: {exc}")
            raise

    return router
