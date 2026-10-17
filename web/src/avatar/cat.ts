/**
 * Cat parts of the slime's `gato` look: tabby stripes painted on the jelly, two round
 * cat ears with a pink inside, a tail that sways with the state, a small nose over a
 * "ω" mouth and a few soft whiskers. The design is original: a lavender-grey jelly
 * cat, round and calm like the pink slime, not a copy of any game character.
 *
 * Only parts and their motion live here; the body, the face, the physics and every
 * gesture stay in `slime.ts`, so the cat does everything the pink slime does.
 *
 * Body language added by the ears and the tail (same states as the slime):
 *   connecting / renewing  ears relaxed, tail wrapped round the foot -> asleep
 *   listening              ears straight up, tail high               -> your turn
 *   thinking               one ear turns aside, tail tip curls ("?")  -> searching
 *   speaking               ears up, tail sways fast with the voice   -> talking
 *   error                  ears flat out to the sides, tail on floor -> it failed
 * The conversation face moves them too (`CAT_FACES`): up when happy or surprised,
 * down when concerned or sad, one up one down when confused.
 *
 * Everything is in the slime's `rig` space, so the parts squash, stretch, roll and
 * melt with the body. `reachPoints` gives the ear tips and the tail to the play-mode
 * frame, so neither ever crosses the edges of the screen.
 */
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Group,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  SRGBColorSpace,
  Vector2,
  Vector3,
} from "three";
import type { AvatarExpression, AvatarState } from "./types";

// --- Look -------------------------------------------------------------------

export interface CatLook {
  /** Tabby stripes, the pale muzzle, the inside of the ears and the nose. */
  stripe: number;
  muzzle: number;
  innerEar: number;
  nose: number;
  /** Where the ears sit (u, v of the surface normal), their size and outward lean (radians). */
  ear: { u: number; v: number; width: number; height: number; tilt: number };
  /** The tail: where it leaves the body (rig space), its length and thickness at the root and tip. */
  tail: { root: readonly [number, number, number]; length: number; radius: number; tipRadius: number };
  /** Opacity of the whiskers; 0 draws none. */
  whiskers: number;
}

// --- Stripes ----------------------------------------------------------------

const clamp = MathUtils.clamp;
const lerp = MathUtils.lerp;
const smooth01 = (t: number): number => t * t * (3 - 2 * t);
const smoothstep = (a: number, b: number, x: number): number => smooth01(clamp((x - a) / (b - a), 0, 1));
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/** One tabby stripe: a tapering band down the body from the crown, along azimuth `at` (0 is the face). */
interface StripeMark {
  at: number;
  /** Heights (unit-sphere y) where it starts and where it has thinned out. */
  top: number;
  bottom: number;
  /** Half-width at its widest, in surface units of the unit sphere. */
  width: number;
  /** How far it sweeps backwards as it goes down (radians per unit of height). */
  sweep: number;
}

/**
 * Three short marks on the forehead, between the ears; long, sweeping stripes on the flanks
 * and the back. Nothing on the face itself, and nothing on the very top, where every band
 * would meet in a dark cap.
 */
const STRIPES: readonly StripeMark[] = (() => {
  const marks: StripeMark[] = [{ at: 0, top: 0.9, bottom: 0.56, width: 0.05, sweep: 0 }];
  for (const side of [-1, 1] as const) {
    marks.push(
      { at: side * 0.3, top: 0.86, bottom: 0.64, width: 0.04, sweep: side * -0.25 },
      { at: side * 1.14, top: 0.66, bottom: 0.08, width: 0.07, sweep: side * 0.34 },
      { at: side * 1.72, top: 0.78, bottom: -0.12, width: 0.08, sweep: side * 0.3 },
      { at: side * 2.15, top: 0.82, bottom: 0.0, width: 0.08, sweep: side * 0.25 },
      { at: side * 2.62, top: 0.86, bottom: 0.18, width: 0.07, sweep: side * 0.18 },
    );
  }
  marks.push({ at: Math.PI, top: 0.9, bottom: 0.25, width: 0.075, sweep: 0 });
  return marks;
})();

/** 0 .. 1: how much stripe there is in the direction (x, y, z) of the unit sphere. */
export function stripeAt(x: number, y: number, z: number): number {
  const azimuth = Math.atan2(x, z);
  const ring = Math.sqrt(Math.max(0, 1 - y * y));
  let out = 0;
  for (const s of STRIPES) {
    if (y > s.top + 0.04 || y < s.bottom - 0.04) continue;
    // Round, tapering ends: widest a third of the way down, a point at the bottom.
    const u = clamp((s.top - y) / (s.top - s.bottom), 0, 1);
    const taper = smoothstep(0, 0.22, u) ** 0.6 * (1 - smoothstep(0.35, 1, u)) ** 0.8;
    const half = s.width * taper;
    if (half <= 1e-4) continue;
    const centre = s.at + s.sweep * (s.top - y) + 0.05 * Math.sin(y * 9 + s.at * 3);
    const dist = Math.abs(wrapAngle(azimuth - centre)) * ring;
    const v = 1 - smoothstep(half * 0.45, half, dist);
    if (v > out) out = v;
  }
  return out;
}

/**
 * The stripes as a map for the body (multiplied over the vertex colours): white where there
 * is no stripe, and the ratio stripe / body where there is, so the stripe keeps the body's
 * own shading and its gradient towards the floor. Laid out like a SphereGeometry's UVs.
 */
export function paintStripes(body: number, stripe: number, strength = 0.85): CanvasTexture {
  const width = 512;
  const height = 256;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const b = new Color(body);
    const s = new Color(stripe);
    // Ratio in sRGB: close to the same ratio in linear light, since the transfer curve is roughly a power.
    const ratio = [s.r / Math.max(1e-3, b.r), s.g / Math.max(1e-3, b.g), s.b / Math.max(1e-3, b.b)].map((k) => clamp(k, 0, 1));
    const image = ctx.createImageData(width, height);
    const data = image.data;
    for (let row = 0; row < height; row++) {
      const theta = ((row + 0.5) / height) * Math.PI;
      const y = Math.cos(theta);
      const r = Math.sin(theta);
      for (let col = 0; col < width; col++) {
        const phi = ((col + 0.5) / width) * Math.PI * 2;
        // SphereGeometry: x = -cos(phi) sin(theta), z = sin(phi) sin(theta).
        const m = stripeAt(-Math.cos(phi) * r, y, Math.sin(phi) * r) * strength;
        const i = (row * width + col) * 4;
        data[i] = Math.round(255 * lerp(1, ratio[0] ?? 1, m));
        data[i + 1] = Math.round(255 * lerp(1, ratio[1] ?? 1, m));
        data[i + 2] = Math.round(255 * lerp(1, ratio[2] ?? 1, m));
        data[i + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/** How much of the pale muzzle is at the direction (x, y, z): a soft oval round the mouth and chin. */
export function muzzleAt(x: number, y: number, z: number): number {
  if (z <= 0) return 0;
  const dx = x / 0.36;
  const dy = (y + 0.1) / 0.26;
  return (1 - smoothstep(0.55, 1, Math.hypot(dx, dy))) * smoothstep(0.3, 0.7, z);
}

// --- Moods ------------------------------------------------------------------

/** What the state does to the ears and the tail. */
interface CatMood {
  /** -1 flat out to the sides .. 0 relaxed .. 1 straight up. */
  ear: number;
  /** 0 .. 1: one ear turned aside (listening around). */
  earAsym: number;
  /** 0 on the floor .. 1 held high. */
  tailUp: number;
  /** Curl of the tip: 0 straight .. 1 a "?" hook. */
  curl: number;
  /** Sways per second, and how wide. */
  hz: number;
  amp: number;
  /** 0 .. 1: wrapped round the foot, as cats sleep. */
  wrap: number;
}

const CAT_MOODS: Record<AvatarState, CatMood> = {
  idle: { ear: 0.25, earAsym: 0, tailUp: 0.75, curl: 0.55, hz: 0.32, amp: 0.55, wrap: 0 },
  connecting: { ear: -0.35, earAsym: 0, tailUp: 0.2, curl: 0.3, hz: 0.18, amp: 0.15, wrap: 1 },
  listening: { ear: 1, earAsym: 0, tailUp: 1, curl: 0.45, hz: 0.45, amp: 0.45, wrap: 0 },
  thinking: { ear: 0.45, earAsym: 1, tailUp: 0.85, curl: 1, hz: 0.22, amp: 0.4, wrap: 0 },
  speaking: { ear: 0.55, earAsym: 0, tailUp: 0.9, curl: 0.5, hz: 1.35, amp: 0.85, wrap: 0 },
  renewing: { ear: -0.15, earAsym: 0.4, tailUp: 0.4, curl: 0.4, hz: 0.25, amp: 0.3, wrap: 0.55 },
  error: { ear: -1, earAsym: 0, tailUp: 0, curl: 0.15, hz: 0.12, amp: 0.12, wrap: 0 },
};

/** The conversation face adds to the ears and the tail (weighted by how much of the face shows). */
interface CatFace {
  ear: number;
  earAsym: number;
  tailUp: number;
  hz: number;
  amp: number;
}

const QUIET: CatFace = { ear: 0, earAsym: 0, tailUp: 0, hz: 0, amp: 0 };

const CAT_FACES: Record<AvatarExpression, CatFace> = {
  neutral: QUIET,
  happy: { ...QUIET, ear: 0.3, tailUp: 0.15, hz: 0.25, amp: 0.15 },
  joyful: { ...QUIET, ear: 0.55, tailUp: 0.25, hz: 0.7, amp: 0.3 },
  calm: { ...QUIET, ear: -0.2, hz: -0.1 },
  focused: { ...QUIET, ear: 0.6, amp: -0.2 },
  surprised: { ...QUIET, ear: 1, tailUp: 0.25, amp: -0.25 },
  concerned: { ...QUIET, ear: -0.55, tailUp: -0.3, amp: -0.2 },
  sad: { ...QUIET, ear: -1.1, tailUp: -0.7, hz: -0.15, amp: -0.3 },
  confused: { ...QUIET, ear: 0.1, earAsym: 1, tailUp: -0.1 },
};

const MOOD_KEYS = Object.keys(CAT_MOODS.idle) as Array<keyof CatMood>;
const FACE_KEYS = Object.keys(QUIET) as Array<keyof CatFace>;

/** Everything the parts need from the slime this frame. */
export interface CatFrame {
  t: number;
  dt: number;
  /** 0.25 with reduced motion .. 1. */
  motion: number;
  reduced: boolean;
  state: AvatarState;
  expression: AvatarExpression;
  /** 0 .. 1: how much of the conversation face shows in this state. */
  expr: number;
  /** 0 .. 1: mouth movement of the voice right now. */
  voice: number;
  /** Speed of the jelly spring (up is positive): the ears trail it. */
  bounce: number;
  /** 0 .. 1 reactions of the slime. */
  melt: number;
  giggle: number;
  ouch: number;
  pet: number;
  flight: number;
  /** Looking at the orb before eating it, and pleased after. */
  eatLook: number;
  eatSat: number;
}

/** What the parts need from the slime once, when they are built. */
export interface CatHost {
  rig: Group;
  mouthAnchor: Group;
  /** The two cheek anchors (left, right): the whiskers ride on them. */
  cheeks: ReadonlyArray<{ side: -1 | 1; anchor: Object3D }>;
  /** The slime's own gel, to copy for the ears and the tail (without the stripe map). */
  gel: MeshPhysicalMaterial;
  body: number;
  bodyDeep: number;
  /** Puts an object on the body surface at the normal (u, v), facing out. */
  place(object: Object3D, u: number, v: number, lift?: number): void;
  /** Moves a face piece with the melting surface; `slip` slides it further down. */
  meltPlace(object: Object3D, slip?: number): void;
  /** Registers something to dispose with the slime. */
  own<T extends { dispose(): void }>(item: T): T;
}

// --- Geometry ---------------------------------------------------------------

/** A cat ear: a soft cone, round at the tip, flattened front to back. Its base sinks into the body. */
function earGeometry(width: number, height: number, base: Color, tip: Color): LatheGeometry {
  const profile: Array<[number, number]> = [
    [1, -0.32],
    [1, 0],
    [0.97, 0.16],
    [0.88, 0.34],
    [0.72, 0.53],
    [0.52, 0.71],
    [0.32, 0.86],
    [0.15, 0.96],
    [0, 1],
  ];
  const geometry = new LatheGeometry(
    profile.map(([r, y]) => new Vector2(r * width, y * height)),
    32,
  );
  const position = geometry.getAttribute("position") as BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const c = new Color();
  for (let i = 0; i < position.count; i++) {
    c.copy(base).lerp(tip, smoothstep(0.45, 1, position.getY(i) / height));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

/** The nose: a small rounded triangle, point down. */
function noseGeometry(): ShapeGeometry {
  const w = 0.03;
  const h = 0.022;
  const r = 0.008;
  const shape = new Shape();
  shape.moveTo(-w + r, h);
  shape.lineTo(w - r, h);
  shape.quadraticCurveTo(w, h, w - r * 0.6, h - r * 0.9);
  shape.lineTo(r * 0.7, -h + r * 0.6);
  shape.quadraticCurveTo(0, -h - r * 0.2, -r * 0.7, -h + r * 0.6);
  shape.lineTo(-w + r * 0.6, h - r * 0.9);
  shape.quadraticCurveTo(-w, h, -w + r, h);
  return new ShapeGeometry(shape, 8);
}

const TAIL_SEGMENTS = 36;
const TAIL_SIDES = 14;

/**
 * The tail: a tube along a curve that is rebuilt every frame, so it can bend and sway
 * like a real tail (a wave runs from the root to the tip), with a round cap at the tip.
 * The root is buried in the body, so it needs no cap.
 */
class TailTube {
  readonly mesh: Mesh;
  readonly tip: Mesh;
  /** The curve, in rig space; written by the caller before `update`. */
  readonly spine: Vector3[] = Array.from({ length: TAIL_SEGMENTS + 1 }, () => new Vector3());
  private readonly geometry = new BufferGeometry();
  private readonly position: BufferAttribute;
  private readonly normal: BufferAttribute;
  private readonly radii: number[];
  private readonly tangent = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();

  constructor(material: MeshPhysicalMaterial, radius: number, tipRadius: number, colorAt: (s: number) => Color) {
    const rings = TAIL_SEGMENTS + 1;
    const ringSize = TAIL_SIDES + 1;
    this.position = new BufferAttribute(new Float32Array(rings * ringSize * 3), 3);
    this.normal = new BufferAttribute(new Float32Array(rings * ringSize * 3), 3);
    this.position.setUsage(DynamicDrawUsage);
    this.normal.setUsage(DynamicDrawUsage);
    const colors = new Float32Array(rings * ringSize * 3);
    this.radii = [];
    for (let i = 0; i < rings; i++) {
      const s = i / TAIL_SEGMENTS;
      // Thick at the root, a slight bulge in the middle, rounder again near the tip.
      this.radii.push(lerp(radius, tipRadius, smoothstep(0, 1, s)) * (1 + 0.06 * Math.sin(s * Math.PI)));
      const c = colorAt(s);
      for (let j = 0; j < ringSize; j++) colors.set([c.r, c.g, c.b], (i * ringSize + j) * 3);
    }
    const index: number[] = [];
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      for (let j = 0; j < TAIL_SIDES; j++) {
        const a = i * ringSize + j;
        const b = a + ringSize;
        // Counter-clockwise seen from outside: the normals point out of the tube.
        index.push(a, a + 1, b, b, a + 1, b + 1);
      }
    }
    this.geometry.setAttribute("position", this.position);
    this.geometry.setAttribute("normal", this.normal);
    this.geometry.setAttribute("color", new BufferAttribute(colors, 3));
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false; // rewritten every frame
    const tipGeometry = new SphereGeometry(1, 18, 12);
    const tipColor = colorAt(1);
    const tipColors = new Float32Array(tipGeometry.getAttribute("position").count * 3);
    for (let i = 0; i < tipColors.length; i += 3) tipColors.set([tipColor.r, tipColor.g, tipColor.b], i);
    tipGeometry.setAttribute("color", new BufferAttribute(tipColors, 3));
    this.tip = new Mesh(tipGeometry, material);
    this.tip.frustumCulled = false;
  }

  /** Rebuilds the tube round `spine`; `planeNormal` is the normal of the plane the curve lies in. */
  update(planeNormal: Vector3): void {
    const out = this.position.array as Float32Array;
    const outN = this.normal.array as Float32Array;
    const n = TAIL_SEGMENTS;
    for (let i = 0; i <= n; i++) {
      const prev = this.spine[Math.max(0, i - 1)] as Vector3;
      const next = this.spine[Math.min(n, i + 1)] as Vector3;
      const p = this.spine[i] as Vector3;
      this.tangent.subVectors(next, prev).normalize();
      // The curve is planar: the plane normal and its cross with the tangent frame every ring.
      this.side.crossVectors(planeNormal, this.tangent).normalize();
      this.up.crossVectors(this.tangent, this.side).normalize();
      const r = this.radii[i] ?? 0.05;
      for (let j = 0; j <= TAIL_SIDES; j++) {
        const a = (j / TAIL_SIDES) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        const nx = this.side.x * c + this.up.x * s;
        const ny = this.side.y * c + this.up.y * s;
        const nz = this.side.z * c + this.up.z * s;
        const k = (i * (TAIL_SIDES + 1) + j) * 3;
        out[k] = p.x + nx * r;
        out[k + 1] = p.y + ny * r;
        out[k + 2] = p.z + nz * r;
        outN[k] = nx;
        outN[k + 1] = ny;
        outN[k + 2] = nz;
      }
    }
    this.position.needsUpdate = true;
    this.normal.needsUpdate = true;
    const end = this.spine[n] as Vector3;
    this.tip.position.copy(end);
    this.tip.scale.setScalar(this.radii[n] ?? 0.05);
  }

  dispose(): void {
    this.geometry.dispose();
    this.tip.geometry.dispose();
  }
}

// --- Parts ------------------------------------------------------------------

interface EarRig {
  side: -1 | 1;
  /** On the body surface; turned by the mood. */
  anchor: Group;
  /** The ear itself (outside and inside), scaled by how perked up it is. */
  ear: Group;
  /** A twitch now and then, decaying; and its phase. */
  flick: number;
  phase: number;
  /** Eased lean outward, backward lean, and height. */
  tilt: number;
  back: number;
  stand: number;
}

/** A tail pose: where it leaves the body, the plane it lies in and how it bends. */
interface TailPose {
  root: Vector3;
  /** Turn of the plane round the vertical, radians (0 points the tail straight right). */
  yaw: number;
  /** 0: the plane stands upright .. 1: it lies on the floor (the tail wraps round the foot). */
  lie: number;
  /** Angle of the tail where it leaves the body, in its plane; then its bend and the extra bend of the tip. */
  start: number;
  bend: number;
  curl: number;
}

export class CatParts {
  private readonly ears: EarRig[] = [];
  private readonly tail: TailTube;
  private readonly fur: MeshPhysicalMaterial;
  private readonly nose: Mesh;
  private readonly whiskers: Mesh[] = [];
  private readonly whiskerMaterial: MeshBasicMaterial | null = null;
  private readonly mood: CatMood = { ...CAT_MOODS.idle };
  private readonly face: CatFace = { ...QUIET };
  private readonly poses: { high: TailPose; low: TailPose; wrapped: TailPose };
  private readonly pose: TailPose;
  private readonly planeNormal = new Vector3();
  private readonly e1 = new Vector3();
  private readonly e2 = new Vector3();
  private readonly fwd = new Vector3();
  private readonly tmp = new Vector3();
  private flickIn = 3;
  /** The phase of the sway: integrated, so a change of speed never makes it jump. */
  private swayPhase = 0;
  private hz = 0.3;
  private amp = 0.4;
  private perk = 0.25;

  constructor(
    private readonly look: CatLook,
    private readonly host: CatHost,
  ) {
    const own = host.own.bind(host);
    // The ears and the tail: the same gel as the body, without the stripe map (they carry their own colours).
    this.fur = own(host.gel.clone());
    this.fur.map = null;

    const body = new Color(host.body);
    const stripe = new Color(look.stripe);

    // Ears
    const { ear } = look;
    const outer = own(earGeometry(ear.width, ear.height, body, body.clone().lerp(stripe, 0.55)));
    const inner = own(earGeometry(ear.width * 0.6, ear.height * 0.66, new Color(look.innerEar), new Color(look.innerEar).lerp(new Color(0xffffff), 0.2)));
    const innerMaterial = own(
      new MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55, emissive: new Color(look.innerEar), emissiveIntensity: 0.12 }),
    );
    for (const side of [-1, 1] as const) {
      const anchor = new Group();
      const group = new Group();
      const out = new Mesh(outer, this.fur);
      out.scale.set(1, 1, 0.5);
      out.renderOrder = 9;
      const ins = new Mesh(inner, innerMaterial);
      // The pink inside sits just in front of the ear's face all the way up (leaning back with it a
      // little), so its outline is clean instead of cutting through the ear at a grazing angle.
      ins.scale.set(1, 1, 0.34);
      ins.rotation.x = -0.15;
      ins.position.set(0, ear.height * 0.05, ear.width * 0.48);
      ins.renderOrder = 9;
      group.add(out, ins);
      anchor.add(group);
      host.rig.add(anchor);
      this.ears.push({ side, anchor, ear: group, flick: 0, phase: 0, tilt: ear.tilt, back: 0, stand: 1 });
    }

    // Tail: body colour, two soft rings of stripe, a darker tip.
    const deep = new Color(host.bodyDeep);
    this.tail = new TailTube(this.fur, look.tail.radius, look.tail.tipRadius, (s) => {
      const ring = Math.max(smoothstep(0.42, 0.47, s) * (1 - smoothstep(0.53, 0.58, s)), smoothstep(0.68, 0.73, s) * (1 - smoothstep(0.78, 0.83, s)));
      return body.clone().lerp(deep, 0.12 * (1 - s)).lerp(stripe, Math.max(0.7 * ring, 0.65 * smoothstep(0.86, 0.95, s)));
    });
    own(this.tail);
    host.rig.add(this.tail.mesh, this.tail.tip);

    const root = new Vector3(...look.tail.root);
    this.poses = {
      // Held high behind the right shoulder, the tip hooked inwards.
      high: { root: root.clone(), yaw: 0.42, lie: 0, start: 0.1, bend: 1.25, curl: 3.4 },
      // Laid along the floor to the right, only the tip lifted.
      low: { root: root.clone().add(new Vector3(0.02, -0.18, 0)), yaw: 1.05, lie: 0, start: -0.3, bend: 0.55, curl: 0.9 },
      // Round the foot to the front, as cats sleep.
      // The plane lies on the floor; the tail leaves the back tangent to the foot and follows it round.
      wrapped: { root: new Vector3(0.66, 0.1, -0.5), yaw: 0.85, lie: 1, start: 1.74, bend: 0.98, curl: 1.6 },
    };
    this.pose = { ...this.poses.high, root: root.clone() };

    // Nose: on the mouth, just above the line; drawn over the face like the mouth.
    this.nose = new Mesh(own(noseGeometry()), own(new MeshBasicMaterial({ color: look.nose, side: DoubleSide, depthTest: false })));
    this.nose.renderOrder = 24;
    host.mouthAnchor.add(this.nose);

    // Whiskers: two thin, soft lines on each cheek.
    if (look.whiskers > 0) {
      this.whiskerMaterial = own(
        new MeshBasicMaterial({ color: look.stripe, transparent: true, opacity: look.whiskers, depthTest: false, depthWrite: false, side: DoubleSide }),
      );
      const line = own(new PlaneGeometry(1, 1));
      for (const cheek of host.cheeks) {
        for (const k of [0, 1]) {
          const w = new Mesh(line, this.whiskerMaterial);
          w.renderOrder = 17;
          w.userData.side = cheek.side;
          w.userData.k = k;
          cheek.anchor.add(w);
          this.whiskers.push(w);
        }
      }
    }
  }

  /** Ears, tail, nose and whiskers for this frame. */
  update(f: CatFrame): void {
    const { dt, motion: m } = f;
    const target = CAT_MOODS[f.state];
    for (const key of MOOD_KEYS) this.mood[key] = MathUtils.damp(this.mood[key], target[key], 4, dt);
    const faceGoal = CAT_FACES[f.expression];
    for (const key of FACE_KEYS) this.face[key] = MathUtils.damp(this.face[key], faceGoal[key], 4, dt);
    const w = f.expr;
    const melt = clamp(f.melt, 0, 1);

    // Ears: the mood and the face, then the reactions. A tickle perks them, an "ouch" and a hard
    // landing flatten them, being rubbed relaxes them, flying presses them back.
    const giggle = smooth01(clamp(f.giggle / 0.35, 0, 1));
    const ouch = smooth01(clamp(f.ouch / 0.2, 0, 1));
    const pet = smooth01(clamp(f.pet * 1.6, 0, 1));
    let perk = this.mood.ear + this.face.ear * w + 0.4 * giggle + 0.6 * f.eatLook + 0.3 * f.eatSat;
    perk = perk * (1 - 0.6 * pet) - 0.35 * pet - 1.4 * ouch - 0.9 * f.flight - 1.2 * melt;
    this.perk = MathUtils.damp(this.perk, clamp(perk, -1.2, 1.2), 9, dt);
    const asym = clamp(this.mood.earAsym + this.face.earAsym * w, 0, 1);

    this.flickIn -= dt;
    if (this.flickIn <= 0) {
      this.flickIn = 3.5 + Math.random() * 5;
      const ear = this.ears[Math.random() < 0.5 ? 0 : 1];
      if (ear && !f.reduced && f.state !== "connecting") ear.flick = 1;
    }
    if (giggle > 0.9 && !f.reduced) for (const ear of this.ears) ear.flick = Math.max(ear.flick, 0.7);

    const { ear: earLook } = this.look;
    const flap = clamp(-f.bounce * 0.03, -0.18, 0.18) * m; // the ears trail the jelly when it springs
    for (const ear of this.ears) {
      // Puzzled or thinking: the left ear stays up, the right one turns out and down a little.
      const p = this.perk + (ear.side > 0 ? -0.75 * asym : 0.2 * asym);
      const up = Math.max(0, p);
      const down = Math.max(0, -p);
      ear.tilt = MathUtils.damp(ear.tilt, earLook.tilt - 0.22 * up + 0.85 * down + (ear.side > 0 ? 0.25 * asym : 0), 10, dt);
      ear.back = MathUtils.damp(ear.back, 0.55 * down + (ear.side > 0 ? 0.3 * asym : 0), 10, dt);
      ear.stand = MathUtils.damp(ear.stand, 1 + 0.12 * up - 0.14 * down, 10, dt);
      ear.flick = Math.max(0, ear.flick - dt * 2.8);
      ear.phase += dt * 32;

      this.host.place(ear.anchor, ear.side * earLook.u, earLook.v, -0.02);
      this.host.meltPlace(ear.anchor, melt * 0.06);
      // Upright, leaning out by `tilt` and back by `back`, turned a touch outwards; the twitch on top.
      ear.anchor.rotation.set(-ear.back - 0.08, -ear.side * 0.28, -ear.side * (ear.tilt + flap + 0.5 * melt) + 0.3 * ear.flick * Math.sin(ear.phase) * m);
      ear.ear.scale.set(1, ear.stand * (1 - 0.3 * melt), 1);
    }

    // Tail: the pose blends high .. low with the mood, then wraps round the foot while asleep.
    const up = clamp(this.mood.tailUp + this.face.tailUp * w + 0.3 * f.eatSat - 0.5 * f.flight - melt, 0, 1);
    const wrap = clamp(this.mood.wrap * (1 - f.eatLook), 0, 1);
    this.blendPose(up, wrap);
    // Speaking, the sway follows the voice: faster and wider on every syllable.
    this.hz = MathUtils.damp(this.hz, Math.max(0.08, this.mood.hz + this.face.hz * w + 0.6 * f.voice), 3, dt);
    this.amp = MathUtils.damp(this.amp, Math.max(0, this.mood.amp + this.face.amp * w + 0.6 * pet + 0.3 * giggle), 3, dt);
    this.swayPhase += dt * this.hz * Math.PI * 2 * (f.reduced ? 0.4 : 1);
    this.buildTail(this.amp * m * (1 - 0.7 * melt), melt);

    // Whiskers: two per cheek, fanning out; a little lift with a smile.
    for (const wsk of this.whiskers) {
      const side = wsk.userData.side as number;
      const k = wsk.userData.k as number;
      const angle = (k === 0 ? 0.16 : -0.1) - 0.12 * melt;
      wsk.scale.set(0.17, 0.0075, 1);
      wsk.position.set(side * (0.13 + 0.085 * Math.cos(angle)), (k === 0 ? 0.012 : -0.02) + 0.085 * Math.sin(angle), 0.005);
      wsk.rotation.z = side * angle;
    }
  }

  /** The nose over the mouth: just above the line, or above the top of the open mouth. */
  placeNose(mouthTop: number): void {
    this.nose.position.set(0, Math.max(0.06, mouthTop + 0.045), 0.004);
  }

  /** The ears and the tail use their own copy of the gel: keep its tint and glow in step with the body's. */
  syncMaterial(gel: MeshPhysicalMaterial): void {
    this.fur.color.copy(gel.color);
    this.fur.emissive.copy(gel.emissive);
    this.fur.emissiveIntensity = gel.emissiveIntensity;
    this.fur.clearcoat = gel.clearcoat;
  }

  /**
   * Points of the ears and the tail in rig space, for the play-mode frame: the tips of the ears
   * and a few points of the tail, pushed out by its thickness. Returns how many were written.
   */
  reachPoints(out: Vector3[]): number {
    let count = 0;
    const push = (v: Vector3): void => {
      const slot = out[count];
      if (slot) slot.copy(v);
      else out.push(v.clone());
      count++;
    };
    const { height } = this.look.ear;
    for (const ear of this.ears) {
      this.tmp.set(0, height, 0);
      ear.ear.updateMatrix();
      ear.anchor.updateMatrix();
      this.tmp.applyMatrix4(ear.ear.matrix).applyMatrix4(ear.anchor.matrix);
      push(this.tmp);
    }
    const r = this.look.tail.radius;
    for (let i = 8; i <= TAIL_SEGMENTS; i += 4) {
      const p = this.tail.spine[i];
      if (!p) continue;
      for (const [dx, dy] of [
        [r, 0],
        [-r, 0],
        [0, r],
        [0, -r],
      ] as const) {
        push(this.tmp.set(p.x + dx, p.y + dy, p.z));
      }
    }
    return count;
  }

  private blendPose(up: number, wrap: number): void {
    const { high, low, wrapped } = this.poses;
    const p = this.pose;
    const mix = (a: number, b: number, c: number): number => lerp(lerp(b, a, up), c, wrap);
    p.root.lerpVectors(low.root, high.root, up).lerp(wrapped.root, wrap);
    p.yaw = mix(high.yaw, low.yaw, wrapped.yaw);
    p.lie = mix(high.lie, low.lie, wrapped.lie);
    p.start = mix(high.start, low.start, wrapped.start);
    p.bend = mix(high.bend, low.bend, wrapped.bend);
    p.curl = mix(high.curl, low.curl, wrapped.curl) * lerp(0.55, 1, this.mood.curl);
  }

  /**
   * Walks the tail out from its root in its plane, bending as it goes, with a wave of sway running
   * from the root to the tip; never below the floor.
   */
  private buildTail(sway: number, melt: number): void {
    const p = this.pose;
    const { length, tipRadius } = this.look.tail;
    const cy = Math.cos(p.yaw);
    const sy = Math.sin(p.yaw);
    this.e1.set(cy, 0, -sy);
    this.fwd.set(sy, 0, cy);
    const lie = (p.lie * Math.PI) / 2;
    this.e2.set(0, Math.cos(lie), 0).addScaledVector(this.fwd, Math.sin(lie));
    this.planeNormal.crossVectors(this.e1, this.e2).normalize();

    const n = TAIL_SEGMENTS;
    const ds = (length * (1 - 0.25 * melt)) / n;
    let angle = p.start;
    let x = 0;
    let y = 0;
    const spine = this.tail.spine;
    for (let i = 0; i <= n; i++) {
      const s = i / n;
      const point = spine[i] as Vector3;
      point.copy(p.root).addScaledVector(this.e1, x).addScaledVector(this.e2, y);
      // Never through the floor (lying down, or melted).
      const floor = lerp(this.look.tail.radius, tipRadius, s) * 0.95;
      if (point.y < floor) point.y = floor;
      // Upright the tail leaves straight and bends further out; lying round the foot it bends from the root.
      const kappa =
        p.bend * lerp(smoothstep(0.08, 0.5, s), 1, p.lie) +
        p.curl * smoothstep(0.62, 0.95, s) +
        sway * (0.35 + 1.4 * s) * Math.sin(this.swayPhase - s * 2.8);
      angle += kappa * ds;
      x += Math.cos(angle) * ds;
      y += Math.sin(angle) * ds;
    }
    this.tail.update(this.planeNormal);
  }
}
