/**
 * Body of `POST /analysis/utterance` (docs/03, docs/10 §6): what the client sends
 * to the real backend. The API module is replaced so no network is touched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { calls } = vi.hoisted(() => ({ calls: [] as Record<string, unknown>[] }));

vi.mock("../../src/voice/api", () => ({
  USING_MOCKS: false,
  apiFetch: vi.fn(async (_path: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    const affect = { turn_id: "t1", state_version: 1, observed_at: "", sentiment: "neutral", emotion: "neutral", state_hint: "interés", method: "text", discrepancy: false, cues: [], confidence: null };
    const style = { style: "neutro", directives: [], reason: "", source: "inferred", applies_from_turn: 2 };
    return new Response(JSON.stringify({ affect, style, ms: 900 }), { status: 200 });
  }),
}));

import { analyze, interactionSignals, SIGNAL_KEYS } from "../../src/voice/analyst";

const signals = interactionSignals({ text: "hola", spoken: false, tStart: 5, tEnd: 5, agentEndedAt: null, interruptedAgent: false, previousUserTexts: [] });

beforeEach(() => {
  calls.length = 0;
});

describe("petición al analista", () => {
  it("una pregunta escrita va sin límites de tiempo falsos y con las claves de señales del backend", async () => {
    await analyze({ utterance_id: "u1", text: "hola", turn_id: "t1", state_version: 1, t: 5, voiceConsent: false, signals });
    const body = calls[0]!;
    expect(body.t_start).toBeNull();
    expect(body.t_end).toBeNull();
    expect(Object.keys(body.signals as object)).toEqual([...SIGNAL_KEYS]);
    expect(body).not.toHaveProperty("audio_wav_b64");
  });

  it("el recorte de audio solo viaja con consentimiento (R-26)", async () => {
    await analyze({ utterance_id: "u1", text: "hola", turn_id: "t1", state_version: 1, t: 5, voiceConsent: false, audioWavB64: "UklGRg==" });
    await analyze({ utterance_id: "u2", text: "hola", turn_id: "t2", state_version: 1, t: 5, t_start: 5, t_end: 900, voiceConsent: true, audioWavB64: "UklGRg==" });
    expect(calls[0]).not.toHaveProperty("audio_wav_b64");
    expect(calls[1]).toMatchObject({ audio_wav_b64: "UklGRg==", voice_consent: true, t_start: 5, t_end: 900 });
  });
});
