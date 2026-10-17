/**
 * Mood pill of the conversation screen (src/scripts/mood-indicator.ts): the words
 * for every reading, the priority it shares with the glow, the neutral and
 * uncertain cases, «No es así», the «¿Por qué?» details, and the admin legend
 * (every glow once, with a sample reading that really produces it).
 */
import { describe, expect, it } from "vitest";
import { expressionFor } from "../../src/avatar/expression";
import { NEUTRAL_GLOW, glowFor, glowSentence, type GlowKey } from "../../src/scripts/emotion-glow";
import {
  DISMISSED_COPY,
  FACE_LABEL,
  LEGEND,
  MOOD_COPY,
  NO_READING_COPY,
  UNCERTAIN_COPY,
  legendRows,
  moodView,
  sampleEntry,
  stageSentence,
  type MoodInput,
} from "../../src/scripts/mood-indicator";
import type { AffectEstimate } from "../../src/voice/types";

const KEYS: GlowKey[] = [
  "alegria",
  "sorpresa",
  "tristeza",
  "enojo",
  "miedo",
  "asco",
  "frustracion",
  "confusion",
  "prisa",
  "satisfaccion",
  "positivo",
  "negativo",
  "neutral",
];

const estimate = (over: Partial<AffectEstimate> = {}): AffectEstimate => ({
  turn_id: "t1",
  state_version: 1,
  observed_at: "2026-10-16T00:00:00Z",
  sentiment: "neutral",
  emotion: "neutral",
  state_hint: "desconocido",
  method: "text",
  discrepancy: false,
  cues: [],
  confidence: null,
  ...over,
});

const entry = (over: Partial<AffectEstimate> = {}, extra: Partial<NonNullable<MoodInput["entry"]>> = {}): NonNullable<MoodInput["entry"]> => ({
  utterance_id: "u1",
  estimate: estimate(over),
  ...extra,
});

describe("copy", () => {
  it("has one sentence and one offer for every glow", () => {
    expect(Object.keys(MOOD_COPY).sort()).toEqual([...KEYS].sort());
    for (const k of KEYS) {
      expect(MOOD_COPY[k].headline.trim().length).toBeGreaterThan(3);
      expect(MOOD_COPY[k].hint.trim().length).toBeGreaterThan(3);
    }
  });

  it("hedges every reading: «Te noto…» or «Parece que…», never a verdict", () => {
    for (const k of KEYS.filter((x) => x !== "neutral")) {
      expect(MOOD_COPY[k].headline).toMatch(/^(Te noto|Parece que)\b/);
    }
  });

  it("uses no gendered adjectives, labels or clinical words", () => {
    const all = [...Object.values(MOOD_COPY), NO_READING_COPY, UNCERTAIN_COPY, DISMISSED_COPY].map((c) => `${c.headline} ${c.hint}`).join(" ");
    expect(all).not.toMatch(/\b(enojad|furios|contento|contenta|triste[sz]?\b|asustad|frustrad|confundid|apurad|satisfech|ansios|deprimid|diagn[oó]stic)/i);
  });

  it("keeps every headline short enough for one line on a phone", () => {
    for (const k of KEYS) expect(MOOD_COPY[k].headline.length).toBeLessThanOrEqual(32);
  });
});

describe("moodView", () => {
  it("says there is no reading yet before the first one", () => {
    const v = moodView({ entry: null });
    expect(v.status).toBe("none");
    expect(v.glow).toBe(NEUTRAL_GLOW);
    expect(v.headline).toBe(NO_READING_COPY.headline);
    expect(v.canDismiss).toBe(false);
    expect(v.why.source).toBeNull();
  });

  it("shows the words of the glow, with the same colour", () => {
    const v = moodView({ entry: entry({ state_hint: "prisa" }) });
    expect(v.status).toBe("reading");
    expect(v.glow.key).toBe("prisa");
    expect(v.glow.color).toBe(glowFor(estimate({ state_hint: "prisa" })).color);
    expect(v.headline).toBe("Te noto con prisa");
    expect(v.canDismiss).toBe(true);
  });

  it("follows the priority of the glow: emotion, then state, then sentiment", () => {
    expect(moodView({ entry: entry({ emotion: "enojo", state_hint: "prisa", sentiment: "positive" }) }).glow.key).toBe("enojo");
    expect(moodView({ entry: entry({ state_hint: "frustración", sentiment: "positive" }) }).headline).toBe(MOOD_COPY.frustracion.headline);
    expect(moodView({ entry: entry({ sentiment: "negative" }) }).headline).toBe(MOOD_COPY.negativo.headline);
  });

  it("answers anger and sadness with care, not alarm", () => {
    expect(moodView({ entry: entry({ emotion: "enojo" }) }).headline).toBe("Parece que algo te molestó");
    expect(moodView({ entry: entry({ emotion: "tristeza" }) }).hint).toMatch(/calma/);
  });

  it("stays neutral for interés, which the models put on almost every question", () => {
    const v = moodView({ entry: entry({ state_hint: "interés", sentiment: "positive" }) });
    expect(v.status).toBe("neutral");
    expect(v.headline).toBe("Ánimo neutral");
    expect(v.glow.color).toBeNull();
    expect(v.canDismiss).toBe(false);
  });

  it("says it is not sure when the models could not tell", () => {
    const v = moodView({ entry: entry({ sentiment: "uncertain", emotion: "incierta" }) });
    expect(v.status).toBe("uncertain");
    expect(v.headline).toBe(UNCERTAIN_COPY.headline);
  });

  it("follows the words when text and voice disagree, and says so", () => {
    const v = moodView({
      entry: entry(
        { emotion: "alegría", method: "fused", discrepancy: true },
        { channels: { text: { sentiment: "negative", emotion: "tristeza", state_hint: "desconocido" }, voice: { sentiment: "positive", emotion: "alegría", state_hint: "desconocido" } } },
      ),
    });
    expect(v.glow.key).toBe("tristeza");
    expect(v.why.source).toBe("tus palabras");
    expect(v.why.note).toMatch(/me guío por tus palabras/);
  });

  it("draws no conclusion when they disagree and there is no text reading", () => {
    const v = moodView({ entry: entry({ emotion: "enojo", method: "fused", discrepancy: true }) });
    expect(v.status).toBe("uncertain");
    expect(v.glow.color).toBeNull();
    expect(v.why.note).toMatch(/no saco conclusiones/);
  });

  it("names the source, keeps up to six cues and drops empty ones", () => {
    const v = moodView({ entry: entry({ emotion: "alegría", method: "fused", cues: ["«¡gracias!»", " ", "tono alto", "a", "b", "c", "d", "e"] }) });
    expect(v.why.source).toBe("tus palabras y tu tono de voz");
    expect(v.why.cues).toEqual(["«¡gracias!»", "tono alto", "a", "b", "c", "d"]);
    expect(moodView({ entry: entry({ method: "voice", emotion: "alegría" }) }).why.source).toBe("tu tono de voz");
  });

  it("explains the answering style only when it is not the default one", () => {
    expect(moodView({ entry: entry({ state_hint: "prisa" }), style: { style: "neutro", reason: "x" } }).why.style).toBeNull();
    const line = moodView({ entry: entry({ state_hint: "prisa" }), style: { style: "directo", reason: "Dos señales de prisa." } }).why.style;
    expect(line).toBe("Te respondo con un estilo directo. Dos señales de prisa.");
  });

  it("«No es así» takes the reading back to neutral, and only that reading", () => {
    const dismissed = moodView({ entry: entry({ emotion: "enojo" }), dismissedId: "u1" });
    expect(dismissed.status).toBe("dismissed");
    expect(dismissed.glow).toBe(NEUTRAL_GLOW);
    expect(dismissed.headline).toBe(DISMISSED_COPY.headline);
    expect(dismissed.canDismiss).toBe(false);

    const next = moodView({ entry: entry({ emotion: "enojo" }, { utterance_id: "u2" }), dismissedId: "u1" });
    expect(next.status).toBe("reading");
    expect(next.glow.key).toBe("enojo");
  });

  it("keeps the stage's hidden sentence in step, and empty when the mood is hidden", () => {
    const v = moodView({ entry: entry({ emotion: "miedo" }) });
    expect(stageSentence(v, false)).toBe(glowSentence(v.glow));
    expect(stageSentence(v, true)).toBe("");
    expect(stageSentence(moodView({ entry: entry({ emotion: "miedo" }), dismissedId: "u1" }), false)).toBe(glowSentence(NEUTRAL_GLOW));
  });
});

describe("legend", () => {
  it("lists every glow exactly once, in the order of the glow table", () => {
    expect(LEGEND.map((i) => i.key)).toEqual(KEYS);
  });

  it("gives each row a sample reading that really produces its glow and its words", () => {
    for (const row of legendRows()) {
      expect(row.glow.key).toBe(row.item.key);
      expect(row.copy).toBe(MOOD_COPY[row.item.key]);
      expect(row.face).toBe(expressionFor({ affect: row.item.reading }));
      expect(FACE_LABEL[row.face]).toBeTruthy();
      expect(moodView({ entry: entry(row.item.reading) }).headline).toBe(MOOD_COPY[row.item.key].headline);
    }
  });

  it("lights every row but the neutral one, and gives it an emotional face", () => {
    for (const row of legendRows()) {
      if (row.item.key === "neutral") {
        expect(row.glow.color).toBeNull();
        expect(row.face).toBe("neutral");
      } else {
        expect(row.glow.color).toMatch(/^#[0-9a-f]{6}$/);
        expect(["neutral", "calm"]).not.toContain(row.face);
      }
    }
  });

  it("builds a sample entry for «Probar» that goes through the store like a real one", () => {
    const e = sampleEntry("confusion", "id-1", 1234);
    expect(e.utterance_id).toBe("id-1");
    expect(e.t).toBe(1234);
    expect(e.estimate.confidence).toBeNull();
    expect(glowFor(e.estimate).key).toBe("confusion");
    expect(moodView({ entry: e }).headline).toBe("Parece que algo no quedó claro");
  });
});
