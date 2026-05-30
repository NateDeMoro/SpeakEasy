import type { AggregateFn, AggregateReport } from '@quack/shared';
import { SCHEMA_VERSION, findSummary } from '@quack/shared';

/**
 * Stage 0/1 placeholder implementation of the aggregate contract.
 *
 * Returns a deterministic stub report so the API and the web client can integrate against the
 * real shape now. Stage 2 replaces the body with a Gemini call (see google/ clients); the
 * `AggregateFn` signature does not change.
 *
 * Note the modality-agnostic pattern: it reads channels via `findSummary` and degrades
 * gracefully when a channel (e.g. a future `visual` one) is absent.
 */
export const runAggregate: AggregateFn = async (input): Promise<AggregateReport> => {
  const volume = findSummary(input.channelSummaries, 'audio', 'volume');
  const pause = findSummary(input.channelSummaries, 'audio', 'pause');

  return {
    schemaVersion: SCHEMA_VERSION,
    summary: 'Stub report — wire Gemini in Stage 2.',
    prioritizedAdvice: [],
    metrics: [
      ...(volume
        ? [
            {
              channelId: volume.descriptor.id,
              label: 'Mean volume',
              value: `${(volume.stats['mean'] ?? 0).toFixed(1)} dBFS`,
            },
          ]
        : []),
      ...(pause
        ? [
            {
              channelId: pause.descriptor.id,
              label: 'Pauses',
              value: `${pause.stats['count'] ?? 0}`,
            },
          ]
        : []),
    ],
  };
};
