from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect


def create_dashboard_router(*, jobs, get_system_stats, logger, get_current_user, verify_ws_token, extract_ws_token, ws_subprotocol) -> APIRouter:
    router = APIRouter()

    # BUGFIX (seguridad): este endpoint devuelve stats internas del server
    # (jobs, memoria, cola) y antes no pedía login. Depends(get_current_user)
    # alcanza acá porque el GET normal sí puede mandar el header Authorization.
    @router.get("/dashboard", tags=["Dashboard"])
    def dashboard(current_user: dict = Depends(get_current_user)):
        return get_system_stats(jobs.get_all())

    @router.websocket("/ws/dashboard")
    async def ws_dashboard(websocket: WebSocket):
        # Auth via Sec-WebSocket-Protocol subprotocol ("lgmdm-ws-ticket.<token>")
        # — el browser no puede mandar Authorization en el handshake de WS,
        # pero sí puede negociar subprotocols. extract_ws_token() también
        # acepta ?token= como fallback de compatibilidad. El server hace eco
        # del subprotocol "lgmdm-ws-ticket" para completar la negociación.
        # verify_ws_token la inyecta app.py (misma lógica que usa auth.py)
        # para no importar auth.py directo desde routers/ (ver patrón del
        # resto de los routers, que reciben todo por parámetro).
        token = extract_ws_token(websocket)
        if not verify_ws_token(token):
            await websocket.close(code=4001)
            return

        await websocket.accept(subprotocol=ws_subprotocol)
        try:
            while True:
                await websocket.send_json(get_system_stats(jobs.get_all()))
                await asyncio.sleep(1.0)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            logger.warning(f"ws_dashboard error: {exc}")

    return router
