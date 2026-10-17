/**
 * Guided help tour. A dimmed layer with a cut-out that glides to each block of
 * the page, plus a floating card (a bottom sheet on phones) that explains it.
 *
 * It opens by itself on the first visit (remembered in localStorage under
 * `ips.tour.v1`) and at any time from the help button in the top bar. Steps
 * are declared per page; a step whose anchor is missing is skipped.
 *
 * Lifecycle: `initHelpTour()` runs once per document; the tour is torn down on
 * `astro:before-swap`, so navigating never leaves a second layer behind.
 *
 * Motion: when a step needs the page to scroll, the page glides with the same
 * duration and curve as the cut-out (`--tour-glide`, `--ease-glide` in
 * HelpTour.astro), so the block and its highlight arrive together instead of
 * the page jumping under a sliding light. With reduced motion everything lands
 * at once.
 */

const STORAGE_KEY = "ips.tour.v1";
const PHONE_MAX = 430;
const PAD = 6;
const GAP = 14;
const MARGIN = 12;

interface Step {
  /** Candidate anchors, in order of preference; the first visible one wins. */
  anchors: string[];
  title: string;
  text: string;
  /** Only shown when this holds at the moment the tour opens (e.g. the control exists but is hidden). */
  when?: () => boolean;
}

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const tid = (id: string): string => `[data-testid="${id}"]`;

const STEPS: Record<string, Step[]> = {
  "/": [
    {
      anchors: [".hero .btn-talk", 'a[href^="/consola?iniciar"]'],
      title: "Habla con el agente",
      text: "Pulsa «Hablar ahora» y pregunta con tu voz. Te llevamos directo a la conversación.",
    },
    {
      anchors: [".figures", ".source"],
      title: "La fuente en cifras",
      text: "Estas cifras salen del registro REPS de MinSalud: cuántas IPS, sedes y camas hay.",
    },
    {
      anchors: [".questions", ".ask"],
      title: "Preguntas sugeridas",
      text: "¿No sabes por dónde empezar? Elige una y el agente la responde por ti.",
    },
    {
      anchors: ['nav a[href="/admin"]'],
      title: "Panel de administrador",
      text: "Entra aquí para ver por dentro cómo trabaja el agente: qué consultó, qué emoción percibió, la transcripción completa y cómo se recuperó de cada fallo.",
    },
  ],
  "/consola": [
    {
      anchors: ["#avatar-stage", "#stage"],
      title: "El escenario",
      text: "Aquí vive el agente. Verás si está escuchando, consultando la fuente o hablando.",
    },
    {
      anchors: [".stage-mode", tid("avatar-mode-3d")],
      title: "Slime, avatar 3D u orbe",
      text: "Elige cómo quieres verlo: el slime, el avatar 3D animado o solo el orbe, que es el más liviano.",
    },
    {
      anchors: [tid("play-button")],
      // Only the slime can play: with the animated avatar (or the orb, or while it loads) the
      // button is hidden, and counting the step would make the count jump from 2 to 4.
      when: () => {
        const play = q(tid("play-button"));
        return play !== null && isVisible(play);
      },
      title: "Jugar con el slime",
      text: "Pulsa el control de juego y el slime ocupa toda la pantalla. Inclina el celular para que ruede y choque con los bordes, o arrástralo con el dedo. Puedes seguir hablando con él; para volver, pulsa «Salir del juego».",
    },
    {
      anchors: [tid("mic-button"), tid("mic-button-composer")],
      title: "Micrófono",
      text: "Pulsa para hablar y vuelve a pulsar para detener. Al detener no se borra nada: si vuelves a pulsar, sigues donde ibas.",
    },
    {
      anchors: [tid("mute-button"), tid("mute-button-stage")],
      title: "Silenciar",
      text: "Corta la voz del agente al instante. También funciona con la tecla Esc.",
    },
    {
      anchors: [tid("chat")],
      title: "La conversación",
      text: "Todo queda escrito aquí. Cada respuesta con datos trae su cita de fuente y la fecha de corte.",
    },
    {
      anchors: ["#ask-form", tid("ask-input")],
      title: "Escribe tu pregunta",
      text: "¿Prefieres no hablar? Escribe aquí y envía con Enter.",
    },
    {
      anchors: ['nav a[href="/admin"]'],
      title: "Panel de administrador",
      text: "Entra aquí para ver por dentro cómo trabaja el agente: qué consultó, qué emoción percibió, la transcripción completa y cómo se recuperó de cada fallo.",
    },
  ],
  "/admin": [
    {
      anchors: ["#controls", tid("engine-select")],
      title: "Agente",
      text: "Cambia el motor y la voz, y activa o apaga el análisis de voz. También puedes corregir, repetir o reiniciar.",
    },
    {
      anchors: [tid("affect-panel")],
      title: "Emociones en vivo",
      text: "Muestra el tono que se percibe en la voz y el estilo con el que responde el agente.",
    },
    {
      anchors: [tid("transcript")],
      title: "Transcripción",
      text: "El registro completo de lo que dijeron la persona y el agente, turno por turno.",
    },
    {
      anchors: [tid("api-panel")],
      title: "Herramientas que usó",
      text: "Cada consulta que el agente hace a datos.gov.co: qué buscó, todo lo que devolvió la fuente y cuánto tardó.",
    },
    {
      anchors: [tid("recovery-panel")],
      title: "Recuperación ante fallos",
      text: "Cada tropiezo (una interrupción, una corrección, la fuente caída) y lo que hizo el agente para seguir.",
    },
    {
      anchors: [tid("latency-panel")],
      title: "Tiempos de respuesta",
      text: "Cuánto tarda cada etapa de la respuesta, para detectar demoras de un vistazo.",
    },
  ],
};

type SheetEdge = "top" | "bottom";

interface Session {
  steps: Step[];
  index: number;
  target: HTMLElement | null;
  opener: HTMLElement | null;
  inerted: HTMLElement[];
  frame: number;
  /** requestAnimationFrame id of the page scroll glide; 0 when still. */
  glide: number;
  /** Phones: pending edge swap of the bottom sheet (fades out, moves, fades in). */
  sheetTimer: number;
  sheetEdge: SheetEdge;
}

let session: Session | null = null;
let autoTimer = 0;
let wired = false;

const q = <T extends HTMLElement>(sel: string): T | null => document.querySelector<T>(sel);

function reduceMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** A duration custom property of the tour layer, in ms; the CSS is the single source. */
function cssMs(name: string, fallback: number): number {
  const root = q("#help-tour");
  if (!root) return fallback;
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return fallback;
  if (raw.endsWith("ms")) return n;
  return raw.endsWith("s") ? n * 1000 : n;
}

/** Sine ease-in-out: the script's twin of `--ease-glide`. */
function easeGlide(t: number): number {
  return -(Math.cos(Math.PI * t) - 1) / 2;
}

function seen(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return true; // No storage: never nag.
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    /* private mode: nothing to remember */
  }
}

function pagePath(): string {
  return location.pathname.replace(/\/$/, "") || "/";
}

function isVisible(el: HTMLElement): boolean {
  if (el.getClientRects().length === 0) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

function find(step: Step, onlyVisible: boolean): HTMLElement | null {
  for (const sel of step.anchors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(sel))) {
      if (el.closest("#help-tour")) continue;
      if (!onlyVisible || isVisible(el)) return el;
    }
  }
  return null;
}

/** Small screens show one admin section at a time; switch to the one that holds the anchor. */
function reveal(step: Step): HTMLElement | null {
  const shown = find(step, true);
  if (shown) return shown;
  const hidden = find(step, false);
  const section = hidden?.closest<HTMLElement>("[data-section]")?.dataset.section;
  if (section) q<HTMLButtonElement>(`[data-view-btn="${section}"]`)?.click();
  return find(step, true);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(n, Math.max(min, max)));
}

/**
 * The cut-out: the anchor plus a little air, never outside the viewport.
 * `ahead` is page scroll still to come (px): the box is where the anchor will be.
 */
function holeBox(el: HTMLElement, ahead = 0): Box {
  const r = el.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const left = clamp(r.left - PAD, 4, vw - 4);
  const top = clamp(r.top - ahead - PAD, 4, vh - 4);
  const right = clamp(r.right + PAD, left, vw - 4);
  const bottom = clamp(r.bottom - ahead + PAD, top, vh - 4);
  return { left, top, width: right - left, height: bottom - top };
}

/** Phones: the sheet changes edge behind a short fade instead of jumping. */
function moveSheet(card: HTMLElement, edge: SheetEdge): void {
  const s = session;
  if (!s) return;
  s.sheetEdge = edge;
  if (s.sheetTimer) return; // the pending swap takes the latest edge
  if (card.dataset.pos === edge) return;
  const first = card.dataset.pos !== "top" && card.dataset.pos !== "bottom";
  const instant = first || reduceMotion() || q("#help-tour")?.classList.contains("no-anim");
  if (instant) {
    card.dataset.pos = edge;
    return;
  }
  card.classList.add("is-moving");
  s.sheetTimer = window.setTimeout(() => {
    s.sheetTimer = 0;
    card.dataset.pos = s.sheetEdge;
    card.classList.remove("is-moving");
  }, cssMs("--tour-fade", 420) / 2);
}

function placeCard(card: HTMLElement, box: Box): void {
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (vw <= PHONE_MAX) {
    // Bottom sheet; it moves to the top edge when the block sits in the lower half.
    card.style.transform = "";
    moveSheet(card, box.top + box.height / 2 > vh / 2 ? "top" : "bottom");
    return;
  }

  card.dataset.pos = "float";
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  const cx = clamp(box.left + box.width / 2 - cw / 2, MARGIN, vw - cw - MARGIN);
  const cy = clamp(box.top + box.height / 2 - ch / 2, MARGIN, vh - ch - MARGIN);
  const below = box.top + box.height + GAP;
  const above = box.top - GAP - ch;
  const right = box.left + box.width + GAP;
  const left = box.left - GAP - cw;

  let x = cx;
  let y = cy;
  if (below + ch <= vh - MARGIN) y = below;
  else if (above >= MARGIN) y = above;
  else if (right + cw <= vw - MARGIN) x = right;
  else if (left >= MARGIN) x = left;
  else {
    // The block fills the screen: tuck the card into its lower corner.
    x = vw - cw - MARGIN * 2;
    y = vh - ch - MARGIN * 2;
  }
  card.style.transform = `translate3d(${Math.round(x)}px, ${Math.round(y)}px, 0)`;
}

/** Aims the cut-out and the card; `ahead` is page scroll still to come (px). */
function position(ahead = 0): void {
  const root = q("#help-tour");
  const hole = q("#help-tour-hole");
  const card = q("#help-tour-card");
  if (!session?.target || !root || !hole || !card) return;
  const box = holeBox(session.target, ahead);
  hole.style.transform = `translate3d(${Math.round(box.left)}px, ${Math.round(box.top)}px, 0)`;
  hole.style.width = `${Math.round(box.width)}px`;
  hole.style.height = `${Math.round(box.height)}px`;
  placeCard(card, box);
}

function schedule(): void {
  // While the page glides, the cut-out is already travelling to the final spot.
  if (!session || session.frame || session.glide) return;
  session.frame = requestAnimationFrame(() => {
    if (!session) return;
    session.frame = 0;
    position();
  });
}

function stopGlide(): void {
  if (!session?.glide) return;
  cancelAnimationFrame(session.glide);
  session.glide = 0;
}

/** The person scrolls by hand mid-glide: let go and follow them. */
function onUserScroll(): void {
  if (!session?.glide) return;
  stopGlide();
  schedule();
}

function fits(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  return r.top >= 8 && r.bottom <= window.innerHeight - 8;
}

function jumpIntoView(el: HTMLElement): void {
  const tall = el.getBoundingClientRect().height > window.innerHeight * 0.7;
  el.scrollIntoView({ block: tall ? "start" : "center", inline: "nearest", behavior: "instant" });
}

/**
 * Brings the step's block into view and returns the page scroll still to come
 * (px), so the cut-out can head straight for the block's final spot. The page
 * glides with the cut-out's duration and curve; a block inside its own
 * scrolling box (not the page) still jumps, as the page cannot carry it.
 */
function bringIntoView(el: HTMLElement, instant: boolean): number {
  stopGlide();
  if (fits(el)) return 0;
  const r = el.getBoundingClientRect();
  const vh = window.innerHeight;
  const tall = r.height > vh * 0.7;
  const want = tall ? r.top - MARGIN : r.top + r.height / 2 - vh / 2;
  const from = window.scrollY;
  const max = document.documentElement.scrollHeight - vh;
  const dy = Math.round(clamp(from + want, 0, max) - from);
  const ms = instant || reduceMotion() ? 0 : cssMs("--tour-glide", 640);
  if (dy === 0 || ms === 0 || !session) {
    jumpIntoView(el);
    return 0;
  }

  const s = session;
  const start = performance.now();
  const tick = (now: number): void => {
    if (session !== s) return;
    const t = Math.min(1, (now - start) / ms);
    window.scrollTo({ top: from + dy * easeGlide(t), behavior: "instant" });
    if (t < 1) {
      s.glide = requestAnimationFrame(tick);
      return;
    }
    s.glide = 0;
    if (!fits(el)) jumpIntoView(el); // an inner scrolling box still hides it
    position();
  };
  s.glide = requestAnimationFrame(tick);
  return dy;
}

/** `instant`: the first step of a fresh tour lands without travelling. */
function show(index: number, dir: 1 | -1, instant = false): void {
  if (!session) return;
  const root = q("#help-tour");
  const card = q("#help-tour-card");
  if (!root || !card) return;

  // Skip steps whose block cannot be shown on this screen.
  let i = index;
  let target: HTMLElement | null = null;
  while (i >= 0 && i < session.steps.length) {
    const step = session.steps[i];
    target = step ? reveal(step) : null;
    if (target) break;
    i += dir;
  }
  if (!target) {
    if (dir === 1) close();
    return;
  }

  const step = session.steps[i];
  if (!step) return;
  session.index = i;
  session.target = target;
  const ahead = bringIntoView(target, instant);

  const title = q("#help-tour-title");
  const text = q("#help-tour-text");
  const count = q("#help-tour-count");
  const prev = q<HTMLButtonElement>("[data-tour-prev]");
  const next = q<HTMLButtonElement>("[data-tour-next]");
  const body = q(".tour-body");
  const total = session.steps.length;
  if (title) title.textContent = step.title;
  if (text) text.textContent = step.text;
  if (count) count.textContent = `${i + 1} de ${total}`;
  if (prev) prev.disabled = i === 0;
  if (next) {
    const last = i === total - 1;
    next.dataset.last = String(last);
    const label = next.querySelector("[data-tour-next-label]");
    if (label) label.textContent = last ? "Listo" : "Siguiente";
  }
  const dots = q("#help-tour-dots");
  if (dots) {
    dots.replaceChildren();
    for (let d = 0; d < total; d++) {
      const dot = document.createElement("span");
      if (d === i) dot.dataset.on = "true";
      dots.append(dot);
    }
  }
  if (body) {
    body.classList.remove("is-in");
    void body.offsetWidth; // restart the text fade
    body.classList.add("is-in");
  }
  position(ahead);
  // A focused control that became disabled would drop focus out of the dialog.
  if (!card.contains(document.activeElement) || (document.activeElement as HTMLButtonElement).disabled) {
    (next ?? card).focus({ preventScroll: true });
  }
}

function focusables(card: HTMLElement): HTMLElement[] {
  return Array.from(card.querySelectorAll<HTMLButtonElement>("button")).filter((b) => !b.disabled);
}

function onKey(e: KeyboardEvent): void {
  if (!session) return;
  const card = q("#help-tour-card");
  if (!card) return;
  switch (e.key) {
    case "Escape":
      e.preventDefault();
      e.stopImmediatePropagation(); // Esc is also «Silenciar» on the conversation screen.
      close();
      return;
    case "ArrowRight":
      e.preventDefault();
      e.stopImmediatePropagation();
      go(1);
      return;
    case "ArrowLeft":
      e.preventDefault();
      e.stopImmediatePropagation();
      go(-1);
      return;
    case "Tab": {
      const items = focusables(card);
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      e.preventDefault();
      if (!card.contains(active)) first.focus();
      else {
        const at = items.indexOf(active as HTMLElement);
        const to = e.shiftKey ? (at <= 0 ? items.length - 1 : at - 1) : at >= items.length - 1 ? 0 : at + 1;
        items[to]?.focus();
      }
      return;
    }
    default:
  }
}

function go(dir: 1 | -1): void {
  if (!session) return;
  const to = session.index + dir;
  if (to < 0) return;
  if (to >= session.steps.length) {
    close();
    return;
  }
  show(to, dir);
}

function open(opener: HTMLElement | null): void {
  if (session) return;
  const root = q("#help-tour");
  const steps = (STEPS[pagePath()] ?? []).filter((s) => find(s, false) && (s.when?.() ?? true));
  if (!root || steps.length === 0) return;

  markSeen();
  const inerted: HTMLElement[] = [];
  for (const el of Array.from(document.body.children)) {
    if (el instanceof HTMLElement && el !== root && !el.inert && el.tagName !== "SCRIPT") {
      el.inert = true;
      inerted.push(el);
    }
  }
  session = { steps, index: 0, target: null, opener, inerted, frame: 0, glide: 0, sheetTimer: 0, sheetEdge: "bottom" };

  root.hidden = false;
  root.classList.add("no-anim"); // the first frame lands on the block without travelling
  show(0, 1, true);
  void root.offsetWidth;
  root.classList.remove("no-anim");
  root.dataset.open = "true";

  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, true);
  window.addEventListener("wheel", onUserScroll, { passive: true });
  window.addEventListener("touchmove", onUserScroll, { passive: true });
  if (!session) root.hidden = true; // every step was skipped
}

function close(restoreFocus = true): void {
  const s = session;
  if (!s) return;
  if (s.glide) cancelAnimationFrame(s.glide);
  if (s.sheetTimer) window.clearTimeout(s.sheetTimer);
  session = null;
  if (s.frame) cancelAnimationFrame(s.frame);
  document.removeEventListener("keydown", onKey, true);
  window.removeEventListener("resize", schedule);
  window.removeEventListener("scroll", schedule, true);
  window.removeEventListener("wheel", onUserScroll);
  window.removeEventListener("touchmove", onUserScroll);
  for (const el of s.inerted) el.inert = false;

  q("#help-tour-card")?.classList.remove("is-moving");
  const root = q("#help-tour");
  if (root) {
    // Read before the fade starts; the layer hides once it has faded out.
    const fade = reduceMotion() ? 0 : cssMs("--tour-fade", 420);
    delete root.dataset.open;
    if (restoreFocus && fade > 0) {
      const done = (): void => {
        if (!session) root.hidden = true;
      };
      window.setTimeout(done, fade);
    } else {
      root.hidden = true;
    }
  }
  if (restoreFocus) {
    const back = s.opener?.isConnected ? s.opener : q("[data-help-tour]");
    back?.focus({ preventScroll: true });
  }
}

function onClick(e: MouseEvent): void {
  const el = e.target instanceof Element ? e.target : null;
  if (!el) return;
  const opener = el.closest<HTMLElement>("[data-help-tour]");
  if (opener) {
    e.preventDefault();
    open(opener);
    return;
  }
  if (!session) return;
  if (el.closest("[data-tour-next]")) go(1);
  else if (el.closest("[data-tour-prev]")) go(-1);
  else if (el.closest("[data-tour-skip]")) close();
}

function onPageLoad(): void {
  window.clearTimeout(autoTimer);
  if (seen()) return;
  // Someone who arrives with an action in the URL («Hablar ahora», a suggested
  // question) is already doing something: do not cover it. Automated browsers
  // (the e2e suite) never get the automatic tour either; the button still works.
  const params = new URLSearchParams(location.search);
  if (params.has("iniciar") || params.has("q") || navigator.webdriver) return;
  autoTimer = window.setTimeout(() => open(q("[data-help-tour]")), 450);
}

function onBeforeSwap(): void {
  window.clearTimeout(autoTimer);
  close(false);
}

/** Wires the tour once per document; safe to call again. */
export function initHelpTour(): void {
  if (wired) return;
  wired = true;
  document.addEventListener("click", onClick);
  document.addEventListener("astro:page-load", onPageLoad);
  document.addEventListener("astro:before-swap", onBeforeSwap);
}
