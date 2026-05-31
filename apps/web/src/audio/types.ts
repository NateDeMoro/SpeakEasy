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

/**
 * A high-bar spoken coaching cue. `seq` increments only when a *fresh* cue fires, so the consumer
 * can speak/alert exactly once per cue even though the snapshot updates every frame.
 */
export interface AudioCue {
  id: string;
  phrase: string;
  seq: number;
}

/** Live values for the dashboard, refreshed every animation frame. */
export interface LiveSnapshot {
  tMs: number;
  volumeDbfs: number;
  paceSps: number;
  inDeadAir: boolean;
  deadAirMs: number;
  /** Latest voiced pitch in Hz, or 0 when unvoiced. */
  pitchHz: number;
  /** Rolling std of recent voiced pitch (Hz) — the monotone vs. expressive proxy. */
  pitchVarHz: number;
  /** The single calm coaching nudge, or null when nothing to surface. */
  nudge: string | null;
  /** The latest spoken cue (opt-in audio layer); `seq` bumps only on a fresh fire. */
  audioCue: AudioCue | null;
}
