import { useCallback, useEffect, useRef, useState } from 'react';
import {
  summarizeAll,
  type AggregateInput,
  type AggregateReport,
  type ChannelSummary,
  type SessionRecord,
  type SpeechContext,
  type Transcript,
} from '@quack/shared';
import { AudioCapture } from './AudioCapture.js';
import { buildFillerChannel, detectGapFillers } from './fillers.js';
import { annotateStress } from './stress.js';
import { chunkAudio, pauseMidpointsMs, stitchSegments } from './chunker.js';
import { authedFetch } from '../api/authedFetch.js';
import { STT_MAX_SEGMENT_MS } from '../config.js';
import type { LiveSnapshot } from './types.js';

const IDLE_SNAPSHOT: LiveSnapshot = {
  tMs: 0,
  volumeDbfs: -100,
  paceSps: 0,
  inDeadAir: false,
  deadAirMs: 0,
  pitchHz: 0,
  pitchVarHz: 0,
  nudge: null,
};

export interface CaptureState {
  running: boolean;
  /** True while the recorded clip is being transcribed after stop. */
  transcribing: boolean;
  error: string | null;
  snapshot: LiveSnapshot;
  /** Set after stop(): the last session's channel summaries (proves the schema). */
  summaries: ChannelSummary[] | null;
  record: SessionRecord | null;
  /** The context-aware Gemini report, fetched after the transcript resolves. */
  report: AggregateReport | null;
  /** True while the aggregate report is being fetched. */
  reportPending: boolean;
  start: () => void;
  /** Stop; `context` (speech material + settings) is attached to the record. */
  stop: (context?: SpeechContext) => void;
}

/** Build the AggregateInput from a finished record and POST it for the report. */
async function fetchReport(rec: SessionRecord): Promise<AggregateReport> {
  const input: AggregateInput = {
    session: {
      sessionId: rec.sessionId,
      durationMs: rec.durationMs,
      capturedModalities: rec.capturedModalities,
    },
    channelSummaries: summarizeAll(rec.channels),
    transcript: rec.transcript,
    speechMaterial: rec.context?.material,
    settings: rec.context?.settings,
  };
  const res = await authedFetch('/api/aggregate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(`Report failed (${res.status}): ${detail?.error ?? res.statusText}`);
  }
  return (await res.json()) as AggregateReport;
}

/** POST the recorded clip to the API and return the word-level transcript. */
async function fetchTranscript(audio: Blob): Promise<Transcript> {
  const res = await authedFetch('/api/transcribe', {
    method: 'POST',
    headers: { 'content-type': audio.type || 'application/octet-stream' },
    body: audio,
  });
  if (!res.ok) {
    // Surface the server's actual error (auth/encoding/recognizer) rather than just the status.
    const detail = await res.json().catch(() => null);
    throw new Error(`Transcription failed (${res.status}): ${detail?.error ?? res.statusText}`);
  }
  return (await res.json()) as Transcript;
}

/**
 * Transcribe a recorded clip. Clips at/under the single-call cap take the one-shot path unchanged;
 * longer clips are sliced on detected pauses into <60s WAV segments (Step 2), recognized in
 * parallel, and stitched with per-segment offsets. Decode failure / a single segment degrades back
 * to the whole-clip call (accepts the ~60s cap) rather than failing the report.
 */
async function transcribeClip(audio: Blob, rec: SessionRecord, offsetMs: number): Promise<Transcript> {
  if (rec.durationMs <= STT_MAX_SEGMENT_MS) return fetchTranscript(audio);
  const segments = await chunkAudio(audio, pauseMidpointsMs(rec), offsetMs, STT_MAX_SEGMENT_MS);
  if (!segments || segments.length <= 1) return fetchTranscript(audio);
  const parts = await Promise.all(
    segments.map(async (segment) => ({ segment, transcript: await fetchTranscript(segment.wav) })),
  );
  return stitchSegments(parts);
}

/** React binding for AudioCapture. use when: wiring the live dashboard. */
export function useAudioCapture(): CaptureState {
  const [running, setRunning] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<LiveSnapshot>(IDLE_SNAPSHOT);
  const [summaries, setSummaries] = useState<ChannelSummary[] | null>(null);
  const [record, setRecord] = useState<SessionRecord | null>(null);
  const [report, setReport] = useState<AggregateReport | null>(null);
  const [reportPending, setReportPending] = useState(false);
  const captureRef = useRef<AudioCapture | null>(null);

  if (captureRef.current === null) {
    captureRef.current = new AudioCapture(setSnapshot);
  }

  const start = useCallback(() => {
    setError(null);
    setSummaries(null);
    setRecord(null);
    setReport(null);
    captureRef.current
      ?.start()
      .then(() => setRunning(true))
      .catch((e: unknown) =>
        setError(e instanceof Error ? e.message : 'Microphone access failed'),
      );
  }, []);

  const stop = useCallback((context?: SpeechContext) => {
    // Mark pending synchronously so the report screen shows a loading state immediately,
    // before the async stop pipeline (recorder flush → STT → report) starts.
    setReportPending(true);
    captureRef.current?.stop(context).then(async (result) => {
      setRunning(false);
      setSnapshot(IDLE_SNAPSHOT);
      if (!result) {
        setReportPending(false);
        return;
      }
      const { record: rec, audio, offsetMs } = result;
      if (import.meta.env.DEV) console.debug('[capture] recorder↔clip offsetMs:', offsetMs);

      // Show the on-device record immediately; transcription enriches it afterwards.
      setRecord(rec);
      setSummaries(summarizeAll(rec.channels));

      // Transcribe first (so the report input is complete), then fetch the aggregate report.
      if (audio) {
        setTranscribing(true);
        try {
          const transcript = await transcribeClip(audio, rec, offsetMs);
          rec.transcript = transcript;
          // Stage 3: annotate per-word acoustic stress (offset-corrected windows) before the
          // report POST, so the stress-annotated transcript flows into AggregateInput + persists.
          annotateStress(rec, offsetMs);
          if (import.meta.env.DEV) {
            console.debug('[stress]', transcript.words.map((w) => [w.text, w.stress]));
          }
          // Acoustic gap fillers (the "um"s STT dropped) merge into the single audio.filler channel.
          const gapFillers = detectGapFillers(rec, offsetMs);
          rec.channels.push(buildFillerChannel(transcript, gapFillers));
          setRecord({ ...rec });
          setSummaries(summarizeAll(rec.channels));
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : 'Transcription failed');
        } finally {
          setTranscribing(false);
        }
      }

      setReportPending(true);
      try {
        setReport(await fetchReport(rec));
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : 'Report failed');
      } finally {
        setReportPending(false);
      }
    });
  }, []);

  useEffect(() => () => void captureRef.current?.stop(), []);

  return { running, transcribing, error, snapshot, summaries, record, report, reportPending, start, stop };
}
