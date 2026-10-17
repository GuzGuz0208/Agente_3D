/**
 * MicTap: the one capture path for every engine (docs/08 §4).
 *
 * getUserMedia (echo cancellation of all system audio, noise suppression, voice
 * isolation where it exists, auto gain) → low-pass →
 * AudioWorklet → PCM16 mono, resampled on the main thread to the rate each
 * consumer asks for (16 kHz for Gemini Live, 24 kHz for OpenAI Realtime).
 *
 * It also keeps a ring with the last 30 s at 16 kHz, so `slice(t0, t1)` can hand
 * the analyst a WAV clip (≤ 30 s ≈ 960 KB), and a small energy VAD that records
 * when the user was last heard, on the session clock.
 */
import { sharedAudioContext } from "./player";

export type MicRate = 16_000 | 24_000;
export type MicErrorCode = "MIC_DENIED" | "UNSUPPORTED_BROWSER";

export class MicError extends Error {
  readonly code: MicErrorCode;
  constructor(code: MicErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const RING_RATE = 16_000;
const RING_SECONDS = 30;
const WORKLET_URL = `${import.meta.env.BASE_URL.replace(/\/?$/, "/")}worklets/mic-capture.js`;

/** Streaming linear resampler, Float32 in → PCM16 out. The input is low-passed upstream. */
class Resampler {
  private readonly step: number;
  private position = 0;
  private last = 0;

  constructor(inRate: number, outRate: number) {
    this.step = inRate / outRate;
  }

  process(input: Float32Array): Int16Array {
    const out = new Int16Array(Math.ceil((input.length - this.position) / this.step) + 1);
    let n = 0;
    let pos = this.position;
    while (pos < input.length) {
      const i = Math.floor(pos);
      const frac = pos - i;
      const a = i === 0 ? this.last : (input[i - 1] ?? 0);
      const b = input[i] ?? 0;
      const v = a + (b - a) * frac;
      out[n++] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
      pos += this.step;
    }
    this.position = pos - input.length;
    this.last = input[input.length - 1] ?? this.last;
    return out.subarray(0, n);
  }
}

interface Consumer {
  rate: MicRate;
  resampler: Resampler;
  cb: (pcm: Int16Array) => void;
}

export class MicTap {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private nodes: AudioNode[] = [];
  private starting: Promise<void> | null = null;
  private holders = 0;
  private clock: () => number = () => performance.now();
  private readonly consumers = new Set<Consumer>();
  private ringResampler: Resampler | null = null;
  private readonly ring = new Int16Array(RING_RATE * RING_SECONDS);
  private ringWrite = 0;
  private ringFilled = 0;
  /** Session-clock time of the newest sample in the ring. */
  private ringEndT = 0;
  private noiseFloor = 0.003;
  private voiced = false;
  private voicedAt: number | null = null;

  /** Session-clock time when voice was last detected locally, or null. */
  get lastVoiceAt(): number | null {
    return this.voicedAt;
  }

  /** True while the local VAD hears voice. */
  get speaking(): boolean {
    return this.voiced;
  }

  get active(): boolean {
    return this.stream !== null;
  }

  /**
   * Opens the microphone (once) and counts a holder. `clock` is the session
   * clock used for `slice` and `lastVoiceAt`. Call `release()` when done.
   */
  async acquire(clock: () => number): Promise<void> {
    this.clock = clock;
    this.holders++;
    try {
      await (this.starting ??= this.open());
    } catch (err) {
      this.holders = Math.max(0, this.holders - 1);
      this.starting = null;
      throw err;
    }
  }

  release(): void {
    this.holders = Math.max(0, this.holders - 1);
    // Deferred: an engine switch releases and re-acquires within the same tick.
    setTimeout(() => {
      if (this.holders === 0) this.close();
    }, 250);
  }

  /** Subscribes to PCM16 mono frames (~20 ms) at the given rate. */
  onFrame(rate: MicRate, cb: (pcm: Int16Array) => void): () => void {
    const consumer: Consumer = { rate, resampler: new Resampler(this.context?.sampleRate ?? 48_000, rate), cb };
    this.consumers.add(consumer);
    return () => this.consumers.delete(consumer);
  }

  /**
   * WAV (PCM16 mono 16 kHz) of the session-clock window [t0, t1], clamped to
   * what the 30 s ring still holds. Null when the window is empty.
   */
  slice(t0: number, t1: number): Blob | null {
    const pcm = this.slicePcm(t0, t1);
    return pcm ? encodeWav(pcm, RING_RATE) : null;
  }

  /** PCM16 mono 16 kHz of the session-clock window [t0, t1], clamped to the ring. Null when empty. */
  slicePcm(t0: number, t1: number): Int16Array | null {
    if (this.ringFilled === 0) return null;
    const ringStartT = this.ringEndT - (this.ringFilled / RING_RATE) * 1000;
    const from = Math.max(t0, ringStartT);
    const to = Math.min(t1, this.ringEndT);
    if (to <= from) return null;
    const endOffset = Math.round(((this.ringEndT - to) / 1000) * RING_RATE);
    const count = Math.min(this.ringFilled - endOffset, Math.round(((to - from) / 1000) * RING_RATE));
    if (count <= 0) return null;
    const pcm = new Int16Array(count);
    const size = this.ring.length;
    let read = (this.ringWrite - endOffset - count + size * 2) % size;
    for (let i = 0; i < count; i++) {
      pcm[i] = this.ring[read] ?? 0;
      read = (read + 1) % size;
    }
    return pcm;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private async open(): Promise<void> {
    if (typeof AudioWorkletNode === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      throw new MicError("UNSUPPORTED_BROWSER", "Este navegador no permite capturar audio (falta AudioWorklet o getUserMedia).");
    }
    let stream: MediaStream;
    try {
      stream = await openMicrophone();
    } catch {
      throw new MicError("MIC_DENIED", "No hay acceso al micrófono. Habilítalo en el navegador o usa el modo texto.");
    }
    if (import.meta.env.DEV) {
      // What the browser really applied (echo cancellation "all" needs Chrome/Edge 141+).
      console.info("[mic] settings", stream.getAudioTracks()[0]?.getSettings());
    }
    const context = sharedAudioContext();
    try {
      await context.audioWorklet.addModule(WORKLET_URL);
      if (context.state !== "running") await context.resume().catch(() => undefined);
    } catch {
      for (const track of stream.getTracks()) track.stop();
      throw new MicError("UNSUPPORTED_BROWSER", "No se pudo iniciar el procesador de audio del micrófono.");
    }
    const source = context.createMediaStreamSource(stream);
    // Anti-alias before the linear resampler: two cascaded low-pass stages below 8 kHz.
    const lp1 = context.createBiquadFilter();
    const lp2 = context.createBiquadFilter();
    for (const f of [lp1, lp2]) {
      f.type = "lowpass";
      f.frequency.value = 7000;
      f.Q.value = 0.707;
    }
    const worklet = new AudioWorkletNode(context, "mic-capture", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    // The worklet outputs silence; a muted path to the destination keeps it pulled.
    const mute = context.createGain();
    mute.gain.value = 0;
    source.connect(lp1).connect(lp2).connect(worklet).connect(mute).connect(context.destination);
    worklet.port.onmessage = (ev: MessageEvent<Float32Array>) => this.onBlock(ev.data);

    this.context = context;
    this.stream = stream;
    this.nodes = [source, lp1, lp2, worklet, mute];
    this.ringResampler = new Resampler(context.sampleRate, RING_RATE);
    for (const c of this.consumers) c.resampler = new Resampler(context.sampleRate, c.rate);
  }

  private close(): void {
    for (const node of this.nodes) node.disconnect();
    const worklet = this.nodes.find((n): n is AudioWorkletNode => n instanceof AudioWorkletNode);
    if (worklet) worklet.port.onmessage = null;
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.nodes = [];
    this.stream = null;
    this.context = null;
    this.starting = null;
    this.voiced = false;
    // The ring is dropped with the session: audio is never kept (R-26).
    this.ring.fill(0);
    this.ringFilled = 0;
    this.ringWrite = 0;
    this.voicedAt = null;
  }

  private onBlock(block: Float32Array): void {
    const t = this.clock();
    this.detectVoice(block, t);
    if (this.ringResampler) {
      const pcm = this.ringResampler.process(block);
      const size = this.ring.length;
      for (let i = 0; i < pcm.length; i++) {
        this.ring[this.ringWrite] = pcm[i] ?? 0;
        this.ringWrite = (this.ringWrite + 1) % size;
      }
      this.ringFilled = Math.min(size, this.ringFilled + pcm.length);
      this.ringEndT = t;
    }
    for (const c of this.consumers) {
      const pcm = c.resampler.process(block);
      if (pcm.length > 0) c.cb(pcm);
    }
  }

  /** Energy VAD with a slowly adapting noise floor. Only used for timing marks. */
  private detectVoice(block: Float32Array, t: number): void {
    let sum = 0;
    for (let i = 0; i < block.length; i++) {
      const s = block[i] ?? 0;
      sum += s * s;
    }
    const rms = Math.sqrt(sum / Math.max(1, block.length));
    const threshold = Math.max(0.012, this.noiseFloor * 3.5);
    this.voiced = rms > threshold;
    if (this.voiced) this.voicedAt = t;
    else this.noiseFloor = this.noiseFloor * 0.98 + rms * 0.02;
  }
}

/**
 * Capture constraints for a PC / laptop microphone with the agent on the speakers.
 *
 * The agent plays through Web Audio, not an RTCPeerConnection, and `echoCancellation: true`
 * only guarantees cancelling PeerConnection audio. `"all"` (Chrome/Edge 141+) asks to cancel
 * everything the system plays; older browsers treat any truthy value as `true`.
 * `voiceIsolation` is ignored where it does not exist.
 */
export const MIC_CONSTRAINTS = {
  echoCancellation: "all",
  noiseSuppression: true,
  autoGainControl: true,
  voiceIsolation: true,
  channelCount: 1,
} as unknown as MediaTrackConstraints;
/** The constraints used before, for a browser that rejects the new ones. */
export const MIC_CONSTRAINTS_BASIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

/** Opens the microphone; if the browser rejects the new constraints it retries with the previous ones. */
export async function openMicrophone(media: Pick<MediaDevices, "getUserMedia"> = navigator.mediaDevices): Promise<MediaStream> {
  try {
    return await media.getUserMedia({ audio: MIC_CONSTRAINTS });
  } catch (err) {
    const name = err instanceof Error || (typeof DOMException !== "undefined" && err instanceof DOMException) ? err.name : "";
    // A permission error is final; only a constraint error is worth a second try.
    if (name !== "OverconstrainedError" && name !== "TypeError" && name !== "NotSupportedError") throw err;
    return media.getUserMedia({ audio: MIC_CONSTRAINTS_BASIC });
  }
}

export function encodeWav(pcm: Int16Array, sampleRate: number): Blob {
  const header = new DataView(new ArrayBuffer(44));
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i++) header.setUint8(offset + i, text.charCodeAt(i));
  };
  const bytes = pcm.length * 2;
  ascii(0, "RIFF");
  header.setUint32(4, 36 + bytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  header.setUint32(16, 16, true);
  header.setUint16(20, 1, true); // PCM
  header.setUint16(22, 1, true); // mono
  header.setUint32(24, sampleRate, true);
  header.setUint32(28, sampleRate * 2, true);
  header.setUint16(32, 2, true);
  header.setUint16(34, 16, true);
  ascii(36, "data");
  header.setUint32(40, bytes, true);
  const body = new Int16Array(pcm); // copy: little-endian on every platform we target
  return new Blob([header.buffer, body.buffer], { type: "audio/wav" });
}

let sharedMic: MicTap | null = null;

/** The single microphone tap of the page. */
export function getMicTap(): MicTap {
  sharedMic ??= new MicTap();
  return sharedMic;
}
