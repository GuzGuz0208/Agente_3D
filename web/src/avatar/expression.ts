/**
 * Picks the avatar's face from the tone of the conversation.
 *
 * Pure function, no DOM and no three.js, so it can be tested on its own and the
 * host can call it on every store change. The input is what the store already
 * holds: the latest affect reading of the person (`AffectEstimate`, docs/10 §6)
 * and the active conversation style (`StyleDecision.style`).
 *
 * Rules, first match wins (the most specific signal leads):
 *
 *   | #  | Signal                                 | Expression  | Face                                  |
 *   |----|----------------------------------------|-------------|---------------------------------------|
 *   | 1  | emotion `alegría`                      | `joyful`    | big open "D" grin                     |
 *   | 2  | emotion `sorpresa`                     | `surprised` | round eyes, small "o"                 |
 *   | 3  | emotion `tristeza`                     | `sad`       | drooping lids, frown                  |
 *   | 4  | emotion `enojo`, `asco`, `miedo`       | `concerned` | slanted lids, small mouth             |
 *   | 5  | state `frustración`                    | `concerned` |                                       |
 *   | 6  | state `confusión`                      | `confused`  | one eye smaller, crooked mouth, tilt  |
 *   | 7  | state `prisa`                          | `focused`   | narrowed eyes, straight mouth         |
 *   | 8  | state `satisfacción`, `interés`        | `happy`     | wide smile                            |
 *   | 9  | sentiment `positive`                   | `joyful`    |                                       |
 *   | 10 | sentiment `negative`                   | `concerned` |                                       |
 *   | 11 | style `calido`                         | `calm`      | closed happy eyes "^ ^", soft smile   |
 *   | 12 | style `directo`                        | `focused`   |                                       |
 *   | 13 | style `didactico`                      | `happy`     |                                       |
 *   | 14 | anything else (no reading, `incierta`, |             |                                       |
 *   |    | `desconocido`, `uncertain`, `neutro`)  | `neutral`   | gentle smile                          |
 *
 * The reading describes the person, so the face answers it with empathy rather
 * than mirroring anger: frustration or anger get a concerned face, never an
 * angry one. The style is the fallback because it is slower and steadier than a
 * single reading: it says how the agent is talking, not how the person feels now.
 *
 * The state of the avatar (connecting, thinking, error...) is NOT decided here:
 * each character blends this face with its state and lets the state win where it
 * must (asleep stays asleep, a failure stays sad).
 */
import type { AffectEstimate, StyleId } from "../voice/types";
import type { AvatarExpression } from "./types";

export type AffectReading = Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint">;

export interface ExpressionInput {
  /** Latest affect reading of the person; null or absent when there is none yet. */
  affect?: AffectReading | null;
  /** Active conversation style; null or absent means `neutro`. */
  style?: StyleId | null;
}

const BY_EMOTION: Partial<Record<AffectReading["emotion"], AvatarExpression>> = {
  alegría: "joyful",
  sorpresa: "surprised",
  tristeza: "sad",
  enojo: "concerned",
  asco: "concerned",
  miedo: "concerned",
};

const BY_STATE: Partial<Record<AffectReading["state_hint"], AvatarExpression>> = {
  frustración: "concerned",
  confusión: "confused",
  prisa: "focused",
  satisfacción: "happy",
  interés: "happy",
};

const BY_SENTIMENT: Partial<Record<AffectReading["sentiment"], AvatarExpression>> = {
  positive: "joyful",
  negative: "concerned",
};

const BY_STYLE: Record<StyleId, AvatarExpression> = {
  calido: "calm",
  directo: "focused",
  didactico: "happy",
  neutro: "neutral",
};

/** Maps the affect reading and the style to a face (see the table above). */
export function expressionFor(input: ExpressionInput): AvatarExpression {
  const affect = input.affect;
  if (affect) {
    const fromAffect = BY_EMOTION[affect.emotion] ?? BY_STATE[affect.state_hint] ?? BY_SENTIMENT[affect.sentiment];
    if (fromAffect) return fromAffect;
  }
  return (input.style && BY_STYLE[input.style]) || "neutral";
}
