/**
 * Contract shared by every avatar character (slime, human).
 *
 * `scripts/avatar-host.ts` only knows this shape, so a new character is one
 * more module that returns an `AvatarHandle`; nothing else has to change.
 */

export type AvatarState =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "renewing"
  | "error";

/**
 * Face the avatar shows on top of its state, chosen from the tone of the
 * conversation (`expression.ts`). The state still wins where it must: an
 * avatar that is asleep (connecting) or failed (error) keeps that face.
 */
export type AvatarExpression =
  | "neutral"
  | "happy"
  | "joyful"
  | "calm"
  | "focused"
  | "surprised"
  | "concerned"
  | "sad"
  | "confused";

/** `slime` is the default; `humano` is the realistic VRM model, kept for comparison. */
export type AvatarCharacter = "slime" | "humano";

export interface AvatarDebugInfo {
  fps: number;
  frameMs: number;
  frames: number;
  triangles: number;
  drawCalls: number;
  state: AvatarState;
  mouth: Record<string, number>;
  expressions: string[];
  modelName: string;
  vrmVersion: string;
}

export interface AvatarHandle {
  setState(s: AvatarState): void;
  /** Mouth opening, 0..1. Must be pushed continuously; it decays on its own. */
  setMouthLevel(level: number): void;
  /** Drives the mouth from the spectrum of the audio being played. */
  attachAnalyser?(node: AnalyserNode): void;
  resetCamera(): void;
  dispose(): void;
  /** Extra: synthetic speech pattern to preview lip-sync without audio. */
  setDemoSpeech?(on: boolean): void;
  /** Extra: plays the greeting again (a wave for the human, a hop for the slime). */
  wave?(): void;
  /** Extra: render statistics, for diagnostics. */
  getDebugInfo?(): AvatarDebugInfo;
  /** Extra: face for the tone of the conversation; eases in, never snaps. */
  setExpression?(e: AvatarExpression): void;
}

export interface MountAvatarOptions {
  /** Which character to mount. Defaults to the one stored by `pickCharacter`. */
  character?: AvatarCharacter;
  /** Human only: URL of the VRM file. */
  modelUrl?: string;
  onProgress?: (p: number) => void;
}

export type AvatarErrorCode = "webgl-unavailable" | "model-load-failed" | "invalid-model";

/** The single error type `mountAvatar` rejects with. */
export class AvatarError extends Error {
  readonly code: AvatarErrorCode;

  constructor(code: AvatarErrorCode, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "AvatarError";
    this.code = code;
  }
}
