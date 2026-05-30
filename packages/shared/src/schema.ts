/**
 * Modality-agnostic signal schema.
 *
 * use when: recording a rehearsal session, persisting it, or reading channels for analysis.
 *
 * Design keystone: a session is a set of per-channel time-series, each channel keyed by
 * (modality, signal). Adding a new modality (e.g. the Stage 4 video layer) means adding new
 * channels — never changing this schema. Downstream code iterates channels generically, so
 * the recorder, storage, aggregate pipeline, and report format never need a rewrite.
 */

/** Bump on any breaking change to stored session shape. Gates Firestore migrations. */
export const SCHEMA_VERSION = 1;

/**
 * Capture modality. Extensible: add 'pose', 'gesture', etc. as later stages introduce them.
 * - audio  : microphone-derived signals (MVP)
 * - visual : webcam-derived signals (Stage 4: gaze, expression)
 * - text   : material/transcript-derived signals
 */
export type Modality = 'audio' | 'visual' | 'text';

/**
 * Identifies one signal channel. `id` is the stable key used across the record
 * (e.g. 'audio.volume', 'visual.gaze'); convention is `${modality}.${signal}`.
 */
export interface ChannelDescriptor {
  /** Unique, stable key. Convention: `${modality}.${signal}`. */
  id: string;
  modality: Modality;
  /** e.g. 'volume' | 'pitch' | 'pause' | 'pace' | 'filler' | 'gaze' | 'expression'. */
  signal: string;
  /** Value unit, e.g. 'dbfs' | 'hz' | 'bool' | 'sps' | 'count' | 'ratio'. */
  unit: string;
  /** Nominal emission rate (Hz) for scalar streams. Omit for event streams. */
  sampleHz?: number;
}

/** A timestamped scalar reading (volume, pitch, …). `t` is ms from session start. */
export interface ScalarSample {
  /** Milliseconds from session start. */
  t: number;
  /** The measured value, in the channel's `unit`. */
  v: number;
  /** Optional confidence 0..1. */
  c?: number;
}

/**
 * A timestamped event or interval (pause, filler, word, …).
 * use when: the signal is discrete/sparse rather than a continuous stream.
 */
export interface EventSample {
  /** Start time, ms from session start. */
  t: number;
  /** Duration in ms for intervals; omit for instantaneous events. */
  d?: number;
  /** Discriminator, e.g. 'pause' | 'filler' | 'word'. */
  kind: string;
  /** Event-specific data, e.g. { word: 'um' } or { text: 'hello' }. */
  payload?: Record<string, unknown>;
  /** Optional confidence 0..1. */
  c?: number;
}

export type Sample = ScalarSample | EventSample;

/** Type guard. use when: branching processing on scalar vs event channels. */
export function isEventSample(s: Sample): s is EventSample {
  return 'kind' in s;
}

/**
 * One channel's identity plus its ordered time-series.
 * `series` MUST be sorted ascending by `t`; recorders append in order.
 */
export interface SignalChannel<S extends Sample = Sample> {
  descriptor: ChannelDescriptor;
  series: S[];
}

/** A single transcribed word with timing and acoustic stress. Added Stage 1+. */
export interface TranscriptWord {
  text: string;
  tStartMs: number;
  tEndMs: number;
  /** True for 'um'/'uh' etc. Depends on STT disfluency-preservation config (Stage 1 risk). */
  isDisfluency?: boolean;
  /** Acoustic stress 0..1, filled offline by aligning audio channels to word spans (Stage 3). */
  stress?: number;
}

export interface Transcript {
  words: TranscriptWord[];
  /** Full flattened text, convenient for Gemini prompts. */
  text: string;
}

/**
 * The complete record of one rehearsal.
 * Stage 0 produces a partial record (channels only); transcript/context arrive in later stages.
 */
export interface SessionRecord {
  sessionId: string;
  /** Equals SCHEMA_VERSION at write time; check before reading stored sessions. */
  schemaVersion: number;
  /** ISO timestamp of session start. */
  startedAt: string;
  durationMs: number;
  /** Modalities actually captured this session. */
  capturedModalities: Modality[];
  /** Per-channel time-series, looked up via `descriptor.id`. */
  channels: SignalChannel[];
  /** Word-level transcript. Added Stage 1+. */
  transcript?: Transcript;
  /** Speech material + audience/setting context. Added Stage 1/2+ (see context.ts). */
  context?: import('./context.js').SpeechContext;
}

/** Find a channel by its descriptor id. Returns undefined if absent. */
export function getChannel(
  record: SessionRecord,
  id: string,
): SignalChannel | undefined {
  return record.channels.find((ch) => ch.descriptor.id === id);
}
