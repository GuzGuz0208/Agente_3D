/**
 * Site palette that follows the chosen avatar.
 *
 * The palette lives in styles/tokens.css under `<html data-theme="…">`; this
 * module only switches the attribute, remembers the choice and, when it can,
 * repaints inside a View Transition: the new palette opens as a soft-edged
 * circle from the centre of the avatar stage (or of the viewport).
 *
 * Layouts/Base.astro applies the stored theme before the first paint and
 * carries it across the ClientRouter's page swaps; keep THEME_COLOR and the
 * storage key in sync with the inline script there.
 *
 * The orb (scripts/orb.ts) watches the attribute and re-reads its colours.
 */

export type ThemeId = "rosa" | "gato" | "humano";

export const THEMES: readonly ThemeId[] = ["rosa", "gato", "humano"];

/** localStorage key of the last chosen theme. */
export const THEME_KEY = "ips.theme";

/** Browser chrome colour (<meta name="theme-color">) per theme: its page background. */
export const THEME_COLOR: Readonly<Record<ThemeId, string>> = {
  rosa: "#fff7fa",
  gato: "#faf9fd",
  humano: "#f8f7f6",
};

/** Fired on `document` after the attribute changed. */
export const THEME_EVENT = "ips:theme-change";

export interface ThemeChangeDetail {
  theme: ThemeId;
  previous: ThemeId;
}

/** Length of the repaint, kept in sync with `theme-reveal` in global.css. */
const REVEAL_MS = 620;

export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/** The active theme, «rosa» when none is set. */
export function currentTheme(): ThemeId {
  const value = document.documentElement.dataset.theme;
  return isThemeId(value) ? value : "rosa";
}

function store(theme: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Private mode or blocked storage: the theme still applies for this page.
  }
}

function setMetaColor(theme: ThemeId): void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (meta) meta.content = THEME_COLOR[theme];
}

function commit(theme: ThemeId, previous: ThemeId): void {
  document.documentElement.dataset.theme = theme;
  setMetaColor(theme);
  document.dispatchEvent(new CustomEvent<ThemeChangeDetail>(THEME_EVENT, { detail: { theme, previous } }));
}

/** Where the new palette is born: the centre of the visible avatar stage, else of the viewport. */
function origin(): { x: number; y: number; r: number } {
  const w = window.innerWidth;
  const h = window.innerHeight;
  let x = w / 2;
  let y = h / 2;
  const stage = document.getElementById("avatar-stage");
  if (stage) {
    const box = stage.getBoundingClientRect();
    if (box.width > 0 && box.height > 0 && box.bottom > 0 && box.top < h) {
      x = Math.min(w, Math.max(0, box.left + box.width / 2));
      y = Math.min(h, Math.max(0, box.top + box.height / 2));
    }
  }
  // Far enough to cover the farthest corner, plus the feathered edge.
  const r = Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 64;
  return { x, y, r };
}

type StartViewTransition = (update: () => void) => { finished: Promise<void>; ready?: Promise<void>; updateCallbackDone?: Promise<void> };

/**
 * Switches the site palette. Stores the choice; with `animate` (default) and
 * View Transitions available and no reduced-motion preference, the change is
 * a ~0.6 s circular reveal; otherwise it is instant.
 */
export function applyTheme(theme: ThemeId, opts: { animate?: boolean } = {}): void {
  if (!isThemeId(theme)) return;
  const previous = currentTheme();
  store(theme);
  if (theme === previous && document.documentElement.dataset.theme === theme) return;

  const root = document.documentElement;
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (opts.animate === false || reduced || typeof start !== "function" || document.hidden) {
    commit(theme, previous);
    return;
  }

  const { x, y, r } = origin();
  root.style.setProperty("--theme-x", `${x}px`);
  root.style.setProperty("--theme-y", `${y}px`);
  root.style.setProperty("--theme-r-max", `${r}px`);
  root.style.setProperty("--theme-ms", `${REVEAL_MS}ms`);
  // Scopes the reveal CSS to this transition, so the router's page transitions keep their own.
  root.dataset.themeShift = "";
  let transition: { finished: Promise<void>; ready?: Promise<void>; updateCallbackDone?: Promise<void> };
  try {
    transition = start.call(document, () => commit(theme, previous));
  } catch {
    delete root.dataset.themeShift;
    commit(theme, previous);
    return;
  }
  const done = (): void => {
    delete root.dataset.themeShift;
    for (const name of ["--theme-x", "--theme-y", "--theme-r-max", "--theme-ms"]) root.style.removeProperty(name);
  };
  transition.finished.then(done, done);
  // An aborted transition (e.g. "DOM update timed out" on a busy phone) rejects these: keep the
  // console clean, and make sure the palette still lands even if the update callback never ran.
  transition.ready?.catch(() => undefined);
  transition.updateCallbackDone?.catch(() => {
    if (root.dataset.theme !== theme) commit(theme, previous);
  });
}
