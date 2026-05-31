# @quack/api

Cloud Run service. Proxies Gemini + Speech-to-Text and persists sessions to Firestore.
Stage 2: `/api/aggregate` returns a context-aware Gemini report (Vertex AI, JSON mode) and
best-effort persists the session; `/api/sessions` lists/retrieves prior rehearsals.

## Edit rules
- ALL Google credentials/keys live here, never in the web app. Prefer Cloud Run's runtime
  service account (Application Default Credentials) over inline API keys.
- Routes are mounted under **`/api`** (Hono `basePath('/api')`) — Firebase Hosting rewrites
  `/api/**` here unstripped, and the web Vite proxy mirrors it. Keep new routes under `/api`.
- Implement the report against the `AggregateFn` contract in `@quack/shared` — don't redefine it.
- `@quack/shared` is bundled into `dist` by tsup (it is TS source, not a published package).

## Files
| Path | Description | Open when... |
|------|-------------|--------------|
| src/server.ts | Hono server (/api basePath): /health (public), /aggregate (+persist), /sessions, /sessions/:id, /transcribe (all `requireAuth`); CORS allowlist | adding routes |
| src/auth/requireAuth.ts | Hono middleware: verify `Authorization: Bearer <idToken>` → `c.get('uid')`; `AUTH_MOCK` bypass | gating a route on a user |
| src/config.ts | STT lexicon/boosts/`STT_MODEL` + report/tone/filler system instructions and low-temp constants | tuning STT or the Gemini prompts |
| src/stt/transcribe.ts | batch STT v2: audio → Transcript, filler-lexicon disfluency tags; `transcribeWithFillers` (the route entry) runs STT + the Gemini filler pass concurrently and merges recovered fillers into `words` (dedup ±300ms); `autoDecodingConfig` handles webm/opus + the chunker's WAV | tuning transcription |
| src/stt/geminiFillers.ts | Gemini verbatim audio pass (`inlineData`, temp 0) recovering the fillers STT drops → `isDisfluency` words; null client → `[]` (degrades to STT-only). Gemini rejects webm, so the client uploads WAV | recovering dropped fillers |
| src/aggregate/runAggregate.ts | AggregateFn impl: 2 concurrent independently-degrading Gemini calls (report + tone@0.2); transcript-derived WPM pace block injected into the report prompt | building the report |
| src/google/clients.ts | Speech + Gemini (Vertex) + Firestore clients (ADC, env-gated mocks) | wiring Google SDKs |
| Dockerfile | Cloud Run container (build from repo root) | deploying |

## Clients & mocks (`google/clients.ts`)
- All four follow the same lazy-singleton + null-on-failure pattern; each has a mock gate:
  `STT_MOCK=1` (mock transcript), `GEMINI_MOCK=1` (deterministic stub report), `FIRESTORE_MOCK=1`
  (persistence disabled), `AUTH_MOCK=1` (skip ID-token verify; middleware injects `AUTH_MOCK_UID`,
  default `dev-user`). Run all four set to skip every Google call for offline dev.
- ADC only (no keys). Gemini uses Vertex AI (`{ vertexai: true, location: 'us-central1' }`);
  Firestore + Auth share one firebase-admin app (`getApps().length===0` guard); Firestore sets
  `ignoreUndefinedProperties`. `getAuthClient()` is consumed only by `requireAuth`.
- Deps: `@google/genai`, `firebase-admin` (added Stage 2), `@google-cloud/speech`.

## Auth & per-user data
- Routes require a verified Firebase ID token (`requireAuth`); the uid comes ONLY from the token,
  never the body/query. `/health` stays public.
- Sessions are stored per user at `users/{uid}/sessions/{sessionId}` (ownership is path-based, so a
  foreign id read just 404s — no composite index, no manual `where(uid)` filter to forget).
- CORS is an allowlist (hosting origins + `localhost:5173`) with `Authorization` allowed; Cloud Run
  itself stays `--allow-unauthenticated` (auth is enforced in-app, not at the platform edge).

## STT notes
- Sync `recognize` caps inline audio at ~60s — fine for short clips; full-length needs streaming.

## Report & persistence notes
- `runAggregate` fires 2 concurrent Gemini calls, each in its own try/catch (allSettled-style, not a
  bare `Promise.all`): the core **report** (Stage-2 subset, temp 0.4) and **tone** (temp 0.2). A
  failed call degrades to `undefined` (its card falls back to a placeholder); no Gemini client →
  `stubReport`. `floorMetrics` keeps the report non-empty.
- **Tone** (tone–content mismatch) is subjective, so the model owns its fields directly: it receives
  the transcript, prosody timelines, and material, and only `strong`-graded mismatches are surfaced,
  capped at `MAX_TONE_FINDINGS`. Omitted (card → placeholder) when there is no transcript.
- Each call has its own `responseSchema` (report / `{toneContentMismatch[]}`); `schemaVersion` is
  attached server-side, never by the model.
- `/aggregate` persists `sessions/{id}` best-effort: summaries + transcript + report + context,
  **not** raw `series` (1 MiB doc limit). Failure logs but still returns the report.

## Run
- Dev: `pnpm --filter @quack/api dev` (tsx, port 8080).
- Build: `pnpm --filter @quack/api build` → self-contained `dist/server.js`.
