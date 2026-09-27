# Auditoría: HTML legacy muerto (V2 → V3)

Estado al 2026-09-26. Verificado con `grep` en port (`/root/nuevito/frontend/`)
y en vanilla (`/var/www/masteringaudio/`).

## 1. `toggleRefLibraryList` + `libraryListRef` — botón y div muertos

### Verificación (comandos ejecutados)

```
$ grep -rnE "toggleRefLibraryList" src/
(vacío = no handler TS)

$ grep -rnE "libraryListRef" src/
(vacío = no se popula)

$ grep -rnE "toggleRefLibraryList|libraryListRef" /var/www/masteringaudio/
/var/www/masteringaudio/index.html:216:<button class="link-inline" id="toggleRefLibraryList" type="button">
/var/www/masteringaudio/index.html:220:<div class="ref-library-list hidden-panel" id="libraryListRef"></div>
/var/www/masteringaudio/js/04-file-handling.js:336:      // dependía de #toggleRefLibraryList/#libraryListRef.
```

### Comentario del vanilla original (`04-file-handling.js:336`)

> "La selección de referencias persistentes en V3 está centralizada en
> `reference-library-picker.js`; no mantener aquí el handler legacy que
> dependía de `#toggleRefLibraryList`/`#libraryListRef`."

### Conclusión

El botón `toggleRefLibraryList` (index.html:212 del port) y el div
`libraryListRef` (index.html:220 del port) son **vestigios HTML de V2**.
La feature se mudó a `reference-library-picker.js` en V3 (vanilla) y no se
portó al TS (no hay handler, no se popula, no hay `reference-library-picker`
en el port).

### Decisión

- **NO** se agrega `aria-expanded` al botón. Eso mentiría: diría "colapsado"
  pero no hay nada que colapsar (regla 10 AGENTS.md).
- **NO** se borra el botón/div (decisión del usuario 2026-09-26: dejar
  documentado, no tocar).
- El botón queda como **dead HTML** — viola regla 7 (cero perks) pero
  explícitamente aceptado por el usuario como deuda documentada.

### Marcado en HTML (no se hizo para no tocar el archivo sin OKI)

Si en el futuro se quiere marcar sin borrar, las opciones son:
1. `aria-hidden="true"` + atributo `hidden` — lo saca del a11y tree.
2. Borrar el botón + el div — limpieza honesta.
3. Comentario HTML `<!-- legacy V2 muerto, ver AUDITORIA-legacy-muerto.md -->`.

## 2. Endpoints backend sin consumidor en el port (NO VERIFICADO en backend)

Verificado solo en frontend:

```
$ grep -rnE "preview/progress" src/
(vacío = no consumidor FE)

$ grep -rnE "'/analyze'|'/mix-advice'|'/spectrum'" src/
(vacío = no callers TS)
```

No es bug: son endpoints del backend sin consumidor TS. El backend es
READ-ONLY (regla 3 AGENTS.md). No se audita el backend acá.

## 3. CSS declarados dos veces (HTML link + TS import)

```
$ grep -cE 'href="css/' index.html
26
$ grep -cE "import.*css" src/entrypoints/index.ts
27
```

Vite deduplica en dist. El source es frágil (25+ CSS cargados dos veces
en source, una en dist). Refactor grande pendiente: quitar los `<link>`
del HTML y dejar solo los imports del TS. NO fixeado.

## 4. nanoid en lock pero no en package.json

```
$ grep -nE "nanoid" package.json
(vacío)
$ grep -nE "nanoid" package-lock.json
11:        "nanoid": "^3.2.0"
431:    "node_modules/nanoid": {
```

Dependencia transitiva de Vite. No se puede quitar del lock sin
`npm install` (regeneraría el lock). No rompe nada. NO fixeado.
