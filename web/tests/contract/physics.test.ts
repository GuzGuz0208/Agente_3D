/**
 * Play-mode physics of the slime (src/avatar/physics.ts): soft bounces against the
 * edges of the frame, the hits reported for the vibration, the frame from the
 * camera, and gravity from the tilt of the phone.
 */
import { describe, expect, it } from "vitest";
import {
  angleDelta,
  frameBox,
  gravityFromTilt,
  IMPACT_MAX_SPEED,
  IMPACT_MIN_SPEED,
  impactStrength,
  MAX_DEPTH,
  sphereLimit,
  stepSoftBody,
  uprightAngle,
  type Box,
  type Impact,
  type SoftBody,
  type StepParams,
} from "../../src/avatar/physics";

const R = 0.94;
const BOX: Box = { left: -3, right: 3, bottom: -2, top: 4 };
const DT = 1 / 60;

const body = (over: Partial<SoftBody> = {}): SoftBody => ({ x: 0, y: 1, vx: 0, vy: 0, touching: 0, ...over });

/** Runs `seconds` of simulation; returns every hit and the lowest / highest positions reached. */
function run(b: SoftBody, params: StepParams, seconds: number) {
  const hits: Impact[] = [];
  let minX = b.x;
  let maxX = b.x;
  let minY = b.y;
  let maxY = b.y;
  let rebound = 0;
  for (let t = 0; t < seconds; t += DT) {
    const result = stepSoftBody(b, params, DT);
    hits.push(...result.impacts);
    minX = Math.min(minX, b.x);
    maxX = Math.max(maxX, b.x);
    minY = Math.min(minY, b.y);
    maxY = Math.max(maxY, b.y);
    if (hits.length) rebound = Math.max(rebound, b.vy);
  }
  return { hits, minX, maxX, minY, maxY, rebound };
}

describe("impactStrength", () => {
  it("is zero for a touch and grows with the speed up to 1", () => {
    expect(impactStrength(0)).toBe(0);
    expect(impactStrength(IMPACT_MIN_SPEED)).toBe(0);
    const a = impactStrength(3);
    const b = impactStrength(6);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(impactStrength(IMPACT_MAX_SPEED)).toBe(1);
    expect(impactStrength(100)).toBe(1);
    expect(impactStrength(Number.NaN)).toBe(0);
  });
});

describe("stepSoftBody", () => {
  const falling: StepParams = { radius: R, gravity: { x: 0, y: -15 }, box: BOX };

  it("a body dropped to the floor hits it once, bounces lower and comes to rest on it", () => {
    const b = body({ y: 3 });
    const { hits, minY, rebound } = run(b, falling, 4);
    const first = hits[0];
    expect(first?.wall).toBe("bottom");
    expect(first?.normal).toEqual({ x: 0, y: 1 });
    expect(first?.strength).toBeGreaterThan(0.3);
    expect(first?.strength).toBeLessThanOrEqual(1);
    // It bounced back up, slower than it arrived (the jelly loses energy).
    expect(rebound).toBeGreaterThan(0.5);
    expect(rebound).toBeLessThan(first?.speed ?? 0);
    // Every later hit is weaker than the first.
    for (const hit of hits.slice(1)) expect(hit.strength).toBeLessThan(first?.strength ?? 0);
    // Sinks into the floor (the squash), never through it.
    expect(minY).toBeGreaterThan(BOX.bottom - MAX_DEPTH * R - 1e-9);
    // At rest: resting on the floor, still, still touching it.
    expect(Math.abs(b.vx) + Math.abs(b.vy)).toBeLessThan(0.05);
    expect(b.y).toBeLessThan(BOX.bottom + 0.01);
    expect(b.y).toBeGreaterThan(BOX.bottom - 0.05);
    expect(b.touching).not.toBe(0);
  });

  it("a slow touch is not a hit", () => {
    const b = body({ y: BOX.bottom + 0.01, vy: -0.5 });
    const { hits } = run(b, { ...falling, gravity: { x: 0, y: 0 } }, 1);
    expect(hits).toEqual([]);
  });

  it("resting on the floor reports nothing more", () => {
    const b = body({ y: 3 });
    run(b, falling, 4);
    const { hits } = run(b, falling, 2);
    expect(hits).toEqual([]);
  });

  it("gravity to the right slides it into the right edge", () => {
    const b = body({ y: BOX.bottom });
    const { hits, maxX } = run(b, { ...falling, gravity: { x: 15, y: 0 } }, 3);
    expect(hits.some((h) => h.wall === "right")).toBe(true);
    const right = hits.find((h) => h.wall === "right");
    expect(right?.normal).toEqual({ x: -1, y: 0 });
    expect(right?.point.x).toBeCloseTo(BOX.right + R, 0);
    expect(maxX).toBeLessThanOrEqual(BOX.right + MAX_DEPTH * R + 1e-9);
  });

  it("a very fast throw never goes through an edge, even with long frames", () => {
    const b = body({ x: 0, y: 1, vx: 60 });
    let maxX = b.x;
    for (let i = 0; i < 60; i++) {
      stepSoftBody(b, { radius: R, gravity: { x: 0, y: 0 }, box: BOX }, 1 / 30);
      maxX = Math.max(maxX, b.x);
    }
    expect(maxX).toBeLessThanOrEqual(BOX.right + MAX_DEPTH * R + 1e-9);
    expect(b.x).toBeLessThan(BOX.right + MAX_DEPTH * R);
  });

  it("reports the deepest contact as a fraction of the radius (the squash)", () => {
    const b = body({ y: BOX.bottom - 0.2 * R });
    const result = stepSoftBody(b, { radius: R, gravity: { x: 0, y: 0 }, box: BOX }, 1e-6);
    expect(result.contact?.wall).toBe("bottom");
    expect(result.contact?.depth).toBeCloseTo(0.2, 2);
    expect(stepSoftBody(body(), { radius: R, gravity: { x: 0, y: 0 }, box: BOX }, DT).contact).toBeNull();
  });

  it("a spring brings it home without walls, and it settles there", () => {
    const b = body({ x: 2, y: -1 });
    run(b, { radius: R, gravity: { x: 0, y: 0 }, box: null, spring: { x: 0, y: 1, stiffness: 55, damping: 7.5 } }, 4);
    expect(b.x).toBeCloseTo(0, 2);
    expect(b.y).toBeCloseTo(1, 2);
  });

  it("does nothing for a zero or invalid step", () => {
    const b = body({ vx: 1 });
    expect(stepSoftBody(b, falling, 0).impacts).toEqual([]);
    expect(stepSoftBody(b, falling, Number.NaN).impacts).toEqual([]);
    expect(b.x).toBe(0);
  });
});

describe("frameBox", () => {
  const view = { tanHalfFov: Math.tan((15 * Math.PI) / 180), aspect: 1.5, distance: 10, center: { x: 0, y: 1 } };
  const hh = 10 * Math.tan((15 * Math.PI) / 180);
  const hw = hh * 1.5;

  it("is centred on the point the camera looks at, inside the visible half-extents", () => {
    const box = frameBox(view, R);
    expect(box.left).toBeCloseTo(-box.right, 9);
    expect(box.bottom - 1).toBeCloseTo(-(box.top - 1), 9);
    // Perspective: off-centre the body looks a little wider, so it stops a little before hw - R.
    expect(box.right).toBeLessThan(hw - R);
    expect(box.right).toBeGreaterThan(hw - 1.25 * R);
    expect(box.top - 1).toBeLessThan(hh - R);
  });

  it("works for any shape of screen, upright or lying", () => {
    const upright = frameBox({ ...view, aspect: 390 / 844, distance: 20 }, R);
    const lying = frameBox({ ...view, aspect: 844 / 390, distance: 10 }, R);
    expect(upright.top - upright.bottom).toBeGreaterThan(upright.right - upright.left);
    expect(lying.right - lying.left).toBeGreaterThan(lying.top - lying.bottom);
  });

  it("only the visible part of the canvas counts", () => {
    const full = frameBox(view, R);
    const clipped = frameBox({ ...view, ndc: { left: -1, right: 0.5, bottom: -1, top: 1 } }, R);
    expect(clipped.right).toBeLessThan(full.right);
    expect(clipped.left).toBeCloseTo(full.left, 9);
  });

  it("takes the body's measured reach towards each edge", () => {
    const reach = { left: 1, right: 1.2, bottom: 0.9, top: 0.8 };
    const box = frameBox(view, reach);
    expect(box.right).toBeCloseTo(hw - 1.2, 9);
    expect(box.left).toBeCloseTo(-hw + 1, 9);
    expect(box.top).toBeCloseTo(1 + hh - 0.8, 9);
    expect(box.bottom).toBeCloseTo(1 - hh + 0.9, 9);
  });

  it("a frame smaller than the body keeps the centre in the middle", () => {
    const box = frameBox({ ...view, distance: 1 }, 3);
    expect(box.left).toBeLessThanOrEqual(box.right);
    expect(box.bottom).toBeLessThanOrEqual(box.top);
  });

  it("sphereLimit: the silhouette of a sphere at the limit just touches the edge", () => {
    const d = 10;
    const x = sphereLimit(4, d, 1);
    const edge = Math.atan(x / d) + Math.asin(1 / Math.hypot(x, d));
    expect(Math.tan(edge) * d).toBeCloseTo(4, 6);
  });
});

describe("gravityFromTilt", () => {
  const G = 15;

  it("upright pulls straight down; flat on a table, nothing", () => {
    expect(gravityFromTilt(0, 1, G)).toEqual({ x: 0, y: -G });
    const flat = gravityFromTilt(0, 0, G);
    expect(Math.hypot(flat.x, flat.y)).toBe(0);
  });

  it("tilted to the right pulls to the right", () => {
    expect(gravityFromTilt(1, 0, G)).toEqual({ x: G, y: -0 });
  });

  it("lets a shake through, but capped", () => {
    expect(gravityFromTilt(1.5, 0, G).x).toBeCloseTo(1.5 * G, 9);
    const spike = gravityFromTilt(40, -40, G);
    expect(Math.hypot(spike.x, spike.y)).toBeCloseTo(2 * G, 9);
    expect(gravityFromTilt(0, 3, G, 1)).toEqual({ x: 0, y: -G });
  });

  it("ignores values that are not numbers", () => {
    const g = gravityFromTilt(Number.NaN, Number.POSITIVE_INFINITY, G);
    expect(Math.hypot(g.x, g.y)).toBe(0);
  });
});

describe("orientation", () => {
  it("turns the base towards the gravity", () => {
    expect(uprightAngle({ x: 0, y: -1 })).toBeCloseTo(0, 9);
    expect(uprightAngle({ x: -1, y: 0 })).toBeCloseTo(-Math.PI / 2, 9);
    expect(uprightAngle({ x: 1, y: 0 })).toBeCloseTo(Math.PI / 2, 9);
    expect(Math.abs(uprightAngle({ x: 0, y: 1 }))).toBeCloseTo(Math.PI, 9);
  });

  it("takes the short way round", () => {
    expect(angleDelta(0, 0.5)).toBeCloseTo(0.5, 9);
    expect(angleDelta(3, -3)).toBeCloseTo(2 * Math.PI - 6, 9);
    expect(angleDelta(-3, 3)).toBeCloseTo(6 - 2 * Math.PI, 9);
    expect(Math.abs(angleDelta(0, 2 * Math.PI))).toBeCloseTo(0, 9);
  });
});
