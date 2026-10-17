/**
 * Play mode of the avatar stage: the phone's peripherals drive the slime.
 *
 * The stage fills the screen (real fullscreen, or a CSS pseudo-fullscreen where
 * elements cannot go fullscreen, e.g. iPhone Safari), the device tilt becomes
 * gravity in screen space for `AvatarHost.setTilt`, a jolt of the phone adds a
 * short inertial push, and every hit of the slime against the edges becomes a
 * short vibration where the platform has one. Finger and mouse keep working:
 * dragging belongs to the character, this module never blocks it.
 *
 * The first half is pure math (tests/contract/play-mode.test.ts); the second
 * half is browser glue and touches the DOM only when it is called.
 *
 * Contract with the character (src/avatar/types.ts):
 *   setPlayMode(on), setTilt(x, y) with x to the right and y downwards (-1..1),
 *   onImpact(listener(strength 0..1)) => unsubscribe; and on the stage, the CSS
 *   custom property `--avatar-clear-bottom` (px): the strip kept for the controls.
 */

// ── Pure math ────────────────────────────────────────────────────────────────

export interface Vec2 {
  readonly x: number;
  readonly y: number;
}

/** Rotation of the screen content from the device's natural orientation (`screen.orientation.angle`). */
export type ScreenAngle = 0 | 90 | 180 | 270;

export const ZERO: Vec2 = { x: 0, y: 0 };

/** Gravity of a screen standing upright: used before the first reading and when the device shares no tilt. */
export const UPRIGHT: Vec2 = { x: 0, y: 1 };

export const TUNING = {
  /** Time constant of the tilt low-pass: removes hand tremor, keeps the roll responsive. */
  tiltTauMs: 90,
  /** Tilt below this (≈ 3.5° off level) counts as level, so a phone on a table stays still. */
  tiltDeadZone: 0.06,
  /** Time constant of the shake low-pass: short, a jolt lasts ~100–200 ms. */
  pushTauMs: 35,
  /** Linear acceleration (m/s²) that makes a full push. */
  pushFullScale: 15,
  /** Pushes below this (≈ 2 m/s², walking) are ignored. */
  pushDeadZone: 0.15,
  /** Upper bound for `setTilt` calls. */
  maxHz: 50,
  /** Tilt gain when the person asked the system to reduce motion. */
  gentleGain: 0.5,
  /** Without any reading within this time the device is taken as sensorless. */
  sensorWaitMs: 1500,
} as const;

export const VIBRATION = {
  /** Hits softer than this are not felt. */
  threshold: 0.08,
  minMs: 10,
  maxMs: 40,
  /** Minimum pause between two buzzes, so a slime rattling in a corner does not saturate the motor. */
  cooldownMs: 120,
} as const;

/** Turns -0 and NaN into 0, so results compare cleanly. */
const tidy = (v: Vec2): Vec2 => ({ x: v.x || 0, y: v.y || 0 });

const clamp1 = (n: number): number => Math.min(1, Math.max(-1, n || 0));

export function clampUnit(v: Vec2): Vec2 {
  return { x: clamp1(v.x), y: clamp1(v.y) };
}

/**
 * Snaps any angle in degrees to a quarter turn in [0, 360). Accepts the legacy
 * `window.orientation` (-90, 0, 90, 180) as well as `screen.orientation.angle`.
 */
export function normalizeAngle(angle: number | null | undefined): ScreenAngle {
  if (typeof angle !== "number" || !Number.isFinite(angle)) return 0;
  const quarter = (((Math.round(angle / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  return (quarter * 90) as ScreenAngle;
}

/**
 * Re-expresses a vector given in the axes of the natural orientation (x right,
 * y down) in the axes of the screen as it is shown now. Angle 90 is the device
 * turned a quarter counter-clockwise (its top edge on the left): the content's
 * right is the device's bottom edge and the content's down is the device's left.
 */
export function toScreen(natural: Vec2, angle: ScreenAngle): Vec2 {
  switch (angle) {
    case 90:
      return tidy({ x: natural.y, y: -natural.x });
    case 180:
      return tidy({ x: -natural.x, y: -natural.y });
    case 270:
      return tidy({ x: -natural.y, y: natural.x });
    default:
      return tidy(natural);
  }
}

const RAD = Math.PI / 180;

/**
 * Gravity on the screen plane from `deviceorientation` (degrees).
 *
 * The W3C angles rotate the device frame Z-X'-Y'' (alpha, beta, gamma). In the
 * device frame (x right, y towards the top edge, z out of the screen) gravity is
 * (cos β · sin γ, −sin β, −cos β · cos γ); alpha (the heading) does not change
 * it. Projected on the screen with y pointing down it is (cos β · sin γ, sin β)
 * in the natural orientation, then rotated to the current screen angle.
 * Flat on a table gives (0, 0); held upright gives (0, 1); its length is ≤ 1.
 */
export function gravityFromOrientation(beta: number, gamma: number, angle: ScreenAngle): Vec2 {
  const b = beta * RAD;
  const g = gamma * RAD;
  return toScreen({ x: Math.cos(b) * Math.sin(g), y: Math.sin(b) }, angle);
}

/**
 * Inertial push from `devicemotion.acceleration` (m/s², gravity excluded): when
 * the phone jerks one way, its contents are thrown the other way. The device's
 * y points to its top edge, the screen's y points down.
 */
export function pushFromMotion(ax: number, ay: number, angle: ScreenAngle, fullScale: number = TUNING.pushFullScale): Vec2 {
  return clampUnit(toScreen({ x: -ax / fullScale, y: ay / fullScale }, angle));
}

/**
 * Exponential low-pass independent of the event rate: `tauMs` is the time
 * constant. The first sample (no previous value) passes through untouched.
 */
export function lowPass(prev: Vec2 | null, next: Vec2, dtMs: number, tauMs: number): Vec2 {
  if (!prev || !(tauMs > 0)) return next;
  const k = 1 - Math.exp(-Math.max(0, dtMs || 0) / tauMs);
  return { x: prev.x + (next.x - prev.x) * k, y: prev.y + (next.y - prev.y) * k };
}

/**
 * Radial dead zone: inside `radius` the vector is zero; outside, its length is
 * rescaled so the response starts at 0 on the edge of the zone and 1 stays 1.
 */
export function deadZone(v: Vec2, radius: number): Vec2 {
  const r = Math.min(0.9, Math.max(0, radius));
  const len = Math.hypot(v.x, v.y);
  if (!(len > r)) return ZERO;
  const scale = (len - r) / (1 - r) / len;
  return clampUnit({ x: v.x * scale, y: v.y * scale });
}

/** Gravity (scaled by `gain`) plus the shake push, clamped to the contract's -1..1. */
export function mixTilt(gravity: Vec2, push: Vec2, gain = 1): Vec2 {
  return tidy(clampUnit({ x: gravity.x * gain + push.x, y: gravity.y * gain + push.y }));
}

/** Length of the buzz for a hit of `strength` (0..1): 10–40 ms, or 0 for a touch too soft to feel. */
export function vibrationMs(strength: number): number {
  const { threshold, minMs, maxMs } = VIBRATION;
  if (!(strength >= threshold)) return 0;
  const t = (Math.min(1, strength) - threshold) / (1 - threshold);
  return Math.round(minMs + (maxMs - minMs) * t);
}

/** Like `vibrationMs`, but 0 while the motor is cooling down after the last buzz (`lastAt`). */
export function buzzFor(strength: number, now: number, lastAt: number, cooldownMs: number = VIBRATION.cooldownMs): number {
  if (now - lastAt < cooldownMs) return 0;
  return vibrationMs(strength);
}

export interface Throttle<T> {
  /** Offers a new value; the latest one is sent at most once per interval, the last one always arrives. */
  push(value: T): void;
  cancel(): void;
}

/** Leading + trailing throttle: the first value goes out at once, later ones at most every `intervalMs`. */
export function createThrottle<T>(send: (value: T) => void, intervalMs: number, now: () => number = () => performance.now()): Throttle<T> {
  let lastAt = -Infinity;
  let pending: { value: T } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = (): void => {
    timer = undefined;
    if (!pending) return;
    const { value } = pending;
    pending = null;
    lastAt = now();
    send(value);
  };

  return {
    push(value) {
      pending = { value };
      if (timer !== undefined) return;
      const wait = lastAt + intervalMs - now();
      if (wait <= 0) flush();
      else timer = setTimeout(flush, wait);
    },
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
  };
}

// ── Browser glue ─────────────────────────────────────────────────────────────

/** What the stage needs from the avatar host (`AvatarHost` satisfies it). */
export interface PlayTarget {
  setPlayMode(on: boolean): void;
  setTilt(x: number, y: number): void;
  onImpact(listener: (strength: number) => void): () => void;
}

/** "on": the tilt drives the avatar. "off": finger or mouse only (no sensor, refused, or not HTTPS). */
export type SensorStatus = "on" | "off";

/** How the stage fills the screen: the Fullscreen API, or CSS where elements cannot go fullscreen. */
export type ScreenMode = "native" | "pseudo";

export interface PlayOptions {
  /** The sensor answer is known (it may change once, from "off" to "on", if a late reading arrives). */
  onSensor?(status: SensorStatus, info: { reducedMotion: boolean }): void;
  /** Play mode ended, whoever ended it: the exit button, Esc, or leaving fullscreen. Called once. */
  onEnd?(): void;
  /**
   * Controls that stay on screen along the bottom of the stage while playing (the bar). The stage
   * then carries `--avatar-clear-bottom` (px) with the strip they take, and the avatar stays above it.
   */
  keepClear?: HTMLElement | null;
}

/** CSS custom property on the stage: how much of its bottom edge (px) the avatar must leave free. */
export const CLEAR_BOTTOM = "--avatar-clear-bottom";
/** Room left between the controls and the avatar resting above them, px. */
const CLEAR_GAP = 8;

/** Keeps `CLEAR_BOTTOM` on the stage equal to the strip `controls` take at its bottom, as they move. Returns the undo. */
function reserveBottom(stage: HTMLElement, controls: HTMLElement): () => void {
  const measure = (): void => {
    const frame = stage.getBoundingClientRect();
    const box = controls.getBoundingClientRect();
    const strip = box.height > 0 ? Math.max(0, Math.round(frame.bottom - box.top + CLEAR_GAP)) : 0;
    stage.style.setProperty(CLEAR_BOTTOM, `${strip}px`);
  };
  measure();
  const observer = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
  observer?.observe(stage);
  observer?.observe(controls);
  window.addEventListener("resize", measure);
  return () => {
    observer?.disconnect();
    window.removeEventListener("resize", measure);
    stage.style.removeProperty(CLEAR_BOTTOM);
  };
}

export interface PlaySession {
  readonly active: boolean;
  readonly screen: ScreenMode;
  /** Ends play mode and restores everything it changed. Idempotent. */
  stop(): void;
}

interface SensorAccess {
  tilt: boolean;
  motion: boolean;
}

type PermissionGate = { requestPermission?: () => Promise<string> };
type LockableOrientation = ScreenOrientation & { lock?: (orientation: OrientationType) => Promise<void> };

const safely = (fn: () => void): void => {
  try {
    fn();
  } catch {
    // Optional platform features: a refusal is not an error of the page.
  }
};

/** Current screen rotation, from `screen.orientation` (iOS 16.4+, Android) or the legacy `window.orientation`. */
export function readScreenAngle(): ScreenAngle {
  const orientation: ScreenOrientation | undefined = typeof screen === "undefined" ? undefined : screen.orientation;
  if (orientation && typeof orientation.angle === "number") return normalizeAngle(orientation.angle);
  const legacy = (globalThis as { orientation?: unknown }).orientation;
  return normalizeAngle(typeof legacy === "number" ? legacy : 0);
}

/**
 * Asks for the motion sensors. Must run synchronously inside the click handler:
 * iOS 13+ only shows its prompt during a user gesture. Android and desktops have
 * no prompt. Sensors only exist in a secure context (HTTPS or localhost).
 */
export function requestSensorAccess(): Promise<SensorAccess> {
  if (typeof window === "undefined" || !window.isSecureContext || typeof DeviceOrientationEvent === "undefined") {
    return Promise.resolve({ tilt: false, motion: false });
  }
  const orientation = DeviceOrientationEvent as unknown as PermissionGate;
  const motion = (typeof DeviceMotionEvent === "undefined" ? null : DeviceMotionEvent) as unknown as PermissionGate | null;
  const ask = (gate: PermissionGate | null): Promise<boolean> => {
    if (!gate) return Promise.resolve(false);
    if (typeof gate.requestPermission !== "function") return Promise.resolve(true);
    try {
      return gate.requestPermission().then((answer) => answer === "granted", () => false);
    } catch {
      return Promise.resolve(false);
    }
  };
  // Both requests start now, still inside the gesture; the motion answer is optional.
  const tilt = ask(orientation);
  const shake = ask(motion);
  return Promise.all([tilt, shake]).then(([t, m]) => ({ tilt: t, motion: t && m }));
}

/** Real fullscreen when the element supports it; resolves false where it cannot (iPhone) or was refused. */
function requestNativeFullscreen(el: HTMLElement): Promise<boolean> {
  if (typeof el.requestFullscreen !== "function" || document.fullscreenEnabled === false) return Promise.resolve(false);
  try {
    return el.requestFullscreen({ navigationUI: "hide" }).then(
      () => true,
      () => false,
    );
  } catch {
    return Promise.resolve(false);
  }
}

/** Keeps the screen from rotating while the phone is tilted (Android in fullscreen; elsewhere it fails quietly). */
function lockOrientation(): boolean {
  const orientation = (typeof screen === "undefined" ? undefined : screen.orientation) as LockableOrientation | undefined;
  if (!orientation || typeof orientation.lock !== "function") return false;
  try {
    orientation.lock(orientation.type).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

/** Makes everything outside `el` inert (keyboard and screen readers stay in the stage). Returns the undo. */
function inertOutside(el: HTMLElement): () => void {
  const changed: HTMLElement[] = [];
  for (let node: HTMLElement | null = el; node && node !== document.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sibling of Array.from<Element>(parent.children)) {
      if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
      sibling.inert = true;
      changed.push(sibling);
    }
  }
  return () => {
    for (const sibling of changed) sibling.inert = false;
  };
}

/**
 * Enters play mode on `stage`. Call it synchronously from the click on «Jugar»:
 * the sensor permission (iOS) and the fullscreen request both need the gesture.
 *
 * While active the stage carries `data-play="on"`, `data-play-screen` (native |
 * pseudo) and `data-play-sensor` (waiting | on | off); in pseudo mode `<html>`
 * carries `data-play-lock` so the page cannot scroll behind the stage.
 */
export function startPlay(stage: HTMLElement, target: PlayTarget, options: PlayOptions = {}): PlaySession {
  const reducedMotion = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const gain = reducedMotion ? TUNING.gentleGain : 1;
  const root = document.documentElement;
  const undos: Array<() => void> = [];

  // Inside the gesture, before anything else.
  const access = requestSensorAccess();
  const alreadyFullscreen = document.fullscreenElement === stage;
  const fullscreen = alreadyFullscreen ? Promise.resolve(true) : requestNativeFullscreen(stage);

  let active = true;
  let screenMode: ScreenMode = alreadyFullscreen || (typeof stage.requestFullscreen === "function" && document.fullscreenEnabled !== false) ? "native" : "pseudo";
  let inNative = alreadyFullscreen;
  let ownsFullscreen = false;
  let sensor: SensorStatus | "waiting" = "waiting";

  const setScreen = (mode: ScreenMode): void => {
    screenMode = mode;
    stage.dataset.playScreen = mode;
    if (mode === "pseudo") root.dataset.playLock = "";
    else delete root.dataset.playLock;
  };

  const setSensor = (status: SensorStatus): void => {
    if (sensor === status) return;
    sensor = status;
    stage.dataset.playSensor = status;
    options.onSensor?.(status, { reducedMotion });
  };

  // ── Tilt → gravity ──
  let gravity: Vec2 | null = null;
  let gravityAt = 0;
  let shove: Vec2 | null = null;
  let shoveAt = 0;
  let sent: Vec2 | null = null;

  const throttle = createThrottle<Vec2>((v) => {
    if (sent && Math.abs(v.x - sent.x) < 1e-3 && Math.abs(v.y - sent.y) < 1e-3) return;
    sent = v;
    target.setTilt(v.x, v.y);
  }, 1000 / TUNING.maxHz);
  undos.push(() => throttle.cancel());

  const emit = (): void => {
    const g = deadZone(gravity ?? UPRIGHT, TUNING.tiltDeadZone);
    const p = shove ? deadZone(shove, TUNING.pushDeadZone) : ZERO;
    throttle.push(mixTilt(g, p, gain));
  };

  const onOrientation = (e: DeviceOrientationEvent): void => {
    // Desktop browsers may fire one empty event when there is no sensor.
    if (typeof e.beta !== "number" || typeof e.gamma !== "number" || !Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;
    const now = performance.now();
    gravity = lowPass(gravity, gravityFromOrientation(e.beta, e.gamma, readScreenAngle()), now - gravityAt, TUNING.tiltTauMs);
    gravityAt = now;
    setSensor("on");
    emit();
  };

  const onMotion = (e: DeviceMotionEvent): void => {
    const a = e.acceleration;
    if (!a || typeof a.x !== "number" || typeof a.y !== "number") return;
    const now = performance.now();
    shove = lowPass(shove, pushFromMotion(a.x, a.y, readScreenAngle()), now - shoveAt, TUNING.pushTauMs);
    shoveAt = now;
    if (sensor === "on") emit();
  };

  // ── Start ──
  stage.dataset.play = "on";
  stage.dataset.playSensor = "waiting";
  setScreen(screenMode);
  undos.push(inertOutside(stage));
  safely(() => target.setPlayMode(true));
  // Until the first reading (and for good without a sensor) the screen is taken as upright: things fall down.
  const initial = mixTilt(UPRIGHT, ZERO, gain);
  sent = initial;
  safely(() => target.setTilt(initial.x, initial.y));

  // The strip for the bar is kept only once the stage fills the screen: on the small stage it would
  // put the floor above the resting avatar, and the avatar would be shot up into the air.
  const keepClear = (): void => {
    if (options.keepClear) undos.push(reserveBottom(stage, options.keepClear));
  };

  void fullscreen.then((ok) => {
    if (!active) {
      // Ended before the browser answered: undo what it just granted.
      if (ok && !alreadyFullscreen && document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined);
      return;
    }
    if (!ok) {
      setScreen("pseudo");
      keepClear();
      return;
    }
    inNative = true;
    ownsFullscreen = !alreadyFullscreen;
    setScreen("native");
    keepClear();
    if (lockOrientation()) undos.push(() => safely(() => screen.orientation.unlock()));
  });

  // Leaving real fullscreen (Esc, the system back gesture, the browser's own UI) ends the game.
  const onFullscreenChange = (): void => {
    if (inNative && document.fullscreenElement !== stage) stop();
  };
  document.addEventListener("fullscreenchange", onFullscreenChange);
  undos.push(() => document.removeEventListener("fullscreenchange", onFullscreenChange));

  // In pseudo mode Esc reaches the page. On `window`, bubbling: page handlers on
  // `document` see the event first and can tell it belongs to the game.
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Escape") stop();
  };
  window.addEventListener("keydown", onKey);
  undos.push(() => window.removeEventListener("keydown", onKey));

  void access.then((granted) => {
    if (!active) return;
    if (!granted.tilt) {
      setSensor("off");
      return;
    }
    window.addEventListener("deviceorientation", onOrientation);
    undos.push(() => window.removeEventListener("deviceorientation", onOrientation));
    if (granted.motion && !reducedMotion) {
      window.addEventListener("devicemotion", onMotion);
      undos.push(() => window.removeEventListener("devicemotion", onMotion));
    }
    // A desktop "has" the API but never reports an angle.
    const wait = setTimeout(() => {
      if (sensor === "waiting") setSensor("off");
    }, TUNING.sensorWaitMs);
    undos.push(() => clearTimeout(wait));
  });

  // ── Hits → vibration (Android; iOS has no vibration API). Never with reduced motion. ──
  if (!reducedMotion && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    let lastBuzz = -Infinity;
    const unsubscribe = target.onImpact((strength) => {
      if (!active) return;
      const now = performance.now();
      const ms = buzzFor(strength, now, lastBuzz);
      if (ms <= 0) return;
      lastBuzz = now;
      safely(() => navigator.vibrate(ms));
    });
    undos.push(unsubscribe, () => safely(() => navigator.vibrate(0)));
  }

  function stop(): void {
    if (!active) return;
    active = false;
    for (const undo of undos.splice(0).reverse()) safely(undo);
    safely(() => target.setTilt(0, 0));
    safely(() => target.setPlayMode(false));
    if (ownsFullscreen && document.fullscreenElement === stage) void document.exitFullscreen().catch(() => undefined);
    delete stage.dataset.play;
    delete stage.dataset.playScreen;
    delete stage.dataset.playSensor;
    delete root.dataset.playLock;
    options.onEnd?.();
  }

  return {
    get active() {
      return active;
    },
    get screen() {
      return screenMode;
    },
    stop,
  };
}
