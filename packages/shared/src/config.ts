/**
 * Cross-cutting verdict bands used by BOTH the live web layer (dashboard + nudge) and the
 * report. The single source of truth for pace/pitch thresholds so the live cues and the
 * after-the-fact report stay in lockstep.
 *
 * use when: a consumer needs a pace or pitch verdict threshold. Derive local presentation
 * buckets from these rather than redefining the numbers.
 *
 * Pure literals only — no imports, no I/O — so `@quack/shared` stays dependency-free.
 */

// --- pace verdict bands (syllables/sec) -----------------------------------------
/** Below this the speaker isn't really talking — suppress speaking-only verdicts. */
export const PACE_IDLE_MAX_SPS = 0.5;
/** At/under this reads as slow. */
export const PACE_SLOW_MAX_SPS = 1.2;
/**
 * Over this reads as fast. The live nudge fires at this boundary. NOTE: the web dashboard
 * intentionally colors "fast" only past its own higher-resolution presentation buckets
 * (1.95/2.4 syll/s), so the nudge nags slightly later than the meter shifts. Those buckets
 * are kept web-local on purpose — do not collapse them into this value.
 */
export const PACE_FAST_MIN_SPS = 2.2;

// --- STT-derived pace verdict bands (words/min) ---------------------------------
// Used by the post-session report, which counts transcript words over their time span (real WPM).
// The live layer above keeps the syllable-onset proxy — it has no word timings mid-talk. Tunable.
/** At/under this words/min reads as too slow. */
export const PACE_WPM_SLOW_MAX = 110;
/** Over this words/min reads as too fast. */
export const PACE_WPM_FAST_MIN = 190;

// --- pitch-variation verdict bands (Hz, rolling std) ----------------------------
/** Voiced pitch std below this reads as flat/monotone. */
export const PITCH_MONOTONE_MAX_HZ = 8;
/** Between monotone and this reads as varied; above this reads as expressive. */
export const PITCH_VARIED_MAX_HZ = 25;
