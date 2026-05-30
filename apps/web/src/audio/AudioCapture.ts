import type { Modality, SessionRecord } from '@quack/shared';
import { Recorder } from './Recorder.js';
import type { LiveSnapshot } from './types.js';
import { VolumeProcessor } from './processors/volume.js';
import { PauseProcessor } from './processors/pause.js';
import { PaceProcessor } from './processors/pace.js';

const DEAD_AIR_MS = 1200; // silence longer than this lights the dead-air indicator
const FFT_SIZE = 2048;

/**
 * Stage 0 audio capture. Wires getUserMedia → AudioContext → AnalyserNode and runs a
 * requestAnimationFrame loop that drives the processors, feeds the Recorder (schema), and
 * publishes a LiveSnapshot to the UI. Offline only — no STT, no network.
 *
 * use when: starting/stopping a rehearsal capture from the dashboard.
 */
export class AudioCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private analyser?: AnalyserNode;
  private rafId = 0;
  private running = false;

  private recorder?: Recorder;
  private volume = new VolumeProcessor();
  private pause = new PauseProcessor();
  private pace = new PaceProcessor();

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

    for (const p of [this.volume, this.pause, this.pace]) p.reset();
    this.recorder = new Recorder(performance.now(), new Date().toISOString());
    this.recorder.register(this.volume.descriptor);
    this.recorder.register(this.pause.descriptor);
    this.recorder.register(this.pace.descriptor);

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

    this.onSnapshot({
      tMs,
      volumeDbfs: this.volume.lastDbfs,
      paceSps: this.pace.lastSps,
      inDeadAir: this.pause.currentSilenceMs >= DEAD_AIR_MS,
      deadAirMs: this.pause.currentSilenceMs,
    });

    this.rafId = requestAnimationFrame(this.loop);
  };

  /** Stop capture and return the recorded SessionRecord (audio channels only in Stage 0). */
  async stop(): Promise<SessionRecord | undefined> {
    if (!this.running || !this.recorder) return undefined;
    this.running = false;
    cancelAnimationFrame(this.rafId);

    this.recorder.append(this.pause.descriptor.id, this.pause.flush());
    const modalities: Modality[] = ['audio'];
    const record = this.recorder.finish(performance.now(), modalities);

    this.stream?.getTracks().forEach((t) => t.stop());
    await this.ctx?.close();
    this.ctx = undefined;
    this.analyser = undefined;
    this.stream = undefined;
    return record;
  }
}
