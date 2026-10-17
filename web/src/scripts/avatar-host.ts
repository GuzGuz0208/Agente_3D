/**
 * Mounts the 3D avatar into `#avatar-canvas` and keeps it in sync with the store.
 *
 * The avatar lives in `src/avatar/` and is built by another lane. This host
 * must work whether or not that module exists or loads: `import.meta.glob`
 * resolves to nothing when the file is absent (a plain dynamic import of a
 * missing file would break the build), and any failure leaves the orb as the
 * visual fallback.
 *
 * Expected module shape (src/avatar/index.ts):
 *   mountAvatar(canvas, opts) => Promise<AvatarHandle>
 *   expressionFor?({ affect, style }) => expression name   (pure, optional)
 *   AvatarHandle: setState(state), setMouthLevel(0..1), attachAnalyser?(node), resetCamera(), dispose(),
 *                 setExpression?(expression)
 *
 * Face: the latest affect reading and the active style are mapped to an expression
 * by the module's own `expressionFor`, and pushed only when it changes. The
 * character blends it with its state (asleep stays asleep, an error stays sad).
 *
 * Entrance: when the person switches from the orb to the slime, the stage marks
 * itself `data-entrance="eat"` (its orb stays on screen), mounts this host and
 * sends `avatar:toggle` with `{ enabled: true }`. Once ready, the orb shrinks and
 * moves aside while the character's optional `eatOrb()` hops in beside it; when
 * the mouth is open (`onBite`) the orb element itself flies into it, round the
 * eyes, and when the entrance is over the mark goes and the orb is put back,
 * hidden behind the avatar as usual. A normal page load, or a switch between
 * characters, has no entrance.
 *
 * Lip-sync source: with a real engine the mouth follows the spectrum of the audio
 * actually played (the player's AnalyserNode); with the scripted double there is
 * no audio, so a synthetic pattern follows the transcript cadence.
 */
import { getPlayer } from "../voice/audio/player";
import { getState, subscribe, type ConsoleState } from "../voice/store";
import type { AffectEstimate, EngineStatus, StyleId } from "../voice/types";

export interface AvatarHandle {
  setState(state: EngineStatus): void;
  setMouthLevel(level: number): void;
  /** Drives the mouth from the audio being played; null detaches it. */
  attachAnalyser?(node: AnalyserNode | null): void;
  resetCamera(): void;
  dispose(): void;
  /** Face for the tone of the conversation. */
  setExpression?(expression: string): void;
  /** Play mode: the body leaves its spot, rolls with `setTilt` and bounces off the edges of the frame. */
  setPlayMode?(on: boolean): void;
  /** Gravity from the device tilt, in screen space: x to the right, y downwards, each -1..1. */
  setTilt?(x: number, y: number): void;
  /** Subscribes to hits against the edges (strength 0..1), e.g. to vibrate the phone. Returns the unsubscribe. */
  onImpact?(listener: (strength: number) => void): () => void;
  /** Entrance from the orb: jumps in and eats the orb on screen; resolves when it is over. */
  eatOrb?(options?: { orb?: { x: number; y: number; radius: number }; onBite?: (bite: OrbBite) => void }): Promise<void> | void;
}

/** A point in client pixels, and a circle (an eye). */
export interface Point {
  x: number;
  y: number;
}

export interface Circle extends Point {
  radius: number;
}

/** The open mouth, in client pixels, where the eyes are, and the time left until it snaps shut (ms). */
interface OrbBite {
  x: number;
  y: number;
  width: number;
  eyes?: ReadonlyArray<Circle>;
  closesIn: number;
}

/** While the slime hops in, the orb shrinks to this and moves aside, so the face it lands beside stays clear. */
const ORB_WAIT_SCALE = 0.55;
const ORB_WAIT_MS = 650;
/** In the bite: the width of the orb element (times the mouth width) as it travels, and as it goes in. */
const ORB_TRAVEL_SIZE = 1.1;
const ORB_END_SIZE = 0.6;
/** The orb draws its core and its ring within this fraction of its radius; beyond it only a faint halo. */
const ORB_VISIBLE = 0.72;

/** Distance from `c` to the segment a-b. */
function distanceToSegment(c: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((c.x - a.x) * dx + (c.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(c.x - (a.x + t * dx), c.y - (a.y + t * dy));
}

/**
 * Pure: the way of the orb's centre from `from` into the `mouth` (client pixels), for an orb of
 * `radius` that is `endRadius` by the time it turns into the mouth, and never passes over an eye.
 * Straight in when that is clear; otherwise over the top of the eyes if it is level with them, out
 * past the outer eye on its side, down the cheek to the height of the mouth (or just under the
 * eyes, if the mouth is that close to them), and in. Returns the points after `from`; the last
 * one is the mouth.
 */
export function orbPath(from: Point, mouth: Point, eyes: ReadonlyArray<Circle>, radius: number, endRadius = radius): Point[] {
  const gap = radius + 4;
  if (eyes.every((e) => distanceToSegment(e, from, mouth) > e.radius + gap)) return [{ ...mouth }];
  const below = Math.max(...eyes.map((e) => e.y + e.radius));
  const box = {
    left: Math.min(...eyes.map((e) => e.x - e.radius)) - gap,
    right: Math.max(...eyes.map((e) => e.x + e.radius)) + gap,
    top: Math.min(...eyes.map((e) => e.y - e.radius)) - gap,
    bottom: below + gap,
  };
  const side = from.x >= mouth.x ? 1 : -1;
  const out = side > 0 ? box.right : box.left;
  const clear = (x: number): boolean => (side > 0 ? x >= out : x <= out);
  const path: Point[] = [];
  let at = from;
  if (!clear(at.x) && at.y < box.bottom) {
    if (at.y > box.top) {
      at = { x: at.x, y: box.top };
      path.push(at);
    }
    at = { x: out, y: at.y };
    path.push(at);
  }
  if (at.y < box.bottom) path.push({ x: clear(at.x) ? out : at.x, y: Math.max(mouth.y, below + endRadius + 4) });
  path.push({ ...mouth });
  return path;
}

/** Where the orb element is moved to (in its parent's pixels) and how much it is scaled. */
interface OrbPose {
  dx: number;
  dy: number;
  scale: number;
}

const poseTransform = (p: OrbPose): string => `translate(${p.dx}px, ${p.dy}px) scale(${p.scale})`;

/**
 * Shrinks the orb element in place and moves it aside to the right (never past the stage's edge)
 * while the slime hops in. Returns the animation, the pose it ends in, and that pose on screen
 * (centre and radius, client pixels), for the slime to land beside and look at.
 */
function shrinkAside(orb: HTMLElement, stage: HTMLElement): { animation: Animation; pose: OrbPose; onScreen: Circle } | null {
  if (typeof orb.animate !== "function") return null;
  const rect = orb.getBoundingClientRect();
  if (rect.width <= 0 || orb.offsetWidth <= 0) return null;
  const zoom = rect.width / orb.offsetWidth;
  const radius = rect.width / 2;
  const small = radius * ORB_WAIT_SCALE;
  const room = stage.getBoundingClientRect().right - (rect.left + radius) - small - 12;
  const shift = Math.max(0, Math.min(rect.width * 0.2, room));
  const pose: OrbPose = { dx: shift / zoom, dy: 0, scale: ORB_WAIT_SCALE };
  const animation = orb.animate([{ transform: poseTransform({ dx: 0, dy: 0, scale: 1 }) }, { transform: poseTransform(pose) }], {
    duration: ORB_WAIT_MS,
    easing: "cubic-bezier(0.3, 0, 0.2, 1)",
    fill: "forwards",
  });
  return { animation, pose, onScreen: { x: rect.left + radius + shift, y: rect.top + radius, radius: small } };
}

/**
 * Flies the orb element into the mouth, from the pose it is in (`start`): it shrinks fast where
 * it is, travels round the eyes (`orbPath`) and is slurped in, shrinking to the size of the
 * mouth as it turns towards it and vanishing inside just before it closes. The element's parent
 * may be scaled (the stage zoom), so the moves are in the parent's own pixels.
 */
function flyInto(orb: HTMLElement, bite: OrbBite, start: OrbPose): Animation | null {
  if (typeof orb.animate !== "function") return null;
  const rect = orb.getBoundingClientRect(); // already in `start`
  if (rect.width <= 0 || orb.offsetWidth <= 0 || start.scale <= 0) return null;
  const zoom = rect.width / (orb.offsetWidth * start.scale);
  const full = orb.offsetWidth * zoom; // the orb's unscaled width on screen
  const from = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  const travel = Math.min(start.scale, Math.max(0.02, (bite.width * ORB_TRAVEL_SIZE) / full));
  const end = Math.min(travel, Math.max(0.015, (bite.width * ORB_END_SIZE) / full));
  const seen = (scale: number): number => ((scale * full) / 2) * ORB_VISIBLE;
  const path = orbPath(from, bite, bite.eyes ?? [], seen(travel), seen(end));
  const pose = (p: Point, scale: number): OrbPose => ({ dx: start.dx + (p.x - from.x) / zoom, dy: start.dy + (p.y - from.y) / zoom, scale });

  // Shrink in place first (fast, then easing off), travel at an even speed, then in and gone.
  const SHRUNK = 0.22;
  const INSIDE = 0.86;
  const lengths = path.map((p, i) => Math.hypot(p.x - (path[i - 1] ?? from).x, p.y - (path[i - 1] ?? from).y));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  const at = (walked: number): number => SHRUNK + (INSIDE - SHRUNK) * (walked / total);
  const frames: Keyframe[] = [
    { offset: 0, transform: poseTransform(start), opacity: 1, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
    { offset: SHRUNK, transform: poseTransform(pose(from, travel)), opacity: 1, easing: "linear" },
  ];
  let walked = 0;
  let prev: Point = from;
  path.forEach((p, i) => {
    const length = lengths[i] ?? 0;
    if (i === path.length - 1 && i > 0 && length > 0) {
      // Turning in under the eyes: mouth-sized before it passes beneath the nearest one.
      const k = Math.min(0.5, Math.max(0.15, (seen(travel) + 4) / length));
      const turn = { x: prev.x + (p.x - prev.x) * k, y: prev.y + (p.y - prev.y) * k };
      frames.push({ offset: at(walked + length * k), transform: poseTransform(pose(turn, end)), opacity: 1, easing: "linear" });
    }
    walked += length;
    const last = i === path.length - 1;
    frames.push({ offset: at(walked), transform: poseTransform(pose(p, last ? end : travel)), opacity: 1, easing: last ? "ease-in" : "linear" });
    prev = p;
  });
  frames.push({ offset: 1, transform: poseTransform(pose(bite, end * 0.4)), opacity: 0 });
  return orb.animate(frames, { duration: Math.max(150, bite.closesIn), fill: "forwards" });
}

interface ExpressionSource {
  affect: Pick<AffectEstimate, "sentiment" | "emotion" | "state_hint"> | null;
  style: StyleId;
}

interface AvatarModule {
  mountAvatar(canvas: HTMLCanvasElement, opts?: Record<string, unknown>): Promise<AvatarHandle>;
  expressionFor?(input: ExpressionSource): string;
}

const loaders = import.meta.glob("../avatar/index.ts") as Record<string, () => Promise<unknown>>;

export interface AvatarHost {
  /** Resolves to true when the avatar is on screen, false when the orb stays. */
  ready: Promise<boolean>;
  resetCamera(): void;
  dispose(): void;
  /** Play mode passthroughs: no-ops when the character does not support them. */
  setPlayMode(on: boolean): void;
  setTilt(x: number, y: number): void;
  /** Edge hits of the avatar (strength 0..1). Safe to call before the avatar is ready. */
  onImpact(listener: (strength: number) => void): () => void;
}

export function hostAvatar(stage: HTMLElement, canvas: HTMLCanvasElement): AvatarHost {
  let handle: AvatarHandle | null = null;
  let disposed = false;
  let mouthTimer: ReturnType<typeof setInterval> | undefined;
  let pulse = 0;
  let analyserOn = false;
  let toExpression: AvatarModule["expressionFor"] | null = null;
  let expression: string | null = null;

  const safely = (fn: () => void): void => {
    try {
      fn();
    } catch (err) {
      console.warn("[avatar] call failed", err);
    }
  };

  /**
   * Real engine running → the avatar reads the player's analyser. The player (and its
   * AudioContext) is only touched once a session is running, i.e. after a user gesture.
   */
  const syncAnalyser = (): boolean => {
    const s = getState();
    const want = s.running && !s.simulated && typeof handle?.attachAnalyser === "function";
    if (want === analyserOn) return analyserOn;
    analyserOn = want;
    safely(() => handle?.attachAnalyser?.(want ? getPlayer().analyser : null));
    return analyserOn;
  };

  // Scripted double (no audio): the mouth follows the transcript cadence.
  const mouth = (speaking: boolean): void => {
    clearInterval(mouthTimer);
    mouthTimer = undefined;
    if (!handle) return;
    if (syncAnalyser()) return; // the analyser drives the mouth, frame by frame
    if (!speaking) {
      safely(() => handle?.setMouthLevel(0));
      return;
    }
    mouthTimer = setInterval(() => {
      pulse = Math.max(0, pulse - 0.18);
      const t = performance.now() / 1000;
      const level = 0.25 + 0.3 * Math.abs(Math.sin(t * 9)) + 0.25 * Math.abs(Math.sin(t * 5.3)) + pulse * 0.2;
      safely(() => handle?.setMouthLevel(Math.min(1, level)));
    }, 60);
  };

  /** Latest affect reading + active style -> face; pushed only when it changes. */
  const syncExpression = (state: ConsoleState): void => {
    const map = toExpression;
    if (!map || typeof handle?.setExpression !== "function") return;
    safely(() => {
      const next = map({ affect: state.affect[state.affect.length - 1]?.estimate ?? null, style: state.style.style });
      if (next === expression) return;
      expression = next;
      handle?.setExpression?.(next);
    });
  };

  /**
   * Entrance from the orb (see the header): only for a stage marked `data-entrance="eat"` whose
   * `avatar:toggle` arrives straight after this host was created. The mark always goes in the end,
   * whatever happens to the avatar, so the orb is never left on screen over it.
   */
  const createdAt = performance.now();
  let eatOnReady = false;
  /** The orb's own animations during the entrance (shrinking aside, then the flight). */
  const orbMoves: Animation[] = [];
  let putBack: ReturnType<typeof setTimeout> | undefined;
  /** The orb at its place and size again, visible: at once. */
  const putOrbBack = (): void => {
    clearTimeout(putBack);
    putBack = undefined;
    for (const move of orbMoves.splice(0)) move.cancel();
  };
  const endEntrance = (): void => {
    if (stage.dataset.entrance === "eat") delete stage.dataset.entrance;
    // The orb is inside the slime by now; it is put back once the stage has hidden it
    // (or at once, if the person goes back to the orb before that: see `dispose`).
    if (orbMoves.length && putBack === undefined) putBack = setTimeout(putOrbBack, 500);
  };
  const runEntrance = (): void => {
    const h = handle;
    if (disposed || !h || typeof h.eatOrb !== "function" || stage.dataset.entrance !== "eat") {
      endEntrance();
      return;
    }
    const orb = stage.querySelector<HTMLElement>(".fallback #orb");
    // The orb makes room while the slime hops in: smaller, and aside, so it never covers the face.
    const aside = orb ? shrinkAside(orb, stage) : null;
    if (aside) orbMoves.push(aside.animation);
    const rect = orb?.getBoundingClientRect();
    const onScreen = aside?.onScreen ?? (rect && rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 } : undefined);
    try {
      const done = h.eatOrb({
        orb: onScreen,
        onBite: (bite) => {
          if (!orb || disposed) return;
          // From wherever the orb is now (normally where it shrank to), so it never jumps.
          aside?.animation.finish();
          const flight = flyInto(orb, bite, aside?.pose ?? { dx: 0, dy: 0, scale: 1 });
          if (!flight) return;
          orbMoves.push(flight);
          aside?.animation.cancel(); // the flight starts in the same pose
        },
      });
      void Promise.resolve(done)
        .catch((err: unknown) => console.warn("[avatar] entrance failed", err))
        .finally(endEntrance);
    } catch (err) {
      console.warn("[avatar] entrance failed", err);
      endEntrance();
    }
  };
  const onToggle = (event: Event): void => {
    const detail = (event as CustomEvent<{ enabled?: unknown } | null>).detail;
    window.removeEventListener("avatar:toggle", onToggle);
    if (disposed || detail?.enabled !== true || performance.now() - createdAt > 1000 || stage.dataset.entrance !== "eat") {
      endEntrance();
      return;
    }
    if (handle) runEntrance();
    else eatOnReady = true;
  };
  window.addEventListener("avatar:toggle", onToggle);

  const unsubscribe = subscribe((state, slices) => {
    if (!handle) return;
    if (slices.has("transcript")) pulse = 1;
    // The session may start or stop on any slice; keep the analyser in step.
    const hadAnalyser = analyserOn;
    if (syncAnalyser() !== hadAnalyser) mouth(state.status === "speaking");
    if (slices.has("status") || slices.has("reset") || slices.has("meta")) {
      safely(() => handle?.setState(state.status));
      mouth(state.status === "speaking");
    }
    if (slices.has("affect") || slices.has("style") || slices.has("reset")) syncExpression(state);
  });

  const ready = (async (): Promise<boolean> => {
    const load = loaders["../avatar/index.ts"];
    if (!load) {
      stage.dataset.avatar = "absent";
      return false;
    }
    stage.dataset.avatar = "loading";
    try {
      const mod = (await load()) as Partial<AvatarModule>;
      if (typeof mod.mountAvatar !== "function") throw new Error("src/avatar/index.ts does not export mountAvatar");
      const mounted = await mod.mountAvatar(canvas, {});
      if (disposed) {
        mounted.dispose();
        return false;
      }
      handle = mounted;
      if (typeof mod.expressionFor === "function") toExpression = mod.expressionFor;
      stage.dataset.avatar = "ready";
      const status = getState().status;
      safely(() => handle?.setState(status));
      mouth(status === "speaking");
      syncExpression(getState());
      if (eatOnReady) {
        eatOnReady = false;
        runEntrance();
      }
      return true;
    } catch (err) {
      console.warn("[avatar] not available, keeping the orb", err);
      stage.dataset.avatar = "failed";
      endEntrance();
      return false;
    }
  })();

  // Impact listeners may subscribe before the avatar is mounted; they are attached once it is.
  const impactListeners = new Set<(strength: number) => void>();
  let detachImpacts: (() => void) | null = null;
  void ready.then((ok) => {
    if (ok && handle?.onImpact) detachImpacts = handle.onImpact((s) => impactListeners.forEach((l) => l(s)));
  });

  return {
    ready,
    resetCamera: () => safely(() => handle?.resetCamera()),
    setPlayMode: (on) => safely(() => handle?.setPlayMode?.(on)),
    setTilt: (x, y) => safely(() => handle?.setTilt?.(x, y)),
    onImpact: (listener) => {
      impactListeners.add(listener);
      return () => impactListeners.delete(listener);
    },
    dispose: () => {
      disposed = true;
      window.removeEventListener("avatar:toggle", onToggle);
      // Back to the orb in (or just after) the entrance: the orb is shown again at once.
      putOrbBack();
      endEntrance();
      unsubscribe();
      clearInterval(mouthTimer);
      detachImpacts?.();
      impactListeners.clear();
      safely(() => handle?.dispose());
      handle = null;
    },
  };
}
