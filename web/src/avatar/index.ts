/**
 * Entry point of the 3D avatar.
 *
 * Two characters share one contract (`AvatarHandle`) and one lip-sync driver:
 *   - `slime`  (default): a soft jelly companion, procedural, no model file.
 *   - `humano`: the realistic VRM model, kept so both can be compared side by side.
 *
 * Each character is a separate chunk, loaded only when it is mounted, so
 * three.js stays out of the first paint and the VRM loader is never fetched
 * for people who see the slime.
 *
 * To compare, open the console once with `?personaje=humano` (or `?personaje=slime`);
 * the choice is remembered in this browser.
 */
import type { AvatarCharacter, AvatarHandle, MountAvatarOptions } from "./types";

export { AvatarError } from "./types";
export type {
  AvatarCharacter,
  AvatarDebugInfo,
  AvatarErrorCode,
  AvatarHandle,
  AvatarState,
  MountAvatarOptions,
} from "./types";

const CHARACTER_KEY = "ips.character";
const DEFAULT_CHARACTER: AvatarCharacter = "slime";

const isCharacter = (value: unknown): value is AvatarCharacter => value === "slime" || value === "humano";

/** Explicit option, then `?personaje=` (remembered), then the stored choice, then the slime. */
export function pickCharacter(explicit?: AvatarCharacter): AvatarCharacter {
  if (explicit) return explicit;
  try {
    const fromUrl = new URLSearchParams(location.search).get("personaje");
    if (isCharacter(fromUrl)) {
      localStorage.setItem(CHARACTER_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(CHARACTER_KEY);
    if (isCharacter(stored)) return stored;
  } catch {
    // Private mode or no DOM: the default is fine.
  }
  return DEFAULT_CHARACTER;
}

/**
 * Mounts the chosen character into `canvas` and starts rendering.
 *
 * The canvas must be sized by CSS; the drawing buffer follows it. Rejects with
 * an `AvatarError` when WebGL is unavailable or a model cannot be loaded, so
 * the caller can fall back to the 2D orb.
 */
export async function mountAvatar(canvas: HTMLCanvasElement, opts: MountAvatarOptions = {}): Promise<AvatarHandle> {
  if (pickCharacter(opts.character) === "humano") {
    const { mountHuman } = await import("./human");
    return mountHuman(canvas, opts);
  }
  const { mountSlime } = await import("./slime");
  return mountSlime(canvas, opts);
}
