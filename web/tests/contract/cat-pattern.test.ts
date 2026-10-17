/**
 * The tabby pattern of the cat slime (src/avatar/cat.ts): stripes on the forehead, the flanks
 * and the back, never on the face itself (eyes, cheeks, mouth), and a pale muzzle only in front.
 */
import { describe, expect, it } from "vitest";
import { muzzleAt, stripeAt } from "../../src/avatar/cat";

/** A unit direction from azimuth (0 is the face, positive to the right) and height y. */
const dir = (azimuth: number, y: number): [number, number, number] => {
  const r = Math.sqrt(1 - y * y);
  return [Math.sin(azimuth) * r, y, Math.cos(azimuth) * r];
};

describe("tabby stripes", () => {
  it("draws three marks on the forehead", () => {
    expect(stripeAt(...dir(0, 0.75))).toBeGreaterThan(0.9);
    expect(stripeAt(...dir(-0.3, 0.76))).toBeGreaterThan(0.5);
    expect(stripeAt(...dir(0.3, 0.76))).toBeGreaterThan(0.5);
  });

  it("keeps the face clear: eyes, cheeks and mouth", () => {
    for (const [azimuth, y] of [
      [0, 0.15],
      [0.3, 0.15],
      [-0.3, 0.15],
      [0.5, -0.05],
      [-0.5, -0.05],
      [0, -0.08],
      [0, 0.4],
    ] as const) {
      expect(stripeAt(...dir(azimuth, y))).toBe(0);
    }
  });

  it("stripes the flanks and the back", () => {
    expect(stripeAt(...dir(Math.PI, 0.6))).toBeGreaterThan(0.9);
    expect(stripeAt(...dir(1.72 + 0.3 * 0.38, 0.4))).toBeGreaterThan(0.5);
  });

  it("leaves the very top and the base plain", () => {
    expect(stripeAt(0, 1, 0)).toBe(0);
    expect(stripeAt(...dir(Math.PI, -0.6))).toBe(0);
  });
});

describe("pale muzzle", () => {
  it("is round the mouth, in front only", () => {
    expect(muzzleAt(...dir(0, -0.1))).toBeGreaterThan(0.9);
    expect(muzzleAt(...dir(Math.PI, -0.1))).toBe(0);
    expect(muzzleAt(...dir(0, 0.6))).toBe(0);
  });
});
