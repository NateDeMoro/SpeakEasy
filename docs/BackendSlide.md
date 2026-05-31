# Slide: "How the Coach Decides"

Content + layout spec for one pitch slide that shows judges *specifically* how the
backend turns audio into coaching — how **tone** is calculated, and how
**real-time metrics** become decisions ("too fast", "monotone", etc.).

Build the actual PowerPoint/Slides slide from this. Numbers are pulled from real code
constants — see **Source of truth** to re-verify before presenting.

---

## Title
**How the Coach Decides**
*One mic stream, two decision engines*

---

## Lane ① — Realtime nudges (browser, live)

**Tagline:** Measure → compare to a target band → one gentle nudge. All on-device at
4–10 Hz, no network round-trip.

**Mini-flow (left → right):**
`Mic → 4 signal processors (volume · pitch · pace · pauses) → rule engine → at most one nudge`

**Signal → decision chips:**

| When we measure… | We say… |
|---|---|
| Pace **> 2.2 syllables/s** | "Ease off the pace" *(too fast)* |
| Pitch variation **< 8 Hz** | "Add some vocal variety" *(monotone)* |
| Volume **< −45 dBFS** | "Project a bit more" *(too quiet)* |
| Silence **> 2 s** | "Take it — then pick the thread back up" *(dead air)* |

**Wow line:** Hysteresis — a flag must persist ~1.5 s and then cools down, so it
coaches without nagging.

---

## Lane ② — Tone (Cloud Run + Gemini, on stop)

**Tagline:** Gemini judges *meaning*. The math judges *delivery*. The verdict is where
they disagree.

**Mini-flow (left → right):**
`Stop → Cloud Speech-to-Text (word-level transcript) → per-word stress score → 2 parallel Gemini calls (report + tone) → report`

**Callouts:**

- **Per-word stress** = blend of how *loud*, how *high-pitched*, and how *stretched*
  each word was vs. your baseline (z-scored → 0–1). Pure signal math — it weights the
  transcript so the words you stressed read heavier.
- **Tone:** Gemini compares the *sentiment* of your words against the pitch/volume/pace
  timeline → flags mismatches (e.g., your best result delivered in a monotone). The
  verdict comes from the *disagreement* between meaning and delivery.

---

## Footer — Google tech
`Cloud Speech-to-Text · Gemini · Cloud Run · Firebase`

---

## Visual direction
- Two horizontal bands, thin divider between. Each band reads left → right as a 3-step
  pipeline: inputs → decision box → output. Lane ① output = a phone-style nudge bubble;
  Lane ② output = a mini report card.
- Theme: Linear near-black tokens already used by the web app (`design-md/`). Accent the
  two decision boxes; keep signal/input labels muted.
- One accent color per lane so the eye separates "live" from "post-session".

## Speaker notes (verbal backup)
"Everything you see live is computed in the browser — four DSP processors at up to
10 Hz, compared to target bands, surfaced as one nudge with hysteresis so it never
nags. When you stop, the take goes to Cloud Run: Speech-to-Text gives word timings, we
score each word's stress from loudness, pitch and duration to weight the transcript,
then two Gemini calls run in parallel. The clever part: Gemini only ever judges
*meaning* — it never sees the audio — so the tone verdict comes from the *disagreement*
between the sentiment of your words and how you actually delivered them."

---

## Source of truth (verify before presenting)
Every number traces to a real constant:

| Claim | Constant | File |
|---|---|---|
| Pace fast `> 2.2 sps`, slow `< 1.2 sps` | `PACE_FAST_MIN_SPS`, `PACE_SLOW_MAX_SPS` | `packages/shared/src/config.ts` |
| Monotone pitch σ `< 8 Hz` | `PITCH_MONOTONE_MAX_HZ` | `packages/shared/src/config.ts` |
| Quiet `< −45 dBFS`, dead-air `> 2000 ms` | `NUDGE_QUIET_DBFS`, `NUDGE_DEAD_AIR_MS` | `apps/web/src/config.ts` |
| Hysteresis: sustain `1500 ms`, cooldown `2500 ms` | `NUDGE_SUSTAIN_MS`, `NUDGE_COOLDOWN_MS` | `apps/web/src/config.ts` |
| Emit rates 4 Hz pace / 10 Hz pitch | `PACE_EMIT_INTERVAL_MS=250`, `PITCH_EMIT_INTERVAL_MS=100` | `apps/web/src/config.ts` |
| Nudge rules (the threshold→message mapping) | — | `apps/web/src/audio/NudgeEngine.ts` |
| Stress = z-scored loud+pitch+duration (weights 1.0 / 0.8 / 0.6) | `STRESS_W_LOUD/PITCH/DURATION` | `apps/web/src/config.ts`, `apps/web/src/audio/stress.ts` |
| 2 parallel Gemini calls (report + tone); only `strong` mismatches surfaced, capped | `MAX_TONE_FINDINGS=2` | `apps/api/src/aggregate/runAggregate.ts`, `apps/api/src/config.ts` |
| Gemini tone temp 0.2 | `GEMINI_TONE_TEMPERATURE` | `apps/api/src/config.ts` |
| STT = Cloud Speech-to-Text v2, word time offsets | `enableWordTimeOffsets` | `apps/api/src/stt/transcribe.ts` |
