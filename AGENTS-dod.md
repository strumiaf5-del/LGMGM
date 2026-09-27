# Definition of Done — LGMDM Studio

> Estado: obligatorio desde 2026-09-27. Aplica a TODO fix/feature en el port TS+Vite y el backend port.

## Criterios obligatorios (todos deben pasar)

### Backend (Python)

1. **Sintaxis Python válida**: `python3 -c "import ast; ast.parse(open('archivo.py').read())"` → sin errores
2. **Tests pasan**: `cd backend && /root/diego/backend/.venv/bin/python3 -m pytest tests/ --tb=short` → 0 failed, 0 errors
3. **Tests nuevos**: si el fix toca un endpoint o función con lógica de negocio, agregar test en `backend/tests/` (mínimo: smoke test del endpoint, happy path + 1 edge case)
4. **Linting**: `cd backend && /root/diego/backend/.venv/bin/python3 -m ruff check .` → no introducir errores NUEVOS (los 474 existentes son deuda pre-existente, no bloquear por ellos)
5. **Backend port responde**: `curl -s http://127.0.0.1:8001/health` → HTTP 200 con `status: ok` y todas deps presentes

### Frontend (TypeScript+Vite)

1. **tsc pasa**: `cd frontend && npx tsc --noEmit` → EXIT=0
2. **Build pasa**: `cd frontend && npm run build` → EXIT=0, dist generado, CSP hardened
3. **Tests nuevos**: si el fix toca una feature con lógica, agregar test (cuando haya framework de FE tests — hoy no hay, deuda)
4. **Browser verifica**: cargar la página en Playwright MCP, capturar console messages automáticamente:
   - **0 console errors** (`browser_console_messages({ level: "error" })` → 0 messages)
   - **0 network 4xx/5xx** excepto los esperados (ej: 401 sin token)
   - **Login funciona**: si el fix toca auth, login con `fede@test.com / Fede1234` y verificar redirect a `index.html?workspace=console`
   - **`window.LGMDM` definido**: si el fix toca módulos, verificar que cargaron

### Documentación

1. **AUDITORIA-*.md**: si el fix toca deuda pendiente o decisiones de diseño, actualizar o crear `frontend/AUDITORIA-*.md`
2. **AGENTS.md**: si el fix cambia una regla del proyecto (ej: conteo de @ts-nocheck, nombres de params del backend), actualizar `AGENTS.md`
3. **Comentario en código**: si el fix no es obvio, agregar comentario `// FIX <ID>: <por qué>` en el código

### Git

1. **Commit atómico**: un fix = un commit, mensaje descriptivo con formato `fix(<scope>): <descripción>` o `feat(<scope>): <descripción>`
2. **No commitear secrets**: `.env`, `users_db.json`, `*.bak*` están en `.gitignore` y NUNCA se commitean
3. **Push al remote**: `git push origin main` después de cada commit (backup automático)

## Criterios deseables (no bloquean pero se recomiendan)

- **Performance**: si el fix toca un loop de render (RAF), medir con `browser.trace.start/stop` y verificar que no empeora
- **Accesibilidad**: si el fix toca HTML, verificar con `browser.lighthouse` que el score de a11y no baja
- **Cross-browser**: idealmente probar en Firefox + Chromium (hoy solo Chromium, deuda)

## Lo que NO es "done"

- "Funciona en mi máquina" sin verificar en el browser
- "Pasa tsc" sin verificar que la app carga en el browser sin errores de consola
- "El test pasa" pero no cubre el caso que el bug original rompió
- "Lo commiteé" pero no verifiqué que el build sigue pasando después del commit

## Verificación rápida (one-liner)

```bash
# Backend
cd /root/nuevito/backend && /root/diego/backend/.venv/bin/python3 -m pytest tests/ --tb=short 2>&1 | tail -3

# Frontend
cd /root/nuevito/frontend && npx tsc --noEmit && npm run build 2>&1 | tail -2

# Browser (desde execute)
# 1. Login con helper
# 2. browser_console_messages({ level: "error" }) → 0 messages
# 3. browser_snapshot → window.LGMDM definido, URL en index.html
```
