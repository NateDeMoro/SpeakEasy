import type { LiveSnapshot } from '../audio/types.js';
import {
  PITCH_MONOTONE_MAX_HZ as PITCH_MONOTONE_MAX,
  PITCH_VARIED_MAX_HZ as PITCH_VARIED_MAX,
} from '@quack/shared';
import {
  VOL_FLOOR_DB,
  VOL_CEIL_DB,
  VOL_TOO_QUIET_FRAC,
  VOL_TOO_LOUD_FRAC,
  PACE_IDLE_MAX,
  PACE_SLOW_MAX,
  PACE_LITTLE_SLOW_MAX,
  PACE_GOOD_MAX,
  PACE_LITTLE_FAST_MAX,
} from '../config.js';
import { useSpokenCue } from '../coach/useSpokenCue.js';

// --- volume: map a speaking dBFS range to a positive 0..100 level --------------

function volumeLevel(dbfs: number): number {
  const frac = (dbfs - VOL_FLOOR_DB) / (VOL_CEIL_DB - VOL_FLOOR_DB);
  return Math.max(0, Math.min(1, frac));
}

function levelColor(frac: number): string {
  if (frac < VOL_TOO_QUIET_FRAC) return 'var(--c-meter-watch)'; // too quiet
  if (frac > VOL_TOO_LOUD_FRAC) return 'var(--c-meter-flag)'; // clipping-loud
  return 'var(--c-meter-good)';
}

// --- pace: bucket the (device-dependent) syllable rate into categories ---------
// Tune these in `../config.js` by watching the muted raw value while speaking normally vs. fast.
const PACE_SEGMENTS = [
  { key: 'slow', label: 'slow' },
  { key: 'a-little-slow', label: 'a little slow' },
  { key: 'good', label: 'good' },
  { key: 'a-little-fast', label: 'a little fast' },
  { key: 'fast', label: 'fast' },
] as const;
type PaceCategory = (typeof PACE_SEGMENTS)[number]['key'];

function paceCategory(sps: number): PaceCategory | null {
  if (sps < PACE_IDLE_MAX) return null;
  if (sps < PACE_SLOW_MAX) return 'slow';
  if (sps < PACE_LITTLE_SLOW_MAX) return 'a-little-slow';
  if (sps <= PACE_GOOD_MAX) return 'good';
  if (sps <= PACE_LITTLE_FAST_MAX) return 'a-little-fast';
  return 'fast';
}

/** Human-readable label for the active pace category, for the hint line. */
function paceLabel(key: PaceCategory): string {
  return PACE_SEGMENTS.find((s) => s.key === key)!.label;
}

// --- pitch: bucket the rolling variation (std, Hz) into categories --------------
// Monotone/varied boundaries come from `@quack/shared` (shared with the nudge + report).
const PITCH_SEGMENTS = ['monotone', 'varied', 'expressive'] as const;
type PitchCategory = (typeof PITCH_SEGMENTS)[number];

function pitchCategory(varHz: number): PitchCategory | null {
  if (varHz <= 0) return null;
  if (varHz < PITCH_MONOTONE_MAX) return 'monotone';
  if (varHz < PITCH_VARIED_MAX) return 'varied';
  return 'expressive';
}

/** Reactive orb tint behind the nudge — calm atmospheric feedback, decoration only. */
function orbState(snapshot: LiveSnapshot): 'idle' | 'slow' | 'good' | 'fast' {
  const pace = paceCategory(snapshot.paceSps);
  if (!pace) return 'idle';
  if (pace === 'slow' || pace === 'a-little-slow') return 'slow';
  if (pace === 'good') return 'good';
  return 'fast';
}

/** A single glanceable cue: colored dot + short label, no raw numbers. */
function Cue({ label, color, state }: { label: string; color?: string; state: string }) {
  return (
    <div className="cue">
      <span className="cue__dot" style={color ? { backgroundColor: color } : undefined} />
      <span className="cue__label">{label}</span>
      <span className="cue__state">{state}</span>
    </div>
  );
}

export interface DashboardProps {
  snapshot: LiveSnapshot;
}

/**
 * Live rehearsal screen: the single calm nudge is the centerpiece (over a reactive atmospheric
 * orb). Pace and pitch keep their segmented light-up meters; volume and dead air sit in a thin
 * peripheral strip. Raw numbers move to the dev readout.
 */
export function Dashboard({ snapshot }: DashboardProps) {
  const frac = volumeLevel(snapshot.volumeDbfs);
  const pace = paceCategory(snapshot.paceSps);
  const pitch = pitchCategory(snapshot.pitchVarHz);
  // A spoken cue (when enabled) briefly takes over the hero, in place of the calm nudge.
  const spokenCue = useSpokenCue(snapshot);

  return (
    <div className="live">
      <div className={`nudge nudge--hero orb orb--${orbState(snapshot)}`} aria-live="polite">
        {spokenCue ? (
          <span className="nudge__text">{spokenCue}</span>
        ) : snapshot.nudge ? (
          <span className="nudge__text">{snapshot.nudge}</span>
        ) : (
          <span className="nudge__text nudge__text--idle">You're doing fine — keep going.</span>
        )}
      </div>

      <div className="meters">
        <div className="card">
          <p className="card__label">Pace</p>
          <div className="segments">
            {PACE_SEGMENTS.map((seg) => (
              <div
                key={seg.key}
                className={`segment segment--${seg.key}${pace === seg.key ? ' segment--active' : ''}`}
              >
                {seg.label}
              </div>
            ))}
          </div>
          <span className="card__hint">{pace ? `${paceLabel(pace)} pace` : 'waiting for speech'}</span>
        </div>

        <div className="card">
          <p className="card__label">Pitch variation</p>
          <div className="segments">
            {PITCH_SEGMENTS.map((seg) => (
              <div
                key={seg}
                className={`segment segment--pitch-${seg}${pitch === seg ? ' segment--active' : ''}`}
              >
                {seg}
              </div>
            ))}
          </div>
          <span className="card__hint">
            {pitch ? `${pitch} delivery` : 'waiting for voiced speech'}
          </span>
        </div>
      </div>

      <div className="cuestrip">
        <div className="cue">
          <span className="cue__label">Volume</span>
          <div className="cue__bar">
            <div
              className="cue__bar-fill"
              style={{ width: `${Math.round(frac * 100)}%`, backgroundColor: levelColor(frac) }}
            />
          </div>
        </div>
        <Cue
          label="Dead air"
          color={snapshot.inDeadAir ? 'var(--c-meter-flag)' : 'var(--c-hairline-strong)'}
          state={snapshot.inDeadAir ? `${(snapshot.deadAirMs / 1000).toFixed(1)}s silent` : 'speaking'}
        />
      </div>

      {import.meta.env.DEV && (
        <p className="live__dev">
          dev · {snapshot.volumeDbfs.toFixed(0)} dBFS · {snapshot.paceSps.toFixed(1)} syll/s ·{' '}
          {Math.round(snapshot.pitchVarHz)} Hz var
        </p>
      )}
    </div>
  );
}
