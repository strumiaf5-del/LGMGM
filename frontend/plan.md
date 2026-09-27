# Plan de reparación — LGMDM Studio (`/root/nuevito/frontend`)

> **Objetivo:** portar los archivos faltantes del aporte a TypeScript, cablear el flujo central (cargar → sliders → analizar → masterizar), corregir los 10 widgets DSP con prefijo inventado, y verificar end-to-end contra el backend real en `/root/nuevito/backend/`.
>
> **Reglas:**
> - Backend `/root/nuevito/backend/` es READ-ONLY.
> - `/root/aporte/js/` es referencia READ-ONLY.
> - No parches temporales. Cada archivo del aporte se porta completo a TS.
> - Cada fase termina con verificación (type-check + diff). No se marca "done" sin el diff.
> - Stack: vanilla TS + Vite. Sin React/Solid/Svelte.
>
> **Convención de paths en TS:** los endpoints se pasan SIN prefijo `/api` (el backend monta los routers en raíz). El helper `apiUrl()`/`apiBase()` ya está corregido.

---

## Inventario verificado de lo que falta (re-confirmado por contenido, no por tag)

### 🔴 CRÍTICO — flujo central roto
| # | Archivo aporte | Líneas | Impacto |
|---|---|---|---|
| C1 | `01-state.js` | 267 | State central (`selectedFile`, `getSelectedFile`, `lastAnalysisData`, `stems`, `reference`, `jobs`). Todo `window.LGMDM.state.*` roto. |
| C2 | `04-file-handling.js` | 349 | `fileInput`/`dropZone`/Uppy → `setFile()`. El archivo nunca se guarda. |
| C3 | `02-sliders-ui.js` | 203 | Sistema de sliders + formatters + workflow rail. No hay inicialización. |
| C4 | `05-eq-waveform.js` | 499 | EQ waveform canvas + integración con sliders. |
| C5 | `07-mastering-actions.js` | 529 | Handlers de `btnAnalyze`/`btnMasterSync`/`btnMasterAsync`/`btnPitchCorrection`. Solo hacen `setStatus`. |
| C6 | Prefijo `/dsp/` inventado | — | 10 widgets → 404 contra backend. |

### 🟠 ALTO — funcionalidad faltante
| # | Archivo aporte | Líneas | Impacto |
|---|---|---|---|
| A1 | `10-meters-dashboard.js` | 875 | Dashboard de métricas live. |
| A2 | `11-ai-assistant-ux.js` | 418 | Panel de IA (chat/suggest/auto-master). |
| A3 | `13-mixer-ui.js` | 1668 | UI del mixer (canales, faders, drag&drop). |
| A4 | `14-pitch-correction.js` | 326 | Pitch correction UI. |
| A5 | `30-preview-controller.js` | 504 | Controller de preview (polling progress/meters). |
| A6 | `12-lufs-normalize.js` | 72 | Normalizar LUFS. |

### 🟡 MEDIO — bridges cross-module
| # | Problema | Estado |
|---|---|---|
| M1 | `window.LGMDM.visualizerRender` | Leído en master-console:256, no escrito (hay fallback). |
| M2 | `window.LGMDM.reference.stopRefPreview` | Leído en master-console:127, no escrito. |
| M3 | `36-base-canvas-widget.js` (148) | No integrado — verificar si rompe. |
| M4 | `00-compat.js` / `00-dom-safety.js` | Verificar cobertura. |

---

## Endpoints que cada aporte llama (verificado del source)

### `07-mastering-actions.js` (C5) llama a:
- `POST /master?{params}` — `submitMasterJob` (btnMaster/btnMasterAsync)
- `POST /master/sync?{params}` — `submitMasterSync` (btnMasterSync)
- `POST /ai/auto-master?{params}` — auto-master IA
- `POST /ai/suggest` — sugerencias IA
- `POST /mix-advice` — mix advice
- `POST /spectrum?n_fft=4096&n_bins=96` — spectrum
- `POST /stems/separate` — stems
- `GET /job/{jobId}` — polling
- `GET /download/{jobId}` — download final
- `GET /stems/download/{job}/{stem}` — download stem
- `POST /analysis` — analyze (vía `apiPostDsp('/analysis', fd)` en premium-suite:584)
- `POST /pitch-correct` — pitch (a confirmar en 14-pitch-correction.js)

### `04-file-handling.js` (C2) llama a:
- `POST /library/upload` — subir a librería
- `GET /library` — listar librería

### `11-ai-assistant-ux.js` (A2) llama a:
- `GET /ai/status`
- `POST /ai/chat`
- `POST /ai/suggest`
- `POST /ai/auto-master`

### `10-meters-dashboard.js` (A1) llama a:
- `GET /preview/progress/{source_id}`
- `GET /preview/meters/{source_id}`

### `30-preview-controller.js` (A5) llama a:
- `POST /source`
- `GET /preview/progress/{source_id}`
- `GET /preview/meters/{source_id}`

### Backend real confirma (de `backend/routers/`):
Verificación **NO REALIZADA**. La línea anterior decía "✅ Match verificado" sin que se haya corrido el grep exhaustivo. El mapeo endpoint-por-endpoint TS↔backend sigue pendiente.

---

## Archivos TS que referencian `/dsp/` (C6 — a corregir)

16 archivos, ~40 ocurrencias:
- `src/features/pro/widgets/` (14 archivos): loudness-penalty, cross-demask, spectral-tilt, resonance-tamer, phantom-sub, multiband-transient, saturation, loudness-war, dr-meter, iso-compensation, reference-match, ms-imager, phase-rotation
- `src/features/pro/premium-suite.ts` (~20 ocurrencias)
- `src/features/pro/insert-rack.ts` (10 ocurrencias en CATALOG)
- `src/features/pro/insert-base.ts` (fallback `/dsp/${spec.id}`)

---

## HTML — IDs verificados existentes
- `fileInput`, `dropZone`, `uppyPicker`, `dropZoneRef` ✅
- `btnAnalyze`, `btnAdvice`, `btnMasterSync`, `btnMasterAsync`, `btnPitchCorrection`, `btnNormalizeLufs` ✅
- `consolePlayBtn`, `consoleABToggle`, `refFileInput` ✅
- `btnMaster` ✅ (existe, handler a conectar)
- 157 sliders (`type="range"`) en el HTML — pero NO hay `sliders-meta` ni `data-slider` → los metadatos hay que migrarlos al HTML o a un JSON embebido (Fase G3).

---

# FASES DE EJECUCIÓN

## Fase G1 — State central (fundamento)

### Archivos a crear/modificar
- **REESCRIBIR** `src/core/state.ts` (actual `appState` aislado → state central colgado en `window.LGMDM.state`)

### Fuente aporte
- `/root/aporte/js/01-state.js` (267 líneas)

### Qué hacer
Portar `01-state.js` a `src/core/state.ts`. El state central se cuelga en `window.LGMDM.state` con:
- `Object.defineProperty` para `selectedFile`, `lastAnalysisData`, `stems`
- Métodos: `getSelectedFile()`, `getLastAnalysis()`, `setStems(payload)`, `clearStems()`
- Props: `reference`, `runtime`, `jobs`, `cachedFileBuffer`, `metersRafId`, `metersAudioCtx`, `metersSourceNode`, `_previewLibraryId`, `_previewSessionId`, `previewAudioUrl`, `downloadUrl`, `formatters`, `themeColors`
- El `stems` setter dispara `CustomEvent('stems-loaded', { detail: { stems, loaded } })`
- `appState` actual (con `currentPane`, `currentAudioFile`, `subscribeToStateChanges`) se mantiene como capa interna, mapeando `currentAudioFile` ↔ `selectedFile`

### Comandos
```bash
# 1. Leer aporte fuente (READ-ONLY)
cat /root/aporte/js/01-state.js

# 2. Reescribir state.ts
write /root/nuevito/frontend/src/core/state.ts  # contenido completo del port

# 3. Verificar type-check
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación de la fase
```bash
# Diff: cada LGMDM.state.* leído debe estar definido en state.ts
cd /root/nuevito/frontend
grep -rhoE "LGMDM\.state\.[a-zA-Z]+|state\.[a-zA-Z]+" src/ | sort -u > /tmp/state-read.txt
grep -oE "(selectedFile|lastAnalysisData|stems|reference|runtime|jobs|getSelectedFile|getLastAnalysis|setStems|clearStems|cachedFileBuffer|metersRafId|metersAudioCtx|metersSourceNode|_previewLibraryId|_previewSessionId|previewAudioUrl|downloadUrl|formatters|themeColors)" src/core/state.ts | sort -u > /tmp/state-written.txt
comm -23 /tmp/state-read.txt /tmp/state-written.txt
# Resultado esperado: vacío (0 huérfanos)
```

---

## Fase G2 — File handling + cableado fileInput

### Archivos a crear
- **CREAR** `src/features/workspace/file-handling.ts`

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar import

### Fuente aporte
- `/root/aporte/js/04-file-handling.js` (349 líneas)

### Qué hacer
Portar `04-file-handling.js`:
- `setFile(file)`: valida tamaño (MAX_FILE_MB), guarda en `window.LGMDM.state.selectedFile`, llama `syncTrackInfo()`
- Bind `fileInput.change` → `setFile(fileInput.files[0])`
- Bind `dropZone.dragover` (preventDefault + highlight), `dropZone.drop` → `setFile(e.dataTransfer.files[0])`
- Uppy opcional: si `window.Uppy` existe y hay `#uppyPicker`, inicializar (verificar HTML tiene `uppyPicker` ✅)
- `syncTrackInfo()` mueve de master-console.ts → file-handling.ts (o se queda en master-console y file-handling lo llama via `window.LGMDM.console.syncTrackInfo`)

### Comandos
```bash
cat /root/aporte/js/04-file-handling.js
write /root/nuevito/frontend/src/features/workspace/file-handling.ts
# Editar entrypoint
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # oldString: import '../features/library/reference-picker'; // exposes window.LGMDM.reference.libraryPicker
  # newString: import '../features/library/reference-picker'; // exposes window.LGMDM.reference.libraryPicker
  #           import '../features/workspace/file-handling'; // fileInput → state.selectedFile
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
# 1. fileInput.change existe en file-handling.ts
grep -n "fileInput.*change\|fileInput.*addEventListener" /root/nuevito/frontend/src/features/workspace/file-handling.ts
# 2. setFile guarda en state.selectedFile
grep -n "state.selectedFile = file\|\.selectedFile = " /root/nuevito/frontend/src/features/workspace/file-handling.ts
# 3. Import en entrypoint
grep -n "file-handling" /root/nuevito/frontend/src/entrypoints/index.ts
```

---

## Fase G3 — Sliders UI

### Archivos a crear
- **CREAR** `src/features/workspace/sliders-ui.ts`
- **CREAR** `src/data/sliders-meta.ts` (metadatos de sliders embebidos, migrados del HTML legacy)

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar import

### Fuente aporte
- `/root/aporte/js/02-sliders-ui.js` (203 líneas)
- Los `sliders-meta` originales (extraer del `upstream-frontend/dist/index.html` o del aporte)

### Qué hacer
Portar `02-sliders-ui.js`:
- Formatters: `signedDb`, `db`, `hz`, `khz`, `ms`, `ratio`, `q`, `lufs`, `multi`, `pct`, `int`, etc.
- `initSliders()`: lee metadatos de `sliders-meta.ts`, busca todos los `input[type="range"]`, bind `input`/`change`, actualiza display + state del params-builder
- Workflow rail (si aplica)
- Exponer `window.LGMDM.sliders` con `init`, `getValues`, `setValues`

### Comandos
```bash
cat /root/aporte/js/02-sliders-ui.js
# Extraer sliders-meta del HTML legacy
grep -A200 "sliders-meta\|SLIDERS_META\|sliderMeta" /root/nuevito/frontend/upstream-frontend/dist/index.html | head -100
write /root/nuevito/frontend/src/data/sliders-meta.ts
write /root/nuevito/frontend/src/features/workspace/sliders-ui.ts
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar: import '../features/workspace/sliders-ui'; // initSliders on DOMContentLoaded
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
# 1. Cada slider del HTML (157) tiene su meta
grep -c "type=\"range\"" /root/nuevito/frontend/index.html
grep -c "id:" /root/nuevito/frontend/src/data/sliders-meta.ts  # debe ser >= 157
# 2. initSliders bindea input/change
grep -n "addEventListener.*'input'\|addEventListener.*'change'" /root/nuevito/frontend/src/features/workspace/sliders-ui.ts
```

---

## Fase G4 — EQ waveform

### Archivos a crear
- **CREAR** `src/features/canvas/eq-waveform.ts`

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar import

### Fuente aporte
- `/root/aporte/js/05-eq-waveform.js` (499 líneas)

### Qué hacer
Portar `05-eq-waveform.js`:
- Canvas de EQ curve (10 biquads RBJ, ya parcialmente en master-console)
- Integración con sliders de EQ (lee valores de `window.LGMDM.sliders`)
- Redibujo en cambio de slider
- Exponer `window.LGMDM.eqWaveform` con `draw`, `redraw`

### Comandos
```bash
cat /root/aporte/js/05-eq-waveform.js
write /root/nuevito/frontend/src/features/canvas/eq-waveform.ts
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar: import '../features/canvas/eq-waveform';
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
grep -n "draw\|redraw\|requestAnimationFrame" /root/nuevito/frontend/src/features/canvas/eq-waveform.ts | head
# Mover slider de EQ → curva redibuja (verificación visual en G11)
```

---

## Fase G5 — Mastering actions + cableado de botones

### Archivos a crear
- **CREAR** `src/features/workspace/mastering-actions.ts`

### Archivos a modificar
- **EDITAR** `src/features/canvas/master-console.ts` — reemplazar los `setStatus`-only handlers por llamadas a mastering-actions
- **EDITAR** `src/entrypoints/index.ts` — agregar import

### Fuente aporte
- `/root/aporte/js/07-mastering-actions.js` (529 líneas)

### Qué hacer
Portar `07-mastering-actions.js`:
- `submitMasterJob()` → `POST /master?{params}` (FormData con `state.selectedFile` + `library_id`)
- `submitMasterSync()` → `POST /master/sync?{params}`
- `submitAnalyze()` → `POST /analysis` (FormData con `state.selectedFile`)
- `submitAutoMaster()` → `POST /ai/auto-master?{params}`
- `submitAdvice()` → `POST /mix-advice`
- `submitSpectrum()` → `POST /spectrum?n_fft=4096&n_bins=96`
- `submitStems()` → `POST /stems/separate`
- `startPolling(jobId)` → `GET /job/{jobId}` cada N ms, actualiza `state.jobs.mastering`
- `downloadResult(jobId)` → `GET /download/{jobId}`
- `downloadStem(job, stem)` → `GET /stems/download/{job}/{stem}`
- Bind `btnMaster` / `btnMasterAsync` / `btnMasterSync` / `btnAnalyze` / `btnPitchCorrection` / `btnAdvice` / `btnStems`
- Reemplazar en `master-console.ts` las líneas 596-628 (setStatus-only) por `masteringActions.bindButtons()`

### Comandos
```bash
cat /root/aporte/js/07-mastering-actions.js
write /root/nuevito/frontend/src/features/workspace/mastering-actions.ts
# Editar master-console.ts: reemplazar handlers setStatus-only
# Leer el bloque actual
sed -n '590,635p' /root/nuevito/frontend/src/features/canvas/master-console.ts
# Edit: reemplazar los addEventListener que solo hacen setStatus
edit /root/nuevito/frontend/src/features/canvas/master-console.ts
  # oldString: LGMDM.dom.byId('btnAnalyze')?.addEventListener('click',()=>setStatus('Analizando audio…',true)); LGMDM.dom.byId('btnMasterAsync')?.addEventListener('click',()=>setStatus('Mastering en cola…',true)); LGMDM.dom.byId('btnMasterSync')?.addEventListener('click',()=>setStatus('Mastering en proceso…',true));
  # newString: // Handlers reales en mastering-actions.ts (bindButtons). Aquí solo delegamos el click visual.
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar: import '../features/workspace/mastering-actions'; // btnAnalyze/btnMaster*/btnPitch handlers
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
# 1. Cada botón tiene handler real (no solo setStatus)
grep -n "btnAnalyze\|btnMaster\|btnMasterSync\|btnMasterAsync\|btnPitchCorrection" /root/nuevito/frontend/src/features/workspace/mastering-actions.ts
# 2. Cada endpoint llamado existe en backend
grep -oE "['\"\`]/(master|analysis|ai/|mix-advice|spectrum|stems|job|download)[^'\"\`]*" /root/nuevito/frontend/src/features/workspace/mastering-actions.ts | sort -u
# Comparar contra backend routers
grep -oE "@router\.(get|post)\(['\"][^'\"]+['\"]" /root/nuevito/backend/routers/mastering.py /root/nuevito/backend/routers/analysis.py /root/nuevito/backend/routers/ai.py /root/nuevito/backend/routers/jobs.py /root/nuevito/backend/routers/stems.py
```

---

## Fase G6 — Fix prefijo `/dsp/` (10 widgets)

### Archivos a modificar (16 archivos, ~40 ocurrencias)
- `src/features/pro/widgets/loudness-penalty.ts`
- `src/features/pro/widgets/cross-demask.ts`
- `src/features/pro/widgets/spectral-tilt.ts`
- `src/features/pro/widgets/resonance-tamer.ts`
- `src/features/pro/widgets/phantom-sub.ts`
- `src/features/pro/widgets/multiband-transient.ts`
- `src/features/pro/widgets/saturation.ts`
- `src/features/pro/widgets/loudness-war.ts`
- `src/features/pro/widgets/dr-meter.ts`
- `src/features/pro/widgets/iso-compensation.ts`
- `src/features/pro/widgets/reference-match.ts`
- `src/features/pro/widgets/ms-imager.ts`
- `src/features/pro/widgets/phase-rotation.ts`
- `src/features/pro/premium-suite.ts`
- `src/features/pro/insert-rack.ts`
- `src/features/pro/insert-base.ts`

### Qué hacer
Quitar el prefijo `/dsp/` de TODOS los endpoints. El backend monta `advanced_dsp` en raíz → `/resonance-tamer`, `/inflator`, etc. (sin prefijo).

### Mapeo exacto (de las líneas verificadas):
| Línea TS actual | Cambiar a |
|---|---|
| `apiUrl('/dsp/loudness-penalty')` | `apiUrl('/loudness-penalty')` |
| `'/dsp/loudness-penalty'` (endpoint) | `'/loudness-penalty'` |
| `'/dsp/cross-demask'` | `'/cross-demask'` |
| `'/dsp/spectral-tilt'` | `'/spectral-tilt'` |
| `'/dsp/resonance-tamer'` | `'/resonance-tamer'` |
| `'/dsp/phantom-sub'` | `'/phantom-sub'` |
| `'/dsp/inflator'` | `'/inflator'` |
| `'/dsp/dr-meter'` | `'/dr-meter'` |
| `'/dsp/iso-compensation'` | `'/iso-compensation'` |
| `'/dsp/match-eq'` | `'/match-eq'` |
| `'/dsp/phase-rotation'` | `'/phase-rotation'` |
| `/dsp/${spec.id}` (insert-base:120) | `/${spec.id}` |

### Comandos
```bash
# Reemplazo global del prefijo /dsp/ en los 16 archivos
cd /root/nuevito/frontend
# Verificar ocurrencias antes
grep -rcn "/dsp/" src/features/pro/ | grep -v ":0"
# Reemplazo con sed (preciso: solo en strings de endpoint)
for f in src/features/pro/widgets/loudness-penalty.ts src/features/pro/widgets/cross-demask.ts src/features/pro/widgets/spectral-tilt.ts src/features/pro/widgets/resonance-tamer.ts src/features/pro/widgets/phantom-sub.ts src/features/pro/widgets/multiband-transient.ts src/features/pro/widgets/saturation.ts src/features/pro/widgets/loudness-war.ts src/features/pro/widgets/dr-meter.ts src/features/pro/widgets/iso-compensation.ts src/features/pro/widgets/reference-match.ts src/features/pro/widgets/ms-imager.ts src/features/pro/widgets/phase-rotation.ts src/features/pro/premium-suite.ts src/features/pro/insert-rack.ts src/features/pro/insert-base.ts; do
  sed -i "s|'/dsp/|'/|g; s|\"\/dsp\/|\"/|g; s|\`/dsp/|\`/|g" "$f"
done
# Verificar 0 ocurrencias después
grep -rcn "/dsp/" src/features/pro/ | grep -v ":0" || echo "OK: 0 ocurrencias"
# Type-check
npx tsc --noEmit
```

### Verificación
```bash
# 1. 0 ocurrencias de /dsp/ en src
grep -rcn "/dsp/" /root/nuevito/frontend/src/ | grep -v ":0"
# Resultado esperado: vacío

# 2. Cada endpoint que el TS llama existe en el backend
grep -rhoE "['\"\`]/[a-z][a-z-]+['\"\`]" /root/nuevito/frontend/src/features/pro/ | sort -u > /tmp/ts-eps.txt
grep -oE "@router\.(get|post)\(['\"][^'\"]+['\"]" /root/nuevito/backend/routers/advanced_dsp.py | sed -E "s/@router\.(get|post)\(['\"]//" | sed "s/['\"]$//" | sort -u > /tmp/be-eps.txt
# Diff (los del TS deben ser subset de los del backend, con prefijo /)
```

---

## Fase G7 — Preview controller + meters dashboard

### Archivos a crear
- **CREAR** `src/features/audio/preview-controller.ts`
- **CREAR** `src/features/workspace/meters-dashboard.ts`

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar imports

### Fuente aporte
- `/root/aporte/js/30-preview-controller.js` (504 líneas)
- `/root/aporte/js/10-meters-dashboard.js` (875 líneas)

### Qué hacer
Portar `30-preview-controller.js`:
- `startPreview(file)` → `POST /source` (FormData), obtiene `source_id`
- `pollProgress(source_id)` → `GET /preview/progress/{source_id}` cada N ms
- `pollMeters(source_id)` → `GET /preview/meters/{source_id}`
- AbortController para teardown
- Exponer `window.LGMDM.previewController`

Portar `10-meters-dashboard.js`:
- Render de métricas live (LUFS, peak, RMS, true peak, correlation)
- Suscripción a `metrics-store` (ya existe `core/metrics-store.ts`)
- Actualización del dashboard UI

### Comandos
```bash
cat /root/aporte/js/30-preview-controller.js
cat /root/aporte/js/10-meters-dashboard.js
write /root/nuevito/frontend/src/features/audio/preview-controller.ts
write /root/nuevito/frontend/src/features/workspace/meters-dashboard.ts
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar imports
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
grep -n "/source\|/preview/progress\|/preview/meters" /root/nuevito/frontend/src/features/audio/preview-controller.ts
grep -n "/preview/meters\|metrics-store\|subscribe" /root/nuevito/frontend/src/features/workspace/meters-dashboard.ts
```

---

## Fase G8 — AI assistant + LUFS normalize + pitch correction

### Archivos a crear
- **CREAR** `src/features/ai/assistant.ts`
- **CREAR** `src/features/workspace/lufs-normalize.ts`
- **CREAR** `src/features/workspace/pitch-correction.ts`

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar imports

### Fuente aporte
- `/root/aporte/js/11-ai-assistant-ux.js` (418 líneas)
- `/root/aporte/js/12-lufs-normalize.js` (72 líneas)
- `/root/aporte/js/14-pitch-correction.js` (326 líneas)

### Qué hacer
Portar `11-ai-assistant-ux.js`:
- Panel de chat IA (HTML ya tiene `aiPanel`, `aiInput`, `aiSend`, `aiMessages`, `aiFab`, `aiClose`)
- `GET /ai/status` — chequear disponibilidad
- `POST /ai/chat` — enviar mensaje
- `POST /ai/suggest` — sugerencias
- `POST /ai/auto-master` — auto-master
- Bind `aiFab` (toggle panel), `aiSend`/`aiInput` (enviar), `aiClose` (cerrar)

Portar `12-lufs-normalize.js`:
- `btnNormalizeLufs` → `POST /master/normalize` o `/master/normalize/sync`
- UI de target LUFS

Portar `14-pitch-correction.js`:
- `btnPitchCorrection` → `POST /pitch-correct`
- UI de params (key, scale, correction amount)

### Comandos
```bash
cat /root/aporte/js/11-ai-assistant-ux.js
cat /root/aporte/js/12-lufs-normalize.js
cat /root/aporte/js/14-pitch-correction.js
write /root/nuevito/frontend/src/features/ai/assistant.ts
write /root/nuevito/frontend/src/features/workspace/lufs-normalize.ts
write /root/nuevito/frontend/src/features/workspace/pitch-correction.ts
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar imports
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
grep -n "/ai/status\|/ai/chat\|/ai/suggest\|/ai/auto-master" /root/nuevito/frontend/src/features/ai/assistant.ts
grep -n "/master/normalize" /root/nuevito/frontend/src/features/workspace/lufs-normalize.ts
grep -n "/pitch-correct" /root/nuevito/frontend/src/features/workspace/pitch-correction.ts
# Diff contra backend
grep -oE "@router\.(get|post)\(['\"][^'\"]+['\"]" /root/nuevito/backend/routers/ai.py /root/nuevito/backend/routers/mastering.py
```

---

## Fase G9 — Mixer UI

### Archivos a crear
- **CREAR** `src/features/audio/mixer-ui.ts`

### Archivos a modificar
- **EDITAR** `src/entrypoints/index.ts` — agregar import

### Fuente aporte
- `/root/aporte/js/13-mixer-ui.js` (1668 líneas) — el más grande

### Qué hacer
Portar `13-mixer-ui.js`:
- UI completa del mixer: canales (stems), faders, pan, mute/solo, EQ por canal
- Drag&drop de stems desde la librería
- Librería de stems (`GET /mix/stem-library`, `POST /mix/upload-stem`, `POST /mix/stem-library/upload`)
- Integración con `mixer-engine.ts` (ya porta el preview Web Audio)
- `POST /mix/ai-suggest` — sugerencias IA de mix
- Modo mixer activado por tab Mixer (`document.body.classList.add('mode-mixer')`)

### Comandos
```bash
cat /root/aporte/js/13-mixer-ui.js
write /root/nuevito/frontend/src/features/audio/mixer-ui.ts
edit /root/nuevito/frontend/src/entrypoints/index.ts
  # agregar: import '../features/audio/mixer-ui';
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
grep -n "/mix/stem-library\|/mix/upload-stem\|/mix/ai-suggest" /root/nuevito/frontend/src/features/audio/mixer-ui.ts
grep -n "mode-mixer\|drag\|drop\|fader" /root/nuevito/frontend/src/features/audio/mixer-ui.ts | head
# Diff contra backend
grep -oE "@router\.(get|post)\(['\"][^'\"]+['\"]" /root/nuevito/backend/routers/mixer.py
```

---

## Fase G10 — Cross-module bridges + verificación `00-compat`/`36-base`

### Archivos a modificar
- `src/features/canvas/master-visual-suite.ts` o `visualizer-helpers.ts` — exponer `window.LGMDM.visualizerRender.drawWaterfallFrame`
- `src/features/library/reference-picker.ts` — exponer `window.LGMDM.reference.stopRefPreview`
- Verificar si `36-base-canvas-widget.js` y `00-compat.js` rompen algo o están cubiertos

### Qué hacer
1. **`visualizerRender`**: el `drawWaterfallFrame` ya existe en `premium-suite.ts:205`. Exponerlo en `window.LGMDM.visualizerRender = { drawWaterfallFrame }` desde el módulo que lo define (premium-suite o un nuevo `canvas/visualizer-render.ts` que extraiga la función).
2. **`reference.stopRefPreview`**: el reference-picker ya define `g.reference`. Agregar `g.reference.stopRefPreview = stopRefPreview` (función que pausa el `<audio>` de referencia).
3. **`36-base-canvas-widget.js`**: verificar si los pro-widgets lo usan. Si sí, portar a `src/features/pro/base-canvas-widget.ts`. Si no, ignorar.
4. **`00-compat.js`**: verificar si el browser check está cubierto. Si no, portar a `src/core/compat.ts`.

### Comandos
```bash
# 1. Verificar uso de BaseCanvasWidget
grep -rn "BaseCanvasWidget\|base-canvas-widget\|extends.*Canvas" /root/aporte/js/ /root/nuevito/frontend/src/ 2>/dev/null | head
# 2. Exponer visualizerRender
grep -n "drawWaterfallFrame" /root/nuevito/frontend/src/features/pro/premium-suite.ts | head
# 3. Editar premium-suite o crear visualizer-render.ts
write /root/nuevito/frontend/src/features/canvas/visualizer-render.ts  # si se extrae
edit /root/nuevito/frontend/src/features/pro/premium-suite.ts
  # agregar al final: window.LGMDM.visualizerRender = { drawWaterfallFrame };
# 4. Exponer stopRefPreview
edit /root/nuevito/frontend/src/features/library/reference-picker.ts
  # agregar: g.reference.stopRefPreview = stopRefPreview;
cd /root/nuevito/frontend && npx tsc --noEmit
```

### Verificación
```bash
# Diff completo de window.LGMDM.* leídos vs escritos
cd /root/nuevito/frontend
grep -rhoE "LGMDM\.[a-zA-Z]+\.[a-zA-Z]+" src/ | sed -E "s/^LGMDM\.//" | cut -d. -f1-2 | sort -u > /tmp/lg-read.txt
grep -rhoE "window\.LGMDM\.[a-zA-Z]+ =|LGMDM\.[a-zA-Z]+ =|g\.[a-zA-Z]+ =|g0\.[a-zA-Z]+ =" src/ | sed -E "s/.*\.LGMDM\.//; s/^g0?\.//; s/ =.*//" | sort -u > /tmp/lg-written.txt
comm -23 /tmp/lg-read.txt /tmp/lg-written.txt
# Resultado esperado: vacío o solo opcionales con fallback
```

---

## Fase G11 — Verificación end-to-end final

### Qué hacer
1. **Diff de endpoints frontend-vs-backend** (todos los que el TS llama vs todos los que el backend ofrece)
2. **Diff de IDs TS-vs-HTML** (todos los `getElementById`/`byId` del TS vs IDs del HTML)
3. **Diff de `window.LGMDM.*` escritos-vs-leídos** (0 huérfanos)
4. **Build completo** + type-check + SRI + CSP
5. **Reporte final** con cada endpoint verificado

### Comandos
```bash
cd /root/nuevito/frontend

# 1. Diff endpoints
echo "=== Endpoints que el TS llama ==="
grep -rhoE "['\"\`]/[a-z][a-z0-9/_-]*['\"\`]" src/ | grep -E "^['\"\`]/(auth|master|analysis|ai|mix|stems|job|jobs|download|report|preview|library|reference-library|projects|dashboard|resonance|inflator|phantom|iso|match|cross|loudness|phase|spectral|dr-|pitch|source|progress|meters|ws/)" | tr -d "'\"\`" | sort -u > /tmp/fe-eps.txt
echo "=== Endpoints que el backend ofrece ==="
grep -rhoE "@router\.(get|post|put|delete|websocket)\(['\"][^'\"]+['\"]" /root/nuevito/backend/routers/ /root/nuevito/backend/*.py | sed -E "s/.*\(['\"]//; s/['\"]$//" | sort -u > /tmp/be-eps.txt
echo "=== Endpoints del TS NO en el backend (deben ser 0) ==="
comm -23 /tmp/fe-eps.txt /tmp/be-eps.txt

# 2. Diff IDs
grep -rhoE "getElementById\(['\"][^'\"]+['\"]|byId\(['\"][^'\"]+['\"]|requireById\(['\"][^'\"]+['\"]" src/ | sed -E "s/.*\(['\"]([^'\"]+)['\"].*/\1/" | sort -u > /tmp/ts-ids2.txt
grep -oE 'id="[^"]+"' index.html login.html | sed 's/id="//;s/"$//' | sort -u > /tmp/html-ids2.txt
echo "=== IDs del TS NO en HTML (deben ser solo los creados dinámicamente) ==="
comm -23 /tmp/ts-ids2.txt /tmp/html-ids2.txt

# 3. Diff window.LGMDM.*
grep -rhoE "LGMDM\.[a-zA-Z]+\.[a-zA-Z]+" src/ | sed -E "s/^LGMDM\.//" | cut -d. -f1-2 | sort -u > /tmp/lg-read2.txt
grep -rhoE "window\.LGMDM\.[a-zA-Z]+ =|LGMDM\.[a-zA-Z]+ =|g0?\.[a-zA-Z]+ =|g\.proFeatures\.[a-zA-Z]+ =" src/ | sed -E "s/.*\.LGMDM\.//; s/^g0?\.//; s/^g\.proFeatures\.//; s/ =.*//" | sort -u > /tmp/lg-written2.txt
echo "=== LGMDM.* leídos NO escritos (deben ser 0 o solo opcionales) ==="
comm -23 /tmp/lg-read2.txt /tmp/lg-written2.txt

# 4. Build completo
npm run build
# Build = tsc && vite build && node scripts/sri.mjs && node scripts/csp.mjs
# Resultado esperado: 0 type errors, bundle generado, SRI + CSP aplicados

# 5. Verificar SRI + CSP en dist
grep -l "integrity=" dist/*.html
grep -l "Content-Security-Policy\|csp" dist/*.html || grep "script-src" dist/*.html | head
```

### Verificación visual (opcional, con dev server)
```bash
cd /root/nuevito/frontend && npm run dev
# Abrir browser, login, cargar archivo, verificar:
# - Sliders funcionan
# - EQ waveform dibuja
# - btnAnalyze → request a /analysis
# - btnMaster → request a /master
# - Pro widgets → 200 (no 404)
# - Mixer tab → UI completa
# - AI panel → chat
```

---

# Orden de ejecución

```
G1 (state)  →  G2 (file-handling)  →  G3 (sliders)  →  G4 (eq-waveform)
            →  G5 (mastering-actions)  →  G6 (fix /dsp/)
            →  G7 (preview + meters)  →  G8 (AI + lufs + pitch)
            →  G9 (mixer-ui)  →  G10 (bridges)  →  G11 (verificación final)
```

- **G1-G5**: flujo central (cargar → sliders → analizar → masterizar). Lo más urgente.
- **G6**: trivial (quitar prefijo). Se puede hacer en paralelo con G1-G5.
- **G7-G9**: funcionalidades grandes restantes.
- **G10-G11**: verificación.

---

# Archivos a crear (resumen)

| Fase | Archivo | Líneas aprox |
|---|---|---|
| G1 | `src/core/state.ts` (reescribir) | 280 |
| G2 | `src/features/workspace/file-handling.ts` | 360 |
| G3 | `src/features/workspace/sliders-ui.ts` + `src/data/sliders-meta.ts` | 220 + 400 |
| G4 | `src/features/canvas/eq-waveform.ts` | 520 |
| G5 | `src/features/workspace/mastering-actions.ts` | 560 |
| G7 | `src/features/audio/preview-controller.ts` | 520 |
| G7 | `src/features/workspace/meters-dashboard.ts` | 900 |
| G8 | `src/features/ai/assistant.ts` | 440 |
| G8 | `src/features/workspace/lufs-normalize.ts` | 80 |
| G8 | `src/features/workspace/pitch-correction.ts` | 340 |
| G9 | `src/features/audio/mixer-ui.ts` | 1700 |
| G10 | `src/features/canvas/visualizer-render.ts` (si se extrae) | 100 |

**Total nuevo:** ~5800 líneas de TS fieles al aporte.

---

# Archivos a modificar (resumen)

| Fase | Archivo | Cambio |
|---|---|---|
| G2, G3, G4, G5, G7, G8, G9 | `src/entrypoints/index.ts` | agregar imports |
| G5 | `src/features/canvas/master-console.ts` | reemplazar setStatus-only handlers |
| G6 | 16 archivos en `src/features/pro/` | quitar `/dsp/` prefijo |
| G10 | `src/features/pro/premium-suite.ts` | exponer `visualizerRender` |
| G10 | `src/features/library/reference-picker.ts` | exponer `stopRefPreview` |

---

# Criterios de "done" por fase (no se avanza sin cumplir)

1. ✅ `npx tsc --noEmit` pasa (0 type errors)
2. ✅ Diff de la fase pasa (endpoints / IDs / LGMDM.* según corresponda)
3. ⛔ **NO CUMPLIDO.** Auditoría 26-sep-2026: 256+ líneas muertas en `premium-suite.ts` (`renderMatchEqTab` 126 líneas, `renderWarmerTab` 112, `_fetchDspJson` 18 — grep con 1 hit = la definición), 16 module-locals muertos en `state.ts` silenciados con `void x;`, `api.client` con 0 consumidores, `master-console.ts:16` `const $` con 0 call sites, `master-visual-suite.ts:9` `AnyEl` con 0 referencias, 4/14 flags HMR write-only (`mixerUIBound`, `masteringActionsBound`, `proInsertRackBound`, `referenceMasteringBound`) — el guard que el header promete no existe.
4. ✅ No hay parches temporales (TODO/FIXME/stub)
5. ✅ El archivo porta el aporte completo, no un subset

Si una fase no cumple todos los criterios, se reporta y se corrige antes de avanzar.

---

# Lo que NO se hace

- No se toca el backend (`/root/nuevito/backend/` READ-ONLY).
- No se parchea sobre lo roto: se porta el aporte completo.
- No se declaran fases "done" sin el diff de verificación.
- No se mezclan fases.
- No se reintroduce demo/offline mode.
- No se reintroduce prefijo `/dsp/`.

---

# Fallas identificadas y cosas que el plan no cubre

## A. Fallas en mi trabajo previo (lo que hice mal)

1. **Declaré "listo para producción" sin verificar endpoints** contra el backend real.
2. **Inventé el prefijo `/dsp/`** sin chequear `backend/app.py` ni `backend/routers/advanced_dsp.py`.
3. **No porté `01-state.js`** — el state central. Todo `window.LGMDM.state.*` lee undefined.
4. **No porté `04-file-handling.js`** — `fileInput.change` no guarda el archivo.
5. **`btnAnalyze`/`btnMasterSync`/`btnMasterAsync`/`btnPitchCorrection` solo hacen `setStatus`** — no disparan requests.
6. **No porté el sistema de sliders** (`02-sliders-ui.js`) — los 157 sliders del HTML no funcionan.
7. **No verifiqué visualmente en browser** — solo type-check + build. Los canvas pueden no dibujar.

## B. Cosas que el plan actual NO cubre y debería

### IDs HTML faltantes (verificado)
- **`mixerPanel`**, **`mixerLibrary`**, **`metersDashboard`** — no existen en `index.html`. Hay que agregarlos o crearlos dinámicamente.
- Cada nuevo módulo debe listar los IDs que necesita y verificar que existen.

### CSS faltante
- Los nuevos widgets (sliders, eq-waveform, mixer UI, dashboard, AI panel) probablemente necesitan CSS. El plan no incluye agregar CSS ni verificar que los existentes alcancen.

### Orden de imports en entrypoint (no especificado)
- `core/state.ts` debe cargarse **antes** de `file-handling.ts` (state es dependencia).
- `sliders-ui.ts` debe cargarse **antes** de `mastering-actions.ts` (sliders alimentan params).
- `mastering-actions.ts` antes de `preview-controller.ts` (comparten AbortController pool).
- `visualizer-render.ts` antes de `master-console.ts` (master-console lo lee).
- Plan debería especificar el orden exacto de imports en `entrypoints/index.ts`.

### HMR idempotency + teardown (no mencionado)
- Cada nuevo módulo debe:
  - Usar `window.LGMDM.*Bound` flag para no re-bindear en HMR.
  - Tener `AbortController` único, pasar `{ signal }` a todos los `addEventListener`.
  - `abort()` en teardown + `beforeunload`.
  - Limpiar RAFs, intervals, object URLs.

### M9 (JWT sessionStorage) — riesgo aceptado
- No está documentado en el plan. Debería incluirse en G10 como "aceptado, requiere backend changes (READ-ONLY), no fixear en frontend, mantener documentado".

### `00-compat.js` (browser check) — no cubierto
- No hay browser compat check en el TS. Decidir: ¿portar o documentar como "no necesario en este entorno"?

### G9 (mixer-ui, 1700 líneas) — demasiado grande
- Dividir en:
  - **G9a** — UI shell + render de canales (lectura de state, lista de stems)
  - **G9b** — Faders + EQ por canal + mute/solo
  - **G9c** — Drag&drop + librería de stems (`/mix/stem-library`)

### Verificación visual en browser
- El plan solo verifica código (type-check, diffs). Pero la app es visual (canvas) y audio. Sin browser test, no sé si:
  - Los canvas dibujan
  - El audio suena
  - Los sliders actualizan la EQ
  - El waterfall renderiza a 60fps
- Agregar una **Fase G11b** (o integrada en G11): dev server + browser test manual de cada feature.

### Backend corriendo para testing
- El plan asume backend disponible. ¿Cómo se inicia? Verificar `backend/app.py` y si hay un script de start.

### `sliders-meta` — fuente específica
- Verificado: `upstream-frontend/dist/index.html` SÍ tiene 1 ocurrencia de `sliders-meta`. Se puede extraer. Plan debería decir "extraer de `upstream-frontend/dist/index.html`".

### Error handling consistente
- Cada nuevo módulo debe usar `core/ui.ts` (`showToast`, `showStatus`) — no `console.error` directo.

### Accesibilidad (a11y)
- ARIA labels, keyboard navigation, focus management en nuevos widgets. El plan no lo menciona.

### Performance budget
- Bundle size (actual 401K, 111K gzip), canvas FPS objetivo, memory leaks. El plan no incluye métricas de aceptación.

### API.md desactualizado
- `/root/nuevito/frontend/API.md` no menciona los nuevos endpoints que vamos a usar (mastering actions, AI, preview, etc.). Hay que actualizarlo al final.

### Cleanup de archivos muertos
- Si al portar encontrás que algunos archivos TS ya no se usan (reemplazados por el nuevo módulo), borrarlos. El plan no lo incluye.

### Riesgos del aporte (READ-ONLY experimental)
- El aporte puede tener bugs. Si encontrás un bug en el aporte al portarlo, reportar antes de portarlo ciegamente.

### CSP/SRI para nuevos widgets
- Los nuevos archivos pueden tener inline scripts/styles que rompan CSP. Plan debería verificar post-build en cada fase, no solo al final.

### G6 paralelo — coordinación
- El plan dice "se puede hacer en paralelo con G1-G5" pero no especifica cómo. Si G6 se hace primero (trivial), no bloquea nada.

### Endpoints que podrían no existir en backend
- ¿Qué hago si encontrás que un endpoint del aporte no existe en el backend? Plan debería decir: "reportar, no inventar otro path, esperar decisión".
