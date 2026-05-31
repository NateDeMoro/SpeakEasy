/**
 * Chunked long-form STT (Stage 3, Step 2).
 *
 * use when: a recorded clip exceeds the single-call STT cap (~60s). Decode the clip, downsample to
 * 16 kHz mono (Speech models are 16 kHz native — no accuracy loss, large payload win), slice it on
 * already-detected pauses into <60s WAV segments, then the caller recognizes each via the existing
 * /api/transcribe and stitches the words back with per-segment time offsets. No new infra.
 *
 * Decode is best-effort across containers (Chrome webm/opus, Safari mp4/aac) — `chunkAudio` returns
 * null if `decodeAudioData` throws, so the caller falls back to the single-call path (whole clip,
 * accept the ~60s cap) rather than failing the report.
 */

import type { SessionRecord, Transcript, TranscriptWord } from '@quack/shared';
import { getChannel, isEventSample } from '@quack/shared';

/** Target sample rate for the re-encoded WAV segments — Speech models' native rate. */
const TARGET_HZ = 16000;
/** How far back from the segment cap to look for a pause to cut inside (keeps segments near-cap). */
const PAUSE_SNAP_WINDOW_MS = 8000;
/** Overlap adjacent segments by this guard so a word split at a hard cut isn't dropped. */
const SEAM_GUARD_MS = 300;
/** Two words within this time + same normalized text across a seam are treated as one (de-dup). */
const SEAM_DEDUP_MS = 400;

/** One re-encoded slice plus where it starts on the clip timeline (ms). */
export interface AudioSegment {
  /** 16-bit PCM WAV bytes (16 kHz mono) for one <maxSegMs slice. */
  wav: Blob;
  /** Segment start offset on the clip timeline (ms). Add to this segment's STT word times to stitch. */
  startMs: number;
}

/** Normalize a token for seam de-dup: lowercase, strip surrounding punctuation. */
function norm(word: string): string {
  return word.toLowerCase().replace(/^[^a-z']+|[^a-z']+$/g, '');
}

/**
 * Silence-midpoint cut candidates from the `audio.pause` channel, in **channel clock**. The chunker
 * shifts these onto the decoded-clip timeline with the recorder↔clip `offsetMs`. Midpoints are the
 * safe cut points (cut well inside the gap, never mid-word).
 */
export function pauseMidpointsMs(record: SessionRecord): number[] {
  const ch = getChannel(record, 'audio.pause');
  if (!ch) return [];
  return ch.series.filter(isEventSample).map((e) => e.t + (e.d ?? 0) / 2);
}

/** Decode any supported container → 16 kHz mono Float32 PCM (resampled + downmixed in one pass). */
async function decodeToMono(blob: Blob): Promise<Float32Array> {
  const arrayBuf = await blob.arrayBuffer();
  const decodeCtx = new AudioContext();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(arrayBuf);
  } finally {
    await decodeCtx.close();
  }
  const frameCount = Math.max(1, Math.ceil(decoded.duration * TARGET_HZ));
  const offline = new OfflineAudioContext(1, frameCount, TARGET_HZ);
  const src = offline.createBufferSource();
  src.buffer = decoded;
  src.connect(offline.destination);
  src.start();
  const rendered = await offline.startRendering();
  return rendered.getChannelData(0);
}

/** Encode a mono Float32 PCM slice as a 16-bit PCM WAV blob. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const numFrames = samples.length;
  const buffer = new ArrayBuffer(44 + numFrames * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + numFrames * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format: PCM
  view.setUint16(22, 1, true); // channels: mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate = sampleRate * blockAlign
  view.setUint16(32, 2, true); // block align = channels * bytesPerSample
  view.setUint16(34, 16, true); // bits per sample
  writeStr(36, 'data');
  view.setUint32(40, numFrames * 2, true);
  let off = 44;
  for (let i = 0; i < numFrames; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([view], { type: 'audio/wav' });
}

/**
 * Decode a whole clip → one 16 kHz mono WAV blob. Returns null on decode failure (caller keeps the
 * original blob). use when: short clips that skip chunking still need a Gemini-accepted container —
 * Gemini rejects webm/opus, so the filler pass needs WAV (STT accepts it via autoDecodingConfig).
 */
export async function encodeClipToWav(blob: Blob): Promise<Blob | null> {
  try {
    const mono = await decodeToMono(blob);
    return encodeWav(mono, TARGET_HZ);
  } catch (err) {
    console.warn('[chunker] WAV re-encode failed; sending original blob:', err);
    return null;
  }
}

/** Slice [startMs, endMs] of the mono PCM into a WAV segment. */
function sliceToWav(mono: Float32Array, startMs: number, endMs: number): AudioSegment {
  const startIdx = Math.max(0, Math.floor((startMs / 1000) * TARGET_HZ));
  const endIdx = Math.min(mono.length, Math.ceil((endMs / 1000) * TARGET_HZ));
  return { wav: encodeWav(mono.subarray(startIdx, endIdx), TARGET_HZ), startMs };
}

/**
 * Decode + slice a clip into pause-aligned <maxSegMs WAV segments. Each cut snaps to the latest
 * detected pause within `PAUSE_SNAP_WINDOW_MS` of the cap (cut inside silence); when none exists in
 * the window it hard-cuts at the cap (a rare mid-word split, handled by seam overlap + de-dup).
 * Returns null if decode fails (caller falls back to a single whole-clip STT call).
 *
 * `pauseBoundariesMs` are channel-clock silence midpoints (see `pauseMidpointsMs`); `offsetMs` is
 * Step 0's recorder↔clip calibration used to place them on the decoded-clip timeline.
 */
export async function chunkAudio(
  blob: Blob,
  pauseBoundariesMs: number[],
  offsetMs: number,
  maxSegMs = 55000,
): Promise<AudioSegment[] | null> {
  let mono: Float32Array;
  try {
    mono = await decodeToMono(blob);
  } catch (err) {
    console.warn('[chunker] decodeAudioData failed; single-call STT fallback:', err);
    return null;
  }
  const totalMs = (mono.length / TARGET_HZ) * 1000;
  if (totalMs <= 0) return null;

  // Pause boundaries placed on the clip timeline (tClip = tChannel + offsetMs), sorted ascending.
  const boundaries = pauseBoundariesMs.map((t) => t + offsetMs).sort((a, b) => a - b);

  const segments: AudioSegment[] = [];
  let startMs = 0;
  // Guard against pathological non-progress (shouldn't trigger; segments advance by ≥ snap window).
  let guard = 0;
  while (startMs < totalMs && guard++ < 10000) {
    const capMs = startMs + maxSegMs;
    if (capMs >= totalMs) {
      segments.push(sliceToWav(mono, startMs, totalMs));
      break;
    }
    // Latest pause in [capMs − snap window, capMs]; nearest to the cap keeps segments long.
    const lo = capMs - PAUSE_SNAP_WINDOW_MS;
    let cut = capMs;
    for (const b of boundaries) {
      if (b >= lo && b <= capMs) cut = b;
      if (b > capMs) break;
    }
    segments.push(sliceToWav(mono, startMs, cut));
    // Overlap the next segment back by the seam guard so a word split at a hard cut isn't lost.
    startMs = Math.max(startMs + 1, cut - SEAM_GUARD_MS);
  }
  return segments;
}

/**
 * Stitch per-segment transcripts back into one. Each segment's words are shifted by its `startMs`
 * onto the clip clock, concatenated in order, and de-duplicated across seams (same normalized text
 * within `SEAM_DEDUP_MS`), then sorted by start time so timestamps stay monotonic.
 */
export function stitchSegments(parts: { segment: AudioSegment; transcript: Transcript }[]): Transcript {
  const words: TranscriptWord[] = [];
  for (const { segment, transcript } of parts) {
    for (const w of transcript.words) {
      const shifted: TranscriptWord = {
        ...w,
        tStartMs: w.tStartMs + segment.startMs,
        tEndMs: w.tEndMs + segment.startMs,
      };
      if (!isSeamDuplicate(words, shifted)) words.push(shifted);
    }
  }
  words.sort((a, b) => a.tStartMs - b.tStartMs);
  return { words, text: words.map((w) => w.text).join(' ') };
}

/** True if `cand` repeats a recently-stitched word across a segment seam. */
function isSeamDuplicate(words: TranscriptWord[], cand: TranscriptWord): boolean {
  for (let i = words.length - 1; i >= 0 && i >= words.length - 6; i--) {
    const w = words[i]!;
    if (w.tStartMs < cand.tStartMs - SEAM_DEDUP_MS) break;
    if (norm(w.text) === norm(cand.text) && Math.abs(w.tStartMs - cand.tStartMs) < SEAM_DEDUP_MS) {
      return true;
    }
  }
  return false;
}
