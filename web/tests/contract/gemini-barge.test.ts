/**
 * Gemini without provider barge-in (backend `activityHandling: NO_INTERRUPTION`, grant
 * `config.interruption = "client"`): the server is deaf while it answers, so the browser
 * applies the 1-second rule with its own voice detector, cuts the server turn with a client
 * content turn and replays the voice the server did not hear (docs/08 §6).
 *
 * The real Gemini adapter runs against a stubbed WebSocket; player and microphone are
 * stubbed with a controllable voice detector. No network, no audio device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    interruption: "client" as string | undefined,
    audible: null as string | null,
    frame: null as ((pcm: Int16Array) => void) | null,
  };
  const tap = {
    speaking: false,
    lastVoiceAt: null as number | null,
    active: true,
    acquire: async () => undefined,
    release: () => undefined,
    onFrame: (_rate: number, cb: (pcm: Int16Array) => void) => {
      state.frame = cb;
      return () => {
        state.frame = null;
      };
    },
    slice: () => null,
    slicePcm: () => new Int16Array(16_000 * 1.6),
  };
  const player = {
    attach: () => () => undefined,
    resume: async () => true,
    enqueue: (id: string) => {
      state.audible = id;
      return 0;
    },
    flush: () => {
      state.audible = null;
      return new Map<string, number>();
    },
    playedMs: () => 0,
    get audibleGeneration() {
      return state.audible;
    },
    duck: (_level: number) => undefined,
  };
  return { state, tap, player };
});

vi.mock("../../src/voice/audio/mic-tap", () => {
  class MicError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { MicError, getMicTap: () => h.tap };
});
vi.mock("../../src/voice/audio/player", () => ({ getPlayer: () => h.player }));
vi.mock("../../src/voice/api", async (orig) => ({
  ...(await orig<typeof import("../../src/voice/api")>()),
  requestRealtimeSession: async () => ({
    engine: "gemini",
    model: "gemini-test",
    connect: { url: "wss://x", token: "t" },
    config: { voice_mode: "engine", ...(h.state.interruption ? { interruption: h.state.interruption } : {}) },
  }),
}));

type Msg = Record<string, unknown>;

class FakeSocket {
  static readonly OPEN = 1;
  static last: FakeSocket | null = null;
  readyState = 1;
  binaryType = "";
  sent: Msg[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(data: string): void {
    this.sent.push(JSON.parse(data) as Msg);
  }
  close(): void {
    this.readyState = 3;
  }
  push(msg: Msg): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}
vi.stubGlobal("WebSocket", FakeSocket);

const { GeminiLiveEngine } = await import("../../src/voice/gemini-engine");
const { MOCK_BRIEF } = await import("../../src/voice/api");

const pcm = (): string => btoa(String.fromCharCode(...new Uint8Array(960)));
const marks = (): string[] => ((globalThis as { __voiceMarks?: { name: string }[] }).__voiceMarks ?? []).map((m) => m.name);
const cuts = (ws: FakeSocket): Msg[] => ws.sent.filter((m) => m.clientContent);
const audioSent = (ws: FakeSocket): number => ws.sent.filter((m) => (m.realtimeInput as Msg | undefined)?.audio).length;

let t0 = 0;
let engine: InstanceType<typeof GeminiLiveEngine> | null = null;
let transcripts: { role: string; text: string; final: boolean }[] = [];
let ducks: number[] = [];
let flushes = 0;

async function open(): Promise<FakeSocket> {
  t0 = Date.now();
  const e = new GeminiLiveEngine({
    now: () => Date.now() - t0,
    getBrief: async () => ({ ...MOCK_BRIEF, spoken_brief: "" }),
    runTool: async () => {
      throw new Error("not used");
    },
    micAllowed: () => true,
  });
  engine = e;
  transcripts = [];
  e.on("transcript", (ev) => transcripts.push(ev.payload));
  FakeSocket.last = null;
  const connected = e.connect({ conversationId: "g-barge" });
  for (let i = 0; i < 100 && !FakeSocket.last?.onmessage; i++) await vi.advanceTimersByTimeAsync(5);
  FakeSocket.last!.push({ setupComplete: {} });
  await connected;
  return FakeSocket.last!;
}

/** The agent starts answering: one chunk of audio from the server. */
function agentSpeaks(ws: FakeSocket): void {
  ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Te cuento que " } } });
}

/** Microphone frames for `ms`, with or without voice, every 20 ms. */
async function mic(ms: number, voiced: boolean): Promise<void> {
  for (let elapsed = 0; elapsed < ms; elapsed += 20) {
    h.tap.speaking = voiced;
    if (voiced) h.tap.lastVoiceAt = Date.now() - t0;
    h.state.frame?.(new Int16Array(320));
    await vi.advanceTimersByTimeAsync(20);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  h.state.interruption = "client";
  h.state.audible = null;
  h.tap.speaking = false;
  h.tap.lastVoiceAt = null;
  ducks = [];
  flushes = 0;
  vi.spyOn(h.player, "duck").mockImplementation((level: number) => void ducks.push(level));
  const flush = h.player.flush.bind(h.player);
  vi.spyOn(h.player, "flush").mockImplementation(() => {
    flushes++;
    return flush();
  });
  (globalThis as { __voiceMarks?: unknown[] }).__voiceMarks = [];
});

afterEach(async () => {
  await engine?.disconnect();
  engine = null;
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("Gemini, browser-side 1-second rule (interruption: client)", () => {
  it("voice shorter than 1 s while the agent speaks only ducks it: nothing is cut or sent", async () => {
    const ws = await open();
    agentSpeaks(ws);
    await mic(600, true);
    expect(ducks).toEqual([0.3]);
    await mic(500, false);
    expect(ducks).toEqual([0.3, 1]);
    expect(flushes).toBe(0);
    expect(cuts(ws)).toEqual([]);
    expect(marks()).toEqual(expect.arrayContaining(["local_voice_start", "local_voice_noise", "barge_noise"]));
    expect(marks()).not.toContain("barge_confirmed");
    expect(transcripts.filter((t) => t.role === "user")).toEqual([]);
  });

  it("voice of 1 s or more cuts the agent, ends the server turn and replays what the server did not hear", async () => {
    const ws = await open();
    agentSpeaks(ws);
    await mic(1400, true);
    expect(marks()).toContain("barge_confirmed");
    expect(flushes).toBeGreaterThan(0);
    const cut = cuts(ws);
    expect(cut).toHaveLength(1);
    expect(cut[0]).toMatchObject({ clientContent: { turnComplete: true } });
    // The replay (1.6 s from the ring, in 200 ms chunks) goes right after the cut.
    const cutAt = ws.sent.indexOf(cut[0]!);
    const replay = ws.sent.slice(cutAt + 1, cutAt + 9);
    expect(replay.every((m) => (m.realtimeInput as Msg | undefined)?.audio)).toBe(true);
    expect(marks()).toContain("voice_replayed");

    // Anything still arriving from the cut turn is dropped.
    agentSpeaks(ws);
    expect(h.state.audible).toBeNull();
    ws.push({ serverContent: { interrupted: true } });
    ws.push({ serverContent: { turnComplete: true } });

    // The server hears the replayed voice: same utterance, not a second one.
    ws.push({ voiceActivity: { type: "ACTIVITY_START", audioOffset: "1.0s" } });
    expect(marks().filter((m) => m === "user_speech_started")).toHaveLength(1);
    expect(marks()).toContain("local_voice_adopted");
    ws.push({ serverContent: { inputTranscription: { text: "¿Cuántas IPS hay en Cali?" } } });
    ws.push({ voiceActivity: { type: "ACTIVITY_END", audioOffset: "2.5s" } });
    await vi.advanceTimersByTimeAsync(400);
    expect(transcripts.filter((t) => t.role === "user" && t.final).map((t) => t.text)).toEqual(["¿Cuántas IPS hay en Cali?"]);

    // And its answer is played.
    agentSpeaks(ws);
    expect(h.state.audible).not.toBeNull();
  });

  it("a question typed while the server answers travels as the client turn that ends it", async () => {
    const ws = await open();
    agentSpeaks(ws);
    engine!.sendText("¿Y en Medellín?");
    await vi.advanceTimersByTimeAsync(0);
    expect(cuts(ws)).toEqual([{ clientContent: { turns: [{ role: "user", parts: [{ text: "¿Y en Medellín?" }] }], turnComplete: true } }]);
    expect(ws.sent.some((m) => (m.realtimeInput as Msg | undefined)?.text)).toBe(false);
  });

  it("the Stop button also ends the server turn, so it listens again at once; the reply to the note is not played", async () => {
    const ws = await open();
    agentSpeaks(ws);
    engine!.interrupt(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(cuts(ws)).toHaveLength(1);
    expect(cuts(ws)[0]).toMatchObject({ clientContent: { turnComplete: true } });
    agentSpeaks(ws); // late output of the cut turn
    ws.push({ serverContent: { interrupted: true } });
    ws.push({ serverContent: { turnComplete: true } });
    // Verified 2026-10-16: the model answers the note with ~1 s of silence, «<no speech detected>».
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "<no speech detected>" } } });
    ws.push({ serverContent: { generationComplete: true } });
    ws.push({ serverContent: { turnComplete: true } });
    expect(h.state.audible).toBeNull();
    expect(transcripts.filter((t) => t.role === "agent").map((t) => t.text)).toEqual(["Te cuento que"]);
    // The next question is answered normally.
    engine!.sendText("¿Cuántas IPS hay?");
    agentSpeaks(ws);
    expect(h.state.audible).not.toBeNull();
  });

  it("while the server prepares an answer (deaf, nothing audible yet) the same rule applies", async () => {
    const ws = await open();
    engine!.sendText("¿Cuántas IPS hay?"); // the server is now busy with its answer
    await mic(600, true);
    await mic(500, false);
    expect(cuts(ws)).toEqual([]); // short voice: the answer in preparation is kept
    await mic(1400, true);
    expect(cuts(ws)).toHaveLength(1);
    expect(marks()).toContain("voice_replayed");
  });

  it("a typed question with no answer in progress goes as realtime text", async () => {
    const ws = await open();
    engine!.sendText("¿Cuántas IPS hay?");
    expect(ws.sent.filter((m) => (m.realtimeInput as Msg | undefined)?.text)).toHaveLength(1);
    expect(cuts(ws)).toEqual([]);
  });
});

describe("Gemini with provider barge-in (interruption: server or not announced)", () => {
  it("the local detector stays off and the server's own interruption cuts the agent at once", async () => {
    h.state.interruption = undefined;
    const ws = await open();
    agentSpeaks(ws);
    const before = audioSent(ws);
    await mic(1500, true);
    expect(marks()).not.toContain("local_voice_start");
    expect(audioSent(ws) - before).toBe(75); // live frames only, no replay
    ws.push({ voiceActivity: { type: "ACTIVITY_START" } });
    expect(flushes).toBeGreaterThan(0); // no 1-second wait
    ws.push({ serverContent: { interrupted: true } });
    expect(cuts(ws)).toEqual([]);
  });
});
