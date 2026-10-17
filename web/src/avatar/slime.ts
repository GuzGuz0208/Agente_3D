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
 * Touch and mouse (rules in `gestures.ts`). A press that starts ON the body is
 * the slime's; a press that starts OFF the body turns the camera (outside play
 * mode), as before:
 *   tap            giggles ("^ ^" and an open grin), or now and then (always
 *                  when poked near an eye) an "ouch": a squeeze and "> <".
 *   rub            side-to-side strokes: relaxed "^ ^", rosier cheeks and a soft
 *                  purr-like tremble, while rubbed and a little after.
 *   hold (~0.8 s)  it melts into a glossy puddle, eyes sliding down; on release
 *                  it pulls itself back together with a bounce.
 *   drag           it is pulled towards the finger (carried, in play mode) and
 *                  the finger leaves a pink, glossy trail that fades in ~6 s.
 * None of this touches the conversation: gestures only animate the body.
 *
 * Play mode (`setPlayMode`): the camera pulls back and the body moves freely in
 * the frame (`physics.ts`): gravity from `setTilt`, soft hits against the edges
 * of what is visible, a splash of goo and an `onImpact` per hit; it can be
 * caught, dragged and thrown. Off again, it springs back to its spot. The
 * container may keep the bottom of the frame for its own controls with the CSS
 * custom property `--avatar-clear-bottom` (CSS pixels): the floor is raised by it.
 *
 * `eatOrb` is the entrance when the person switches from the orb to the slime:
 * it hops in from the left, lands beside the orb that is on screen (the page's
 * own orb, not a copy), looks at it and opens wide; the page then flies that orb
 * into its mouth (`onBite`, which also says where the eyes are, so the orb can go
 * round them), and it gulps, puffs its cheeks, looks pleased and hops back to its
 * spot (about two and a half seconds).
 *
 * With `prefers-reduced-motion` all of this is reduced to the minimum: no trail,
 * a short shallow melt, no bounces or spins, and no entrance at all.
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
  Matrix4,
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
import { GestureTracker, type GestureEvent, type PointerSample } from "./gestures";
import { GooLayer } from "./goo";
import { LipSync, VISEMES } from "./lipsync";
import {
  angleDelta,
  frameBox,
  gravityFromTilt,
  MAX_TILT,
  stepSoftBody,
  uprightAngle,
  type Box,
  type Impact,
  type SoftBody,
  type Spring,
  type StepResult,
  type Vec2,
} from "./physics";
import {
  AvatarError,
  type AvatarDebugInfo,
  type AvatarExpression,
  type AvatarHandle,
  type AvatarState,
  type EatOrbOptions,
  type MountAvatarOptions,
  type OrbBite,
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
    /** Inside of the open mouth, and the tongue: darker than the body, lighter than the mouth. */
    mouth: number;
    tongue: number;
    /** Thinking dots and sleeping "z". */
    dots: number;
    /** The orb it eats when it replaces it. */
    orb: number;
    blush: Rgb;
    shadow: Rgb;
    /** The trail it leaves: body, rim and glint. */
    goo: { body: Rgb; deep: Rgb; shine: Rgb };
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
      tongue: 0xc9305f, // --rose-600
      dots: 0x7c6cf0, // --violet-500
      orb: 0x7c6cf0, // --violet-500
      blush: [248, 169, 193], // #f8a9c1
      shadow: [94, 17, 49], // --rose-900
      goo: { body: [229, 80, 125], deep: [168, 35, 79], shine: [255, 247, 250] },
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
const MOUTH_SEGMENTS = 56;
const WINK_TIME = 0.75;
/** Curvature of the front of the body under the mouth (radii, world units): the mouth hugs it. */
const FACE_CURVE_X = 0.95;
const FACE_CURVE_Y = 1.3;

// --- Play and gestures ------------------------------------------------------

/** The body as a ball for the physics: this radius, its centre this high above the base. */
const BODY_RADIUS = 0.94;
/** Play mode: the camera pulls back until the smaller half of the frame is this many world units. */
const PLAY_HALF = 2.9;
/** Gravity at full tilt, world units per second squared. */
const GRAVITY = 15;
/** Outside play mode a drag pulls the body at most this far: it stretches, it is not carried off. */
const MAX_PULL = 0.35;
const HOME_SPRING = { stiffness: 55, damping: 7.5 };
const PULL_SPRING = { stiffness: 160, damping: 16 };
const HOLD_SPRING = { stiffness: 260, damping: 20 };
/** Fastest throw, world units per second. */
const MAX_THROW = 16;
/** Hits closer together than this make one vibration. */
const IMPACT_GAP_MS = 70;
/**
 * The orb entrance (`eatOrb`), in seconds: two hops in from the left, the mouth opens, the orb
 * is sent in (`BITE_AT`, it takes `BITE_MS`), the mouth snaps shut, a gulp, a pleased face and
 * a hop back home.
 */
const HOP_IN = [0, 0.38, 0.45, 0.88] as const;
const BITE_AT = 0.98;
const BITE_MS = 520;
const SHUT_AT = BITE_AT + BITE_MS / 1000;
const HOP_HOME = [1.95, 2.35] as const;
const ENTRANCE_TIME = 2.6;
/** The melt: how much lower and how much wider (at the foot) the body gets when fully melted. */
const MELT_DROP = 0.55;
const MELT_SPREAD = 0.32;

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
const ZERO: Vec2 = { x: 0, y: 0 };
/** A hop of height `h` at progress `u` (0..1). */
const arc = (u: number, h: number): number => h * 4 * u * (1 - u);

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

/** Depth of the body surface below the tangent plane of a face piece, at local (x, y). */
const surfaceSag = (x: number, y: number): number => (x * x) / (2 * FACE_CURVE_X) + (y * y) / (2 * FACE_CURVE_Y);

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

  /** `curved`: follow the curve of the body (wide strokes, like the mouth line). */
  constructor(material: Material, cap: CircleGeometry, renderOrder: number, private readonly curved = false) {
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
    const lift = this.curved ? surfaceSag(h, 0) * 0.5 : 0;
    for (let i = 0; i <= n; i++) {
      const s = -1 + (2 * i) / n;
      const x = s * h;
      const y = bend * (s * s - 0.5);
      const slope = (2 * bend * s) / h;
      const len = Math.hypot(1, slope);
      const nx = -slope / len;
      const ny = 1 / len;
      const z = this.curved ? lift - surfaceSag(x, y) : 0;
      out[i * 6] = x + nx * r;
      out[i * 6 + 1] = y + ny * r;
      out[i * 6 + 2] = z;
      out[i * 6 + 3] = x - nx * r;
      out[i * 6 + 4] = y - ny * r;
      out[i * 6 + 5] = z;
    }
    this.position.needsUpdate = true;
    const capZ = this.curved ? lift - surfaceSag(h, bend * 0.5) : 0;
    this.capA.position.set(-h, bend * 0.5, capZ);
    this.capB.position.set(h, bend * 0.5, capZ);
    this.capA.scale.setScalar(r);
    this.capB.scale.setScalar(r);
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/**
 * A filled outline rewritten every frame: the open mouth, and the tongue inside it.
 *
 * The upper and the lower edge meet at the corners with vertical tangents, so the
 * corners are always round. `round` swells the upper edge near the corners (a soft
 * "D" whose top follows the smile instead of being cut flat), `bend` lifts the
 * corners, and the lower edge is a little fuller than an ellipse (a round bowl).
 * The surface sags like the body under it, so the outline hugs the jelly.
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

  /**
   * `top` and `bottom` are the heights above and below the corners at the middle; `bend` lifts
   * the corners; `round` swells the upper edge near them. `y0` is where the shape sits in the
   * face piece's frame (only for the sag of the surface).
   */
  update(half: number, top: number, bottom: number, bend: number, round = 0, y0 = 0): void {
    const n = MOUTH_SEGMENTS;
    const out = this.position.array as Float32Array;
    const cy = (top - bottom) * 0.5 + bend * 0.5;
    const lift = surfaceSag(half, y0) * 0.5;
    out[0] = 0;
    out[1] = cy;
    out[2] = lift - surfaceSag(0, cy + y0);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = half * c;
      const y = s >= 0 ? bend * c * c + top * s + round * (s - s * s) : bend * c * c - bottom * Math.pow(-s, 0.85);
      out[(i + 1) * 3] = x;
      out[(i + 1) * 3 + 1] = y;
      out[(i + 1) * 3 + 2] = lift - surfaceSag(x, y + y0);
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
  /** "^" when the eye is closed with joy, a soft "‿" when it is asleep, ">" "<" when it winces. */
  closed: Stroke;
}

/** What eating the orb does to the face and the body this frame (all 0 when it is not eating). */
interface EatFx {
  /** Looks at the orb, and where it is relative to the face (-1..1). */
  look: number;
  gazeX: number;
  gazeY: number;
  /** Eyes open even if the state has them shut. */
  awake: number;
  /** Mouth wide open. */
  open: number;
  /** Pleased: closed happy eyes, rosy cheeks. */
  sat: number;
  /** Inner violet glow after the gulp. */
  glow: number;
  /** Cheeks puffed out. */
  puff: number;
}

// --- Slime ------------------------------------------------------------------

class Slime implements AvatarHandle {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 60);
  private readonly lipSync = new LipSync();
  private readonly cleanups: Array<() => void> = [];
  private readonly owned: Array<{ dispose(): void }> = [];
  private readonly look: SlimeLook;

  /**
   * Placement, outermost first: `holder` at the centre of the physics body; `squashAxis`
   * and `squashUndo` flatten it along any direction (against a wall) or stretch it (pulled,
   * flying); `orient` turns its base towards the gravity; `lower` puts the base below the centre.
   */
  private readonly holder = new Group();
  private readonly squashAxis = new Group();
  private readonly squashUndo = new Group();
  private readonly orient = new Group();
  private readonly lower = new Group();
  /** Everything that squashes, stretches and tilts with the body, pivoting on the ground. */
  private readonly rig = new Group();
  private readonly shadow: Mesh;
  private readonly bodyBase: Float32Array;
  private readonly bodyNormals: Float32Array;
  private readonly bodyPosition: BufferAttribute;
  private readonly bodyNormal: BufferAttribute;
  private normalsBent = false;
  private readonly gelMaterial: MeshPhysicalMaterial;
  private readonly eyes: EyeRig[] = [];
  private readonly mouthAnchor = new Group();
  private readonly mouthOpen = new Group();
  private mouthShape!: MouthShape;
  private tongue!: MouthShape;
  private smile!: Stroke;
  private readonly blushes: Array<{ side: -1 | 1; anchor: Object3D }> = [];
  private readonly blushMaterial: MeshBasicMaterial;
  private readonly shineAnchor = new Group();
  private shineMesh!: Mesh;
  private readonly dots = new Group();
  private readonly dotMeshes: Mesh[] = [];
  private readonly zeds: Sprite[] = [];
  private goo: GooLayer | null = null;

  private readonly white = new Color(0xffffff);
  private readonly sadColor: Color;
  private readonly glowColor: Color;
  private readonly orbColor: Color;
  private readonly tmpNormal = new Vector3();
  private readonly tmpVec = new Vector3();
  private readonly tmpVec2 = new Vector3();
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
  /** Camera distance that fits the slime at rest, the one for play mode, and the current one. */
  private fitDistance = 6;
  private playDistance = 10;
  private distance = 6;

  private blinkIn = 1.8;
  private blinkPhase = -1;
  private blinkValue = 0;

  // Gestures: the press on the body, a camera drag off it, and where the finger is.
  private readonly gestures = new GestureTracker();
  private gesturePointer = -1;
  private orbitPointer = -1;
  private held = false;
  private readonly finger = { x: 0, y: 0 };
  private readonly pressWorld = { x: 0, y: 0 };
  private readonly pressClient = { x: 0, y: 0 };
  private readonly lastClient = { x: 0, y: 0 };
  private readonly grabOffset = { x: 0, y: 0 };
  /** Where along the body the rubbing hand is (-1 left .. 1 right): it leans into it. */
  private rubSide = 0;
  private lastPoke: "giggle" | "ouch" | null = null;

  // Reactions, each fading on its own.
  /** Seconds left of a giggle after a tap: closed happy eyes and an open grin. */
  private giggle = 0;
  /** Seconds left of an "ouch": squeezed, "> <". */
  private ouch = 0;
  /** Seconds left of a wince after a hard hit. */
  private wince = 0;
  /** 0 .. 1: contentment from being rubbed, and how long it is kept after the last stroke. */
  private pet = 0;
  private petHold = 0;
  /** 0 .. 1 while pressed on the body: a small dent. */
  private press = 0;
  /** The melt (0 solid .. 1 puddle; a little below 0 when it springs back up). */
  private melt = 0;
  private meltV = 0;
  private meltGoal = 0;
  /** Seconds into the orb entrance; -1 when there is none. */
  private eatT = -1;
  /** The orb entrance in progress: where the orb is (world), where it starts and lands, who to tell. */
  private entrance: {
    orb: Vec2 | null;
    from: number;
    land: number;
    onBite?: (bite: OrbBite) => void;
    bitten: boolean;
    done: () => void;
  } | null = null;
  private readonly eat: EatFx = { look: 0, gazeX: 0, gazeY: 0, awake: 0, open: 0, sat: 0, glow: 0, puff: 0 };
  private puff = 0;
  private puffV = 0;

  // Play mode.
  private play = false;
  private playBlend = 0;
  private readonly body: SoftBody = { x: 0, y: BODY_RADIUS, vx: 0, vy: 0, touching: 0 };
  private contact: StepResult["contact"] = null;
  /** Last tilt (until the first `setTilt`, upright), and a slow copy that only turns the body. */
  private tiltX = 0;
  private tiltY = 1;
  private uprightX = 0;
  private uprightY = 1;
  /** Roll of the whole body (play mode: its base turns towards the gravity) and its speed. */
  private theta = 0;
  private thetaV = 0;
  private playLean = 0;
  /** 0 .. 1: flying fast (round eyes, "o" mouth). */
  private flight = 0;
  /** Squash and stretch along any direction, as a symmetric 2x2 tensor (eases between directions). */
  private readonly deform = { xx: 0, xy: 0, yy: 0 };
  private readonly impactListeners = new Set<(strength: number) => void>();
  private lastImpactAt = -Infinity;
  private impacts = 0;
  /** The part of the canvas visible in its container, in normalised device coordinates. */
  private visibleNdc: Box = { left: -1, right: 1, bottom: -1, top: 1 };
  /** How far the body reaches from its centre towards each edge, measured on screen (play mode). */
  private readonly reach: Box = { left: BODY_RADIUS, right: BODY_RADIUS, bottom: BODY_RADIUS, top: BODY_RADIUS };
  private readonly reachMatrix = new Matrix4();
  private readonly rollMatrix = new Matrix4();
  private ndcCheckIn = 0;
  private gooSource: "finger" | "body" | null = null;

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
    this.orbColor = new Color(this.look.color.orb);
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
    this.bodyNormal = bodyGeometry.getAttribute("normal") as BufferAttribute;
    this.bodyNormal.setUsage(DynamicDrawUsage);
    this.bodyBase = Float32Array.from(this.bodyPosition.array as ArrayLike<number>);
    this.bodyNormals = Float32Array.from(this.bodyNormal.array as ArrayLike<number>);
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

    this.lower.position.y = -BODY_RADIUS;
    this.lower.add(this.rig);
    this.orient.add(this.lower);
    this.squashUndo.add(this.orient);
    this.squashAxis.add(this.squashUndo);
    this.holder.add(this.squashAxis);
    this.holder.position.set(0, BODY_RADIUS, 0);
    this.scene.add(this.shadow, this.holder, this.dots);

    try {
      this.goo = new GooLayer(canvas, this.look.color.goo);
    } catch {
      this.goo = null; // no 2D canvas: no trail, everything else still works
    }

    this.setupObservers();
    this.setupGestures();
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

  setPlayMode(on: boolean): void {
    if (this.disposed || on === this.play) return;
    this.finishEntrance();
    this.play = on;
    // A press in progress belonged to the other mode: let go of it.
    this.endPress(this.gestures.cancel());
    this.resetCamera();
    this.canvas.style.touchAction = on ? "none" : "pan-y";
    this.body.touching = 0;
    this.measureVisible(); // in play mode the container may keep the bottom edge for its controls
    if (on) this.hop(0.4); // "let's play"
  }

  /**
   * The whole gravity of play mode: (0, 1) upright or no sensor, (0, 0) flat on a table (it only
   * moves when dragged or shaken). Shakes come mixed in as short spikes, so it is capped, not smoothed.
   */
  setTilt(x: number, y: number): void {
    this.tiltX = Number.isFinite(x) ? clamp(x, -MAX_TILT, MAX_TILT) : 0;
    this.tiltY = Number.isFinite(y) ? clamp(y, -MAX_TILT, MAX_TILT) : 0;
  }

  onImpact(listener: (strength: number) => void): () => void {
    this.impactListeners.add(listener);
    return () => {
      this.impactListeners.delete(listener);
    };
  }

  /**
   * The orb entrance: hops in from the left and lands beside the orb that is on screen (`orb`,
   * client pixels), looks at it, opens wide and calls `onBite` with the place of its mouth; the
   * caller flies the orb in, and it gulps and hops home. Resolves when it is over. With reduced
   * motion, or in play mode, there is no entrance: it resolves at once.
   */
  eatOrb(options: EatOrbOptions = {}): Promise<void> {
    if (this.disposed || this.reducedMotion || this.play) return Promise.resolve();
    this.finishEntrance();
    return new Promise((resolve) => {
      const px = options.orb;
      const orb = px ? this.toWorld(px.x, px.y, { x: 0, y: 0 }) : null;
      const radius = px ? px.radius * this.worldPerPixel() : 0.5;
      const left = this.frameLeft();
      // Beside the orb, on its left, so the face stays in sight; never cut by the left edge.
      const beside = (orb?.x ?? 0.4) - (radius * 0.55 + BODY_RADIUS * 0.8);
      const land = clamp(beside, left + BODY_RADIUS * 1.0, -0.15);
      const from = left - BODY_RADIUS * 1.5; // fully out of the frame
      this.entrance = { orb, from, land, onBite: options.onBite, bitten: false, done: resolve };
      this.eatT = 0;
      this.greetIn = -1; // the entrance is the greeting
      this.intro = 1; // no pop-in: it hops in
      this.introV = 0;
      this.endPress(this.gestures.cancel());
      Object.assign(this.body, { x: from, y: BODY_RADIUS, vx: 0, vy: 0, touching: 0 });
    });
  }

  /** Ends the entrance where it is: the body at home, the promise resolved. */
  private finishEntrance(): void {
    const e = this.entrance;
    if (!e) return;
    this.entrance = null;
    this.eatT = -1;
    Object.assign(this.body, { x: 0, y: BODY_RADIUS, vx: 0, vy: 0, touching: 0 });
    e.done();
  }

  /** World x of the left edge of what the person sees, on the plane the body moves in. */
  private frameLeft(): number {
    const halfWidth = this.distance * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2) * this.camera.aspect;
    return this.focus.x + this.visibleNdc.left * halfWidth;
  }

  getDebugInfo(): AvatarDebugInfo {
    const mouth: Record<string, number> = {};
    for (const v of VISEMES) mouth[v] = Number(this.lipSync.weights[v].toFixed(3));
    const onScreen = this.toClient(this.tmpVec.set(this.body.x, this.body.y, 0), { x: 0, y: 0 });
    const reactions = [
      this.giggle > 0 ? "giggle" : "",
      this.ouch > 0 ? "ouch" : "",
      this.pet > 0.05 ? "pet" : "",
      this.melt > 0.05 ? "melt" : "",
      this.eatT >= 0 ? "eat" : "",
      this.play ? "play" : "",
    ].filter(Boolean);
    const info = {
      fps: Math.round(1000 / this.frameMs),
      frameMs: Number(this.frameMs.toFixed(2)),
      frames: this.frames,
      triangles: this.renderer.info.render.triangles,
      drawCalls: this.renderer.info.render.calls,
      state: this.state,
      mouth,
      expressions: [this.expression, ...reactions],
      modelName: "slime",
      vrmVersion: "procedural",
      // Extra, for diagnostics only (not part of the contract).
      slime: {
        gesture: this.gestures.phase,
        play: this.play,
        x: Number(this.body.x.toFixed(3)),
        y: Number(this.body.y.toFixed(3)),
        vx: Number(this.body.vx.toFixed(3)),
        vy: Number(this.body.vy.toFixed(3)),
        theta: Number(this.theta.toFixed(3)),
        melt: Number(this.melt.toFixed(3)),
        pet: Number(this.pet.toFixed(3)),
        impacts: this.impacts,
        eat: Number(this.eatT.toFixed(3)),
        goo: this.goo?.count ?? 0,
        box: this.play ? this.playBox() : null,
        /** Centre and radius of the body on screen, CSS pixels. */
        client: { x: Math.round(onScreen.x), y: Math.round(onScreen.y), r: Math.round(this.bodyPixels()) },
      },
    };
    return info;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.finishEntrance(); // nobody waits forever for an entrance that will not end
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.impactListeners.clear();
    this.goo?.dispose();
    this.goo = null;
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

  /** Width and height factors of the melt at rig height `y` (`m` < 0: taller and thinner). */
  private meltFactors(y: number, m: number): { s: number; k: number } {
    const h = clamp(y / this.topY, 0, 1);
    return { s: 1 + m * (0.12 + MELT_SPREAD * 0.62 * (1 - h) * (1 - h)), k: 1 - MELT_DROP * m };
  }

  /** Moves a face piece with the melting surface; `slip` slides it further down. */
  private meltPlace(object: Object3D, slip = 0): void {
    const m = this.melt;
    if (Math.abs(m) < 1e-4 && slip === 0) return;
    const p = object.position;
    const { s, k } = this.meltFactors(p.y, m);
    p.set(p.x * s, p.y * k - slip, p.z * s + 0.012 * Math.max(0, m));
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
    // Lines and the mouth are drawn on top of the body (render order), never cut by it: the body
    // curves away under a wide mouth, and a depth test would clip its corners and its bottom.
    const inkMaterial = this.own(new MeshBasicMaterial({ color: color.eye, side: DoubleSide, depthTest: false }));
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
    this.smile = new Stroke(inkMaterial, cap, 22, true);
    this.owned.push(this.smile);
    const cavityMaterial = this.own(
      new MeshBasicMaterial({
        color: color.mouth,
        side: DoubleSide,
        depthTest: false,
        stencilWrite: true,
        stencilRef: 1,
        stencilFunc: AlwaysStencilFunc,
        stencilZPass: ReplaceStencilOp,
      }),
    );
    this.mouthShape = new MouthShape(cavityMaterial);
    this.owned.push(this.mouthShape);
    this.mouthShape.mesh.renderOrder = 21;
    // The tongue: a small dark-rose mound at the bottom, clipped by the stencil to the inside of the mouth.
    this.tongue = new MouthShape(
      this.own(
        new MeshBasicMaterial({
          color: color.tongue,
          side: DoubleSide,
          depthTest: false,
          stencilWrite: true,
          stencilRef: 1,
          stencilFunc: EqualStencilFunc,
        }),
      ),
    );
    this.owned.push(this.tongue);
    this.tongue.mesh.renderOrder = 22;
    this.mouthOpen.add(this.mouthShape.mesh, this.tongue.mesh);
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
    const mesh = new Mesh(this.own(new CircleGeometry(1, 32)), material);
    mesh.scale.set(spot.sx, spot.sy, 1);
    mesh.rotation.z = spot.roll;
    mesh.renderOrder = 16;
    this.shineMesh = mesh;
    this.shineAnchor.add(mesh);
    this.placeShine();
    this.rig.add(this.shineAnchor);
  }

  /**
   * The highlight is where the light is, upper left on screen: when the body rolls (play mode)
   * it slides round the surface the other way, and it follows the melt.
   */
  private placeShine(): void {
    const spot = this.look.face.shine;
    const c = Math.cos(-this.theta);
    const s = Math.sin(-this.theta);
    this.placeOn(this.shineAnchor, spot.u * c - spot.v * s, spot.u * s + spot.v * c, 0.01);
    this.shineMesh.rotation.z = spot.roll - this.theta;
    this.shineDir.set(0, 0, 1).applyQuaternion(this.shineAnchor.quaternion);
    this.meltPlace(this.shineAnchor);
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
      // A hand over the body says it can be grabbed.
      if (e.pointerType === "mouse" && e.target === canvas && this.gesturePointer < 0 && this.orbitPointer < 0) {
        canvas.style.cursor = this.hitBody(e.clientX, e.clientY) ? "grab" : "";
      }
    });

    this.listen(canvas, "webglcontextlost", (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.updateRunning();
    }, false);
    this.listen(canvas, "webglcontextrestored", () => {
      this.contextLost = false;
      this.updateRunning();
    });
  }

  /**
   * Touch and mouse. Rule: a press that starts on the body is a gesture for the slime
   * (`gestures.ts`); a press that starts off the body turns the camera, except in play
   * mode, where the camera stays put and only the body can be grabbed.
   */
  private setupGestures(): void {
    const { canvas } = this;
    canvas.style.touchAction = "pan-y";
    canvas.style.userSelect = "none";
    canvas.style.setProperty("-webkit-user-select", "none");
    canvas.style.setProperty("-webkit-touch-callout", "none");

    // A touch that starts on the slime (or anywhere in play mode) is ours: no page scroll, no long-press menu.
    this.listen(canvas, "touchstart", (event) => {
      const e = event as TouchEvent;
      const touch = e.touches[0];
      if (touch && e.cancelable && (this.play || this.hitBody(touch.clientX, touch.clientY))) e.preventDefault();
    }, false);
    this.listen(canvas, "contextmenu", (event) => {
      if (this.gesturePointer >= 0) event.preventDefault();
    }, false);

    let lastX = 0;
    let lastY = 0;
    this.listen(canvas, "pointerdown", (event) => {
      const e = event as PointerEvent;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (this.gesturePointer >= 0 || this.orbitPointer >= 0) return; // one press at a time
      if (this.hitBody(e.clientX, e.clientY)) {
        this.gesturePointer = e.pointerId;
        this.toWorld(e.clientX, e.clientY, this.pressWorld);
        this.finger.x = this.pressWorld.x;
        this.finger.y = this.pressWorld.y;
        this.pressClient.x = this.lastClient.x = e.clientX;
        this.pressClient.y = this.lastClient.y = e.clientY;
        this.gestures.down(this.sample(e, true), this.bodyPixels());
        if (this.play) this.grab(); // it is moving: catch it at once
        this.liftGoo();
        if (e.pointerType === "mouse") canvas.style.cursor = "grabbing";
      } else if (!this.play) {
        this.orbitPointer = e.pointerId;
        lastX = e.clientX;
        lastY = e.clientY;
      } else {
        return;
      }
      canvas.setPointerCapture?.(e.pointerId);
    });
    this.listen(canvas, "pointermove", (event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.gesturePointer) {
        this.toWorld(e.clientX, e.clientY, this.finger);
        this.lastClient.x = e.clientX;
        this.lastClient.y = e.clientY;
        this.handleGestures(this.gestures.move(this.sample(e)));
        const phase = this.gestures.phase;
        if (phase === "rub") this.rubSide = clamp((this.finger.x - this.body.x) / BODY_RADIUS, -1, 1);
        // Outside play mode the finger leaves the trail; in play mode the body does (see `stepPhysics`).
        if (phase === "drag" && !this.play) this.trailGoo("finger", e.clientX, e.clientY);
      } else if (e.pointerId === this.orbitPointer) {
        const scale = 2.4 / Math.max(1, canvas.clientWidth);
        this.orbitYawGoal = clamp(this.orbitYawGoal - (e.clientX - lastX) * scale, -ORBIT_YAW_LIMIT, ORBIT_YAW_LIMIT);
        this.orbitPitchGoal = clamp(this.orbitPitchGoal + (e.clientY - lastY) * scale, -ORBIT_PITCH_LIMIT, ORBIT_PITCH_LIMIT);
        lastX = e.clientX;
        lastY = e.clientY;
      }
    });
    const end = (event: Event, cancelled: boolean): void => {
      const e = event as PointerEvent;
      if (e.pointerId === this.gesturePointer) {
        this.endPress(cancelled ? this.gestures.cancel() : this.gestures.up(this.sample(e)));
        if (e.pointerType === "mouse") canvas.style.cursor = this.hitBody(e.clientX, e.clientY) ? "grab" : "";
      } else if (e.pointerId === this.orbitPointer) {
        this.orbitPointer = -1;
      }
    };
    this.listen(canvas, "pointerup", (event) => end(event, false));
    this.listen(canvas, "pointercancel", (event) => end(event, true));
    this.listen(canvas, "lostpointercapture", (event) => end(event, true));
  }

  private listen(target: EventTarget, type: string, handler: (event: Event) => void, passive = true): void {
    target.addEventListener(type, handler, { passive });
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }

  private applyMotionPreference(): void {
    if (this.reducedMotion) {
      this.intro = 1;
      this.introV = 0;
      this.greetIn = -1;
      this.goo?.clear();
      this.meltGoal = Math.min(this.meltGoal, 0.22);
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
    this.goo?.render(performance.now());
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
    this.fitDistance = Math.max(forHeight, forWidth);
    // Play mode: the smaller half of the frame is PLAY_HALF, whichever way the screen is turned.
    this.playDistance = Math.max(this.fitDistance * 1.3, PLAY_HALF / (halfFov * Math.min(1, camera.aspect)));
    this.placeCamera();
    this.measureVisible();
    this.goo?.layout();
  }

  /**
   * Which part of the canvas the person actually sees (its container clips it, a zoom may enlarge it),
   * less the strip at the bottom that the container keeps for its controls in play mode
   * (`--avatar-clear-bottom`, CSS pixels), so the body never rests under them.
   */
  private measureVisible(): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    const container = this.canvas.parentElement;
    const parent = container?.getBoundingClientRect();
    const keep = this.play && container ? Number.parseFloat(getComputedStyle(container).getPropertyValue("--avatar-clear-bottom")) : 0;
    const clearBottom = Number.isFinite(keep) && keep > 0 ? keep : 0;
    const left = Math.max(rect.left, parent?.left ?? -Infinity, 0);
    const right = Math.min(rect.right, parent?.right ?? Infinity, window.innerWidth);
    const top = Math.max(rect.top, parent?.top ?? -Infinity, 0);
    const bottom = Math.min(rect.bottom, (parent?.bottom ?? window.innerHeight) - clearBottom, window.innerHeight);
    if (right - left < 8 || bottom - top < 8) {
      this.visibleNdc = { left: -1, right: 1, bottom: -1, top: 1 };
      return;
    }
    this.visibleNdc = {
      left: ((left - rect.left) / rect.width) * 2 - 1,
      right: ((right - rect.left) / rect.width) * 2 - 1,
      top: 1 - ((top - rect.top) / rect.height) * 2,
      bottom: 1 - ((bottom - rect.top) / rect.height) * 2,
    };
  }

  private placeCamera(): void {
    const blend = smooth01(clamp(this.playBlend, 0, 1));
    this.distance = lerp(this.fitDistance, this.playDistance, blend);
    // In play mode the camera looks straight at the plane the body moves in.
    const pitch = (BASE_PITCH + this.orbitPitch) * (1 - blend);
    const cosPitch = Math.cos(pitch);
    this.camera.position.set(
      this.focus.x + Math.sin(this.orbitYaw) * cosPitch * this.distance,
      this.focus.y + Math.sin(pitch) * this.distance,
      this.focus.z + Math.cos(this.orbitYaw) * cosPitch * this.distance,
    );
    this.camera.lookAt(this.focus);
    this.camera.updateMatrixWorld();
  }

  /** Range of the body's centre in play mode: the visible frame, from the current camera, less the body's reach. */
  private playBox(): Box {
    return frameBox(
      {
        tanHalfFov: Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2),
        aspect: this.camera.aspect,
        distance: this.distance,
        center: { x: this.focus.x, y: this.focus.y },
        ndc: this.visibleNdc,
      },
      this.reach,
    );
  }

  /**
   * Measures how far the body reaches from its centre towards each edge, on screen: a sample of
   * its vertices projected through the camera. Without the squash (that is the contact itself, and
   * measuring it would let the body sink further into the wall), with the roll, the melt, the jelly
   * stretch and the perspective that makes the front of the body look wider off-centre.
   */
  private measureReach(dt: number): void {
    const tanHalf = Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);
    const hh = this.distance * tanHalf;
    const hw = hh * this.camera.aspect;
    this.lower.updateMatrix();
    this.rig.updateMatrix();
    const m = this.reachMatrix
      .makeTranslation(this.body.x, this.body.y, 0)
      .multiply(this.rollMatrix.makeRotationZ(this.theta))
      .multiply(this.lower.matrix)
      .multiply(this.rig.matrix);
    const pos = this.bodyPosition.array as Float32Array;
    const v = this.tmpVec;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i + 2 < pos.length; i += 3 * 11) {
      v.set(pos[i] ?? 0, pos[i + 1] ?? 0, pos[i + 2] ?? 0).applyMatrix4(m).project(this.camera);
      const x = this.focus.x + v.x * hw;
      const y = this.focus.y + v.y * hh;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    const r = this.reach;
    r.left = damp(r.left, this.body.x - minX, 20, dt);
    r.right = damp(r.right, maxX - this.body.x, 20, dt);
    r.bottom = damp(r.bottom, this.body.y - minY, 20, dt);
    r.top = damp(r.top, maxY - this.body.y, 20, dt);
  }

  // -- Screen <-> world --

  /** Where a client point falls on the plane the body moves in (z = 0). */
  private toWorld(clientX: number, clientY: number, out: { x: number; y: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const nx = ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    const ny = 1 - ((clientY - rect.top) / Math.max(1, rect.height)) * 2;
    const origin = this.camera.position;
    const dir = this.tmpVec2.set(nx, ny, 0.5).unproject(this.camera).sub(origin);
    const t = Math.abs(dir.z) > 1e-6 ? -origin.z / dir.z : 0;
    out.x = origin.x + dir.x * t;
    out.y = origin.y + dir.y * t;
    return out;
  }

  /** Client coordinates of a world point. */
  private toClient(world: Vector3, out: { x: number; y: number }): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const v = this.tmpVec2.copy(world).project(this.camera);
    out.x = rect.left + ((v.x + 1) / 2) * rect.width;
    out.y = rect.top + ((1 - v.y) / 2) * rect.height;
    return out;
  }

  /** World units per CSS pixel on the plane the body moves in. */
  private worldPerPixel(): number {
    const rect = this.canvas.getBoundingClientRect();
    const halfHeight = this.distance * Math.tan(MathUtils.degToRad(CAMERA_FOV) / 2);
    return (2 * halfHeight) / Math.max(1, rect.height);
  }

  /** Radius of the body on screen, CSS pixels: the gestures scale their distances with it. */
  private bodyPixels(): number {
    return BODY_RADIUS / this.worldPerPixel();
  }

  /** Whether a client point is over the body (a little generous; more so in play mode, where it moves). */
  private hitBody(clientX: number, clientY: number): boolean {
    const p = this.toWorld(clientX, clientY, { x: 0, y: 0 });
    if (this.play) return Math.hypot(p.x - this.body.x, p.y - this.body.y) < BODY_RADIUS * 1.3;
    const m = Math.max(0, this.melt);
    const top = this.topY * (1 - MELT_DROP * m);
    const baseY = this.body.y - BODY_RADIUS;
    const rx = BODY_RADIUS * (1 + MELT_SPREAD * m) * 1.06;
    const ry = (top / 2) * 1.06;
    const dx = (p.x - this.body.x) / rx;
    const dy = (p.y - (baseY + top / 2)) / ry;
    return dx * dx + dy * dy <= 1;
  }

  private sample(e: PointerEvent, onBody?: boolean): PointerSample {
    return { x: e.clientX, y: e.clientY, t: performance.now(), onBody: onBody ?? this.hitBody(e.clientX, e.clientY) };
  }

  // -- Gestures --

  private handleGestures(events: GestureEvent[]): void {
    for (const event of events) {
      if (event.type === "stroke") {
        // Every stroke adds a little contentment; it lasts a moment after the last one.
        this.pet = Math.min(1, this.pet + 0.24);
        this.petHold = 1.3;
      } else if (event.type === "start") {
        if (event.gesture === "hold") this.meltGoal = this.reducedMotion ? 0.22 : 1;
        else if (event.gesture === "drag") {
          this.meltGoal = 0;
          this.grab();
          // The trail starts where the press did, so none of the move is lost.
          if (!this.play) {
            this.liftGoo();
            this.trailGoo("finger", this.pressClient.x, this.pressClient.y);
            this.trailGoo("finger", this.lastClient.x, this.lastClient.y);
          }
        }
      } else {
        this.release(event);
      }
    }
  }

  /** Ends the press on the body, whatever it was. */
  private endPress(events: GestureEvent[]): void {
    this.handleGestures(events);
    this.gesturePointer = -1;
    this.held = false;
    this.meltGoal = 0;
    this.liftGoo();
  }

  private grab(): void {
    this.held = true;
    this.grabOffset.x = this.body.x - this.finger.x;
    this.grabOffset.y = this.body.y - this.finger.y;
  }

  private release(event: Extract<GestureEvent, { type: "end" }>): void {
    const wasHeld = this.held;
    this.held = false;
    switch (event.gesture) {
      case "tap":
        this.poke(this.lastClient.x, this.lastClient.y);
        break;
      case "hold":
        // Pulls itself back together, overshooting a little: taller for a moment, then a hop.
        this.meltGoal = 0;
        if (!this.reducedMotion) {
          this.meltV -= 2.5;
          this.hop(0.45);
        }
        break;
      case "drag":
        if (this.play && wasHeld && !this.reducedMotion) {
          // Thrown: the release speed of the finger, in world units, with a spin.
          const k = this.worldPerPixel();
          const vx = event.vx * k;
          const vy = -event.vy * k;
          const speed = Math.hypot(vx, vy);
          const cap = speed > MAX_THROW ? MAX_THROW / speed : 1;
          this.body.vx = vx * cap;
          this.body.vy = vy * cap;
          if (speed > 3) this.thetaV += clamp(-this.body.vx * 0.4, -9, 9);
        } else if (!this.reducedMotion) {
          this.energy = Math.min(1, this.energy + 0.5); // let go: it wobbles back into place
        }
        break;
      case "none":
        if (!this.reducedMotion) this.av -= 0.6;
        break;
      case "rub":
        break;
    }
  }

  /**
   * A tap. Mostly a giggle; now and then, and always when poked near an eye, an "ouch":
   * it squeezes up, eyes "> <", a small "o". Never three "ouch" in a row.
   */
  private poke(clientX: number, clientY: number): void {
    const px = this.worldPerPixel();
    const reach = (this.look.face.eyeRY * 2.2) / px;
    const nearEye = this.eyes.some((eye) => {
      const p = this.toClient(eye.anchor.getWorldPosition(this.tmpVec), { x: 0, y: 0 });
      return Math.hypot(p.x - clientX, p.y - clientY) < reach;
    });
    const ouch = nearEye || (this.lastPoke !== "ouch" && Math.random() < 0.3);
    this.lastPoke = ouch ? "ouch" : "giggle";
    if (this.reducedMotion) {
      // The minimum: a face, no bounce.
      if (ouch) this.ouch = 0.4;
      else this.giggle = 0.5;
      return;
    }
    this.energy = 1;
    if (ouch) {
      this.ouch = 0.75;
      this.av += 2.6; // squeezed: taller and thinner for a moment
    } else {
      this.giggle = 0.9;
      this.av -= 2.4;
    }
  }

  private liftGoo(): void {
    this.goo?.lift();
    this.gooSource = null;
  }

  private trailGoo(source: "finger" | "body", clientX: number, clientY: number): void {
    if (!this.goo || this.reducedMotion) return;
    if (this.gooSource !== source) this.goo.lift();
    this.gooSource = source;
    this.goo.trail(clientX, clientY, clamp(this.bodyPixels() * 0.11, 5, 18), performance.now());
  }

  // -- Moves --

  /** A hop: the jelly springs up and wobbles back down. */
  private hop(power: number): void {
    this.av += 3.5 * power;
    this.energy = Math.min(1, this.energy + 0.8 * power);
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

    this.playBlend = damp(this.playBlend, this.play ? 1 : 0, 2.6, dt);
    if (Math.abs(this.playBlend - (this.play ? 1 : 0)) < 1e-3) this.playBlend = this.play ? 1 : 0;
    if (this.play) {
      this.orbitYawGoal = 0;
      this.orbitPitchGoal = 0;
      this.ndcCheckIn -= dt;
      if (this.ndcCheckIn <= 0) {
        this.ndcCheckIn = 0.5; // the stage may have gone full screen or been zoomed
        this.measureVisible();
      }
    }
    this.orbitYaw = damp(this.orbitYaw, this.orbitYawGoal, 7, dt);
    this.orbitPitch = damp(this.orbitPitch, this.orbitPitchGoal, 7, dt);
    this.placeCamera();

    // The eyes and body follow the pointer while it is moving, then drift back to the camera.
    const fresh = t - this.pointerStamp < 5;
    this.followX = damp(this.followX, fresh ? this.pointerX : 0, 5, dt);
    this.followY = damp(this.followY, fresh ? this.pointerY : 0, 5, dt);
    const follow = this.reducedMotion ? 0 : cur.follow * (1 - this.playBlend);
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

    this.updateReactions(dt);
    this.updateEntrance(dt);
    this.stepPhysics(dt);
    const lift = this.animateBody(t, dt, m, fx);
    this.animateFace(t, dt, fx, fy);
    this.animateParts(t, lift);
    this.bite();
  }

  /** Timers of the reactions, the hold that fires without a move, and the melt spring. */
  private updateReactions(dt: number): void {
    if (this.gesturePointer >= 0) this.handleGestures(this.gestures.tick(performance.now()));
    this.giggle = Math.max(0, this.giggle - dt);
    this.ouch = Math.max(0, this.ouch - dt);
    this.wince = Math.max(0, this.wince - dt);
    if (this.petHold > 0) this.petHold -= dt;
    else this.pet = Math.max(0, this.pet - 0.5 * dt);
    const pressing = this.gesturePointer >= 0 && this.gestures.phase !== "drag";
    this.press = damp(this.press, pressing && !this.reducedMotion ? 1 : 0, 12, dt);

    // The melt sags slowly and springs back fast, with a bounce (critically damped with reduced motion).
    const goal = this.reducedMotion ? Math.min(this.meltGoal, 0.22) : this.meltGoal;
    const sagging = goal > this.melt;
    const k = sagging ? 22 : 70;
    const c = this.reducedMotion ? 2 * Math.sqrt(k) : sagging ? 9 : 6.5;
    this.meltV += (k * (goal - this.melt) - c * this.meltV) * dt;
    this.melt = clamp(this.melt + this.meltV * dt, -0.3, 1);
  }

  /**
   * The orb entrance, frame by frame: two hops in from the left to the spot beside the orb
   * (squashing on each landing, stretching on each take-off), eyes on the orb, the mouth opens
   * wide; at `BITE_AT` the page flies the orb in; the mouth snaps shut at `SHUT_AT`, the cheeks
   * puff, a gulp with a faint violet glow inside, a pleased face, and a hop back home.
   */
  private updateEntrance(dt: number): void {
    const fx = this.eat;
    const e = this.entrance;
    if (!e || this.eatT < 0) {
      fx.look = fx.awake = fx.open = fx.sat = fx.glow = fx.puff = 0;
      return;
    }
    const before = this.eatT;
    const t = (this.eatT += dt);
    const crossed = (at: number): boolean => before < at && t >= at;
    const homeY = BODY_RADIUS;

    // Where the body is: scripted, not simulated.
    const mid = lerp(e.from, e.land, 0.55);
    const [up1, down1, up2, down2] = HOP_IN;
    const [upHome, downHome] = HOP_HOME;
    let x = 0;
    let y = homeY;
    if (t < down1) {
      const u = clamp((t - up1) / (down1 - up1), 0, 1);
      x = lerp(e.from, mid, u);
      y = homeY + arc(u, 0.26);
    } else if (t < up2) {
      x = mid;
    } else if (t < down2) {
      const u = (t - up2) / (down2 - up2);
      x = lerp(mid, e.land, u);
      y = homeY + arc(u, 0.36);
    } else if (t < upHome) {
      x = e.land;
    } else if (t < downHome) {
      const u = (t - upHome) / (downHome - upHome);
      x = lerp(e.land, 0, u);
      y = homeY + arc(u, 0.26);
    }
    const body = this.body;
    if (dt > 0) {
      body.vx = (x - body.x) / dt;
      body.vy = (y - body.y) / dt;
    }
    body.x = x;
    body.y = y;
    // Take-offs stretch, landings squash.
    if (crossed(up1 + 1e-3) || crossed(up2)) this.av += 2.2;
    if (crossed(upHome)) this.av += 1.4;
    if (crossed(down1)) this.av -= 2.4;
    if (crossed(down2)) {
      this.av -= 2.8;
      this.energy = 1;
    }
    if (crossed(downHome)) this.av -= 1.8;

    // Eyes on the orb (or up and to the right, where it would be), mouth wide open for it.
    const orb = e.orb ?? { x: e.land + 1.2, y: homeY + 0.9 };
    const faceY = body.y - BODY_RADIUS + this.centerY;
    fx.gazeX = clamp((orb.x - body.x) / 0.8, -1, 1);
    fx.gazeY = clamp((orb.y - faceY) / 0.8, -1, 1);
    fx.look = smoothstep(0.2, 0.6, t) * (1 - smoothstep(SHUT_AT, SHUT_AT + 0.12, t));
    fx.awake = 1 - smoothstep(ENTRANCE_TIME - 0.3, ENTRANCE_TIME, t);
    fx.open = smoothstep(down2 - 0.05, BITE_AT, t) * (1 - smoothstep(SHUT_AT - 0.02, SHUT_AT + 0.06, t));
    fx.puff = smoothstep(SHUT_AT, SHUT_AT + 0.08, t) * (1 - smoothstep(SHUT_AT + 0.2, SHUT_AT + 0.42, t));
    fx.glow = smoothstep(SHUT_AT + 0.08, SHUT_AT + 0.22, t) * (1 - smoothstep(SHUT_AT + 0.3, SHUT_AT + 0.8, t));
    fx.sat = smoothstep(SHUT_AT + 0.28, SHUT_AT + 0.45, t) * (1 - smoothstep(ENTRANCE_TIME - 0.3, ENTRANCE_TIME, t));
    if (crossed(SHUT_AT + 0.1)) {
      this.av -= 2.4; // gulp
      this.energy = 1;
    }
    if (t >= ENTRANCE_TIME) this.finishEntrance();
  }

  /** Once the mouth is open wide: tells the page where it is, so the orb can fly in. */
  private bite(): void {
    const e = this.entrance;
    if (!e || e.bitten || this.eatT < BITE_AT) return;
    e.bitten = true;
    this.mouthAnchor.updateWorldMatrix(true, false);
    const centre = this.toClient(this.mouthAnchor.localToWorld(this.tmpVec.set(0, -0.1, 0.02)), { x: 0, y: 0 });
    const width = (0.17 * 1.3 * 2) / this.worldPerPixel();
    // The eyes on screen: the iris centre, and its farthest edge (it is an upright oval).
    const { eyeRX, eyeRY } = this.look.face;
    const eyes = this.eyes.map((eye) => {
      eye.shape.updateWorldMatrix(true, false);
      const c = this.toClient(eye.shape.localToWorld(this.tmpVec.set(0, 0, 0)), { x: 0, y: 0 });
      const top = this.toClient(eye.shape.localToWorld(this.tmpVec.set(0, eyeRY, 0)), { x: 0, y: 0 });
      const side = this.toClient(eye.shape.localToWorld(this.tmpVec.set(eyeRX, 0, 0)), { x: 0, y: 0 });
      const radius = Math.max(Math.hypot(top.x - c.x, top.y - c.y), Math.hypot(side.x - c.x, side.y - c.y));
      return { x: c.x, y: c.y, radius };
    });
    try {
      e.onBite?.({ x: centre.x, y: centre.y, width, eyes, closesIn: Math.max(0, Math.round((SHUT_AT - this.eatT) * 1000)) });
    } catch (err) {
      console.warn("[slime] onBite failed", err);
    }
  }

  /** Physics of the body: home, pulled, carried or free in play mode. Also its roll and the trail it leaves. */
  private stepPhysics(dt: number): void {
    const body = this.body;
    const homeY = BODY_RADIUS;
    if (this.entrance) {
      this.contact = null; // the entrance moves the body itself (`updateEntrance`)
      return;
    }
    const g = this.play ? gravityFromTilt(this.tiltX, this.tiltY, GRAVITY) : ZERO;
    // The roll follows the tilt slowly, so a shake throws the body without spinning it round.
    this.uprightX = damp(this.uprightX, this.tiltX, 3, dt);
    this.uprightY = damp(this.uprightY, this.tiltY, 3, dt);
    const up = gravityFromTilt(this.uprightX, this.uprightY, GRAVITY, 1);

    let spring: Spring | null = null;
    let box: Box | null = null;
    let gravity = ZERO;
    if (this.play) {
      box = this.playBox();
      if (this.held) spring = { x: this.finger.x + this.grabOffset.x, y: this.finger.y + this.grabOffset.y, ...HOLD_SPRING };
      else gravity = g;
    } else if (this.held) {
      // Pulled, not carried: the further the finger, the less the body follows.
      const dx = this.finger.x - this.pressWorld.x;
      const dy = this.finger.y - this.pressWorld.y;
      const length = Math.hypot(dx, dy);
      const reach = this.reducedMotion ? 0.12 : MAX_PULL;
      const k = length > 1e-6 ? (reach * Math.tanh(length / reach)) / length : 0;
      // Never through the floor: pulled down, it only leans that way.
      spring = { x: dx * k, y: homeY + Math.max(-0.04, dy * k), ...PULL_SPRING };
    } else {
      spring = { x: 0, y: homeY, ...HOME_SPRING };
    }

    const settled = !this.play && !this.held && Math.hypot(body.x, body.y - homeY) < 1e-4 && Math.hypot(body.vx, body.vy) < 1e-3;
    let result: StepResult = { impacts: [], contact: null };
    if (!settled) {
      // With the phone flat (little gravity) it lies on the glass: friction stops it soon.
      const flat = this.play ? 1 - clamp(Math.hypot(g.x, g.y) / GRAVITY, 0, 1) : 0;
      result = stepSoftBody(
        body,
        { radius: BODY_RADIUS, gravity, box, spring, wallDamping: this.reducedMotion ? 34 : 14, airDrag: 0.3 + 1.6 * flat },
        dt,
      );
    } else {
      body.x = 0;
      body.y = homeY;
      body.vx = body.vy = 0;
    }
    this.contact = result.contact;
    for (const hit of result.impacts) this.onHit(hit);

    // Roll: in play mode the base turns towards the gravity; in the air it tumbles for a moment.
    let goal = 0;
    let k = 30;
    let c = 8;
    if (this.play && !this.held) {
      goal = Math.hypot(up.x, up.y) > 0.3 * GRAVITY ? uprightAngle(up) : this.theta;
      if (!this.contact) {
        k = 5;
        c = 1.4;
      }
    } else if (this.play) {
      k = 8;
      c = 4;
    }
    if (this.reducedMotion) c = 2 * Math.sqrt(k);
    this.thetaV += (k * angleDelta(this.theta, goal) - c * this.thetaV) * dt;
    this.theta += this.thetaV * dt;
    if (this.theta > Math.PI) this.theta -= Math.PI * 2;
    else if (this.theta <= -Math.PI) this.theta += Math.PI * 2;

    const speed = Math.hypot(body.vx, body.vy);
    this.playLean = damp(this.playLean, this.play ? clamp(-body.vx * 0.03, -0.25, 0.25) : 0, 6, dt);
    this.flight = damp(this.flight, this.play && !this.contact && !this.held ? smoothstep(5, 10, speed) : 0, 8, dt);

    // The trail: in play mode the body smears the screen while it is dragged or slides along an edge.
    if (this.play && !this.reducedMotion && this.goo) {
      const c2 = this.contact;
      if (this.held && this.gestures.phase === "drag") {
        const p = this.toClient(this.tmpVec.set(body.x, body.y - BODY_RADIUS * 0.35, 0), { x: 0, y: 0 });
        this.trailGoo("body", p.x, p.y);
      } else if (c2 && speed > 0.9) {
        const p = this.toClient(this.tmpVec.set(body.x - c2.normal.x * BODY_RADIUS * 0.9, body.y - c2.normal.y * BODY_RADIUS * 0.9, 0), { x: 0, y: 0 });
        this.trailGoo("body", p.x, p.y);
      } else if (this.gooSource === "body") {
        this.liftGoo();
      }
    }
  }

  /** A hit against an edge: a splash of goo, a wobble, a wince if it was hard, and the listeners. */
  private onHit(hit: Impact): void {
    this.impacts++;
    const s = hit.strength;
    if (!this.reducedMotion) {
      this.energy = Math.min(1, this.energy + s);
      this.av -= 1.2 * s;
      if (s > 0.45) this.wince = Math.max(this.wince, 0.2 + 0.3 * s);
      if (this.goo && s > 0.12) {
        const p = this.toClient(this.tmpVec.set(hit.point.x, hit.point.y, 0), { x: 0, y: 0 });
        this.goo.splat(p.x, p.y, clamp(this.bodyPixels() * 0.16, 6, 24), s, performance.now(), { x: hit.normal.x, y: -hit.normal.y });
        this.gooSource = null;
      }
    }
    const now = performance.now();
    if (now - this.lastImpactAt < IMPACT_GAP_MS) return;
    this.lastImpactAt = now;
    for (const listener of this.impactListeners) {
      try {
        listener(s);
      } catch (err) {
        console.warn("[slime] impact listener failed", err);
      }
    }
  }

  /** Squash and stretch with the jelly spring, wobble of the surface, tilt and pop-in. Returns the lift off the floor. */
  private animateBody(t: number, dt: number, m: number, fx: number): number {
    const cur = this.mood;
    const w = cur.expr;
    const breathe = Math.sin(t * Math.PI * 2 * cur.breathe);
    // The body stretches on every syllable and relaxes between them: it bounces in time with the voice.
    const talk = (this.lipSync.openness - 0.28) * 0.1;
    const goal = cur.stretch + this.face.stretch * w + (breathe * 0.024 + talk) * m - 0.05 * this.press - 0.03 * this.pet;
    this.av += (-SPRING_K * (this.a - goal) - SPRING_C * this.av) * dt;
    this.a = clamp(this.a + this.av * dt, -0.3, 0.26);
    this.energy *= Math.exp(-1.4 * dt);

    this.introV += (-POP_K * (this.intro - 1) - POP_C * this.introV) * dt;
    this.intro += this.introV * dt;
    const g = Math.max(0.001, this.intro);

    // Eating: the cheeks puff out when the orb goes in, with a jelly overshoot.
    this.puffV += (-120 * (this.puff - this.eat.puff) - 10 * this.puffV) * dt;
    this.puff += this.puffV * dt;
    const puff = this.reducedMotion ? 0 : this.puff;

    const sy = (1 + this.a) * (1 + 0.05 * puff);
    const sxz = (1 / Math.sqrt(1 + this.a)) * (1 + 0.13 * puff); // the volume stays the same: taller means thinner
    const lift = Math.max(0, this.a - 0.04);
    this.rig.scale.set(sxz * g, sy * g, sxz * g);
    this.rig.position.y = lift * g;

    const drift = Math.sin(t * 0.43) + 0.5 * Math.sin(t * 1.07 + 1.3);
    const nod = Math.sin(t * 5.2) * this.emphasis * 0.03 * m;
    const roll = cur.roll + this.face.roll * w;
    // Shakes: a giggle, an "ouch", and the purr of contentment while it is rubbed.
    const giggle = smooth01(clamp(this.giggle / 0.35, 0, 1));
    const ouch = smooth01(clamp(this.ouch / 0.2, 0, 1));
    const shake = this.reducedMotion
      ? 0
      : 0.035 * giggle * Math.sin(t * Math.PI * 14) + 0.05 * ouch * Math.sin(t * Math.PI * 26) + 0.01 * this.pet * Math.sin(t * Math.PI * 17);
    const leanIn = -0.07 * this.rubSide * this.pet * m;
    // The entrance: it leans towards the orb with its mouth open, reaching for it.
    const reachOrb = -0.12 * this.eat.open * Math.sign(this.eat.gazeX || 1);
    this.rig.rotation.set(
      cur.lean + nod - 0.06 * this.eat.look,
      fx * 0.2,
      roll + cur.sway * Math.sin(t * 1.15) * m + drift * 0.01 * m + shake + leanIn + this.playLean + reachOrb,
    );

    this.placeBody(dt);

    // The top lags behind the base: that is what makes it read as jelly and not as a balloon.
    const amp = (0.01 + 0.03 * this.energy + 0.018 * this.emphasis + 0.012 * this.pet + 0.012 * Math.abs(this.melt)) * m;
    const shear = (0.02 * Math.sin(t * 0.8) + cur.sway * 1.2 * Math.sin(t * 1.15 - 0.6)) * m;
    this.wobble(t, amp, shear);
    if (this.playBlend > 0.001) this.measureReach(dt);

    // The floor shadow stays on the floor under the body; it fades as the body rises, and in play mode.
    const spread = 1 + MELT_SPREAD * Math.max(0, this.melt);
    this.shadow.position.x = this.body.x;
    this.shadow.scale.set(2.35 * sxz * g * spread, 1.35 * sxz * g * spread, 1);
    (this.shadow.material as MeshBasicMaterial).opacity =
      clamp(1 - lift * 2.2, 0.35, 1) * (1 - this.playBlend) * clamp(1 - Math.max(0, this.body.y - BODY_RADIUS) * 1.5, 0, 1);
    return lift * g;
  }

  /** The holder follows the physics body; squash against walls, stretch when pulled or flying; roll. */
  private placeBody(dt: number): void {
    const body = this.body;
    this.holder.position.set(body.x, body.y, 0);

    // Target deformation along one direction: < 0 squashed, > 0 stretched.
    let amount = 0;
    let dx = 0;
    let dy = 1;
    const contact = this.contact;
    if (contact && contact.depth > 0.002) {
      amount = -contact.depth;
      dx = contact.normal.x;
      dy = contact.normal.y;
    } else if (this.held && !this.play) {
      const px = body.x;
      const py = body.y - BODY_RADIUS;
      const length = Math.hypot(px, py);
      if (length > 1e-4) {
        amount = 0.18 * Math.tanh(length / 0.3);
        dx = px / length;
        dy = py / length;
      }
    } else if (this.play || this.entrance) {
      // Flying (thrown, or hopping in): stretched along the way it goes.
      const speed = Math.hypot(body.vx, body.vy);
      if (speed > 1e-3) {
        amount = Math.min(this.entrance ? 0.16 : 0.14, speed * (this.entrance ? 0.03 : 0.01));
        dx = body.vx / speed;
        dy = body.vy / speed;
      }
    }
    if (this.reducedMotion) amount *= 0.4;
    // Eased as a tensor, so it can turn from one direction to another without a jump. A contact
    // shows at once (the body must not look like it goes through the edge).
    const rate = contact ? 120 : 14;
    this.deform.xx = damp(this.deform.xx, amount * dx * dx, rate, dt);
    this.deform.xy = damp(this.deform.xy, amount * dx * dy, rate, dt);
    this.deform.yy = damp(this.deform.yy, amount * dy * dy, rate, dt);
    const { xx, xy, yy } = this.deform;
    const mean = (xx + yy) / 2;
    const spread = Math.hypot((xx - yy) / 2, xy);
    const big = mean + spread;
    const small = mean - spread;
    let angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    let value = big;
    if (Math.abs(small) > Math.abs(big)) {
      value = small;
      angle += Math.PI / 2;
    }
    const along = clamp(1 + value, 0.5, 1.4);
    const across = 1 / Math.sqrt(along);
    this.squashAxis.rotation.z = angle;
    this.squashUndo.rotation.z = -angle;
    this.squashAxis.scale.set(along, across, across);
    this.orient.rotation.z = this.theta;
  }

  /**
   * Ripples the surface. The base stays planted and the face area stays calm, so the eyes never sink.
   * The melt lowers and widens the body (the foot most) and tilts the normals so the puddle is lit as flat.
   */
  private wobble(t: number, amp: number, shear: number): void {
    const out = this.bodyPosition.array as Float32Array;
    const outN = this.bodyNormal.array as Float32Array;
    const base = this.bodyBase;
    const normals = this.bodyNormals;
    const crown = this.topY * 0.78;
    const faceY = this.centerY + 0.05;
    const shine = this.shineDir;
    const m = this.melt;
    const melting = Math.abs(m) > 1e-3;
    const topY = this.topY;
    const drop = 1 - MELT_DROP * m;
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
      const px = bx + nx * w + shear * grounded * grounded;
      const py = by + ny * w;
      const pz = bz + nz * w;
      if (melting) {
        const h = clamp(by / topY, 0, 1);
        const s = 1 + m * (0.12 + MELT_SPREAD * 0.62 * (1 - h) * (1 - h));
        out[i] = px * s;
        out[i + 1] = py * drop;
        out[i + 2] = pz * s;
        const ax = nx / s;
        const ay = ny / drop;
        const az = nz / s;
        const len = Math.hypot(ax, ay, az) || 1;
        outN[i] = ax / len;
        outN[i + 1] = ay / len;
        outN[i + 2] = az / len;
      } else {
        out[i] = px;
        out[i + 1] = py;
        out[i + 2] = pz;
      }
    }
    this.bodyPosition.needsUpdate = true;
    if (melting) {
      this.normalsBent = true;
      this.bodyNormal.needsUpdate = true;
    } else if (this.normalsBent) {
      outN.set(normals);
      this.normalsBent = false;
      this.bodyNormal.needsUpdate = true;
    }
  }

  private animateFace(t: number, dt: number, fx: number, fy: number): void {
    const cur = this.mood;
    const face = this.face;
    const look = this.look.face;
    const eat = this.eat;
    const w = cur.expr;

    // Gaze: the state and the pointer; in play mode where it is going; while eating, the orb.
    let gx = cur.gazeX + fx * 0.9;
    let gy = cur.gazeY + face.gazeY * w - fy * 0.6;
    if (this.playBlend > 0) {
      gx += clamp(this.body.vx / 10, -0.8, 0.8) * this.playBlend;
      gy += clamp(this.body.vy / 10, -0.8, 0.8) * this.playBlend;
    }
    gx = lerp(gx, eat.gazeX, eat.look);
    gy = lerp(gy, eat.gazeY, eat.look);
    const faceU = clamp(gx, -1, 1) * 0.15;
    const faceV = clamp(gy, -1, 1) * 0.075;

    const giggle = smooth01(clamp(this.giggle / 0.35, 0, 1));
    const ouch = smooth01(clamp(this.ouch / 0.2, 0, 1));
    const pet = smooth01(clamp(this.pet * 1.6, 0, 1));
    const melt = clamp(this.melt, 0, 1);
    this.wink = Math.max(0, this.wink - dt);
    const wink = smooth01(clamp(Math.min(this.wink, WINK_TIME - this.wink) / 0.12, 0, 1));
    const wince = Math.max(ouch, smooth01(clamp(this.wince / 0.12, 0, 1)));

    // Eyes: the state sets how open they are; the face adds size, lids, slant and joy.
    const awake = clamp(Math.max(cur.eyeOpen, eat.awake) * lerp(1, face.eyeOpen, w) * (1 - 0.93 * this.updateBlink(dt)), 0, 1);
    const size = cur.eyeSize * lerp(1, face.eyeSize, w) * (1 + 0.16 * eat.look + 0.14 * this.flight);
    const lid = clamp(cur.lid + face.lid * w + 0.35 * melt, 0, 1);
    const tilt = cur.eyeTilt + face.lidTilt * w;
    const asym = face.asym * w;
    const joy = clamp(face.closed * w + giggle + pet + eat.sat, 0, 1);

    for (const eye of this.eyes) {
      const puzzled = eye.side < 0 ? asym : 0;
      const s = size * (1 - 0.22 * puzzled + (eye.side > 0 ? 0.08 * asym : 0));
      const shut = Math.max(joy, wince, eye.side > 0 ? wink : 0);
      const open = clamp(awake * (1 - shut), 0, 1);
      const eyeLid = clamp(lid + 0.25 * puzzled, 0, 1);
      // The eyes lead the gaze a little more than the rest of the face.
      this.placeOn(eye.anchor, eye.side * look.eyeU + faceU * 1.35, look.eyeV + faceV * 1.35, 0.014);
      // Melting, they slide down the puddle, one a little more than the other, and droop outwards.
      const slip = melt * (0.05 + (eye.side > 0 ? 0.035 : 0)) + 0.008 * melt * Math.sin(t * 2.3 + eye.side);
      this.meltPlace(eye.anchor, slip);
      if (melt > 0) eye.anchor.rotateZ(-eye.side * 0.14 * melt);
      eye.shape.visible = open > 0.12;
      eye.shape.scale.set(s, s * Math.max(open, 0.02), 1);
      eye.shape.rotation.z = -eye.side * tilt * 0.3;

      eye.lid.visible = eyeLid > 0.01;
      eye.lidPivot.rotation.z = -eye.side * tilt;
      eye.lid.position.y = look.eyeRY * s * (1.15 - 1.5 * eyeLid) + LID_HEIGHT / 2;

      // Closed: a "^" from joy (softer when it is being rubbed), a "‿" from sleep or a blink,
      // and a ">" "<" pair, squeezed tight, when it winces.
      const closing = smoothstep(0.4, 0.1, open);
      eye.closed.group.visible = closing > 0.02;
      if (eye.closed.group.visible) {
        const fromJoy = shut / Math.max(1e-3, shut + (1 - awake));
        const squeeze = shut > 1e-3 ? clamp(wince / shut, 0, 1) : 0;
        const caret = lerp(-0.95, -0.6, pet);
        const bend = look.eyeRY * s * lerp(0.35, caret, fromJoy) * (1 + 0.35 * squeeze);
        eye.closed.group.rotation.z = eye.side * (Math.PI / 2) * squeeze;
        eye.closed.update(look.eyeRX * s * 1.2 * (1 - 0.3 * squeeze), bend, 0.032 * (0.4 + 0.6 * closing) * (1 + 0.2 * squeeze));
      }
    }

    // Mouth. While it speaks the visemes own it: the five vowel weights shape an oval
    // (tall for o/u, wide for e/i, big for a) that opens more downwards, like a jaw.
    const v = this.lipSync.weights;
    const talkH = 0.23 * v.aa + 0.19 * v.oh + 0.18 * v.ou + 0.09 * v.ee + 0.075 * v.ih;
    const talkHalf = 0.062 + 0.065 * v.aa + 0.08 * v.ee + 0.07 * v.ih - 0.025 * v.ou - 0.015 * v.oh;
    const talking = smoothstep(0.004, 0.04, talkH) * (1 - eat.open);
    // At rest the face may open it: a "D" grin (joy, a tickle, eating) or a small "o" (surprise, ouch, flying).
    const rest = 1 - this.talk;
    const grin = clamp((face.grin * w + giggle) * rest + eat.open * 1.3, 0, 1.3);
    const oh = clamp((face.oh * w + ouch * 0.75 + this.flight * 0.85) * rest * (1 - eat.open), 0, 1);
    const widthK = lerp(1, face.mouthWidth, w) * (1 + 0.12 * pet);
    const happy = Math.max(pet, eat.sat, giggle, melt * 0.6);
    const curve = lerp(lerp(cur.curve, face.curve, w), 1, happy);

    const half = Math.max(talking * talkHalf, grin * 0.17 * widthK, oh * 0.052);
    // Speaking: an oval that opens a little more downwards. The "D" grin: a gently curved top,
    // swollen round near the corners, and a deep round bowl.
    const top = Math.max(talking * talkH * 0.75, grin * 0.012, oh * 0.06);
    const bottom = Math.max(talking * talkH, grin * 0.165, oh * 0.066);
    const round = 0.05 * grin;
    const bend = 0.045 * grin * Math.max(0, curve) + 0.008 * curve * talking;
    const opened = smoothstep(0.012, 0.03, bottom);
    const mouthY = look.mouthV + faceV * 0.9 - 0.3 * top;
    this.placeOn(this.mouthAnchor, faceU * 0.9 + cur.mouthShift, mouthY, 0.012);
    this.meltPlace(this.mouthAnchor, melt * 0.03);
    this.mouthAnchor.rotateZ(face.skew * w);
    this.mouthOpen.visible = opened > 0.01;
    if (this.mouthOpen.visible) {
      this.mouthShape.update(half, top, bottom, bend, round);
      // The tongue: a small mound low in the mouth, a shade darker than the body. A small "o" shows none.
      const tongue = clamp(grin + talking * 0.85, 0, 1) * (1 - 0.6 * eat.open);
      this.tongue.mesh.visible = tongue > 0.05;
      if (this.tongue.mesh.visible) {
        const ty = -bottom * 0.97 + bend * 0.25;
        const th = Math.max(0.001, bottom * 0.38 * tongue);
        this.tongue.update(half * 0.5, th, th, 0, 0, ty);
        this.tongue.mesh.position.set(0, ty, 0.001);
      }
    }

    // The line between words: smile, flat or frown. It folds away as the mouth opens.
    const fold = 1 - opened;
    this.smile.group.visible = fold > 0.02;
    if (this.smile.group.visible) {
      const lineHalf = 0.085 * (1 + 0.15 * Math.abs(curve)) * widthK;
      this.smile.update(lineHalf * (0.4 + 0.6 * fold), 0.055 * curve, 0.028);
      this.smile.group.position.y = -0.012 * curve;
    }

    // Cheeks: rosier with a tickle, much rosier while rubbed, and when pleased.
    const blush = clamp(cur.blush + face.blush * w + 0.3 * giggle + 1.3 * pet + 0.7 * eat.sat + 0.25 * melt, 0, 2.2);
    for (const b of this.blushes) {
      this.placeOn(b.anchor, b.side * look.blushU + faceU * 0.7, look.blushV + faceV * 0.7, 0.008);
      this.meltPlace(b.anchor, melt * 0.04);
      b.anchor.scale.setScalar(1 + 0.3 * pet + 0.15 * eat.sat);
    }
    this.blushMaterial.opacity = clamp(look.blushStrength * (0.15 + blush * 0.75), 0, 0.85);
  }

  /** Inner light, the tint when it fails, sleeping "z", the thinking dots and the highlight. */
  private animateParts(t: number, lift: number): void {
    const cur = this.mood;
    // Only the state greys the body (a failure), never a conversation face.
    const sad = clamp(-cur.curve, 0, 1);
    const glow = this.eat.glow;

    // After the gulp the orb's violet glows faintly inside for a moment.
    this.gelMaterial.emissive.copy(this.glowColor).lerp(this.orbColor, glow * 0.45);
    this.gelMaterial.emissiveIntensity = (0.03 + 0.07 * cur.glow) * (1 - 0.6 * sad) + 0.1 * glow;
    this.gelMaterial.color.copy(this.white).lerp(this.sadColor, 0.45 * sad);
    // A melted puddle looks wetter.
    this.gelMaterial.clearcoat = 0.6 + 0.3 * clamp(this.melt, 0, 1);

    this.placeShine();

    // Dots and "z" ride along with the body, upright.
    const top = this.topY * (1 - MELT_DROP * clamp(this.melt, 0, 1));
    const baseX = this.body.x;
    const baseY = this.body.y - BODY_RADIUS;

    // Sleeping "z": only while the eyes are shut by the state, each one drifting up and fading out.
    const sleepy = (1 - smoothstep(0.14, 0.5, cur.eyeOpen)) * (1 - this.eat.awake);
    this.zeds.forEach((sprite, i) => {
      const phase = (t * 0.45 + i / 3) % 1;
      sprite.visible = sleepy > 0.02 && !this.reducedMotion;
      sprite.position.set(baseX + 0.5 + 0.2 * phase + 0.05 * Math.sin(phase * 6), baseY + top - 0.2 + lift + 0.6 * phase, 0.15);
      const scale = (0.1 + 0.2 * phase) * sleepy;
      sprite.scale.set(scale, scale, 1);
      (sprite.material as SpriteMaterial).opacity = sleepy * Math.sin(phase * Math.PI) * 0.9;
    });

    // Thinking dots: a typing-indicator rhythm above the head.
    const think = cur.think;
    this.dots.visible = think > 0.02;
    this.dots.position.set(baseX, baseY + top + 0.4 + lift, 0.1);
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
