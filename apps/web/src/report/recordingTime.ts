/**
 * Recording-time readout: total elapsed wall-clock time of a rehearsal, optionally graded against
 * the user's target length (`ContextFields.goalSeconds`). Pure + deterministic so the report hero
 * renders identically for a just-finished session and a stored one.
 *
 * use when: rendering the recording-time hero stat at the top of the report.
 */

import type { Verdict } from './metrics.js';

/** Within this fraction of the goal → on target. */
const NEAR = 0.1;
/** Beyond NEAR but within this fraction → a bit under/over; past it → well under/over. */
const FAR = 0.25;

export interface RecordingTimeReadout {
  /** mm:ss display, or an em-dash when nothing was recorded. */
  display: string;
  /** False when there is no completed recording (stub-first: never show a bare 0). */
  measured: boolean;
  /** Set only when a goal was provided and the time is measured. */
  verdict?: Verdict;
  /** Short label, e.g. 'on target' / 'under goal' / 'over goal'. */
  label?: string;
}

/** mm:ss for a millisecond duration. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Grade elapsed recording time against an optional goal. With no goal (or no recording), returns a
 * plain readout and no verdict; otherwise color-codes by how far the time deviates from the goal.
 */
export function recordingTimeReadout(
  durationMs: number | null,
  goalSeconds?: number,
): RecordingTimeReadout {
  if (!durationMs || durationMs <= 0) return { display: '—', measured: false };
  const display = fmtClock(durationMs);
  if (!goalSeconds || goalSeconds <= 0) return { display, measured: true };

  const ratio = durationMs / 1000 / goalSeconds;
  const dev = Math.abs(ratio - 1);
  const verdict: Verdict = dev <= NEAR ? 'good' : dev <= FAR ? 'watch' : 'flag';
  const label = verdict === 'good' ? 'on target' : ratio < 1 ? 'under goal' : 'over goal';
  return { display, measured: true, verdict, label };
}
