import type { EventSample } from '@quack/shared';
import type { AudioFrame, SignalProcessor } from '../types.js';
import { rmsDbfs } from './volume.js';

/** Below this loudness counts as silence. */
const SILENCE_DBFS = -55;
/** A silence longer than this is committed as a pause event. */
const MIN_PAUSE_MS = 350;

/**
 * Pause / dead-air detection on channel `audio.pause`. Emits one interval EventSample per
 * pause (on resumption). Live fields `inSilence` / `currentSilenceMs` drive the dead-air UI.
 */
export class PauseProcessor implements SignalProcessor {
  readonly descriptor = {
    id: 'audio.pause',
    modality: 'audio' as const,
    signal: 'pause',
    unit: 'bool',
  };

  inSilence = false;
  currentSilenceMs = 0;
  private silenceStartMs = 0;
  private lastTMs = 0;

  process(frame: AudioFrame): EventSample[] {
    const quiet = rmsDbfs(frame.time) < SILENCE_DBFS;
    this.lastTMs = frame.tMs;

    if (quiet) {
      if (!this.inSilence) {
        this.inSilence = true;
        this.silenceStartMs = frame.tMs;
      }
      this.currentSilenceMs = frame.tMs - this.silenceStartMs;
      return [];
    }

    // speech resumed — close any qualifying pause
    if (this.inSilence) {
      const duration = frame.tMs - this.silenceStartMs;
      this.inSilence = false;
      this.currentSilenceMs = 0;
      if (duration >= MIN_PAUSE_MS) {
        return [{ t: this.silenceStartMs, d: duration, kind: 'pause' }];
      }
    }
    return [];
  }

  /** Close an open pause at session end. use when: stopping capture. */
  flush(): EventSample[] {
    if (this.inSilence) {
      const duration = this.lastTMs - this.silenceStartMs;
      this.inSilence = false;
      this.currentSilenceMs = 0;
      if (duration >= MIN_PAUSE_MS) {
        return [{ t: this.silenceStartMs, d: duration, kind: 'pause' }];
      }
    }
    return [];
  }

  reset(): void {
    this.inSilence = false;
    this.currentSilenceMs = 0;
    this.silenceStartMs = 0;
    this.lastTMs = 0;
  }
}
