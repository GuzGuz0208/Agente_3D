/**
 * Lights the border of the avatar stage with the tone of the conversation.
 *
 * The first half is a pure function (tests/contract/emotion-glow.test.ts): it
 * maps the latest affect reading of the person (`AffectEstimate`, docs/10 §6) to
 * a glow. The second half is browser glue: it mirrors that glow on
 * `#avatar-stage` as `data-emotion="<key>"` and the CSS variable
 * `--emotion-glow`, and the styles in global.css («Emotion glow») draw it as
 * light around the edge. Nothing here edits AvatarStage.astro.
 *
 * Rules, first match wins, in the order of `expressionFor`
 * (src/avatar/expression.ts): emotion, then state, then sentiment.
 *
 *   | #  | Signal                 | key            | Colour                       | Face family      |
 *   |----|------------------------|----------------|------------------------------|------------------|
 *   | 1  | emotion `alegría`      | `alegria`      | sunflower yellow     #f4cb2b | positive         |
 *   | 2  | emotion `sorpresa`     | `sorpresa`     | apricot amber        #fda960 | surprised        |
 *   | 3  | emotion `tristeza`     | `tristeza`     | blue                 #2c86cf | low mood         |
 *   | 4  | emotion `enojo`        | `enojo`        | intense red          #e0242e | concerned        |
 *   | 5  | emotion `miedo`        | `miedo`        | deep violet          #554baf | concerned        |
 *   | 6  | emotion `asco`         | `asco`         | olive green          #858c32 | concerned        |
 *   | 7  | state `frustración`    | `frustracion`  | light salmon         #efa398 | concerned        |
 *   | 8  | state `confusión`      | `confusion`    | orchid lilac         #c68bd6 | confused         |
 *   | 9  | state `prisa`          | `prisa`        | orange               #e1713e | focused          |
 *   | 10 | state `satisfacción`   | `satisfaccion` | yellow (as alegría)  #f4cb2b | positive         |
 *   | 11 | state `interés`        | `neutral`      | none: stops here     —       | not emotional    |
 *   | 12 | sentiment `positive`   | `positivo`     | yellow (as alegría)  #f4cb2b | positive         |
 *   | 13 | sentiment `negative`   | `negativo`     | blue (as tristeza)   #2c86cf | low mood         |
 *   | 14 | anything else: no reading, emotion `neutral`/`incierta`, state       | not emotional    |
 *   |    | `desconocido`, sentiment `neutral`/`uncertain` → `neutral`, no glow  |                  |
 *
 * `interés` never lights the border (audit of 2026-10-16 on 49 real phrases):
 * the models tag almost every plain question as interest, so a glow there would
 * come on at every turn and stop meaning anything. It stops the chain on
 * purpose, so a positive or negative sentiment behind it does not light it either.
 *
 * Text and voice disagree (`discrepancy`): the voice branch is not validated, so
 * the glow follows the text channel (`AffectEntry.channels.text`) when there is
 * one, and stays off when there is not.
 *
 * Families: yellow is the positive family (joy, satisfaction, positive tone),
 * blue the low-mood family (sadness, negative tone); each other colour is one
 * signal. Every two different colours are more than ΔE2000 15 apart (the closest
 * are prisa–sorpresa 15.97 and enojo–prisa 17.0; enojo–frustración is 26.0), the
 * test checks it. Anger is a true red, not crimson: over the pale rose stage a
 * crimson reads as pink. It stays ΔE 17.9 from the slime (#e5507d) and 9.3 from
 * the error red (#b3261e), which is reserved for real errors. Mid and light tones,
 * no neon; the CSS lowers them further, it draws light, not paint.
 *
 * Faces: every glow goes with a face of its family in `expressionFor`
 * (positive → joyful or happy, low mood → sad or concerned, ...), and no glow
 * goes with a face that is not emotional (neutral, calm, focused, happy).
 *
 * The style (`StyleDecision.style`) is accepted so callers can pass the same
 * inputs as `expressionFor`, but by design it never lights the border: it says
 * how the agent is talking, not what the person feels.
 *
 * The colour is never the only signal: the slime's face changes with the same
 * rules, and the glue below keeps a visually hidden sentence inside the stage
 * that names what was perceived («Ánimo percibido: enojo.»).
 */
import { bind } from "./dom";
import type { ConsoleState } from "../voice/store";
import type { AffectEstimate, StyleId } from "../voice/types";

export type AffectReading = Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint">;

/** A reading as the store keeps it: the estimate may say that text and voice disagree. */
export type GlowReading = AffectReading & Partial<Pick<AffectEstimate, "discrepancy">>;

/** Per-channel readings of the same turn (`AffectEntry.channels`). */
export interface AffectChannels {
  text?: AffectReading;
  voice?: AffectReading;
}

export type GlowKey =
  | "alegria"
  | "sorpresa"
  | "tristeza"
  | "enojo"
  | "miedo"
  | "asco"
  | "frustracion"
  | "confusion"
  | "prisa"
  | "satisfaccion"
  | "positivo"
  | "negativo"
  | "neutral";

export interface EmotionGlow {
  /** Stable ASCII id, mirrored in `#avatar-stage[data-emotion]`. */
  key: GlowKey;
  /** `#rrggbb` of the glow; null means no glow (the stage keeps its normal look). */
  color: string | null;
  /** What was perceived, in Spanish, for the accessible text. */
  label: string;
}

export const NEUTRAL_GLOW: EmotionGlow = Object.freeze({ key: "neutral", color: null, label: "sin una emoción clara" });

const YELLOW = "#f4cb2b";
const BLUE = "#2c86cf";

const glow = (key: GlowKey, color: string, label: string): EmotionGlow => Object.freeze({ key, color, label });

const BY_EMOTION: Partial<Record<AffectReading["emotion"], EmotionGlow>> = {
  alegría: glow("alegria", YELLOW, "alegría"),
  sorpresa: glow("sorpresa", "#fda960", "sorpresa"),
  tristeza: glow("tristeza", BLUE, "tristeza"),
  enojo: glow("enojo", "#e0242e", "enojo"),
  miedo: glow("miedo", "#554baf", "miedo"),
  asco: glow("asco", "#858c32", "asco"),
};

const BY_STATE: Partial<Record<AffectReading["state_hint"], EmotionGlow>> = {
  frustración: glow("frustracion", "#efa398", "frustración"),
  confusión: glow("confusion", "#c68bd6", "confusión"),
  prisa: glow("prisa", "#e1713e", "prisa"),
  satisfacción: glow("satisfaccion", YELLOW, "satisfacción"),
  // Stops the chain with no glow (see the header).
  interés: NEUTRAL_GLOW,
};

const BY_SENTIMENT: Partial<Record<AffectReading["sentiment"], EmotionGlow>> = {
  positive: glow("positivo", YELLOW, "tono positivo"),
  negative: glow("negativo", BLUE, "tono negativo"),
};

/**
 * Maps the latest affect reading to the glow of the stage (see the table above).
 * `channels` only matters when the reading says that text and voice disagree.
 */
export function glowFor(affect: GlowReading | null | undefined, _style?: StyleId | null, channels?: AffectChannels | null): EmotionGlow {
  if (!affect) return NEUTRAL_GLOW;
  const reading = affect.discrepancy ? channels?.text : affect;
  if (!reading) return NEUTRAL_GLOW;
  return BY_EMOTION[reading.emotion] ?? BY_STATE[reading.state_hint] ?? BY_SENTIMENT[reading.sentiment] ?? NEUTRAL_GLOW;
}

/** Sentence read by screen readers inside the stage. */
export const glowSentence = (g: EmotionGlow): string => `Ánimo percibido: ${g.label}.`;

// ── Browser glue ─────────────────────────────────────────────────────────────

/**
 * Keeps `stage` in step with the store: `data-emotion`, `--emotion-glow` and a
 * visually hidden sentence, touched only when the glow changes. «Reiniciar»
 * empties the affect list, so the stage goes back to neutral by itself.
 * Returns the cleanup (unsubscribe and remove the sentence).
 */
export function bindEmotionGlow(stage: HTMLElement): () => void {
  const sentence = document.createElement("span");
  sentence.className = "sr-only";
  sentence.dataset.testid = "emotion-glow-label";
  stage.append(sentence);

  let shown: EmotionGlow | null = null;
  const render = (state: ConsoleState): void => {
    const last = state.affect[state.affect.length - 1];
    const next = glowFor(last?.estimate ?? null, state.style.style, last?.channels);
    if (next === shown) return; // the table holds frozen singletons: same glow, same object
    shown = next;
    stage.dataset.emotion = next.key;
    if (next.color) stage.style.setProperty("--emotion-glow", next.color);
    else stage.style.removeProperty("--emotion-glow");
    sentence.textContent = glowSentence(next);
  };

  const unbind = bind(["affect", "style"], render);
  return () => {
    unbind();
    sentence.remove();
  };
}
