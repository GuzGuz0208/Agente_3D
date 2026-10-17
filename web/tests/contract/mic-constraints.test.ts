/**
 * Microphone constraints for a PC / laptop microphone (docs/08 §4): echo cancellation of all
 * system audio, voice isolation where it exists, and the previous constraints as a fallback
 * when the browser rejects the new ones. Permission errors are not retried.
 */
import { describe, expect, it, vi } from "vitest";
import { MIC_CONSTRAINTS, MIC_CONSTRAINTS_BASIC, openMicrophone } from "../../src/voice/audio/mic-tap";

const stream = { id: "s" } as unknown as MediaStream;
const named = (name: string): Error => Object.assign(new Error(name), { name });

describe("openMicrophone", () => {
  it("asks for echo cancellation of all audio, noise suppression, gain control, voice isolation and mono", async () => {
    const getUserMedia = vi.fn(async () => stream);
    await expect(openMicrophone({ getUserMedia })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: MIC_CONSTRAINTS });
    expect(MIC_CONSTRAINTS).toMatchObject({ echoCancellation: "all", noiseSuppression: true, autoGainControl: true, voiceIsolation: true, channelCount: 1 });
  });

  it("retries with the previous constraints when the new ones are rejected", async () => {
    const getUserMedia = vi.fn().mockRejectedValueOnce(named("OverconstrainedError")).mockResolvedValueOnce(stream);
    await expect(openMicrophone({ getUserMedia })).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenLastCalledWith({ audio: MIC_CONSTRAINTS_BASIC });
    expect(MIC_CONSTRAINTS_BASIC).toEqual({ echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 });
  });

  it("does not retry a denied permission", async () => {
    const getUserMedia = vi.fn().mockRejectedValue(named("NotAllowedError"));
    await expect(openMicrophone({ getUserMedia })).rejects.toThrow("NotAllowedError");
    expect(getUserMedia).toHaveBeenCalledTimes(1);
  });
});
