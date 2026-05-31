# Problems

Running log of major problems encountered and how they were resolved.

## STT transcription fails: "Unable to detect a Project Id" / "Could not load the default credentials"
**Stage 1, batch STT.** Clicking Stop showed "Transcription failed". Root cause was not a code bug
but missing local Google auth: the Speech v2 client had no Application Default Credentials, so
`recognize()` threw before reaching STT.

**Fix (local dev):**
```
gcloud auth application-default login
gcloud auth application-default set-quota-project uoo-quackathon26eug-8210
export GOOGLE_CLOUD_PROJECT=uoo-quackathon26eug-8210   # before `pnpm --filter @quack/api dev`
```
Also ensure the Speech-to-Text API is enabled (`gcloud services enable speech.googleapis.com`).

**Code changes that helped diagnose:** `/api/transcribe` now logs the full error to the API
terminal and returns the message to the browser; `transcribe.ts` resolves the project from
`GOOGLE_CLOUD_PROJECT` first. `STT_MOCK=1` skips STT entirely (canned transcript) for offline UI work.

## Known limitation: filler words only detected when emphasized
**Stage 1, batch STT.** Google STT (like most ASR) normalizes away disfluencies, so "um/uh" are
only transcribed when spoken with enough emphasis to be unambiguous — unstressed fillers are
dropped and therefore never tagged. This is the Stage 1 risk the plan flagged.

**Mitigation in place:** inline speech-adaptation phrase set in `transcribe.ts` (`FILLER_BOOSTS`)
biases `latest_long` toward emitting fillers; lexicon includes spelling variants. Reduces misses
but does not eliminate them — raising boosts trades misses for false positives.

**Durable fix (deferred to Stage 3):** acoustic gap detection — flag voiced regions (energy above
the speech gate, near-flat pitch, ~200–600ms) that STT left with no transcribed word as candidate
fillers. Belongs in Stage 3 because it needs the audio↔transcript alignment machinery built there.

## Pace verdict bands disagree across consumers (decision: preserve, don't collapse)
**Stage 2, config consolidation (shared + web).** The nudge fires "fast" at 2.2 syll/s while the
dashboard meter only colors "fast" past its 1.95/2.4 presentation buckets — so the meter shifts
before the nudge nags. This is intentional, not a bug.

**Decision:** the canonical bands (`PACE_IDLE_MAX_SPS`, `PACE_SLOW_MAX_SPS`, `PACE_FAST_MIN_SPS`,
pitch bands) live in `@quack/shared/config.ts` and are consumed by the nudge + report; the
dashboard keeps its finer presentation buckets web-local in `apps/web/src/config.ts` with a
comment documenting the divergence. Don't silently unify them.

## Firestore 1 MiB doc limit (decision: persist summaries, not raw series)
**Stage 2, persistence (apps/api/server.ts).** A full session's per-frame `series` (volume at
20 Hz, pitch at 10 Hz, …) can exceed Firestore's 1 MiB document cap on longer talks.

**Decision:** `sessions/{id}` stores `channelSummaries` + `transcript` + `report` + `context`
only — never the raw `series`. Comparison views only need summaries. `getFirestore()` sets
`ignoreUndefinedProperties: true` so optional report fields don't throw on write. Persistence is
best-effort: a write failure logs but still returns the report.

## Vertex/Firestore real paths need ADC + enabled APIs (verify before relying on the report UI)
**Stage 2, Gemini + Firestore (apps/api).** Built and verified mock-first
(`GEMINI_MOCK=1 FIRESTORE_MOCK=1 STT_MOCK=1`) so the app runs fully offline. The real paths need:
ADC (`gcloud auth application-default login`, `CLOUDSDK_PYTHON=python3.13`), the Vertex AI API +
`gemini-2.0-flash` available in `us-central1` with `aiplatform.user`, and Firestore enabled.
Untested live at implementation time — verify before building further UI on the real report.

**Note on SDK surface:** `@google/genai@2.7.0` and `firebase-admin@13.10.0` API surface was
verified against the installed packages — `GoogleGenAI({ vertexai, project, location })`,
`models.generateContent({ config: { systemInstruction, responseMimeType, responseSchema } })`,
`response.text` getter, the `Type` enum, and `firebase-admin/{app,firestore}` subpath exports.

## Vertex model `gemini-2.0-flash` returns 404 — project only has Gemini 2.5
**Stage 2, Gemini (apps/api). 2026-05-30.** First real `/api/aggregate` call returned a 404:
`Publisher Model .../models/gemini-2.0-flash was not found or your project does not have access`.
Probed the project (`uoo-quackathon26eug-8210`, `us-central1`): `gemini-2.5-flash`,
`gemini-2.5-pro`, `gemini-2.5-flash-lite` work; `gemini-2.0-flash`, `gemini-2.0-flash-001`,
`gemini-1.5-flash*` all 404. The 2.0/1.5 aliases aren't available to this project/region.

**Fix:** default model changed to `gemini-2.5-flash` in `google/clients.ts` (`loadGoogleConfig`),
the `runAggregate` fallback, and `.env.example`. Verified: real report returns rich
summary/metrics/advice/coverage and persists to Firestore `sessions/{id}`; `GET /api/sessions`
+ `/sessions/:id` return it. Override per-env with `GEMINI_MODEL`.

## Google login / per-user history — setup requirements + risks (verify before relying on real auth)
**Auth / per-user persistence (web + api). 2026-05-30.** Added Firebase native Google sign-in;
sessions moved from flat `sessions/{id}` to per-user `users/{uid}/sessions/{id}`. Built and
verified mock-first (`AUTH_MOCK=1` bypass + `FIRESTORE_MOCK=1`): `/health` public, all data routes
401 without a token, 200 with `AUTH_MOCK`; CORS allowlist echoes allowed origins and blocks others.
A Web App was registered via the Firebase MCP and its public config committed to
`apps/web/src/firebase.ts`. The **real** path is untested live at implementation time and needs:
- **Console (one-time):** enable the Google sign-in provider (Authentication → Sign-in method) and
  confirm `localhost` + `web.app`/`firebaseapp.com` are authorized domains. Without the provider
  enabled, `signInWithPopup` fails with `auth/operation-not-allowed`.
- **Cloud Run runtime SA** must be able to `verifyIdToken` (fetches Google public certs over
  egress; the admin app is initialized with the project id via ADC, already present for Firestore).
  If it errors, all authed routes 500 — `AUTH_MOCK=1` is the fallback. Grant
  `roles/firebaseauth.viewer` if needed.
- **Deploy rules/indexes:** `firebase deploy --only firestore:rules,firestore:indexes` (path-based
  ownership; indexes empty by design — the subcollection avoids a composite index).

**Watch:** `signInWithPopup` can be blocked by popup blockers (fall back to `signInWithRedirect`
if testing shows this); `onAuthStateChanged` double-subscribes under React StrictMode (the effect
returns its unsubscribe to prevent a leaked listener). Old flat `sessions/*` test docs are orphaned
by the new model — disposable, clean up to avoid confusion.

## Recorder↔clip clock offset is the Stage-3 linchpin (calibrate once at MediaRecorder 'start')
**Stage 3, audio alignment (apps/web). 2026-05-30.** STT word timestamps are relative to the
recorded clip's t=0; the volume/pitch/pause channel series are relative to the Recorder's
`performance.now()` t0, which is constructed *after* `startRecording()` (plus encoder startup
latency). Slicing channels by word windows on the wrong clock would break stress, chunk cuts, and
gap-fillers all at once.

**Fix:** `AudioCapture` stamps `clipStartMs` in the MediaRecorder `'start'` event and returns
`offsetMs = recorderT0Ms − clipStartMs` on `CaptureResult` (transient, never persisted). Convert
with `tChannel = tClipWord − offsetMs` (read a channel for a word) and `tClip = tChannel + offsetMs`
(place a pause boundary on the decoded clip). Residual constant encoder latency folds into the same
bias. **Verify the sign empirically** — a clap/sharp word at a known clip time should land on the
`audio.volume` spike after applying the offset.

## Chunked long-form STT: seam de-dup + no-pause hard-cut + Safari decode portability
**Stage 3, chunker (apps/web). 2026-05-30.** Sync STT caps inline audio at ~60s. The chunker
(`audio/chunker.ts`) decodes the clip, downsamples to 16 kHz mono, and slices on detected pauses
into <55s WAV segments recognized in parallel, stitched by per-segment offset.
- **No pause in the window** → hard-cut at `maxSegMs` (rare mid-word split); adjacent segments
  overlap by a ~300 ms guard and stitching de-dups seam words (same normalized text within 400 ms),
  so a split word is neither dropped nor duplicated.
- **Decode is best-effort** across Chrome (webm/opus) and Safari (mp4/aac); if `decodeAudioData`
  throws, `chunkAudio` returns null and the caller falls back to the single whole-clip call (accepts
  the ~60s cap) rather than failing the report.
- **Payload:** WAV > opus, but 16 kHz mono is the Speech models' native rate (no accuracy loss) and
  keeps the per-segment payload bounded. Verify: a >90s rehearsal transcribes fully with monotonic
  timestamps across seams.

## Acoustic gap-filler false positives (breaths, dramatic pauses)
**Stage 3, fillers (apps/web). 2026-05-30.** Flagging voiced inter-word gaps as the "um"s STT drops
risks catching breaths and deliberate pauses. Mitigation: conservative thresholds (200–600 ms),
require voiced energy (reuse `PACE_SPEECH_GATE_DBFS` — a single source of truth, not a third
loudness knob) AND near-flat pitch, and de-dup vs committed `audio.pause` events + STT fillers.
Gap fillers carry `payload.source='gap'` and `c<1`, merged into the **one** `audio.filler` channel.
Tune `GAP_*` in `apps/web/src/config.ts` from real recordings.

## Emphasis: LLM extracts spans only; verdict computed in code (span→word matching is the risk)
**Stage 3, aggregate (apps/api). 2026-05-30.** To stop the LLM drifting delivery numbers, Gemini
(temp 0.1) returns only the important phrases + `importance` — never the measured stress.
`computeEmphasisVerdicts` aligns each phrase to transcript word spans (normalized contiguous token
match), assigns importance (unmatched → low baseline), reads `word.stress` as delivered, and sets
match/under/over by `EMPHASIS_*_DELTA`. Emphasis is omitted (card → placeholder) when there is no
transcript or it carries no `stress`.

**Update (2026-05-31): importance now comes from the delivered transcript, not an uploaded script**,
so the feature works with no material (material is optional extra context). This also largely
removes the prior span→word matching risk — phrases are sourced from the transcript, so they align
back to spoken words by construction (residual risk only from in-transcript repeats). Contingency if
needed = tighten the match / a confidence floor.
