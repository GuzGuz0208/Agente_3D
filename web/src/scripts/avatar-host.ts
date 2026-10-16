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
 * sends `avatar:toggle` with `{ enabled: true }`. Once ready, the character's
 * optional `eatOrb()` gets where that orb is; when the mouth is open (`onBite`)
 * the orb element itself flies into it, and when the entrance is over the mark
 * goes and the orb is put back, hidden behind the avatar as usual. A normal page
 * load, or a switch between characters, has no entrance.
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

/** The open mouth, in client pixels, and the time left until it snaps shut (ms). */
interface OrbBite {
  x: number;
  y: number;
  width: number;
  closesIn: number;
}

/**
 * Flies the orb element into the mouth: it drifts towards it, then is slurped in, shrinking
 * to the size of the mouth and vanishing inside just before it closes. The element's parent
 * may be scaled (the stage zoom), so the move is in the parent's own pixels.
 */
function flyInto(orb: HTMLElement, bite: OrbBite): Animation | null {
  if (typeof orb.animate !== "function") return null;
  const rect = orb.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const zoom = orb.offsetWidth > 0 ? rect.width / orb.offsetWidth : 1;
  const dx = (bite.x - (rect.left + rect.width / 2)) / zoom;
  const dy = (bite.y - (rect.top + rect.height / 2)) / zoom;
  const end = Math.min(1, Math.max(0.03, (bite.width * 0.45) / rect.width));
  return orb.animate(
    [
      { transform: "translate(0px, 0px) scale(1)", opacity: 1 },
      { transform: `translate(${dx * 0.25}px, ${dy * 0.25}px) scale(${0.55 + 0.45 * end})`, opacity: 1, offset: 0.35 },
      { transform: `translate(${dx}px, ${dy}px) scale(${end})`, opacity: 1, offset: 0.85 },
      { transform: `translate(${dx}px, ${dy}px) scale(${end * 0.4})`, opacity: 0 },
    ],
    { duration: Math.max(150, bite.closesIn), easing: "cubic-bezier(0.45, 0, 0.8, 0.55)", fill: "forwards" },
  );
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
  let orbFlight: Animation | null = null;
  const endEntrance = (): void => {
    if (stage.dataset.entrance === "eat") delete stage.dataset.entrance;
    const flight = orbFlight;
    orbFlight = null;
    // The orb is inside the slime by now; it is put back once the stage has hidden it.
    if (flight) setTimeout(() => flight.cancel(), 500);
  };
  const runEntrance = (): void => {
    const h = handle;
    if (disposed || !h || typeof h.eatOrb !== "function" || stage.dataset.entrance !== "eat") {
      endEntrance();
      return;
    }
    const orb = stage.querySelector<HTMLElement>(".fallback #orb");
    const rect = orb?.getBoundingClientRect();
    const onScreen = rect && rect.width > 0 ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, radius: rect.width / 2 } : undefined;
    try {
      const done = h.eatOrb({
        orb: onScreen,
        onBite: (bite) => {
          if (orb && !disposed) orbFlight = flyInto(orb, bite);
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
      // Back to the orb in the middle of the entrance: the orb is shown again at once.
      orbFlight?.cancel();
      orbFlight = null;
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
