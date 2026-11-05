/**
 * Speaking speed of the agent, chosen in /admin. Applies to OpenAI Realtime (`audio.output.speed`)
 * and to the cloned voice (Cartesia `generation_config.speed`); Gemini Live has no such setting.
 * 1 sends nothing extra. The default is «Un poco más rápida» (1.15, team decision 2026-11-05);
 * a choice made in /admin is kept in the browser and wins over it.
 */
export const SPEECH_SPEEDS = [1, 1.15, 1.3] as const;
export const DEFAULT_SPEECH_SPEED = 1.15;
const KEY = "ips.speech-speed";

export function speechSpeed(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const v = Number(raw);
    return raw !== null && (SPEECH_SPEEDS as readonly number[]).includes(v) ? v : DEFAULT_SPEECH_SPEED;
  } catch {
    return DEFAULT_SPEECH_SPEED;
  }
}

export function setSpeechSpeed(v: number): void {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    // Private mode: the choice lasts for this page only.
  }
}
