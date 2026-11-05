/**
 * Default engine: OpenAI (2026-11-05), the engine with the cloned voice; the backend's
 * `default_engine` (VOICE_DEFAULT_ENGINE) replaces it before the first session, never after
 * the person chose an engine in /admin. The cloned voice is applied once the backend offers
 * it (`default_voice_mode`), so without a backend the engine voice stays, without notices.
 */
import { describe, expect, it } from "vitest";

const controller = await import("../../src/voice/controller");
const store = await import("../../src/voice/store");

describe("default engine", () => {
  it("starts on OpenAI, without notices", () => {
    expect(store.getState().engine).toBe("openai");
    expect(store.getState().voiceMode).toBe("engine");
    expect(store.getState().notices).toEqual([]);
  });

  it("follows the backend's default before any session, and nothing else", () => {
    controller.applyDefaultEngine(null);
    expect(store.getState().engine).toBe("openai");
    controller.applyDefaultEngine("gemini"); // VOICE_DEFAULT_ENGINE=gemini
    expect(store.getState().engine).toBe("gemini");
    controller.applyDefaultEngine("openai");
    expect(store.getState().engine).toBe("openai");
  });

  it("an engine chosen in /admin is not replaced by the backend's default", () => {
    controller.selectEngine("gemini");
    controller.applyDefaultEngine("openai");
    expect(store.getState().engine).toBe("gemini");
  });

  it("without Gemini in /health, Gemini is not selectable and recovery stays on OpenAI (D-25)", () => {
    store.setHealth([], { openai: "gpt-realtime-2.1" });
    expect(controller.engineOffered("gemini")).toBe(false);
    expect(controller.fallbackEngine("openai")).toBe("openai");
    controller.selectEngine("openai");
    controller.selectEngine("gemini");
    expect(store.getState().engine).toBe("openai");
    store.setHealth([], { openai: "gpt-realtime-2.1", gemini: "gemini-3.8-live" });
    expect(controller.fallbackEngine("openai")).toBe("gemini");
    store.setHealth([], {});
  });
});
