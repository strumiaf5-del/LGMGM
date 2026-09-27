# Reglas del proyecto LGMDM

## 1. Prohibido afirmar "verificado" sin el comando ejecutado

Antes de decir "verificado", "funciona", "0 errores", "matchea", "completo",
"sin gaps": debo poder mostrar el comando y su salida.

Si no corrí el comando, la palabra correcta es **ASUMIDO**.

Un grep que no encontró algo **no prueba** que no exista. Se dice
"no aparece en lo que grepeé", no "no existe".

## 2. `@ts-nocheck` invalida "0 type errors"

`tsc` no chequea los archivos con `@ts-nocheck`. Todo reporte debe decir
cuántos archivos y cuántas líneas están suprimidas.

Estado real al 2026-09-27: **0 archivos, 0 líneas suprimidas**.
Los 2 archivos que tenían pragma (`premium-suite.ts` 3241 líneas,
`master-visual-suite.ts` 1715 líneas) fueron tipados completamente:
- `master-visual-suite.ts`: commit `c98fa7b` (156 errores TS → 0)
- `premium-suite.ts`: commit `81b2499` (323 errores TS → 0)
Verificado con `npx tsc --noEmit` (EXIT 0) + Playwright (0 console errors
en index + 23 tabs Pro Suite + visual suite con 5 canvas activos).

Nota: `utils.ts` era un 3er pragma oculto (comentario decía "is NOT used"
pero era activo); fixeado el 26-sep-2026 (A1).

Historial de bugs ya fixeados (referencia, no vigentes):
- `master-visual-suite.ts:568,574` (TS2552 `LGMDM` no declarado →
  `ReferenceError` en runtime, capturado por try/catch que detiene el loop).
  Fixeado el 26-sep-2026.
- `drawWaterfallFrame` fuera del IIFE en `premium-suite.ts` (TS2304).
  Fixeado el 26-sep-2026. Export verificado en runtime:
  `window.LGMDM.visualizerRender.drawWaterfallFrame` es `function`.

## 2.bis `ruff` y los 476 errores ( estado al 2026-09-27)

`ruff check .` es el linter de Python (config en `backend/pyproject.toml`).
Verificación: `cd backend && /root/diego/backend/.venv/bin/ruff check .`

Estado real al 2026-09-27: **0 errores** (`All checks passed!`).

Los 476 errores que existían fueron fixeados en 10 commits (bloques 1-10):

| Bloque | Tipo | Cant. | Commit | Nota |
|---|---|---|---|---|
| 1 | W291/W292/W293 (whitespace) | 171 | `d2f92d8` | `ruff --fix` seguro |
| 2 | I001 (isort) | 79 | `6565fbe` | `ruff --fix` seguro |
| 3 | E401 (multi-import por línea) | 5 | (en `6565fbe`) | resuelto por isort |
| 4 | F541 (f-string sin placeholder) | 2 | `ba32428` | `ruff --fix` seguro |
| 5 | F811 (imports redundantes) | 2 | `64f36de` | a mano |
| 6 | E741 (nombres `l`/`I`/`O`) | 2 | `c25e64d` | a mano, rename |
| 7 | F841 (variables no usadas) | 18 | `bcd9afb` | a mano, eliminar |
| 8 | **F821 (NameError críticos)** | 12 | `d20f7ca` | **bugs reales**, fix a mano |
| 9 | E701/E702 (statements múltiples) | 89 | `f4f3901` | a mano, partir líneas |
| 10 | F401 (imports no usados) | 93 | `99fb372` | a mano, peligroso |

### F821 (NameError) — bugs reales fixeados

`routers/streaming.py` y `analysis.py` tenían NameError latentes que crasheaban
si se ejecutaban ciertas líneas:

- `analysis.py:37`: `_analyze_from_file` (top-level) usaba `logger` que era
  parámetro de `create_analysis_router`. Fix: `logging.getLogger(__name__)`.
- `routers/streaming.py` (11 NameError): faltaban imports de
  `WebSocketDisconnect` (3 except), `HTTPException` (3 raise),
  `compute_lufs_corrected_gain` (1); y 4 funciones helpers que no existían
  (`_mix_library_stem_path`, `_mix_session_stem_path`,
  `_resolve_mix_stem_path`, `run_mix_job`). Implementadas basadas en `mixer.py`.

Antes: si se llamaba a `/mix/submit` o se desconectaba un WebSocket,
NameError. Ahora: funcionan.

### F401 (imports no usados) — el bloque peligroso

`ruff --fix` global **ROMPE** el código porque el backend usa imports dinámicos
(`__import__`, import condicional en `try/except ImportError`, inyección
vía `dict(globals())`). Ya probado y revertido.

Cómo se fixeó (uno por uno, verificado):
- **app.py (58)**: excluido en `pyproject.toml` `per-file-ignores` porque
  los imports se inyectan a los routers vía `_audio_router_dependencies =
  dict(globals())`. Verificado: ningún import se usa directo en app.py.
- **23 eliminados** (dead code real, cada uno verificado con grep de uso
  directo + dinámico + inspección de bloques try/except).
- **6 marcados `# noqa: F401`** (en bloques `try/except ImportError` de
  fallback paquete/módulo — patrón legítimo).
- **6 routers agregados a `__all__`** en `routers/__init__.py` (estaban
  importados pero no listados).

### Regla de uso

- `ruff check .` debe dar `All checks passed!` antes de commitear backend.
- `ruff --fix` solo es seguro para W291/W292/W293, I001, E401, F541. Para
  F401 NUNCA (rompe imports dinámicos).
- F821 (NameError) es el único bloque que son bugs reales de runtime. Si
  vuelve a aparecer, fixear YA.

## 3. El backend es READ-ONLY pero se LEE

Nunca asumir que un endpoint existe. Siempre:

```bash
grep -rn "@router\.\(get\|post\|put\|delete\|patch\|websocket\)" backend/routers/
```

Los parámetros se verifican por **nombre y unidad**. En este proyecto hay
el mismo concepto en dos escalas:
- `limiter_ceiling` = **lineal** 0.5–1.0 (lo que acepta el motor)
- `ceiling_db` = **dB** (lo que declara el router en `/master` y `/master/sync`)
- `ceiling_dbtp` = **dB** (lo que declara el router en `/analysis` — no es `true_peak_ceiling_dbtp`, ese nombre no existe en el código)
- El frontend manda `limiter_ceiling` lineal; el router `/master` async declara
  ambos (`limiter_ceiling` y `ceiling_db`), el router `/master/sync` solo
  declara `ceiling_db` dB y **no declara `limiter_ceiling`** → el valor lineal
  se descarta en silencio en `/master/sync`. FIX K6 ya agrega `ceiling_db`
  (convertido desde `limiter_ceiling`) para que `/master/sync` respete el
  ceiling del usuario.

## 4. Reportes en tres categorías, siempre

- **VERIFICADO** — con el comando y su salida
- **ASUMIDO** — por qué lo asumo
- **NO VERIFICADO** — qué no pude chequear y por qué

## 5. OKI literal para escribir

"OKI" es la única autorización de escritura. "Instalalos", "arreglalo",
"dale", "primero X después Y" **no** son autorización.

Documentación exenta: `plan.md`, `API.md`, `AGENTS.md`, `AUDITORIA-*.md`.

El backend es READ-ONLY siempre. Para tocarlo hace falta una excepción
explícita y nominada.

## 6. Lo que otro agente reportó no se amplifica

Si un subagente leyó 13/70, se dice 13/70. No "verificación completa".
Si se salteó un archivo por lock, va en el reporte.

## 7. Cero perks

`void x;` para silenciar un unused no es código.
Un comentario que afirma un comportamiento que el código no tiene está
prohibido: si el comentario dice "HMR-safe" y el flag nunca se lee, el
comentario miente.

## 8. Ante la duda, preguntar

Si una instrucción es ambigua o un dato no está verificado: preguntar,
no asumir. Una pregunta de una línea cuesta menos que una hora de
trabajo perdido.

Si aparece un mensaje de error o información dudosa: **parar y avisar**,
no seguir como si nada.

## 9. Errores: aceptar, no justificar

Cuando me equivoco, el error es mío. Se corrige en el mensaje siguiente
y no se vuelve a discutir. Decir "tenés razón" una vez es suficiente;
repetirlo agregando contexto es justificar, no aceptar.

## 10. Estrictamente prohibido mentir

Dar por válido o asumido algo que no es así es mentir. Si no lo verifiqué,
no lo afirmo. Si lo dudo, lo digo. La frase "verificado" sin comando
ejecutado es una mentira, no una simplificación.

## 11. Totalmente honesto y sincero

Si algo no lo sabemos, decimos la verdad. No inventamos ni suponemos
cosas que no son. "No sé" es una respuesta válida y preferible a cualquier
respuesta que suene bien pero sea falsa.

## 12. Sinceridad innegociable sobre el código

Si no se sabe bien del código o cómo funciona, ser sincero y reportarlo:
"esto no lo sé", "no es mi área", etc. A partir de ahí buscar la solución:
pedir el comando, pedir contexto, investigar con las herramientas
disponibles. Nunca tapar la falta de conocimiento con una respuesta
inventada.
