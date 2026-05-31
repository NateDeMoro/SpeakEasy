import type {
  AggregateFn,
  AggregateInput,
  AggregateReport,
  ContextFields,
  MetricReadout,
  MismatchFinding,
  Transcript,
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
  GEMINI_TONE_INSTRUCTION,
  GEMINI_TONE_TEMPERATURE,
  MAX_TONE_FINDINGS,
} from '../config.js';

/**
 * Stage 3 aggregate: two independently-degrading Gemini calls (Vertex AI, JSON mode) run
 * concurrently and merged into one report:
 *   - report: summary/advice/metrics/coverage (Stage 2, temp 0.4).
 *   - tone:   content sentiment vs delivered prosody (temp 0.3; the model owns these).
 *
 * Each call is wrapped so a failure yields `undefined` rather than rejecting the whole report
 * (allSettled-style, not a bare Promise.all). When Gemini is disabled/unavailable the core report
 * falls back to `stubReport`; tone simply stays absent (the card falls back to a placeholder).
 * Modality-agnostic throughout (reads channels via `findSummary`).
 */
export const runAggregate: AggregateFn = async (input): Promise<AggregateReport> => {
  const client = getGeminiClient();
  if (!client) return stubReport(input);
  const model = loadGoogleConfig().geminiModel ?? GEMINI_MODEL_DEFAULT;

  const [core, toneContentMismatch] = await Promise.all([
    generateReport(client, model, input).catch((err) => {
      console.error('[aggregate] report call/parse failed, using stub:', err);
      return undefined;
    }),
    analyzeTone(client, model, input).catch((err) => {
      console.error('[aggregate] tone call/parse failed, omitting:', err);
      return undefined;
    }),
  ]);

  return {
    ...(core ?? stubReport(input)),
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
 * (toneContentMismatch, congruence) are deliberately omitted, and `schemaVersion` is attached
 * server-side after parsing (the model never sets it).
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
