/**
 * How a style note reaches each engine (docs/10 §6 «Cómo se aplica por motor»).
 *
 * Gemini: a client content turn «will interrupt any current model generation»
 * (Live API reference), so a style decided while the agent answers waits for the
 * gap between turns. OpenAI: `session.update` does not cut the answer and goes at
 * once. Real adapters against a stubbed WebSocket; player, mic and grant stubbed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/voice/audio/mic-tap", () => {
  class MicError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  const tap = { acquire: async () => undefined, release: () => undefined, onFrame: () => () => undefined, lastVoiceAt: null, active: false, slice: () => null };
  return { MicError, getMicTap: () => tap };
});
vi.mock("../../src/voice/audio/player", () => {
  const player = { attach: () => () => undefined, resume: async () => true, flush: () => new Map(), enqueue: () => 0, playedMs: () => 0, audibleGeneration: null, duck: () => undefined };
  return { getPlayer: () => player };
});
vi.mock("../../src/voice/api", async (orig) => ({
  ...(await orig<typeof import("../../src/voice/api")>()),
  requestRealtimeSession: async () => ({ engine: "test", model: "test", connect: { url: "wss://x", token: "t" } }),
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
const { OpenAIRealtimeEngine } = await import("../../src/voice/openai-engine");
const { MOCK_BRIEF } = await import("../../src/voice/api");
const { DIRECTIVES } = await import("../../src/voice/analyst");
import type { StyleDecision } from "../../src/voice/types";

const DIRECTO: StyleDecision = { style: "directo", directives: DIRECTIVES.directo, reason: "Lo pediste", source: "preference", applies_from_turn: 2 };

const deps = () => {
  const t0 = Date.now();
  return {
    now: () => Date.now() - t0,
    getBrief: async () => ({ ...MOCK_BRIEF, spoken_brief: "" }),
    runTool: async () => {
      throw new Error("not used");
    },
    micAllowed: () => false,
  };
};

const styleNotes = (ws: FakeSocket): string[] =>
  ws.sent
    .flatMap((m) => ((m.clientContent as { turns?: { parts: { text: string }[] }[] } | undefined)?.turns ?? []).flatMap((t) => t.parts.map((p) => p.text)))
    .filter((t) => t.includes("Nota de estilo"));

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nota de estilo en Gemini", () => {
  it("espera a que el agente termine de responder para no cortarlo, y entre turnos sale de inmediato", async () => {
    const engine = new GeminiLiveEngine(deps());
    FakeSocket.last = null;
    const connected = engine.connect({ conversationId: "g1" });
    for (let i = 0; i < 100 && !FakeSocket.last?.onmessage; i++) await vi.advanceTimersByTimeAsync(5);
    FakeSocket.last!.push({ setupComplete: {} });
    await connected;
    const ws = FakeSocket.last!;

    engine.sendText("¿Cuántas IPS hay en Cali?");
    ws.push({ serverContent: { outputTranscription: { text: "En Cali hay" } } });
    engine.applyStyle(DIRECTO); // the analysis lands while the agent is still answering
    await vi.advanceTimersByTimeAsync(100);
    expect(styleNotes(ws)).toEqual([]);

    ws.push({ serverContent: { outputTranscription: { text: " 512 IPS." } } });
    ws.push({ serverContent: { turnComplete: true } });
    await vi.advanceTimersByTimeAsync(100);
    const notes = styleNotes(ws);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("Responde en una o dos frases.");
    const note = ws.sent.find((m) => JSON.stringify(m).includes("Nota de estilo")) as { clientContent: { turnComplete: boolean } };
    expect(note.clientContent.turnComplete).toBe(false); // context only: it must not trigger an answer

    engine.applyStyle({ ...DIRECTO, style: "neutro", directives: [] }); // idle now: sent at once
    expect(styleNotes(ws)).toHaveLength(2);
    await engine.disconnect();
  });
});

describe("nota de estilo en OpenAI", () => {
  it("va de inmediato como session.update sobre las instrucciones base", async () => {
    const engine = new OpenAIRealtimeEngine(deps());
    FakeSocket.last = null;
    const connected = engine.connect({ conversationId: "o1" });
    for (let i = 0; i < 100 && !FakeSocket.last?.onmessage; i++) await vi.advanceTimersByTimeAsync(5);
    FakeSocket.last!.push({ type: "session.created", session: { instructions: "BASE" } });
    await connected;
    const ws = FakeSocket.last!;
    engine.sendText("¿Cuántas IPS hay en Cali?");
    engine.applyStyle(DIRECTO);
    const updates = ws.sent.filter((m) => m.type === "session.update");
    expect(updates).toHaveLength(1);
    expect((updates[0]!.session as { instructions: string }).instructions).toMatch(/^BASE\nNota de estilo vigente: Responde en una o dos frases\./);
    await engine.disconnect();
  });
});
