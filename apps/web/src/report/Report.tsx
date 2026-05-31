import type {
  AggregateReport,
  ChannelSummary,
  MismatchFinding,
  Transcript,
} from '@quack/shared';
import {
  PACE_WPM_SLOW_MAX,
  PACE_WPM_FAST_MIN,
} from '@quack/shared';
import { deliveryMetrics, VERDICT_COLOR, type Verdict } from './metrics.js';
import { recordingTimeReadout } from './recordingTime.js';
import './report.css';

// --- transcript-derived pace (real WPM, chunked over time) ----------------------

/** A verdict for a words/min rate, from the shared STT pace bands. */
function wpmVerdict(wpm: number): { category: string; verdict: Verdict } {
  if (wpm < PACE_WPM_SLOW_MAX) return { category: 'Too slow', verdict: 'watch' };
  if (wpm > PACE_WPM_FAST_MIN) return { category: 'Too fast', verdict: 'flag' };
  return { category: 'Good', verdict: 'good' };
}

interface PaceQuarter {
  /** 0..3. */
  index: number;
  /** Talk-relative window, ms (quarter 0 starts at 0). */
  startMs: number;
  endMs: number;
  wpm: number | null;
  category: string;
  verdict?: Verdict;
}

interface PaceBreakdown {
  quarters: PaceQuarter[];
  avgWpm: number;
}

/** mm:ss for a talk-relative offset. */
function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * Split the transcript into 4 equal-duration quarters of the spoken span and compute real WPM
 * per quarter (content words only — disfluencies excluded). Returns null for clips too short to
 * chunk meaningfully, so the caller falls back to the onset-proxy pace card.
 */
function paceBreakdown(transcript: Transcript): PaceBreakdown | null {
  const words = transcript.words.filter((w) => !w.isDisfluency && w.tEndMs > w.tStartMs);
  if (words.length < 8) return null;

  const t0 = words[0]!.tStartMs;
  const t1 = words[words.length - 1]!.tEndMs;
  const span = t1 - t0;
  if (span <= 0) return null;
  const chunk = span / 4;

  const quarters: PaceQuarter[] = [];
  for (let i = 0; i < 4; i++) {
    const absStart = t0 + i * chunk;
    const absEnd = i === 3 ? t1 : t0 + (i + 1) * chunk;
    const count = words.filter((w) => {
      const mid = (w.tStartMs + w.tEndMs) / 2;
      return mid >= absStart && (i === 3 ? mid <= absEnd : mid < absEnd);
    }).length;
    const minutes = (absEnd - absStart) / 60000;
    const wpm = minutes > 0 && count > 0 ? count / minutes : null;
    quarters.push(
      wpm === null
        ? { index: i, startMs: i * chunk, endMs: (i + 1) * chunk, wpm: null, category: '—' }
        : { index: i, startMs: i * chunk, endMs: (i + 1) * chunk, wpm, ...wpmVerdict(wpm) },
    );
  }

  return { quarters, avgWpm: words.length / (span / 60000) };
}

export interface ReportProps {
  summaries: ChannelSummary[] | null;
  transcript: Transcript | undefined;
  report: AggregateReport | null;
  reportPending: boolean;
  transcribing: boolean;
  /** Total elapsed recording time, ms. Null when no completed recording. */
  durationMs: number | null;
  /** Target talk length, seconds, if the user set one; grades the recording time. */
  goalSeconds?: number;
}

/**
 * Post-session report. Renders identically for a just-finished rehearsal and a stored one from
 * history (both supply summaries + transcript + report). Delivery-metric cards and the transcript
 * (with filler highlighting) are real (local summaries / Stage-1 STT); the context-aware advice
 * card is real (the Gemini report). The tone–content mismatch card renders only when the Gemini
 * report supplies real findings.
 */
export function Report({
  summaries,
  transcript,
  report,
  reportPending,
  transcribing,
  durationMs,
  goalSeconds,
}: ReportProps) {
  const pace = transcript ? paceBreakdown(transcript) : null;
  // Suppress the coarse syllable-onset pace card while transcribing so it doesn't flash a
  // throwaway value before the real per-quarter PaceTimeline (transcript-derived) is ready.
  const metrics = summaries ? deliveryMetrics(summaries, !!pace || transcribing) : [];
  const coverage = report?.coverage;
  const fillerCount = transcript?.words.filter((w) => w.isDisfluency).length ?? 0;
  const recTime = recordingTimeReadout(durationMs, goalSeconds);

  return (
    <div className="report">
      <div className="recording-time">
        <p className="recording-time__label">Recording time</p>
        <div className="recording-time__row">
          <span
            className="recording-time__value"
            style={recTime.verdict ? { color: VERDICT_COLOR[recTime.verdict] } : undefined}
          >
            {recTime.display}
          </span>
          {goalSeconds && goalSeconds > 0 && (
            <span className="recording-time__target">Target {fmtClock(goalSeconds * 1000)}</span>
          )}
          {recTime.verdict && recTime.label && (
            <span className="recording-time__verdict" style={{ color: VERDICT_COLOR[recTime.verdict] }}>
              <span
                className="recording-time__dot"
                style={{ backgroundColor: VERDICT_COLOR[recTime.verdict] }}
              />
              {recTime.label}
            </span>
          )}
        </div>
      </div>
      <h2 className="report__heading">Delivery</h2>
      {pace && <PaceTimeline breakdown={pace} />}
      <div className="report__metrics">
        {metrics.map((m) => (
          <div className="card metric" key={m.label}>
            <p className="card__label">{m.label}</p>
            <div className="metric__row">
              {m.verdict && (
                <span className="metric__dot" style={{ backgroundColor: VERDICT_COLOR[m.verdict] }} />
              )}
              {m.detail ? (
                <span className="metric__value metric__value--category" tabIndex={0}>
                  {m.value}
                  <span className="metric__detail" role="tooltip">
                    {m.detail}
                  </span>
                </span>
              ) : (
                <span className="metric__value">{m.value}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {transcribing ? (
        <div className="card transcript">
          <p className="card__label">Transcript</p>
          <p className="card__hint">Transcribing your rehearsal…</p>
        </div>
      ) : (
        transcript && (
          <div className="card transcript">
            <p className="card__label">
              Transcript · {fillerCount} filler{fillerCount === 1 ? '' : 's'}
            </p>
            {transcript.words.length === 0 ? (
              <p className="card__hint">No speech detected in the recording.</p>
            ) : (
              <p className="transcript__text">
                {transcript.words.map((w, i) => (
                  <span
                    key={i}
                    className={w.isDisfluency ? 'filler-word' : undefined}
                    // Stage 3: weight each word by its measured acoustic stress so the more
                    // strongly stressed words read heavier. No effect on old sessions (stress absent).
                    style={
                      typeof w.stress === 'number'
                        ? { opacity: 0.55 + 0.45 * w.stress, fontWeight: w.stress > 0.66 ? 600 : 400 }
                        : undefined
                    }
                  >
                    {w.text}{' '}
                  </span>
                ))}
              </p>
            )}
          </div>
        )
      )}

      <div className="card advice">
        <p className="card__label">Context-aware advice</p>
        {transcribing || reportPending ? (
          <p className="card__hint">
            {transcribing ? 'Transcribing your rehearsal…' : 'Analyzing delivery against your material…'}
          </p>
        ) : !report ? (
          <p className="card__hint">Report unavailable.</p>
        ) : (
          <>
            <p className="advice__summary">{report.summary}</p>

            {report.prioritizedAdvice.length > 0 && (
              <ol className="advice__list">
                {report.prioritizedAdvice.map((a, i) => (
                  <li key={i} className="advice__item">
                    <span className="advice__title">{a.title}</span>
                    <span className="advice__detail">{a.detail}</span>
                    {a.evidence && a.evidence.length > 0 && (
                      <span className="advice__evidence">{a.evidence.map(prettyEvidence).join(' · ')}</span>
                    )}
                  </li>
                ))}
              </ol>
            )}

            {coverage && (
              <div className="coverage">
                {coverage.pointsMissed.length > 0 && (
                  <CoverageList title="Missed" tone="flag" items={coverage.pointsMissed} />
                )}
                {coverage.pointsCovered.length > 0 && coverage.pointsMissed.length === 0 && (
                  <p className="card__hint">All parts covered.</p>
                )}
                {coverage.runningLong && (
                  <p className="card__hint">Ran notably long vs. the planned material.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {report?.toneContentMismatch && <ToneCard findings={report.toneContentMismatch} />}
    </div>
  );
}

/**
 * Tone–content mismatch: windows where the content's sentiment and the delivered prosody diverged.
 * Only rendered when the Gemini report supplies real findings.
 */
function ToneCard({ findings }: { findings: MismatchFinding[] }) {
  return (
    <div className="card mismatch">
      <p className="card__label">Tone–content mismatch</p>
      {findings.length === 0 ? (
        <p className="card__hint">Your delivered tone matched the content throughout.</p>
      ) : (
        <ul className="mismatch__list">
          {findings.map((f, i) => (
            <li className="mismatch__item" key={i}>
              <span className="mismatch__clock">{fmtClock(f.tStartMs)}</span>
              <span className="mismatch__tones">
                {f.contentSentiment} <span className="mismatch__arrow">→</span> {f.deliveredTone}
              </span>
              <span className="mismatch__detail">{f.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Real pace, split into 4 equal-duration quarters of the talk so the arc is visible (e.g. fast
 * out of the gate, settling after). Each quarter shows its verdict; hover/focus reveals the WPM
 * and the time window.
 */
function PaceTimeline({ breakdown }: { breakdown: PaceBreakdown }) {
  return (
    <div className="card pace">
      <p className="card__label">Pace over time · {Math.round(breakdown.avgWpm)} wpm avg</p>
      <div className="pace__quarters">
        {breakdown.quarters.map((q) => (
          <div className="pace__quarter" key={q.index} tabIndex={0}>
            <span
              className="pace__bar"
              style={{ backgroundColor: q.verdict ? VERDICT_COLOR[q.verdict] : 'var(--c-hairline-strong)' }}
            />
            <span className="pace__cat">{q.category}</span>
            <span className="pace__detail" role="tooltip">
              {q.wpm !== null ? `${Math.round(q.wpm)} wpm` : 'no speech'} · {fmtClock(q.startMs)}–
              {fmtClock(q.endMs)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Channel ids (`${modality}.${signal}`) the report cites as advice evidence → readable labels. */
const EVIDENCE_LABELS: Record<string, string> = {
  'audio.pace': 'Pace',
  'audio.volume': 'Volume',
  'audio.pitch': 'Pitch',
  'audio.pause': 'Pauses',
  'audio.filler': 'Fillers',
};

/** Replace any channel-id in an evidence string with its label ("audio.volume: 62 dBFS" →
 * "Volume: 62 dBFS"); transcript quotes pass through untouched. */
function prettyEvidence(e: string): string {
  let out = e;
  for (const [id, label] of Object.entries(EVIDENCE_LABELS)) out = out.split(id).join(label);
  return out;
}

function CoverageList({ title, tone, items }: { title: string; tone: Verdict; items: string[] }) {
  return (
    <div className="coverage__group">
      <span className="coverage__title" style={{ color: VERDICT_COLOR[tone] }}>
        {title}
      </span>
      <ul className="coverage__items">
        {items.map((it, i) => (
          <li key={i}>{it}</li>
        ))}
      </ul>
    </div>
  );
}

