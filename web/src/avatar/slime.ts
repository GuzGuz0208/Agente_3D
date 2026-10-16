/**
 * Slime character: a soft, jelly companion for the voice console.
 *
 * Why a slime and not a person: a round, calm creature with one big readable
 * face is easier to trust and to read at a glance than a realistic human,
 * which matters most for people who are not used to talking to a screen
 * (older adults above all). It also stays clear of the uncanny valley.
 *
 * Its body language is part of the interface, even with the sound off:
 *   connecting / renewing  asleep, breathing slowly              -> wait
 *   listening              wakes with a hop, ears up, leans in   -> your turn
 *   thinking               looks aside, three dots pulse         -> searching
 *   speaking               bounces with the voice, mouth follows -> talking
 *   error                  sags, ears down, small frown          -> it failed
 *
 * Same contract as the human (`AvatarHandle`) and same lip-sync driver
 * (`LipSync`: five vowel weights), so the two can be swapped to compare them.
 * Everything is procedural: no model file, no download, no licence to carry.
 * The design is original; it borrows only the soft look of jelly-creature games.
 */
import {
  BufferAttribute,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  LatheGeometry,
  MathUtils,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NeutralToneMapping,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TorusGeometry,
  TubeGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
} from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { LipSync, VISEMES } from "./lipsync";
import {
  AvatarError,
  type AvatarDebugInfo,
  type AvatarHandle,
  type AvatarState,
  type MountAvatarOptions,
} from "./types";

// --- Palette ----------------------------------------------------------------

/** Brand tokens (src/styles/tokens.css). WebGL cannot read CSS colours, so they are mirrored here. */
const COLOR = {
  gel: 0x5d8bba, // midpoint of --blue-400 and --blue-500: deeper, so the body stands out from the pale stage
  gelDeep: 0x355982, // --blue-700
  core: 0x9fc0e3, // --blue-300
  shine: 0xf3f8fd, // --blue-50
  ink: 0x241a52, // eyes and smile: deep violet, softer than black
  mouth: 0x3b3391, // --violet-900
  tongue: 0xb9b0fa, // --violet-300
  dots: 0x7c6cf0, // --violet-500
  shadow: [34, 58, 94], // --blue-900, as rgb for the canvas gradient
  blush: [190, 140, 255], // lilac, as rgb for the canvas gradient
  sad: 0x8a9bb0, // the gel loses saturation when something fails
} as const;

// --- Layout -----------------------------------------------------------------

const CAMERA_FOV = 30;
/**
 * What must stay in frame, around the point the camera looks at: the body and tail
 * to the sides, and room above the ears for the thinking dots. The point sits low
 * because the dots are only there part of the time, and the stage keeps its mode
 * switch and caption over the bottom edge.
 */
const FOCUS = new Vector3(0.18, 0.88, 0);
const HALF_WIDTH = 1.33;
const HALF_HEIGHT = 1.38;
const FRAME_MARGIN = 1.14;
const BASE_PITCH = 0.04;
const ORBIT_YAW_LIMIT = 0.7;
const ORBIT_PITCH_LIMIT = 0.25;

/** The body is a flattened sphere resting on y = 0; this is the height of its centre. */
const BODY_CENTER_Y = 0.55;

const EYE_U = 0.36;
const EYE_V = 0.1;
const EYE_RX = 0.115;
const EYE_RY = 0.155;
const MOUTH_V = -0.17;
const BLUSH_U = 0.62;
const BLUSH_V = -0.09;

const TAIL_RADIUS = 0.085;
const TAIL_TIP = new Vector3(0.28, 0.82, 0.02);
const DOTS_Y = 2.0;
const SMILE_RADIUS = 0.085;
const SMILE_THICKNESS = 0.014;
const EAR_TILT = 0.42;
const EAR_POSITION = { x: 0.55, y: 1.3, z: 0.05 };
const TAIL_POSITION = new Vector3(0.93, 0.2, -0.3);

// --- Body language ----------------------------------------------------------

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
  /** Sad slant of the eyes, radians. */
  eyeTilt: number;
  /** Mouth: 1 smile .. 0 flat .. -1 frown. */
  curve: number;
  mouthShift: number;
  blush: number;
  /** -1 drooping .. 1 upright. */
  earPerk: number;
  tailHz: number;
  tailAmp: number;
  /** Light inside the gel. */
  glow: number;
  /** How much the eyes and the body follow the pointer. */
  follow: number;
  gazeX: number;
  gazeY: number;
  think: number;
  /** Breaths per second. */
  breathe: number;
}

const MOODS: Record<AvatarState, Mood> = {
  idle: {
    stretch: 0, lean: 0, roll: 0, sway: 0, eyeOpen: 1, eyeSize: 1, eyeTilt: 0, curve: 1, mouthShift: 0,
    blush: 0.5, earPerk: 0, tailHz: 0.5, tailAmp: 0.18, glow: 0.55, follow: 1, gazeX: 0, gazeY: 0, think: 0,
    breathe: 0.28,
  },
  // Asleep: eyes shut, ears down, slow deep breaths. "Wait, it is getting ready."
  connecting: {
    stretch: -0.03, lean: 0.02, roll: 0.03, sway: 0, eyeOpen: 0.14, eyeSize: 1, eyeTilt: 0, curve: 0.55,
    mouthShift: 0, blush: 0.35, earPerk: -0.35, tailHz: 0.25, tailAmp: 0.08, glow: 0.3, follow: 0, gazeX: 0,
    gazeY: -0.5, think: 0, breathe: 0.42,
  },
  // Awake and leaning in: "your turn".
  listening: {
    stretch: 0.05, lean: 0.05, roll: 0.075, sway: 0, eyeOpen: 1, eyeSize: 1.1, eyeTilt: 0, curve: 0.75,
    mouthShift: 0, blush: 0.6, earPerk: 1, tailHz: 0.8, tailAmp: 0.22, glow: 0.75, follow: 1, gazeX: 0, gazeY: 0,
    think: 0, breathe: 0.34,
  },
  // Looks up and aside while three dots pulse.
  thinking: {
    stretch: 0.02, lean: -0.02, roll: -0.06, sway: 0.05, eyeOpen: 1, eyeSize: 1, eyeTilt: 0, curve: 0.1,
    mouthShift: 0.06, blush: 0.4, earPerk: 0.15, tailHz: 0.35, tailAmp: 0.12, glow: 0.7, follow: 0, gazeX: 0.75,
    gazeY: 0.6, think: 1, breathe: 0.3,
  },
  speaking: {
    stretch: 0.02, lean: 0.02, roll: 0, sway: 0, eyeOpen: 0.92, eyeSize: 1, eyeTilt: 0, curve: 1, mouthShift: 0,
    blush: 0.8, earPerk: 0.35, tailHz: 1.6, tailAmp: 0.32, glow: 0.9, follow: 1, gazeX: 0, gazeY: 0, think: 0,
    breathe: 0.3,
  },
  // Drowsy, looking aside: "one moment, I am picking the conversation back up".
  renewing: {
    stretch: -0.01, lean: 0, roll: -0.03, sway: 0, eyeOpen: 0.5, eyeSize: 1, eyeTilt: 0, curve: 0.6,
    mouthShift: 0, blush: 0.4, earPerk: -0.1, tailHz: 0.3, tailAmp: 0.1, glow: 0.45, follow: 0.3, gazeX: -0.4,
    gazeY: 0.1, think: 0, breathe: 0.4,
  },
  // Sags, ears down, small frown. Shape carries the message, not only colour.
  error: {
    stretch: -0.1, lean: 0.05, roll: 0.04, sway: 0, eyeOpen: 1, eyeSize: 1.05, eyeTilt: 0.26, curve: -0.7,
    mouthShift: 0, blush: 0.15, earPerk: -1, tailHz: 0.12, tailAmp: 0.05, glow: 0.3, follow: 0.3, gazeX: 0,
    gazeY: -0.3, think: 0, breathe: 0.22,
  },
};

const MOOD_KEYS = Object.keys(MOODS.idle) as Array<keyof Mood>;

/** Jelly spring: soft enough to overshoot two or three times after a hop. */
const SPRING_K = 95;
const SPRING_C = 7;
const POP_K = 70;
const POP_C = 7.5;

// --- Helpers ----------------------------------------------------------------

const damp = MathUtils.damp;
const clamp = MathUtils.clamp;
const smooth01 = (t: number): number => t * t * (3 - 2 * t);
/** Works with reversed edges, unlike `MathUtils.smoothstep`. */
const smoothstep = (a: number, b: number, x: number): number => smooth01(clamp((x - a) / (b - a), 0, 1));

function createRenderer(canvas: HTMLCanvasElement): WebGLRenderer {
  try {
    const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance" });
    renderer.outputColorSpace = SRGBColorSpace;
    // Neutral tone mapping keeps the brand blues true; ACES would wash them out.
    renderer.toneMapping = NeutralToneMapping;
    renderer.setClearColor(0x000000, 0);
    return renderer;
  } catch (cause) {
    throw new AvatarError("webgl-unavailable", "WebGL is not available in this browser, so the 3D avatar cannot be rendered.", cause);
  }
}

/** A soft round gradient, used for the blush and the contact shadow. */
function softDisc(rgb: readonly [number, number, number], strength: number): CanvasTexture {
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

/** How much wider than a sphere the body is at height `y` (unit-sphere coordinates): wider at the foot, narrower at the crown. */
const girth = (y: number): number => 1 + 0.1 * smoothstep(0.3, -0.7, y) - 0.06 * smoothstep(0.3, 1, y);

/** A dollop: round on top, a flat soft base, a little wider at the foot. Rests on y = 0. */
function buildBodyGeometry(): SphereGeometry {
  const geometry = new SphereGeometry(1, 72, 54);
  const position = geometry.getAttribute("position") as BufferAttribute;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    let y = position.getY(i);
    const z = position.getZ(i);
    if (y < -BODY_CENTER_Y) y = -BODY_CENTER_Y + (y + BODY_CENTER_Y) * 0.22;
    const k = girth(y);
    position.setXYZ(i, x * k, y + BODY_CENTER_Y, z * k);
  }
  return geometry;
}

/** A cat ear with a rounded tip. Open at the base: a closing disc would show through the gel. */
function buildEarGeometry(): LatheGeometry {
  const profile: Array<[number, number]> = [
    [0.3, 0],
    [0.285, 0.08],
    [0.245, 0.2],
    [0.185, 0.32],
    [0.115, 0.42],
    [0.055, 0.485],
    [0.018, 0.512],
    [0, 0.52],
  ];
  return new LatheGeometry(profile.map(([r, y]) => new Vector2(r, y)), 28);
}

/** The tail leaves the back, sweeps out to the right and curls up. */
function buildTailGeometry(): TubeGeometry {
  const curve = new CatmullRomCurve3([
    new Vector3(0, 0, 0),
    new Vector3(0.2, 0.05, -0.02),
    new Vector3(0.38, 0.2, -0.03),
    new Vector3(0.46, 0.45, -0.02),
    new Vector3(0.4, 0.7, 0),
    new Vector3(0.28, 0.82, 0.02),
  ]);
  return new TubeGeometry(curve, 30, TAIL_RADIUS, 12, false);
}

// --- Rig pieces -------------------------------------------------------------

interface EyeRig {
  side: -1 | 1;
  anchor: Object3D;
  shape: Group;
}

interface EarRig {
  side: -1 | 1;
  group: Group;
  flick: number;
  phase: number;
}

// --- Slime ------------------------------------------------------------------

class Slime implements AvatarHandle {
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 40);
  private readonly lipSync = new LipSync();
  private readonly cleanups: Array<() => void> = [];
  private readonly owned: Array<{ dispose(): void }> = [];

  /** Everything that squashes, stretches and tilts with the body, pivoting on the ground. */
  private readonly rig = new Group();
  private readonly shadow: Mesh;
  private readonly bodyBase: Float32Array;
  private readonly bodyNormals: Float32Array;
  private readonly bodyPosition: BufferAttribute;
  private readonly core: Mesh;
  private readonly coreMaterial: MeshStandardMaterial;
  private readonly gelMaterials: MeshPhysicalMaterial[] = [];
  private readonly tail = new Group();
  private readonly ears: EarRig[] = [];
  private readonly eyes: EyeRig[] = [];
  private readonly mouthAnchor = new Group();
  private readonly mouthOpen = new Group();
  private smile!: Group;
  private readonly blushes: Array<{ side: -1 | 1; anchor: Object3D }> = [];
  private readonly blushMaterial: MeshBasicMaterial;
  private readonly dots = new Group();
  private readonly dotMeshes: Mesh[] = [];
  private readonly zeds: Sprite[] = [];

  private readonly gelColor = new Color(COLOR.gel);
  private readonly sadColor = new Color(COLOR.sad);
  private readonly coreColor = new Color(COLOR.core);
  private readonly stateColor = new Color(COLOR.gel);
  private readonly tmpNormal = new Vector3();
  private readonly zAxis = new Vector3(0, 0, 1);
  private readonly focus = FOCUS.clone();

  private state: AvatarState = "idle";
  private readonly mood: Mood = { ...MOODS.idle };
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
  private happy = 0;
  private greetIn = 0.55;
  private earTimer = 3;
  private colorClock = 1;

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
  ) {
    this.setupEnvironment();
    this.setupLights();

    // Materials: one gel, tinted per part so the ears and tail stay a touch denser than the body.
    const shell = this.gel(0.88);
    const dense = this.gel(0.95);

    // Body
    const bodyGeometry = this.own(buildBodyGeometry());
    this.bodyPosition = bodyGeometry.getAttribute("position") as BufferAttribute;
    this.bodyBase = Float32Array.from(this.bodyPosition.array as ArrayLike<number>);
    this.bodyNormals = Float32Array.from((bodyGeometry.getAttribute("normal") as BufferAttribute).array as ArrayLike<number>);
    const body = new Mesh(bodyGeometry, shell);
    body.renderOrder = 10;
    body.frustumCulled = false; // vertices move on the CPU; the static bounds would clip the wobble

    // Light inside the gel
    this.coreMaterial = this.own(
      new MeshStandardMaterial({
        color: COLOR.core,
        emissive: COLOR.core,
        emissiveIntensity: 0.35,
        roughness: 0.7,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    );
    this.core = new Mesh(this.own(new SphereGeometry(1, 40, 28)), this.coreMaterial);
    this.core.position.set(0, 0.5, -0.08);
    this.core.scale.set(0.66, 0.5, 0.56);
    this.core.renderOrder = 4;

    // Contact shadow (outside the rig, so it stays on the floor when the body hops)
    const shadowTexture = this.own(softDisc(COLOR.shadow, 0.5));
    this.shadow = new Mesh(
      this.own(new PlaneGeometry(1, 1)),
      this.own(new MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false })),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.set(0, 0.004, 0.05);
    this.shadow.renderOrder = 0;

    // Tail
    const tailMesh = new Mesh(this.own(buildTailGeometry()), dense);
    const tipCap = new Mesh(this.own(new SphereGeometry(TAIL_RADIUS, 16, 12)), dense);
    tipCap.position.copy(TAIL_TIP);
    const rootCap = new Mesh(tipCap.geometry, dense);
    this.tail.add(tailMesh, tipCap, rootCap);
    this.tail.position.copy(TAIL_POSITION);
    tailMesh.renderOrder = 3;
    tipCap.renderOrder = 3;
    rootCap.renderOrder = 3;

    // Ears: gel outside, a lilac inner ear seen through it
    const earGeometry = this.own(buildEarGeometry());
    const innerMaterial = this.own(
      new MeshStandardMaterial({ color: COLOR.tongue, emissive: COLOR.tongue, emissiveIntensity: 0.25, roughness: 0.5 }),
    );
    for (const side of [-1, 1] as const) {
      const group = new Group();
      const outer = new Mesh(earGeometry, dense);
      outer.scale.set(1, 1, 0.5);
      outer.renderOrder = 5;
      const inner = new Mesh(earGeometry, innerMaterial);
      inner.scale.set(0.56, 0.7, 0.34);
      inner.position.set(0, 0.1, 0.055);
      inner.renderOrder = 6;
      group.add(outer, inner);
      group.position.set(side * EAR_POSITION.x, EAR_POSITION.y, EAR_POSITION.z);
      this.ears.push({ side, group, flick: 0, phase: 0 });
      this.rig.add(group);
    }

    this.rig.add(this.tail, this.core, body);
    this.blushMaterial = this.own(
      new MeshBasicMaterial({ map: this.own(softDisc(COLOR.blush, 1)), transparent: true, depthWrite: false, opacity: 0.9 }),
    );
    this.buildFace();
    this.buildShine();
    this.buildThinkingDots();
    this.buildSleepingZeds();

    this.scene.add(this.shadow, this.rig, this.dots);

    this.setupObservers();
    this.resize();
    this.applyMotionPreference();
    this.refreshStateColor();

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
    if (!this.reducedMotion) this.hop(0.9);
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
      expressions: [],
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

  /** The gel: glossy, a little see-through, with a soft sheen at the edges. */
  private gel(opacity: number): MeshPhysicalMaterial {
    const material = this.own(
      new MeshPhysicalMaterial({
        color: COLOR.gel,
        roughness: 0.2,
        metalness: 0,
        clearcoat: 1,
        clearcoatRoughness: 0.3,
        sheen: 0.45,
        sheenRoughness: 0.5,
        sheenColor: new Color(COLOR.core),
        emissive: new Color(COLOR.gelDeep),
        emissiveIntensity: 0.14,
        transparent: true,
        opacity,
      }),
    );
    this.gelMaterials.push(material);
    return material;
  }

  /** A soft studio environment gives the gel something to reflect. */
  private setupEnvironment(): void {
    const generator = new PMREMGenerator(this.renderer);
    const room = new RoomEnvironment();
    const target = generator.fromScene(room, 0.04);
    room.dispose();
    generator.dispose();
    this.scene.environment = target.texture;
    this.scene.environmentIntensity = 0.6;
    this.own(target);
  }

  private setupLights(): void {
    const sky = new HemisphereLight(COLOR.shine, 0xb9b0fa, 0.9);
    const key = new DirectionalLight(0xffffff, 1.7);
    key.position.set(-1.6, 2.6, 3).normalize();
    // A cool violet rim from behind gives the edge of the gel its glow.
    const rim = new DirectionalLight(0xb9b0fa, 1.3);
    rim.position.set(2, 1.2, -2).normalize();
    this.scene.add(sky, key, rim);
  }

  /** Places an object on the body surface at the normal (u, v, w), facing outwards. */
  private placeOn(object: Object3D, u: number, v: number, lift = 0): void {
    const w = Math.sqrt(Math.max(0.05, 1 - u * u - v * v));
    const n = this.tmpNormal.set(u, v, w).normalize();
    const k = girth(n.y);
    object.position.set(n.x * (k + lift), BODY_CENTER_Y + n.y * (1 + lift), n.z * (k + lift));
    object.quaternion.setFromUnitVectors(this.zAxis, n);
  }

  private buildFace(): void {
    const irisMaterial = this.own(new MeshStandardMaterial({ color: COLOR.ink, roughness: 0.22, metalness: 0 }));
    const glintMaterial = this.own(new MeshBasicMaterial({ color: 0xffffff }));
    const sphere = this.own(new SphereGeometry(1, 28, 20));
    const disc = this.own(new CircleGeometry(1, 24));

    for (const side of [-1, 1] as const) {
      const anchor = new Group();
      const shape = new Group();
      const iris = new Mesh(sphere, irisMaterial);
      iris.scale.set(EYE_RX, EYE_RY, 0.05);
      const big = new Mesh(disc, glintMaterial);
      big.scale.setScalar(0.04);
      big.position.set(-0.034, 0.056, 0.052);
      const small = new Mesh(disc, glintMaterial);
      small.scale.setScalar(0.017);
      small.position.set(0.04, -0.05, 0.05);
      shape.add(iris, big, small);
      anchor.add(shape);
      for (const part of [iris, big, small]) part.renderOrder = 20;
      this.eyes.push({ side, anchor, shape });
      this.rig.add(anchor);
    }

    // Mouth: a smile line that gives way to an open mouth with a tongue.
    const ink = this.own(new MeshBasicMaterial({ color: COLOR.ink }));
    const smile = new Group();
    const arc = new Mesh(this.own(new TorusGeometry(SMILE_RADIUS, SMILE_THICKNESS, 8, 28, Math.PI)), ink);
    const capGeometry = this.own(new SphereGeometry(SMILE_THICKNESS, 10, 8));
    const capA = new Mesh(capGeometry, ink);
    capA.position.set(SMILE_RADIUS, 0, 0);
    const capB = new Mesh(capGeometry, ink);
    capB.position.set(-SMILE_RADIUS, 0, 0);
    smile.add(arc, capA, capB);
    const cavity = new Mesh(disc, this.own(new MeshBasicMaterial({ color: COLOR.mouth })));
    const tongue = new Mesh(disc, this.own(new MeshBasicMaterial({ color: COLOR.tongue })));
    tongue.scale.set(0.6, 0.45, 1);
    tongue.position.set(0, -0.45, 0.001);
    this.mouthOpen.add(cavity, tongue);
    this.smile = smile;
    for (const part of [arc, capA, capB, cavity, tongue]) part.renderOrder = 21;
    this.mouthAnchor.add(smile, this.mouthOpen);
    this.rig.add(this.mouthAnchor);

    // Blush
    const cheek = this.own(new CircleGeometry(0.115, 24));
    for (const side of [-1, 1] as const) {
      const anchor = new Group();
      const mesh = new Mesh(cheek, this.blushMaterial);
      mesh.scale.set(1, 0.72, 1);
      mesh.renderOrder = 15;
      anchor.add(mesh);
      this.blushes.push({ side, anchor });
      this.rig.add(anchor);
    }
  }

  /** Two soft highlights painted on the gel, so it reads as wet even at a distance. */
  private buildShine(): void {
    const material = this.own(new MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.62, depthWrite: false }));
    const disc = this.own(new CircleGeometry(1, 24));
    const spots: Array<{ u: number; v: number; sx: number; sy: number; roll: number }> = [
      { u: -0.46, v: 0.56, sx: 0.2, sy: 0.085, roll: 0.75 },
      { u: -0.7, v: 0.3, sx: 0.04, sy: 0.04, roll: 0 },
    ];
    for (const spot of spots) {
      const anchor = new Group();
      const mesh = new Mesh(disc, material);
      mesh.scale.set(spot.sx, spot.sy, 1);
      mesh.rotation.z = spot.roll;
      mesh.renderOrder = 16;
      anchor.add(mesh);
      this.placeOn(anchor, spot.u, spot.v, 0.006);
      this.rig.add(anchor);
    }
  }

  private buildThinkingDots(): void {
    const geometry = this.own(new SphereGeometry(0.06, 16, 12));
    const material = this.own(new MeshStandardMaterial({ color: COLOR.dots, emissive: COLOR.dots, emissiveIntensity: 0.3, roughness: 0.35 }));
    [-0.22, 0, 0.22].forEach((x) => {
      const dot = new Mesh(geometry, material);
      dot.position.set(x, 0, 0);
      dot.renderOrder = 22;
      this.dotMeshes.push(dot);
      this.dots.add(dot);
    });
    this.dots.position.set(0, DOTS_Y, 0.1);
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
      ctx.fillStyle = "#7c6cf0"; // --violet-500
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

  /** Tints the inner light with the state colour of the page (`--state`), so avatar and orb agree. */
  private refreshStateColor(): void {
    try {
      const raw = getComputedStyle(document.documentElement).getPropertyValue("--state").trim();
      if (/^#[0-9a-f]{3,8}$/i.test(raw)) this.stateColor.set(raw);
    } catch {
      // Keep the last colour.
    }
  }

  // -- Moves --

  /** A hop: the jelly springs up and wobbles back down. */
  private hop(power: number): void {
    this.av += 3.5 * power;
    this.energy = Math.min(1, this.energy + 0.8 * power);
    for (const ear of this.ears) ear.flick = 1;
  }

  /** A tap: it squashes, giggles and its eyes curve into a smile. */
  private poke(): void {
    if (this.reducedMotion) return;
    this.av -= 2.4;
    this.energy = 1;
    this.happy = 0.9;
    for (const ear of this.ears) ear.flick = 1;
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

    this.colorClock += dt;
    if (this.colorClock > 0.3) {
      this.colorClock = 0;
      this.refreshStateColor();
    }

    if (this.greetIn > 0) {
      this.greetIn -= dt;
      if (this.greetIn <= 0) this.hop(0.9); // greets once, right after the pop-in
    }

    const lift = this.animateBody(t, dt, m, fx);
    this.animateFace(dt, fx, fy);
    this.animateParts(t, dt, m, lift);
  }

  /** Squash and stretch with the jelly spring, wobble of the surface, tilt and pop-in. Returns the lift off the floor. */
  private animateBody(t: number, dt: number, m: number, fx: number): number {
    const cur = this.mood;
    const breathe = Math.sin(t * Math.PI * 2 * cur.breathe);
    // The body stretches on every syllable and relaxes between them: it bounces in time with the voice.
    const talk = (this.lipSync.openness - 0.28) * 0.1;
    const goal = cur.stretch + (breathe * 0.024 + talk) * m;
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
    this.rig.rotation.set(cur.lean + nod, fx * 0.2, cur.roll + cur.sway * Math.sin(t * 1.15) * m + drift * 0.01 * m);

    // The top lags behind the base: that is what makes it read as jelly and not as a balloon.
    const amp = (0.01 + 0.03 * this.energy + 0.018 * this.emphasis) * m;
    const shear = (0.02 * Math.sin(t * 0.8) + cur.sway * 1.2 * Math.sin(t * 1.15 - 0.6)) * m;
    this.wobble(t, amp, shear);

    this.shadow.scale.set(2.7 * sxz * g, 1.5 * sxz * g, 1);
    (this.shadow.material as MeshBasicMaterial).opacity = clamp(1 - lift * 2.2, 0.35, 1);
    return lift * g;
  }

  /** Ripples the surface. The base stays planted and the face area stays calm, so the eyes never sink. */
  private wobble(t: number, amp: number, shear: number): void {
    const out = this.bodyPosition.array as Float32Array;
    const base = this.bodyBase;
    const normals = this.bodyNormals;
    for (let i = 0; i < base.length; i += 3) {
      const bx = base[i] ?? 0;
      const by = base[i + 1] ?? 0;
      const bz = base[i + 2] ?? 0;
      const nx = normals[i] ?? 0;
      const ny = normals[i + 1] ?? 0;
      const nz = normals[i + 2] ?? 0;
      const grounded = smoothstep(0.1, 1.5, by);
      const face = 1 - 0.75 * smoothstep(0.45, 0.85, nz) * (1 - smoothstep(0.3, 0.75, Math.abs(by - BODY_CENTER_Y)));
      const w = amp * grounded * face * (Math.sin(by * 3.4 + bx * 2.1 + t * 3.1) + 0.7 * Math.sin(bz * 3.8 - bx * 1.9 + t * 2.3 + 1.7));
      out[i] = bx + nx * w + shear * grounded * grounded;
      out[i + 1] = by + ny * w;
      out[i + 2] = bz + nz * w;
    }
    this.bodyPosition.needsUpdate = true;
  }

  private animateFace(dt: number, fx: number, fy: number): void {
    const cur = this.mood;
    const gx = cur.gazeX + fx * 0.9;
    const gy = cur.gazeY - fy * 0.6;
    const faceU = clamp(gx, -1, 1) * 0.15;
    const faceV = clamp(gy, -1, 1) * 0.075;

    this.happy = Math.max(0, this.happy - dt);
    const happy = smooth01(clamp(this.happy / 0.35, 0, 1));
    const open = clamp(cur.eyeOpen * (1 - 0.93 * this.updateBlink(dt)) * (1 - 0.55 * happy), 0.06, 1);

    // The eyes lead the gaze a little more than the rest of the face.
    for (const eye of this.eyes) {
      this.placeOn(eye.anchor, eye.side * EYE_U + faceU * 1.35, EYE_V + faceV * 1.35, 0.014);
      eye.shape.scale.set(cur.eyeSize, cur.eyeSize * open, 1);
      eye.shape.rotation.z = -eye.side * cur.eyeTilt;
    }

    // Mouth: the five vowel weights shape an ellipse (tall for o/u, wide for e/i, big for a).
    const w = this.lipSync.weights;
    // Large on purpose: visible lip movement helps whoever is reading the mouth to follow the speech.
    const height = 0.012 + 0.25 * w.aa + 0.2 * w.oh + 0.19 * w.ou + 0.09 * w.ee + 0.075 * w.ih + 0.055 * happy;
    const width = 0.075 + 0.085 * w.aa + 0.1 * w.ee + 0.09 * w.ih - 0.035 * w.ou - 0.025 * w.oh;
    const mouthOpen = smoothstep(0.018, 0.04, height);
    const smileFade = 1 - smoothstep(0.014, 0.03, height);
    this.placeOn(this.mouthAnchor, faceU * 0.9 + cur.mouthShift, MOUTH_V + faceV * 0.9 - 0.3 * height, 0.012);
    this.mouthOpen.visible = mouthOpen > 0.01;
    this.mouthOpen.scale.set(width, height, 1);

    const curve = happy > 0 ? Math.max(cur.curve, 1) : cur.curve;
    const smile = this.smile;
    smile.visible = smileFade > 0.02 && Math.abs(curve) > 0.03;
    smile.rotation.z = curve >= 0 ? Math.PI : 0;
    smile.position.y = 0.03 * curve;
    smile.scale.set(1 + 0.18 * Math.abs(curve), Math.max(0.0001, Math.abs(curve) * smileFade), 1);

    for (const blush of this.blushes) {
      this.placeOn(blush.anchor, blush.side * BLUSH_U + faceU * 0.7, BLUSH_V + faceV * 0.7, 0.008);
    }
    this.blushMaterial.opacity = clamp(0.25 + cur.blush * 0.9 + 0.3 * happy, 0, 1);
  }

  /** Ears, tail, inner light, gel tint and the thinking dots. */
  private animateParts(t: number, dt: number, m: number, lift: number): void {
    const cur = this.mood;
    const sad = clamp(-cur.curve, 0, 1);
    const breathe = Math.sin(t * Math.PI * 2 * cur.breathe);

    // Ears: up when listening, down when asleep or sad, with a twitch now and then.
    this.earTimer -= dt;
    if (this.earTimer <= 0) {
      this.earTimer = 4 + Math.random() * 5;
      const ear = this.ears[Math.random() < 0.5 ? 0 : 1];
      if (ear && !this.reducedMotion && this.state !== "connecting") ear.flick = 1;
    }
    const perk = cur.earPerk;
    const tilt = EAR_TILT - 0.2 * Math.max(0, perk) + 0.5 * Math.max(0, -perk);
    const flap = clamp(-this.av * 0.025, -0.15, 0.15) * m; // the ears trail the body when it springs
    for (const ear of this.ears) {
      ear.flick = Math.max(0, ear.flick - dt * 2.6);
      ear.phase += dt * 30;
      ear.group.rotation.z = -ear.side * (tilt + flap) + 0.32 * ear.flick * Math.sin(ear.phase) * m;
      ear.group.scale.y = 1 + 0.12 * perk;
    }

    // Tail: slow when calm, quick when talking, drooping when sad.
    this.tail.rotation.z = -0.35 * sad + cur.tailAmp * Math.sin(t * Math.PI * 2 * cur.tailHz) * m;
    this.tail.rotation.y = 0.15 * Math.sin(t * Math.PI * cur.tailHz) * m;

    // Inner light, tinted by the page state; the gel desaturates when something fails.
    this.coreMaterial.opacity = 0.32 + 0.36 * cur.glow + 0.05 * breathe;
    this.coreMaterial.emissiveIntensity = 0.15 + 0.5 * cur.glow;
    this.coreMaterial.color.copy(this.coreColor).lerp(this.stateColor, 0.35);
    this.coreMaterial.emissive.copy(this.coreMaterial.color);
    this.core.scale.set(0.66 * (1 + 0.04 * breathe), 0.5 * (1 + 0.05 * breathe), 0.56);
    for (const gel of this.gelMaterials) gel.color.copy(this.gelColor).lerp(this.sadColor, 0.4 * sad);

    // Sleeping "z": only while the eyes are shut, each one drifting up and fading out.
    const sleepy = 1 - smoothstep(0.14, 0.5, cur.eyeOpen);
    this.zeds.forEach((sprite, i) => {
      const phase = (t * 0.45 + i / 3) % 1;
      sprite.visible = sleepy > 0.02 && !this.reducedMotion;
      sprite.position.set(0.62 + 0.2 * phase + 0.05 * Math.sin(phase * 6), 1.62 + lift + 0.6 * phase, 0.15);
      const scale = (0.1 + 0.2 * phase) * sleepy;
      sprite.scale.set(scale, scale, 1);
      (sprite.material as SpriteMaterial).opacity = sleepy * Math.sin(phase * Math.PI) * 0.9;
    });

    // Thinking dots: a typing-indicator rhythm above the head.
    const think = cur.think;
    this.dots.visible = think > 0.02;
    this.dots.position.y = DOTS_Y + lift;
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
