import {
  SCHEMA_VERSION,
  type ChannelDescriptor,
  type Sample,
  type SignalChannel,
  type SessionRecord,
  type Modality,
} from '@quack/shared';

/**
 * Accumulates per-channel time-series into a SessionRecord using the shared schema.
 *
 * use when: capturing a session — processors hand their samples here, and `finish()` returns a
 * well-formed (partial, Stage 0) SessionRecord. This is what proves the schema end-to-end.
 */
export class Recorder {
  private channels = new Map<string, SignalChannel>();
  private startEpochMs: number;
  private startedAtIso: string;

  /** `now` is injected (Date.now()) so the recorder stays pure/testable. */
  constructor(now: number, startedAtIso: string) {
    this.startEpochMs = now;
    this.startedAtIso = startedAtIso;
  }

  /** Register a channel before appending to it. Idempotent per descriptor id. */
  register(descriptor: ChannelDescriptor): void {
    if (!this.channels.has(descriptor.id)) {
      this.channels.set(descriptor.id, { descriptor, series: [] });
    }
  }

  /** Append samples to a registered channel. Samples must arrive in ascending `t`. */
  append(channelId: string, samples: Sample[]): void {
    if (samples.length === 0) return;
    const channel = this.channels.get(channelId);
    if (!channel) throw new Error(`Recorder: unknown channel "${channelId}"`);
    channel.series.push(...samples);
  }

  /** Milliseconds since session start, for stamping frames. */
  elapsedMs(now: number): number {
    return now - this.startEpochMs;
  }

  /** Produce the SessionRecord. Stage 0: channels only (no transcript/context yet). */
  finish(now: number, capturedModalities: Modality[]): SessionRecord {
    return {
      sessionId: this.startedAtIso, // simple unique id for Stage 0; replace with uuid in Stage 1
      schemaVersion: SCHEMA_VERSION,
      startedAt: this.startedAtIso,
      durationMs: now - this.startEpochMs,
      capturedModalities,
      channels: [...this.channels.values()],
    };
  }
}
