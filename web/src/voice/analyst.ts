/**
 * Client side of the analyst (docs/10 §6).
 *
 * With a backend: `POST /analysis/utterance`. Without one: scripted readings from
 * web/mocks/affect.json, fused here with the deterministic rule of docs/10
 * («Fusión»). A failed analysis is always "uncertain", never a stale label.
 */
import affectMocks from "../../mocks/affect.json";
import { apiFetch, USING_MOCKS } from "./api";
import type { AffectEntry } from "./store";
import type { AffectEstimate, Emotion, Sentiment, StateHint, StyleDecision, StyleId } from "./types";

interface Reading {
  sentiment: Sentiment;
  emotion: Emotion;
  state_hint: StateHint;
  cues: string[];
}

type MockKey = Exclude<keyof typeof affectMocks, "_note">;

const fold = (s: string): string =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

function mockKey(text: string): MockKey {
  const q = fold(text);
  if (/^no,|dije|correccion/.test(q)) return "fix_melgar";
  if (/confund|directo|breve/.test(q)) return "ask_direct";
  if (/gracias/.test(q)) return "thanks";
  if (/municipios/.test(q)) return "q_top_beds";
  if (/medellin/.test(q)) return "q_beds_medellin";
  return "default";
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ── Interaction signals (docs/10 §6) ─────────────────────────────────────────

/**
 * Body of `signals`, field for field the backend's `InteractionSignals`
 * (src/models/analysis.py). The timing fields exist only for a spoken utterance:
 * a typed question has no duration, so they go as null.
 */
export interface InteractionSignals {
  duration_ms: number | null;
  words_per_second: number | null;
  pause_before_ms: number | null;
  interrupted_agent: boolean;
  repeated_question: boolean;
}

export const SIGNAL_KEYS = ["duration_ms", "words_per_second", "pause_before_ms", "interrupted_agent", "repeated_question"] as const;

export interface SignalSource {
  text: string;
  spoken: boolean;
  /** Session-clock bounds of the utterance, ms. */
  tStart: number;
  tEnd: number;
  /** End of the agent's last utterance before this one, ms; null when there is none. */
  agentEndedAt: number | null;
  interruptedAgent: boolean;
  /** Earlier user utterances of the session (not this one), oldest first. */
  previousUserTexts: string[];
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const words = (s: string): string[] =>
  fold(s)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);

/** Same question again (≥ 3 words, ≥ 80 % shared words): a classic sign that the answer did not land. */
export function isRepeated(text: string, previous: string[]): boolean {
  const a = new Set(words(text));
  if (a.size < 3) return false;
  return previous.slice(-3).some((p) => {
    const b = new Set(words(p));
    if (b.size < 3) return false;
    const shared = [...a].filter((w) => b.has(w)).length;
    return shared / new Set([...a, ...b]).size >= 0.8;
  });
}

/** Measures the observable facts of a turn, within the backend's bounds (a bad value would cost the whole analysis). */
export function interactionSignals(src: SignalSource): InteractionSignals {
  const span = src.tEnd - src.tStart;
  const duration = src.spoken && span > 0 ? Math.round(clamp(span, 0, 120_000)) : null;
  const n = words(src.text).length;
  const wps = duration !== null && duration >= 300 && n > 0 ? Math.round(clamp(n / (duration / 1000), 0, 15) * 100) / 100 : null;
  const gap = src.agentEndedAt === null ? null : src.tStart - src.agentEndedAt;
  const pause = src.spoken && !src.interruptedAgent && gap !== null && gap > 0 ? Math.round(clamp(gap, 0, 600_000)) : null;
  return {
    duration_ms: duration,
    words_per_second: wps,
    pause_before_ms: pause,
    interrupted_agent: src.interruptedAgent,
    repeated_question: isRepeated(src.text, src.previousUserTexts),
  };
}

export interface AnalyzeInput {
  utterance_id: string;
  text: string;
  turn_id: string;
  state_version: number;
  t: number;
  /** Voice analysis only runs with consent (R-26); the audio clip is sent only then. */
  voiceConsent: boolean;
  /** Session-clock bounds of a spoken utterance; absent for a typed one. */
  t_start?: number;
  t_end?: number;
  /** Observable facts about the turn, see `interactionSignals`. */
  signals?: InteractionSignals;
  /** WAV clip of the utterance, base64. Only with consent; never stored. */
  audioWavB64?: string | null;
  /** Up to 3 previous estimates: the backend keeps no state. */
  affectHistory?: AffectEstimate[];
  tonePreference?: string;
  currentStyle?: StyleDecision;
  turnIndex?: number;
}

type ChannelReading = Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint">;

function channel(v: unknown): ChannelReading | undefined {
  if (!v || typeof v !== "object") return undefined;
  const r = v as Partial<ChannelReading>;
  return r.sentiment && r.emotion && r.state_hint ? { sentiment: r.sentiment, emotion: r.emotion, state_hint: r.state_hint } : undefined;
}

function styleFrom(v: unknown, turnIndex: number): StyleDecision | undefined {
  if (!v || typeof v !== "object") return undefined;
  const s = v as Partial<StyleDecision>;
  if (!s.style || !(s.style in DIRECTIVES)) return undefined;
  return {
    style: s.style,
    directives: Array.isArray(s.directives) ? s.directives.filter((d): d is string => typeof d === "string") : DIRECTIVES[s.style],
    reason: typeof s.reason === "string" ? s.reason : "",
    source: s.source === "preference" ? "preference" : "inferred",
    applies_from_turn: typeof s.applies_from_turn === "number" ? s.applies_from_turn : turnIndex + 1,
  };
}

function uncertain(input: AnalyzeInput, ms: number | null): AffectEntry {
  return {
    utterance_id: input.utterance_id,
    text: input.text,
    t: input.t,
    analysis_ms: ms,
    estimate: {
      turn_id: input.turn_id,
      state_version: input.state_version,
      observed_at: new Date().toISOString(),
      sentiment: "uncertain",
      emotion: "incierta",
      state_hint: "desconocido",
      method: "text",
      discrepancy: false,
      cues: [],
      confidence: null,
    },
  };
}

const informative = (r: Reading | null | undefined): r is Reading => !!r && r.sentiment !== "uncertain" && r.emotion !== "incierta";

/**
 * Deterministic fusion, the same rule as src/services/analyst/nodes/fuse.py (docs/10 «Fusión»):
 * an uncertain channel counts as missing; equal labels pass through; on disagreement the
 * voice leads (tone carries what words omit) unless only the words carry an emotion; the
 * disagreement is shown, not hidden; a lead without a state borrows the other channel's.
 */
export function fuseReadings(text: Reading | null, voice: Reading | null): Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint" | "method" | "discrepancy" | "cues"> {
  const t = informative(text) ? text : null;
  const v = informative(voice) ? voice : null;
  if (t && v) {
    const agree = t.sentiment === v.sentiment && t.emotion === v.emotion;
    const onlyWordsFeel = v.emotion === "neutral" && t.emotion !== "neutral";
    const lead = agree || onlyWordsFeel ? t : v;
    const other = lead === t ? v : t;
    const state_hint = lead.state_hint === "desconocido" ? other.state_hint : lead.state_hint;
    return { sentiment: lead.sentiment, emotion: lead.emotion, state_hint, method: "fused", discrepancy: !agree, cues: [...new Set([...t.cues, ...v.cues])].slice(0, 6) };
  }
  const only = t ?? v;
  if (only) return { sentiment: only.sentiment, emotion: only.emotion, state_hint: only.state_hint, method: t ? "text" : "voice", discrepancy: false, cues: only.cues };
  return { sentiment: "uncertain", emotion: "incierta", state_hint: "desconocido", method: "text", discrepancy: false, cues: [] };
}

export async function analyze(input: AnalyzeInput): Promise<AffectEntry> {
  if (!USING_MOCKS) return analyzeRemote(input);
  const mock = affectMocks[mockKey(input.text)];
  await sleep(mock.analysis_ms);
  const text = mock.text as Reading;
  const voice = input.voiceConsent ? (mock.voice as Reading) : null;
  const pick = ({ sentiment, emotion, state_hint }: Reading) => ({ sentiment, emotion, state_hint });
  return {
    utterance_id: input.utterance_id,
    text: input.text,
    t: input.t,
    analysis_ms: mock.analysis_ms,
    channels: voice ? { text: pick(text), voice: pick(voice) } : { text: pick(text) },
    estimate: {
      turn_id: input.turn_id,
      state_version: input.state_version,
      observed_at: new Date().toISOString(),
      ...fuseReadings(text, voice),
      confidence: null,
    },
  };
}

/**
 * `POST /analysis/utterance` (JSON). The backend is stateless, so the history, the
 * tone preference and the style in force travel with each call. It answers the
 * fused estimate, the per-channel readings and the style for the next turn.
 */
async function analyzeRemote(input: AnalyzeInput): Promise<AffectEntry> {
  const started = performance.now();
  const turnIndex = input.turnIndex ?? 1;
  try {
    const body: Record<string, unknown> = {
      turn_id: input.turn_id,
      state_version: input.state_version,
      text: input.text,
      // A typed question has no speech bounds: null, not a fake zero-length span.
      t_start: input.t_start ?? null,
      t_end: input.t_end ?? null,
      ...(input.signals ? { signals: input.signals } : {}),
      voice_consent: input.voiceConsent,
      affect_history: (input.affectHistory ?? []).slice(-3),
      tone_preference: input.tonePreference ?? "neutral",
      current_style: input.currentStyle ?? null,
      turn_index: turnIndex,
    };
    if (input.voiceConsent && input.audioWavB64) body.audio_wav_b64 = input.audioWavB64;
    const res = await apiFetch("/analysis/utterance", { method: "POST", body: JSON.stringify(body) }, 5000);
    if (!res.ok) throw new Error(String(res.status));
    const parsed = (await res.json()) as { affect?: Record<string, unknown>; style?: unknown } & Record<string, unknown>;
    const raw = (parsed.affect ?? parsed) as Record<string, unknown>;
    const estimate = raw as unknown as AffectEstimate;
    if (!estimate.sentiment) throw new Error("bad shape");
    const text = channel(raw.text_estimate);
    const voice = channel(raw.voice_estimate);
    return {
      utterance_id: input.utterance_id,
      text: input.text,
      t: input.t,
      estimate,
      channels: text || voice ? { ...(text ? { text } : {}), ...(voice ? { voice } : {}) } : undefined,
      style: styleFrom(parsed.style, turnIndex),
      analysis_ms: Math.round(performance.now() - started),
    };
  } catch {
    return uncertain(input, null);
  }
}

// ── Style policy (client mirror of config/style_policy.yaml) ─────────────────
// Used by the offline console and when a remote analysis fails; keep it in step
// with the YAML (rule order and wording).

type Labels = Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint">;

interface StyleRule {
  on: "emotion" | "state_hint";
  values: readonly string[];
  style: StyleId;
  reason: string;
}

/** First match wins; fear and sadness go before frustration (a worried person gets patience). */
const RULES: readonly StyleRule[] = [
  { on: "emotion", values: ["miedo", "tristeza"], style: "calido", reason: "Parece haber preocupación o tristeza: tono más cercano y paciente" },
  { on: "state_hint", values: ["frustración"], style: "directo", reason: "Parece frustrado: respuestas más breves y al grano" },
  { on: "emotion", values: ["enojo"], style: "directo", reason: "Parece haber molestia: respuestas más breves y al grano" },
  { on: "state_hint", values: ["confusión"], style: "didactico", reason: "Parece confundido: explico paso a paso" },
  { on: "state_hint", values: ["prisa"], style: "directo", reason: "Parece tener prisa: respuestas más breves" },
];

/** The inferred style a reading points at, with the label that triggered it; undefined for none. */
export function styleFor(e: Labels): { style: StyleId; reason: string; hint: string } | undefined {
  if (e.sentiment === "uncertain" && e.emotion === "incierta") return undefined;
  const rule = RULES.find((r) => r.values.includes(e[r.on]));
  return rule ? { style: rule.style, reason: rule.reason, hint: e[rule.on] } : undefined;
}

export const DIRECTIVES: Record<StyleId, string[]> = {
  directo: ["Responde en una o dos frases.", "Da primero la cifra.", "Sin rodeos."],
  calido: ["Reconoce en pocas palabras cómo se siente la persona, sin exagerar ni diagnosticar.", "Tono cercano y paciente; luego da el dato."],
  didactico: ["Explica paso a paso con un ejemplo corto.", "Define solo el término que confunde (IPS, sede o capacidad instalada)."],
  neutro: [],
};

export const MIN_CONSECUTIVE_SIGNALS = 2;

export interface StyleOutcome {
  decision: StyleDecision | null;
  signal: { hint: string; count: number; needed: number } | null;
}

/**
 * An inferred style needs two consecutive signals (it must not oscillate); an
 * explicit preference is handled by the caller and always wins.
 */
export function inferStyle(history: AffectEstimate[], current: StyleDecision, nextTurn: number): StyleOutcome {
  if (current.source === "preference") return { decision: null, signal: null };
  const last = history[history.length - 1];
  const target = last ? styleFor(last) : undefined;
  if (!last || !target || target.style === current.style) return { decision: null, signal: null };
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h && styleFor(h)?.style === target.style) count++;
    else break;
  }
  if (count < MIN_CONSECUTIVE_SIGNALS) return { decision: null, signal: { hint: target.hint, count, needed: MIN_CONSECUTIVE_SIGNALS } };
  return {
    decision: { style: target.style, directives: DIRECTIVES[target.style], reason: target.reason, source: "inferred", applies_from_turn: nextTurn },
    signal: null,
  };
}
