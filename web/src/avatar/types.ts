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

/** Looks of the slime (same character, same behaviour): the pink gumdrop, or the lavender jelly cat. */
export type SlimeLookId = "rosado" | "gato";

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
  /**
   * Play mode: the body leaves its spot, rolls with `setTilt` and bounces off the edges of the frame.
   * The canvas container may set `--avatar-clear-bottom` (CSS pixels) to keep its controls clear.
   */
  setPlayMode?(on: boolean): void;
  /** Gravity from the device tilt, in screen space: x to the right, y downwards, each -1..1. */
  setTilt?(x: number, y: number): void;
  /** Subscribes to hits against the edges (strength 0..1), e.g. to vibrate the phone. Returns the unsubscribe. */
  onImpact?(listener: (strength: number) => void): () => void;
  /**
   * Entrance used when the person switches from the orb to the avatar: the slime jumps in and eats
   * the orb that is on screen. Resolves when the entrance is over (at once with reduced motion).
   */
  eatOrb?(options?: EatOrbOptions): Promise<void> | void;
}

/** Where the on-screen orb is, and how to fly it into the mouth (client coordinates, CSS pixels). */
export interface EatOrbOptions {
  /** Centre and radius of the orb on screen: the slime lands beside it and looks at it. */
  orb?: { x: number; y: number; radius: number };
  /** Called once, when the mouth is open wide: the orb must be inside it within `closesIn` ms. */
  onBite?: (bite: OrbBite) => void;
}

export interface OrbBite {
  /** Centre of the open mouth, and its width. */
  x: number;
  y: number;
  width: number;
  /** Where the eyes are (centre and radius): the orb goes round them, never over them. */
  eyes?: ReadonlyArray<{ x: number; y: number; radius: number }>;
  /** Milliseconds until the mouth snaps shut. */
  closesIn: number;
}

export interface MountAvatarOptions {
  /** Which character to mount. Defaults to the one stored by `pickCharacter`. */
  character?: AvatarCharacter;
  /** Slime only: which look. Defaults to the one stored by `pickSlimeLook`. */
  look?: SlimeLookId;
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
