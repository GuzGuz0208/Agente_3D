/**
 * Default engine: Gemini while testing (keeps the OpenAI quota for the final rehearsal);
 * the backend's `default_engine` (VOICE_DEFAULT_ENGINE) replaces it before the first
 * session, never after the person chose an engine in /admin. With Gemini the engine voice
 * is used, without the «solo con OpenAI» notice.
 */
import { describe, expect, it } from "vitest";

const controller = await import("../../src/voice/controller");
const store = await import("../../src/voice/store");

describe("default engine", () => {
  it("starts on Gemini with its own voice and no notice", () => {
    expect(store.getState().engine).toBe("gemini");
    expect(store.getState().voiceMode).toBe("engine");
    expect(store.getState().notices).toEqual([]);
  });

  it("follows the backend's default before any session, and nothing else", () => {
    controller.applyDefaultEngine(null);
    expect(store.getState().engine).toBe("gemini");
    controller.applyDefaultEngine("openai"); // VOICE_DEFAULT_ENGINE=openai for the demo
    expect(store.getState().engine).toBe("openai");
    controller.applyDefaultEngine("gemini");
    expect(store.getState().engine).toBe("gemini");
  });

  it("an engine chosen in /admin is not replaced by the backend's default", () => {
    controller.selectEngine("openai");
    controller.applyDefaultEngine("gemini");
    expect(store.getState().engine).toBe("openai");
  });
});
