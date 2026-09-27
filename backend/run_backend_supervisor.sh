#!/usr/bin/env bash
# Backend supervisor para /root/diego/backend (LGMDM)
# D-1: hardening — backoff exponencial, timestamps, SIGTERM/SIGINT graceful
# shutdown y NO matar procesos ajenos en el puerto 8000 (solo uvicorn propio).
cd "$(dirname "$0")"

SUPERVISOR_LOG="supervisor.log"
BACKEND_LOG="backend.log"
PORT=8000
HOST=127.0.0.1
BASE_DELAY=2
MAX_DELAY=60
FAILS=0
FAILED_AT=""

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$SUPERVISOR_LOG"; }

# D-1: handler de señal → terminar el bucle de forma ordenada
shutdown_handler() {
    log "Señal recibida (SIGTERM/SIGINT) — cerrando supervisor"
    log "Fin del supervisor (duración total: desde ${FAILED_AT:-inicio})"
    exit 0
}
trap shutdown_handler SIGTERM SIGINT

log "Supervisor LGMDM iniciado (puerto $HOST:$PORT)"

while true; do
    if curl -s -f "http://$HOST:$PORT/health" >/dev/null 2>&1; then
        # D-1: backend sano → resetear contador de fallos y seguir
        if [ "$FAILS" -gt 0 ]; then
            log "Backend recuperado tras $FAILS reinicio(s) — reset de contador de fallos"
        fi
        FAILS=0
        FAILED_AT=""
        sleep 4
        continue
    fi

    # D-1: backoff exponencial si uvicorn murió repetidamente (evita loop infinito)
    if [ "$FAILS" -gt 0 ]; then
        DELAY=$(( BASE_DELAY * 2 ** (FAILS - 1) ))
        if [ "$DELAY" -gt "$MAX_DELAY" ]; then DELAY=$MAX_DELAY; fi
        FAILED_AT="$(date '+%Y-%m-%d %H:%M:%S')"
        log "Backend caído ($((FAILS + 1))ª detección) — backoff ${DELAY}s antes de reintentar"
        sleep "$DELAY"
        continue
    fi
    FAILED_AT="$(date '+%Y-%m-%d %H:%M:%S')"

    log "Backend down o no responde — inicio de ciclo: arrancando uvicorn en $HOST:$PORT"
    # D-1: SOLO se mata el proceso uvicorn propio si sigue vivo; jamás fuser a procesos ajenos
    if [ -f "$BACKEND_LOG" ] && pgrep -f ".venv/bin/python3 -m uvicorn app:app" >/dev/null 2>&1; then
        pkill -TERM -f ".venv/bin/python3 -m uvicorn app:app" >/dev/null 2>&1 || true
        log "Ciclo: uvicorn propio seguía vivo — se le envió SIGTERM para reciclar"
    fi
    sleep 1
    # Pipe a sed para redactar tokens JWT (eyJ...) del access log — antes
    # quedaban expuestos en backend.log en cada request WebSocket con
    # ?token=eyJ...&token=eyJ...
    .venv/bin/python3 -m uvicorn app:app --host "$HOST" --port "$PORT" \
        2>&1 | sed -E 's/(eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/<REDACTED_JWT>/g' \
        >> "$BACKEND_LOG" &
    FAILS=$((FAILS + 1))
    sleep 3
    log "Ciclo: uvicorn lanzado (PID $!) — fin de ciclo (reinicios acumulados: $FAILS)"
done