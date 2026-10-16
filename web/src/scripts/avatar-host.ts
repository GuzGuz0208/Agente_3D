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
      return true;
    } catch (err) {
      console.warn("[avatar] not available, keeping the orb", err);
      stage.dataset.avatar = "failed";
      return false;
    }
  })();

  return {
    ready,
    resetCamera: () => safely(() => handle?.resetCamera()),
    dispose: () => {
      disposed = true;
      unsubscribe();
      clearInterval(mouthTimer);
      safely(() => handle?.dispose());
      handle = null;
    },
  };
}
