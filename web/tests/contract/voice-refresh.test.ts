/**
 * Context refresh (docs/08 §7.1) and «Silenciar» (docs/08 §6, §10) on the real adapters,
 * against a stubbed WebSocket, player and microphone. No network, no audio device.
 *
 *   - every N turns (or past a token threshold) the session is renewed between turns, never
 *     while the agent speaks, with the same voice stated explicitly and seeded with text only;
 *   - the renewal is quiet: no «renewing» status, and a question typed meanwhile is not lost;
 *   - «Silenciar» stops the agent at once and nothing more is spoken in that turn, also the
 *     answer that follows a tool result; the button stays enabled across an underrun.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  const state = {
    audible: null as string | null,
    handlers: null as { onGenerationStart?: (id: string) => void; onGenerationEnd?: (id: string) => void } | null,
    grants: [] as Record<string, unknown>[],
    refresh: { turns: 3, tokens: 0 } as { turns?: number; tokens?: number } | undefined,
    voice: "Kore" as string,
  };
  const tap = {
    speaking: false,
    lastVoiceAt: null as number | null,
    active: true,
    acquire: async () => undefined,
    release: () => undefined,
    onFrame: () => () => undefined,
    slice: () => null,
    slicePcm: () => null,
  };
  const player = {
    attach: (handlers: typeof state.handlers) => {
      state.handlers = handlers;
      return () => undefined;
    },
    resume: async () => true,
    enqueue: (id: string) => {
      const first = state.audible !== id;
      state.audible = id;
      if (first) queueMicrotask(() => state.handlers?.onGenerationStart?.(id));
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
    duck: () => undefined,
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
  requestRealtimeSession: async (body: Record<string, unknown>) => {
    h.state.grants.push(body);
    const engine = String(body.engine);
    return {
      engine,
      model: `${engine}-test`,
      connect: { url: "wss://x", token: "t" },
      config: {
        voice_mode: "engine",
        voice: typeof body.voice === "string" ? body.voice : h.state.voice,
        ...(engine === "gemini" ? { interruption: "client" } : {}),
        ...(h.state.refresh ? { refresh: h.state.refresh } : {}),
      },
    };
  },
}));

type Msg = Record<string, unknown>;

class FakeSocket {
  static readonly OPEN = 1;
  static all: FakeSocket[] = [];
  readyState = 1;
  binaryType = "";
  sent: Msg[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: string }) => void) | null = null;
  onclose: ((ev: unknown) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.all.push(this);
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
const { OpenAIRealtimeEngine } = await import("../../src/voice/openai-engine");
const { MOCK_BRIEF } = await import("../../src/voice/api");
type AnyEngine = InstanceType<typeof GeminiLiveEngine> | InstanceType<typeof OpenAIRealtimeEngine>;

const pcm = (): string => btoa(String.fromCharCode(...new Uint8Array(960)));
const marks = (): string[] => ((globalThis as { __voiceMarks?: { name: string }[] }).__voiceMarks ?? []).map((m) => m.name);
const last = (): FakeSocket => FakeSocket.all[FakeSocket.all.length - 1]!;

let t0 = 0;
let engine: AnyEngine | null = null;
let statuses: string[] = [];
let sessions: { event: string; reason: string }[] = [];
let transcripts: { role: string; text: string; final: boolean }[] = [];

const envelope = {
  instructions_version: "reto01-ips-v1",
  state: { conversation_id: "c", state_version: 3, confirmed_filters: { departamento: "Antioquia" }, selected_site_keys: [], pending_candidates: [], tone_preference: "neutral" as const },
  summary: "",
  recent_turns: [
    { role: "user" as const, text: "¿Cuántas IPS hay en Antioquia?" },
    { role: "agent" as const, text: "Hay 837 IPS en Antioquia." },
  ],
  tool_results: [{ tool_call_id: "c1", name: "aggregate_ips" as const, evidence_ref: "fp1", cutoff: "2022-11-05", summary: '{"value":837}' }],
  allowed_tools: ["aggregate_ips"],
};

function deps() {
  return {
    now: () => Date.now() - t0,
    getBrief: async () => ({ ...MOCK_BRIEF, spoken_brief: "" }),
    runTool: async (call: { tool_call_id: string; name: string }) => {
      await new Promise((resolve) => setTimeout(resolve, 100)); // a query takes a moment
      return {
        status: "ok",
        state_version: 3,
        data: { value: 837 },
        for_model: "837 IPS en Antioquia.",
        evidence: { query_fingerprint: "fp1", cutoff_raw: "2022-11-05", filters: { departamento: "Antioquia" }, warnings: [], cache_status: "live" },
        trace: { soql: "", ms: 10, rows: 1 },
        tool_call_id: call.tool_call_id,
      } as never;
    },
    micAllowed: () => true,
    envelope: () => envelope,
  };
}

function watch(e: AnyEngine): void {
  engine = e;
  e.on("status", (ev) => statuses.push(ev.payload.state));
  e.on("session", (ev) => sessions.push({ event: ev.payload.event, reason: ev.payload.reason }));
  e.on("transcript", (ev) => transcripts.push(ev.payload));
}

async function waitSocket(n: number): Promise<FakeSocket> {
  for (let i = 0; i < 200 && (FakeSocket.all.length < n || !last().onmessage); i++) await vi.advanceTimersByTimeAsync(5);
  return last();
}

async function openGemini(): Promise<FakeSocket> {
  const e = new GeminiLiveEngine(deps());
  watch(e);
  const n = FakeSocket.all.length + 1;
  const connected = e.connect({ conversationId: "refresh" });
  const ws = await waitSocket(n);
  ws.push({ setupComplete: {} });
  await connected;
  return ws;
}

async function openOpenAI(): Promise<FakeSocket> {
  const e = new OpenAIRealtimeEngine(deps());
  watch(e);
  const n = FakeSocket.all.length + 1;
  const connected = e.connect({ conversationId: "refresh-oa" });
  const ws = await waitSocket(n);
  ws.push({ type: "session.created", session: { instructions: "BASE" } });
  await connected;
  return ws;
}

/** One Gemini answer from first chunk to the end of its playback. */
async function geminiAnswer(ws: FakeSocket, text = "Hay 837 IPS."): Promise<void> {
  ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text } } });
  await vi.advanceTimersByTimeAsync(0);
  ws.push({ serverContent: { generationComplete: true } });
  ws.push({ serverContent: { turnComplete: true } });
  const id = h.state.audible;
  h.state.audible = null;
  if (id) h.state.handlers?.onGenerationEnd?.(id);
  await vi.advanceTimersByTimeAsync(0);
}

async function geminiTurn(ws: FakeSocket, q: string): Promise<void> {
  engine!.sendText(q);
  await geminiAnswer(ws);
}

beforeEach(() => {
  vi.useFakeTimers();
  FakeSocket.all = [];
  h.state.audible = null;
  h.state.handlers = null;
  h.state.grants = [];
  h.state.refresh = { turns: 3, tokens: 0 };
  h.tap.speaking = false;
  h.tap.lastVoiceAt = null;
  statuses = [];
  sessions = [];
  transcripts = [];
  (globalThis as { __voiceMarks?: unknown[] }).__voiceMarks = [];
});

afterEach(async () => {
  await engine?.disconnect();
  engine = null;
  vi.useRealTimers();
});

describe("context refresh every N turns (docs/08 §7.1)", () => {
  it("after N turns it renews between turns: same voice asked for explicitly, seeded with text, no greeting, quiet", async () => {
    const first = await openGemini();
    await geminiTurn(first, "¿Cuántas IPS hay en Antioquia?");
    await geminiTurn(first, "¿Y públicas?");
    expect(FakeSocket.all).toHaveLength(1);
    await geminiTurn(first, "¿Y en Medellín?");
    const second = await waitSocket(2);
    expect(second).not.toBe(first);
    expect(first.readyState).toBe(3); // the old session is closed
    second.push({ setupComplete: {} });
    await vi.advanceTimersByTimeAsync(0);

    // The renewal asked for the voice of the first session, explicitly.
    expect(h.state.grants).toHaveLength(2);
    expect(h.state.grants[0]!.voice).toBeUndefined();
    expect(h.state.grants[1]!.voice).toBe("Kore");
    // Seeded with the controller's envelope, as text, without asking for an answer.
    const seed = second.sent.find((m) => m.clientContent) as { clientContent: { turns: { role: string; parts: { text: string }[] }[]; turnComplete: boolean } };
    expect(seed.clientContent.turnComplete).toBe(false);
    const texts = seed.clientContent.turns.map((t) => t.parts[0]!.text);
    expect(texts).toContain("Hay 837 IPS en Antioquia.");
    expect(texts.at(-1)).toMatch(/departamento=Antioquia/);
    expect(texts.at(-1)).toMatch(/misma voz/);
    expect(texts.at(-1)).toMatch(/ni saludes de nuevo/);
    expect(second.sent.some((m) => (m.realtimeInput as Msg | undefined)?.text)).toBe(false); // no greeting
    // Quiet: the person sees no «renewing», only a note in the recovery panel.
    expect(statuses).not.toContain("renewing");
    expect(sessions).toEqual([{ event: "renewed", reason: expect.stringMatching(/tras 3 turnos/) }]);
    // The count starts again.
    await geminiTurn(second, "¿Y en Cali?");
    await geminiTurn(second, "¿Y en Pasto?");
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("never while the agent speaks: the renewal waits for the end of the answer", async () => {
    const ws = await openGemini();
    await geminiTurn(ws, "uno");
    await geminiTurn(ws, "dos");
    engine!.sendText("tres");
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Hay" } } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.all).toHaveLength(1);
    expect(statuses.at(-1)).toBe("speaking");
    ws.push({ serverContent: { turnComplete: true } });
    const id = h.state.audible;
    h.state.audible = null;
    h.state.handlers?.onGenerationEnd?.(id!);
    await waitSocket(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("waits while the person seems to be starting to talk (local voice)", async () => {
    const ws = await openGemini();
    await geminiTurn(ws, "uno");
    await geminiTurn(ws, "dos");
    h.tap.speaking = true;
    await geminiTurn(ws, "tres");
    await vi.advanceTimersByTimeAsync(1500);
    expect(FakeSocket.all).toHaveLength(1);
    h.tap.speaking = false;
    h.tap.lastVoiceAt = Date.now() - t0 - 2000;
    await waitSocket(2);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("a question typed during the renewal is shown at once and sent when the new session opens", async () => {
    const first = await openGemini();
    await geminiTurn(first, "uno");
    await geminiTurn(first, "dos");
    await geminiTurn(first, "tres");
    const second = await waitSocket(2);
    engine!.sendText("¿Y en Bogotá?");
    expect(transcripts.at(-1)).toMatchObject({ role: "user", text: "¿Y en Bogotá?", final: true });
    expect(second.sent.some((m) => (m.realtimeInput as Msg | undefined)?.text)).toBe(false);
    second.push({ setupComplete: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(second.sent.filter((m) => (m.realtimeInput as Msg | undefined)?.text)).toEqual([{ realtimeInput: { text: "¿Y en Bogotá?" } }]);
    expect(statuses).not.toContain("renewing");
  });

  it("also renews past the token threshold the provider reports", async () => {
    h.state.refresh = { turns: 0, tokens: 5000 };
    const ws = await openGemini();
    engine!.sendText("uno");
    ws.push({ usageMetadata: { promptTokenCount: 5200, totalTokenCount: 5400 } });
    await geminiAnswer(ws);
    const second = await waitSocket(2);
    expect(FakeSocket.all).toHaveLength(2);
    second.push({ setupComplete: {} });
    await vi.advanceTimersByTimeAsync(0);
    expect(sessions[0]!.reason).toMatch(/5200 tokens/);
  });

  it("0 turns and 0 tokens turn it off", async () => {
    h.state.refresh = { turns: 0, tokens: 0 };
    const ws = await openGemini();
    for (let i = 0; i < 8; i++) await geminiTurn(ws, `pregunta ${i}`);
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.all).toHaveLength(1);
  });

  it("OpenAI: renews after N turns with the voice stated and the history as conversation items", async () => {
    h.state.voice = "marin";
    const first = await openOpenAI();
    for (const q of ["uno", "dos", "tres"]) {
      engine!.sendText(q);
      const r = `r-${q}`;
      first.push({ type: "response.created", response: { id: r } });
      first.push({ type: "response.output_audio.delta", response_id: r, item_id: `i-${q}`, delta: pcm() });
      first.push({ type: "response.output_audio_transcript.done", response_id: r, transcript: "Hay 837." });
      first.push({ type: "response.done", response: { id: r, status: "completed", usage: { input_tokens: 900 } } });
      await vi.advanceTimersByTimeAsync(0);
      const id = h.state.audible;
      h.state.audible = null;
      h.state.handlers?.onGenerationEnd?.(id!);
      await vi.advanceTimersByTimeAsync(0);
    }
    const second = await waitSocket(2);
    second.push({ type: "session.created", session: { instructions: "BASE" } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.grants[1]!.voice).toBe("marin");
    const items = second.sent.filter((m) => m.type === "conversation.item.create");
    expect(items.length).toBeGreaterThanOrEqual(3);
    expect(second.sent.some((m) => m.type === "response.create")).toBe(false); // nothing is said
    h.state.voice = "Kore";
  });
});

describe("«Silenciar» (docs/08 §6, §10)", () => {
  it("Gemini: stays «speaking» across an underrun, so the button stays enabled", async () => {
    const ws = await openGemini();
    engine!.sendText("¿Cuántas IPS hay?");
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Hay " } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("speaking");
    // The provider is still streaming but the player ran dry for a moment.
    const id = h.state.audible!;
    h.state.audible = null;
    h.state.handlers?.onGenerationEnd?.(id);
    await vi.advanceTimersByTimeAsync(0);
    expect(statuses.at(-1)).toBe("speaking");
  });

  it("Gemini: cuts at once, ends the server turn, and the answer after a tool result is not spoken", async () => {
    const ws = await openGemini();
    engine!.sendText("¿Cuántas IPS hay en Antioquia?");
    // Acknowledgement, then a tool call.
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Un momento." } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.audible).not.toBeNull();
    ws.push({ toolCall: { functionCalls: [{ id: "f1", name: "aggregate_ips", args: {} }] } });
    engine!.interrupt(0); // «Silenciar» while the acknowledgement is heard
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.audible).toBeNull();
    expect(statuses.at(-1)).not.toBe("speaking");
    expect(marks()).toContain("muted");
    // The tool result still goes back (the conversation keeps the data)…
    await vi.advanceTimersByTimeAsync(150);
    expect(ws.sent.some((m) => m.toolResponse)).toBe(true);
    ws.push({ serverContent: { turnComplete: true } });
    // …but its spoken answer is dropped and its turn ended.
    const cutsBefore = ws.sent.filter((m) => (m.clientContent as Msg | undefined)?.turnComplete === true).length;
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Hay 837 IPS." } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.audible).toBeNull();
    expect(marks()).toContain("muted_generation_dropped");
    expect(ws.sent.filter((m) => (m.clientContent as Msg | undefined)?.turnComplete === true).length).toBeGreaterThan(cutsBefore);
    expect(transcripts.filter((t) => t.role === "agent").map((t) => t.text)).not.toContain("Hay 837 IPS.");
    ws.push({ serverContent: { interrupted: true } });
    ws.push({ serverContent: { turnComplete: true } });
    // The next question is answered and heard.
    engine!.sendText("¿Y en Cali?");
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "En Cali hay 300." } } });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.audible).not.toBeNull();
  });

  it("Gemini: the mute asks for silence (not the barge-in note) and skips a figure correction for that turn", async () => {
    const ws = await openGemini();
    engine!.sendText("¿Cuántas IPS hay?");
    ws.push({ serverContent: { modelTurn: { parts: [{ inlineData: { data: pcm() } }] }, outputTranscription: { text: "Hay 9.320 IPS en total y" } } });
    await vi.advanceTimersByTimeAsync(0);
    engine!.interrupt(0);
    await vi.advanceTimersByTimeAsync(0);
    const notes = ws.sent.filter((m) => (m.clientContent as Msg | undefined)?.turnComplete === true);
    expect(JSON.stringify(notes.at(-1))).toMatch(/pidió silencio/);
    const before = ws.sent.length;
    engine!.sendSystemNote("[Nota del sistema — verificación de cifras] corrige 9.320");
    expect(ws.sent.length).toBe(before);
    expect(marks()).toContain("note_skipped_muted");
    // A barge-in by voice still uses the ordinary note (gemini-barge.test.ts); a new question clears the mute.
    ws.push({ serverContent: { interrupted: true } });
    ws.push({ serverContent: { turnComplete: true } });
    engine!.sendText("¿Y en Cali?");
    engine!.sendSystemNote("nota");
    expect(ws.sent.length).toBeGreaterThan(before + 1);
  });

  it("OpenAI: cancels the response, truncates to what was heard, and asks for no answer after the tool", async () => {
    const ws = await openOpenAI();
    engine!.sendText("¿Cuántas IPS hay en Antioquia?");
    ws.push({ type: "response.created", response: { id: "r1" } });
    ws.push({ type: "response.output_audio.delta", response_id: "r1", item_id: "i1", delta: pcm() });
    ws.push({ type: "response.function_call_arguments.done", response_id: "r1", call_id: "f1", name: "aggregate_ips", arguments: "{}" });
    await vi.advanceTimersByTimeAsync(0);
    expect(h.state.audible).not.toBeNull();
    engine!.interrupt(0);
    expect(h.state.audible).toBeNull();
    expect(ws.sent.some((m) => m.type === "response.cancel")).toBe(true);
    ws.push({ type: "response.done", response: { id: "r1", status: "cancelled" } });
    await vi.advanceTimersByTimeAsync(150);
    expect(ws.sent.some((m) => m.type === "conversation.item.truncate")).toBe(true);
    expect(ws.sent.some((m) => (m.item as Msg | undefined)?.type === "function_call_output")).toBe(true);
    const creates = ws.sent.filter((m) => m.type === "response.create").length;
    expect(creates).toBe(1); // only the one of the question itself
    // The next question gets its answer.
    engine!.sendText("¿Y en Cali?");
    expect(ws.sent.filter((m) => m.type === "response.create")).toHaveLength(2);
  });
});
