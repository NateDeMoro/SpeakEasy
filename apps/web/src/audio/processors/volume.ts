import type { ScalarSample } from '@quack/shared';
import type { AudioFrame, SignalProcessor } from '../types.js';

const DBFS_FLOOR = -100;
const EMIT_INTERVAL_MS = 50; // record at ~20 Hz; UI reads `lastDbfs` every frame
const SMOOTH_ALPHA = 0.12; // EMA on linear RMS, ~120 ms time constant at 60 fps

/** RMS volume in dBFS on channel `audio.volume`. */
export class VolumeProcessor implements SignalProcessor {
  readonly descriptor = {
    id: 'audio.volume',
    modality: 'audio' as const,
    signal: 'volume',
    unit: 'dbfs',
    sampleHz: 1000 / EMIT_INTERVAL_MS,
  };

  /** Latest (smoothed) dBFS reading, for the live snapshot. */
  lastDbfs = DBFS_FLOOR;
  private smoothedRms = 0;
  private lastEmitMs = -Infinity;

  process(frame: AudioFrame): ScalarSample[] {
    const rms = frameRms(frame.time);
    // Smooth the linear amplitude BEFORE converting to dB — smoothing in dB would let the
    // log scale amplify noise-floor jitter. EMA flattens frame-to-frame flicker.
    this.smoothedRms += SMOOTH_ALPHA * (rms - this.smoothedRms);
    this.lastDbfs = toDbfs(this.smoothedRms);
    if (frame.tMs - this.lastEmitMs < EMIT_INTERVAL_MS) return [];
    this.lastEmitMs = frame.tMs;
    return [{ t: frame.tMs, v: this.lastDbfs }];
  }

  reset(): void {
    this.lastDbfs = DBFS_FLOOR;
    this.smoothedRms = 0;
    this.lastEmitMs = -Infinity;
  }
}

/** Linear RMS of a time-domain frame (0..~1). */
export function frameRms(time: Float32Array): number {
  let sumSq = 0;
  for (let i = 0; i < time.length; i++) sumSq += time[i]! * time[i]!;
  return Math.sqrt(sumSq / time.length);
}

/** Convert a linear RMS amplitude to dBFS, floored. */
export function toDbfs(rms: number): number {
  if (rms <= 0) return DBFS_FLOOR;
  return Math.max(DBFS_FLOOR, 20 * Math.log10(rms));
}

/** Convenience: dBFS straight from a frame (unsmoothed). use when: gating on instantaneous level. */
export function rmsDbfs(time: Float32Array): number {
  return toDbfs(frameRms(time));
}
