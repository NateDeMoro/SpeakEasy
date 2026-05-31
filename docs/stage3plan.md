# Phase 3 Plan — Differentiator Layer (audio)

> Deliverable: this content is saved to `docs/stage3plan.md` (mirrors `docs/stage2plan.md`).
> Implementation follows step-by-step in later turns, per the project's "test each step" rule.

## Context

Stages 0–2 ship live capture, the dashboard, batch STT, context capture, and the Stage-2
context-aware Gemini report. Phase 3 deepens the after-the-fact report:

1. **Tone-content mismatch** — content sentiment (Gemini) vs delivered prosody (e.g. an exciting
   result delivered flat).
2. **Per-word acoustic stress** — score how vocally stressed each word was and weight the report
   transcript so the words the speaker stressed read heavier.

Plus two adjacent pieces the brief and `docs/Problems.md` tie to Stage 3:

3. **Acoustic filler-gap detection** — flag voiced gaps STT left untagged (the durable fix for
   the Stage 1 filler-miss), reusing the same audio↔transcript alignment built for stress.
4. **Long-form STT** — full-talk word timestamps, past the current ~60s sync cap.

> Note: an earlier revision of this plan also shipped an "emphasis-vs-meaning" card (a code-computed
> verdict comparing content importance to delivered stress). That feature was later removed; the
> per-word `stress` signal it produced is retained to weight the report transcript.

The tone card already exists as a labeled placeholder (`apps/web/src/report/Report.tsx`), and the
shared contract reserves `AggregateReport.toneContentMismatch` (`packages/shared/src/aggregate.ts`)
and `TranscriptWord.stress` (`packages/shared/src/schema.ts`). Phase 3 fills them — all
additive/optional, no `SCHEMA_VERSION` bump, no breaking change to `@quack/shared`.

## Confirmed decisions

1. **Filler-gap detection IS in scope** (third deliverable), reusing the alignment.
2. **STT length → client-side chunked sync.** Slice the recorded clip on already-detected pauses
   into <60s WAV segments, recognize each via the existing `/api/transcribe`, stitch with time
   offsets. No new infra (chosen over batch+GCS / streaming).
3. **Gemini → multi-call.** Keep the Stage 2 report call as-is; add one focused, concurrent call
   for tone. Each call degrades independently (a partial failure still yields a report).
4. **Recorder↔clip clock alignment → calibrated once per capture (Step 0).** STT word timestamps
   live on the **MediaRecorder clip** clock; the volume/pitch/pause channels live on the
   **Recorder** `performance.now()` clock. The origins differ (recording starts before the
   Recorder t0, plus encoder startup latency). A single measured offset is captured at capture
   time and applied wherever a word time indexes the channel series — the linchpin for stress,
   chunk cuts, and gap-fillers.

---

## Build order (each step typecheck + visual-verify before the next)

### Step 0 — Calibrate the recorder↔clip clock offset (browser)

The brief names "aligning word timestamps to acoustic stress" as the one real engineering task;
this is the prerequisite. STT word times are relative to the recorded clip's t=0; the channel
series are relative to the Recorder's t0 (`new Recorder(performance.now())`, constructed *after*
`startRecording()` in `AudioCapture.ts`). Every Stage-3 step slices channel series by word windows,
so the two clocks must be reconciled or stress/cuts/gap-fillers all index the wrong samples.

- **`apps/web/src/audio/AudioCapture.ts`** — capture `clipStartMs = performance.now()` in the
  `MediaRecorder` `'start'` event (the moment capture actually begins, which also absorbs most
  encoder startup latency), alongside the existing `recorderT0Ms`. Compute
  `offsetMs = recorderT0Ms − clipStartMs` and return it on `CaptureResult`.
- **Conversion (apply everywhere word↔channel align):**
  `tChannel = tClipWord − offsetMs` to read channels for a word; `tClip = tChannel + offsetMs` to
  place a channel-clock pause boundary on the decoded clip (Step 2). Confirm the sign empirically
  with the verify test — any residual constant latency folds into the same `offsetMs`.
- **Threading:** `offsetMs` is transient (browser-only, not persisted). `useAudioCapture` passes it
  into `annotateStress` (Step 1), the chunker's pause-boundary lookups (Step 2), and gap-fillers
  (Step 3). It never reaches the server — stress is already applied to words before the report POST.
- **Verify:** a hand-clap (or a sharp plosive word) at a known clip time lands on the `audio.volume`
  spike after applying `offsetMs`; dev-overlay word boundaries on the volume curve and confirm they
  sit on the energy envelope.

### Step 1 — Per-word acoustic stress (browser)

Measure how much each word was vocally stressed, write it into `TranscriptWord.stress` (0..1).

- **`apps/web/src/audio/stress.ts` (new)** — `annotateStress(record: SessionRecord, offsetMs:
  number): void` mutates `record.transcript.words[].stress`. For each word window `[tStartMs,
  tEndMs]` (clip clock), first convert to channel clock (subtract `offsetMs`), then:
  - Loudness: mean/peak dBFS from the `audio.volume` channel samples in-window.
  - Pitch prominence: max deviation + range vs the talk's median pitch, from `audio.pitch`.
  - Lengthening: word duration vs median word duration.
  - Z-score each component across all words, weight (tunable), sum, squash to 0..1 (logistic).
  - Degrade gracefully: unvoiced word (no pitch samples) → loudness+duration only; no overlapping
    samples → neutral 0.5.
- **Reuse:** `getChannel(record, 'audio.volume'|'audio.pitch')` (`schema.ts`); series are
  `ScalarSample[]` sorted by `t` — slice by range.
- **Wire:** call in the `useAudioCapture` stop pipeline after `rec.transcript = transcript` and
  before `fetchReport(rec)`, so the stress-annotated transcript flows into `AggregateInput` and is
  persisted.
- **Config:** stress weights in `apps/web/src/config.ts` (`STRESS_W_LOUD`, `STRESS_W_PITCH`,
  `STRESS_W_DURATION`).
- **Verify:** dev-log `words.map(w => [w.text, w.stress])` — louder/emphasized words score higher.

### Step 2 — Chunked long-form STT (browser)

Get accurate word timestamps for talks longer than the ~60s sync cap, without new infra.

- **`apps/web/src/audio/chunker.ts` (new)** — `chunkAudio(blob, pauseBoundariesMs, offsetMs,
  maxSegMs=55000)`: `AudioContext.decodeAudioData(blob)` → mix to mono → walk segments up to
  `maxSegMs`, snapping each cut to the nearest pause boundary within the window (cut inside silence,
  never mid-word) → encode each slice as 16-bit PCM WAV → return `{ wav, offsetMs }[]`. Downsample
  to 16 kHz mono (Speech models are 16 kHz native — no accuracy loss, large payload win).
  - **Pause-boundary clock:** boundaries come from `getChannel(record, 'audio.pause')` `EventSamples`
    (channel clock). Add Step 0's `offsetMs` to place each on the decoded-clip timeline the chunker
    walks. Silence midpoints are the safe cut points.
  - **No-pause fallback:** if no pause boundary falls within the window, hard-cut at `maxSegMs`
    (a rare mid-word split) rather than overrunning the 60s cap.
  - **Seam handling:** overlap adjacent segments by a small guard (~300 ms) and de-dup seam words
    when stitching (match on text + near-equal stitched time) so a word split across a hard cut is
    neither dropped nor duplicated.
  - **Decode is best-effort:** Chrome emits webm/opus, Safari mp4/aac — both decode via
    `decodeAudioData`, but if decode throws, fall back to the single-call path (send the whole clip,
    accept the ~60s cap) rather than failing the report.
- **`apps/web/src/audio/useAudioCapture.ts`** — when the clip exceeds `maxSegMs`, chunk it, POST each
  segment to `/api/transcribe` (parallel), then stitch: add each segment's `offsetMs` to its words'
  `tStartMs/tEndMs`, concatenate words + text in order. ≤ one segment → current single call unchanged.
- **Server:** `/api/transcribe` + `apps/api/src/stt/transcribe.ts` unchanged (each segment is <60s;
  `autoDecodingConfig` handles WAV). Confirm WAV path only.
- **Verify:** a >90s rehearsal transcribes fully with monotonic timestamps across segment seams; a
  >55s no-pause stretch still completes via the hard-cut fallback.

### Step 3 — Acoustic filler-gap detection (browser, reuses alignment)

Catch the unstressed "um/uh" STT drops (Stage 1 known limitation, `docs/Problems.md`).

- **`apps/web/src/audio/fillers.ts` (extend)** — after Steps 1–2, scan each inter-word gap
  `[prevWord.tEndMs, nextWord.tStartMs]` (clip clock; convert to channel clock with Step 0's
  `offsetMs` before reading channels). Flag as a candidate filler when all hold: duration in
  `[GAP_MIN_MS, GAP_MAX_MS]` (~200–600 ms); `audio.volume` in-window above the voiced gate (voiced,
  not silence); `audio.pitch` near-flat (low variation); and not already covered by an `audio.pause`
  event or an STT filler.
  - **Single `audio.filler` channel:** `buildFillerChannel` currently takes only `(transcript)` and
    derives from `isDisfluency`. Extend its signature to accept the gap fillers
    (`buildFillerChannel(transcript, gapFillers?)`) and concatenate into the **one** `audio.filler`
    channel — do not push a second filler channel. Gap fillers are `EventSamples` (payload
    `{ source: 'gap' }`, `c < 1`).
- **Reuse:** existing `buildFillerChannel(transcript)`; `getChannel` for volume/pitch/pause.
- **Config:** `GAP_MIN_MS`, `GAP_MAX_MS`, `GAP_PITCH_FLAT_HZ` in `apps/web/src/config.ts`. For the
  voiced gate, **reuse `PACE_SPEECH_GATE_DBFS`** (the existing speech/silence floor) rather than
  adding a third loudness threshold that can drift — single source of truth, per the web
  `CLAUDE.md` threshold-divergence warning.
- **Verify:** a clip with mumbled "um"s STT missed raises the filler count; clean pauses/breaths
  do not.

### Step 4 — Gemini multi-call (server)

- **`apps/api/src/aggregate/runAggregate.ts`** — refactor the single call into two
  independently-degrading calls run concurrently, each wrapped in its own try/catch so a failure
  yields `undefined` (`Promise.allSettled`-style — do **not** use a bare `Promise.all` that would
  reject the whole report); merge into one `AggregateReport`:
  - **`report` (existing):** summary/advice/metrics/coverage, temp 0.4, `REPORT_SCHEMA` (unchanged).
  - **`analyzeTone(input)` (new):** input = transcript + `channelSummaries` prosody timelines
    (pitch/volume/pace) + material; schema `{ toneContentMismatch: MismatchFinding[] }`; temp ~0.2.
    These fields are subjective, so the LLM owns them directly. Only `strong`-graded mismatches are
    surfaced, capped at `MAX_TONE_FINDINGS`.
- **`apps/api/src/config.ts`** — add `GEMINI_TONE_INSTRUCTION`, `GEMINI_TONE_TEMPERATURE = 0.2`,
  and `MAX_TONE_FINDINGS`.
- **Reuse:** `getGeminiClient`/`loadGoogleConfig` (`google/clients.ts`); the JSON-mode +
  `responseSchema` + `Type` pattern from `REPORT_SCHEMA`; `findSummary`; the stub/degrade pattern.
- **Persistence:** `/aggregate` already persists the report + transcript best-effort — the new
  field + `stress` ride along automatically (no series, 1 MiB cap respected).
- **Latency/UX:** the pipeline now runs N chunk STT calls + 2 Gemini calls before the report
  renders; the existing `transcribing` / `reportPending` states already cover the longer wait — no
  new UI needed.
- **Verify:** mock (`GEMINI_MOCK=1`) → stub still non-empty; real ADC → tone parses to the
  contract; kill one call → other sections still render.

### Step 5 — Real report cards (browser)

- **`apps/web/src/report/Report.tsx` (+ `report.css`)** — replace the tone `PlaceholderCard`:
  - Tone card from `report.toneContentMismatch`: list segments (contentSentiment vs deliveredTone +
    detail + `fmtClock(tStartMs)`).
  - Weight/opacity each transcript word by `w.stress` in the existing transcript render.
  - Keep the `measured:false` placeholder state (`MISMATCH_PLACEHOLDER`) for the empty/old-session
    case. Style via theme/tokens.css only (no hex).
- **Verify:** real report populates the tone card; no real finding / stored pre-Stage-3 session →
  graceful placeholder. History renders identically.

### Step 6 — Docs (same turn as the code, per CLAUDE.md)

- **`apps/web/CLAUDE.md`** — new `audio/stress.ts`, `audio/chunker.ts`, extended `fillers.ts`;
  `AudioCapture.ts` clock-offset calibration; report cards real.
- **`apps/api/CLAUDE.md`** — multi-call `runAggregate` (report + tone), new instruction/temp in
  `config.ts`.
- **Root `CLAUDE.md`** Files table if structure shifts.
- **`docs/Problems.md`** — log: recorder↔clip clock-offset calibration; chunk-seam / no-pause
  hard-cut handling; gap-filler false-positive tuning; WAV re-encode payload + Safari decode
  fallback.
- **`packages/shared/CLAUDE.md`** — note Stage-3 fields now populated (no version bump).

---

## Critical files

| File | Change |
|------|--------|
| `apps/web/src/audio/AudioCapture.ts` | calibrate `offsetMs` (recorder t0 vs MediaRecorder `'start'`); return it on `CaptureResult` |
| `apps/web/src/audio/stress.ts` (new) | per-word acoustic stress from volume/pitch/duration → `word.stress` (offset-corrected windows) |
| `apps/web/src/audio/chunker.ts` (new) | decode → pause-aligned WAV segments + offsets; no-pause hard-cut + seam de-dup; decode best-effort |
| `apps/web/src/audio/fillers.ts` (extend) | acoustic filler-gap detection merged into the single `audio.filler` channel |
| `apps/web/src/audio/useAudioCapture.ts` | thread `offsetMs`; chunk+stitch STT, then `annotateStress`, then gap-fillers, before `fetchReport` |
| `apps/web/src/config.ts` | stress weights + gap thresholds (voiced gate reuses `PACE_SPEECH_GATE_DBFS`) |
| `apps/web/src/report/Report.tsx` + `report.css` | real tone card; stress-weighted transcript highlight |
| `apps/api/src/aggregate/runAggregate.ts` | multi-call (report + tone@0.2), concurrent, per-call degrade |
| `apps/api/src/config.ts` | tone system instruction + low-temp constants |
| `apps/api/src/stt/transcribe.ts` | confirm WAV/per-segment path (likely unchanged) |
| `packages/shared/*` | no change — Stage-3 fields + `stress` already exist; no `SCHEMA_VERSION` bump |

**Reuse, don't redefine:** `getChannel` (`schema.ts`); `buildFillerChannel` (`fillers.ts`);
`summarizeAll`/`findSummary` (`summaries.ts`/`aggregate.ts`); `getGeminiClient`/`loadGoogleConfig`
(`google/clients.ts`); `REPORT_SCHEMA`/`Type` JSON-mode pattern (`runAggregate.ts`); `fmtClock`,
`PlaceholderCard` (`Report.tsx`); `MISMATCH_PLACEHOLDER` (`mock/placeholders.ts`).

---

## Verification (end-to-end, mock-first so it runs offline)

1. **Typecheck/build:** `pnpm -r typecheck && pnpm -r build` after each step.
2. **Clock offset (Step 0):** a clap/sharp word at a known clip time lands on the `audio.volume`
   spike after applying `offsetMs`; word boundaries overlay onto the energy envelope.
3. **Stress (Step 1):** dev-log per-word stress — emphasized words rank higher; unvoiced words
   don't crash.
4. **Chunking (Step 2):** a >90s rehearsal transcribes fully; timestamps monotonic across seams; a
   >55s no-pause stretch completes via hard-cut + seam de-dup.
5. **Filler-gap (Step 3):** mumbled-"um" clip raises the count; breaths/clean pauses don't.
6. **Aggregate offline:** `GEMINI_MOCK=1 FIRESTORE_MOCK=1 STT_MOCK=1 pnpm --filter @quack/api dev`
   → stub non-empty (ensure the mock transcript carries word timings so stress can compute).
7. **Aggregate real:** ADC (`gcloud auth application-default login`, `CLOUDSDK_PYTHON=python3.13`,
   `gemini-2.5-flash`) → tone parses to the contract; partial-failure of one call still renders.
8. **Frontend:** full idle→live→report — the tone card populates from a real report; no real
   finding / old session falls back to the placeholder; Firestore persists the new field; History
   renders it. The transcript is stress-weighted.

---

## Risks

- **Recorder↔clip clock offset (linchpin)** — STT word times (clip clock) and channel series
  (recorder clock) have different origins; mis-slicing breaks stress, chunk cuts, and gap-fillers.
  Mitigate: calibrate `offsetMs` once at the MediaRecorder `'start'` event and apply it everywhere;
  verify a known transient lands on its envelope. Residual encoder latency folds into the same
  constant bias. (Problems.md)
- **Chunk-seam / no-pause boundaries** — snap cuts to detected silence (`audio.pause`, offset-placed
  onto the clip), cut well inside the gap; when no pause exists in the window, hard-cut at `maxSegMs`
  and de-dup the overlapped seam word; verify monotonic stitched timestamps. (Problems.md)
- **WAV re-encode payload / decode portability** — WAV > opus; downsample to 16 kHz mono; decode is
  best-effort across Chrome (webm/opus) and Safari (mp4/aac), with a single-call fallback if
  `decodeAudioData` throws.
- **Stress on unvoiced/sparse-pitch words** — degrade to loudness+duration; neutral default when
  empty.
- **Filler-gap false positives (breaths, dramatic pauses)** — conservative thresholds, require
  voiced energy + near-flat pitch, de-dup vs pause + STT fillers, low confidence.
- **Multi-call cost/latency** — 2 Gemini calls + N parallel chunk STT calls; concurrent,
  `allSettled`-style independent degrade so a partial failure still returns a report; the existing
  `transcribing`/`reportPending` states cover the longer pipeline.
