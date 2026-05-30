import type { ChannelDescriptor, Sample } from '@quack/shared';

/** One analysis frame: time-domain samples plus timing. */
export interface AudioFrame {
  /** Time-domain waveform, values roughly -1..1. */
  time: Float32Array;
  sampleRate: number;
  /** Milliseconds from session start at this frame. */
  tMs: number;
}

/**
 * A stateful signal processor. `process` updates live fields and returns zero or more samples
 * to append to this processor's channel (already throttled — UI reads live fields every frame,
 * the recorder only stores the returned samples).
 */
export interface SignalProcessor {
  readonly descriptor: ChannelDescriptor;
  process(frame: AudioFrame): Sample[];
  reset(): void;
}

/** Live values for the dashboard, refreshed every animation frame. */
export interface LiveSnapshot {
  tMs: number;
  volumeDbfs: number;
  paceSps: number;
  inDeadAir: boolean;
  deadAirMs: number;
}
