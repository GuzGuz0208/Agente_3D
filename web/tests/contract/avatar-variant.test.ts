/**
 * Looks of the slime and the site palette that goes with the stage (src/avatar/variant.ts):
 * the stored look and its fallbacks, the palette for each character and look, the orb that
 * keeps whatever palette is on, and the correction at load.
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLIME_LOOK,
  isSiteTheme,
  isSlimeLook,
  parseSlimeLook,
  pickSlimeLook,
  SLIME_LOOK_KEY,
  themeCorrection,
  themeFor,
} from "../../src/avatar/variant";

/** A tiny in-memory Storage. */
const memory = (initial: Record<string, string> = {}): Pick<Storage, "getItem" | "setItem"> & { data: Record<string, string> } => {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? (data[key] ?? null) : null),
    setItem: (key, value) => {
      data[key] = String(value);
    },
  };
};

describe("slime looks", () => {
  it("knows the two looks and nothing else", () => {
    expect(isSlimeLook("rosado")).toBe(true);
    expect(isSlimeLook("gato")).toBe(true);
    expect(isSlimeLook("perro")).toBe(false);
    expect(isSlimeLook(null)).toBe(false);
    expect(parseSlimeLook("gato")).toBe("gato");
    expect(parseSlimeLook("GATO")).toBe(DEFAULT_SLIME_LOOK);
    expect(DEFAULT_SLIME_LOOK).toBe("rosado");
  });

  it("stores under its own key, beside the character", () => {
    expect(SLIME_LOOK_KEY).toBe("ips.slime-look");
  });

  it("picks the explicit option first", () => {
    const storage = memory({ [SLIME_LOOK_KEY]: "rosado" });
    expect(pickSlimeLook("gato", { storage, search: "?slime=rosado" })).toBe("gato");
  });

  it("then the address, and remembers it", () => {
    const storage = memory({ [SLIME_LOOK_KEY]: "rosado" });
    expect(pickSlimeLook(undefined, { storage, search: "?slime=gato" })).toBe("gato");
    expect(storage.data[SLIME_LOOK_KEY]).toBe("gato");
  });

  it("then the stored choice, then the default", () => {
    expect(pickSlimeLook(undefined, { storage: memory({ [SLIME_LOOK_KEY]: "gato" }), search: "" })).toBe("gato");
    expect(pickSlimeLook(undefined, { storage: memory({ [SLIME_LOOK_KEY]: "verde" }), search: "?slime=azul" })).toBe("rosado");
    expect(pickSlimeLook(undefined, { storage: null, search: "" })).toBe("rosado");
  });

  it("falls back to the default when the storage throws (private mode)", () => {
    const broken = {
      getItem: (): string | null => {
        throw new Error("blocked");
      },
      setItem: (): void => {
        throw new Error("blocked");
      },
    };
    expect(pickSlimeLook(undefined, { storage: broken, search: "" })).toBe("rosado");
  });
});

describe("site palette", () => {
  it("follows the character and the look", () => {
    expect(themeFor("slime", "rosado")).toBe("rosa");
    expect(themeFor("slime", "gato")).toBe("gato");
    expect(themeFor("humano", "gato")).toBe("humano");
    expect(themeFor("humano", "rosado")).toBe("humano");
  });

  it("leaves it alone for the orb", () => {
    expect(themeFor("slime", "gato", false)).toBeNull();
    expect(themeFor("humano", "rosado", false)).toBeNull();
  });

  it("only names palettes the site has", () => {
    for (const theme of [themeFor("slime", "rosado"), themeFor("slime", "gato"), themeFor("humano", "rosado")]) {
      expect(isSiteTheme(theme)).toBe(true);
    }
    expect(isSiteTheme("verde")).toBe(false);
  });

  it("corrects a stored palette that does not match the stored character at load", () => {
    expect(themeCorrection("rosa", "slime", "gato", true)).toBe("gato");
    expect(themeCorrection("gato", "humano", "gato", true)).toBe("humano");
    expect(themeCorrection(undefined, "slime", "gato", true)).toBe("gato");
  });

  it("changes nothing when it already matches, or when the orb is on screen", () => {
    expect(themeCorrection("gato", "slime", "gato", true)).toBeNull();
    expect(themeCorrection("rosa", "slime", "rosado", true)).toBeNull();
    expect(themeCorrection("humano", "slime", "gato", false)).toBeNull();
  });
});
