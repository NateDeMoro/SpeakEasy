/**
 * Channel summarization.
 *
 * use when: preparing aggregate input — the post-talk pipeline never ships raw time-series to
 * Gemini, only these compact summaries.
 *
 * Each signal registers a summarizer keyed by `descriptor.signal`. Adding a modality means
 * registering one more summarizer; `summarize()` dispatches generically, so the aggregate code
 * stays agnostic to which channels exist.
 */

import type { SignalChannel, Sample, ScalarSample, EventSample } from './schema.js';
import { isEventSample } from './schema.js';

export interface ChannelSummary {
  descriptor: SignalChannel['descriptor'];
  /** Signal-defined scalar stats (mean, std, p05, p95, count, …). */
  stats: Record<string, number>;
  /** Coarse time buckets so Gemini can see the arc without the full series. */
  timeline?: { tStartMs: number; tEndMs: number; value: number }[];
  /** Notable discrete events (pauses, fillers) worth surfacing individually. */
  events?: { tMs: number; durationMs?: number; kind: string; label?: string }[];
  /** Optional human/LLM-readable note. */
  notes?: string;
}

export type Summarizer = (ch: SignalChannel) => ChannelSummary;

// --- small stat helpers -----------------------------------------------------

function scalarValues(series: Sample[]): number[] {
  return series.filter((s): s is ScalarSample => !isEventSample(s)).map((s) => s.v);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const a = sorted[lo] ?? 0;
  const b = sorted[hi] ?? a;
  return a + (b - a) * (pos - lo);
}

/** Mean, std, min, max, p05, p95, count over a numeric array. */
export function basicStats(values: number[]): Record<string, number> {
  const count = values.length;
  if (count === 0) return { count: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / count;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / count;
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count,
    mean,
    std: Math.sqrt(variance),
    min: sorted[0]!,
    max: sorted[count - 1]!,
    p05: quantile(sorted, 0.05),
    p95: quantile(sorted, 0.95),
  };
}

/** Bucket a scalar series into `bucketCount` mean-valued time buckets for the timeline. */
function bucketScalar(
  series: ScalarSample[],
  bucketCount = 24,
): ChannelSummary['timeline'] {
  if (series.length === 0) return [];
  const tMin = series[0]!.t;
  const tMax = series[series.length - 1]!.t;
  const span = Math.max(1, tMax - tMin);
  const width = span / bucketCount;
  const sums = new Array(bucketCount).fill(0);
  const counts = new Array(bucketCount).fill(0);
  for (const s of series) {
    const idx = Math.min(bucketCount - 1, Math.floor((s.t - tMin) / width));
    sums[idx] += s.v;
    counts[idx] += 1;
  }
  const out: NonNullable<ChannelSummary['timeline']> = [];
  for (let i = 0; i < bucketCount; i++) {
    if (counts[i] === 0) continue;
    out.push({
      tStartMs: tMin + i * width,
      tEndMs: tMin + (i + 1) * width,
      value: sums[i] / counts[i],
    });
  }
  return out;
}

// --- summarizers ------------------------------------------------------------

/** Generic scalar summarizer: stats + bucketed timeline. Fallback for any scalar signal. */
const summarizeScalar: Summarizer = (ch) => {
  const scalars = ch.series.filter((s): s is ScalarSample => !isEventSample(s));
  return {
    descriptor: ch.descriptor,
    stats: basicStats(scalars.map((s) => s.v)),
    timeline: bucketScalar(scalars),
  };
};

/** Generic event summarizer: count + total/mean duration + surfaced events. */
const summarizeEvents: Summarizer = (ch) => {
  const events = ch.series.filter((s): s is EventSample => isEventSample(s));
  const durations = events.map((e) => e.d ?? 0);
  const total = durations.reduce((a, b) => a + b, 0);
  return {
    descriptor: ch.descriptor,
    stats: {
      count: events.length,
      totalDurationMs: total,
      meanDurationMs: events.length ? total / events.length : 0,
    },
    events: events.map((e) => ({
      tMs: e.t,
      durationMs: e.d,
      kind: e.kind,
      label: typeof e.payload?.['word'] === 'string' ? (e.payload['word'] as string) : undefined,
    })),
  };
};

/**
 * Registry keyed by `descriptor.signal`. Register new signals here as stages add them.
 * Audio MVP: volume + pace are scalar; pause + filler are event streams.
 */
export const summarizers: Record<string, Summarizer> = {
  volume: summarizeScalar,
  pitch: summarizeScalar,
  pace: summarizeScalar,
  pause: summarizeEvents,
  filler: summarizeEvents,
};

/**
 * Reduce a channel to a compact summary. Dispatches by `descriptor.signal`, falling back to a
 * scalar/event generic summarizer when the signal is unregistered — so an unknown future
 * channel still produces a usable summary instead of throwing.
 */
export function summarize(ch: SignalChannel): ChannelSummary {
  const registered = summarizers[ch.descriptor.signal];
  if (registered) return registered(ch);
  const looksLikeEvents = ch.series.length > 0 && isEventSample(ch.series[0]!);
  return looksLikeEvents ? summarizeEvents(ch) : summarizeScalar(ch);
}

/** Summarize every channel in a record. use when: assembling AggregateInput.channelSummaries. */
export function summarizeAll(channels: SignalChannel[]): ChannelSummary[] {
  return channels.map(summarize);
}
