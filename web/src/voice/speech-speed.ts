/**
 * Speaking speed of the agent, chosen in /admin. Applies to OpenAI Realtime (`audio.output.speed`)
 * and to the cloned voice (Cartesia `generation_config.speed`); Gemini Live has no such setting.
 * 1 sends nothing extra, so the default behaves exactly as before.
 */
export const SPEECH_SPEEDS = [1, 1.15, 1.3] as const;
const KEY = "ips.speech-speed";

export function speechSpeed(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return (SPEECH_SPEEDS as readonly number[]).includes(v) ? v : 1;
  } catch {
    return 1;
  }
}

export function setSpeechSpeed(v: number): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
