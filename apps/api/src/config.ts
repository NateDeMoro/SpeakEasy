/**
 * API tunables: STT lexicon/model and the Gemini report prompt. The single surface for the
 * server-side knobs that were previously scattered across stt/ and the aggregate.
 *
 * use when: tuning filler detection, the STT model, or the report's system instruction.
 */

/** Speech-to-Text recognition model. Supports phrase-set adaptation; NOT chirp/chirp_2. */
export const STT_MODEL = 'latest_long' as const;

/** Default Gemini model for the report; overridden by the `GEMINI_MODEL` env var. */
export const GEMINI_MODEL_DEFAULT = 'gemini-2.5-flash' as const;

/**
 * Non-lexical fillers plus the most common verbal crutch. Includes spelling variants because STT
 * picks one spelling and we can't predict which. Conservative overall to avoid over-flagging.
 */
export const FILLER_WORDS = new Set([
  'um', 'umm', 'uh', 'uhh', 'er', 'err', 'erm', 'ah', 'hmm', 'mm', 'mhm', 'like',
]);

/**
 * Speech-adaptation boost: biases STT toward emitting fillers instead of normalizing them away
 * (most ASR models drop unstressed "um"/"uh"). Inline phrase set on the v2 RecognitionConfig.
 * Boost is ~0–20; higher = more likely emitted but more false positives. Tune from real recordings.
 * NOTE: supported by `latest_long`/`latest_short`; NOT by chirp/chirp_2.
 */
export const FILLER_BOOSTS: { value: string; boost: number }[] = [
  { value: 'um', boost: 18 },
  { value: 'umm', boost: 18 },
  { value: 'uh', boost: 18 },
  { value: 'uhh', boost: 18 },
  { value: 'er', boost: 15 },
  { value: 'erm', boost: 15 },
  { value: 'hmm', boost: 12 },
  { value: 'mm', boost: 10 },
];

/**
 * System instruction for the Gemini delivery report. The model receives the session's channel
 * summaries, transcript, planned material, and audience/setting context, and must return JSON
 * matching the Stage-2 subset of AggregateReport (summary, prioritizedAdvice, metrics, coverage).
 */
export const GEMINI_SYSTEM_INSTRUCTION = `You are a speech-delivery coach who calibrates every judgment to the speaker's specific audience and setting. The right pace, volume, formality, and structure depend on who is listening and why.

You receive per-channel delivery summaries (stats, a coarse timeline, and notable events), the full transcript, the planned material, and the audience/setting context.

First infer from the audience/setting what "good" looks like for THIS talk (energy, formality, density, length). Then evaluate against that target, not a generic ideal.

PACE: when an "Authoritative pace reading" (real words/min) is provided, it is the single source of truth for pace — use its average, per-quarter verdicts, and bands for the summary, advice, and the pace metric. Do NOT judge pace from the syllable-rate channel (audio.pace), which is a coarse live proxy that can disagree. Calibrate whether that WPM is actually too fast/slow to the audience, but never contradict its direction (e.g. don't call the talk slow when the reading says fast).

Return ONLY JSON matching the provided schema:
- summary: 2-3 sentences on how well the delivery fits this audience and setting.
- prioritizedAdvice: highest-leverage adjustments for this audience first; each detail explains why it matters for these listeners; evidence[] cites channel ids (e.g. "audio.pace") or short transcript quotes.
- metrics: one readout per signal present; verdict good | watch | flag judged against the audience-appropriate target, not an absolute. Note in value when a reading is fine for this setting even if unusual. Do not invent metrics for absent channels.
- coverage: pointsCovered (planned points actually delivered), pointsMissed (planned points skipped), deviations[] (notable off-script tangents), and runningLong (true if the talk clearly over/under-ran the material) vs. the planned material and the audience's needs.

If audience/setting is missing, assume a general professional audience and say so in the summary. Never fabricate quotes or numbers.`;

// --- Stage 3 multi-call: emphasis + tone -----------------------------------------
// runAggregate fires three independently-degrading Gemini calls (report + emphasis + tone). The
// emphasis call is span-extraction only (low temp, deterministic): the verdict is computed in code
// from the browser-measured per-word `stress`, so the model never sees or scores delivery numbers.

/** Low temp — emphasis is near-deterministic span extraction, not creative writing. */
export const GEMINI_EMPHASIS_TEMPERATURE = 0.1;
/** Tone/sentiment is subjective; a little more latitude than emphasis, less than the main report. */
export const GEMINI_TONE_TEMPERATURE = 0.3;

/** Code-side emphasis verdict bands (importance vs delivered stress, both 0..1). */
export const EMPHASIS_UNDER_DELTA = 0.35; // important but flat: importance − delivered ≥ this
export const EMPHASIS_OVER_DELTA = 0.35; // stressed but unimportant: delivered − importance ≥ this

/**
 * A phrase is graded by its PEAK option word, so emphasis can land on any of its content words.
 * `under` fires once per phrase only when no option word cleared the bar; `over` is tightened to a
 * genuine stress spike (absolute floor) so a normal-stress unimportant word isn't flagged. Both
 * lists are capped so the card stays glanceable rather than flagging every word.
 */
export const EMPHASIS_OVER_MIN_DELIVERED = 0.66; // over needs a real spike, not just > importance
export const EMPHASIS_MAX_UNDER = 8;
export const EMPHASIS_MAX_OVER = 3;

/**
 * Low-information function words are never emphasis options (you don't "stress 'the'") and never
 * trigger an over-flag. Negations/quantifiers are deliberately kept — they can carry the emphasis.
 */
export const EMPHASIS_STOPWORDS = new Set<string>([
  'the', 'a', 'an',
  'of', 'to', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'as', 'into', 'onto', 'than',
  'and', 'or', 'but', 'nor', 'so', 'yet', 'if', 'then',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'do', 'does', 'did',
  'has', 'have', 'had', "it's",
  'i', 'you', 'he', 'she', 'we', 'they', 'it', 'this', 'that', 'these', 'those',
  'my', 'your', 'his', 'her', 'our', 'their', 'its',
]);

/**
 * Emphasis call: extract the important phrases/spans from the DELIVERED TRANSCRIPT and rate
 * importance 0..1 (no uploaded script required). The model NEVER judges delivery — it receives no
 * per-word numbers; the match/under/over verdict is computed in code against the measured stress.
 * Keeps the LLM from drifting numbers it never receives and makes span extraction a small, cheap
 * output that scales to long talks. Sourcing phrases from the transcript also guarantees they align
 * back to spoken words (the prior span→word matching risk largely goes away).
 */
export const GEMINI_EMPHASIS_INSTRUCTION = `You identify which phrases in a delivered talk carry the most meaning, so a separate system can check whether the speaker vocally stressed them.
You receive the delivered transcript (and, if available, the speaker's planned material as optional extra context). Return ONLY JSON matching the schema: an "important" array of the phrases/spans that carry the point, each with an "importance" from 0 to 1 (1 = a key term, number, or claim the audience must catch; lower = supporting wording).
Rules:
- Extract phrases that ACTUALLY APPEAR in the delivered transcript, so they can be aligned to spoken words. Prefer short spans (1-4 words): key terms, names, numbers, claims, contrasts.
- Judge importance from the MEANING of what was said. Do NOT consider, score, or mention how the words were delivered (pace, volume, pitch, stress) — you receive no delivery data and must not infer any.
- Do not invent phrases that are absent from the transcript. Return at most ~25 phrases, highest-importance first.`;

/**
 * Tone call: detect tone–content mismatches (content sentiment vs delivered prosody). Subjective,
 * so the model owns these fields directly (unlike emphasis). Receives prosody timelines + material.
 */
export const GEMINI_TONE_INSTRUCTION = `You are a delivery coach detecting tone-content mismatches: places where the emotional content of WHAT was said does not match HOW it was delivered (the prosody).
You receive the transcript, prosody timelines (pitch/volume/pace — stats plus coarse time buckets), and the planned material. Return ONLY JSON matching the schema: a "toneContentMismatch" array.
For each clear mismatch, emit { tStartMs, tEndMs, contentSentiment, deliveredTone, detail }:
- contentSentiment: the sentiment the words imply (e.g. "excited", "urgent", "somber").
- deliveredTone: how the prosody actually came across over that window (e.g. "flat", "rushed", "monotone").
- detail: one concrete sentence naming the gap (e.g. "The strongest result was delivered in a monotone.").
Use the timeline timestamps (ms) to place each window. Only report genuine mismatches — if delivery matched content throughout, return an empty array. Never fabricate.`;
