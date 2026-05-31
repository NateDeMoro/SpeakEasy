/**
 * Browser audio thresholds — the single tunable surface for the on-device capture pipeline,
 * processors, dashboard, and nudge. Relocated here (no behavior change) so tuning is one file.
 *
 * Cross-cutting pace/pitch verdict bands live in `@quack/shared` (config.ts) and are imported
 * directly by the dashboard and nudge so the live cues and the report stay in lockstep.
 *
 * use when: tuning a live signal, the meters, or the nudge.
 */

// --- volume processor (audio/processors/volume.ts) ------------------------------
export const VOLUME_DBFS_FLOOR = -100; // lowest dBFS we report
export const VOLUME_EMIT_INTERVAL_MS = 50; // record at ~20 Hz; UI reads `lastDbfs` every frame
export const VOLUME_SMOOTH_ALPHA = 0.12; // EMA on linear RMS, ~120 ms time constant at 60 fps

// --- pause processor (audio/processors/pause.ts) --------------------------------
export const PAUSE_SILENCE_DBFS = -55; // below this loudness counts as silence
export const PAUSE_MIN_MS = 350; // a silence longer than this is committed as a pause event

// --- pace processor (audio/processors/pace.ts) ----------------------------------
export const PACE_EMIT_INTERVAL_MS = 250; // record pace 4x/sec
export const DEFAULT_PACE_WINDOW_MS = 5000; // sliding window for the rate estimate
export const PACE_FAST_ALPHA = 0.4; // fast envelope (~35 ms) — tracks the instantaneous signal
export const PACE_SLOW_ALPHA = 0.04; // slow baseline (~400 ms) — tracks running speech/background level
export const PACE_ONSET_FACTOR = 1.4; // fast envelope must exceed factor * baseline to mark an onset
export const PACE_SPEECH_GATE_DBFS = -50; // below this it's silence — no onsets (kills the idle floor)
export const PACE_MIN_ONSET_GAP_MS = 100; // refractory: caps the onset rate at ~10/s
export const PACE_SPS_SMOOTH_ALPHA = 0.15; // EMA on the output rate so the reading doesn't step

// --- pitch processor (audio/processors/pitch.ts) --------------------------------
export const PITCH_EMIT_INTERVAL_MS = 100; // record pitch ~10x/sec
export const PITCH_CLARITY_GATE = 0.8; // below this the pitch estimate is unreliable — ignore
export const PITCH_MIN_HZ = 70; // human speech floor; rejects rumble/DC
export const PITCH_MAX_HZ = 400; // human speech ceiling; rejects harmonics/hiss
export const DEFAULT_PITCH_WINDOW_MS = 5000; // rolling window for the pitch-variation (std) readout
export const PITCH_DISPLAY_ALPHA = 0.25; // EMA on the displayed Hz so it glides instead of stepping
export const PITCH_VOICED_HOLD_MS = 250; // keep showing the last pitch through brief unvoiced gaps

// --- capture loop (audio/AudioCapture.ts) ---------------------------------------
export const CAPTURE_DEAD_AIR_MS = 1200; // silence longer than this lights the dead-air indicator
export const FFT_SIZE = 2048;
export const RECORD_MIME_CANDIDATES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
];

// --- nudge engine (audio/NudgeEngine.ts) ----------------------------------------
export const NUDGE_SUSTAIN_MS = 1500; // condition must persist this long before nudging
export const NUDGE_COOLDOWN_MS = 2500; // quiet gap after a nudge clears
export const NUDGE_MAX_SHOW_MS = 8000; // stop showing a stuck nudge even if unresolved
export const NUDGE_QUIET_DBFS = -45; // volume threshold for the quiet nudge
export const NUDGE_DEAD_AIR_MS = 2000; // dead-air duration that triggers the nudge rule

// --- per-word acoustic stress (audio/stress.ts, Stage 3) ------------------------
// Weights for the three z-scored stress components, summed (weighted mean of available
// components) then logistic-squashed to 0..1. Tunable; pitch/duration weighted below loudness.
export const STRESS_W_LOUD = 1.0; // loudness: mean dBFS in the word window
export const STRESS_W_PITCH = 0.8; // pitch prominence: deviation + range vs the talk's median pitch
export const STRESS_W_DURATION = 0.6; // lengthening: word duration vs the talk's typical word duration

// --- acoustic filler-gap detection (audio/fillers.ts, Stage 3) ------------------
// Flag voiced inter-word gaps STT left untagged (durable fix for the Stage-1 filler miss).
// Conservative by design to avoid flagging breaths / dramatic pauses.
export const GAP_MIN_MS = 200; // shorter is between-word coarticulation, not a filler
export const GAP_MAX_MS = 600; // longer reads as a deliberate pause, not an "um"
export const GAP_PITCH_FLAT_HZ = 12; // in-window pitch std below this reads as the flat drone of an "um"
// The voiced gate reuses PACE_SPEECH_GATE_DBFS (the existing speech/silence floor) — a single source
// of truth rather than a third loudness threshold that can drift (see web CLAUDE.md).

// --- chunked long-form STT (audio/chunker.ts, Stage 3) --------------------------
// Sync STT caps inline audio at ~60s. Clips longer than this are sliced into <60s WAV segments
// (snapped to detected pauses), recognized in parallel, and stitched. Single source of truth for
// both the chunk gate (useAudioCapture) and the chunker's max segment length.
export const STT_MAX_SEGMENT_MS = 55000;

// --- dashboard meters (dashboard/Dashboard.tsx) ---------------------------------
export const VOL_FLOOR_DB = -55; // ~silence reads 0
export const VOL_CEIL_DB = 0; // only a shout / clipping reaches 100
// Volume verdict fractions of the floor→ceil range — shared by the live meter color and the
// report's "Too quiet / Good / Too loud" category so live and report stay in lockstep.
export const VOL_TOO_QUIET_FRAC = 0.15; // below this fraction of the speaking range reads as too quiet
export const VOL_TOO_LOUD_FRAC = 0.95; // above this reads as too loud / clipping
// Fine-grained pace presentation buckets — web-local on purpose. These intentionally diverge
// from the shared PACE_FAST_MIN_SPS (the nudge boundary): the meter shows "a little fast"
// between 1.95 and 2.4 before reading "fast", so it shifts before the nudge nags. See
// `@quack/shared` config.ts.
export const PACE_IDLE_MAX = 0.5; // below this: not really speaking
export const PACE_SLOW_MAX = 1.0; // slow → a little slow
export const PACE_LITTLE_SLOW_MAX = 1.45; // a little slow → good
export const PACE_GOOD_MAX = 2.3; // good → a little fast
export const PACE_LITTLE_FAST_MAX = 2.8; // a little fast → fast
