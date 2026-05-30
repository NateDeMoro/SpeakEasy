/**
 * Aggregate analysis contract — the post-talk Gemini report.
 *
 * use when: implementing the report in apps/api, or typing the response in apps/web.
 *
 * The input accepts an EXTENSIBLE set of channel summaries (any modality), so the audio-only
 * MVP and the Stage 4 audio+video build call the same `AggregateFn` with the same signature —
 * the visual channels simply appear as additional summaries. Analyses that depend on a
 * specific channel must look it up by modality/signal and degrade gracefully when it is absent.
 */

import type { Modality, Transcript } from './schema.js';
import type { ChannelSummary } from './summaries.js';
import type { ParsedMaterial, ContextFields } from './context.js';

export interface AggregateInput {
  session: {
    sessionId: string;
    durationMs: number;
    capturedModalities: Modality[];
  };
  /** Extensible — audio now, +visual later, with no signature change. */
  channelSummaries: ChannelSummary[];
  /** Word-level transcript. Stage 1+. */
  transcript?: Transcript;
  /** Uploaded slides/script/notes Gemini reads natively. */
  speechMaterial?: ParsedMaterial;
  /** Open-ended audience/setting fields, all optional. */
  settings?: ContextFields;
}

export interface AdviceItem {
  /** 1 = highest. The report lists these in priority order. */
  priority: number;
  title: string;
  detail: string;
  /** Optional supporting quotes/metrics, e.g. channel ids or transcript spans. */
  evidence?: string[];
}

export interface MetricReadout {
  /** Channel descriptor id this readout came from, e.g. 'audio.volume'. */
  channelId: string;
  label: string;
  value: string;
  verdict?: 'good' | 'watch' | 'flag';
}

/** Stage 2: how the delivered talk tracked against the planned material. */
export interface CoverageFinding {
  pointsCovered: string[];
  pointsMissed: string[];
  deviations?: string[];
  /** True if the talk ran notably long/short vs the material. */
  runningLong?: boolean;
}

/** Stage 3: did the speaker vocally stress the words that carry the point? */
export interface EmphasisFinding {
  word: string;
  tStartMs: number;
  /** Importance from content/material, 0..1. */
  importance: number;
  /** Acoustic stress actually delivered, 0..1. */
  delivered: number;
  /** under = important but flat; over = stressed but unimportant; match = aligned. */
  verdict: 'match' | 'under' | 'over';
}

/** Stage 3: content sentiment vs prosody (and, at Stage 4, facial channel). */
export interface MismatchFinding {
  tStartMs: number;
  tEndMs: number;
  contentSentiment: string;
  deliveredTone: string;
  detail: string;
}

/** Stage 4: congruence across channels; visual is an optional added signal. */
export interface CongruenceFinding {
  tStartMs: number;
  tEndMs: number;
  channels: string[];
  detail: string;
}

export interface AggregateReport {
  schemaVersion: number;
  summary: string;
  prioritizedAdvice: AdviceItem[];
  metrics: MetricReadout[];
  /** Stage 2. */
  coverage?: CoverageFinding;
  /** Stage 3. */
  emphasisVsMeaning?: EmphasisFinding[];
  /** Stage 3. */
  toneContentMismatch?: MismatchFinding[];
  /** Stage 4 (optional; present only when a visual channel was captured). */
  congruence?: CongruenceFinding[];
}

/** The aggregate entry point. Implemented in apps/api against Gemini. */
export type AggregateFn = (input: AggregateInput) => Promise<AggregateReport>;

/**
 * Look up a summary by modality/signal. use when: an analysis needs a specific channel and
 * must degrade gracefully if it was not captured (returns undefined rather than throwing).
 */
export function findSummary(
  summaries: ChannelSummary[],
  modality: Modality,
  signal: string,
): ChannelSummary | undefined {
  return summaries.find(
    (s) => s.descriptor.modality === modality && s.descriptor.signal === signal,
  );
}
