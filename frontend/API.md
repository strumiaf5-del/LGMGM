# API.md — Mapa de endpoints del backend LGMDM

> **Fuente:** `/root/nuevoFinal/backend/` (READ-ONLY). Este mapa se mantiene sincronizado con el backend tal como está al 2026-09-26.
>
> **Convención:** los paths mostrados son los declarados en cada `@router.<method>(...)`. FastAPI los monta en la raíz (sin prefix global), salvo que se indique lo contrario. Todos los endpoints requieren `Authorization: Bearer <jwt>` salvo los marcados con `[public]` o los explícitamente `[ws]`.
>
> **Estado de verificación: ⚠️ NO VERIFICADO.** La afirmación anterior ("todos los endpoints matchean, sin gaps reales") era **falsa** y fue retirada el 26-sep-2026. No se corrió un mapeo exhaustivo TS↔backend. Hallazgo confirmado por auditoría estática 26-sep: `src/core/api.ts:248` declara `apiFetch<T>(…): Promise<T>` pero retorna el body JSON parseado, mientras **27+ call sites** en `mastering-actions.ts`, `reference-mastering.ts`, `state.ts`, `preview-controller.ts`, `file-handling.ts`, `assistant.ts`, `mixer-engine.ts`, `premium-suite.ts`, `meters-dashboard.ts`, `pitch-correction.ts`, `lufs-normalize.ts` lo tratan como `Response` (`res.ok`, `res.text()`, `res.blob()`). **Consecuencia: los flujos async de mastering/AI/stems/report/preview están rotos.** La API correcta (`api.client.get/post`, tipada `Promise<Response>`) existe en `api.ts:315-334` con **0 consumidores**. **Pendiente:** mapeo exhaustivo de cada `apiFetch(` contra `@router.<method>` en `backend/routers/`, y corrección de la firma en `api.ts:248`.

## Índice de routers (15)

| Router | Archivo fuente | Auth por defecto | Prefijo |
|---|---|---|---|
| `info` | `routers/info.py` | público | `/` |
| `auth` | `routers/auth.py` | mixto | `/auth/*` |
| `dashboard` | `routers/dashboard.py` | mixto (GET=auth, WS=token query) | `/dashboard`, `/ws/dashboard` |
| `jobs` | `routers/jobs.py` | JWT | `/jobs/*`, `/job/*`, `/download/*`, `/report/*` |
| `projects` | `routers/projects.py` | JWT | `/projects/*` |
| `analysis` | `routers/analysis.py` | JWT | `/analysis`, `/analyze`, `/mix-advice`, `/spectrum`, `/normalize-streaming-target` |
| `ai` | `routers/ai.py` | JWT | `/ai/*` |
| `library` | `routers/library.py` | JWT | `/library/*` |
| `reference_library` | `routers/reference_library.py` | JWT | `/reference-library*` |
| `mastering` | `routers/mastering.py` | JWT | `/master*`, `/pitch-correct` |
| `mixer` | `routers/mixer.py` | JWT | `/mix/*` |
| `stems` | `routers/stems.py` | JWT | `/stems/*` |
| `streaming` | `routers/streaming.py` | JWT | `/mix/submit` + WS `/ws/*` |
| `advanced_dsp` | `routers/advanced_dsp.py` | JWT | `/resonance-tamer`, `/inflator`, `/phantom-sub`, etc. |
| `preview` | `routers/preview.py` | JWT | `/source`, `/progress/*`, `/meters/*` |

> **Archivo NO usado por app.py:** `routers/preview_router.py` es código viejo. El canónico es `routers/preview.py`.

---

## 1. `info` (público) — `routers/info.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| GET | `/` | Info | Raíz: `{ service, version, ... }` |
| GET | `/health` | Info | Healthcheck |
| GET | `/presets` | Presets | Lista de mastering presets |
| GET | `/preset/{name}` | Presets | Detalle de un preset |
| GET | `/platform-targets` | Mastering | Loudness targets por plataforma |

## 2. `auth` (mixto) — `routers/auth.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/auth/register` | Auth | Alta de usuario |
| POST | `/auth/login` | Auth | Login → JWT |
| POST | `/auth/logout` | Auth | Cierra sesión |
| GET | `/auth/ws-ticket` | Auth | Ticket corto para WS (los browsers no pueden mandar `Authorization` en WS) |
| GET | `/auth/me` | Auth | Usuario actual |
| POST | `/auth/change-password` | Auth | Cambio de password |
| GET | `/auth/admin/users` | Auth | [admin] Lista usuarios |
| POST | `/auth/admin/approve/{user_id}` | Auth | [admin] Aprobar user |
| POST | `/auth/admin/reject/{user_id}` | Auth | [admin] Rechazar user |
| DELETE | `/auth/admin/users/{user_id}` | Auth | [admin] Borrar user |

## 3. `dashboard` — `routers/dashboard.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| GET | `/dashboard` | Dashboard | Métricas (JWT header) |
| WS | `/ws/dashboard` | — | Stream de métricas en vivo (auth vía `?token=` query param) |

## 4. `jobs` — `routers/jobs.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| GET | `/job/{job_id}` | Jobs | Estado de un job |
| GET | `/download/{job_id}` | Jobs | Descargar output del job |
| GET | `/report/{job_id}` | Jobs | Reporte JSON |
| GET | `/report/{job_id}/visual` | Jobs | Reporte HTML |
| GET | `/jobs` | Jobs | Lista de jobs del usuario |
| GET | `/jobs/{job_id}` | Jobs | Detalle de un job |
| POST | `/jobs/{job_id}/preview` | Jobs | Crear preview |
| POST | `/jobs/{job_id}/preview/generate` | Jobs | Disparar generación de preview |
| POST | `/jobs/{job_id}/export` | Jobs | Crear export |
| POST | `/jobs/{job_id}/exports/generate` | Jobs | Disparar export |
| POST | `/jobs/{job_id}/archive` | Jobs | Archivar job |

## 5. `projects` — `routers/projects.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/projects` | Projects | Crear proyecto |
| GET | `/projects` | Projects | Listar |
| GET | `/projects/{project_id}` | Projects | Detalle |
| PUT | `/projects/{project_id}` | Projects | Update |
| DELETE | `/projects/{project_id}` | Projects | Borrar |
| GET | `/projects/{project_id}/versions/{version_name}` | Projects | Versión específica |
| POST | `/projects/{project_id}/versions` | Projects | Crear versión |
| POST | `/projects/{project_id}/versions/{version_name}/exports` | Projects | Export de versión |
| GET | `/projects/{project_id}/versions/{version_name}/download/{export_id}` | Projects | Download |
| GET | `/projects/{project_id}/versions/{version_name}/exports` | Projects | Lista exports |
| GET | `/projects/{project_id}/all-exports` | Projects | Todos los exports |

## 6. `analysis` — `routers/analysis.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/analysis` | — | Análisis general |
| POST | `/analyze` | — | Análisis (alias?) |
| POST | `/mix-advice` | — | Consejo de mezcla |
| POST | `/spectrum` | — | Espectro FFT |
| POST | `/normalize-streaming-target` | — | Normalización a target streaming |

## 7. `ai` (Laia) — `routers/ai.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| GET | `/ai/status` | Asistente IA | Estado del asistente |
| POST | `/ai/chat` | Asistente IA | Chat con Laia |
| POST | `/ai/suggest` | Asistente IA | Sugerencias |
| POST | `/ai/auto-master` | Asistente IA | Auto-master con IA |

## 8. `library` — `routers/library.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/library/upload` | Librería | Subir archivo |
| GET | `/library` | Librería | Listar |
| GET | `/library/{file_id}/download` | Librería | Descargar |
| DELETE | `/library/{file_id}` | Librería | Borrar |

## 9. `reference_library` — `routers/reference_library.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| GET | `/reference-library` | Reference Library | Lista referencias |
| POST | `/reference-library/rescan` | Reference Library | Re-escanear disco |

## 10. `mastering` — `routers/mastering.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/master/preset/{preset_name}` | Mastering | Aplicar preset específico |
| POST | `/master` | Mastering | Mastering principal (sync?) |
| POST | `/master/sync` | Mastering | Versión sincrónica |
| POST | `/master/reference` | Mastering | Mastering contra referencia |
| POST | `/master/reference/sync` | Mastering | Sync contra referencia |
| POST | `/master/multi-reference` | Mastering | Matching timbral multivariable (hasta 5 referencias con pesos). FormData: `file` + `reference_files[]` + `reference_weights` (comma-separated) |
| POST | `/master/normalize` | Mastering | Normalizar LUFS |
| POST | `/master/normalize/sync` | Mastering | Normalizar sync |
| POST | `/pitch-correct` | Audioprocesamiento | Pitch correction |

## 11. `mixer` — `routers/mixer.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/mix/upload-stem` | Mixer | Subir stem |
| GET | `/mix/stem-library` | Mixer | Listar stem library |
| POST | `/mix/stem-library/upload` | Mixer | Subir a stem library |
| GET | `/mix/stem-library/{file_id}/download` | Mixer | Download stem |
| DELETE | `/mix/stem-library/{file_id}` | Mixer | Borrar stem |
| POST | `/mix/ai-suggest` | Mixer | Sugerencias IA de mezcla |

## 12. `stems` — `routers/stems.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/stems/separate` | Stems | Separar con Demucs |
| GET | `/stems/download/{job_id}/{stem_name}` | Stems | Download de stem |

## 13. `streaming` — `routers/streaming.py`

| Método | Path | Tags | Notas |
|---|---|---|---|
| POST | `/mix/submit` | Mixer | Submit a pipeline de streaming mix |
| WS | `/ws/master-stream` | — | Stream de master en proceso (auth vía `?token=`) |
| WS | `/ws/ref-stream` | — | Stream de referencia con matching EQ (PCM chunks: `need_upload`/`use_cache`/`need_upload_ref`/`use_cache_ref`/`analyzing`/`matching_ready`/`chunk`/`done`/`error`). Usado por `reference-mastering.ts` para preview en vivo. |
| WS | `/ws/mix-stream` | — | Stream de mezcla (auth vía `?token=`) |

## 14. `advanced_dsp` — `routers/advanced_dsp.py`

| Método | Path | Notas |
|---|---|---|
| POST | `/resonance-tamer` | Reducción de resonancias |
| POST | `/inflator` | Saturación/armónicos |
| POST | `/phantom-sub` | Mejora de sub-bajo |
| POST | `/iso-compensation` | Compensación de aislamiento |
| POST | `/match-eq` | EQ matching |
| POST | `/cross-demask` | Desenmascarar cross-band |
| POST | `/loudness-penalty` | Cálculo de penalidad loudness |
| POST | `/phase-rotation` | Rotación de fase |
| POST | `/spectral-tilt` | Tilt espectral |
| POST | `/dr-meter` | Dynamic range meter |

## 15. `preview` — `routers/preview.py` (canónico)

| Método | Path | Notas |
|---|---|---|
| POST | `/preview/source` | Crea un snapshot inmutable de 25s del archivo original. FormData: `file` (o `library_id`), `duration_sec`, `output_format`, `output_bit_depth`. Devuelve `{ source_id, duration_sec, source_sha256 }` |
| POST | `/preview` | Renderiza el preview completo (~25s) con los params actuales. Body JSON: `{ preview_source_id, preview_duration_sec, params }`. Devuelve `audio/wav` con headers `X-Preview-Duration`, `X-Preview-Source-Id`. Usado por `preview-controller.ts` |
| GET | `/preview/progress/{source_id}` | Progreso del render del snapshot |
| GET | `/preview/meters/{source_id}` | Meters live del snapshot (peak/rms/lufs/true_peak/stereo_corr + chain_meters). Polling cada 10s por `preview-controller.ts` |

---

## Convenciones detectadas

- **Auth JWT** se aplica a nivel `include_router(..., dependencies=[Depends(get_current_user)])` en `app.py` para los routers que requieren auth.
- **WS auth** se hace manualmente vía `?token=` porque los browsers no soportan headers en WebSocket handshake. Hay un endpoint dedicado `GET /auth/ws-ticket` para obtener el ticket.
- **Rate limiting** se aplica con `slowapi` (el `Limiter` se pasa a routers que lo requieren, ej. `auth`, `ai`).
- **Tags** se usan para agrupar en OpenAPI/Swagger.

## Hallazgos / cosas raras para revisar

1. **Hay DOS archivos de preview:** `routers/preview.py` (canónico, usado por `__init__.py`) y `routers/preview_router.py` (huérfano, no importado). Probablemente código viejo a borrar.
2. **Hay un `_deprecated/` en `dist/` del frontend producción** — referencia a código viejo. Probablemente tenga equivalentes en el backend.
3. **`app.py` línea 589-692** define los routers pero algunas funciones core (`process_audio`, `mix_and_master`, `separate_stems`, etc.) están en el top-level (no en `routers/`). El backend tiene una mezcla de organización top-level + modular.
4. **El frontend actual `/root/frontend/src/core/api.ts`** probablemente llama a varios de estos endpoints. Habrá que hacer match 1 a 1 cuando migremos features.

---

## Tareas pendientes

- [ ] Leer firma completa de cada endpoint (request/response schemas) cuando lo necesitemos para una feature concreta.
- [ ] Documentar payloads de los endpoints críticos (`/master`, `/ai/chat`, `/ws/mix-stream`, `/auth/login`).
- [ ] Detectar qué endpoints NO usa el frontend actual (gaps a cerrar o cerrar gaps del backend).
- [ ] Detectar qué endpoints SÍ usa el frontend producción (`upstream-frontend/dist/js/`) que NO están en el TS+Vite actual.
