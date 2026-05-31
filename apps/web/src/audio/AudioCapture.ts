import type { Modality, SessionRecord, SpeechContext } from '@quack/shared';
import { Recorder } from './Recorder.js';
import type { LiveSnapshot } from './types.js';
import { VolumeProcessor } from './processors/volume.js';
import { PauseProcessor } from './processors/pause.js';
import { PaceProcessor } from './processors/pace.js';
import { PitchProcessor } from './processors/pitch.js';
import { NudgeEngine } from './NudgeEngine.js';
import {
  CAPTURE_DEAD_AIR_MS as DEAD_AIR_MS,
  FFT_SIZE,
  RECORD_MIME_CANDIDATES,
} from '../config.js';

/** The output of a finished capture: the schema record plus the raw clip for post-hoc STT. */
export interface CaptureResult {
  record: SessionRecord;
  /** Recorded audio clip (webm/opus), POSTed to /api/transcribe on stop. */
  audio?: Blob;
  /**
   * Recorder↔clip clock offset, ms (Stage 3, Step 0). STT word timestamps live on the
   * MediaRecorder clip clock (t=0 at the `'start'` event); the channel series live on the Recorder
   * `performance.now()` clock. `offsetMs = recorderT0Ms − clipStartMs`. To read a channel sample
   * for a clip-clock word time: `tChannel = tClipWord − offsetMs`. Transient (browser-only, never
   * persisted) — threaded into stress, chunk cuts, and gap-fillers.
   */
  offsetMs: number;
}

/**
 * Audio capture. Wires getUserMedia → AudioContext → AnalyserNode and runs a requestAnimationFrame
 * loop that drives the on-device processors (volume/pace/pitch/pause + the calm nudge), feeds the
 * Recorder (schema), and publishes a LiveSnapshot. A parallel MediaRecorder captures the raw clip
 * for post-hoc Speech-to-Text (Stage 1 batch path).
 *
 * use when: starting/stopping a rehearsal capture from the dashboard.
 */
export class AudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private rafId = 0;
  private running = false;

  private mediaRecorder?: MediaRecorder;
  private chunks: Blob[] = [];
  /** `performance.now()` when the Recorder was constructed (channel-series t0). */
  private recorderT0Ms = 0;
  /** `performance.now()` at the MediaRecorder `'start'` event (clip t0); undefined until it fires. */
  private clipStartMs?: number;

  private recorder?: Recorder;
  private volume = new VolumeProcessor();
  private pause = new PauseProcessor();
  private pace = new PaceProcessor();
  private pitch = new PitchProcessor();
  private nudges = new NudgeEngine();

  constructor(private readonly onSnapshot: (s: LiveSnapshot) => void) {}

  get isRunning(): boolean {
    return this.running;
  }

  /** Request the mic and begin the capture loop. Throws if permission is denied. */
  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.ctx = new AudioContext();
    const source = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = FFT_SIZE;
    source.connect(this.analyser);

    this.startRecording();

    for (const p of [this.volume, this.pause, this.pace, this.pitch]) p.reset();
    this.nudges.reset();
    this.recorderT0Ms = performance.now();
    this.recorder = new Recorder(this.recorderT0Ms, new Date().toISOString());
    this.recorder.register(this.volume.descriptor);
    this.recorder.register(this.pause.descriptor);
    this.recorder.register(this.pace.descriptor);
    this.recorder.register(this.pitch.descriptor);

    this.running = true;
    this.loop();
  }

  private loop = (): void => {
    if (!this.running || !this.analyser || !this.recorder) return;
    const buf = new Float32Array(this.analyser.fftSize);
    this.analyser.getFloatTimeDomainData(buf);
    const tMs = this.recorder.elapsedMs(performance.now());
    const frame = { time: buf, sampleRate: this.ctx!.sampleRate, tMs };

    this.recorder.append(this.volume.descriptor.id, this.volume.process(frame));
    this.recorder.append(this.pause.descriptor.id, this.pause.process(frame));
    this.recorder.append(this.pace.descriptor.id, this.pace.process(frame));
    this.recorder.append(this.pitch.descriptor.id, this.pitch.process(frame));

    const deadAirMs = this.pause.currentSilenceMs;
    const nudge = this.nudges.update({
      tMs,
      volumeDbfs: this.volume.lastDbfs,
      paceSps: this.pace.lastSps,
      deadAirMs,
      pitchVarHz: this.pitch.lastVarHz,
    });

    this.onSnapshot({
      tMs,
      volumeDbfs: this.volume.lastDbfs,
      paceSps: this.pace.lastSps,
      inDeadAir: deadAirMs >= DEAD_AIR_MS,
      deadAirMs,
      pitchHz: this.pitch.lastHz,
      pitchVarHz: this.pitch.lastVarHz,
      nudge,
    });

    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Pick a supported container and begin recording the raw clip alongside analysis. */
  private startRecording(): void {
    this.chunks = [];
    this.clipStartMs = undefined;
    const mimeType = RECORD_MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
    this.mediaRecorder = new MediaRecorder(this.stream!, mimeType ? { mimeType } : undefined);
    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // The clip's t=0 is the moment capture actually begins. Stamping it here (rather than at
    // construction) also absorbs most encoder startup latency into the single calibrated offset.
    this.mediaRecorder.onstart = () => {
      this.clipStartMs = performance.now();
    };
    this.mediaRecorder.start();
  }

  /** Stop the MediaRecorder and resolve the assembled clip (after the final dataavailable). */
  private stopRecording(): Promise<Blob | undefined> {
    const mr = this.mediaRecorder;
    if (!mr || mr.state === 'inactive') return Promise.resolve(undefined);
    return new Promise((resolve) => {
      mr.onstop = () => {
        const blob = this.chunks.length ? new Blob(this.chunks, { type: mr.mimeType }) : undefined;
        resolve(blob);
      };
      mr.stop();
    });
  }

  /** Stop capture and return the recorded SessionRecord plus the raw clip for STT. */
  async stop(context?: SpeechContext): Promise<CaptureResult | undefined> {
    if (!this.running || !this.recorder) return undefined;
    this.running = false;
    cancelAnimationFrame(this.rafId);

    const audio = await this.stopRecording();
    this.recorder.append(this.pause.descriptor.id, this.pause.flush());
    const modalities: Modality[] = ['audio'];
    const record = this.recorder.finish(performance.now(), modalities, context);

    // Clip clock (STT word times) vs Recorder clock (channel series) origins differ; reconcile
    // with a single measured offset. If the 'start' event never fired (edge case), assume 0.
    const offsetMs = this.recorderT0Ms - (this.clipStartMs ?? this.recorderT0Ms);

    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = undefined;
    this.analyser = undefined;
    this.stream = undefined;
    this.mediaRecorder = undefined;
    return { record, audio, offsetMs };
  }
}
