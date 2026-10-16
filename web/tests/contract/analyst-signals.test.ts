/**
 * Affect review of 2026-10-16 (docs/10 §6): the interaction signals the client
 * measures, the fusion rule and the style mirror, all in step with the backend.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fuseReadings, inferStyle, interactionSignals, isRepeated, SIGNAL_KEYS, styleFor, type SignalSource } from "../../src/voice/analyst";
import { NEUTRAL_STYLE } from "../../src/voice/store";
import type { AffectEstimate, Emotion, Sentiment, StateHint } from "../../src/voice/types";

const spoken: SignalSource = {
  text: "¿Cuántas IPS hay en Cali?",
  spoken: true,
  tStart: 10_000,
  tEnd: 12_000,
  agentEndedAt: 6_000,
  interruptedAgent: false,
  previousUserTexts: [],
};

/** Field names of the backend's `InteractionSignals`, read from the Python source. */
function backendSignalFields(): string[] {
  const src = readFileSync(fileURLToPath(new URL("../../../src/models/analysis.py", import.meta.url)), "utf-8");
  const body = src.split("class InteractionSignals(BaseModel):")[1]!.split(/\n(?=\S)/)[0]!;
  return [...body.matchAll(/^ {4}(\w+): /gm)].map((m) => m[1]!).filter((f) => f !== "model_config");
}

describe("señales de interacción", () => {
  it("las claves son exactamente las que espera el backend", () => {
    expect([...SIGNAL_KEYS]).toEqual(backendSignalFields());
    expect(Object.keys(interactionSignals(spoken))).toEqual([...SIGNAL_KEYS]);
  });

  it("una pregunta escrita no tiene duración, ritmo ni pausa", () => {
    const s = interactionSignals({ ...spoken, spoken: false, tEnd: spoken.tStart });
    expect(s).toMatchObject({ duration_ms: null, words_per_second: null, pause_before_ms: null });
  });

  it("una pregunta hablada mide duración, palabras por segundo y pausa previa", () => {
    expect(interactionSignals(spoken)).toEqual({ duration_ms: 2000, words_per_second: 2.5, pause_before_ms: 4000, interrupted_agent: false, repeated_question: false });
  });

  it("si interrumpió al agente no hay pausa previa, y los valores se acotan a los límites del backend", () => {
    const s = interactionSignals({ ...spoken, interruptedAgent: true, tEnd: spoken.tStart + 500_000, text: "uno dos" });
    expect(s).toMatchObject({ interrupted_agent: true, pause_before_ms: null, duration_ms: 120_000 });
    const fast = interactionSignals({ ...spoken, tEnd: spoken.tStart + 400, text: "a b c d e f g h i j k l" });
    expect(fast.words_per_second).toBe(15);
  });

  it("detecta la misma pregunta otra vez, pero no un «sí» repetido", () => {
    expect(isRepeated("¿Cuántas camas hay en Melgar?", ["Hola", "cuántas camas hay en Melgar"])).toBe(true);
    expect(isRepeated("Sí.", ["Sí."])).toBe(false);
    expect(isRepeated("¿Y en Cali cuántas hay?", ["¿Cuántas camas hay en Melgar?"])).toBe(false);
  });
});

const reading = (sentiment: Sentiment, emotion: Emotion, state_hint: StateHint = "desconocido") => ({ sentiment, emotion, state_hint, cues: [] });
const est = (r: ReturnType<typeof reading>): AffectEstimate => ({
  turn_id: "t",
  state_version: 1,
  observed_at: "",
  ...r,
  method: "text",
  discrepancy: false,
  confidence: null,
});

describe("fusión (espejo de fuse.py)", () => {
  it("una voz incierta no borra la lectura del texto ni marca discrepancia", () => {
    expect(fuseReadings(reading("negative", "enojo", "frustración"), reading("uncertain", "incierta"))).toMatchObject({ emotion: "enojo", method: "text", discrepancy: false });
  });

  it("las palabras con emoción ganan a una voz neutra, y la discrepancia se muestra", () => {
    expect(fuseReadings(reading("negative", "miedo"), reading("neutral", "neutral", "interés"))).toMatchObject({ emotion: "miedo", state_hint: "interés", method: "fused", discrepancy: true });
  });

  it("con palabras neutras manda la voz", () => {
    expect(fuseReadings(reading("neutral", "neutral"), reading("negative", "enojo", "frustración"))).toMatchObject({ emotion: "enojo", discrepancy: true });
  });
});

describe("estilo (espejo de style_policy.yaml)", () => {
  it("miedo o tristeza llevan a cálido aunque el modelo diga frustración", () => {
    expect(styleFor(reading("negative", "miedo", "frustración"))?.style).toBe("calido");
    const out = inferStyle([est(reading("negative", "tristeza")), est(reading("negative", "tristeza"))], NEUTRAL_STYLE, 3);
    expect(out.decision).toMatchObject({ style: "calido", source: "inferred" });
  });

  it("el enojo sin estado lleva a directo; una lectura incierta no apunta a nada", () => {
    expect(styleFor(reading("negative", "enojo"))?.style).toBe("directo");
    expect(styleFor(reading("uncertain", "incierta"))).toBeUndefined();
  });
});
