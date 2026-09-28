# LGMDM Frontend Audio Audit — Feature Track

> **Feature ID:** `lgmdm-frontend-audio-audit`
> **Scope:** Frontend TypeScript only (`frontend/src/**`, `frontend/tsconfig.json`).
> Backend (`.py`) findings are excluded — they belong to a separate track.
> **Track format:** `feature-tracking` skill (project-management category).
> Per skill convention this would live at `docs/features/<feature-id>/README.md`;
> this single-file track was placed at the repo root per the spawning task,
> applying the skill's content structure (Status / Source of Truth / Behavior /
> Decisions / Risks / Changelog). Link first, migrate later.

---

## Current Status

**Audit complete → fixes applied → re-pass complete → reconciled with working tree (2026-09-28) → re-pass frontend (5 skills) in progress.**

Two-round audio-skills audit (ronda 1 + re-pass) of the LGMDM codebase was
performed 2026-09-27 by 6 + 3 = 9 sub-agents with distinct audio skills. This
track captures **only the frontend (TypeScript) findings** — 16 total across
the two rounds, plus the re-pass frontend (5 skills) findings now in progress.

- **Ronda 1** (`AUDITORIA-AUDIO-SKILLS.md`): 6 agents, 13 frontend findings
  (webaudio-review ×6, audio-signal-flow-explainer ×1, audio-dsp-review ×1
  overlap, typescript-pro ×5).
- **Re-pass** (`AUDITORIA-AUDIO-SKILLS-REPASS.md`): 3 agents, 3 NEW frontend
  findings (all from the new `web-audio-api` skill — W1/W2/W3).
- **Re-pass frontend (5 skills)** (2026-09-28, in progress): web-audio-api
  (V1 `window.LGMDM.audio` wiring CRITICAL + W1–W6), websocket-engineer
  (WS1–WS9), webapp-testing (WT1–WT3), typescript-pro (TP1–TP5), plus backend
  TODOs T1–T5. Agents A/B/C running in parallel — findings are
  **PENDIENTE DE APLICACIÓN**, not "applied", until re-verified after close.
- **Reconciliation (2026-09-28, categoría D):** re-grepped every fix the
  audit marked APPLIED/DEFERRED against the current working tree. Backend
  re-pass fixes (Bug A reverb crash, Bug B `_lr4`, Bug C spectral_tilt, U-4,
  U-7, U-8, transient_shaper soft-knee, LUFS architectural, re-pass #4/#5)
  and frontend W1/W2/F14/F15 are all **✅ VERIFICADO applied** in the working
  tree — several of these the audit doc previously marked "NO APLICADO" or
  "TODO"; the doc has been updated to reflect the working-tree truth.
- **Backend findings**: excluded from this track (separate track pending).

**Fix disposition (frontend findings only):**

| Category | Count | Notes |
|---|---|---|
| Fully applied (ronda 1) | 8 | F1–F8 (allocs hoisted, dead state removed, mono splitter) |
| Fully applied (post-re-pass, in working tree) | 2 | F14 (W1 controls), F15 (W2 matchMedia) — ✅ VERIFICADO applied 2026-09-28 |
| Partially applied | 5 | F9–F13 (tsconfig flags, `any`, `!.`, `satisfies`, branded types) — TP1–TP5 in progress (Agent C) |
| Deferred (TODO documented) | 1 | F16 (W3 buffer pool — defer until profiling) |
| In progress (re-pass frontend, 5 skills) | — | V1 (CRITICAL), W1–W6, WS1–WS9, WT1–WT3, TP1–TP5 — PENDIENTE DE APLICACIÓN |
| **Total frontend findings (closed)** | **16** | + re-pass frontend (5 skills) open |

---

## Source of Truth

These two audit files are the authoritative record. This track summarizes
them; it does not replace them.

- **Ronda 1 audit:** `AUDITORIA-AUDIO-SKILLS.md` (2026-09-27, 6 agents)
  - §Reporte 3 — webaudio-review (frontend warnings F1–F6)
  - §Reporte 4 — audio-signal-flow-explainer (frontend signal-flow, F7 + frontend sinks)
  - §Reporte 1 — audio-dsp-review (frontend warning F8, overlap with F2/F3)
  - §Reporte 6 — typescript-pro (frontend warnings F9–F13)
  - §Fixes consolidados por prioridad (#14, #15, #16, #17, #25, #26, #27, #28, #35, #36 are the frontend rows)
- **Re-pass audit:** `AUDITORIA-AUDIO-SKILLS-REPASS.md` (2026-09-27, 3 agents)
  - §Reporte 3 — web-audio-api (NEW skill, frontend warnings F14–F16 / W1–W3)
  - §Estado de los fixes anteriores — confirms ronda-1 frontend fixes applied
  - §Fixes consolidados RE-PASS — rows #10 (W1), #11 (W2), #14 (W3) are frontend

**Project rules:** `AGENTS.md` (verificar antes de afirmar, distinguir
VERIFICADO/ASUMIDO/NO VERIFICADO, OKI literal para escritura, frontend OKI
salvo `AUDITORIA-*.md`/`*.md` docs).

---

## Current Behavior

What the frontend audio stack does now, post-fixes (verified in code unless
marked ASUMIDO):

- **Single shared lazy `AudioContext`** with `latencyHint: 'interactive'`
  (`audio-engine.ts:12-20`), shutdown on `beforeunload` (`audio-engine.ts:41-47`).
- **No `AudioWorkletProcessor`, no `ScriptProcessorNode`, no `addModule()`,
  no `SharedArrayBuffer`/`Atomics`** in `frontend/src/` (VERIFICADO, grep 0
  matches — ronda 1 + re-pass). All DSP runs on the backend; frontend is
  main-thread visualization + playback only.
- **Visualization tap** (`audio-tap.ts`) is purely measurement: 1
  `ChannelSplitter` → 7 `Analyser`s + 3 band-filter pairs, created once.
- **Mono sources upmixed** explicitly: `source.channelCount = 2;
  source.channelCountMode = 'explicit'` before the splitter
  (`audio-tap.ts:154-155`, VERIFICADO) — fixes the false "hard-left"
  goniometer image that ronda 1 flagged at `audio-tap.ts:149`.
- **Per-frame allocations removed from rAF hot paths:**
  - `master-visual-suite.ts:741-743` — ring buffer of 30 pre-allocated
    `Float32Array(WATERFALL_BINS)` slots; `freqData` length-guarded reuse
    (`:820`).
  - `master-console.ts:283` (`_eqFilters` module-scope), `:292` (`state.dbOut`
    length-guarded), `:395` (`state.eqFreqs` length-guarded).
  - `premium-suite.ts:119-125` — goniometer particle pool (240 slots, reused
    via `active` flag, `:201-209,223-229`).
  - `master-visual-suite.ts:1141-1150,1299-1301` — `drawEqCurve` `_eqNodes`
    module-scope.
- **Dead `meters*` AudioContext/AnalyserNode state removed** from
  `state.ts` (only a comment at `:126` remains: "U-4: the meters* closure
  vars that lived here…").
- **`/ws/ref-stream` PCM decode** uses `new Int16Array(pcmBytes)`
  (`reference-mastering.ts:462`, VERIFICADO) — matches the backend
  `pcm_format="int16"` fix (C2 in backend track). The frontend decoder was
  already `Int16Array`; the fix was backend-side.
- **Type safety baseline:** `tsc --noEmit` exit 0, 0 errors (ronda 1
  verification; re-pass confirms). `@ts-nocheck`: 0 files / 0 lines (matches
  AGENTS.md §2).
- **Server-preview `<audio>` exposes native controls**
  (`mixer-engine.ts:443`, `audioEl.controls = true`, VERIFICADO) — post-re-pass
  W1 fix; lets the user manually play if WS round-trip outlasts the
  browser's gesture-activation window.
- **Reduced-motion RAF restart** via `matchMedia` change listener
  (`master-console.ts:683-686`, VERIFICADO) — post-re-pass W2 fix.
- **Strict TS flags partially enabled** (`tsconfig.json:16-18`):
  `isolatedModules`, `noImplicitOverride`, `exactOptionalPropertyTypes`.
  `noUncheckedIndexedAccess` deferred — TODO at `tsconfig.json:19` (188
  errors, above the 30-error threshold).

---

## Decisions

Durable decisions recorded by the audit (frontend-relevant only). Each is
linked to its source-of-truth section.

1. **F8 marked as a duplicate perspective, not a separate finding.**
   `audio-dsp-review` flagged `master-visual-suite.ts:798,805` per-frame
   allocs; `webaudio-review` flagged the same lines (F2/F3). They were
   fixed once via the ring-buffer + length-guard pattern. (Ronda 1, §Reporte
   1 vs §Reporte 3.)
2. **F9 strict flags: 3 of 4 enabled, `noUncheckedIndexedAccess` deferred.**
   The 4th flag produces 188 errors, above the agreed 30-error threshold. A
   `TODO(U-1)` comment is left in `tsconfig.json:19`. The deferral is
   documented, not silent. (Re-pass, §typescript-pro.)
3. **F10 `any` migration is gradual, file-by-file, not pragma-based.** The
   audit explicitly rejected re-introducing `@ts-nocheck` (AGENTS.md §2) in
   favor of the `window as Window & { LGMDM?: LocalSlice }` pattern already
   used by `saturation.ts`/`loudness-penalty.ts`. `mixer-engine.ts` was
   fully typed as the proof-of-concept (`lgmdm(): LgmdmMixer`); the other 5
   files (master-console, visualizer-helpers, reference-mastering,
   params-builder, premium-suite) remain TODO. (Ronda 1, §typescript-pro W2.)
4. **F11 non-null assertions: 23 removed, 586 remain.** The audit did not
   mandate eliminating all 609 `!.`; it prioritized `reference-mastering.ts`
   (17 → 0 real), `timeline-meters.ts` (2), `assistant.ts` (4). Further
   reduction is opportunistic. (Re-pass, §typescript-pro.)
5. **F12 `satisfies`: 1 use added as proof, not a sweep.** `sliders-meta.ts`
   now uses `satisfies readonly SliderMetaEntry[]` (VERIFICADO at `:134`,
   audit said `:7` — line-number drift only). The audit labeled this
   "optional modernization, no correctness issue". (Ronda 1, §typescript-pro W4.)
6. **F13 branded types: `JobId` only.** `state.ts:22` defines
   `type JobId = string & { readonly __brand: 'JobId' }` and
   `reference-mastering.ts` casts `data.job_id as JobId` at the API boundary.
   `LibraryId`/`SessionId` were explicitly out of scope (comment at
   `state.ts:20-21`). (Ronda 1, §typescript-pro W5.)
7. **F14/F15 (re-pass W1/W2) applied post-audit in the working tree.** The
   re-pass audit listed these as NEW recommended fixes. Current working-tree
   code shows them applied with explicit `// W1 fix (web-audio-api re-pass)`
   and `// W2 fix (web-audio-api re-pass)` comments. **Reconciliation (2026-09-28, categoría D): RESOLVED** —
   the audit document has been updated to mark W1/W2 ✅ VERIFICADO applied, and
   R-RECONCILE is closed. The fixes remain uncommitted (`git status` shows
   `frontend/src/features/audio/mixer-engine.ts` and
   `frontend/src/features/canvas/master-console.ts` as modified); see
   R-UNCOMMITTED.
8. **F16 (re-pass W3) deferred until profiling.** Per-chunk `AudioBuffer`
   alloc in `reference-mastering.ts:462-472` is acceptable because `onended`
   prevents leaks. The audit explicitly said: "Fix: pool si profiling muestra
   churn." No profiling has been run (NO VERIFICADO).

---

## Known Risks

### R-RECONCILE — Audit ↔ working-tree reconciliation (RESOLVED 2026-09-28)
The re-pass audit (`AUDITORIA-AUDIO-SKILLS-REPASS.md`) listed W1 and W2 as
recommended-but-not-applied. Current working-tree code showed them applied
with comments referencing the re-pass. The audit document **has now been
updated** (categoría D, 2026-09-28): every fix marked APPLIED/DEFERRED was
re-grepped against the working tree, and the audit's "Estado de los fixes
anteriores" / "Fixes consolidados RE-PASS" / "Estado final consolidado"
tables now reflect the verified working-tree state (✅ VERIFICADO aplicado
for Bug A/B/C, U-4, U-7, U-8, transient_shaper, LUFS architectural, re-pass
#4/#5, W1, W2; ⚠️ NO verificado for #6/#7/#8/#9/#12/#13 which were not in
the grep list). **Risk closed.** A future agent reading the audit will see
the correct status. (Note: the working-tree changes are still uncommitted —
see R-UNCOMMITTED.)

### R-V1-WIRING — `window.LGMDM.audio` wiring missing (HIGH, NEW 2026-09-28)
Found by the `web-audio-api` agent in the re-pass frontend (5 skills) round.
The `window.LGMDM.audio` wiring is missing, breaking 3 features that expect
to resolve the shared AudioContext via `LGMDM.audio`. **Status:**
PENDIENTE DE APLICACIÓN (Agent A en progreso). **Risk:** 3 frontend audio
features are non-functional until wired. **Mitigation:** Agent A exposes
`audioEngine`/AudioContext under `window.LGMDM.audio`. Not yet applied —
will be re-verified after Agent A closes.

### R-WS-HEARTBEAT — No WebSocket heartbeat (MEDIUM, NEW 2026-09-28)
Found by the `websocket-engineer` agent in the re-pass frontend (5 skills)
round. The `/ws/master-stream`, `/ws/ref-stream`, `/ws/mix-stream`
endpoints have no heartbeat/ping-pong, so a dead connection (network drop,
sleeping tab) is not detected promptly and the client may hang waiting for
chunks that never come. **Status:** PENDIENTE DE APLICACIÓN (Agent A en
progreso). **Risk:** stale WS sessions, false "still streaming" UI.
**Mitigation:** add server-side ping interval + client pong timeout
(Agent A). Not yet applied.

### R-WS-BACKPRESSURE — No WebSocket backpressure (MEDIUM, NEW 2026-09-28)
Found by the `websocket-engineer` agent in the re-pass frontend (5 skills)
round. The WS streaming endpoints push PCM chunks without checking
`websocket.buffered_amount` / send-rate vs client consume rate; a slow
client (or a tab throttled by the browser) can accumulate a growing
backlog, increasing latency and memory. **Status:** PENDIENTE DE
APLICACIÓN (Agent A en progreso). **Risk:** unbounded latency/memory growth
under slow consumers. **Mitigation:** throttle send rate on
`buffered_amount` threshold (Agent A). Not yet applied.

### R-UNCOMMITTED — All fixes are uncommitted (HIGH)
`git status --short` shows ~30 modified files (frontend + backend) with
the audit fixes applied in the working tree but not committed. The audit
files themselves are also uncommitted/new. **Risk:** work can be lost or
reverted; reviewers cannot see the diff. **Mitigation:** commit with OKI
per AGENTS.md §5 (frontend OKI; backend needs nominated exception). This
track is documentation (exempt per AGENTS.md §5).

### R-NOLOCK — `noUncheckedIndexedAccess` deferred (MEDIUM)
188 errors block enabling this flag. Array-indexed access in
`metrics-store.ts:64` (`(m.spectrum as number[])`) and `state.ts` indexed
accesses rely on the looser default. **Risk:** a typo like
`arr[i]` returning `undefined` at runtime compiles silently. **Mitigation:**
documented TODO at `tsconfig.json:19`; flag is enabled when the 188 errors
are addressed (separate workstream).

### R-ANY-LEGACY — 5 legacy files still `any`-heavy (MEDIUM)
`master-visual-suite.ts:28-29` uses `Record<string, any>` for `lgmdm()`.
`visualizer-helpers.ts` (~25 `as any` + ~20 `: any` params), `master-console.ts`
(25 `as any`), `reference-mastering.ts` (8), `params-builder.ts` (5),
`premium-suite.ts` (3 + ~18 `: any` params). The `Roots lgmdm(): any / lg(): any
TODO` (audit note) is a large cascade. **Risk:** type holes in the most
touched canvas/pro modules. **Mitigation:** gradual migration to
`window as Window & { LGMDM?: LocalSlice }` per decision #3; no pragma.

### R-NN-ASSERT — ~586 non-null assertions remain (LOW)
After the 23 targeted removals, ~586 `!.` remain. The audit did not mandate
elimination, but each `!.` defeats strict null checks at its call site.
**Risk:** runtime `null` throw where tsc accepted. **Mitigation:** prefer
`requireById` (`dom.ts:88`) or early-return guards for new code; legacy
left as-is.

### R-BRAND-ID — `LibraryId` / `SessionId` not branded (LOW)
Only `JobId` is branded. `libraryId`/`sessionId` remain plain `string` and
are interchangeable in the type system. **Risk:** typo mixing compiles.
**Mitigation:** optional per audit; not pursued.

### R-W3-POOL — Per-chunk `AudioBuffer` alloc not pooled (LOW)
`reference-mastering.ts:462-472` allocates one `AudioBuffer` per WS chunk.
`onended` prevents leaks but GC churn is unmeasured. **Risk:** dropped
frames under high chunk rate (ASUMIDO, not profiled). **Mitigation:** defer
until profiling shows churn (decision #8).

### R-NO-RUNTIME — No audio rendered by any agent (SHARED LIMITATION)
No agent in either round executed audio or measured wall-clock, level,
aliasing, or denormals. All frontend findings are static code inspection.
The `/ws/ref-stream` int16/float32 mismatch (C2, backend-side fix) is the
only finding that has an audible symptom (half-speed noise) — the frontend
decoder was already correct; the backend was changed to match. **Risk:**
some "fixes" may not address a real audible problem; some real problems may
not have been found. **Mitigation:** the audit's "Métricas de calidad que
SHOULD be tested" section lists the runtime tests that would verify each
finding.

---

## Changelog

### 2026-09-28 (categoría D — reconciliation + re-pass frontend 5 skills)
- Re-grepped every fix the audit marked APPLIED/DEFERRED against the
  current working tree (14 greps + code-body reads). Result: the working
  tree is significantly more advanced than the doc claimed.
- Updated `AUDITORIA-AUDIO-SKILLS-REPASS.md` to reflect verified
  working-tree state:
  - Bug A reverb crash — ✅ VERIFICADO aplicado (`reverb.py:122`)
  - Bug B `_lr4` -6dB dip — ✅ VERIFICADO aplicado (`mastering.py:1385-1386`
    single `sosfiltfilt`, was "NO APLICADO" in doc)
  - Bug C spectral_tilt highpass — ✅ VERIFICADO aplicado (`dsp_chain.py:83`
    `alpha_hp = rc/(rc+dt)`, was "NO APLICADO" in doc)
  - Re-pass #4 `/master` async ceiling_db — ✅ VERIFICADO aplicado
    (`routers/mastering.py:261-262`)
  - Re-pass #5 LUFS bake + soft-knee all formats — ✅ VERIFICADO aplicado
    (`routers/streaming.py:390-403,461-464`); new issue #2 RESUELTO
  - U-4 phase_rotation, U-7 reverb_simple fade, U-8 phantom_sub phase —
    ✅ VERIFICADO aplicados (were "TODO" in doc)
  - transient_shaper soft-knee — ✅ VERIFICADO aplicado (`mastering.py:2334-2337`)
  - Reverb #3/#4 no longer MOOT (Bug A fixed → they execute)
  - W1/W2 frontend — ✅ VERIFICADO aplicados (were "recommended" in doc)
  - Fixes #6/#7/#8/#9/#12/#13 — ⚠️ NO verificados (not in grep list)
- Added new "Re-pass frontend (5 skills)" section to
  `AUDITORIA-AUDIO-SKILLS-REPASS.md` documenting V1 (CRITICAL), W1–W6,
  WS1–WS9, WT1–WT3, TP1–TP5, T1–T5 — all PENDIENTE DE APLICACIÓN (Agents
  A/B/C en progreso).
- Updated this track: Current Status, Known Risks (R-RECONCILE → RESOLVED;
  added R-V1-WIRING, R-WS-HEARTBEAT, R-WS-BACKPRESSURE), Changelog.

### 2026-09-27 (ronda 1 + re-pass, audit write)
- Wrote `AUDITORIA-AUDIO-SKILLS.md` (6 agents, 9 critical bugs, ~30 fixes
  proposed). Frontend findings F1–F13 recorded.
- Wrote `AUDITORIA-AUDIO-SKILLS-REPASS.md` (3 agents, 3 new critical + 5
  new signal-flow issues). Frontend findings F14–F16 recorded.
- Applied ronda-1 frontend fixes F1–F8 (alloc hoists, dead state, mono
  splitter) — verified in working tree.
- Applied partial frontend fixes F9 (3/4 flags), F10 (mixer-engine fully
  typed), F11 (23 `!.` removed), F12 (1 `satisfies`), F13 (`JobId` branded).

### 2026-09-27 → 2026-09-28 (post-re-pass, working tree)
- Applied re-pass frontend fixes F14 (W1, `mixer-engine.ts:443`
  `audioEl.controls = true`) and F15 (W2, `master-console.ts:683-686`
  matchMedia listener). Both uncommitted; comments cite the re-pass IDs.
- F16 (W3 buffer pool) left deferred per audit (decision #8).

### 2026-09-28 (this track)
- Created `FRONTEND-AUDIO-TRACK.md` summarizing the 16 frontend findings,
  fix disposition, decisions, and risks. Filtered backend findings out
  (separate track pending). Verified applied fixes via grep against
  current working-tree code (see Verification Log).

---

## Frontend Findings — Detail Index

Cross-reference to the source-of-truth audit sections. `file:line` are
as cited in the audit; current code line numbers may have drifted (verified
locations noted where checked).

### Ronda 1 — `AUDITORIA-AUDIO-SKILLS.md`

| ID | Skill | File:line (audit) | Finding | Status |
|----|-------|------------------|---------|--------|
| F1 | webaudio-review CC-1 | `master-console.ts:280,330,381` | Per-frame `Float32Array`/`filters` allocs in rAF EQ response | ✅ applied — `state.dbOut`/`eqFreqs` length-guarded, `_eqFilters` module-scope (`master-console.ts:283,292,395`) |
| F2 | webaudio-review CC-2 | `master-visual-suite.ts:805` | Per-frame `Uint8Array` in waterfall | ✅ applied — length-guarded reuse (`master-visual-suite.ts:820`) |
| F3 | webaudio-review CC-3 | `master-visual-suite.ts:798` | Rolling-history `Float32Array` in waterfall | ✅ applied — ring buffer 30 slots (`master-visual-suite.ts:736-743`) |
| F4 | webaudio-review CC-4 | `premium-suite.ts:180-188,1023` | Per-frame object alloc + DOM re-parse in stereo scope | ✅ applied — particle pool 240 w/ `active` flag, innerHTML cache (`premium-suite.ts:22,119-125,201-229`) |
| F5 | webaudio-review CC-5 | `master-visual-suite.ts:1203,1220,1264` | `drawEqCurve` per-frame allocs | ✅ applied — `_eqNodes` module-scope (`master-visual-suite.ts:1141-1150,1299-1301`) |
| F6 | webaudio-review CC-6 | `state.ts:126-132` | Dead `metersAudioCtx`/`metersSourceNode`/etc. state | ✅ applied — only a comment remains (`state.ts:126`) |
| F7 | signal-flow W4 | `audio-tap.ts:149` | Mono `ChannelSplitter(2)` hardcoded → false "hard-left" goniometer | ✅ applied — `source.channelCount = 2; channelCountMode = 'explicit'` before splitter (`audio-tap.ts:154-155`) |
| F8 | audio-dsp-review | `master-visual-suite.ts:798,805` | Per-frame `Float32Array`/`Uint8Array` in rAF (overlap with F2/F3) | ✅ applied (same fix as F2/F3) |
| F9 | typescript-pro W1 | `tsconfig.json:2-20` | 4 missing strict flags | ⚠️ partial — 3/4 enabled (`isolatedModules`, `noImplicitOverride`, `exactOptionalPropertyTypes` at `tsconfig.json:16-18`); `noUncheckedIndexedAccess` deferred w/ TODO (`tsconfig.json:19`, 188 errors) |
| F10 | typescript-pro W2 | 6 legacy `any`-heavy files (master-console, visualizer-helpers, reference-mastering, params-builder, premium-suite, mixer-engine) | 121 `any`, 67 `as any` | ⚠️ partial — `mixer-engine.ts` fully typed `lgmdm(): LgmdmMixer` (`mixer-engine.ts:557`); 5 files + roots `lgmdm(): any` TODO remain |
| F11 | typescript-pro W3 | `reference-mastering.ts` (17), `timeline-meters.ts:286-287`, `assistant.ts:428-429` | 609 non-null `!.` assertions | ⚠️ partial — 23 removed (reference-mastering 17, timeline-meters 2, assistant 4); ~586 remain |
| F12 | typescript-pro W4 | `sliders-meta.ts:7` + `Object.freeze` namespaces | 0 `satisfies` uses | ⚠️ partial — 1 use added (`sliders-meta.ts:134` `satisfies readonly SliderMetaEntry[]`); audit cited `:7`, current code at `:134` (line drift) |
| F13 | typescript-pro W5 | `state.ts:115`, `api.ts` | No branded types for domain IDs | ⚠️ partial — `JobId` branded (`state.ts:22`, used in `reference-mastering.ts:1,59,260`); `LibraryId`/`SessionId` not done (out of scope per `state.ts:20-21`) |

### Re-pass — `AUDITORIA-AUDIO-SKILLS-REPASS.md`

| ID | Skill | File:line (audit) | Finding | Status |
|----|-------|------------------|---------|--------|
| F14 | web-audio-api W1 | `mixer-engine.ts:439` | Server-preview `<audio>` auto-play can be blocked by WS round-trip outlasting gesture window | ✅ applied post-audit + ✅ VERIFICADO applied 2026-09-28 — `audioEl.controls = true` (`mixer-engine.ts:443`), comment cites "W1 fix (web-audio-api re-pass)"; uncommitted (R-RECONCILE RESOLVED) |
| F15 | web-audio-api W2 | `master-console.ts:662-665` | Reduced-motion RAF stop one-way (no matchMedia listener to restart) | ✅ applied post-audit + ✅ VERIFICADO applied 2026-09-28 — `_mqReduced.addEventListener('change', …)` (`master-console.ts:683-686`), comment cites "W2 fix (web-audio-api re-pass)"; uncommitted (R-RECONCILE RESOLVED) |
| F16 | web-audio-api W3 | `reference-mastering.ts:462-472` | Per-chunk `AudioBuffer` alloc (acceptable w/ `onended`, but GC churn unmeasured) | ⏸ deferred — "pool si profiling muestra churn" (decision #8); not profiled |

---

## Verification Log

Per AGENTS.md §1: "verificado" requires showing the command and its output.
The grep checks below were run against the current working tree to confirm
the applied-fix claims above. Anything not checked here is ASUMIDO from the
audit text, not independently verified by this track author.

### Ronda-1 applied fixes (F1–F8)

```
$ grep -n "channelCount|channelCountMode" frontend/src/core/audio-tap.ts
  Line 151:   // "hard-left" falsa. Web Audio upmixea mono->stereo con channelCount=2 +
  Line 152:   // channelCountMode='explicit'.
  Line 154:     source.channelCount = 2;
  Line 155:     source.channelCountMode = 'explicit';
→ F7 applied (mono splitter upmix)

$ grep -n "dbOut|eqFreqs|_eqFilters" frontend/src/features/canvas/master-console.ts
  Line 283:   const _eqFilters: Array<{ kind: string; freq: number; gain: number; Q: number }> = [];
  Line 292:     if (!state.dbOut || state.dbOut.length !== N) state.dbOut = new Float32Array(N);
  Line 395:     if (!state.eqFreqs || state.eqFreqs.length !== N) state.eqFreqs = new Float32Array(N);
  Line 750:     state.dbOut = null; state.eqFreqs = null; _eqFilters.length = 0;
→ F1 applied (master-console EQ allocs hoisted)

$ grep -n "ring|WATERFALL_BINS|waterfallRing|frequencyBinCount" \
    frontend/src/features/canvas/master-visual-suite.ts
  Line 736:   // CC-1: ring buffer of pre-allocated slices replaces the unshift/pop rolling
  Line 741:   const WATERFALL_BINS = 64;
  Line 743:   for (let i = 0; i < WATERFALL_SLICES; i++) waterfallRing[i] = new Float32Array(WATERFALL_BINS);
  Line 820:           const binCount = analyser.frequencyBinCount;
  Line 869:     // CC-1: iterate the ring buffer from oldest (k=waterfallCount-1) to newest
→ F2, F3, F8 applied (waterfall ring buffer + length-guarded freqData)

$ grep -n "gonioParticles|particles|pool|active" \
    frontend/src/features/pro/premium-suite.ts
  Line 22:   type GonioParticle = { ...; active: boolean };
  Line 119:   // U-2: pre-allocated particle pool (240 slots, reused via `active` flag).
  Line 122:   const _gonioParticles: GonioParticle[] = (() => { ... push({ ..., active: false }) };
  Line 201:         // U-2: reuse a dead slot from the pool instead of allocating.
  Line 204:           if (!_gonioParticles[k].active) { slot = k; break; }
  Line 223:       const pt = _gonioParticles[i];
  Line 224:       if (!pt.active) continue;
  Line 229:       if (pt.life <= 0) { pt.active = false; continue; }
→ F4 applied (premium-suite particle pool 240 + active flag)

$ grep -n "drawEqCurve|curvePoints|bells|_eqNodes" \
    frontend/src/features/canvas/master-visual-suite.ts
  Line 1141:   // U-3: reusable arrays for drawEqCurve — zero per-call allocs on the
  Line 1150:   const _eqNodes = [ ... ];
  Line 1299:     _eqNodes[0].f = b1Freq; _eqNodes[0].g = b1Gain;
  Line 1300:     _eqNodes[1].f = b3Freq; _eqNodes[1].g = b3Gain;
  Line 1301:     _eqNodes[2].f = b6Freq; _eqNodes[2].g = b6Gain;
→ F5 applied (drawEqCurve allocs hoisted)

$ grep -n "metersAudioCtx|metersSourceNode|metersAnalyser" frontend/src/core/state.ts
  Line 126: // U-4: the meters* closure vars that lived here (metersAudioCtx/SourceNode/
→ F6 applied (only a comment remains; the declarations were removed)
```

### Re-pass applied fixes (F14, F15) — applied post-audit in working tree

```
$ grep -n "mxrServerPreviewAudio|controls" frontend/src/features/audio/mixer-engine.ts
  Line 433:       const audioEl = cachedEl<HTMLAudioElement>('mxrServerPreviewAudio');
  Line 441:         // Agregamos controls para que el usuario pueda hacer play manualmente
  Line 443:         audioEl.controls = true;
  Line 444:         void audioEl.play().catch(() => { /* ignore autoplay block — user can click controls */ });

$ git diff frontend/src/features/audio/mixer-engine.ts | grep -A2 -B2 "controls"
+        // W1 fix (web-audio-api re-pass): el WS round-trip puede outlast el
+        // gesture-activation window del browser, bloqueando el auto-play.
+        // Agregamos controls para que el usuario pueda hacer play manualmente
+        audioEl.controls = true;
+        void audioEl.play().catch(() => { /* ignore autoplay block — user can click controls */ });
→ F14 applied (uncommitted; comment cites the re-pass ID W1)

$ grep -n "matchMedia|prefers-reduced-motion|reducedMotion|_mqReduced" \
    frontend/src/features/canvas/master-console.ts
  Line 683:     // matchMedia listener para restart el RAF si el user togglea reduced-motion
  Line 686:     const _mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');

$ git diff frontend/src/features/canvas/master-console.ts | grep -A2 -B2 "matchMedia\|_mqReduced"
+    // W2 fix (web-audio-api re-pass): reduced-motion RAF stop era one-way.
+    // matchMedia listener para restart el RAF si el user togglea reduced-motion
+    const _mqReduced = window.matchMedia('(prefers-reduced-motion: reduce)');
+    if (_mqReduced.addEventListener) {
+      _mqReduced.addEventListener('change', (e) => { ... });
→ F15 applied (uncommitted; comment cites the re-pass ID W2)
```

### Partial fixes (F9–F13)

```
$ grep -n "noUncheckedIndexedAccess|noImplicitOverride|exactOptionalPropertyTypes|isolatedModules" \
    frontend/tsconfig.json
  Line 16:     "isolatedModules": true,
  Line 17:     "noImplicitOverride": true,
  Line 18:     "exactOptionalPropertyTypes": true,
  Line 19:     // TODO(U-1): `noUncheckedIndexedAccess` produce 188 errores al activarse
→ F9 partial (3/4 enabled; 4th deferred with TODO)

$ grep -n "lgmdm\(\):|LgmdmMixer|function lgmdm" frontend/src/features/audio/mixer-engine.ts
  Line 539: interface LgmdmMixer {
  Line 557:   function lgmdm(): LgmdmMixer {
  Line 558:   return ((window as unknown as Window & { LGMDM?: LgmdmMixer }).LGMDM || {}) as LgmdmMixer;
  Line 567: (window as unknown as { LGMDM?: LgmdmMixer }).LGMDM = g;
→ F10 partial (mixer-engine fully typed; 5 other files + roots TODO remain)

$ grep -n "JobId|__brand" frontend/src/core/state.ts
  Line 22: export type JobId = string & { readonly __brand: 'JobId' };
  Line 119: let currentJobId: JobId | null = null;

$ grep -n "JobId" frontend/src/features/mastering/reference-mastering.ts
  Line 1: import type { JobId } from '../../core/state';
  Line 59:   currentJobId?: JobId | null;
  Line 260:     st.currentJobId = data.job_id as JobId;
→ F13 partial (JobId branded and used at API boundary; LibraryId/SessionId not done)

$ grep -n "satisfies" frontend/src/data/sliders-meta.ts
  Line 134: ]) satisfies readonly SliderMetaEntry[];
→ F12 partial (1 use; audit cited :7, current line is :134 — line drift only)
```

### Git state (reconciliation context)

```
$ git status --short | head -30
  M backend/advanced_dsp.py
  M backend/dsp_chain.py
  M backend/mastering.py
  M backend/mixer.py
  M backend/reverb.py
  M backend/routers/advanced_dsp.py
  M backend/routers/analysis.py
  M backend/routers/mastering.py
  M backend/routers/streaming.py
  M backend/stem_analysis.py
  M backend/stem_separation.py
  M backend/streaming_engine.py
  M frontend/package-lock.json
  M frontend/src/core/api.ts
  M frontend/src/core/audio-tap.ts
  M frontend/src/core/config.ts
  M frontend/src/core/metrics-store.ts
  M frontend/src/core/state.ts
  M frontend/src/data/sliders-meta.ts
  M frontend/src/features/ai/assistant.ts
  M frontend/src/features/audio/mixer-engine.ts
  M frontend/src/features/audio/mixer-ui.ts
  M frontend/src/features/audio/timeline-meters.ts
  M frontend/src/features/canvas/eq-waveform.ts
  M frontend/src/features/canvas/master-console.ts
  M frontend/src/features/canvas/master-visual-suite.ts
  M frontend/src/features/canvas/params-builder.ts
  M frontend/src/features/canvas/visualizer-helpers.ts
  M frontend/src/features/mastering/reference-mastering.ts
  M frontend/src/features/pro/insert-base.ts
→ All audit fixes (frontend + backend) are uncommitted in the working tree (R-UNCOMMITTED)
```

### Not verified by this track author (ASUMIDO from audit text)

- F11 (23 `!.` removed, ~586 remain) — not independently re-counted.
- F14/F16 audible behavior — no audio rendered by any agent (R-NO-RUNTIME).
- `tsc --noEmit` exit 0 — not re-run by this track author; taken from
  ronda-1 §Resumen ejecutivo and re-pass §Resumen ejecutivo.
- `@ts-nocheck` 0 files / 0 lines — taken from AGENTS.md §2 and audit text;
  not independently re-grepped by this track author.
- `ruff check .` (backend) — irrelevant to this frontend track; not run.

---

## Out of Scope (Backend — Separate Track Pending)

These are mentioned in the audit but belong to the **backend** track, not
this one. Listed here only to document that they were intentionally excluded,
not missed:

- C1 FIX K6 `/master/sync` ceiling_db discard (`routers/mastering.py`,
  `mastering.py`)
- C2 `/ws/ref-stream` PCM format mismatch (`routers/streaming.py`) — the
  **frontend decoder** at `reference-mastering.ts:462` was already
  `Int16Array`; the fix was backend-side `pcm_format="int16"`
- C3/C4/C5 OLA normalization + reverb timing (`advanced_dsp.py`, `reverb.py`)
- C6 double limiter (`mixer.py`)
- C7 hard-clip → soft-knee (`streaming_engine.py`)
- C8 `/master/reference` async TypeError (`mastering.py`)
- C9 `/ws/master-stream` orphaned (`routers/streaming.py`)
- Re-pass A/B/C (reverb crash, `_lr4` -6 dB, spectral-tilt highpass)
- Re-pass #1–#5, #7–#9, #12, #13 (all backend)
- F8's `audio-dsp-review` perspective overlaps with F2/F3 — counted once here.

**Frontend-only filter applied:** `frontend/src/**/*.ts` + `frontend/tsconfig.json`.
All `backend/**/*.py` findings excluded.
