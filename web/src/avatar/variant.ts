/**
 * Which slime look is chosen, and which site palette goes with what is on the stage.
 *
 * Pure (no DOM, no three.js): the stage (components/AvatarStage.astro) and the
 * avatar entry point (index.ts) share these keys and rules, and the contract
 * tests check them on their own (tests/contract/avatar-variant.test.ts).
 *
 *   on the stage              palette (`<html data-theme>`, scripts/theme.ts)
 *   slime, look `rosado`  ->  rosa
 *   slime, look `gato`    ->  gato
 *   Avatar 3D (`humano`)  ->  humano
 *   the orb               ->  unchanged: it keeps whichever palette is on
 */
import type { AvatarCharacter, SlimeLookId } from "./types";

/** localStorage key of the look, beside `ips.character` (the character) and `ips.avatar` (avatar or orb). */
export const SLIME_LOOK_KEY = "ips.slime-look";
export const SLIME_LOOK_IDS: readonly SlimeLookId[] = ["rosado", "gato"];
export const DEFAULT_SLIME_LOOK: SlimeLookId = "rosado";

export type SiteTheme = "rosa" | "gato" | "humano";

export const isSlimeLook = (value: unknown): value is SlimeLookId => value === "rosado" || value === "gato";

export const isSiteTheme = (value: unknown): value is SiteTheme => value === "rosa" || value === "gato" || value === "humano";

/** A stored or typed value as a look; anything unknown is the default. */
export function parseSlimeLook(value: unknown): SlimeLookId {
  return isSlimeLook(value) ? value : DEFAULT_SLIME_LOOK;
}

/** The palette for what is on the stage, or null for the orb (it changes nothing). */
export function themeFor(character: AvatarCharacter, look: SlimeLookId, avatarOn = true): SiteTheme | null {
  if (!avatarOn) return null;
  if (character === "humano") return "humano";
  return look === "gato" ? "gato" : "rosa";
}

/**
 * The palette to put right at load, without animation, when the stored one does not match what is
 * on the stage (null when nothing must change: it already matches, or the orb is on screen).
 */
export function themeCorrection(current: unknown, character: AvatarCharacter, look: SlimeLookId, avatarOn: boolean): SiteTheme | null {
  const want = themeFor(character, look, avatarOn);
  return want && want !== current ? want : null;
}

/**
 * Explicit option, then `?slime=` in the address (remembered), then the stored choice, then
 * the default. `storage` and `search` are injectable for tests; by default the page's own.
 */
export function pickSlimeLook(
  explicit?: SlimeLookId,
  env: { storage?: Pick<Storage, "getItem" | "setItem"> | null; search?: string } = {},
): SlimeLookId {
  if (explicit && isSlimeLook(explicit)) return explicit;
  try {
    const storage = env.storage === undefined ? globalThis.localStorage : env.storage;
    const search = env.search ?? globalThis.location?.search ?? "";
    const fromUrl = new URLSearchParams(search).get("slime");
    if (isSlimeLook(fromUrl)) {
      storage?.setItem(SLIME_LOOK_KEY, fromUrl);
      return fromUrl;
    }
    const stored = storage?.getItem(SLIME_LOOK_KEY);
    if (isSlimeLook(stored)) return stored;
  } catch {
    // Private mode or no DOM: the default is fine.
  }
  return DEFAULT_SLIME_LOOK;
}
