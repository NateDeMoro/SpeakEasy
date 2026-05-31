/**
 * Delivery-metric categories (Good / Too quiet / Too fast / Monotone …) computed deterministically
 * from the on-device channel summaries — the single source of truth shared by the report cards and
 * the history list, so both read identically (no Gemini-authored value strings, no raw units).
 *
 * use when: rendering a delivery metric (report metric cards, history row chips).
 */

import type { ChannelSummary } from '@quack/shared';
import {
  PACE_SLOW_MAX_SPS,
  PACE_FAST_MIN_SPS,
  PITCH_MONOTONE_MAX_HZ,
  PITCH_VARIED_MAX_HZ,
} from '@quack/shared';
import { VOL_FLOOR_DB, VOL_CEIL_DB, VOL_TOO_QUIET_FRAC, VOL_TOO_LOUD_FRAC } from '../config.js';

export type Verdict = 'good' | 'watch' | 'flag';

export const VERDICT_COLOR: Record<Verdict, string> = {
  good: 'var(--c-meter-good)',
  watch: 'var(--c-meter-watch)',
  flag: 'var(--c-meter-flag)',
};

export interface Metric {
  label: string;
  /** The glanceable category (e.g. "Too slow", "Good") for graded signals, else the raw value. */
  value: string;
  /** Specific reading (e.g. "1.8 syll/s") surfaced on hover for graded signals. */
  detail?: string;
  verdict?: Verdict;
}

/** Find a summary by its signal name (modality-agnostic). */
function findSig(summaries: ChannelSummary[], signal: string): ChannelSummary | undefined {
  return summaries.find((s) => s.descriptor.signal === signal);
}

/**
 * Real delivery metrics from the on-device channel summaries (not Gemini). `omitPace` drops the
 * coarse syllable-onset pace card when the STT transcript is available — the per-quarter WPM
 * timeline (PaceTimeline) replaces it.
 */
export function deliveryMetrics(summaries: ChannelSummary[], omitPace = false): Metric[] {
  const metrics: Metric[] = [];

  const volume = findSig(summaries, 'volume');
  if (volume) {
    const dbfs = volume.stats['mean'] ?? 0;
    const frac = (dbfs - VOL_FLOOR_DB) / (VOL_CEIL_DB - VOL_FLOOR_DB);
    const category =
      frac < VOL_TOO_QUIET_FRAC ? 'Too quiet' : frac > VOL_TOO_LOUD_FRAC ? 'Too loud' : 'Good';
    const verdict: Verdict =
      frac < VOL_TOO_QUIET_FRAC ? 'watch' : frac > VOL_TOO_LOUD_FRAC ? 'flag' : 'good';
    metrics.push({ label: 'Mean volume', value: category, detail: `${dbfs.toFixed(0)} dBFS`, verdict });
  }

  const pace = findSig(summaries, 'pace');
  if (pace && !omitPace) {
    const sps = pace.stats['mean'] ?? 0;
    const category = sps < PACE_SLOW_MAX_SPS ? 'Too slow' : sps > PACE_FAST_MIN_SPS ? 'Too fast' : 'Good';
    const verdict: Verdict = sps < PACE_SLOW_MAX_SPS ? 'watch' : sps > PACE_FAST_MIN_SPS ? 'flag' : 'good';
    metrics.push({ label: 'Pace', value: category, detail: `${sps.toFixed(1)} syll/s`, verdict });
  }

  const pitch = findSig(summaries, 'pitch');
  if (pitch) {
    const varHz = pitch.stats['std'] ?? 0;
    const category =
      varHz < PITCH_MONOTONE_MAX_HZ ? 'Monotone' : varHz < PITCH_VARIED_MAX_HZ ? 'Good' : 'Expressive';
    const verdict: Verdict = varHz < PITCH_MONOTONE_MAX_HZ ? 'watch' : 'good';
    metrics.push({ label: 'Pitch variation', value: category, detail: `${varHz.toFixed(0)} Hz`, verdict });
  }

  const pause = findSig(summaries, 'pause');
  if (pause) metrics.push({ label: 'Pauses', value: `${pause.stats['count'] ?? 0}` });

  const filler = findSig(summaries, 'filler');
  if (filler) {
    const count = filler.stats['count'] ?? 0;
    metrics.push({ label: 'Filler words', value: `${count}`, verdict: count > 4 ? 'watch' : 'good' });
  }

  return metrics;
}
