/**
 * What a finger or the mouse is doing on the slime: tap, hold, rub or drag.
 *
 * Pure: no DOM and no three.js. It reads pointer samples (CSS pixels and
 * milliseconds, plus whether the point is over the body) and says which gesture
 * they make, so the rules can be tested on their own (tests/contract/gestures.test.ts).
 *
 * Rules, for a press that starts on the body (a press off the body belongs to
 * the camera, see slime.ts). Distances scale with the size of the body on
 * screen (`bodyPx`, its radius), so a small slime on a phone needs smaller moves:
 *
 *   | Gesture | Recognised when                                                        |
 *   |---------|------------------------------------------------------------------------|
 *   | tap     | released before `holdMs`, never farther than `tapSlop` from the press  |
 *   | hold    | kept still (within `holdSlop`) for `holdMs`                            |
 *   | rub     | side-to-side strokes: `rubStrokes` horizontal reversals, each swing at |
 *   |         | least `rubSwing`, while the pointer is still on the body               |
 *   | drag    | moved `dragDistance` away from the press, or a clear move off the body,|
 *   |         | or a mostly vertical move (rubbing is side to side)                    |
 *
 * Once recognised, a gesture lasts until release; only a hold may turn into a
 * drag (the person pulls the melted puddle). A release that matches nothing is
 * `none` (a small nudge).
 */

export interface PointerSample {
  /** CSS pixels, client coordinates. */
  x: number;
  y: number;
  /** Milliseconds, any monotonic clock. */
  t: number;
  /** Whether the point is over the body. */
  onBody: boolean;
}

export type ActiveGesture = "rub" | "hold" | "drag";
export type GestureName = "tap" | ActiveGesture | "none";
export type GesturePhase = "idle" | "pending" | ActiveGesture;

export type GestureEvent =
  /** A rub, hold or drag has just been recognised. */
  | { type: "start"; gesture: ActiveGesture }
  /** One more stroke while rubbing (a change of direction). */
  | { type: "stroke" }
  /** Released (or cancelled): what it was, and the release velocity in px/s (for throws). */
  | { type: "end"; gesture: GestureName; vx: number; vy: number };

export interface GestureConfig {
  holdMs: number;
  /** Fractions of the body radius on screen, each with a floor in pixels. */
  tapSlop: number;
  holdSlop: number;
  rubSwing: number;
  dragDistance: number;
  /** A move off the body this far from the press is a drag. */
  offBodyDistance: number;
  rubStrokes: number;
  /** Only the samples this recent count for the release velocity. */
  velocityWindowMs: number;
}

export const DEFAULT_GESTURES: GestureConfig = {
  holdMs: 800,
  tapSlop: 0.1,
  holdSlop: 0.1,
  rubSwing: 0.12,
  dragDistance: 0.75,
  offBodyDistance: 0.3,
  rubStrokes: 2,
  velocityWindowMs: 100,
};

const MIN_PX = { tapSlop: 10, holdSlop: 12, rubSwing: 8, dragDistance: 28, offBodyDistance: 14 } as const;

/** Release velocity in px/s from the samples of the last `windowMs`; zero when the pointer had stopped. */
export function releaseVelocity(samples: readonly PointerSample[], windowMs = DEFAULT_GESTURES.velocityWindowMs): { vx: number; vy: number } {
  const last = samples[samples.length - 1];
  if (!last) return { vx: 0, vy: 0 };
  let first = last;
  for (let i = samples.length - 2; i >= 0; i--) {
    const s = samples[i];
    if (!s || last.t - s.t > windowMs) break;
    first = s;
  }
  const dt = (last.t - first.t) / 1000;
  if (dt < 0.008) return { vx: 0, vy: 0 };
  return { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
}

export class GestureTracker {
  private readonly config: GestureConfig;
  private current: GesturePhase = "idle";
  private start: PointerSample = { x: 0, y: 0, t: 0, onBody: true };
  private recent: PointerSample[] = [];
  private maxDistance = 0;
  private body = 100;
  // Rub detection: direction of the current horizontal swing and where it peaked.
  private dir = 0;
  private extreme = 0;
  private reversals = 0;

  constructor(config: Partial<GestureConfig> = {}) {
    this.config = { ...DEFAULT_GESTURES, ...config };
  }

  get phase(): GesturePhase {
    return this.current;
  }

  /** Number of side-to-side reversals so far in this press. */
  get strokes(): number {
    return this.reversals;
  }

  /** A press on the body. `bodyPx` is the body radius on screen, in CSS pixels. */
  down(sample: PointerSample, bodyPx: number): GestureEvent[] {
    this.current = "pending";
    this.start = sample;
    this.recent = [sample];
    this.maxDistance = 0;
    this.body = Math.max(20, bodyPx);
    this.dir = 0;
    this.extreme = sample.x;
    this.reversals = 0;
    return [];
  }

  move(sample: PointerSample): GestureEvent[] {
    if (this.current === "idle") return [];
    this.remember(sample);
    const dx = sample.x - this.start.x;
    const dy = sample.y - this.start.y;
    const distance = Math.hypot(dx, dy);
    this.maxDistance = Math.max(this.maxDistance, distance);
    const reversed = this.trackSwing(sample.x);
    const events: GestureEvent[] = [];

    if (this.current === "pending") {
      if (this.reversals >= this.config.rubStrokes && sample.onBody) {
        this.current = "rub";
        events.push({ type: "start", gesture: "rub" }, { type: "stroke" });
      } else if (this.isDrag(sample, dx, dy, distance)) {
        this.current = "drag";
        events.push({ type: "start", gesture: "drag" });
      }
    } else if (this.current === "rub") {
      if (reversed) events.push({ type: "stroke" });
    } else if (this.current === "hold" && distance >= this.px("dragDistance")) {
      this.current = "drag";
      events.push({ type: "start", gesture: "drag" });
    }
    return events;
  }

  /** Called every frame: a still press becomes a hold without any move event. */
  tick(t: number): GestureEvent[] {
    if (this.current !== "pending") return [];
    if (t - this.start.t >= this.config.holdMs && this.maxDistance <= this.px("holdSlop") && this.reversals === 0) {
      this.current = "hold";
      return [{ type: "start", gesture: "hold" }];
    }
    return [];
  }

  up(sample: PointerSample): GestureEvent[] {
    if (this.current === "idle") return [];
    const events = this.move(sample);
    // The hold may be due by now even if no frame ran in between.
    events.push(...this.tick(sample.t));
    let gesture: GestureName = this.current === "pending" ? "none" : this.current;
    if (this.current === "pending" && this.maxDistance <= this.px("tapSlop") && sample.t - this.start.t < this.config.holdMs) gesture = "tap";
    const v = releaseVelocity(this.recent, this.config.velocityWindowMs);
    events.push({ type: "end", gesture, vx: v.vx, vy: v.vy });
    this.current = "idle";
    return events;
  }

  /** The pointer was taken away (pointercancel, lost capture): ends without a throw. */
  cancel(): GestureEvent[] {
    if (this.current === "idle") return [];
    const gesture: GestureName = this.current === "pending" ? "none" : this.current;
    this.current = "idle";
    return [{ type: "end", gesture, vx: 0, vy: 0 }];
  }

  private px(key: keyof typeof MIN_PX): number {
    return Math.max(MIN_PX[key], this.config[key] * this.body);
  }

  private remember(sample: PointerSample): void {
    this.recent.push(sample);
    const keep = this.config.velocityWindowMs * 3;
    while (this.recent.length > 2 && sample.t - (this.recent[0]?.t ?? sample.t) > keep) this.recent.shift();
  }

  /** Follows the horizontal swing with some hysteresis; returns true when it just reversed. */
  private trackSwing(x: number): boolean {
    const swing = this.px("rubSwing");
    if (this.dir === 0) {
      if (Math.abs(x - this.extreme) >= swing) {
        this.dir = Math.sign(x - this.extreme);
        this.extreme = x;
      }
      return false;
    }
    if ((x - this.extreme) * this.dir > 0) {
      this.extreme = x; // still going the same way
      return false;
    }
    if (Math.abs(x - this.extreme) >= swing) {
      this.dir = -this.dir;
      this.extreme = x;
      this.reversals++;
      return true;
    }
    return false;
  }

  private isDrag(sample: PointerSample, dx: number, dy: number, distance: number): boolean {
    if (distance >= this.px("dragDistance")) return true;
    if (!sample.onBody && distance >= this.px("offBodyDistance")) return true;
    // Rubbing is side to side: a clear vertical pull is a drag.
    return this.reversals === 0 && Math.abs(dy) >= 0.5 * this.body && Math.abs(dy) > 1.5 * Math.abs(dx);
  }
}

/**
 * Runs a whole press through a tracker: the first sample is the press, the last the
 * release, and a tick runs at every sample. Returns the gesture of the release.
 * Handy for tests and for reasoning about the rules.
 */
export function classify(samples: readonly PointerSample[], bodyPx: number, config: Partial<GestureConfig> = {}): GestureName {
  const first = samples[0];
  const last = samples[samples.length - 1];
  if (!first || !last) return "none";
  const tracker = new GestureTracker(config);
  tracker.down(first, bodyPx);
  for (let i = 1; i < samples.length - 1; i++) {
    const s = samples[i];
    if (!s) continue;
    tracker.tick(s.t);
    tracker.move(s);
  }
  const end = tracker.up(last).find((e) => e.type === "end");
  return end && end.type === "end" ? end.gesture : "none";
}
