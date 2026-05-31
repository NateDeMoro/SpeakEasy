import type {
  ChannelDescriptor,
  EventSample,
  ScalarSample,
  SessionRecord,
  SignalChannel,
  Transcript,
} from '@quack/shared';
import { getChannel, isEventSample } from '@quack/shared';
import {
  GAP_MIN_MS,
  GAP_MAX_MS,
  GAP_PITCH_FLAT_HZ,
  PACE_SPEECH_GATE_DBFS,
} from '../config.js';

/** Descriptor for the filler channel derived from the transcript's disfluent words + voiced gaps. */
export const fillerDescriptor: ChannelDescriptor = {
  id: 'audio.filler',
  modality: 'audio',
  signal: 'filler',
  unit: 'count',
};

/**
 * Build the single `audio.filler` channel. STT-tagged disfluencies (`isDisfluency`) and any
 * acoustic gap fillers (Stage 3, Step 3) are merged into ONE channel — never a second filler
 * channel — and sorted by time. Gap fillers carry `payload.source = 'gap'` and a sub-1 confidence.
 *
 * use when: after STT returns and (optionally) `detectGapFillers` has run — append the result to
 * the SessionRecord's channels so the filler summarizer surfaces the combined count and timing.
 */
export function buildFillerChannel(
  transcript: Transcript,
  gapFillers: EventSample[] = [],
): SignalChannel<EventSample> {
  const sttFillers: EventSample[] = transcript.words
    .filter((w) => w.isDisfluency)
    .map((w) => ({
      t: w.tStartMs,
      d: Math.max(0, w.tEndMs - w.tStartMs),
      kind: 'filler',
      payload: { word: w.text },
    }));
  const series = [...sttFillers, ...gapFillers].sort((a, b) => a.t - b.t);
  return { descriptor: fillerDescriptor, series };
}

// --- acoustic gap detection (Step 3) ----------------------------------------

function scalarSeries(record: SessionRecord, id: string): ScalarSample[] {
  return (getChannel(record, id)?.series ?? []).filter((s): s is ScalarSample => !isEventSample(s));
}

function inWindow(series: ScalarSample[], tStartMs: number, tEndMs: number): ScalarSample[] {
  return series.filter((s) => s.t >= tStartMs && s.t <= tEndMs);
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function std(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
}

/** Channel-clock pause intervals from `audio.pause`. */
function pauseIntervals(record: SessionRecord): { start: number; end: number }[] {
  const ch = getChannel(record, 'audio.pause');
  if (!ch) return [];
  return ch.series.filter(isEventSample).map((e) => ({ start: e.t, end: e.t + (e.d ?? 0) }));
}

/**
 * Detect filler "um/uh" gaps STT dropped (Stage 1 known limitation). Scans each inter-word gap
 * `[prevWord.tEndMs, nextWord.tStartMs]` (clip clock; windows converted to channel clock with Step
 * 0's `offsetMs` before reading channels) and flags it when ALL hold:
 *   - duration in [GAP_MIN_MS, GAP_MAX_MS] (~200–600 ms)
 *   - mean `audio.volume` in-window above the voiced gate (voiced, not silence)
 *   - `audio.pitch` near-flat (in-window std below GAP_PITCH_FLAT_HZ), or no clear pitch (typical of "um")
 *   - not bordering an STT filler and not overlapping a committed `audio.pause`
 * Returns EventSamples (clip clock, like the STT fillers) tagged `{ source: 'gap' }`, c < 1.
 *
 * use when: after STT + stress, before `buildFillerChannel` — pass the result in to merge.
 */
export function detectGapFillers(record: SessionRecord, offsetMs: number): EventSample[] {
  const words = record.transcript?.words;
  if (!words || words.length < 2) return [];

  const volSeries = scalarSeries(record, 'audio.volume');
  const pitchSeries = scalarSeries(record, 'audio.pitch');
  const pauses = pauseIntervals(record);

  const out: EventSample[] = [];
  for (let i = 0; i < words.length - 1; i++) {
    const prev = words[i]!;
    const next = words[i + 1]!;
    // Already covered by an STT filler at either boundary → skip (avoid double-counting).
    if (prev.isDisfluency || next.isDisfluency) continue;

    const gapStartClip = prev.tEndMs;
    const gapEndClip = next.tStartMs;
    const dur = gapEndClip - gapStartClip;
    if (dur < GAP_MIN_MS || dur > GAP_MAX_MS) continue;

    const tStart = gapStartClip - offsetMs; // channel clock
    const tEnd = gapEndClip - offsetMs;

    // Overlaps a detected silence → it's a pause, not a voiced filler.
    if (pauses.some((p) => p.start < tEnd && p.end > tStart)) continue;

    const vol = inWindow(volSeries, tStart, tEnd);
    if (vol.length === 0) continue;
    if (mean(vol.map((s) => s.v)) <= PACE_SPEECH_GATE_DBFS) continue; // not voiced

    // Near-flat pitch (the drone of an "um"); if there's no clear pitch at all, still allow it.
    const pit = inWindow(pitchSeries, tStart, tEnd);
    if (pit.length >= 2 && std(pit.map((s) => s.v)) > GAP_PITCH_FLAT_HZ) continue;

    out.push({ t: gapStartClip, d: dur, kind: 'filler', payload: { source: 'gap' }, c: 0.5 });
  }
  return out;
}
