/**
 * Play mode math (src/scripts/play-mode.ts): device orientation to gravity in
 * screen space for every screen rotation, the shake push, the low-pass filter,
 * the dead zone, the vibration curve and the rate limit of `setTilt`.
 *
 * Angles follow the W3C DeviceOrientation frame: beta > 0 lifts the top edge,
 * gamma > 0 lowers the right edge. Screen space: x to the right, y downwards.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TUNING,
  UPRIGHT,
  VIBRATION,
  ZERO,
  buzzFor,
  clampUnit,
  createThrottle,
  deadZone,
  gravityFromOrientation,
  lowPass,
  mixTilt,
  normalizeAngle,
  pushFromMotion,
  toScreen,
  vibrationMs,
  type Vec2,
} from "../../src/scripts/play-mode";

const close = (actual: Vec2, expected: Vec2, digits = 6): void => {
  expect(actual.x).toBeCloseTo(expected.x, digits);
  expect(actual.y).toBeCloseTo(expected.y, digits);
};

const length = (v: Vec2): number => Math.hypot(v.x, v.y);

describe("normalizeAngle", () => {
  it.each([
    [0, 0],
    [90, 90],
    [180, 180],
    [270, 270],
    [-90, 270], // legacy window.orientation: rotated clockwise
    [360, 0],
    [450, 90],
    [89, 90],
    [-180, 180],
  ])("%s° -> %s", (input, expected) => {
    expect(normalizeAngle(input)).toBe(expected);
  });

  it("falls back to the natural orientation without data", () => {
    expect(normalizeAngle(undefined)).toBe(0);
    expect(normalizeAngle(null)).toBe(0);
    expect(normalizeAngle(Number.NaN)).toBe(0);
  });
});

describe("toScreen", () => {
  const v = { x: 0.3, y: 0.8 };

  it("keeps the vector in the natural orientation", () => {
    expect(toScreen(v, 0)).toEqual(v);
  });

  it("rotates a quarter turn at a time and comes back after a full turn", () => {
    expect(toScreen(v, 90)).toEqual({ x: 0.8, y: -0.3 });
    expect(toScreen(v, 180)).toEqual({ x: -0.3, y: -0.8 });
    expect(toScreen(v, 270)).toEqual({ x: -0.8, y: 0.3 });
    expect(toScreen(toScreen(toScreen(toScreen(v, 90), 90), 90), 90)).toEqual(v);
  });

  it("never returns -0", () => {
    const r = toScreen({ x: 0, y: 0 }, 180);
    expect(Object.is(r.x, 0) && Object.is(r.y, 0)).toBe(true);
  });
});

describe("gravityFromOrientation", () => {
  describe("portrait (angle 0)", () => {
    it("flat on a table: no gravity on the screen plane", () => {
      close(gravityFromOrientation(0, 0, 0), ZERO);
    });

    it("held upright: falls to the bottom edge", () => {
      close(gravityFromOrientation(90, 0, 0), { x: 0, y: 1 });
    });

    it("right edge lowered: falls to the right", () => {
      const g = gravityFromOrientation(0, 30, 0);
      expect(g.x).toBeCloseTo(0.5, 6);
      expect(g.y).toBeCloseTo(0, 6);
    });

    it("left edge lowered: falls to the left", () => {
      expect(gravityFromOrientation(0, -30, 0).x).toBeCloseTo(-0.5, 6);
    });

    it("top edge towards the floor: falls to the top", () => {
      expect(gravityFromOrientation(-20, 0, 0).y).toBeLessThan(0);
    });

    it("reading pose with a sideways tilt: down and to the side", () => {
      const right = gravityFromOrientation(45, 20, 0);
      expect(right.x).toBeGreaterThan(0);
      expect(right.y).toBeCloseTo(Math.SQRT1_2, 6);
      expect(gravityFromOrientation(45, -20, 0).x).toBeLessThan(0);
    });

    it("upright and turned like a steering wheel (gimbal pole): still the true direction", () => {
      // Device turned 30° counter-clockwise while upright: beta = 60, gamma = -90.
      close(gravityFromOrientation(60, -90, 0), { x: -0.5, y: Math.sqrt(3) / 2 });
      expect(length(gravityFromOrientation(60, -90, 0))).toBeCloseTo(1, 6);
    });

    it("never exceeds unit length", () => {
      for (let beta = -180; beta < 180; beta += 15) {
        for (let gamma = -90; gamma < 90; gamma += 15) {
          expect(length(gravityFromOrientation(beta, gamma, 0))).toBeLessThanOrEqual(1 + 1e-9);
        }
      }
    });
  });

  describe("landscape, device turned counter-clockwise (angle 90, top edge on the left)", () => {
    it("held upright: falls to the bottom of the screen", () => {
      // The device's left edge points at the floor: gamma = -90.
      close(gravityFromOrientation(0, -90, 90), { x: 0, y: 1 });
    });

    it("right side of the screen lowered: falls to the right", () => {
      // The screen's right is the device's bottom edge: lowering it lifts the top, beta > 0.
      const g = gravityFromOrientation(20, -70, 90);
      expect(g.x).toBeGreaterThan(0);
      expect(g.y).toBeGreaterThan(0.8);
    });

    it("left side of the screen lowered: falls to the left", () => {
      expect(gravityFromOrientation(-20, -70, 90).x).toBeLessThan(0);
    });
  });

  describe("landscape, device turned clockwise (angle 270, top edge on the right)", () => {
    it("held upright: falls to the bottom of the screen", () => {
      close(gravityFromOrientation(0, 90, 270), { x: 0, y: 1 });
    });

    it("right side of the screen lowered: falls to the right", () => {
      // The screen's right is the device's top edge: lowering it gives beta < 0.
      const g = gravityFromOrientation(-20, 70, 270);
      expect(g.x).toBeGreaterThan(0);
      expect(g.y).toBeGreaterThan(0.8);
    });

    it("left side of the screen lowered: falls to the left", () => {
      expect(gravityFromOrientation(20, 70, 270).x).toBeLessThan(0);
    });
  });

  describe("portrait upside down (angle 180)", () => {
    it("held upright (device top edge down): falls to the bottom of the screen", () => {
      close(gravityFromOrientation(-90, 0, 180), { x: 0, y: 1 });
    });

    it("screen's right side lowered (the device's left edge): falls to the right", () => {
      expect(gravityFromOrientation(0, -30, 180).x).toBeCloseTo(0.5, 6);
    });
  });

  it("the same physical pose gives the same screen gravity whatever the rotation reports", () => {
    // Upright in each rotation, every one must read as "down".
    close(gravityFromOrientation(90, 0, 0), UPRIGHT);
    close(gravityFromOrientation(0, -90, 90), UPRIGHT);
    close(gravityFromOrientation(-90, 0, 180), UPRIGHT);
    close(gravityFromOrientation(0, 90, 270), UPRIGHT);
  });
});

describe("pushFromMotion", () => {
  it("a jerk to the right throws the slime to the left", () => {
    close(pushFromMotion(15, 0, 0), { x: -1, y: 0 });
  });

  it("lifting the phone throws the slime to the bottom", () => {
    close(pushFromMotion(0, 15, 0), { x: 0, y: 1 });
  });

  it("follows the screen rotation", () => {
    // Angle 90: the device's right edge points up, so a jerk along +x lifts the screen.
    close(pushFromMotion(15, 0, 90), { x: 0, y: 1 });
    close(pushFromMotion(15, 0, 270), { x: 0, y: -1 });
  });

  it("is proportional and clamped to the unit square", () => {
    close(pushFromMotion(-7.5, 0, 0), { x: 0.5, y: 0 });
    close(pushFromMotion(-60, 60, 0), { x: 1, y: 1 });
  });
});

describe("lowPass", () => {
  it("lets the first sample through", () => {
    expect(lowPass(null, { x: 0.4, y: -0.2 }, 16, 90)).toEqual({ x: 0.4, y: -0.2 });
  });

  it("moves 63% of the way after one time constant", () => {
    const out = lowPass({ x: 0, y: 0 }, { x: 1, y: -1 }, 90, 90);
    expect(out.x).toBeCloseTo(1 - Math.exp(-1), 6);
    expect(out.y).toBeCloseTo(-(1 - Math.exp(-1)), 6);
  });

  it("does not move with no elapsed time, nor with a negative one", () => {
    expect(lowPass({ x: 0.2, y: 0.2 }, { x: 1, y: 1 }, 0, 90)).toEqual({ x: 0.2, y: 0.2 });
    expect(lowPass({ x: 0.2, y: 0.2 }, { x: 1, y: 1 }, -5, 90)).toEqual({ x: 0.2, y: 0.2 });
  });

  it("does not depend on the event rate", () => {
    const target = { x: 1, y: 0 };
    let fast: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < 6; i++) fast = lowPass(fast, target, 10, 90);
    const slow = lowPass({ x: 0, y: 0 }, target, 60, 90);
    close(fast, slow, 9);
  });

  it("converges to a steady reading and smooths a jittery one", () => {
    let v: Vec2 = { x: 0, y: 0 };
    for (let i = 0; i < 200; i++) v = lowPass(v, { x: 0.5, y: 0.5 }, 16, 90);
    close(v, { x: 0.5, y: 0.5 }, 4);
    // ±0.1 jitter at 60 Hz comes out much smaller.
    let s: Vec2 = { x: 0, y: 0 };
    let worst = 0;
    for (let i = 0; i < 120; i++) {
      s = lowPass(s, { x: i % 2 ? 0.1 : -0.1, y: 0 }, 16, 90);
      if (i > 30) worst = Math.max(worst, Math.abs(s.x));
    }
    expect(worst).toBeLessThan(0.02);
  });
});

describe("deadZone", () => {
  it("is zero inside the zone", () => {
    expect(deadZone({ x: 0.03, y: -0.03 }, 0.06)).toEqual(ZERO);
    expect(deadZone(ZERO, 0.06)).toEqual(ZERO);
  });

  it("starts from zero on the edge (no jump) and keeps 1 at 1", () => {
    expect(length(deadZone({ x: 0.0601, y: 0 }, 0.06))).toBeLessThan(0.001);
    close(deadZone({ x: 0, y: 1 }, 0.06), { x: 0, y: 1 });
  });

  it("keeps the direction", () => {
    const out = deadZone({ x: 0.3, y: 0.4 }, 0.06);
    expect(out.x / out.y).toBeCloseTo(0.75, 6);
  });
});

describe("mixTilt and clampUnit", () => {
  it("adds the push to the scaled gravity and clamps to -1..1", () => {
    close(mixTilt({ x: 0.2, y: 0.8 }, { x: 0.5, y: 0.5 }), { x: 0.7, y: 1 });
    close(mixTilt({ x: 0.2, y: 0.8 }, ZERO, 0.5), { x: 0.1, y: 0.4 });
  });

  it("clamps each axis", () => {
    expect(clampUnit({ x: 3, y: -3 })).toEqual({ x: 1, y: -1 });
    expect(clampUnit({ x: Number.NaN, y: 0.5 })).toEqual({ x: 0, y: 0.5 });
  });

  it("the gentle gain matches the reduced-motion setting", () => {
    expect(TUNING.gentleGain).toBeGreaterThan(0);
    expect(TUNING.gentleGain).toBeLessThan(1);
  });
});

describe("vibration", () => {
  it("is not felt below the threshold", () => {
    expect(vibrationMs(0)).toBe(0);
    expect(vibrationMs(VIBRATION.threshold / 2)).toBe(0);
    expect(vibrationMs(Number.NaN)).toBe(0);
  });

  it("goes from 10 ms to 40 ms with the strength, and never beyond", () => {
    expect(vibrationMs(VIBRATION.threshold)).toBe(10);
    expect(vibrationMs(1)).toBe(40);
    expect(vibrationMs(5)).toBe(40);
    expect(vibrationMs(0.3)).toBeGreaterThan(vibrationMs(0.2));
  });

  it("waits for the cooldown between buzzes", () => {
    expect(buzzFor(1, 1000, -Infinity)).toBe(40);
    expect(buzzFor(1, 1000 + VIBRATION.cooldownMs - 1, 1000)).toBe(0);
    expect(buzzFor(1, 1000 + VIBRATION.cooldownMs, 1000)).toBe(40);
  });
});

describe("createThrottle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first value at once and at most one per interval after that, the last one always", () => {
    vi.useFakeTimers();
    let t = 0;
    const sent: number[] = [];
    const throttle = createThrottle<number>((v) => sent.push(v), 20, () => t);
    const advance = (ms: number): void => {
      t += ms;
      vi.advanceTimersByTime(ms);
    };

    throttle.push(1);
    expect(sent).toEqual([1]);
    advance(5);
    throttle.push(2);
    advance(5);
    throttle.push(3); // replaces 2 while waiting
    expect(sent).toEqual([1]);
    advance(10);
    expect(sent).toEqual([1, 3]);

    // 60 Hz input for one second: at most 50 Hz output.
    for (let i = 0; i < 60; i++) {
      throttle.push(100 + i);
      advance(1000 / 60);
    }
    advance(50);
    expect(sent.length - 2).toBeLessThanOrEqual(51);
    expect(sent[sent.length - 1]).toBe(159);
  });

  it("cancel drops the pending value", () => {
    vi.useFakeTimers();
    let t = 0;
    const sent: number[] = [];
    const throttle = createThrottle<number>((v) => sent.push(v), 20, () => t);
    throttle.push(1);
    throttle.push(2);
    throttle.cancel();
    t += 50;
    vi.advanceTimersByTime(50);
    expect(sent).toEqual([1]);
  });

  it("the configured rate stays within 30–60 Hz", () => {
    expect(TUNING.maxHz).toBeGreaterThanOrEqual(30);
    expect(TUNING.maxHz).toBeLessThanOrEqual(60);
  });
});
