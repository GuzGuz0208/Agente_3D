/**
 * Gestures on the slime (src/avatar/gestures.ts): which press is a tap, a hold,
 * a rub or a drag, and the release velocity used to throw it in play mode.
 */
import { describe, expect, it } from "vitest";
import { classify, GestureTracker, releaseVelocity, type GestureEvent, type PointerSample } from "../../src/avatar/gestures";

/** Body radius on screen, px: a desktop-sized slime. */
const BODY = 150;

const at = (x: number, y: number, t: number, onBody = true): PointerSample => ({ x, y, t, onBody });

/** A press that stays near (x, y) for `ms`, sampled every 16 ms with a little jitter. */
function still(ms: number, jitter = 3): PointerSample[] {
  const out: PointerSample[] = [];
  for (let t = 0; t <= ms; t += 16) out.push(at(200 + (t % 32 === 0 ? jitter : -jitter), 300, t));
  return out;
}

/** Side-to-side strokes of `swing` px around x = 200, `strokes` passes, 16 ms apart. */
function rub(swing: number, strokes: number, onBody = true): PointerSample[] {
  const out: PointerSample[] = [at(200, 300, 0, onBody)];
  let t = 0;
  for (let s = 0; s < strokes; s++) {
    const dir = s % 2 === 0 ? 1 : -1;
    for (let k = 1; k <= 6; k++) {
      t += 16;
      const x = 200 + dir * (swing / 2) * (k / 6) * 2 - dir * (swing / 2);
      out.push(at(x, 300 + (k % 2), t, onBody));
    }
  }
  return out;
}

/** A straight move of (dx, dy) px in `ms`. */
function line(dx: number, dy: number, ms: number, onBody: (k: number) => boolean = () => true): PointerSample[] {
  const out: PointerSample[] = [];
  const n = Math.max(2, Math.round(ms / 16));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    out.push(at(200 + dx * k, 300 + dy * k, k * ms, onBody(k)));
  }
  return out;
}

describe("classify", () => {
  it("a quick press that does not move is a tap", () => {
    expect(classify([at(200, 300, 0), at(202, 301, 120)], BODY)).toBe("tap");
  });

  it("a slower press is still a tap if it ends before the hold", () => {
    expect(classify(still(600), BODY)).toBe("tap");
  });

  it("a press kept still for the hold time is a hold, even with finger jitter", () => {
    expect(classify(still(1000, 4), BODY)).toBe("hold");
  });

  it("side-to-side strokes on the body are a rub", () => {
    expect(classify(rub(40, 4), BODY)).toBe("rub");
  });

  it("the same strokes off the body are not a rub", () => {
    expect(classify(rub(40, 4, false), BODY)).not.toBe("rub");
  });

  it("a long move one way is a drag", () => {
    expect(classify(line(160, 0, 300), BODY)).toBe("drag");
  });

  it("a short move that leaves the body is a drag", () => {
    expect(classify(line(60, 0, 200, (k) => k < 0.5), BODY)).toBe("drag");
  });

  it("a clear vertical pull is a drag (rubbing is side to side)", () => {
    expect(classify(line(0, -90, 250), BODY)).toBe("drag");
  });

  it("a small nudge that is neither is none", () => {
    expect(classify(line(30, 0, 200), BODY)).toBe("none");
  });

  it("scales with the body: a small slime on a phone needs smaller moves", () => {
    expect(classify(line(50, 0, 250), 40)).toBe("drag");
    expect(classify(line(50, 0, 250), BODY)).toBe("none");
    // Floors in pixels: a finger's jitter is never a drag, however small the body.
    expect(classify([at(200, 300, 0), at(208, 300, 100)], 20)).toBe("tap");
  });
});

describe("GestureTracker", () => {
  it("fires the hold from the frame tick, without any move", () => {
    const tracker = new GestureTracker();
    tracker.down(at(200, 300, 0), BODY);
    expect(tracker.tick(500)).toEqual([]);
    expect(tracker.tick(820)).toEqual([{ type: "start", gesture: "hold" }]);
    expect(tracker.phase).toBe("hold");
    expect(tracker.tick(900)).toEqual([]); // only once
  });

  it("counts one stroke per change of direction while rubbing", () => {
    const tracker = new GestureTracker();
    const samples = rub(40, 6);
    const first = samples[0];
    if (!first) throw new Error("no samples");
    tracker.down(first, BODY);
    const events: GestureEvent[] = [];
    for (const s of samples.slice(1)) events.push(...tracker.move(s));
    expect(events.filter((e) => e.type === "start")).toEqual([{ type: "start", gesture: "rub" }]);
    // Recognised at the second reversal (one stroke for it), then one per reversal.
    expect(events.filter((e) => e.type === "stroke").length).toBe(tracker.strokes - 1);
    expect(tracker.strokes).toBeGreaterThanOrEqual(4);
  });

  it("lets a hold turn into a drag (pulling the melted puddle)", () => {
    const tracker = new GestureTracker();
    tracker.down(at(200, 300, 0), BODY);
    tracker.tick(900);
    const events = tracker.move(at(400, 300, 1000));
    expect(events).toEqual([{ type: "start", gesture: "drag" }]);
    const end = tracker.up(at(400, 300, 1020)).at(-1);
    expect(end).toMatchObject({ type: "end", gesture: "drag" });
  });

  it("a rub stays a rub until release, wherever it goes", () => {
    const tracker = new GestureTracker();
    const samples = rub(40, 4);
    const first = samples[0];
    if (!first) throw new Error("no samples");
    tracker.down(first, BODY);
    for (const s of samples.slice(1)) tracker.move(s);
    expect(tracker.phase).toBe("rub");
    tracker.move(at(600, 300, 2000, false));
    expect(tracker.phase).toBe("rub");
  });

  it("reports the release velocity of a flick, in px/s", () => {
    const tracker = new GestureTracker();
    const samples = line(300, -150, 150);
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (!first || !last) throw new Error("no samples");
    tracker.down(first, BODY);
    for (const s of samples.slice(1, -1)) tracker.move(s);
    const end = tracker.up(last).at(-1);
    expect(end?.type).toBe("end");
    if (end?.type !== "end") return;
    expect(end.gesture).toBe("drag");
    expect(end.vx).toBeCloseTo(2000, -1);
    expect(end.vy).toBeCloseTo(-1000, -1);
  });

  it("a cancelled press ends without a throw", () => {
    const tracker = new GestureTracker();
    tracker.down(at(200, 300, 0), BODY);
    tracker.move(at(400, 300, 50));
    expect(tracker.cancel()).toEqual([{ type: "end", gesture: "drag", vx: 0, vy: 0 }]);
    expect(tracker.phase).toBe("idle");
    expect(tracker.cancel()).toEqual([]);
  });

  it("ignores moves and ticks with no press", () => {
    const tracker = new GestureTracker();
    expect(tracker.move(at(200, 300, 0))).toEqual([]);
    expect(tracker.tick(5000)).toEqual([]);
    expect(tracker.up(at(200, 300, 10))).toEqual([]);
  });
});

describe("releaseVelocity", () => {
  it("measures only the last moments of the move", () => {
    const samples = [at(0, 0, 0), at(500, 0, 50), at(510, 0, 60), at(520, 0, 70), at(530, 0, 80)];
    expect(releaseVelocity(samples, 30).vx).toBeCloseTo(1000, 0);
  });

  it("is zero when the finger had stopped before letting go", () => {
    const samples = [at(0, 0, 0), at(100, 0, 50), at(100, 0, 300)];
    expect(releaseVelocity(samples, 100)).toEqual({ vx: 0, vy: 0 });
  });

  it("is zero with a single sample", () => {
    expect(releaseVelocity([at(0, 0, 0)])).toEqual({ vx: 0, vy: 0 });
    expect(releaseVelocity([])).toEqual({ vx: 0, vy: 0 });
  });
});
