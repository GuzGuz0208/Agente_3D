/**
 * Mood indicator of the conversation screen: the glow of the stage, said in words.
 *
 * The border of `#avatar-stage` already lights up with the tone of the latest
 * reading (`glowFor`, scripts/emotion-glow.ts). Colour alone is not enough
 * (WCAG 1.4.1), and an inferred emotion must be explained, hedged and easy to
 * correct or switch off (Microsoft HAX G2, G8, G9, G11, G17; Google PAIR
 * «Explainability + Trust»; EU AI Act art. 50(3)). This module adds:
 *
 *   · a pill next to the stage with a dot of the same colour as the glow and one
 *     plain-language sentence in the agent's voice («Te noto con prisa»);
 *   · «¿Por qué?»: what the reading came from (words, voice), the cues, the
 *     text/voice disagreement and the style the agent answers with;
 *   · «No es así»: hides that reading (pill and glow back to neutral) until the
 *     next one; there is no feedback endpoint, so nothing is sent anywhere;
 *   · «Ocultar el ánimo»: switches the indicator and the glow off in this browser.
 *
 * The first half is pure (tests/contract/mood-indicator.test.ts). The priority
 * of the signals is the one of `glowFor`, reused as is: emotion, then state,
 * then sentiment; `interés` and uncertain readings stay neutral.
 *
 * Copy rules: hedged («Te noto», «Parece que»), never a diagnosis, no gendered
 * adjectives («contento/contenta»), and anger or sadness answered with care,
 * never with alarm. The confidence of the estimate is not calibrated, so it is
 * never shown as a number or a «high/low» bucket (types.ts, PAIR).
 */
import { expressionFor } from "../avatar/expression";
import type { AvatarExpression } from "../avatar/types";
import { dismissAffect, getState, subscribe, type AffectEntry, type ConsoleState } from "../voice/store";
import type { AffectMethod, StyleDecision, StyleId } from "../voice/types";
import { esc } from "./dom";
import { NEUTRAL_GLOW, glowFor, glowSentence, type AffectReading, type EmotionGlow, type GlowKey } from "./emotion-glow";

// ── Copy ─────────────────────────────────────────────────────────────────────

export interface MoodCopy {
  /** One short sentence, in the agent's voice. */
  headline: string;
  /** What the agent offers in return; shown next to the headline on wide screens. */
  hint: string;
}

const copy = (headline: string, hint: string): MoodCopy => Object.freeze({ headline, hint });

/** Plain-language text per glow. The keys are the ones of `glowFor`. */
export const MOOD_COPY: Readonly<Record<GlowKey, MoodCopy>> = Object.freeze({
  alegria: copy("Te noto con alegría", "¡Qué bien! Sigamos."),
  sorpresa: copy("Parece que algo te sorprendió", "Si quieres, te lo explico otra vez."),
  tristeza: copy("Te noto con algo de tristeza", "Vamos con calma, aquí sigo."),
  enojo: copy("Parece que algo te molestó", "Lo siento. Dime qué no salió bien."),
  miedo: copy("Te noto con preocupación", "Vamos paso a paso, con calma."),
  asco: copy("Parece que algo no te gustó", "Dime qué cambiarías."),
  frustracion: copy("Parece que algo te frustró", "Probemos de otra forma."),
  confusion: copy("Parece que algo no quedó claro", "Pregúntame de nuevo y lo explico distinto."),
  prisa: copy("Te noto con prisa", "Voy al grano."),
  satisfaccion: copy("Parece que esto te sirvió", "Me alegra."),
  positivo: copy("Te noto de buen ánimo", "Sigamos."),
  negativo: copy("Parece que algo no va bien", "Cuéntame y lo revisamos."),
  neutral: copy("Ánimo neutral", "Sin una emoción marcada."),
});

export const NO_READING_COPY: MoodCopy = copy("Aún no leo tu ánimo", "Aparece cuando hablemos.");
export const UNCERTAIN_COPY: MoodCopy = copy("No tengo claro tu ánimo", "Prefiero no suponer.");
export const DISMISSED_COPY: MoodCopy = copy("Gracias, quité esa lectura", "Vuelvo a mirar con tu próximo mensaje.");

/** Shown in «¿Qué es esto?» before the first reading, and at the end of «¿Por qué?». */
export const ABOUT_TEXT =
  "Mientras hablamos, estimo tu ánimo a partir de tus palabras (y de tu tono de voz, solo si activas tu voz) para responderte mejor. Es una estimación automática, no un diagnóstico: puede equivocarse.";

const SOURCE: Record<AffectMethod, string> = {
  text: "tus palabras",
  voice: "tu tono de voz",
  fused: "tus palabras y tu tono de voz",
};

const STYLE_NAME: Record<StyleId, string> = { directo: "directo", calido: "cálido", didactico: "didáctico", neutro: "neutro" };

// ── View ─────────────────────────────────────────────────────────────────────

/**
 * none: no reading yet · neutral: a reading with nothing to say · uncertain: the
 * channels disagree or the models could not tell · reading: something to show ·
 * dismissed: the person said «No es así» to the current reading.
 */
export type MoodStatus = "none" | "neutral" | "uncertain" | "reading" | "dismissed";

export interface MoodInput {
  /** Latest entry of `state.affect`, or null. */
  entry: Pick<AffectEntry, "utterance_id" | "estimate" | "channels"> | null;
  style?: Pick<StyleDecision, "style" | "reason"> | null;
  /** `utterance_id` of the reading the person dismissed, if any. */
  dismissedId?: string | null;
}

export interface MoodWhy {
  /** «tus palabras», «tu tono de voz»… null without a reading. */
  source: string | null;
  cues: string[];
  /** Text and voice disagreed. */
  note: string | null;
  /** How the agent answers, when the style is not the default one. */
  style: string | null;
}

export interface MoodView {
  status: MoodStatus;
  /** Glow drawn on the stage and on the dot: neutral (no colour) unless status is `reading`. */
  glow: EmotionGlow;
  headline: string;
  hint: string;
  entryId: string | null;
  canDismiss: boolean;
  why: MoodWhy;
}

const NO_WHY: MoodWhy = Object.freeze({ source: null, cues: [], note: null, style: null });

function styleLine(style: MoodInput["style"]): string | null {
  if (!style || style.style === "neutro") return null;
  const reason = style.reason.trim();
  return `Te respondo con un estilo ${STYLE_NAME[style.style]}.${reason ? ` ${reason}` : ""}`;
}

/** Turns the latest reading into what the pill shows (see the header). */
export function moodView(input: MoodInput): MoodView {
  const entry = input.entry;
  if (!entry) {
    return { status: "none", glow: NEUTRAL_GLOW, ...NO_READING_COPY, entryId: null, canDismiss: false, why: NO_WHY };
  }
  const est = entry.estimate;
  const textOnly = est.discrepancy && !!entry.channels?.text;
  const why: MoodWhy = {
    source: SOURCE[textOnly ? "text" : est.method],
    cues: est.cues.map((c) => c.trim()).filter(Boolean).slice(0, 6),
    note: est.discrepancy
      ? textOnly
        ? "Tu tono de voz y tus palabras no coincidían: me guío por tus palabras."
        : "Tu tono de voz y tus palabras no coincidían, así que no saco conclusiones."
      : null,
    style: styleLine(input.style),
  };
  const base = { entryId: entry.utterance_id, why };

  if (input.dismissedId && input.dismissedId === entry.utterance_id) {
    return { status: "dismissed", glow: NEUTRAL_GLOW, ...DISMISSED_COPY, ...base, canDismiss: false };
  }
  const glow = glowFor(est, input.style?.style ?? null, entry.channels);
  if (glow.key !== "neutral") {
    return { status: "reading", glow, ...MOOD_COPY[glow.key], ...base, canDismiss: true };
  }
  const reading: AffectReading | undefined = est.discrepancy ? entry.channels?.text : est;
  const unclear = !reading || (reading.emotion === "incierta" && (reading.sentiment === "uncertain" || reading.sentiment === "neutral"));
  return unclear
    ? { status: "uncertain", glow: NEUTRAL_GLOW, ...UNCERTAIN_COPY, ...base, canDismiss: false }
    : { status: "neutral", glow: NEUTRAL_GLOW, ...MOOD_COPY.neutral, ...base, canDismiss: false };
}

/** Sentence for screen readers inside the stage, kept in step with the pill. */
export const stageSentence = (view: MoodView, hidden: boolean): string => (hidden ? "" : glowSentence(view.glow));

// ── Legend (admin) ───────────────────────────────────────────────────────────

export type LegendGroup = "emoción" | "estado" | "tono" | "neutral";

export interface LegendItem {
  key: GlowKey;
  group: LegendGroup;
  /** The analyst's own word for the signal, shown small as the technical name. */
  signal: string;
  /** A reading that produces this glow, for the preview and «Probar». */
  reading: AffectReading;
}

const r = (sentiment: AffectReading["sentiment"], emotion: AffectReading["emotion"], state_hint: AffectReading["state_hint"]): AffectReading =>
  Object.freeze({ sentiment, emotion, state_hint });

/** Every glow, in the order of `glowFor`'s table. */
export const LEGEND: readonly LegendItem[] = Object.freeze([
  { key: "alegria", group: "emoción", signal: "alegría", reading: r("positive", "alegría", "desconocido") },
  { key: "sorpresa", group: "emoción", signal: "sorpresa", reading: r("neutral", "sorpresa", "desconocido") },
  { key: "tristeza", group: "emoción", signal: "tristeza", reading: r("negative", "tristeza", "desconocido") },
  { key: "enojo", group: "emoción", signal: "enojo", reading: r("negative", "enojo", "desconocido") },
  { key: "miedo", group: "emoción", signal: "miedo", reading: r("negative", "miedo", "desconocido") },
  { key: "asco", group: "emoción", signal: "asco", reading: r("negative", "asco", "desconocido") },
  { key: "frustracion", group: "estado", signal: "frustración", reading: r("negative", "neutral", "frustración") },
  { key: "confusion", group: "estado", signal: "confusión", reading: r("neutral", "neutral", "confusión") },
  { key: "prisa", group: "estado", signal: "prisa", reading: r("neutral", "neutral", "prisa") },
  { key: "satisfaccion", group: "estado", signal: "satisfacción", reading: r("positive", "neutral", "satisfacción") },
  { key: "positivo", group: "tono", signal: "tono positivo", reading: r("positive", "neutral", "desconocido") },
  { key: "negativo", group: "tono", signal: "tono negativo", reading: r("negative", "neutral", "desconocido") },
  { key: "neutral", group: "neutral", signal: "sin emoción clara", reading: r("neutral", "neutral", "desconocido") },
] satisfies LegendItem[]);

/** Name of each face of the slime, in plain Spanish. */
export const FACE_LABEL: Readonly<Record<AvatarExpression, string>> = Object.freeze({
  neutral: "sonrisa suave",
  happy: "sonrisa amplia",
  joyful: "risa abierta",
  calm: "ojos cerrados, tranquila",
  focused: "concentrada",
  surprised: "sorprendida",
  concerned: "preocupada, empática",
  sad: "triste",
  confused: "confundida",
});

export interface LegendRow {
  item: LegendItem;
  glow: EmotionGlow;
  copy: MoodCopy;
  face: AvatarExpression;
}

/** Rows of the admin legend: colour, words and face of every reading. */
export function legendRows(): LegendRow[] {
  return LEGEND.map((item) => ({
    item,
    glow: glowFor(item.reading),
    copy: MOOD_COPY[item.key],
    face: expressionFor({ affect: item.reading }),
  }));
}

/** A sample affect entry for «Probar»: it goes through `pushAffect` like a real one. */
export function sampleEntry(key: GlowKey, id: string, t: number): AffectEntry {
  const item = LEGEND.find((i) => i.key === key) ?? LEGEND[LEGEND.length - 1]!;
  return {
    utterance_id: id,
    text: `Lectura de muestra: ${item.signal}`,
    t,
    analysis_ms: null,
    estimate: {
      turn_id: "muestra",
      state_version: 0,
      observed_at: new Date().toISOString(),
      ...item.reading,
      method: "text",
      discrepancy: false,
      cues: ["lectura de muestra desde el administrador"],
      confidence: null,
    },
  };
}

// ── Preference: hidden or shown (per browser) ────────────────────────────────

const HIDE_KEY = "ips.mood";

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDE_KEY) === "off";
  } catch {
    return false;
  }
}

function writeHidden(hidden: boolean): void {
  try {
    if (hidden) localStorage.setItem(HIDE_KEY, "off");
    else localStorage.removeItem(HIDE_KEY);
  } catch {
    // Not essential: the choice lasts for this page only.
  }
}

// Module state survives view transitions, like the store.
let dismissedId: string | null = null;

// ── Browser glue ─────────────────────────────────────────────────────────────

const latest = (s: ConsoleState): AffectEntry | null => s.affect[s.affect.length - 1] ?? null;

/**
 * Keeps the pill (`root`, MoodIndicator.astro) in step with the store and, when
 * the person dismisses a reading or hides the indicator, takes the glow off the
 * stage. It must be bound AFTER `bindEmotionGlow`, so its writes on the stage
 * come last in the same store notification. Returns the cleanup.
 */
export function bindMoodIndicator(root: HTMLElement, stage: HTMLElement | null): () => void {
  const $ = <T extends HTMLElement>(sel: string): T => root.querySelector<T>(sel)!;
  const headline = $<HTMLElement>("[data-mood-headline]");
  const hint = $<HTMLElement>("[data-mood-hint]");
  const toggle = $<HTMLButtonElement>("[data-mood-toggle]");
  const toggleLabel = $<HTMLElement>("[data-mood-toggle-label]");
  const details = $<HTMLElement>("[data-mood-details]");
  const whyBody = $<HTMLElement>("[data-mood-why]");
  const dismiss = $<HTMLButtonElement>("[data-mood-dismiss]");
  const hide = $<HTMLButtonElement>("[data-mood-hide]");
  const show = $<HTMLButtonElement>("[data-mood-show]");

  let hidden = readHidden();
  let view: MoodView = moodView({ entry: null });
  let whyHtml = "";

  const paintStage = (): void => {
    if (!stage) return;
    const g = hidden ? NEUTRAL_GLOW : view.glow;
    if (stage.dataset.emotion !== g.key) stage.dataset.emotion = g.key;
    if (g.color) stage.style.setProperty("--emotion-glow", g.color);
    else stage.style.removeProperty("--emotion-glow");
    const sentence = stage.querySelector<HTMLElement>('[data-testid="emotion-glow-label"]');
    const text = stageSentence(view, hidden);
    if (sentence && sentence.textContent !== text) sentence.textContent = text;
  };

  const renderWhy = (): string => {
    const w = view.why;
    // The offer is hidden next to the headline on narrow columns; it is repeated here for them.
    const rows: string[] = [`<p class="mood-why-hint">${esc(view.hint)}</p>`];
    if (w.source) rows.push(`<p><strong>Lo noto por</strong> ${esc(w.source)}.</p>`);
    if (w.cues.length) {
      rows.push(`<p class="mood-cues-title">Señales:</p><ul class="mood-cues">${w.cues.map((c) => `<li>${esc(c)}</li>`).join("")}</ul>`);
    }
    if (w.note) rows.push(`<p>${esc(w.note)}</p>`);
    if (w.style) rows.push(`<p>${esc(w.style)}</p>`);
    rows.push(`<p class="mood-about">${esc(ABOUT_TEXT)}</p>`);
    return rows.join("");
  };

  const render = (): void => {
    root.dataset.hidden = String(hidden);
    root.dataset.status = view.status;
    root.dataset.key = view.glow.key;
    if (view.glow.color) root.style.setProperty("--mood-glow", view.glow.color);
    else root.style.removeProperty("--mood-glow");

    if (headline.textContent !== view.headline) {
      headline.textContent = view.headline;
      // Replays the soft fade of the words (none with reduced motion, see the styles).
      root.classList.remove("is-new");
      void root.offsetWidth;
      root.classList.add("is-new");
    }
    if (hint.textContent !== view.hint) hint.textContent = view.hint;
    const label = view.status === "none" ? "¿Qué es esto?" : "¿Por qué?";
    if (toggleLabel.textContent !== label) toggleLabel.textContent = label;
    const html = renderWhy();
    if (html !== whyHtml) {
      whyHtml = html;
      whyBody.innerHTML = html;
    }
    dismiss.hidden = !view.canDismiss;
    paintStage();
  };

  const update = (s: ConsoleState): void => {
    const entry = latest(s);
    // A new reading clears an old «No es así».
    if (dismissedId && entry?.utterance_id !== dismissedId) dismissedId = null;
    view = moodView({ entry, style: s.style, dismissedId });
    render();
  };

  const setOpen = (open: boolean): void => {
    toggle.setAttribute("aria-expanded", String(open));
    details.hidden = !open;
  };

  const onToggle = (): void => setOpen(toggle.getAttribute("aria-expanded") !== "true");
  const onDismiss = (): void => {
    if (!view.entryId) return;
    dismissedId = view.entryId;
    // The face of the avatar follows the store, so it learns about the rejection too.
    dismissAffect(view.entryId);
    update(getState());
    toggle.focus();
  };
  const onHide = (): void => {
    hidden = true;
    writeHidden(true);
    setOpen(false);
    render();
    show.focus();
  };
  const onShow = (): void => {
    hidden = false;
    writeHidden(false);
    render();
    toggle.focus();
  };
  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === "Escape" && toggle.getAttribute("aria-expanded") === "true") {
      ev.stopPropagation();
      setOpen(false);
      toggle.focus();
    }
  };

  // Like any popover: a press anywhere else closes it.
  const onOutside = (ev: PointerEvent): void => {
    if (toggle.getAttribute("aria-expanded") === "true" && ev.target instanceof Node && !root.contains(ev.target)) setOpen(false);
  };

  toggle.addEventListener("click", onToggle);
  document.addEventListener("pointerdown", onOutside);
  dismiss.addEventListener("click", onDismiss);
  hide.addEventListener("click", onHide);
  show.addEventListener("click", onShow);
  details.addEventListener("keydown", onKey);

  update(getState());
  const unsubscribe = subscribe((s, changed) => {
    if (changed.has("reset") || changed.has("affect") || changed.has("style")) update(s);
  });

  return () => {
    unsubscribe();
    toggle.removeEventListener("click", onToggle);
    dismiss.removeEventListener("click", onDismiss);
    hide.removeEventListener("click", onHide);
    show.removeEventListener("click", onShow);
    details.removeEventListener("keydown", onKey);
    document.removeEventListener("pointerdown", onOutside);
  };
}
