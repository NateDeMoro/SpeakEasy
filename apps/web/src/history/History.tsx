import type { SessionListItem } from './sessions.js';
import { deliveryMetrics, VERDICT_COLOR } from '../report/metrics.js';
import './history.css';

function formatWhen(ms: number | null): string {
  if (!ms) return 'unknown date';
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export interface HistoryProps {
  items: SessionListItem[];
  loading: boolean;
  error: string | null;
  onSelect: (id: string) => void;
}

/** Past rehearsals list from `GET /api/sessions`. Click a row to open its full stored report. */
export function History({ items, loading, error, onSelect }: HistoryProps) {
  if (loading) return <p className="card__hint">Loading history…</p>;
  if (error) return <p className="error">{error}</p>;
  if (items.length === 0) {
    return (
      <p className="card__hint">
        No saved rehearsals yet. Finish a rehearsal to store its report here.
      </p>
    );
  }

  return (
    <div className="history">
      {items.map((s) => {
        // Same graded categories the report shows (volume/pace/pitch), not raw units.
        const metrics = deliveryMetrics(s.channelSummaries ?? []).filter((m) => m.verdict).slice(0, 3);
        return (
          <button key={s.sessionId} className="history__item" onClick={() => onSelect(s.sessionId)}>
            <span className="history__when">{formatWhen(s.createdAt)}</span>
            <span className="history__summary">{s.summary || 'No summary'}</span>
            <span className="history__metrics">
              {metrics.map((m, i) => (
                <span key={i} className="history__metric" title={m.detail}>
                  {m.verdict && (
                    <span
                      className="history__dot"
                      style={{ backgroundColor: VERDICT_COLOR[m.verdict] }}
                    />
                  )}
                  {m.label}: {m.value}
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}
