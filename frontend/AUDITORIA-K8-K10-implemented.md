# Auditoría K8/K10 — Implementados en el backend

> **Fecha de implementación:** 2026-09-26
> **Estado:** IMPLEMENTADOS en `backend/routers/mastering.py` con excepción
> nominada del backend READ-ONLY (OKI literal del usuario).
> **FE:** K8 ya estaba cableado (solo mostraba 404 honesto). K10 actualizado
> para pollear `GET /pitch-correct/{job_id}` y descargar el resultado.

---

## K8 — `POST /master/multi-reference` (IMPLEMENTADO)

### Verificación post-implementación (regla 1, con comando)

```
$ grep -nE '@router\.post\("/master/multi-reference"' backend/routers/mastering.py
358:    @router.post("/master/multi-reference", tags=["Mastering"], dependencies=[Depends(get_current_user)])

$ python3 -c "import ast; ast.parse(open('backend/routers/mastering.py').read()); print('OK')"
OK

$ python3 << 'EOF'
import ast
with open('backend/routers/mastering.py') as f:
    tree = ast.parse(f.read())
for node in tree.body:
    if isinstance(node, ast.FunctionDef) and node.name == 'create_router':
        for inner in node.body:
            if isinstance(inner, ast.AsyncFunctionDef) and inner.name == 'master_with_multi_reference':
                args = [a.arg for a in inner.args.args]
                print('master_with_multi_reference args:', args)
EOF
master_with_multi_reference args: ['background_tasks', 'file', 'reference_files', 'reference_weights', 'reference_source', 'reference_library_ids', 'platform_target', 'output_format', 'output_bit_depth']
```

### Implementación

**Endpoint** `master_with_multi_reference` (línea 358 de mastering.py):
- Acepta `file: UploadFile`, `reference_files: List[UploadFile]` (1-5), `reference_weights: str` (comma-sep floats).
- Valida: 1-5 refs, parsea weights, clamp [0,1], normaliza para que sumen 1.0.
- Si `reference_source=upload`: lee cada UploadFile a disco en `UPLOAD_DIR/multiref_in_{uuid}_{fn}`.
- Si `reference_source=library`: resuelve cada `reference_library_id` (comma-sep) via `library.get_path`.
- Llama a `_combine_references_weighted(ref_paths, weights, upload_dir)` → único WAV combinado.
- Encola `_run_multi_reference_job(file, params, combined_path, ref_paths)` como background task.
- Retorna `{"status":"processing","mode":"multi-reference","reference_count":N,"weights":[...]}`.

**Helper** `_combine_references_weighted` (línea 596, módulo):
- Lee cada ref con `soundfile`, resamplea al SR de la primera con `librosa` si difieren.
- Normaliza channels al máximo (expande mono → multichannel).
- Pad/truncate al largo del más corto, suma ponderada, clamp [-1,1].
- Escribe `multiref_combined_{uuid}.wav` (PCM_24).

**Job runner** `_run_multi_reference_job` (línea 646, módulo, async):
- Escribe el input a disco, filtra params contra `process_audio_with_reference` signature.
- Llama a `process_audio_with_reference(input_path, reference_path=combined, **filtered)`.
- Limpia todos los temporales (input + refs originales + combinado) en `finally`.

### Supuestos que NO verifiqué (ASUMIDO)

- **NO verifiqué** el import real (librosa/fastapi no están en el entorno de auditoría, solo `ast.parse`).
- **NO verifiqué** end-to-end (requiere backend corriendo + token válido + archivo de test).
- **NO verifiqué** que `process_audio_with_reference` produzca buen resultado con un WAV combinado (el weighted average es una aproximación razonable pero no necesariamente óptima — la alternativa sería promediar los análisis espectrales, lo cual requiere tocar `process_audio_with_reference` que tiene 600+ líneas).

### Riesgos a cuidar al probar en producción

1. **Resample con librosa**: si las refs tienen SR muy distintos, librosa.resample puede ser lento. Para 5 refs de 5 min cada una, podría tardar varios segundos.
2. **Channels distintos**: si una ref es mono y otra stereo, expandimos mono→stereo repitiendo el canal. Es una aproximación.
3. **`platform_target` ignorado**: `process_audio_with_reference` no lo acepta. Se loguea como warning. El FE lo manda pero no se aplica.
4. **Bug pre-existente en `_run_reference_job`** (NO tocado por K8): ese job runner pasa `reference={...}` a `process_audio` que no acepta ese kwarg → TypeError. Es deuda del endpoint `/master/reference` existente, no de K8.

---

## K10 — `/pitch-correct` Opción B: async + endpoint de download (IMPLEMENTADO)

### Verificación post-implementación (regla 1, con comando)

```
$ grep -nE '@router\.(post|get)\("/pitch-correct' backend/routers/mastering.py
494:    @router.post("/pitch-correct", tags=["Audioprocesamiento"], dependencies=[Depends(get_current_user)])
516:    @router.get("/pitch-correct/{job_id}", tags=["Audioprocesamiento"], dependencies=[Depends(get_current_user)])

$ grep -nE "^async def _run_pitch_job" backend/routers/mastering.py
735:async def _run_pitch_job(job_id: str, file: UploadFile, mode: str, scale: Optional[str], corrections: Optional[int]):
#                            ^^^^^^^ primer parámetro nuevo

$ grep -nE "^PITCH_JOBS|^PITCH_JOB_TTL" backend/routers/mastering.py
22:PITCH_JOBS: dict = {}
23:PITCH_JOB_TTL_SECONDS = 3600  # 1 hora
```

### Implementación

**Registry** `PITCH_JOBS` (línea 22, módulo):
- Dict en memoria: `{job_id: {"status":"processing|done|error", "path":str|None, "created":float, "mode":str, "scale":str|None}}`.
- TTL de 1 hora (`PITCH_JOB_TTL_SECONDS = 3600`).

**Endpoint POST** `/pitch-correct` (línea 494, modificado):
- Genera `job_id = uuid.uuid4().hex`.
- Crea entrada en `PITCH_JOBS[job_id] = {"status":"processing", "path":None, "created":time.time(), ...}`.
- Encola `_run_pitch_job(job_id, file, mode, scale, corrections)`.
- Retorna `{"status":"processing","job_id":job_id,"mode":mode,"scale":scale}`.

**Endpoint GET** `/pitch-correct/{job_id}` (línea 516, NUEVO):
- Si el job no existe → 404 "Pitch job not found (or expired)".
- Si `created` > TTL → cleanup (borra archivo + entrada) + 404 "Pitch job expired".
- Si `status == "processing"` → 409 "Pitch job still processing".
- Si `status == "error"` → 500 + message, borra la entrada.
- Si `status == "done"` → `FileResponse(path, audio/wav, filename="pitch_corrected_{job_id[:8]}.wav")`, borra la entrada (el archivo se sirve y queda en disco hasta que el OS lo limpie o se sirva; el registry se limpia para no permitir re-download).

**Job runner** `_run_pitch_job` (línea 735, modificado):
- Ahora recibe `job_id` como primer parámetro.
- Al terminar OK: `PITCH_JOBS[job_id].update({"status":"done","path":out_path,"cents":cents})`.
- Al fallar: `PITCH_JOBS[job_id].update({"status":"error","error":"Pitch correction failed"})`.
- Sigue limpiando `pitch_in_*.tmp` en `finally`; `pitch_out_*.wav` queda para descarga.

**Frontend** `pitch-correction.ts` (modificado):
- POST → lee `job_id` del response.
- Hace polling a `GET /pitch-correct/{job_id}` cada 2s hasta 4 min máximo.
- 200 → descarga el `.wav` via blob + `<a download>`.
- 409 → sigue polleando.
- 404/500 → muestra error.
- Timeout → mensaje honesto.

### Supuestos que NO verifiqué (ASUMIDO)

- **NO verifiqué** el import real (fastapi no está en el entorno de auditoría).
- **NO verifiqué** end-to-end (requiere backend corriendo + token + archivo de test).
- **NO verifiqué** que `FileResponse` sirva el archivo correctamente antes de que el handler retorne (FastAPI lo hace, pero no lo probé).

### Riesgos a cuidar al probar en producción

1. **Path disclosure**: `out_path` NUNCA se envía al cliente. El endpoint GET mapea `job_id → path` internamente. ✓ verificado por inspección del código.
2. **Acumulación de `pitch_out_*.wav`**: si el cliente nunca descarga, el archivo queda en disco. El cleanup on-access (lazy GC) borra el archivo cuando el job expira por TTL. Si el proceso se reinicia, los archivos huérfanos quedan (deuda: un cleanup cron aparte).
3. **`PITCH_JOBS` en memoria**: si el proceso se reinicia, los jobs en proceso se pierden. No es crítico (pitch-correct es ad-hoc, no crítico), pero el cliente verá 404 si poll durante un reinicio.
4. **Re-download**: una vez descargado, el job se borra del registry. Si el cliente intenta re-descargar, recibe 404. Esto es intencional (cleanup) pero puede sorprender.
5. **`scale` ignorado**: sigue siendo ignorado con warning (deuda original, no de K10). La cuantización musical requiere pipeline completo fuera de scope.

---

## Resumen

| # | Backend | FE | Estado |
|---|---|---|---|
| K8 | `POST /master/multi-reference` (línea 358) + `_combine_references_weighted` + `_run_multi_reference_job` | Ya cableado ( línea 1311 reference-mastering.ts) | ✅ Implementado (no verificado end-to-end) |
| K10 | `POST /pitch-correct` (modificado línea 494) + `GET /pitch-correct/{job_id}` (nuevo línea 516) + `PITCH_JOBS` registry + `_run_pitch_job` con job_id | Polling + descarga (pitch-correction.ts) | ✅ Implementado (no verificado end-to-end) |

**Verificación estática completada:** `ast.parse` OK, `tsc --noEmit` 0 errores, `npm run build` 0, estructura AST confirmada (8 funciones módulo, 11 endpoints, `return router` al final, `_run_pitch_job` con `job_id` primer param, `PITCH_JOBS` AnnAssign).

**Verificación end-to-end pendiente:** requiere levantar el backend con todas sus deps (fastapi, librosa, soundfile, numpy) + token válido + archivos de audio de test.
