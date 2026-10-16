/**
 * Glow of the avatar stage from the tone of the conversation (src/scripts/emotion-glow.ts):
 * every rule of the table, its precedence (the one of expressionFor), the cases
 * with nothing to say, `interés` with no glow, the text/voice discrepancy, how far
 * apart the colours are (CIEDE2000), and the agreement with the face by families.
 */
import { describe, expect, it } from "vitest";
import { expressionFor } from "../../src/avatar/expression";
import { NEUTRAL_GLOW, glowFor, glowSentence, type AffectReading, type EmotionGlow } from "../../src/scripts/emotion-glow";
import type { Emotion, Sentiment, StateHint, StyleId } from "../../src/voice/types";

const reading = (over: Partial<AffectReading> = {}): AffectReading => ({
  sentiment: "neutral",
  emotion: "neutral",
  state_hint: "desconocido",
  ...over,
});

const EMOTIONS: Emotion[] = ["alegría", "tristeza", "enojo", "miedo", "sorpresa", "asco", "neutral", "incierta"];
const STATES: StateHint[] = ["frustración", "confusión", "satisfacción", "prisa", "interés", "desconocido"];
const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative", "uncertain"];
const STYLES: StyleId[] = ["neutro", "calido", "directo", "didactico"];

const HEX = /^#[0-9a-f]{6}$/;
const YELLOW = "#f4cb2b";
const BLUE = "#2c86cf";

// ── CIEDE2000 (sRGB hex, D65), to keep the colours apart ─────────────────────

function lab(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const f = (t: number): number => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const fx = f((0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047);
  const fy = f(0.2126729 * r + 0.7151522 * g + 0.072175 * b);
  const fz = f((0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function deltaE2000([L1, a1, b1]: [number, number, number], [L2, a2, b2]: [number, number, number]): number {
  const d = Math.PI / 180;
  const Cm = (Math.hypot(a1, b1) + Math.hypot(a2, b2)) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const p1 = (1 + G) * a1;
  const p2 = (1 + G) * a2;
  const C1 = Math.hypot(p1, b1);
  const C2 = Math.hypot(p2, b2);
  const hue = (x: number, y: number): number => (x === 0 && y === 0 ? 0 : (Math.atan2(y, x) / d + 360) % 360);
  const h1 = hue(p1, b1);
  const h2 = hue(p2, b2);
  let dh = C1 * C2 === 0 ? 0 : h2 - h1;
  if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(C1 * C2) * Math.sin((dh / 2) * d);
  const Lm = (L1 + L2) / 2;
  const Cpm = (C1 + C2) / 2;
  let hm = h1 + h2;
  if (C1 * C2 !== 0) hm = Math.abs(h1 - h2) > 180 ? (h1 + h2 < 360 ? (h1 + h2 + 360) / 2 : (h1 + h2 - 360) / 2) : (h1 + h2) / 2;
  const T = 1 - 0.17 * Math.cos((hm - 30) * d) + 0.24 * Math.cos(2 * hm * d) + 0.32 * Math.cos((3 * hm + 6) * d) - 0.2 * Math.cos((4 * hm - 63) * d);
  const Rt = -Math.sin(2 * 30 * Math.exp(-(((hm - 275) / 25) ** 2)) * d) * 2 * Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const Sc = 1 + 0.045 * Cpm;
  const Sh = 1 + 0.015 * Cpm * T;
  const x = (L2 - L1) / Sl;
  const y = (C2 - C1) / Sc;
  const z = dH / Sh;
  return Math.sqrt(x * x + y * y + z * z + Rt * y * z);
}

const dE = (a: string, b: string): number => deltaE2000(lab(a), lab(b));

/** Every glow the table can produce. */
const ALL_GLOWS: EmotionGlow[] = [
  ...new Set(EMOTIONS.flatMap((emotion) => STATES.flatMap((state_hint) => SENTIMENTS.map((sentiment) => glowFor(reading({ emotion, state_hint, sentiment })))))),
];

describe("glowFor", () => {
  it("has no glow with no data at all", () => {
    expect(glowFor(null)).toEqual({ key: "neutral", color: null, label: "sin una emoción clara" });
    expect(glowFor(undefined)).toBe(NEUTRAL_GLOW);
    expect(glowFor(null, null)).toBe(NEUTRAL_GLOW);
    expect(glowFor(null, "calido", { text: reading({ emotion: "enojo" }) })).toBe(NEUTRAL_GLOW);
  });

  it("has no glow when the reading says nothing", () => {
    expect(glowFor(reading())).toBe(NEUTRAL_GLOW);
    expect(glowFor(reading({ emotion: "incierta", sentiment: "uncertain" }))).toBe(NEUTRAL_GLOW);
  });

  it.each([
    ["enojo", "enojo", "#e0242e"],
    ["tristeza", "tristeza", BLUE],
    ["alegría", "alegria", YELLOW],
  ] as const)("the owner's three: emotion %s -> %s (%s)", (emotion, key, color) => {
    expect(glowFor(reading({ emotion }))).toMatchObject({ key, color, label: emotion });
  });

  it.each([
    ["sorpresa", "sorpresa", "#fda960"],
    ["miedo", "miedo", "#554baf"],
    ["asco", "asco", "#858c32"],
  ] as const)("emotion %s -> %s (%s)", (emotion, key, color) => {
    expect(glowFor(reading({ emotion }))).toMatchObject({ key, color, label: emotion });
  });

  it.each([
    ["frustración", "frustracion", "#efa398"],
    ["confusión", "confusion", "#c68bd6"],
    ["prisa", "prisa", "#e1713e"],
    ["satisfacción", "satisfaccion", YELLOW],
  ] as const)("state %s -> %s (%s) when the emotion says nothing", (state_hint, key, color) => {
    expect(glowFor(reading({ state_hint }))).toMatchObject({ key, color, label: state_hint });
    // «incierta» says nothing either.
    expect(glowFor(reading({ emotion: "incierta", state_hint })).key).toBe(key);
  });

  it("interés never lights the border, whatever the sentiment behind it", () => {
    for (const sentiment of SENTIMENTS) {
      expect(glowFor(reading({ state_hint: "interés", sentiment }))).toBe(NEUTRAL_GLOW);
      expect(glowFor(reading({ emotion: "incierta", state_hint: "interés", sentiment }))).toBe(NEUTRAL_GLOW);
    }
    // An emotion still wins over it.
    expect(glowFor(reading({ emotion: "enojo", state_hint: "interés" })).key).toBe("enojo");
  });

  it.each([
    ["positive", "positivo", "tono positivo", YELLOW],
    ["negative", "negativo", "tono negativo", BLUE],
  ] as const)("sentiment %s -> %s when emotion and state say nothing", (sentiment, key, label, color) => {
    expect(glowFor(reading({ sentiment }))).toEqual({ key, label, color });
  });

  it("the emotion wins over the state and the sentiment", () => {
    expect(glowFor(reading({ emotion: "enojo", state_hint: "satisfacción", sentiment: "positive" })).key).toBe("enojo");
    expect(glowFor(reading({ emotion: "tristeza", state_hint: "prisa", sentiment: "positive" })).key).toBe("tristeza");
  });

  it("the state wins over the sentiment", () => {
    expect(glowFor(reading({ state_hint: "frustración", sentiment: "positive" })).key).toBe("frustracion");
    expect(glowFor(reading({ state_hint: "satisfacción", sentiment: "negative" })).key).toBe("satisfaccion");
  });

  it.each(STYLES)("style %s never lights the border on its own", (style) => {
    expect(glowFor(null, style)).toBe(NEUTRAL_GLOW);
    expect(glowFor(reading(), style)).toBe(NEUTRAL_GLOW);
    expect(glowFor(reading({ emotion: "enojo" }), style).key).toBe("enojo");
  });

  it("returns the same object for the same glow, so the stage is only touched on a change", () => {
    expect(glowFor(reading({ emotion: "enojo" }))).toBe(glowFor(reading({ emotion: "enojo", sentiment: "negative" })));
  });

  it("names what was perceived in a sentence for screen readers", () => {
    expect(glowSentence(glowFor(reading({ emotion: "enojo" })))).toBe("Ánimo percibido: enojo.");
    expect(glowSentence(NEUTRAL_GLOW)).toBe("Ánimo percibido: sin una emoción clara.");
  });
});

describe("glowFor when text and voice disagree", () => {
  const fused = (over: Partial<AffectReading>, discrepancy: boolean) => ({ ...reading(over), discrepancy });

  it("follows the text channel, never the voice", () => {
    const est = fused({ emotion: "enojo", sentiment: "negative" }, true); // the voice led the fusion
    const channels = { text: reading({ emotion: "tristeza" }), voice: reading({ emotion: "enojo" }) };
    expect(glowFor(est, "neutro", channels).key).toBe("tristeza");
  });

  it("has no glow when there is no text channel", () => {
    const est = fused({ emotion: "enojo" }, true);
    expect(glowFor(est)).toBe(NEUTRAL_GLOW);
    expect(glowFor(est, "neutro", null)).toBe(NEUTRAL_GLOW);
    expect(glowFor(est, "neutro", { voice: reading({ emotion: "enojo" }) })).toBe(NEUTRAL_GLOW);
  });

  it("applies every rule to the text channel, interés included", () => {
    const est = fused({ emotion: "alegría" }, true);
    expect(glowFor(est, null, { text: reading({ state_hint: "interés", sentiment: "positive" }) })).toBe(NEUTRAL_GLOW);
    expect(glowFor(est, null, { text: reading() })).toBe(NEUTRAL_GLOW);
    expect(glowFor(est, null, { text: reading({ sentiment: "negative" }) }).key).toBe("negativo");
  });

  it("uses the estimate itself when the channels agree", () => {
    const est = fused({ emotion: "sorpresa" }, false);
    expect(glowFor(est, null, { text: reading({ emotion: "tristeza" }), voice: reading({ emotion: "sorpresa" }) }).key).toBe("sorpresa");
  });
});

describe("the colours", () => {
  it("are #rrggbb, one per signal, with two deliberate families", () => {
    const lit = ALL_GLOWS.filter((g) => g.color);
    for (const g of lit) expect(g.color).toMatch(HEX);
    // Positive family: joy, satisfaction and the positive tone share the yellow; low mood shares the blue.
    expect(lit.filter((g) => g.color === YELLOW).map((g) => g.key).sort()).toEqual(["alegria", "positivo", "satisfaccion"]);
    expect(lit.filter((g) => g.color === BLUE).map((g) => g.key).sort()).toEqual(["negativo", "tristeza"]);
    expect(lit.map((g) => g.key).sort()).toEqual([
      "alegria",
      "asco",
      "confusion",
      "enojo",
      "frustracion",
      "miedo",
      "negativo",
      "positivo",
      "prisa",
      "satisfaccion",
      "sorpresa",
      "tristeza",
    ]);
  });

  it("CIEDE2000 matches the reference data (Sharma et al. 2005, pairs 1 and 17)", () => {
    expect(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE2000([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
  });

  it("every two different colours are at least ΔE2000 15 apart (closest today: prisa–sorpresa 15.97)", () => {
    const colors = [...new Set(ALL_GLOWS.map((g) => g.color).filter((c): c is string => c !== null))];
    expect(colors).toHaveLength(9);
    for (let i = 0; i < colors.length; i++)
      for (let j = i + 1; j < colors.length; j++) expect(dE(colors[i]!, colors[j]!), `${colors[i]} vs ${colors[j]}`).toBeGreaterThanOrEqual(15);
  });

  it("anger and frustration are far apart, and anger is neither the slime's pink nor the error red", () => {
    const anger = glowFor(reading({ emotion: "enojo" })).color!;
    const frustration = glowFor(reading({ state_hint: "frustración" })).color!;
    expect(dE(anger, frustration)).toBeGreaterThanOrEqual(25);
    expect(dE(anger, "#e5507d")).toBeGreaterThanOrEqual(15); // --rose-500, the slime's body
    expect(dE(frustration, "#e5507d")).toBeGreaterThanOrEqual(15);
    expect(dE(anger, "#b3261e")).toBeGreaterThanOrEqual(9); // --red-700, real errors only
  });
});

/**
 * Glow and face by families. The face (expressionFor) is free to pick a finer
 * expression inside a family (joyful or happy for the positive one), so this
 * keeps holding when the face changes `positive` → `happy` or `interés` →
 * `neutral`. A glow never shows over a face of another family, and no glow goes
 * with a face that is not emotional.
 */
describe("glowFor and expressionFor agree by families", () => {
  const FAMILY: Record<string, string[]> = {
    alegria: ["joyful", "happy"],
    positivo: ["joyful", "happy"],
    satisfaccion: ["joyful", "happy"],
    tristeza: ["sad", "concerned"],
    negativo: ["sad", "concerned"],
    enojo: ["concerned"],
    miedo: ["concerned"],
    asco: ["concerned"],
    frustracion: ["concerned"],
    sorpresa: ["surprised"],
    confusion: ["confused"],
    prisa: ["focused"],
  };
  /** Faces that show no particular emotion: the style faces, and `happy`, today's face for interest. */
  const NOT_EMOTIONAL = ["neutral", "calm", "focused", "happy"];

  it("every combination of reading and style", () => {
    for (const emotion of EMOTIONS)
      for (const state_hint of STATES)
        for (const sentiment of SENTIMENTS)
          for (const style of STYLES) {
            // Interest with an emotion that says nothing is the rule the face is about to change (it may
            // also hand over to the sentiment); its glow is fixed, none, and tested above.
            if (state_hint === "interés" && (emotion === "neutral" || emotion === "incierta")) continue;
            const affect = reading({ emotion, state_hint, sentiment });
            const g = glowFor(affect, style);
            const face = expressionFor({ affect, style });
            const where = `${emotion}/${state_hint}/${sentiment}/${style} -> ${g.key}, ${face}`;
            if (g.key === "neutral") expect(NOT_EMOTIONAL, where).toContain(face);
            else expect(FAMILY[g.key], where).toContain(face);
          }
  });
});
