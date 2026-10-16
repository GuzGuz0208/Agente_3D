/**
 * Slime trail ("baba"): translucent, glossy pink smears left where the slime is
 * dragged or splashes against an edge. They thin out and fade away within about
 * six seconds, so nothing stays on screen for long.
 *
 * It is a 2D canvas laid exactly over the box of the 3D canvas but painted under
 * it (inserted just before it), so the trail stays on the background and the
 * slime slides over it. `pointer-events: none`: it never takes a touch or a
 * click, and it is removed on `dispose`.
 *
 * Each stroke is drawn opaque on a scratch layer (a darker rim, the body, a wet
 * glint up and to the left) and then laid on the screen with one transparency,
 * so the band is evenly translucent instead of darker wherever it overlaps itself.
 *
 * Points come in client coordinates (pointer events, or the slime projected to
 * the screen); the layer maps them to its own pixels.
 */

type Rgb = readonly [number, number, number];

export interface GooColors {
  /** Body of the goo, its rim, and the glint. */
  body: Rgb;
  deep: Rgb;
  shine: Rgb;
}

interface Point {
  x: number;
  y: number;
  r: number;
  /** Seconds. */
  t: number;
}

interface Stroke {
  /** A band through the points, or separate drops (a splash). */
  kind: "band" | "drops";
  points: Point[];
  /** Seconds: when the last point was added; the stroke fades from there. */
  last: number;
  box: { left: number; top: number; right: number; bottom: number };
}

/** Seconds a stroke lasts after its last point; it starts fading after `FADE_FROM` of that. */
export const GOO_LIFE = 6.5;
const FADE_FROM = 0.4;
const OPACITY = 0.55;
const MAX_STROKES = 24;
const MAX_POINTS = 700;
/** A point of a band this much thicker than its mean is drawn as a round drop. */
const BEAD = 1.22;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const css = ([r, g, b]: Rgb): string => `rgb(${r},${g},${b})`;

export class GooLayer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly scratch: HTMLCanvasElement;
  private readonly sctx: CanvasRenderingContext2D | null;
  private readonly strokes: Stroke[] = [];
  private current: Stroke | null = null;
  private readonly colors: { body: string; deep: string; shine: string };
  private dpr = 1;
  private width = 1;
  private height = 1;
  private drawn = false;
  private travelled = 0;

  constructor(
    private readonly host: HTMLCanvasElement,
    colors: GooColors,
  ) {
    this.colors = { body: css(colors.body), deep: css(colors.deep), shine: css(colors.shine) };
    this.canvas = document.createElement("canvas");
    this.canvas.className = "slime-goo";
    this.canvas.setAttribute("aria-hidden", "true");
    this.canvas.style.pointerEvents = "none";
    this.canvas.style.display = "block";
    this.ctx = this.canvas.getContext("2d");
    this.scratch = document.createElement("canvas");
    this.sctx = this.scratch.getContext("2d");
    host.parentElement?.insertBefore(this.canvas, host);
    this.layout();
  }

  /** Number of points on screen (for diagnostics and tests). */
  get count(): number {
    let n = 0;
    for (const s of this.strokes) n += s.points.length;
    return n;
  }

  /** Matches the layer to the box of the 3D canvas (call it on resize). */
  layout(): void {
    const host = this.host;
    const style = getComputedStyle(host);
    const s = this.canvas.style;
    s.position = style.position === "fixed" ? "fixed" : "absolute";
    s.left = `${host.offsetLeft}px`;
    s.top = `${host.offsetTop}px`;
    s.width = `${host.offsetWidth}px`;
    s.height = `${host.offsetHeight}px`;
    if (style.zIndex !== "auto") s.zIndex = style.zIndex;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, host.offsetWidth);
    this.height = Math.max(1, host.offsetHeight);
    for (const c of [this.canvas, this.scratch]) {
      c.width = Math.round(this.width * this.dpr);
      c.height = Math.round(this.height * this.dpr);
    }
    this.drawn = true; // the resize cleared the bitmap; draw again
  }

  /** Ends the current stroke: the next point starts a new trail instead of joining the last one. */
  lift(): void {
    this.current = null;
  }

  /**
   * Adds trail along the path to a point. `size` is the half-width of the band in CSS pixels;
   * it swells and thins a little along the way, like goo pulled out of a blob.
   */
  trail(clientX: number, clientY: number, size: number, nowMs: number): void {
    const p = this.toLocal(clientX, clientY);
    const now = nowMs / 1000;
    let stroke = this.current;
    if (!stroke) {
      stroke = this.begin("band", now);
      this.add(stroke, p.x, p.y, size * 1.15, now);
      return;
    }
    const last = stroke.points[stroke.points.length - 1];
    if (!last) return;
    const distance = Math.hypot(p.x - last.x, p.y - last.y);
    if (distance < Math.max(2, size * 0.45)) return;
    this.travelled += distance;
    // Mostly even, with a fat drop every few hundred pixels.
    const swell = 1 + 0.08 * Math.sin(this.travelled * 0.05) + 0.75 * Math.pow(Math.max(0, Math.sin(this.travelled * 0.017)), 10);
    this.add(stroke, p.x, p.y, size * swell, now);
    if (stroke.points.length >= MAX_POINTS) this.current = null;
  }

  /**
   * A splash where the slime hits an edge: a smear pressed flat along the edge, fattest where
   * it hit, and a few droplets thrown back off it. `normal` points away from the edge.
   */
  splat(clientX: number, clientY: number, size: number, strength: number, nowMs: number, normal: { x: number; y: number }): void {
    const p = this.toLocal(clientX, clientY);
    const now = nowMs / 1000;
    const along = { x: -normal.y, y: normal.x };
    const half = size * (1 + 1.8 * strength);
    const fat = size * (0.85 + 0.45 * strength);
    const smear = this.begin("band", now);
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const x = p.x + along.x * half * k + normal.x * size * 0.3;
      const y = p.y + along.y * half * k + normal.y * size * 0.3;
      this.add(smear, x, y, fat * (1 - 0.38 * Math.abs(k)), now);
    }
    const drops = this.begin("drops", now);
    const count = 2 + Math.round(3 * strength);
    for (let i = 0; i < count; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const spread = half * (0.3 + 0.9 * Math.random());
      const out = size * (1 + 1.6 * strength) * (0.6 + 0.6 * Math.random());
      this.add(drops, p.x + along.x * side * spread + normal.x * out, p.y + along.y * side * spread + normal.y * out, size * (0.22 + 0.25 * Math.random()), now);
    }
    this.current = null;
  }

  /** Redraws the layer; cheap when there is nothing to draw. */
  render(nowMs: number): void {
    const ctx = this.ctx;
    const sctx = this.sctx;
    if (!ctx || !sctx) return;
    const now = nowMs / 1000;
    for (let i = this.strokes.length - 1; i >= 0; i--) {
      const s = this.strokes[i];
      if (s && s !== this.current && now - s.last > GOO_LIFE) this.strokes.splice(i, 1);
    }
    if (!this.strokes.length) {
      if (this.drawn) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawn = false;
      }
      return;
    }
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const stroke of this.strokes) {
      const fade = 1 - smooth(GOO_LIFE * FADE_FROM, GOO_LIFE, now - stroke.last);
      if (fade <= 0) continue;
      // The part of the layer this stroke covers, in device pixels.
      const left = Math.max(0, Math.floor(stroke.box.left * d));
      const top = Math.max(0, Math.floor(stroke.box.top * d));
      const right = Math.min(this.canvas.width, Math.ceil(stroke.box.right * d));
      const bottom = Math.min(this.canvas.height, Math.ceil(stroke.box.bottom * d));
      if (right <= left || bottom <= top) continue;
      sctx.setTransform(1, 0, 0, 1, 0, 0);
      sctx.clearRect(left, top, right - left, bottom - top);
      sctx.setTransform(d, 0, 0, d, 0, 0);
      this.paint(sctx, stroke, now);
      ctx.globalAlpha = OPACITY * fade;
      ctx.drawImage(this.scratch, left, top, right - left, bottom - top, left, top, right - left, bottom - top);
    }
    ctx.globalAlpha = 1;
    this.drawn = true;
  }

  clear(): void {
    this.strokes.length = 0;
    this.current = null;
  }

  dispose(): void {
    this.clear();
    this.canvas.remove();
  }

  /**
   * Rim, body and glint of one stroke, opaque (the transparency comes when it is laid on screen).
   * A band is one smooth line of even width, with round drops wherever the goo swelled; as it
   * ages it thins out, as if it dried from the edges.
   */
  private paint(ctx: CanvasRenderingContext2D, stroke: Stroke, now: number): void {
    const { points } = stroke;
    const dry = 1 - 0.45 * Math.min(1, (now - stroke.last) / GOO_LIFE);
    let mean = 0;
    for (const p of points) mean += p.r;
    mean = (mean / Math.max(1, points.length)) * dry;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const passes = [
      { color: this.colors.deep, grow: 1.2, alpha: 1 },
      { color: this.colors.body, grow: -0.8, alpha: 1 },
    ];
    for (const pass of passes) {
      ctx.globalAlpha = pass.alpha;
      ctx.strokeStyle = pass.color;
      ctx.fillStyle = pass.color;
      if (stroke.kind === "band" && points.length > 1) {
        ctx.lineWidth = Math.max(1, 2 * (mean * 0.72 + pass.grow));
        this.path(ctx, points, 0, 0);
        ctx.stroke();
      }
      // Drops: the whole splash, or the swollen beads of a band.
      for (const p of points) {
        const r = p.r * dry;
        if (stroke.kind === "band" && points.length > 1 && r < mean * BEAD) continue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, (stroke.kind === "band" ? r * 0.8 : r) + pass.grow), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The wet glint: a thin soft line up and to the left, and a dot on each drop.
    ctx.globalAlpha = 0.7;
    ctx.strokeStyle = this.colors.shine;
    ctx.fillStyle = this.colors.shine;
    if (stroke.kind === "band" && points.length > 1) {
      ctx.lineWidth = Math.max(1, mean * 0.2);
      this.path(ctx, points, -0.22 * mean, -0.3 * mean);
      ctx.stroke();
    }
    for (const p of points) {
      const r = p.r * dry;
      if (stroke.kind === "band" && points.length > 1 && r < mean * BEAD) continue;
      ctx.beginPath();
      ctx.ellipse(p.x - r * 0.3, p.y - r * 0.38, r * 0.3, r * 0.17, -0.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  /** A smooth path through the points (quadratic curves through the midpoints), shifted by (dx, dy). */
  private path(ctx: CanvasRenderingContext2D, points: readonly Point[], dx: number, dy: number): void {
    const first = points[0];
    if (!first) return;
    ctx.beginPath();
    ctx.moveTo(first.x + dx, first.y + dy);
    for (let i = 1; i < points.length - 1; i++) {
      const p = points[i];
      const q = points[i + 1];
      if (!p || !q) continue;
      ctx.quadraticCurveTo(p.x + dx, p.y + dy, (p.x + q.x) / 2 + dx, (p.y + q.y) / 2 + dy);
    }
    const last = points[points.length - 1];
    if (last) ctx.lineTo(last.x + dx, last.y + dy);
  }

  private begin(kind: Stroke["kind"], now: number): Stroke {
    const stroke: Stroke = { kind, points: [], last: now, box: { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity } };
    this.strokes.push(stroke);
    if (this.strokes.length > MAX_STROKES && this.strokes.shift() === this.current) this.current = null;
    if (kind === "band") this.current = stroke;
    return stroke;
  }

  private add(stroke: Stroke, x: number, y: number, r: number, now: number): void {
    if (!(r > 0.5)) return;
    stroke.points.push({ x, y, r, t: now });
    stroke.last = now;
    const pad = r + 3;
    const box = stroke.box;
    box.left = Math.min(box.left, x - pad);
    box.top = Math.min(box.top, y - pad);
    box.right = Math.max(box.right, x + pad);
    box.bottom = Math.max(box.bottom, y + pad);
  }

  private toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const sx = rect.width > 0 ? this.width / rect.width : 1;
    const sy = rect.height > 0 ? this.height / rect.height : 1;
    return { x: (clientX - rect.left) * sx, y: (clientY - rect.top) * sy };
  }
}
