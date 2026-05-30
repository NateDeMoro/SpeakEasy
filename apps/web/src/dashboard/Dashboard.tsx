import type { LiveSnapshot } from '../audio/types.js';

// --- volume: map a speaking dBFS range to a positive 0..100 level --------------
const VOL_FLOOR_DB = -55; // ~silence reads 0
const VOL_CEIL_DB = 0; // only a shout / clipping reaches 100

function volumeLevel(dbfs: number): number {
  const frac = (dbfs - VOL_FLOOR_DB) / (VOL_CEIL_DB - VOL_FLOOR_DB);
  return Math.max(0, Math.min(1, frac));
}

function levelColor(frac: number): string {
  if (frac < 0.15) return 'var(--c-meter-watch)'; // too quiet
  if (frac > 0.95) return 'var(--c-meter-flag)'; // clipping-loud
  return 'var(--c-meter-good)';
}

// --- pace: bucket the (device-dependent) syllable rate into categories ---------
// Tune these by watching the muted raw value while speaking normally vs. fast.
const PACE_IDLE_MAX = 0.5; // below this: not really speaking
const PACE_SLOW_MAX = 1.2; // slow → good boundary
const PACE_GOOD_MAX = 2.2; // good → fast boundary
const PACE_SEGMENTS = ['slow', 'good', 'fast'] as const;
type PaceCategory = (typeof PACE_SEGMENTS)[number];

function paceCategory(sps: number): PaceCategory | null {
  if (sps < PACE_IDLE_MAX) return null;
  if (sps < PACE_SLOW_MAX) return 'slow';
  if (sps <= PACE_GOOD_MAX) return 'good';
  return 'fast';
}

/** Stage 0 live dashboard: three thin readouts from the audio snapshot. */
export function Dashboard({ snapshot }: { snapshot: LiveSnapshot }) {
  const frac = volumeLevel(snapshot.volumeDbfs);
  const level = Math.round(frac * 100);
  const category = paceCategory(snapshot.paceSps);

  return (
    <div className="meters">
      <div className="card">
        <p className="card__label">Volume</p>
        <span className="card__value">{level}</span>
        <span className="card__unit">/ 100&nbsp;&nbsp;({snapshot.volumeDbfs.toFixed(0)} dBFS)</span>
        <div className="bar">
          <div
            className="bar__fill"
            style={{ width: `${level}%`, backgroundColor: levelColor(frac) }}
          />
        </div>
      </div>

      <div className="card">
        <p className="card__label">Pace</p>
        <div className="segments">
          {PACE_SEGMENTS.map((seg) => (
            <div
              key={seg}
              className={`segment segment--${seg}${category === seg ? ' segment--active' : ''}`}
            >
              {seg}
            </div>
          ))}
        </div>
        <span className="card__hint">
          {category ? `${category} pace` : 'waiting for speech'} · raw {snapshot.paceSps.toFixed(1)} syll/s
        </span>
      </div>

      <div className="card">
        <p className="card__label">Dead air</p>
        <div className="deadair">
          <span
            className={`deadair__dot${snapshot.inDeadAir ? ' deadair__dot--active' : ''}`}
          />
          <span className="card__value" style={{ fontSize: 20 }}>
            {snapshot.inDeadAir ? `${(snapshot.deadAirMs / 1000).toFixed(1)}s silent` : 'speaking'}
          </span>
        </div>
      </div>
    </div>
  );
}
