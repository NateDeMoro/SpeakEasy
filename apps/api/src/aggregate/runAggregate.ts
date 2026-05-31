import type {
  AggregateFn,
  AggregateInput,
  AggregateReport,
  ContextFields,
  EmphasisFinding,
  EmphasisOption,
  MetricReadout,
  MismatchFinding,
  Transcript,
  TranscriptWord,
} from '@quack/shared';
import {
  SCHEMA_VERSION,
  findSummary,
  PACE_WPM_SLOW_MAX,
  PACE_WPM_FAST_MIN,
} from '@quack/shared';
import { GoogleGenAI, Type } from '@google/genai';
import { getGeminiClient, loadGoogleConfig } from '../google/clients.js';
import {
  GEMINI_MODEL_DEFAULT,
  GEMINI_SYSTEM_INSTRUCTION,
  GEMINI_EMPHASIS_INSTRUCTION,
  GEMINI_TONE_INSTRUCTION,
  GEMINI_EMPHASIS_TEMPERATURE,
  GEMINI_TONE_TEMPERATURE,
  MAX_TONE_FINDINGS,
  EMPHASIS_UNDER_DELTA,
  EMPHASIS_UNDER_MIN_IMPORTANCE,
  EMPHASIS_OVER_DELTA,
  EMPHASIS_OVER_MIN_DELIVERED,
  EMPHASIS_MAX_UNDER,
  EMPHASIS_MAX_OVER,
  EMPHASIS_CLAUSE_MAX_WORDS,
  EMPHASIS_STOPWORDS,
} from '../config.js';

/** Unmatched words get this low baseline importance (the talk is mostly supporting wording). */
const EMPHASIS_BASELINE_IMPORTANCE = 0.2;

/**
 * Stage 3 aggregate: three independently-degrading Gemini calls (Vertex AI, JSON mode) run
 * concurrently and merged into one report:
 *   - report:   summary/advice/metrics/coverage (Stage 2, temp 0.4).
 *   - emphasis: extract important phrases from the material (temp 0.1); each phrase's under/over
 *               verdict is then computed IN CODE (phrase-level peak) against the measured `stress`.
 *   - tone:     content sentiment vs delivered prosody (temp 0.3; the model owns these).
 *
 * Each call is wrapped so a failure yields `undefined` rather than rejecting the whole report
 * (allSettled-style, not a bare Promise.all). When Gemini is disabled/unavailable the core report
 * falls back to `stubReport`; emphasis/tone simply stay absent (the cards fall back to placeholders).
 * Modality-agnostic throughout (reads channels via `findSummary`).
 */
export const runAggregate: AggregateFn = async (input): Promise<AggregateReport> => {
  const client = getGeminiClient();
  if (!client) return stubReport(input);
  const model = loadGoogleConfig().geminiModel ?? GEMINI_MODEL_DEFAULT;

  const [core, emphasisVsMeaning, toneContentMismatch] = await Promise.all([
    generateReport(client, model, input).catch((err) => {
      console.error('[aggregate] report call/parse failed, using stub:', err);
      return undefined;
    }),
    analyzeEmphasis(client, model, input).catch((err) => {
      console.error('[aggregate] emphasis call/parse failed, omitting:', err);
      return undefined;
    }),
    analyzeTone(client, model, input).catch((err) => {
      console.error('[aggregate] tone call/parse failed, omitting:', err);
      return undefined;
    }),
  ]);

  return {
    ...(core ?? stubReport(input)),
    emphasisVsMeaning,
    toneContentMismatch,
  };
};

/** The Stage-2 context-aware report (summary/advice/metrics/coverage). */
async function generateReport(
  client: GoogleGenAI,
  model: string,
  input: AggregateInput,
): Promise<AggregateReport> {
  const res = await client.models.generateContent({
    model,
    contents: buildPrompt(input),
    config: {
      systemInstruction: GEMINI_SYSTEM_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: REPORT_SCHEMA,
      temperature: 0.4,
    },
  });
  const text = res.text;
  if (!text) throw new Error('empty Gemini response');
  const parsed = JSON.parse(text) as Omit<AggregateReport, 'schemaVersion'>;
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: parsed.summary,
    // Floor: if the model returned no metrics, use the deterministic baseline.
    metrics: parsed.metrics?.length ? parsed.metrics : floorMetrics(input),
    prioritizedAdvice: parsed.prioritizedAdvice ?? [],
    coverage: parsed.coverage,
  };
}

/**
 * Emphasis-vs-meaning. Gemini returns only the important phrases from the DELIVERED TRANSCRIPT (no
 * uploaded script required, no delivery data); code then aligns them to transcript word spans and
 * grades each phrase by its peak option word (emphasis may land on any content word). Returns
 * undefined (→ placeholder card) when there is no transcript, or it carries no measured stress.
 */
async function analyzeEmphasis(
  client: GoogleGenAI,
  model: string,
  input: AggregateInput,
): Promise<EmphasisFinding[] | undefined> {
  const words = input.transcript?.words;
  if (!words || words.length === 0) return undefined;
  if (!words.some((w) => typeof w.stress === 'number')) return undefined; // no delivered stress

  const res = await client.models.generateContent({
    model,
    contents: buildEmphasisPrompt(input),
    config: {
      systemInstruction: GEMINI_EMPHASIS_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: EMPHASIS_SCHEMA,
      temperature: GEMINI_EMPHASIS_TEMPERATURE,
    },
  });
  const text = res.text;
  if (!text) throw new Error('empty emphasis response');
  const parsed = JSON.parse(text) as { important?: { phrase: string; importance: number }[] };
  return computeEmphasisVerdicts(words, parsed.important ?? [], input.transcript?.text);
}

/** Tone–content mismatch — subjective, so the model owns the fields directly. */
async function analyzeTone(
  client: GoogleGenAI,
  model: string,
  input: AggregateInput,
): Promise<MismatchFinding[] | undefined> {
  if (!input.transcript?.text) return undefined;
  const res = await client.models.generateContent({
    model,
    contents: buildTonePrompt(input),
    config: {
      systemInstruction: GEMINI_TONE_INSTRUCTION,
      responseMimeType: 'application/json',
      responseSchema: TONE_SCHEMA,
      temperature: GEMINI_TONE_TEMPERATURE,
    },
  });
  const text = res.text;
  if (!text) throw new Error('empty tone response');
  const parsed = JSON.parse(text) as { toneContentMismatch?: MismatchFinding[] };
  // Surface only the starkest mismatches: keep 'strong'-graded findings, capped.
  return (parsed.toneContentMismatch ?? [])
    .filter((m) => m.severity === 'strong')
    .slice(0, MAX_TONE_FINDINGS);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Normalize a token for span matching: lowercase, strip non-alphanumeric (keeps apostrophes). */
function normToken(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9']+/g, '');
}

interface PhraseSpan {
  start: number;
  len: number;
  importance: number;
}

/**
 * Words after which a clause/sentence ends, derived from the punctuated transcript `text` (the bare
 * word tokens carry no punctuation; the full text does). Aligns text tokens to words by a tolerant
 * two-pointer walk and marks a word as a clause end when its text token ends with . ! ? ; : or a
 * trailing comma. All-false when there is no text or no punctuation (caller then bounds the window).
 */
function clauseEnds(words: TranscriptWord[], text?: string): boolean[] {
  const ends = new Array<boolean>(words.length).fill(false);
  if (!text) return ends;
  const tokens = text.split(/\s+/).filter(Boolean);
  let t = 0;
  for (let i = 0; i < words.length; i++) {
    const target = normToken(words[i]!.text);
    if (!target) continue;
    for (let k = t; k < Math.min(tokens.length, t + 4); k++) {
      if (normToken(tokens[k]!) === target) {
        ends[i] = /[.!?;:,]$/.test(tokens[k]!);
        t = k + 1;
        break;
      }
    }
  }
  return ends;
}

/**
 * The clause that contains word `i`: expand left until the previous word ended a clause, right
 * until this word ends one, bounded to ±EMPHASIS_CLAUSE_MAX_WORDS so an unpunctuated transcript
 * still yields a phrase-sized window rather than the whole talk.
 */
function clauseContext(words: TranscriptWord[], ends: boolean[], i: number): string {
  let lo = i;
  for (let guard = EMPHASIS_CLAUSE_MAX_WORDS; lo > 0 && !ends[lo - 1] && guard > 0; guard--) lo--;
  let hi = i;
  for (let guard = EMPHASIS_CLAUSE_MAX_WORDS; hi < words.length - 1 && !ends[hi] && guard > 0; guard--) hi++;
  return words.slice(lo, hi + 1).map((w) => w.text).join(' ');
}

/**
 * Phrase-level emphasis grading. Important phrases are matched to contiguous transcript spans, then
 * each phrase is judged as a unit by its PEAK option word — emphasis is allowed to land on ANY of a
 * phrase's content words, so we flag `under` once per phrase only when none of them cleared the bar
 * (collapsing what used to be one flag per flat word). `over` is the inverse: an unimportant word
 * with a genuine stress spike, surfaced inside its surrounding clause (`context`) for readability.
 * Both lists are capped.
 */
function computeEmphasisVerdicts(
  words: TranscriptWord[],
  important: { phrase: string; importance: number }[],
  text?: string,
): EmphasisFinding[] {
  const n = words.length;
  const normWords = words.map((w) => normToken(w.text));
  const ends = clauseEnds(words, text);
  const importance = new Array<number>(n).fill(EMPHASIS_BASELINE_IMPORTANCE);
  const stressAt = (i: number) => clamp01(typeof words[i]!.stress === 'number' ? words[i]!.stress! : 0.5);

  // Match every important phrase to all of its contiguous spans; paint per-word importance (max).
  const spans: PhraseSpan[] = [];
  for (const { phrase, importance: impRaw } of important) {
    const imp = clamp01(impRaw);
    const tokens = phrase.split(/\s+/).map(normToken).filter(Boolean);
    if (tokens.length === 0) continue;
    for (let i = 0; i + tokens.length <= n; i++) {
      let hit = true;
      for (let j = 0; j < tokens.length; j++) {
        if (normWords[i + j] !== tokens[j]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      spans.push({ start: i, len: tokens.length, importance: imp });
      for (let j = 0; j < tokens.length; j++) importance[i + j] = Math.max(importance[i + j]!, imp);
    }
  }

  // Dedup overlapping spans (prefer longer, then higher importance) so one phrase = one finding.
  const covered = new Array<boolean>(n).fill(false);
  const kept: PhraseSpan[] = [];
  spans.sort((a, b) => b.len - a.len || b.importance - a.importance);
  for (const s of spans) {
    let overlaps = false;
    for (let k = s.start; k < s.start + s.len; k++) if (covered[k]) { overlaps = true; break; }
    if (overlaps) continue;
    for (let k = s.start; k < s.start + s.len; k++) covered[k] = true;
    kept.push(s);
  }

  // UNDER: one finding per phrase; passes when any content (option) word clears the bar.
  const under: EmphasisFinding[] = [];
  for (const s of kept) {
    if (s.importance < EMPHASIS_UNDER_MIN_IMPORTANCE) continue; // only genuinely important phrases
    const bar = s.importance - EMPHASIS_UNDER_DELTA; // a word "lands" the phrase if stress ≥ bar
    const optIdx: number[] = [];
    for (let k = s.start; k < s.start + s.len; k++) {
      if (!words[k]!.isDisfluency && !EMPHASIS_STOPWORDS.has(normWords[k]!)) optIdx.push(k);
    }
    if (optIdx.length === 0) continue; // all-stopword phrase: no real emphasis target
    const peak = Math.max(...optIdx.map(stressAt));
    if (peak >= bar) continue; // landed on at least one option → not notable
    const options: EmphasisOption[] = optIdx.map((k) => ({
      word: words[k]!.text,
      stress: stressAt(k),
      stressed: stressAt(k) >= bar,
    }));
    under.push({
      word: words.slice(s.start, s.start + s.len).map((w) => w.text).join(' '),
      tStartMs: words[s.start]!.tStartMs,
      importance: s.importance,
      delivered: peak,
      verdict: 'under',
      options,
    });
  }
  under.sort((a, b) => (b.importance - b.delivered) - (a.importance - a.delivered));

  // OVER: unimportant content words with a genuine stress spike (absolute floor + delta), each
  // surfaced inside its surrounding clause for context. Capped.
  const over: EmphasisFinding[] = [];
  words.forEach((w, i) => {
    if (w.isDisfluency || EMPHASIS_STOPWORDS.has(normWords[i]!)) return;
    const delivered = stressAt(i);
    const imp = importance[i]!;
    if (delivered < EMPHASIS_OVER_MIN_DELIVERED) return;
    if (delivered - imp < EMPHASIS_OVER_DELTA) return;
    over.push({
      word: w.text,
      tStartMs: w.tStartMs,
      importance: imp,
      delivered,
      verdict: 'over',
      context: clauseContext(words, ends, i),
    });
  });
  over.sort((a, b) => b.delivered - a.delivered);

  return [...under.slice(0, EMPHASIS_MAX_UNDER), ...over.slice(0, EMPHASIS_MAX_OVER)];
}

type PaceVerdict = 'slow' | 'good' | 'fast';

function wpmVerdict(wpm: number): PaceVerdict {
  if (wpm < PACE_WPM_SLOW_MAX) return 'slow';
  if (wpm > PACE_WPM_FAST_MIN) return 'fast';
  return 'good';
}

interface PaceReading {
  avgWpm: number;
  verdict: PaceVerdict;
  quarters: { wpm: number | null; verdict: PaceVerdict | null }[];
}

/**
 * Mirror the report's PaceTimeline (apps/web Report.tsx `paceBreakdown`): real words/min from the
 * transcript word timings, split into 4 equal-duration quarters, judged by the SHARED WPM bands.
 * This is injected into the report prompt as the authoritative pace reading so Gemini's summary and
 * advice agree with the on-screen pace card — rather than free-forming pace from the coarse
 * syllable-onset channel (audio.pace), which can diverge badly. Returns null for clips too short to
 * chunk (<8 content words), letting Gemini fall back to the syllable channel as before.
 */
function paceReading(transcript?: Transcript): PaceReading | null {
  const words = transcript?.words.filter((w) => !w.isDisfluency && w.tEndMs > w.tStartMs) ?? [];
  if (words.length < 8) return null;
  const t0 = words[0]!.tStartMs;
  const t1 = words[words.length - 1]!.tEndMs;
  const span = t1 - t0;
  if (span <= 0) return null;
  const chunk = span / 4;

  const quarters: PaceReading['quarters'] = [];
  for (let i = 0; i < 4; i++) {
    const absStart = t0 + i * chunk;
    const absEnd = i === 3 ? t1 : t0 + (i + 1) * chunk;
    const count = words.filter((w) => {
      const mid = (w.tStartMs + w.tEndMs) / 2;
      return mid >= absStart && (i === 3 ? mid <= absEnd : mid < absEnd);
    }).length;
    const minutes = (absEnd - absStart) / 60000;
    const wpm = minutes > 0 && count > 0 ? count / minutes : null;
    quarters.push({ wpm, verdict: wpm === null ? null : wpmVerdict(wpm) });
  }
  const avgWpm = words.length / (span / 60000);
  return { avgWpm, verdict: wpmVerdict(avgWpm), quarters };
}

/** The authoritative WPM pace block for the report prompt, or null when the clip is too short. */
function paceBlock(input: AggregateInput): string | null {
  const pace = paceReading(input.transcript);
  if (!pace) return null;
  const quarters = pace.quarters
    .map((q, i) => `Q${i + 1} ${q.wpm === null ? 'no speech' : `${Math.round(q.wpm)} wpm (${q.verdict})`}`)
    .join(', ');
  return (
    `Authoritative pace reading — real words/min from the transcript; ` +
    `bands: slow ≤${PACE_WPM_SLOW_MAX} wpm, fast >${PACE_WPM_FAST_MIN} wpm. ` +
    `USE THIS for every pace judgment (summary, advice, pace metric); do NOT infer pace from the ` +
    `syllable-rate channel (audio.pace), a coarse live proxy.\n` +
    `Average: ${Math.round(pace.avgWpm)} wpm (${pace.verdict}). Per quarter: ${quarters}.`
  );
}

/** Serialize the audience/setting fields into a prompt block, or null when none are set. */
function settingsBlock(settings?: ContextFields): string | null {
  if (!settings) return null;
  const s = settings;
  const lines = [
    s.audience && `Audience: ${s.audience}`,
    s.audienceSize && `Audience size: ${s.audienceSize}`,
    s.audienceBackground && `Audience background: ${s.audienceBackground}`,
    s.location && `Location: ${s.location}`,
    s.presentationType && `Presentation type: ${s.presentationType}`,
    s.notes && `Notes: ${s.notes}`,
  ].filter(Boolean);
  return lines.length ? `Audience/setting:\n${lines.join('\n')}` : null;
}

/** Serialize the aggregate input into a single prompt string for the report. */
function buildPrompt(input: AggregateInput): string {
  const parts: string[] = [];
  parts.push(`Session duration: ${(input.session.durationMs / 1000).toFixed(1)}s`);
  parts.push(`Captured modalities: ${input.session.capturedModalities.join(', ') || 'none'}`);
  parts.push(`Channel summaries (stats + timeline + events):\n${JSON.stringify(input.channelSummaries)}`);
  const pace = paceBlock(input);
  if (pace) parts.push(pace);
  if (input.transcript?.text) parts.push(`Transcript:\n${input.transcript.text}`);
  if (input.speechMaterial?.combinedText) {
    parts.push(`Planned material:\n${input.speechMaterial.combinedText}`);
  }
  const settings = settingsBlock(input.settings);
  if (settings) parts.push(settings);
  return parts.join('\n\n');
}

/** Emphasis prompt: delivered transcript (the source of importance) + optional material. No numbers. */
function buildEmphasisPrompt(input: AggregateInput): string {
  const parts: string[] = [];
  if (input.transcript?.text) {
    parts.push(`Delivered transcript (the source of importance):\n${input.transcript.text}`);
  }
  if (input.speechMaterial?.combinedText) {
    parts.push(`Planned material (optional extra context):\n${input.speechMaterial.combinedText}`);
  }
  const settings = settingsBlock(input.settings);
  if (settings) parts.push(settings);
  return parts.join('\n\n');
}

/** Tone prompt: transcript + prosody timelines (pitch/volume/pace) + planned material. */
function buildTonePrompt(input: AggregateInput): string {
  const parts: string[] = [];
  if (input.transcript?.text) parts.push(`Transcript:\n${input.transcript.text}`);
  const prosody = input.channelSummaries.filter((s) =>
    ['pitch', 'volume', 'pace'].includes(s.descriptor.signal),
  );
  parts.push(`Prosody timelines (pitch/volume/pace; stats + coarse time buckets):\n${JSON.stringify(prosody)}`);
  if (input.speechMaterial?.combinedText) {
    parts.push(`Planned material:\n${input.speechMaterial.combinedText}`);
  }
  return parts.join('\n\n');
}

/**
 * Deterministic volume/pause metrics — the floor so a bad LLM response never yields an empty
 * report. Reads channels via `findSummary` and degrades gracefully when a channel is absent.
 */
function floorMetrics(input: AggregateInput): MetricReadout[] {
  const volume = findSummary(input.channelSummaries, 'audio', 'volume');
  const pause = findSummary(input.channelSummaries, 'audio', 'pause');
  const metrics: MetricReadout[] = [];
  if (volume) {
    metrics.push({
      channelId: volume.descriptor.id,
      label: 'Mean volume',
      value: `${(volume.stats['mean'] ?? 0).toFixed(1)} dBFS`,
    });
  }
  if (pause) {
    metrics.push({
      channelId: pause.descriptor.id,
      label: 'Pauses',
      value: `${pause.stats['count'] ?? 0}`,
    });
  }
  return metrics;
}

/** Deterministic fallback used when Gemini is disabled or returns unusable output. */
function stubReport(input: AggregateInput): AggregateReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    summary: 'Stub report — Gemini disabled or unavailable.',
    prioritizedAdvice: [],
    metrics: floorMetrics(input),
  };
}

/**
 * Response schema for JSON mode — the Stage-2 subset of AggregateReport only. Stage 3/4 fields
 * (emphasisVsMeaning, toneContentMismatch, congruence) are deliberately omitted, and
 * `schemaVersion` is attached server-side after parsing (the model never sets it).
 */
const REPORT_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    summary: { type: Type.STRING },
    prioritizedAdvice: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          priority: { type: Type.NUMBER },
          title: { type: Type.STRING },
          detail: { type: Type.STRING },
          evidence: { type: Type.ARRAY, items: { type: Type.STRING } },
        },
        required: ['priority', 'title', 'detail'],
      },
    },
    metrics: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          channelId: { type: Type.STRING },
          label: { type: Type.STRING },
          value: { type: Type.STRING },
          verdict: { type: Type.STRING, enum: ['good', 'watch', 'flag'] },
        },
        required: ['channelId', 'label', 'value'],
      },
    },
    coverage: {
      type: Type.OBJECT,
      properties: {
        pointsCovered: { type: Type.ARRAY, items: { type: Type.STRING } },
        pointsMissed: { type: Type.ARRAY, items: { type: Type.STRING } },
        deviations: { type: Type.ARRAY, items: { type: Type.STRING } },
        runningLong: { type: Type.BOOLEAN },
      },
      required: ['pointsCovered', 'pointsMissed'],
    },
  },
  required: ['summary', 'prioritizedAdvice', 'metrics'],
};

/**
 * Emphasis call schema: the important phrases/spans from the material with an importance 0..1. The
 * model returns ONLY spans + importance — it never sees or scores delivery; the verdict is computed
 * in `computeEmphasisVerdicts` against the measured per-word stress.
 */
const EMPHASIS_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    important: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          phrase: { type: Type.STRING },
          importance: { type: Type.NUMBER },
        },
        required: ['phrase', 'importance'],
      },
    },
  },
  required: ['important'],
};

/** Tone call schema: content-sentiment vs delivered-prosody mismatch findings (subjective). */
const TONE_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    toneContentMismatch: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          tStartMs: { type: Type.NUMBER },
          tEndMs: { type: Type.NUMBER },
          contentSentiment: { type: Type.STRING },
          deliveredTone: { type: Type.STRING },
          detail: { type: Type.STRING },
          severity: { type: Type.STRING, enum: ['strong', 'moderate'] },
        },
        required: ['tStartMs', 'tEndMs', 'contentSentiment', 'deliveredTone', 'detail', 'severity'],
      },
    },
  },
  required: ['toneContentMismatch'],
};
