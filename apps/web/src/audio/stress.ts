/**
 * Per-word acoustic stress (Stage 3, Step 1).
 *
 * use when: after STT returns and the recorder↔clip offset is known — annotate each transcript
 * word with how vocally stressed it was (0..1) so the emphasis-vs-meaning analysis can compare
 * delivered stress against content importance. Mutates `record.transcript.words[].stress`.
 *
 * Stress is a weighted blend of three components, z-scored across the talk so it reads as
 * "relative to how this speaker spoke today" rather than absolute units:
 *   - loudness: mean dBFS in the word window (`audio.volume`)
 *   - pitch prominence: deviation + range vs the talk's median pitch (`audio.pitch`)
 *   - lengthening: word duration vs the talk's typical word duration
 * The blended z is logistic-squashed to 0..1. Degrades gracefully: unvoiced words (no pitch
 * samples) use loudness+duration only; a word with no overlapping volume/pitch samples → 0.5.
 */

import type { ScalarSample, SessionRecord } from '@quack/shared';
import { getChannel, isEventSample } from '@quack/shared';
import { STRESS_W_LOUD, STRESS_W_PITCH, STRESS_W_DURATION } from '../config.js';

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** z-score over the present (non-null) values; null entries stay null. All-equal → 0 (neutral). */
function zScoreSparse(xs: (number | null)[]): (number | null)[] {
  const present = xs.filter((x): x is number => x !== null);
  if (present.length === 0) return xs.map(() => null);
  const m = mean(present);
  const std = Math.sqrt(mean(present.map((x) => (x - m) ** 2)));
  return xs.map((x) => (x === null ? null : std === 0 ? 0 : (x - m) / std));
}

function logistic(z: number): number {
  return 1 / (1 + Math.exp(-z));
}

/** Scalar samples of a channel within [tStartMs, tEndMs] (channel clock). Series is sorted by t. */
function inWindow(series: ScalarSample[], tStartMs: number, tEndMs: number): ScalarSample[] {
  return series.filter((s) => s.t >= tStartMs && s.t <= tEndMs);
}

interface WordFeatures {
  /** Mean dBFS in the word window, or null when no volume samples overlap. */
  loud: number | null;
  /** Pitch prominence (max |dev from talk median| + in-window range), or null when unvoiced. */
  pitchProm: number | null;
  /** Word duration in ms (always present). */
  duration: number;
}

/**
 * Annotate `record.transcript.words[].stress` in place. `offsetMs` is Step 0's recorder↔clip
 * calibration: word times are clip-clock, so channel windows are `[tStart, tEnd] − offsetMs`.
 * No-op when there is no transcript.
 */
export function annotateStress(record: SessionRecord, offsetMs: number): void {
  const words = record.transcript?.words;
  if (!words || words.length === 0) return;

  const volSeries = (getChannel(record, 'audio.volume')?.series ?? []).filter(
    (s): s is ScalarSample => !isEventSample(s),
  );
  const pitchSeries = (getChannel(record, 'audio.pitch')?.series ?? []).filter(
    (s): s is ScalarSample => !isEventSample(s),
  );
  const talkPitchMedian = median(pitchSeries.map((s) => s.v));

  const feats: WordFeatures[] = words.map((w) => {
    const tStart = w.tStartMs - offsetMs;
    const tEnd = w.tEndMs - offsetMs;
    const vol = inWindow(volSeries, tStart, tEnd);
    const pit = inWindow(pitchSeries, tStart, tEnd);
    let pitchProm: number | null = null;
    if (pit.length > 0 && talkPitchMedian > 0) {
      const hzs = pit.map((s) => s.v);
      const maxDev = Math.max(...hzs.map((hz) => Math.abs(hz - talkPitchMedian)));
      const range = Math.max(...hzs) - Math.min(...hzs);
      pitchProm = maxDev + range;
    }
    return {
      loud: vol.length > 0 ? mean(vol.map((s) => s.v)) : null,
      pitchProm,
      duration: Math.max(0, w.tEndMs - w.tStartMs),
    };
  });

  const zLoud = zScoreSparse(feats.map((f) => f.loud));
  const zPitch = zScoreSparse(feats.map((f) => f.pitchProm));
  const zDur = zScoreSparse(feats.map((f) => f.duration));

  words.forEach((w, i) => {
    const f = feats[i]!;
    // No loudness and no pitch overlap → can't measure acoustic stress; stay neutral.
    if (f.loud === null && f.pitchProm === null) {
      w.stress = 0.5;
      return;
    }
    // Weighted mean of the available z-components (drop pitch's weight when unvoiced), squashed.
    let zSum = 0;
    let wSum = 0;
    if (zLoud[i] !== null) {
      zSum += STRESS_W_LOUD * zLoud[i]!;
      wSum += STRESS_W_LOUD;
    }
    if (zPitch[i] !== null) {
      zSum += STRESS_W_PITCH * zPitch[i]!;
      wSum += STRESS_W_PITCH;
    }
    if (zDur[i] !== null) {
      zSum += STRESS_W_DURATION * zDur[i]!;
      wSum += STRESS_W_DURATION;
    }
    w.stress = logistic(wSum > 0 ? zSum / wSum : 0);
  });
}
