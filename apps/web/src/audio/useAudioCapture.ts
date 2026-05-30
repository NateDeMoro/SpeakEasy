import { useCallback, useEffect, useRef, useState } from 'react';
import { summarizeAll, type ChannelSummary, type SessionRecord } from '@quack/shared';
import { AudioCapture } from './AudioCapture.js';
import type { LiveSnapshot } from './types.js';

const IDLE_SNAPSHOT: LiveSnapshot = {
  tMs: 0,
  volumeDbfs: -100,
  paceSps: 0,
  inDeadAir: false,
  deadAirMs: 0,
};

export interface CaptureState {
  running: boolean;
  error: string | null;
  snapshot: LiveSnapshot;
  /** Set after stop(): the last session's channel summaries (proves the schema). */
  summaries: ChannelSummary[] | null;
  record: SessionRecord | null;
  start: () => void;
  stop: () => void;
}

/** React binding for AudioCapture. use when: wiring the live dashboard. */
export function useAudioCapture(): CaptureState {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(IDLE_SNAPSHOT);
  const [summaries, setSummaries] = useState<ChannelSummary[] | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const captureRef = useRef<AudioCapture | null>(null);

  if (captureRef.current === null) {
    captureRef.current = new AudioCapture(setSnapshot);
  }

  const start = useCallback(() => {
    setError(null);
    setSummaries(null);
    setRecord(null);
    captureRef.current
      ?.start()
      .then(() => setRunning(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Microphone access failed'),
      );
  }, []);

  const stop = useCallback(() => {
    captureRef.current?.stop().then((rec) => {
      setRunning(false);
      setSnapshot(IDLE_SNAPSHOT);
      if (rec) {
        setRecord(rec);
        setSummaries(summarizeAll(rec.channels));
      }
    });
  }, []);

  useEffect(() => () => void captureRef.current?.stop(), []);

  return { running, error, snapshot, summaries, record, start, stop };
}
