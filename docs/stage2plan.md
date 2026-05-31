# Stage 2 — Aggregate Base

## Context
Stages 0–1 delivered live audio capture, the on-device dashboard, batch STT, and context
capture (`docs/ProjectPlan.md` lines 61–64). Stage 2 turns the recorded session into a
**context-aware delivery report**: on stop, the session's channel summaries + transcript +
parsed speech material + audience/setting fields go to Gemini, which returns prioritized,
context-aware advice and a "what was said vs planned" coverage finding. This is the product's
first real differentiator (context-aware coaching) and the after-the-fact report surface.

Stage 2 also pays down a prerequisite the brief calls out first: **all tunable constants,
prompts, and model names are scattered across the codebase** — consolidate them before adding
the Gemini layer. Plus **lightweight session storage** (Firestore) so rehearsals can be
compared across runs.

### Confirmed decisions (from the user)
1. **Config split** — `apps/web/src/config.ts` (browser audio thresholds), `apps/api/src/config.ts`
   (Gemini model/prompts, STT lexicon), `packages/shared/src/config.ts` (only the verdict bands
   used by *both* the live Dashboard and the report). Shared stays dependency-free.
2. **Firestore now** — persist each session's summaries + transcript + report via firebase-admin
   over ADC; add list/retrieve endpoints for cross-rehearsal comparison.
3. **Full two-phase frontend** — build the `idle/live/report` redesign per `docs/FrontEndDesign.md`
   and wire the real Gemini report into the report screen.
4. **Gemini via Vertex AI** — `@google/genai` with `vertexai: true` (ADC, no API key). Model
   `gemini-2.0-flash`.

---

## Build order (each step testable before the next, per the project's "test each step" rule)

### Step 1 — Config consolidation (pure relocation, no behavior change)
Do this first: it is reversible, unblocks both packages, and surfaces a latent inconsistency
early. The processor consts are **not read live** (they bake into `descriptor.sampleHz` at field
init and into EMA closures at module load), so the least-churn move is to **keep them as
imported `const`s** — replace each module-level literal with a named import. Do **not** convert
to constructor params (that would churn `AudioCapture.ts` and every processor signature for no
behavioral gain).

- **`packages/shared/src/config.ts` (new)** — cross-cutting verdict bands only: pace bands and
  pitch-variation bands (`PITCH_MONOTONE_MAX_HZ=8`, `PITCH_VARIED_MAX_HZ=25`). Export from
  `packages/shared/src/index.ts` (`export * from './config.js'`). Pure literals + types only —
  no imports of web/api code, no I/O.
  - **Known inconsistency to preserve, not silently "fix":** NudgeEngine's fast boundary is
    `PACE_FAST=2.2` while Dashboard's good→fast is `1.95/2.4` — the nudge intentionally fires
    later than the meter color changes. Expose the canonical band set in shared and let each
    consumer derive its own thresholds from it so they stay in lockstep; keep Dashboard's
    fine-grained presentation buckets (`a-little-slow`, `a-little-fast`) **web-local**.
- **`apps/web/src/config.ts` (new)** — all audio thresholds from
  `audio/processors/{volume,pause,pace,pitch}.ts`, `audio/AudioCapture.ts`
  (`DEAD_AIR_MS=1200`, `FFT_SIZE`, `RECORD_MIME_CANDIDATES`), `audio/NudgeEngine.ts`, and
  `dashboard/Dashboard.tsx`. Each processor has its own `EMIT_INTERVAL_MS` — namespace them
  (`VOLUME_EMIT_INTERVAL_MS`, `PACE_EMIT_INTERVAL_MS`, …). Import shared bands here or directly
  in Dashboard/NudgeEngine (prefer the latter — shared is the single source).
- **`apps/api/src/config.ts` (new)** — `FILLER_WORDS`, `FILLER_BOOSTS`, STT model `'latest_long'`
  (moved out of `stt/transcribe.ts`), plus `GEMINI_SYSTEM_INSTRUCTION` (report prompt template).
  Keep the env override for the model via `loadGoogleConfig()`.
- **Verify:** `pnpm -r typecheck && pnpm -r build` pass; `pnpm dev` — live meters behave
  identically (this step is byte-equivalent).

### Step 2 — API clients (mock-gated, compiles without creds)
- Add deps to **`apps/api/package.json`**: `@google/genai`, `firebase-admin`; `pnpm install`.
- **`apps/api/src/google/clients.ts`** — add `getGeminiClient()` and `getFirestore()` mirroring
  the existing `getSpeechClient()` lazy-singleton + null-on-failure pattern:
  - `getGeminiClient()`: `GEMINI_MOCK=1` → null; else
    `new GoogleGenAI({ vertexai: true, project: projectId, location: 'us-central1' })`.
  - `getFirestore()`: `FIRESTORE_MOCK=1` → null; else `firebase-admin` `initializeApp({ projectId })`
    guarded by `getApps().length`, then `getFirestore()`.
- Add `GEMINI_MOCK=0`, `FIRESTORE_MOCK=0` to **`apps/api/.env.example`**.

### Step 3 — Gemini report in `runAggregate`
**`apps/api/src/aggregate/runAggregate.ts`** — replace the stub body, keeping the current stub
as a named fallback (`stubReport(input)`), mirroring the STT_MOCK degrade pattern:
1. `const client = getGeminiClient(); if (!client) return stubReport(input);`
2. Serialize `AggregateInput` into the prompt: `channelSummaries` (stats + timeline + events —
   already compact), `transcript.text`, `speechMaterial.combinedText`, `settings` fields.
3. System instruction from `apps/api/src/config.ts`: speech-coach role; produce `summary`,
   `prioritizedAdvice[]`, `metrics[]` (with `good|watch|flag` verdicts), and `coverage`
   (`pointsCovered` / `pointsMissed` / `deviations` / `runningLong`) judged against the material
   and settings.
4. **JSON mode** (`responseMimeType: 'application/json'` + `responseSchema`) matching the Stage-2
   subset of `AggregateReport` only — do **not** schema the Stage 3/4 fields
   (tone/congruence). Parse `response.text`, attach `schemaVersion: SCHEMA_VERSION`.
5. **Floors so a bad LLM response never yields an empty report:** keep computing the deterministic
   volume/pause `metrics` via `findSummary` as a baseline; wrap the parse in try/catch →
   fall back to `stubReport(input)` on malformed output, and log.
- **Verify:** `GEMINI_MOCK=1 FIRESTORE_MOCK=1 STT_MOCK=1 pnpm --filter @quack/api dev`, POST a
  sample `AggregateInput` to `/api/aggregate` → deterministic stub. Then with ADC
  (`gcloud auth application-default login`, `CLOUDSDK_PYTHON=python3.13`) unset `GEMINI_MOCK` →
  real report; confirm JSON parses to `AggregateReport`.

### Step 4 — Firestore persistence + endpoints
**`apps/api/src/server.ts`** (routes stay under `/api`):
- Extend `POST /aggregate`: after `runAggregate`, **best-effort** persist to `sessions/{sessionId}`
  (failure logs but still returns the report). Persist `channelSummaries` + `transcript` +
  `report` + `context` + `createdAt: serverTimestamp` — **not** the raw per-frame `series`
  (avoids Firestore's 1 MiB doc limit; comparison views only need summaries).
- `GET /sessions` — recent list (orderBy `createdAt` desc, limit ~20): `[{ sessionId, createdAt,
  summary, topMetrics }]`.
- `GET /sessions/:id` — full stored report + summaries for a prior rehearsal.
- **Verify:** unset `FIRESTORE_MOCK`, run a session, confirm `sessions/{id}` written and the two
  GET routes return it.

### Step 5 — Frontend two-phase redesign (follow `docs/FrontEndDesign.md` §8 order)
1. **Theme** — `index.html` + `theme/tokens.css`: load EB Garamond 300 + Inter; point
   `--t-display-family`; add the orb utility. Verify build.
2. **Mock module** `apps/web/src/mock/placeholders.ts` (new) — typed stub data with
   `measured: false` flags, shaped to `@quack/shared` (`ChannelSummary`, `AggregateReport`,
   `LiveSnapshot`).
3. **Live screen** `dashboard/Dashboard.tsx` + css — nudge centerpiece, thin peripheral cue strip,
   drop raw numbers, filler cue as `measured:false` placeholder, gate dev window-tuners behind
   `import.meta.env.DEV`.
4. **Phase machine** `App.tsx` — explicit `phase: 'idle'|'live'|'report'`; move `ContextForm` to
   idle; `idle→live` on start, `live→report` on stop once the transcript resolves (handle the
   `transcribing` interim with a loading state); "New rehearsal" resets to idle.
5. **Report shell** `apps/web/src/report/Report.tsx` + css (new) — real delivery-metric cards from
   `summaries`; **context-aware advice card is REAL** (reads the Gemini report's `coverage` +
   `prioritizedAdvice`); tone-content mismatch stays a placeholder card (Stage 3). Optional thin
   "compare to prior" strip from `GET /sessions`.
- **Report fetch wiring:** in `apps/web/src/audio/useAudioCapture.ts` add `fetchReport()` that
  builds `AggregateInput` from `summarizeAll(record.channels)`, `record.transcript`,
  `record.context?.material`, `record.context?.settings` and POSTs `/api/aggregate`. Trigger it on
  entering the `report` phase (after the transcript resolves, so the input is complete).
- Typecheck + visual check after each numbered sub-step.

---

## Critical files
| File | Change |
|------|--------|
| `packages/shared/src/config.ts` (new) + `index.ts` | cross-cutting pace/pitch verdict bands; export barrel |
| `apps/web/src/config.ts` (new) | all browser audio thresholds (moved from processors/NudgeEngine/Dashboard/AudioCapture) |
| `apps/api/src/config.ts` (new) | STT lexicon/boosts/model + Gemini prompt template |
| `apps/api/src/google/clients.ts` | add `getGeminiClient()` (Vertex/ADC) + `getFirestore()` (firebase-admin/ADC), mock-gated |
| `apps/api/src/aggregate/runAggregate.ts` | Gemini JSON-mode report + deterministic floors + stub fallback |
| `apps/api/src/server.ts` | persist on `/aggregate`; add `GET /sessions`, `GET /sessions/:id` |
| `apps/api/src/stt/transcribe.ts` | import lexicon/model from `config.ts` |
| `apps/api/package.json` + `.env.example` | `@google/genai`, `firebase-admin`; `GEMINI_MOCK`, `FIRESTORE_MOCK` |
| `apps/web/src/audio/useAudioCapture.ts` | add `fetchReport()` → `/api/aggregate` |
| `apps/web/src/App.tsx` | phase state machine; move ContextForm to idle; render Report |
| `apps/web/src/dashboard/Dashboard.tsx` + css | nudge centerpiece + cue strip; gate dev tuners |
| `apps/web/src/mock/placeholders.ts` + `report/Report.tsx` (new) | mock data; report shell |
| `theme/tokens.css` + `index.html` | EB Garamond 300 + Inter; orb utility |

Reuse, don't redefine: `AggregateFn`/`AggregateInput`/`AggregateReport`/`CoverageFinding`
(`packages/shared/src/aggregate.ts`), `summarizeAll`/`findSummary`/`ChannelSummary`
(`summaries.ts`), `SpeechContext`/`ParsedMaterial`/`ContextFields` (`context.ts`),
`SCHEMA_VERSION` (`schema.ts`). The existing `getSpeechClient` lazy-singleton + mock pattern is
the template for the two new clients.

---

## Verification (end-to-end, mock-first so it runs offline)
1. **Config:** `pnpm -r typecheck && pnpm -r build`; `pnpm dev` — meters unchanged.
2. **Aggregate offline:** `GEMINI_MOCK=1 FIRESTORE_MOCK=1 STT_MOCK=1 pnpm --filter @quack/api dev`;
   POST sample `AggregateInput` → deterministic stub; full app runs offline.
3. **Aggregate real:** ADC login, unset `GEMINI_MOCK` → real report parses to `AggregateReport`
   (needs `gemini-2.0-flash` enabled in `us-central1`, ADC has `aiplatform.user`).
4. **Firestore:** unset `FIRESTORE_MOCK`, run a session → `sessions/{id}` written; GET routes return it.
5. **Frontend:** full `idle→live→report` flow; report shows real metrics + real context advice +
   a labeled placeholder for tone.

## Docs to update (same turn as the code, per CLAUDE.md rules)
- `apps/api/CLAUDE.md` — new `config.ts`, Gemini+Firestore clients, `/sessions` endpoints,
  `GEMINI_MOCK`/`FIRESTORE_MOCK`, new deps.
- `apps/web/CLAUDE.md` — new `config.ts`, `mock/`, `report/` dirs, two-phase flow.
- `packages/shared/CLAUDE.md` — new `config.ts` (cross-cutting bands); dependency-free preserved.
- Root `CLAUDE.md` Files table if structure shifts.
- `docs/Problems.md` — log issues with time / stage 2 / component scope (likely: the
  pace-band 2.2 vs 1.95 reconciliation; Firestore doc-size decision; Vertex region/quota).

## Risks
- **Pace-band inconsistency** (NudgeEngine 2.2 vs Dashboard 1.95/2.4) — preserve both via distinct
  named bands; don't collapse silently. Document in Problems.md.
- **Firestore doc size** — persist summaries, not raw series.
- **Gemini JSON reliability** — `responseSchema` reduces but doesn't eliminate malformed output;
  deterministic metric floors + stub fallback prevent empty reports.
- **Vertex auth/region/quota** — test the real path early (Step 3) before building report UI on it.
- **Shared purity** — `config.ts` must be literals + types only, or it breaks both builds. Don't
  forget the `index.ts` export.
