/**
 * Voice use and voice analysis (docs/10 §6, R-26 as amended by D-24, 2026-11-05).
 *
 * On by default: the conversation opens the microphone (the browser still asks for
 * permission) and the voice analysis runs from the first turn, with the visible
 * indicator and «Dejar de usar mi voz». Once the person withdraws it, the console is
 * text only and every analysis goes out with `voice_consent: false` until they press
 * «Usar mi voz» again. The choice is remembered only for this tab (sessionStorage).
 *
 * The store starts every conversation with `voiceAnalysis: false` and `reset()`
 * returns to that, so this module re-applies the person's choice whenever the
 * store disagrees with it.
 */
import * as controller from "../voice/controller";
import { getState, subscribe } from "../voice/store";

export const CONSENT_KEY = "ips.voice-consent";

/** Reads the remembered choice; on unless the person explicitly turned it "off" (D-24). */
export function readConsent(storage: Pick<Storage, "getItem"> | null | undefined): boolean {
  try {
    return storage?.getItem(CONSENT_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeConsent(storage: Pick<Storage, "setItem" | "removeItem"> | null | undefined, on: boolean): void {
  try {
    storage?.setItem(CONSENT_KEY, on ? "on" : "off");
  } catch {
    // Private mode or blocked storage: the choice lasts for this page only.
  }
}

function session(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

let wanted = readConsent(session());
let started = false;

const apply = (): void => {
  if (getState().voiceAnalysis !== wanted) controller.setVoiceAnalysis(wanted);
};

/** Idempotent: called once from the layout. */
export function keepAnalysisDefault(): void {
  if (started) return;
  started = true;
  subscribe((_state, slices) => {
    if (slices.has("reset") || slices.has("meta")) apply();
  });
  apply();
}

export function analysisWanted(): boolean {
  return wanted;
}

/** «Usar mi voz» (true) or «Dejar de usar mi voz» (false). */
export function setAnalysisWanted(on: boolean): void {
  wanted = on;
  writeConsent(session(), on);
  apply();
}
