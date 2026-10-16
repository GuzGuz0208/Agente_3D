/**
 * Play-mode physics of the slime: one soft round body inside the visible frame.
 *
 * Pure: no three.js and no DOM, so the bounces can be tested on their own
 * (tests/contract/physics.test.ts). World units and seconds; y points up, as in three.js.
 *
 * Walls are soft: a penalty spring with damping. The body sinks into a wall for a
 * few frames and is pushed back out, which gives the bounce its timing and, read
 * as a deformation, the squash: how deep the body is in the wall is how flat the
 * jelly is pressed against it. A hard limit keeps very fast throws from going through.
 *
 * The frame (`frameBox`) is the range of the body's centre for which the body is
 * fully on screen. It comes from the camera: the visible half-height at the focus
 * plane is `distance * tan(fov / 2)`, the half-width that times the aspect, and
 * each edge is narrowed so that the silhouette of a sphere (seen in perspective,
 * so it looks a little wider off-centre) just touches it. Only the part of the
 * canvas actually visible in its container counts (`ndc`), so a zoomed or clipped
 * canvas still bounces off the edges the person sees.
 */

export interface Vec2 {
  x: number;
  y: number;
}

/** Range of the body's centre: at a limit the body touches that edge of the frame. */
export interface Box {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export interface SoftBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Walls in contact, as bits of `WALLS` (set on entry, cleared once the body is clearly off). */
  touching: number;
}

/** A spring pulling the centre towards a point: a finger, or home. */
export interface Spring {
  x: number;
  y: number;
  stiffness: number;
  damping: number;
}

export interface StepParams {
  /** Collision radius, for the depth of a contact as a fraction (the squash). */
  radius: number;
  gravity: Vec2;
  /** No box: no walls (on the way home, outside play mode). */
  box: Box | null;
  spring?: Spring | null;
  wallStiffness?: number;
  wallDamping?: number;
  /** Tangential damping while touching a wall, 1/s: it slides, then stops. */
  friction?: number;
  airDrag?: number;
  maxSpeed?: number;
}

export const WALLS = ["left", "right", "bottom", "top"] as const;
export type Wall = (typeof WALLS)[number];

export interface Impact {
  wall: Wall;
  /** Points away from the wall, into the frame. */
  normal: Vec2;
  /** Approach speed, world units per second. */
  speed: number;
  /** 0..1, for a vibration or a splash. */
  strength: number;
  /** Where the body touches the wall. */
  point: Vec2;
}

export interface StepResult {
  impacts: Impact[];
  /** Deepest contact after the step: its normal and its depth as a fraction of the radius. */
  contact: { wall: Wall; normal: Vec2; depth: number } | null;
}

/** Below this approach speed a contact is a touch, not a hit (no vibration). */
export const IMPACT_MIN_SPEED = 1.2;
/** At this approach speed a hit is as strong as it gets. */
export const IMPACT_MAX_SPEED = 11;
/** A contact never goes deeper than this fraction of the radius. */
export const MAX_DEPTH = 0.55;

const NORMALS: Record<Wall, Vec2> = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  bottom: { x: 0, y: 1 },
  top: { x: 0, y: -1 },
};

const DEFAULTS = { wallStiffness: 900, wallDamping: 14, friction: 2.5, airDrag: 0.3, maxSpeed: 24 } as const;
const MAX_SUBSTEP = 1 / 240;
const MAX_SUBSTEPS = 10;

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/** 0..1 from the approach speed; a soft curve so most real hits land in the middle of the range. */
export function impactStrength(speed: number, min = IMPACT_MIN_SPEED, max = IMPACT_MAX_SPEED): number {
  if (!(speed > min)) return 0;
  return clamp(Math.sqrt((speed - min) / (max - min)), 0, 1);
}

/** How far the centre is beyond a wall's limit (positive = in contact). */
function depthInto(body: SoftBody, box: Box, wall: Wall): number {
  switch (wall) {
    case "left":
      return box.left - body.x;
    case "right":
      return body.x - box.right;
    case "bottom":
      return box.bottom - body.y;
    case "top":
      return body.y - box.top;
  }
}

/**
 * Advances the body by `dt` seconds (in small substeps) and reports the hits.
 * A hit is reported once per contact, when the body arrives at a wall fast enough.
 */
export function stepSoftBody(body: SoftBody, params: StepParams, dt: number): StepResult {
  const k = params.wallStiffness ?? DEFAULTS.wallStiffness;
  const c = params.wallDamping ?? DEFAULTS.wallDamping;
  const friction = params.friction ?? DEFAULTS.friction;
  const drag = params.airDrag ?? DEFAULTS.airDrag;
  const maxSpeed = params.maxSpeed ?? DEFAULTS.maxSpeed;
  const r = Math.max(1e-3, params.radius);
  const { box, spring, gravity } = params;
  const impacts: Impact[] = [];
  if (!(dt > 0)) return { impacts, contact: deepest(body, box, r) };

  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / MAX_SUBSTEP)));
  const h = dt / steps;
  for (let s = 0; s < steps; s++) {
    let ax = gravity.x;
    let ay = gravity.y;
    if (spring) {
      ax += spring.stiffness * (spring.x - body.x) - spring.damping * body.vx;
      ay += spring.stiffness * (spring.y - body.y) - spring.damping * body.vy;
    }
    let touchingAny = false;
    if (box) {
      WALLS.forEach((wall, i) => {
        const bit = 1 << i;
        const n = NORMALS[wall];
        const depth = depthInto(body, box, wall);
        if (depth <= 0) {
          // Clearly off the wall (a little hysteresis, so resting contact never flickers).
          if (depth < -0.01 * r) body.touching &= ~bit;
          return;
        }
        touchingAny = true;
        const vn = body.vx * n.x + body.vy * n.y; // > 0 moving away from the wall
        if (!(body.touching & bit)) {
          body.touching |= bit;
          const speed = -vn;
          const strength = impactStrength(speed);
          if (strength > 0) {
            impacts.push({ wall, normal: { ...n }, speed, strength, point: { x: body.x - n.x * r, y: body.y - n.y * r } });
          }
        }
        // Push out, never pull in: the damping alone must not glue the body to the wall.
        const push = Math.max(0, k * depth - c * vn);
        ax += n.x * push;
        ay += n.y * push;
        // Friction along the wall.
        const keep = Math.exp(-friction * h);
        const tx = body.vx - vn * n.x;
        const ty = body.vy - vn * n.y;
        body.vx = vn * n.x + tx * keep;
        body.vy = vn * n.y + ty * keep;
      });
    }
    const air = Math.exp(-drag * h);
    body.vx = (body.vx + ax * h) * air;
    body.vy = (body.vy + ay * h) * air;
    const speed = Math.hypot(body.vx, body.vy);
    if (speed > maxSpeed) {
      body.vx *= maxSpeed / speed;
      body.vy *= maxSpeed / speed;
    }
    body.x += body.vx * h;
    body.y += body.vy * h;
    if (box && touchingAny) hardLimit(body, box, r);
  }
  return { impacts, contact: deepest(body, box, r) };
}

/** A very fast throw would sink too deep before the spring stops it: stop it at the limit. */
function hardLimit(body: SoftBody, box: Box, r: number): void {
  const max = MAX_DEPTH * r;
  for (const wall of WALLS) {
    const depth = depthInto(body, box, wall);
    if (depth <= max) continue;
    const n = NORMALS[wall];
    body.x += n.x * (depth - max);
    body.y += n.y * (depth - max);
    const vn = body.vx * n.x + body.vy * n.y;
    if (vn < 0) {
      body.vx -= vn * n.x;
      body.vy -= vn * n.y;
    }
  }
}

function deepest(body: SoftBody, box: Box | null, r: number): StepResult["contact"] {
  if (!box) return null;
  let best: StepResult["contact"] = null;
  for (const wall of WALLS) {
    const depth = depthInto(body, box, wall) / r;
    if (depth > 0 && (!best || depth > best.depth)) best = { wall, normal: { ...NORMALS[wall] }, depth: Math.min(depth, MAX_DEPTH) };
  }
  return best;
}

// --- Frame --------------------------------------------------------------------

export interface FrameView {
  /** tan(vertical field of view / 2). */
  tanHalfFov: number;
  /** Width / height of the canvas. */
  aspect: number;
  /** From the camera to the plane the body moves in (the camera looks straight at it). */
  distance: number;
  /** The point the camera looks at, in that plane. */
  center: Vec2;
  /** Visible part of the canvas in normalised device coordinates (-1..1); the whole canvas by default. */
  ndc?: Box;
}

/**
 * Largest offset of a sphere's centre from the view axis such that its silhouette,
 * seen from `distance`, stays within `extent` on the focus plane. Solved by bisection
 * (the silhouette edge grows monotonically with the offset).
 */
export function sphereLimit(extent: number, distance: number, radius: number): number {
  const d = Math.max(1e-3, distance);
  const goal = Math.atan(extent / d);
  const edge = (x: number): number => Math.atan(x / d) + Math.asin(Math.min(1, radius / Math.hypot(x, d)));
  let lo = extent - 4 * radius;
  let hi = extent;
  if (edge(lo) > goal) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (edge(mid) > goal) hi = mid;
    else lo = mid;
  }
  return lo;
}

/**
 * Range of the body's centre for which the whole body is inside the visible frame.
 *
 * `size` is either a radius (the body is taken as a sphere, seen in perspective) or the
 * body's measured reach from its centre towards each edge, already projected onto the
 * focus plane: the slime measures its own silhouette, which also covers its flat base,
 * a roll towards the gravity and the front of the body looking wider off-centre.
 */
export function frameBox(view: FrameView, size: number | Box): Box {
  const hh = view.distance * view.tanHalfFov;
  const hw = hh * view.aspect;
  const ndc = view.ndc ?? { left: -1, right: 1, bottom: -1, top: 1 };
  const sphere = typeof size === "number";
  const right = sphere ? sphereLimit(ndc.right * hw, view.distance, size) : ndc.right * hw - size.right;
  const left = sphere ? -sphereLimit(-ndc.left * hw, view.distance, size) : ndc.left * hw + size.left;
  const top = sphere ? sphereLimit(ndc.top * hh, view.distance, size) : ndc.top * hh - size.top;
  const bottom = sphere ? -sphereLimit(-ndc.bottom * hh, view.distance, size) : ndc.bottom * hh + size.bottom;
  // A frame smaller than the body: the centre has nowhere to go but the middle.
  const midX = (left + right) / 2;
  const midY = (bottom + top) / 2;
  return {
    left: view.center.x + Math.min(left, midX),
    right: view.center.x + Math.max(right, midX),
    bottom: view.center.y + Math.min(bottom, midY),
    top: view.center.y + Math.max(top, midY),
  };
}

// --- Gravity and orientation -----------------------------------------------------

/** Longest tilt accepted: 1 is a phone held upright; a shake may briefly go past it. */
export const MAX_TILT = 2;

/**
 * Gravity in the world from the tilt of the device in screen space (x right, y down;
 * (0, 1) upright, (0, 0) flat on a table). The world's y points up, so screen-down is
 * world-down. Shakes arrive mixed into the tilt as short spikes past 1, so the length
 * is capped at `maxTilt` times `g`: a shake can throw the body, never blow it up.
 */
export function gravityFromTilt(x: number, y: number, g: number, maxTilt = MAX_TILT): Vec2 {
  const tx = Number.isFinite(x) ? clamp(x, -maxTilt, maxTilt) : 0;
  const ty = Number.isFinite(y) ? clamp(y, -maxTilt, maxTilt) : 0;
  const length = Math.hypot(tx, ty);
  const k = length > maxTilt ? maxTilt / length : 1;
  return { x: tx * k * g, y: -ty * k * g };
}

/** Roll (radians, counter-clockwise) that turns the body's base towards the gravity. */
export function uprightAngle(gravity: Vec2): number {
  return Math.atan2(gravity.x, -gravity.y);
}

/** Shortest signed turn from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
