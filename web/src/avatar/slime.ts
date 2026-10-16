/**
 * Slime character: a soft, jelly companion for the voice console.
 *
 * Why a slime and not a person: a round, calm creature with one big readable
 * face is easier to trust and to read at a glance than a realistic human,
 * which matters most for people who are not used to talking to a screen
 * (older adults above all). It also stays clear of the uncanny valley.
 *
 * Look: a glossy pink gumdrop (wide flat base, round crown), small dark oval
 * eyes with one glint each and a big readable mouth. Colours and proportions
 * live in `SLIME_LOOKS`, so another look is one more entry there. The design is
 * original and procedural; it only borrows the clean, round style of
 * jelly-creature games. No model file, no download, no licence to carry.
 *
 * Its body language is part of the interface, even with the sound off:
 *   connecting / renewing  asleep, breathing slowly              -> wait
 *   listening              wakes with a hop, leans in            -> your turn
 *   thinking               looks aside, three dots pulse         -> searching
 *   speaking               bounces with the voice, mouth follows -> talking
 *   error                  sags, drooping lids, small frown      -> it failed
 *
 * On top of the state it wears a face for the tone of the conversation
 * (`setExpression`, picked by `expression.ts`). How much of that face shows
 * depends on the state: all of it while idle, listening or speaking, a little
 * while thinking or renewing, none while asleep or failed. While it speaks the
 * visemes own the mouth and the expression stays in the eyes.
 *
 * Same contract as the human (`AvatarHandle`) and same lip-sync driver
 * (`LipSync`: five vowel weights), so the two can be swapped to compare them.
 */
import {
  AlwaysStencilFunc,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  DynamicDrawUsage,
  EqualStencilFunc,
  Group,
  HemisphereLight,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  NotEqualStencilFunc,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  ReplaceStencilOp,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  type Material,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LipSync, VISEMES } from "./lipsync";
import {
  AvatarError,
  type AvatarDebugInfo,
  type AvatarExpression,
  type AvatarHandle,
  type AvatarState,
  type MountAvatarOptions,
} from "./types";

// --- Looks ------------------------------------------------------------------

type Rgb = readonly [number, number, number];

interface SlimeShape {
  /** Half-width and half-depth of the body, relative to a unit sphere. */
  width: number;
  depth: number;
  /** Half-height of the body, relative to a unit sphere. */
  height: number;
  /** Below this unit-sphere height (as a positive number) the base is pressed flat. */
  flatBase: number;
  /** Extra girth at the foot and less at the crown: the gumdrop silhouette. */
  footFlare: number;
  crownTaper: number;
}

interface SlimeFace {
  /** Eye centre on the body, as the (u, v) of the surface normal. */
  eyeU: number;
  eyeV: number;
  /** Eye radii (an upright oval). */
  eyeRX: number;
  eyeRY: number;
  /** Top of the mouth, as the v of the surface normal. */
  mouthV: number;
  blushU: number;
  blushV: number;
  /** Peak opacity of the cheeks; keep it low, they are a hint. */
  blushStrength: number;
  /** The single highlight painted on the crown. */
  shine: { u: number; v: number; sx: number; sy: number; roll: number; opacity: number };
}

interface SlimeLook {
  color: {
    /** Body colour, and the deeper tone it fades to towards the floor. */
    body: number;
    bodyDeep: number;
    shine: number;
    eye: number;
    mouth: number;
    tongue: number;
    /** Thinking dots and sleeping "z". */
    dots: number;
    blush: Rgb;
    shadow: Rgb;
    /** Multiplied over the body when something fails: a little greyer, never another hue. */
    sadTint: number;
    sky: number;
    ground: number;
    rim: number;
  };
  shape: SlimeShape;
  face: SlimeFace;
}

/**
 * Brand tokens (src/styles/tokens.css) mirrored here, because WebGL cannot read CSS colours.
 * Only `rosado` exists for now; a new look is one more entry with the same fields.
 */
const SLIME_LOOKS = {
  rosado: {
    color: {
      body: 0xe5507d, // --rose-500
      bodyDeep: 0xa8234f, // --rose-700
      shine: 0xfff7fa, // --rose-50
      eye: 0x3a0a1e, // --rose-950
      mouth: 0x5e1131, // --rose-900
      tongue: 0xf17aa0, // --rose-400
      dots: 0x7c6cf0, // --violet-500
      blush: [248, 169, 193], // #f8a9c1
      shadow: [94, 17, 49], // --rose-900
      sadTint: 0xc7b3bb,
      sky: 0xfff7fa,
      ground: 0xd9879f,
      rim: 0xffe1ea,
    },
    shape: { width: 0.9, depth: 0.84, height: 1.06, flatBase: 0.7, footFlare: 0.15, crownTaper: 0.1 },
    face: {
      eyeU: 0.3,
      eyeV: 0.15,
      eyeRX: 0.088,
      eyeRY: 0.126,
      mouthV: -0.05,
      blushU: 0.5,
      blushV: -0.04,
      blushStrength: 0.42,
      shine: { u: -0.44, v: 0.62, sx: 0.12, sy: 0.07, roll: 0.6, opacity: 0.92 },
    },
  },
} satisfies Record<string, SlimeLook>;

type SlimeLookId = keyof typeof SLIME_LOOKS;
const DEFAULT_LOOK: SlimeLookId = "rosado";

// --- Layout -----------------------------------------------------------------

const CAMERA_FOV = 30;
/**
 * What must stay in frame, around the point the camera looks at: the body, and room
 * above the crown for the thinking dots. The point sits low because the dots are only
 * there part of the time, and the stage keeps its mode switch and caption over the bottom edge.
 */
const FOCUS = new Vector3(0, 1.0, 0);
const HALF_WIDTH = 1.12;
const HALF_HEIGHT = 1.42;
const FRAME_MARGIN = 1.14;
const BASE_PITCH = 0.04;
const ORBIT_YAW_LIMIT = 0.7;
const ORBIT_PITCH_LIMIT = 0.25;

/** Height of the open strip used as an eyelid mask; only its lower edge matters. */
const LID_HEIGHT = 0.4;
const STROKE_SEGMENTS = 20;
const MOUTH_SEGMENTS = 48;
const WINK_TIME = 0.75;

// --- Body language ----------------------------------------------------------

/** What the state does to the body and the face. */
interface Mood {
  /** Vertical stretch (+) or squash (-) the body settles into. */
  stretch: number;
  lean: number;
  roll: number;
  /** Slow side-to-side rocking, radians. */
  sway: number;
  /** 0 closed .. 1 open. */
  eyeOpen: number;
  eyeSize: number;
  /** Slant of the upper lids, radians; positive droops the outer corners (sad). */
  eyeTilt: number;
  /** 0 .. 1: how far the upper lids come down. */
  lid: number;
  /** Mouth: 1 smile .. 0 flat .. -1 frown. */
  curve: number;
  mouthShift: number;
  blush: number;
  /** How awake the gel looks (a faint inner light). */
  glow: number;
  /** How much the eyes and the body follow the pointer. */
  follow: number;
  gazeX: number;
  gazeY: number;
  think: number;
  /** Breaths per second. */
  breathe: number;
  /** 0 .. 1: how much of the conversation face (`setExpression`) shows in this state. */
  expr: number;
}

const MOODS: Record<AvatarState, Mood> = {
  idle: {
    stretch: 0, lean: 0, roll: 0, sway: 0, eyeOpen: 1, eyeSize: 1, eyeTilt: 0, lid: 0, curve: 0.8, mouthShift: 0,
    blush: 0.5, glow: 0.6, follow: 1, gazeX: 0, gazeY: 0, think: 0, breathe: 0.28, expr: 1,
  },
  // Asleep: eyes shut, slow deep breaths. "Wait, it is getting ready."
  connecting: {
    stretch: -0.03, lean: 0.02, roll: 0.03, sway: 0, eyeOpen: 0, eyeSize: 1, eyeTilt: 0, lid: 0, curve: 0.45,
    mouthShift: 0, blush: 0.35, glow: 0.25, follow: 0, gazeX: 0, gazeY: -0.5, think: 0, breathe: 0.42, expr: 0,
  },
  // Awake and leaning in: "your turn".
  listening: {
    stretch: 0.05, lean: 0.05, roll: 0.06, sway: 0, eyeOpen: 1, eyeSize: 1.08, eyeTilt: 0, lid: 0, curve: 0.8,
    mouthShift: 0, blush: 0.6, glow: 0.85, follow: 1, gazeX: 0, gazeY: 0, think: 0, breathe: 0.34, expr: 1,
  },
  // Looks up and aside while three dots pulse.
  thinking: {
    stretch: 0.02, lean: -0.02, roll: -0.06, sway: 0.05, eyeOpen: 1, eyeSize: 1, eyeTilt: 0, lid: 0, curve: 0.15,
    mouthShift: 0.05, blush: 0.4, glow: 0.7, follow: 0, gazeX: 0.75, gazeY: 0.6, think: 1, breathe: 0.3, expr: 0.3,
  },
  speaking: {
    stretch: 0.02, lean: 0.02, roll: 0, sway: 0, eyeOpen: 0.95, eyeSize: 1, eyeTilt: 0, lid: 0, curve: 0.9,
    mouthShift: 0, blush: 0.7, glow: 0.9, follow: 1, gazeX: 0, gazeY: 0, think: 0, breathe: 0.3, expr: 1,
  },
  // Drowsy, heavy lids, looking aside: "one moment, I am picking the conversation back up".
  renewing: {
    stretch: -0.01, lean: 0, roll: -0.03, sway: 0, eyeOpen: 1, eyeSize: 1, eyeTilt: 0, lid: 0.5, curve: 0.5,
    mouthShift: 0, blush: 0.4, glow: 0.45, follow: 0.3, gazeX: -0.4, gazeY: 0.1, think: 0, breathe: 0.4, expr: 0.3,
  },
  // Sags, lids droop, small frown. Shape carries the message, not only colour.
  error: {
    stretch: -0.1, lean: 0.05, roll: 0.04, sway: 0, eyeOpen: 1, eyeSize: 1.05, eyeTilt: 0.32, lid: 0.32, curve: -0.7,
    mouthShift: 0, blush: 0.15, glow: 0.3, follow: 0.3, gazeX: 0, gazeY: -0.3, think: 0, breathe: 0.22, expr: 0,
  },
};

const MOOD_KEYS = Object.keys(MOODS.idle) as Array<keyof Mood>;

/** The conversation face: modifiers blended over the mood by `Mood.expr`. */
interface Face {
  /** Multipliers of the mood's eye opening and size. */
  eyeOpen: number;
  eyeSize: number;
  /** Added to the mood's lids. */
  lid: number;
  lidTilt: number;
  /** 0 .. 1: closed happy eyes, "^ ^". */
  closed: number;
  /** 0 .. 1: one eye smaller and squinting (puzzled). */
  asym: number;
  /** Mouth line, replaces the mood's curve: 1 smile .. -1 frown. */
  curve: number;
  /** 0 .. 1: big open "D" grin at rest. */
  grin: number;
  /** 0 .. 1: small round "o" at rest. */
  oh: number;
  mouthWidth: number;
  /** Crooked mouth, radians. */
  skew: number;
  blush: number;
  roll: number;
  stretch: number;
  gazeY: number;
}

const NEUTRAL_FACE: Face = {
  eyeOpen: 1, eyeSize: 1, lid: 0, lidTilt: 0, closed: 0, asym: 0, curve: 0.8, grin: 0, oh: 0, mouthWidth: 1, skew: 0,
  blush: 0, roll: 0, stretch: 0, gazeY: 0,
};

const FACES: Record<AvatarExpression, Face> = {
  neutral: NEUTRAL_FACE,
  happy: { ...NEUTRAL_FACE, eyeSize: 1.04, curve: 1, mouthWidth: 1.2, blush: 0.25, stretch: 0.02 },
  joyful: { ...NEUTRAL_FACE, eyeSize: 1.06, curve: 1, grin: 1, blush: 0.35, stretch: 0.03 },
  calm: { ...NEUTRAL_FACE, closed: 1, curve: 0.9, blush: 0.3, roll: 0.04 },
  focused: { ...NEUTRAL_FACE, eyeSize: 0.96, lid: 0.3, lidTilt: -0.14, curve: 0.04, mouthWidth: 0.8, blush: -0.2 },
  surprised: { ...NEUTRAL_FACE, eyeSize: 1.28, curve: 0, oh: 1, blush: 0, stretch: 0.05, gazeY: 0.1 },
  // Worried but attentive: slanted lids, a small tight mouth, still looking at you.
  concerned: { ...NEUTRAL_FACE, eyeSize: 1.02, lid: 0.22, lidTilt: 0.3, curve: -0.3, mouthWidth: 0.6, blush: -0.1 },
  // Heavier: lower, steeper lids, a full frown, looking down, the body sinks a little.
  sad: {
    ...NEUTRAL_FACE, eyeSize: 1.05, lid: 0.46, lidTilt: 0.5, curve: -1, mouthWidth: 1, blush: -0.25, stretch: -0.06,
    roll: -0.03, gazeY: -0.45,
  },
  confused: { ...NEUTRAL_FACE, asym: 1, curve: -0.2, mouthWidth: 0.75, skew: 0.3, roll: 0.1, gazeY: 0.2 },
};

const FACE_KEYS = Object.keys(NEUTRAL_FACE) as Array<keyof Face>;

/** Jelly spring: soft enough to overshoot two or three times after a hop. */
const SPRING_K = 95;
const SPRING_C = 7;
const POP_K = 70;
const POP_C = 7.5;

// --- Helpers ----------------------------------------------------------------

const damp = MathUtils.damp;
const clamp = MathUtils.clamp;
const lerp = MathUtils.lerp;
const smooth01 = (t: number): number => t * t * (3 - 2 * t);
/** Works with reversed edges, unlike `MathUtils.smoothstep`. */
const smoothstep = (a: number, b: number, x: number): number => smooth01(clamp((x - a) / (b - a), 0, 1));

function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  try {
    // The stencil clips the tongue to the mouth and lets the eyelids cut the eyes.
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, stencil: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    // Neutral tone mapping keeps the brand colours true; ACES would wash them out.
    renderer.toneMapping = NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch (cause) {
    throw new AvatarError("webgl-unavailable", "WebGL is not available in this browser, so the 3D avatar cannot be rendered.", cause);
  }
}

/** A soft round gradient, used for the blush and the contact shadow. */
function softDisc(rgb: Rgb, strength: number): CanvasTexture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (ctx) {
    const [r, g, b] = rgb;
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, `rgba(${r},${g},${b},${strength})`);
    grad.addColorStop(0.55, `rgba(${r},${g},${b},${strength * 0.45})`);
    grad.addColorStop(1, `rgba(${r},${g},${b},0)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

// --- Body shape -------------------------------------------------------------

/** How much wider than a sphere the body is at unit height `y`: wider at the foot, narrower at the crown. */
const girth = (shape: SlimeShape, y: number): number =>
  1 + shape.footFlare * smoothstep(0.2, -0.65, y) - shape.crownTaper * smoothstep(0.2, 1, y);

/** The floor, in unit-sphere height (positive). Below `flatBase` the sphere is pressed flat. */
const floorDepth = (shape: SlimeShape): number => shape.flatBase + (1 - shape.flatBase) * 0.22;
const bodyCenterY = (shape: SlimeShape): number => floorDepth(shape) * shape.height;
const bodyTop = (shape: SlimeShape): number => bodyCenterY(shape) + shape.height;

/**
 * A gumdrop: a round crown, a soft flat base, a little wider at the foot. Rests on y = 0.
 * Normals are written analytically (a recomputed sphere would show its seam), and the
 * vertex colours fade to the deeper tone towards the floor.
 */
function buildBodyGeometry(look: SlimeLook): SphereGeometry {
  const { shape } = look;
  const geometry = new SphereGeometry(1, 72, 54);
  const position = geometry.getAttribute("position") as BufferAttribute;
  const normal = geometry.getAttribute("normal") as BufferAttribute;
  const colors = new Float32Array(position.count * 3);
  const body = new Color(look.color.body);
  const deep = new Color(look.color.bodyDeep);
  const light = new Color(look.color.shine);
  const mixed = new Color();
  const n = new Vector3();
  const cy = bodyCenterY(shape);
  const top = bodyTop(shape);
  const flat = shape.flatBase;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y0 = position.getY(i);
    const z = position.getZ(i);
    const y = y0 < -flat ? -flat + (y0 + flat) * 0.22 : y0;
    const k = girth(shape, y);
    const px = x * k * shape.width;
    const py = cy + y * shape.height;
    const pz = z * k * shape.depth;
    position.setXYZ(i, px, py, pz);
    n.set(x / (k * shape.width), y0 / shape.height, z / (k * shape.depth)).normalize();
    normal.setXYZ(i, n.x, n.y, n.z);
    // Deeper towards the floor, a breath lighter at the crown: reads as a solid, lit gumdrop.
    const low = Math.pow(smoothstep(cy * 1.05, 0.02, py), 1.3) * 0.88;
    const high = smoothstep(cy + 0.35 * shape.height, top, py) * 0.07;
    mixed.copy(body).lerp(deep, low).lerp(light, high);
    colors[i * 3] = mixed.r;
    colors[i * 3 + 1] = mixed.g;
    colors[i * 3 + 2] = mixed.b;
  }
  geometry.setAttribute("color", new BufferAttribute(colors, 3));
  return geometry;
}

// --- Face pieces ------------------------------------------------------------

/**
 * A thick line along a parabola with round caps: smiles, frowns and closed eyes.
 * Its vertices are rewritten in place every frame, so it can bend smoothly.
 */
class Stroke {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly position: BufferAttribute;
  private readonly capA: Mesh;
  private readonly capB: Mesh;

  constructor(material: Material, cap: CircleGeometry, renderOrder: number) {
    const n = STROKE_SEGMENTS;
    this.position = new BufferAttribute(new Float32Array((n + 1) * 6), 3);
    this.position.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute("position", this.position);
    const index: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(index);
    const line = new Mesh(this.geometry, material);
    this.capA = new Mesh(cap, material);
    this.capB = new Mesh(cap, material);
    for (const part of [line, this.capA, this.capB]) {
      part.renderOrder = renderOrder;
      part.frustumCulled = false; // rewritten every frame
    }
    this.group.add(line, this.capA, this.capB);
  }

  /** y = bend * ((x / half)^2 - 0.5): bend > 0 lifts the ends (a smile, "‿"), bend < 0 drops them (a frown, "^"). */
  update(half: number, bend: number, thickness: number): void {
    const n = STROKE_SEGMENTS;
    const out = this.position.array as Float32Array;
    const r = thickness / 2;
    const h = Math.max(1e-4, half);
    for (let i = 0; i <= n; i++) {
      const s = -1 + (2 * i) / n;
      const x = s * h;
      const y = bend * (s * s - 0.5);
      const slope = (2 * bend * s) / h;
      const len = Math.hypot(1, slope);
      const nx = -slope / len;
      const ny = 1 / len;
      out[i * 6] = x + nx * r;
      out[i * 6 + 1] = y + ny * r;
      out[i * 6 + 2] = 0;
      out[i * 6 + 3] = x - nx * r;
      out[i * 6 + 4] = y - ny * r;
      out[i * 6 + 5] = 0;
    }
    this.position.needsUpdate = true;
    this.capA.position.set(-h, bend * 0.5, 0);
    this.capB.position.set(h, bend * 0.5, 0);
    this.capA.scale.setScalar(r);
    this.capB.scale.setScalar(r);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/**
 * The open mouth: a filled outline rewritten every frame. Its upper half can flatten
 * into the straight top of a "D" grin, and the corners can lift into a smile.
 */
class MouthShape {
  readonly mesh: Mesh;
  private readonly geometry = new BufferGeometry();
  private readonly position: BufferAttribute;

  constructor(material: Material) {
    const n = MOUTH_SEGMENTS;
    this.position = new BufferAttribute(new Float32Array((n + 1) * 3), 3);
    this.position.setUsage(DynamicDrawUsage);
    this.geometry.setAttribute("position", this.position);
    const index: number[] = [];
    for (let i = 1; i <= n; i++) index.push(0, i, (i % n) + 1);
    this.geometry.setIndex(index);
    this.mesh = new Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
  }

  /** `top` and `bottom` are the heights above and below the corners; `bend` lifts the corners. */
  update(half: number, top: number, bottom: number, bend: number): void {
    const n = MOUTH_SEGMENTS;
    const out = this.position.array as Float32Array;
    out[0] = 0;
    out[1] = (top - bottom) * 0.5 + bend * 0.5;
    out[2] = 0;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      out[(i + 1) * 3] = half * c;
      out[(i + 1) * 3 + 1] = (s > 0 ? top : bottom) * s + bend * c * c;
      out[(i + 1) * 3 + 2] = 0;
    }
    this.position.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

interface EyeRig {
  side: -1 | 1;
  /** Sits on the body surface. */
  anchor: Group;
  /** Iris and glint, scaled by size and openness. */
  shape: Group;
  /** Rotated by the slant of the lid. */
  lidPivot: Group;
  /** Invisible: it only marks the stencil, so the iris is cut along its lower edge. */
  lid: Mesh;
  /** "^" when the eye is closed with joy, a soft "‿" when it is asleep. */
  closed: Stroke;
}

// --- Slime ------------------------------------------------------------------

class Slime implements AvatarHandle {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 40);
  private readonly lipSync = new LipSync();
  private readonly cleanups: Array<() => void> = [];
  private readonly owned: Array<{ dispose(): void }> = [];
  private readonly look: SlimeLook;

  /** Everything that squashes, stretches and tilts with the body, pivoting on the ground. */
  private readonly rig = new Group();
  private readonly shadow: Mesh;
  private readonly bodyBase: Float32Array;
  private readonly bodyNormals: Float32Array;
  private readonly bodyPosition: BufferAttribute;
  private readonly gelMaterial: MeshPhysicalMaterial;
  private readonly eyes: EyeRig[] = [];
  private readonly mouthAnchor = new Group();
  private readonly mouthOpen = new Group();
  private mouthShape!: MouthShape;
  private tongue!: Mesh;
  private smile!: Stroke;
  private readonly blushes: Array<{ side: -1 | 1; anchor: Object3D }> = [];
  private readonly blushMaterial: MeshBasicMaterial;
  private readonly dots = new Group();
  private readonly dotMeshes: Mesh[] = [];
  private readonly zeds: Sprite[] = [];

  private readonly white = new Color(0xffffff);
  private readonly sadColor: Color;
  private readonly glowColor: Color;
  private readonly tmpNormal = new Vector3();
  private readonly zAxis = new Vector3(0, 0, 1);
  /** Surface normal under the painted highlight. */
  private readonly shineDir = new Vector3(0, 1, 0);
  private readonly focus = FOCUS.clone();
  private readonly centerY: number;
  private readonly topY: number;

  private state: AvatarState = "idle";
  private expression: AvatarExpression = "neutral";
  private readonly mood: Mood = { ...MOODS.idle };
  private readonly face: Face = { ...FACES.neutral };
  private time = 0;
  private rafId = 0;
  private lastFrame = 0;
  private running = false;
  private disposed = false;
  private pageVisible = true;
  private onScreen = true;
  private contextLost = false;
  private reducedMotion = false;
  private motion = 1;

  // Jelly spring (vertical stretch) and entrance.
  private a = 0;
  private av = 0;
  private intro = 0;
  private introV = 0;
  private energy = 0;
  private emphasis = 0;
  /** Giggle after a tap: closed happy eyes and an open grin. */
  private happy = 0;
  private wink = 0;
  /** 0 .. 1: how much the visemes own the mouth (eases in and out with speaking). */
  private talk = 0;
  private greetIn = 0.55;

  private pointerX = 0;
  private pointerY = 0;
  private pointerStamp = -Infinity;
  private followX = 0;
  private followY = 0;

  private orbitYaw = 0;
  private orbitPitch = 0;
  private orbitYawGoal = 0;
  private orbitPitchGoal = 0;
  private cameraDistance = 6;

  private blinkIn = 1.8;
  private blinkPhase = -1;
  private blinkValue = 0;

  private frames = 0;
  private frameMs = 16.7;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly renderer: WebGLRenderer,
    lookId: SlimeLookId = DEFAULT_LOOK,
  ) {
    this.look = SLIME_LOOKS[lookId];
    this.sadColor = new Color(this.look.color.sadTint);
    this.glowColor = new Color(this.look.color.body);
    this.centerY = bodyCenterY(this.look.shape);
    this.topY = bodyTop(this.look.shape);

    this.setupEnvironment();
    this.setupLights();

    // Body: solid, glossy candy. Opaque, so the face sits on it cleanly.
    this.gelMaterial = this.own(
      new MeshPhysicalMaterial({
        color: 0xffffff, // the vertex colours carry the body colour and its gradient
        vertexColors: true,
        roughness: 0.42,
        metalness: 0,
        // A soft clearcoat: glossy, but the one crisp highlight stays the painted one.
        clearcoat: 0.6,
        clearcoatRoughness: 0.38,
        sheen: 0.35,
        sheenRoughness: 0.45,
        sheenColor: new Color(this.look.color.rim),
        emissive: this.glowColor,
        emissiveIntensity: 0.06,
      }),
    );
    const bodyGeometry = this.own(buildBodyGeometry(this.look));
    this.bodyPosition = bodyGeometry.getAttribute("position") as BufferAttribute;
    this.bodyBase = Float32Array.from(this.bodyPosition.array as ArrayLike<number>);
    this.bodyNormals = Float32Array.from((bodyGeometry.getAttribute("normal") as BufferAttribute).array as ArrayLike<number>);
    const body = new Mesh(bodyGeometry, this.gelMaterial);
    body.renderOrder = 10;
    body.frustumCulled = false; // vertices move on the CPU; the static bounds would clip the wobble

    // Contact shadow (outside the rig, so it stays on the floor when the body hops)
    const shadowTexture = this.own(softDisc(this.look.color.shadow, 0.5));
    this.shadow = new Mesh(
      this.own(new PlaneGeometry(1, 1)),
      this.own(new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, 0.004, 0.05);
    this.shadow.renderOrder = 0;

    this.rig.add(body);
    this.blushMaterial = this.own(
      new MeshBasicMaterial({ map: this.own(softDisc(this.look.color.blush, 1)), transparent: true, depthWrite: false, opacity: 0.3 }),
    );
    this.buildFace();
    this.buildShine();
    this.buildThinkingDots();
    this.buildSleepingZeds();

    this.scene.add(this.shadow, this.rig, this.dots);

    this.setupObservers();
    this.resize();
    this.applyMotionPreference();

    this.animate(0);
    this.renderFrame();
    this.updateRunning();
  }

  // -- Public API --

  setState(s: AvatarState): void {
    if (!(s in MOODS) || s === this.state) return;
    const was = this.state;
    this.state = s;
    if (this.reducedMotion) return;
    const waiting = (x: AvatarState): boolean => x === "connecting" || x === "renewing";
    if (waiting(was) && !waiting(s) && s !== "error") this.hop(1); // wakes up: the visible "you can talk now"
    else if (s === "listening") this.hop(0.35); // perks up
    else if (s === "error") this.av -= 1.4; // slumps
  }

  setExpression(e: AvatarExpression): void {
    if (!(e in FACES) || e === this.expression) return;
    this.expression = e;
    // A small physical beat for the lively faces, only when the state lets the face show.
    if (this.reducedMotion || MOODS[this.state].expr < 0.5) return;
    if (e === "joyful") this.hop(0.3);
    else if (e === "surprised") this.av += 1.6;
  }

  setMouthLevel(level: number): void {
    this.lipSync.setLevel(level, performance.now());
  }

  attachAnalyser(node: AnalyserNode | null): void {
    this.lipSync.attachAnalyser(node);
  }

  setDemoSpeech(on: boolean): void {
    this.lipSync.demo = on;
  }

  wave(): void {
    if (this.reducedMotion) return;
    this.hop(0.9);
    this.wink = WINK_TIME;
  }

  resetCamera(): void {
    this.orbitYawGoal = 0;
    this.orbitPitchGoal = 0;
  }

  getDebugInfo(): AvatarDebugInfo {
    const mouth: Record<string, number> = {};
    for (const v of VISEMES) mouth[v] = Number(this.lipSync.weights[v].toFixed(3));
    return {
      fps: Math.round(1000 / this.frameMs),
      frameMs: Number(this.frameMs.toFixed(2)),
      frames: this.frames,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      state: this.state,
      mouth,
      expressions: [this.expression],
      modelName: "slime",
      vrmVersion: "procedural",
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.lipSync.attachAnalyser(null);
    for (const item of this.owned.splice(0)) item.dispose();
    this.scene.environment = null;
    this.renderer.renderLists.dispose();
    this.renderer.dispose();
  }

  // -- Setup --

  /** Registers something to dispose with the avatar and returns it. */
  private own<T extends { dispose(): void }>(item: T): T {
    this.owned.push(item);
    return item;
  }

  /** A soft studio environment gives the clearcoat something to reflect. */
  private setupEnvironment(): void {
    const generator = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    room.dispose();
    generator.dispose();
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.32;
    this.own(target);
  }

  private setupLights(): void {
    const { color } = this.look;
    const sky = new HemisphereLight(color.sky, color.ground, 0.85);
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(-1.6, 2.6, 3).normalize();
    // A warm rim from behind lifts the edge of the body off the stage.
    const rim = new DirectionalLight(color.rim, 1.1);
    rim.position.set(2, 1.2, -2).normalize();
    this.scene.add(sky, key, rim);
  }

  /** Places an object on the body surface at the normal direction (u, v, w), facing outwards. */
  private placeOn(object: Object3D, u: number, v: number, lift = 0): void {
    const { shape } = this.look;
    const w = Math.sqrt(Math.max(0.05, 1 - u * u - v * v));
    const d = this.tmpNormal.set(u, v, w).normalize();
    const k = girth(shape, d.y);
    const px = d.x * k * shape.width;
    const py = this.centerY + d.y * shape.height;
    const pz = d.z * k * shape.depth;
    const n = d.set(d.x / (k * shape.width), d.y / shape.height, d.z / (k * shape.depth)).normalize();
    object.position.set(px + n.x * lift, py + n.y * lift, pz + n.z * lift);
    object.quaternion.setFromUnitVectors(this.zAxis, n);
  }

  private buildFace(): void {
    const { color, face } = this.look;
    const sphere = this.own(new SphereGeometry(1, 28, 20));
    const disc = this.own(new CircleGeometry(1, 32));
    const cap = this.own(new CircleGeometry(1, 16));
    // The iris and its glint are drawn only where no lid has marked the stencil.
    const underLid = { stencilWrite: true, stencilRef: 2, stencilFunc: NotEqualStencilFunc } as const;
    const irisMaterial = this.own(new MeshStandardMaterial({ color: color.eye, roughness: 0.25, metalness: 0, ...underLid }));
    const glintMaterial = this.own(new MeshBasicMaterial({ color: 0xffffff, ...underLid }));
    const lidMaterial = this.own(
      new MeshBasicMaterial({
        colorWrite: false,
        depthWrite: false,
        stencilWrite: true,
        stencilRef: 2,
        stencilFunc: AlwaysStencilFunc,
        stencilZPass: ReplaceStencilOp,
      }),
    );
    const inkMaterial = this.own(new MeshBasicMaterial({ color: color.eye, side: DoubleSide }));
    const lidGeometry = this.own(new PlaneGeometry(0.7, LID_HEIGHT));

    for (const side of [-1, 1] as const) {
      const anchor = new Group();
      const shape = new Group();
      const iris = new Mesh(sphere, irisMaterial);
      iris.scale.set(face.eyeRX, face.eyeRY, 0.04);
      const glint = new Mesh(disc, glintMaterial);
      glint.scale.setScalar(face.eyeRX * 0.36);
      glint.position.set(-face.eyeRX * 0.32, face.eyeRY * 0.4, 0.045);
      shape.add(iris, glint);
      iris.renderOrder = 20;
      glint.renderOrder = 21;

      const lidPivot = new Group();
      const lid = new Mesh(lidGeometry, lidMaterial);
      lid.position.z = 0.06;
      lid.renderOrder = 19;
      lidPivot.add(lid);

      const closed = new Stroke(inkMaterial, cap, 21);
      this.owned.push(closed);
      anchor.add(shape, lidPivot, closed.group);
      this.eyes.push({ side, anchor, shape, lidPivot, lid, closed });
      this.rig.add(anchor);
    }

    // Mouth: a line (smile, flat or frown) that gives way to an open mouth with a tongue.
    this.smile = new Stroke(inkMaterial, cap, 22);
    this.owned.push(this.smile);
    const cavityMaterial = this.own(
      new MeshBasicMaterial({
        color: color.mouth,
        side: DoubleSide,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: AlwaysStencilFunc,
        stencilZPass: ReplaceStencilOp,
      }),
    );
    this.mouthShape = new MouthShape(cavityMaterial);
    this.owned.push(this.mouthShape);
    this.mouthShape.mesh.renderOrder = 21;
    // The tongue is a plain ellipse, clipped by the stencil to the inside of the mouth.
    this.tongue = new Mesh(
      disc,
      this.own(new MeshBasicMaterial({ color: color.tongue, stencilWrite: true, stencilRef: 1, stencilFunc: EqualStencilFunc })),
    );
    this.tongue.position.z = 0.002;
    this.tongue.renderOrder = 22;
    this.mouthOpen.add(this.mouthShape.mesh, this.tongue);
    this.mouthAnchor.add(this.smile.group, this.mouthOpen);
    this.rig.add(this.mouthAnchor);

    // Cheeks: a faint warm hint, never a sticker.
    const cheek = this.own(new CircleGeometry(0.1, 24));
    for (const side of [-1, 1] as const) {
      const anchor = new Group();
      const mesh = new Mesh(cheek, this.blushMaterial);
      mesh.scale.set(1, 0.68, 1);
      mesh.renderOrder = 15;
      anchor.add(mesh);
      this.blushes.push({ side, anchor });
      this.rig.add(anchor);
    }
  }

  /** One crisp highlight on the crown, upper left, so the candy reads as glossy even at a distance. */
  private buildShine(): void {
    const spot = this.look.face.shine;
    const material = this.own(
      // No depth test: the ripples and the sideways lean of the crown must never swallow it. Within the
      // orbit limits the spot stays on the side that faces the camera, so it never shows through the body.
      new MeshBasicMaterial({ color: this.look.color.shine, transparent: true, opacity: spot.opacity, depthWrite: false, depthTest: false }),
    );
    const anchor = new Group();
    const mesh = new Mesh(this.own(new CircleGeometry(1, 32)), material);
    mesh.scale.set(spot.sx, spot.sy, 1);
    mesh.rotation.z = spot.roll;
    mesh.renderOrder = 16;
    anchor.add(mesh);
    this.placeOn(anchor, spot.u, spot.v, 0.01);
    this.shineDir.set(0, 0, 1).applyQuaternion(anchor.quaternion);
    this.rig.add(anchor);
  }

  private buildThinkingDots(): void {
    const { dots } = this.look.color;
    const geometry = this.own(new SphereGeometry(0.06, 16, 12));
    const material = this.own(new MeshStandardMaterial({ color: dots, emissive: dots, emissiveIntensity: 0.3, roughness: 0.35 }));
    [-0.22, 0, 0.22].forEach((x) => {
      const dot = new Mesh(geometry, material);
      dot.position.set(x, 0, 0);
      dot.renderOrder = 22;
      this.dotMeshes.push(dot);
      this.dots.add(dot);
    });
    this.dots.position.set(0, this.topY + 0.4, 0.1);
    this.dots.visible = false;
  }

  /** Three "z" that drift up while it sleeps (connecting). */
  private buildSleepingZeds(): void {
    const size = 96;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = `#${new Color(this.look.color.dots).getHexString()}`;
      ctx.font = `700 ${size * 0.8}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("z", size / 2, size / 2);
    }
    const texture = this.own(new CanvasTexture(canvas));
    texture.colorSpace = SRGBColorSpace;
    for (let i = 0; i < 3; i++) {
      const sprite = new Sprite(this.own(new SpriteMaterial({ map: texture, transparent: true, depthWrite: false, opacity: 0 })));
      sprite.renderOrder = 23;
      sprite.visible = false;
      this.zeds.push(sprite);
      this.scene.add(sprite);
    }
  }

  private setupObservers(): void {
    const { canvas } = this;
    canvas.style.touchAction = "pan-y";

    const resizeObserver = new ResizeObserver(() => {
      this.resize();
      if (!this.running && !this.disposed && !this.contextLost) this.renderFrame();
    });
    resizeObserver.observe(canvas);
    this.cleanups.push(() => resizeObserver.disconnect());

    const intersection = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (!entry) return;
      this.onScreen = entry.isIntersecting;
      this.updateRunning();
    });
    intersection.observe(canvas);
    this.cleanups.push(() => intersection.disconnect());

    this.listen(document, "visibilitychange", () => {
      this.pageVisible = document.visibilityState !== "hidden";
      this.updateRunning();
    });
    this.pageVisible = document.visibilityState !== "hidden";

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    this.reducedMotion = media.matches;
    this.listen(media, "change", () => {
      this.reducedMotion = media.matches;
      this.applyMotionPreference();
    });

    this.listen(window, "pointermove", (event) => {
      const e = event as PointerEvent;
      const rect = canvas.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height * 0.45;
      this.pointerX = clamp((e.clientX - cx) / Math.max(1, window.innerWidth * 0.5), -1, 1);
      this.pointerY = clamp((e.clientY - cy) / Math.max(1, window.innerHeight * 0.5), -1, 1);
      this.pointerStamp = this.time;
    });

    // Drag to look around (`resetCamera()` eases back); a quick tap tickles the slime.
    let dragId = -1;
    let lastX = 0;
    let lastY = 0;
    let travelled = 0;
    let downAt = 0;
    this.listen(canvas, "pointerdown", (event) => {
      const e = event as PointerEvent;
      if (e.button !== 0) return;
      dragId = e.pointerId;
      lastX = e.clientX;
      lastY = e.clientY;
      travelled = 0;
      downAt = performance.now();
      canvas.setPointerCapture?.(e.pointerId);
    });
    this.listen(canvas, "pointermove", (event) => {
      const e = event as PointerEvent;
      if (e.pointerId !== dragId) return;
      const scale = 2.4 / Math.max(1, canvas.clientWidth);
      travelled += Math.abs(e.clientX - lastX) + Math.abs(e.clientY - lastY);
      this.orbitYawGoal = clamp(this.orbitYawGoal - (e.clientX - lastX) * scale, -ORBIT_YAW_LIMIT, ORBIT_YAW_LIMIT);
      this.orbitPitchGoal = clamp(this.orbitPitchGoal + (e.clientY - lastY) * scale, -ORBIT_PITCH_LIMIT, ORBIT_PITCH_LIMIT);
      lastX = e.clientX;
      lastY = e.clientY;
    });
    const endDrag = (event: Event): void => {
      if ((event as PointerEvent).pointerId !== dragId) return;
      dragId = -1;
      if (travelled < 6 && performance.now() - downAt < 400) this.poke();
    };
    this.listen(canvas, "pointerup", endDrag);
    this.listen(canvas, "pointercancel", () => {
      dragId = -1;
    });

    this.listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.updateRunning();
    });
    this.listen(canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      this.updateRunning();
    });
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void): void {
    target.addEventListener(type, handler, { passive: type !== "webglcontextlost" });
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private applyMotionPreference(): void {
    if (this.reducedMotion) {
      this.intro = 1;
      this.introV = 0;
      this.greetIn = -1;
    }
  }

  // -- Loop --

  private updateRunning(): void {
    const shouldRun = !this.disposed && this.pageVisible && this.onScreen && !this.contextLost;
    if (shouldRun === this.running) return;
    this.running = shouldRun;
    if (shouldRun) {
      this.lastFrame = performance.now(); // drop the time spent paused
      this.rafId = requestAnimationFrame(this.tick);
    } else {
      cancelAnimationFrame(this.rafId);
    }
  }

  private readonly tick = (now: number): void => {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.tick);
    const raw = Math.max(0, (now - this.lastFrame) / 1000);
    this.lastFrame = now;
    // After a long stall, never integrate the springs over one huge step.
    const dt = Math.min(raw, 1 / 30);
    this.frameMs += (raw * 1000 - this.frameMs) * 0.05;
    this.animate(dt);
    this.renderFrame();
  };

  private renderFrame(): void {
    this.renderer.render(this.scene, this.camera);
    this.frames++;
  }

  private resize(): void {
    const { canvas, renderer, camera } = this;
    const width = Math.max(1, canvas.clientWidth);
    const height = Math.max(1, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    const halfFov = Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);
    const forHeight = (HALF_HEIGHT * FRAME_MARGIN) / halfFov;
    const forWidth = (HALF_WIDTH * FRAME_MARGIN) / (halfFov * camera.aspect);
    this.cameraDistance = Math.max(forHeight, forWidth);
    this.placeCamera();
  }

  private placeCamera(): void {
    const pitch = BASE_PITCH + this.orbitPitch;
    const cosPitch = Math.cos(pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.orbitYaw) * cosPitch * this.cameraDistance,
      this.focus.y + Math.sin(pitch) * this.cameraDistance,
      this.focus.z + Math.cos(this.orbitYaw) * cosPitch * this.cameraDistance,
    );
    this.camera.lookAt(this.focus);
  }

  // -- Moves --

  /** A hop: the jelly springs up and wobbles back down. */
  private hop(power: number): void {
    this.av += 3.5 * power;
    this.energy = Math.min(1, this.energy + 0.8 * power);
  }

  /** A tap: it squashes, giggles and its eyes close into a smile. */
  private poke(): void {
    if (this.reducedMotion) return;
    this.av -= 2.4;
    this.energy = 1;
    this.happy = 0.9;
  }

  // -- Animation --

  private animate(dt: number): void {
    this.time += dt;
    const t = this.time;
    const target = MOODS[this.state];
    const cur = this.mood;

    this.motion = damp(this.motion, this.reducedMotion ? 0.25 : 1, 4, dt);
    const m = this.motion;
    for (const key of MOOD_KEYS) cur[key] = damp(cur[key], target[key], key === "follow" ? 4 : 5, dt);
    // The conversation face eases in a little slower than the state: it should never snap.
    const goal = FACES[this.expression];
    for (const key of FACE_KEYS) this.face[key] = damp(this.face[key], goal[key], 4, dt);

    this.orbitYaw = damp(this.orbitYaw, this.orbitYawGoal, 7, dt);
    this.orbitPitch = damp(this.orbitPitch, this.orbitPitchGoal, 7, dt);
    this.placeCamera();

    // The eyes and body follow the pointer while it is moving, then drift back to the camera.
    const fresh = t - this.pointerStamp < 5;
    this.followX = damp(this.followX, fresh ? this.pointerX : 0, 5, dt);
    this.followY = damp(this.followY, fresh ? this.pointerY : 0, 5, dt);
    const follow = this.reducedMotion ? 0 : cur.follow;
    const fx = this.followX * follow;
    const fy = this.followY * follow;

    this.lipSync.update(dt, performance.now());
    this.emphasis = damp(this.emphasis, this.lipSync.openness, 9, dt);
    this.talk = damp(this.talk, this.state === "speaking" ? 1 : 0, 6, dt);

    if (this.greetIn > 0) {
      this.greetIn -= dt;
      if (this.greetIn <= 0) {
        this.hop(0.9); // greets once, right after the pop-in, with a wink
        this.wink = WINK_TIME;
      }
    }

    const lift = this.animateBody(t, dt, m, fx);
    this.animateFace(dt, fx, fy);
    this.animateParts(t, lift);
  }

  /** Squash and stretch with the jelly spring, wobble of the surface, tilt and pop-in. Returns the lift off the floor. */
  private animateBody(t: number, dt: number, m: number, fx: number): number {
    const cur = this.mood;
    const w = cur.expr;
    const breathe = Math.sin(t * Math.PI * 2 * cur.breathe);
    // The body stretches on every syllable and relaxes between them: it bounces in time with the voice.
    const talk = (this.lipSync.openness - 0.28) * 0.1;
    const goal = cur.stretch + this.face.stretch * w + (breathe * 0.024 + talk) * m;
    this.av += (-SPRING_K * (this.a - goal) - SPRING_C * this.av) * dt;
    this.a = clamp(this.a + this.av * dt, -0.3, 0.26);
    this.energy *= Math.exp(-1.4 * dt);

    this.introV += (-POP_K * (this.intro - 1) - POP_C * this.introV) * dt;
    this.intro += this.introV * dt;
    const g = Math.max(0.001, this.intro);

    const sy = 1 + this.a;
    const sxz = 1 / Math.sqrt(sy); // the volume stays the same: taller means thinner
    const lift = Math.max(0, this.a - 0.04);
    this.rig.scale.set(sxz * g, sy * g, sxz * g);
    this.rig.position.y = lift * g;

    const drift = Math.sin(t * 0.43) + 0.5 * Math.sin(t * 1.07 + 1.3);
    const nod = Math.sin(t * 5.2) * this.emphasis * 0.03 * m;
    const roll = cur.roll + this.face.roll * w;
    this.rig.rotation.set(cur.lean + nod, fx * 0.2, roll + cur.sway * Math.sin(t * 1.15) * m + drift * 0.01 * m);

    // The top lags behind the base: that is what makes it read as jelly and not as a balloon.
    const amp = (0.01 + 0.03 * this.energy + 0.018 * this.emphasis) * m;
    const shear = (0.02 * Math.sin(t * 0.8) + cur.sway * 1.2 * Math.sin(t * 1.15 - 0.6)) * m;
    this.wobble(t, amp, shear);

    this.shadow.scale.set(2.35 * sxz * g, 1.35 * sxz * g, 1);
    (this.shadow.material as MeshBasicMaterial).opacity = clamp(1 - lift * 2.2, 0.35, 1);
    return lift * g;
  }

  /** Ripples the surface. The base stays planted and the face area stays calm, so the eyes never sink. */
  private wobble(t: number, amp: number, shear: number): void {
    const out = this.bodyPosition.array as Float32Array;
    const base = this.bodyBase;
    const normals = this.bodyNormals;
    const crown = this.topY * 0.78;
    const faceY = this.centerY + 0.05;
    const shine = this.shineDir;
    for (let i = 0; i < base.length; i += 3) {
      const bx = base[i] ?? 0;
      const by = base[i + 1] ?? 0;
      const bz = base[i + 2] ?? 0;
      const nx = normals[i] ?? 0;
      const ny = normals[i + 1] ?? 0;
      const nz = normals[i + 2] ?? 0;
      const grounded = smoothstep(0.1, crown, by);
      const face = 1 - 0.75 * smoothstep(0.45, 0.85, nz) * (1 - smoothstep(0.35, 0.8, Math.abs(by - faceY)));
      // The painted highlight sits on a calm patch too, so the ripples never swallow it.
      const calm = 1 - 0.85 * smoothstep(0.86, 0.97, nx * shine.x + ny * shine.y + nz * shine.z);
      const w = amp * grounded * face * calm * (Math.sin(by * 3.4 + bx * 2.1 + t * 3.1) + 0.7 * Math.sin(bz * 3.8 - bx * 1.9 + t * 2.3 + 1.7));
      out[i] = bx + nx * w + shear * grounded * grounded;
      out[i + 1] = by + ny * w;
      out[i + 2] = bz + nz * w;
    }
    this.bodyPosition.needsUpdate = true;
  }

  private animateFace(dt: number, fx: number, fy: number): void {
    const cur = this.mood;
    const face = this.face;
    const look = this.look.face;
    const w = cur.expr;

    const gx = cur.gazeX + fx * 0.9;
    const gy = cur.gazeY + face.gazeY * w - fy * 0.6;
    const faceU = clamp(gx, -1, 1) * 0.15;
    const faceV = clamp(gy, -1, 1) * 0.075;

    this.happy = Math.max(0, this.happy - dt);
    const giggle = smooth01(clamp(this.happy / 0.35, 0, 1));
    this.wink = Math.max(0, this.wink - dt);
    const wink = smooth01(clamp(Math.min(this.wink, WINK_TIME - this.wink) / 0.12, 0, 1));

    // Eyes: the state sets how open they are; the face adds size, lids, slant and joy.
    const awake = clamp(cur.eyeOpen * lerp(1, face.eyeOpen, w) * (1 - 0.93 * this.updateBlink(dt)), 0, 1);
    const size = cur.eyeSize * lerp(1, face.eyeSize, w);
    const lid = clamp(cur.lid + face.lid * w, 0, 1);
    const tilt = cur.eyeTilt + face.lidTilt * w;
    const asym = face.asym * w;
    const joy = clamp(face.closed * w + giggle, 0, 1);

    for (const eye of this.eyes) {
      const puzzled = eye.side < 0 ? asym : 0;
      const s = size * (1 - 0.22 * puzzled + (eye.side > 0 ? 0.08 * asym : 0));
      const shut = Math.max(joy, eye.side > 0 ? wink : 0);
      const open = clamp(awake * (1 - shut), 0, 1);
      const eyeLid = clamp(lid + 0.25 * puzzled, 0, 1);
      // The eyes lead the gaze a little more than the rest of the face.
      this.placeOn(eye.anchor, eye.side * look.eyeU + faceU * 1.35, look.eyeV + faceV * 1.35, 0.014);
      eye.shape.visible = open > 0.12;
      eye.shape.scale.set(s, s * Math.max(open, 0.02), 1);
      eye.shape.rotation.z = -eye.side * tilt * 0.3;

      eye.lid.visible = eyeLid > 0.01;
      eye.lidPivot.rotation.z = -eye.side * tilt;
      eye.lid.position.y = look.eyeRY * s * (1.15 - 1.5 * eyeLid) + LID_HEIGHT / 2;

      // Closed: a "^" when it is from joy, a soft "‿" when it is from sleep or a blink.
      const closing = smoothstep(0.4, 0.1, open);
      eye.closed.group.visible = closing > 0.02;
      if (eye.closed.group.visible) {
        const fromJoy = shut / Math.max(1e-3, shut + (1 - awake));
        const bend = look.eyeRY * s * lerp(0.35, -0.95, fromJoy);
        eye.closed.update(look.eyeRX * s * 1.2, bend, 0.032 * (0.4 + 0.6 * closing));
      }
    }

    // Mouth. While it speaks the visemes own it: the five vowel weights shape an ellipse
    // (tall for o/u, wide for e/i, big for a). Large on purpose, so the lips can be followed.
    const v = this.lipSync.weights;
    const talkH = 0.22 * v.aa + 0.18 * v.oh + 0.17 * v.ou + 0.08 * v.ee + 0.065 * v.ih;
    const talkHalf = 0.07 + 0.08 * v.aa + 0.09 * v.ee + 0.08 * v.ih - 0.03 * v.ou - 0.022 * v.oh;
    const talking = smoothstep(0.004, 0.04, talkH);
    // At rest the face may open it: a "D" grin (joy, a tickle) or a small "o" (surprise).
    const rest = 1 - this.talk;
    const grin = clamp(face.grin * w * rest + giggle, 0, 1);
    const oh = clamp(face.oh * w * rest, 0, 1);
    const widthK = lerp(1, face.mouthWidth, w);
    const curve = lerp(cur.curve, face.curve, w);

    const half = Math.max(talking * talkHalf, grin * 0.2 * widthK, oh * 0.052);
    const top = Math.max(talkH, grin * 0.014, oh * 0.06);
    const bottom = Math.max(talkH, grin * 0.22, oh * 0.066);
    const bend = 0.04 * grin * Math.max(0, curve) + 0.012 * curve * talking;
    const opened = smoothstep(0.012, 0.03, bottom);
    this.placeOn(this.mouthAnchor, faceU * 0.9 + cur.mouthShift, look.mouthV + faceV * 0.9 - 0.3 * top, 0.012);
    this.mouthAnchor.rotateZ(face.skew * w);
    this.mouthOpen.visible = opened > 0.01;
    if (this.mouthOpen.visible) {
      this.mouthShape.update(half, top, bottom, bend);
      // The tongue rests at the bottom of a wide-open mouth; a small "o" shows none.
      const tongue = clamp(grin + talking * 0.9, 0, 1);
      this.tongue.visible = tongue > 0.05;
      this.tongue.scale.set(half * 0.72, Math.max(0.001, bottom * 0.6 * tongue), 1);
      this.tongue.position.y = -bottom * 0.98 + bend * 0.3;
    }

    // The line between words: smile, flat or frown. It folds away as the mouth opens.
    const fold = 1 - opened;
    this.smile.group.visible = fold > 0.02;
    if (this.smile.group.visible) {
      const lineHalf = 0.085 * (1 + 0.15 * Math.abs(curve)) * widthK;
      this.smile.update(lineHalf * (0.4 + 0.6 * fold), 0.055 * curve, 0.028);
      this.smile.group.position.y = -0.012 * curve;
    }

    const blush = clamp(cur.blush + face.blush * w + 0.3 * giggle, 0, 1.2);
    for (const b of this.blushes) {
      this.placeOn(b.anchor, b.side * look.blushU + faceU * 0.7, look.blushV + faceV * 0.7, 0.008);
    }
    this.blushMaterial.opacity = look.blushStrength * clamp(0.15 + blush * 0.75, 0, 1);
  }

  /** Inner light, the tint when it fails, sleeping "z" and the thinking dots. */
  private animateParts(t: number, lift: number): void {
    const cur = this.mood;
    // Only the state greys the body (a failure), never a conversation face.
    const sad = clamp(-cur.curve, 0, 1);

    this.gelMaterial.emissiveIntensity = (0.03 + 0.07 * cur.glow) * (1 - 0.6 * sad);
    this.gelMaterial.color.copy(this.white).lerp(this.sadColor, 0.45 * sad);

    // Sleeping "z": only while the eyes are shut by the state, each one drifting up and fading out.
    const sleepy = 1 - smoothstep(0.14, 0.5, cur.eyeOpen);
    this.zeds.forEach((sprite, i) => {
      const phase = (t * 0.45 + i / 3) % 1;
      sprite.visible = sleepy > 0.02 && !this.reducedMotion;
      sprite.position.set(0.5 + 0.2 * phase + 0.05 * Math.sin(phase * 6), this.topY - 0.2 + lift + 0.6 * phase, 0.15);
      const scale = (0.1 + 0.2 * phase) * sleepy;
      sprite.scale.set(scale, scale, 1);
      (sprite.material as SpriteMaterial).opacity = sleepy * Math.sin(phase * Math.PI) * 0.9;
    });

    // Thinking dots: a typing-indicator rhythm above the head.
    const think = cur.think;
    this.dots.visible = think > 0.02;
    this.dots.position.y = this.topY + 0.4 + lift;
    this.dotMeshes.forEach((dot, i) => {
      const pulse = 0.55 + 0.45 * Math.max(0, Math.sin(t * 4.4 - i * 0.95));
      dot.scale.setScalar(Math.max(0.001, think * pulse));
    });
  }

  private updateBlink(dt: number): number {
    const CLOSE = 0.07;
    const OPEN = 0.13;
    if (this.blinkPhase < 0) {
      this.blinkIn -= dt;
      if (this.blinkIn <= 0) this.blinkPhase = 0;
      this.blinkValue = 0;
    } else {
      this.blinkPhase += dt;
      const p = this.blinkPhase;
      if (p < CLOSE) this.blinkValue = smooth01(p / CLOSE);
      else if (p < CLOSE + OPEN) this.blinkValue = 1 - smooth01((p - CLOSE) / OPEN);
      else {
        this.blinkValue = 0;
        this.blinkPhase = -1;
        this.blinkIn = (this.state === "thinking" ? 1.6 : 2.6) + Math.random() * 3.2;
      }
    }
    return this.blinkValue;
  }
}

/**
 * Builds the slime and starts rendering it into `canvas`.
 *
 * The canvas must be sized by CSS; the drawing buffer follows it. Rejects with
 * an `AvatarError` when WebGL is unavailable, so the caller can keep the orb.
 */
export async function mountSlime(canvas: HTMLCanvasElement, opts: MountAvatarOptions = {}): Promise<AvatarHandle> {
  const report = (p: number): void => {
    try {
      opts.onProgress?.(p);
    } catch {
      // A faulty progress callback must not break the mount.
    }
  };
  report(0);
  const renderer = createRenderer(canvas);
  try {
    const slime = new Slime(canvas, renderer);
    if (typeof location !== "undefined" && new URLSearchParams(location.search).has("avatarDemo")) slime.setDemoSpeech(true);
    report(1);
    return slime;
  } catch (cause) {
    renderer.dispose();
    throw cause instanceof AvatarError ? cause : new AvatarError("invalid-model", "The slime could not be set up.", cause);
  }
}
