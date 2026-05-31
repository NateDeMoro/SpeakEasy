/**
 * High-bar spoken cue engine. Separate from NudgeEngine (which drives the on-screen line): this
 * decides when to *speak* a short correction aloud, so its bar is deliberately higher. A condition
 * must hold for AUDIO_CUE_SUSTAIN_MS (3 s) before a cue fires — real-time metrics jump around and
 * audio is intrusive — and after firing there is a long AUDIO_CUE_COOLDOWN_MS quiet gap so it never
 * nags. Only pace (too fast / too slow) and volume (too quiet / too loud) speak.
 *
 * The returned cue is latched: its `seq` bumps only on a fresh fire, so the snapshot consumer can
 * speak exactly once per cue even though `update` runs every frame.
 *
 * use when: driving the opt-in spoken coaching layer from the capture loop.
 */

import {
  PACE_IDLE_MAX_SPS as PACE_IDLE,
  PACE_SLOW_MAX_SPS as PACE_SLOW,
  PACE_FAST_MIN_SPS as PACE_FAST,
} from '@quack/shared';
import {
  AUDIO_CUE_SUSTAIN_MS as SUSTAIN_MS,
  AUDIO_CUE_COOLDOWN_MS as COOLDOWN_MS,
  AUDIO_CUE_LOUD_DBFS as LOUD_DBFS,
  NUDGE_QUIET_DBFS as QUIET_DBFS,
} from '../config.js';
import type { AudioCue } from './types.js';

/** Live values the cue rules read — a subset of LiveSnapshot's speaking-relevant fields. */
export interface CoachInputs {
  tMs: number;
  volumeDbfs: number;
  paceSps: number;
}

interface Rule {
  id: string;
  phrase: string;
  test: (i: CoachInputs) => boolean;
}

// Priority order: earlier wins when several conditions qualify at once. The `speaking` gate
// (paceSps >= PACE_IDLE) mirrors the nudge so volume cues never fire during silence.
const RULES: Rule[] = [
  { id: 'fast', phrase: 'Slow down.', test: (i) => i.paceSps > PACE_FAST },
  { id: 'slow', phrase: 'Speed up.', test: (i) => i.paceSps >= PACE_IDLE && i.paceSps < PACE_SLOW },
  { id: 'quiet', phrase: 'Speak up.', test: (i) => i.paceSps >= PACE_IDLE && i.volumeDbfs < QUIET_DBFS },
  { id: 'loud', phrase: 'Lower your voice.', test: (i) => i.paceSps >= PACE_IDLE && i.volumeDbfs > LOUD_DBFS },
];

export class SpeechCoach {
  private activeSince = new Map<string, number>();
  private cooldownUntil = 0;
  private seq = 0;
  private current: AudioCue | null = null;

  /** Feed the latest signals; returns the latched cue (its `seq` bumps only on a fresh fire). */
  update(i: CoachInputs): AudioCue | null {
    for (const rule of RULES) {
      if (rule.test(i)) {
        if (!this.activeSince.has(rule.id)) this.activeSince.set(rule.id, i.tMs);
      } else {
        this.activeSince.delete(rule.id);
      }
    }

    // During the cooldown after a cue, hold the last one — never speak again yet.
    if (i.tMs < this.cooldownUntil) return this.current;

    for (const rule of RULES) {
      const since = this.activeSince.get(rule.id);
      if (since !== undefined && i.tMs - since >= SUSTAIN_MS) {
        this.seq += 1;
        this.current = { id: rule.id, phrase: rule.phrase, seq: this.seq };
        this.cooldownUntil = i.tMs + COOLDOWN_MS;
        // Force a re-sustain before this rule can fire again.
        this.activeSince.delete(rule.id);
        return this.current;
      }
    }
    return this.current;
  }

  reset(): void {
    this.activeSince.clear();
    this.cooldownUntil = 0;
    this.seq = 0;
    this.current = null;
  }
}
