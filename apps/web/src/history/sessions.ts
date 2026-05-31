import type {
  AggregateReport,
  ChannelSummary,
  Modality,
  SpeechContext,
  Transcript,
} from '@quack/shared';
import { authedFetch } from '../api/authedFetch.js';

/** One row in the recent-sessions list (`GET /api/sessions`). */
export interface SessionListItem {
  sessionId: string;
  /** Epoch ms (Firestore serverTimestamp converted on read), or null. */
  createdAt: number | null;
  summary: string;
  /**
   * Stats-only channel summaries (no timeline/events) so the row can compute the same delivery
   * categories as the report via `deliveryMetrics` — single source of truth for the thresholds.
   */
  channelSummaries: ChannelSummary[];
}

/** A full stored rehearsal (`GET /api/sessions/:id`) — summaries, not raw series. */
export interface StoredSession {
  sessionId: string;
  schemaVersion: number;
  createdAt: number | null;
  durationMs: number;
  capturedModalities: Modality[];
  channelSummaries: ChannelSummary[];
  transcript?: Transcript;
  context?: SpeechContext;
  report: AggregateReport;
}

/** Fetch the recent rehearsals list. Returns [] when persistence is disabled. */
export async function fetchSessions(): Promise<SessionListItem[]> {
  const res = await authedFetch('/api/sessions');
  if (!res.ok) throw new Error(`Could not load history (${res.status})`);
  const data = (await res.json()) as { sessions: SessionListItem[] };
  return data.sessions ?? [];
}

/** Fetch a single stored rehearsal by id. */
export async function fetchSession(id: string): Promise<StoredSession> {
  const res = await authedFetch(`/api/sessions/${encodeURIComponent(id)}`);
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`Could not load rehearsal (${res.status}): ${detail?.error ?? res.statusText}`);
  }
  return (await res.json()) as StoredSession;
}
