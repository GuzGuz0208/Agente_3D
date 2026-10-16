/**
 * Face of the avatar from the tone of the conversation (src/avatar/expression.ts):
 * every rule of the table, its precedence, and the case with no data.
 */
import { describe, expect, it } from "vitest";
import { expressionFor, type AffectReading } from "../../src/avatar/expression";

const reading = (over: Partial<AffectReading> = {}): AffectReading => ({
  sentiment: "neutral",
  emotion: "neutral",
  state_hint: "desconocido",
  ...over,
});

describe("expressionFor", () => {
  it("shows the neutral face with no data at all", () => {
    expect(expressionFor({})).toBe("neutral");
    expect(expressionFor({ affect: null, style: null })).toBe("neutral");
  });

  it("shows the neutral face when the reading is uncertain and the style is neutro", () => {
    const uncertain = reading({ sentiment: "uncertain", emotion: "incierta", state_hint: "desconocido" });
    expect(expressionFor({ affect: uncertain, style: "neutro" })).toBe("neutral");
    expect(expressionFor({ affect: reading(), style: "neutro" })).toBe("neutral");
  });

  it.each([
    ["alegría", "joyful"],
    ["sorpresa", "surprised"],
    ["tristeza", "sad"],
    ["enojo", "concerned"],
    ["asco", "concerned"],
    ["miedo", "concerned"],
  ] as const)("emotion %s -> %s", (emotion, face) => {
    expect(expressionFor({ affect: reading({ emotion }) })).toBe(face);
  });

  it.each([
    ["frustración", "concerned"],
    ["confusión", "confused"],
    ["prisa", "focused"],
    ["satisfacción", "happy"],
  ] as const)("state %s -> %s", (state_hint, face) => {
    expect(expressionFor({ affect: reading({ state_hint }) })).toBe(face);
  });

  it.each([
    ["positive", "happy"],
    ["negative", "concerned"],
  ] as const)("sentiment %s -> %s", (sentiment, face) => {
    expect(expressionFor({ affect: reading({ sentiment }) })).toBe(face);
  });

  it.each([
    ["calido", "calm"],
    ["directo", "focused"],
    ["didactico", "happy"],
    ["neutro", "neutral"],
  ] as const)("style %s -> %s when the reading says nothing", (style, face) => {
    expect(expressionFor({ style })).toBe(face);
    expect(expressionFor({ affect: reading({ sentiment: "uncertain", emotion: "incierta" }), style })).toBe(face);
  });

  describe("precedence", () => {
    it("the emotion beats the state hint", () => {
      expect(expressionFor({ affect: reading({ emotion: "sorpresa", state_hint: "confusión" }) })).toBe("surprised");
    });

    it("the state hint beats the sentiment", () => {
      expect(expressionFor({ affect: reading({ sentiment: "positive", state_hint: "frustración" }) })).toBe("concerned");
    });

    it("any affect signal beats the style", () => {
      expect(expressionFor({ affect: reading({ emotion: "tristeza" }), style: "calido" })).toBe("sad");
      expect(expressionFor({ affect: reading({ sentiment: "positive" }), style: "directo" })).toBe("happy");
    });

    it("interest draws no face and stops the chain, like the glow: only an emotion or the style speak", () => {
      expect(expressionFor({ affect: reading({ state_hint: "interés" }) })).toBe("neutral");
      expect(expressionFor({ affect: reading({ state_hint: "interés" }), style: "calido" })).toBe("calm");
      expect(expressionFor({ affect: reading({ state_hint: "interés", sentiment: "positive" }) })).toBe("neutral");
      expect(expressionFor({ affect: reading({ state_hint: "interés", sentiment: "negative" }) })).toBe("neutral");
      expect(expressionFor({ affect: reading({ state_hint: "interés", emotion: "alegría" }) })).toBe("joyful");
    });
  });
});
