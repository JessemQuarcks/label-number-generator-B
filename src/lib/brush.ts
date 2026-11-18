/**
 * The brush engine.
 *
 * A stroke is a series of "dabs" — stamps of the brush tip — laid along the
 * pointer path at a spacing relative to the tip size. Each dab's size, angle,
 * roundness, position, flow and colour can be varied by the dynamics (jitter
 * and pressure/fade control), the same model Photoshop's Brush Settings use.
 *
 * Dabs accumulate at `flow` onto a stroke layer; the finished stroke is then
 * composited onto the pixel layer at `opacity` with the blend mode — so
 * opacity caps a stroke while flow builds up within it.
 */

export type BrushTip = "round" | "square" | "chalk" | "spray" | "bristle";
export type BrushControl = "off" | "pressure" | "fade";
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: { value: BlendMode; label: string }[] = [
  { value: "normal", label: "Normal" },
  { value: "multiply", label: "Multiply" },
  { value: "screen", label: "Screen" },
  { value: "overlay", label: "Overlay" },
  { value: "darken", label: "Darken" },
  { value: "lighten", label: "Lighten" },
  { value: "color-dodge", label: "Colour dodge" },
  { value: "color-burn", label: "Colour burn" },
  { value: "hard-light", label: "Hard light" },
  { value: "soft-light", label: "Soft light" },
  { value: "difference", label: "Difference" },
  { value: "exclusion", label: "Exclusion" },
  { value: "hue", label: "Hue" },
  { value: "saturation", label: "Saturation" },
  { value: "color", label: "Colour" },
  { value: "luminosity", label: "Luminosity" },
];

export const BRUSH_TIPS: { value: BrushTip; label: string }[] = [
  { value: "round", label: "Round" },
  { value: "square", label: "Square" },
  { value: "chalk", label: "Chalk" },
  { value: "spray", label: "Spray" },
  { value: "bristle", label: "Bristle" },
];

export interface BrushSettings {
  /** Brush tip shape */
  tip: BrushTip;
  /** Diameter in pixel-layer pixels (300 dpi: ~11.8 px per mm). */
  size: number;
  /** 0–100: edge softness, 100 = crisp. */
  hardness: number;
  /** 0–100: caps the whole stroke. */
  opacity: number;
  /** 0–100: how much each dab deposits. */
  flow: number;
  /** 1–500: dab spacing as a % of the diameter. */
  spacing: number;
  /** Tip angle in degrees. */
  angle: number;
  /** 1–100: 100 = circular, lower squashes the tip. */
  roundness: number;
  flipX: boolean;
  flipY: boolean;
  /** 0–100: lazy-mouse smoothing of the stroke path. */
  smoothing: number;
  blendMode: BlendMode;
  /** Foreground colour. */
  color: string;
  /** Background colour, used by foreground/background jitter. */
  secondaryColor: string;

  // Shape dynamics
  sizeJitter: number;
  sizeControl: BrushControl;
  /** 0–100: smallest size pressure/fade may reach, % of size. */
  minDiameter: number;
  /** Dabs over which "fade" control runs out. */
  fadeSteps: number;
  angleJitter: number;
  /** Rotate the tip to follow the stroke direction. */
  angleFollowsDirection: boolean;
  roundnessJitter: number;
  minRoundness: number;

  // Scattering
  /** 0–1000: random offset across the stroke, % of diameter. */
  scatter: number;
  scatterBothAxes: boolean;
  /** 1–16 dabs per spacing step. */
  count: number;
  countJitter: number;

  // Transfer
  opacityJitter: number;
  opacityControl: BrushControl;
  flowJitter: number;
  flowControl: BrushControl;

  // Colour dynamics
  fgBgJitter: number;
  hueJitter: number;
  saturationJitter: number;
  brightnessJitter: number;
  /** Vary colour per dab; off = once per stroke. */
  colorPerTip: boolean;

  // Other
  /** Adds grain to soft edges. */
  noise: boolean;
  /** Build-up: keeps depositing while the pointer is held still. */
  airbrush: boolean;
  /** Only paint where the layer already has pixels. */
  protectTransparency: boolean;
}

export const DEFAULT_BRUSH: BrushSettings = {
  tip: "round",
  size: 30,
  hardness: 80,
  opacity: 100,
  flow: 100,
  spacing: 10,
  angle: 0,
  roundness: 100,
  flipX: false,
  flipY: false,
  smoothing: 10,
  blendMode: "normal",
  color: "#000000",
  secondaryColor: "#ffffff",
  sizeJitter: 0,
  sizeControl: "pressure",
  minDiameter: 20,
  fadeSteps: 25,
  angleJitter: 0,
  angleFollowsDirection: false,
  roundnessJitter: 0,
  minRoundness: 25,
  scatter: 0,
  scatterBothAxes: false,
  count: 1,
  countJitter: 0,
  opacityJitter: 0,
  opacityControl: "off",
  flowJitter: 0,
  flowControl: "off",
  fgBgJitter: 0,
  hueJitter: 0,
  saturationJitter: 0,
  brightnessJitter: 0,
  colorPerTip: true,
  noise: false,
  airbrush: false,
  protectTransparency: false,
};

export interface BrushPreset {
  key: string;
  label: string;
  settings: Partial<BrushSettings>;
}

/** Starting points; picking one keeps the current colours. */
export const BRUSH_PRESETS: BrushPreset[] = [
  { key: "hard", label: "Hard round", settings: { tip: "round", hardness: 100, spacing: 8 } },
  { key: "soft", label: "Soft round", settings: { tip: "round", hardness: 0, spacing: 10 } },
  { key: "airbrush", label: "Airbrush", settings: { tip: "round", hardness: 0, flow: 8, airbrush: true, size: 80 } },
  { key: "pencil", label: "Pencil", settings: { tip: "square", hardness: 100, size: 3, spacing: 25, smoothing: 0 } },
  {
    key: "calligraphy",
    label: "Calligraphy",
    settings: { tip: "round", hardness: 95, roundness: 22, angle: 45, spacing: 4, size: 24 },
  },
  {
    key: "marker",
    label: "Marker",
    settings: { tip: "square", hardness: 75, opacity: 70, roundness: 60, blendMode: "multiply", size: 40 },
  },
  {
    key: "chalk",
    label: "Chalk",
    settings: { tip: "chalk", hardness: 60, spacing: 18, angleJitter: 100, sizeJitter: 15, size: 40 },
  },
  {
    key: "spray",
    label: "Spray",
    settings: { tip: "spray", hardness: 100, spacing: 30, scatter: 60, count: 3, countJitter: 40, size: 60 },
  },
  {
    key: "bristle",
    label: "Dry bristle",
    settings: { tip: "bristle", hardness: 70, spacing: 6, angleFollowsDirection: true, opacityJitter: 20, size: 45 },
  },
];

export const BRUSH_MIN = 1;
export const BRUSH_MAX = 2000;

/** Photoshop's [ and ] steps: finer when small, coarser when large. */
export const stepBrushSize = (size: number, direction: 1 | -1): number => {
  const step = size < 10 ? 1 : size < 50 ? 5 : size < 100 ? 10 : size < 500 ? 25 : 100;
  return Math.min(Math.max(Math.round(size + direction * step), BRUSH_MIN), BRUSH_MAX);
};

/* -------------------------------------------------------------------------
 * Pure maths (testable without a canvas)
 * ---------------------------------------------------------------------- */

/** Small, fast, seedable PRNG so a stroke's randomness is reproducible. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface Point {
  x: number;
  y: number;
  pressure: number;
}

/**
 * Lazy-mouse smoothing: the brush trails the pointer, which irons out
 * hand jitter. 0 = follow exactly.
 */
export const smoothTowards = (current: Point, target: Point, smoothing: number): Point => {
  const k = 1 - Math.min(Math.max(smoothing, 0), 100) / 100 * 0.92;
  return {
    x: current.x + (target.x - current.x) * k,
    y: current.y + (target.y - current.y) * k,
    pressure: current.pressure + (target.pressure - current.pressure) * k,
  };
};

/**
 * Dab positions along a segment, `step` apart. `carry` is the distance
 * already travelled since the last dab, so spacing stays even across
 * pointer events of any length.
 */
export const dabsAlong = (
  from: Point,
  to: Point,
  step: number,
  carry: number
): { dabs: Point[]; carry: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const s = Math.max(step, 0.5);
  const dabs: Point[] = [];
  let d = s - carry;
  while (d <= length) {
    const t = length === 0 ? 0 : d / length;
    dabs.push({ x: from.x + dx * t, y: from.y + dy * t, pressure: from.pressure + (to.pressure - from.pressure) * t });
    d += s;
  }
  return { dabs, carry: length - (d - s) };
};

/** Pressure, fade or nothing, as a 0–1 multiplier. */
export const controlFactor = (control: BrushControl, pressure: number, dabIndex: number, fadeSteps: number) => {
  if (control === "pressure") return Math.min(Math.max(pressure, 0), 1);
  if (control === "fade") return Math.max(0, 1 - dabIndex / Math.max(fadeSteps, 1));
  return 1;
};

export interface Dab {
  x: number;
  y: number;
  /** diameter in px */
  size: number;
  /** radians */
  angle: number;
  /** 0–1 */
  roundness: number;
  /** 0–1: deposit for this dab */
  alpha: number;
  color: string;
}

const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);

const hexToRgb = (hex: string): [number, number, number] => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  const n = m ? Number.parseInt(m[1], 16) : 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbToHex = (r: number, g: number, b: number) =>
  `#${[r, g, b].map((c) => Math.round(Math.min(Math.max(c, 0), 255)).toString(16).padStart(2, "0")).join("")}`;

const rgbToHsv = (r: number, g: number, b: number): [number, number, number] => {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
};

const hsvToRgb = (h: number, s: number, v: number): [number, number, number] => {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] =
    h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
};

/** Colour dynamics: mix towards the background colour, then jitter HSB. */
export const jitterColor = (s: BrushSettings, rnd: () => number): string => {
  const noJitter = !s.fgBgJitter && !s.hueJitter && !s.saturationJitter && !s.brightnessJitter;
  if (noJitter) return s.color;
  const fg = hexToRgb(s.color);
  const bg = hexToRgb(s.secondaryColor);
  const mix = (s.fgBgJitter / 100) * rnd();
  const [r, g, b] = fg.map((c, i) => c + (bg[i] - c) * mix) as [number, number, number];
  let [h, sat, v] = rgbToHsv(r, g, b);
  h = (h + (rnd() * 2 - 1) * (s.hueJitter / 100) * 180 + 360) % 360;
  sat = clamp01(sat + (rnd() * 2 - 1) * (s.saturationJitter / 100));
  v = clamp01(v + (rnd() * 2 - 1) * (s.brightnessJitter / 100));
  return rgbToHex(...hsvToRgb(h, sat, v));
};

/**
 * The dab(s) to stamp at one spacing step, with every dynamic applied.
 * `direction` is the stroke heading in radians.
 */
export const dabsAt = (
  s: BrushSettings,
  at: Point,
  dabIndex: number,
  direction: number,
  rnd: () => number,
  strokeColor: string
): Dab[] => {
  const count = Math.max(1, Math.round(s.count * (1 - (s.countJitter / 100) * rnd())));
  const out: Dab[] = [];
  for (let i = 0; i < count; i += 1) {
    const sizeCtl = controlFactor(s.sizeControl, at.pressure, dabIndex, s.fadeSteps);
    const minD = s.minDiameter / 100;
    let size = s.size * (minD + (1 - minD) * sizeCtl);
    size *= 1 - (s.sizeJitter / 100) * rnd();

    let angle = ((s.angleFollowsDirection ? direction * (180 / Math.PI) : 0) + s.angle) * (Math.PI / 180);
    angle += (rnd() * 2 - 1) * (s.angleJitter / 100) * Math.PI;

    const minR = s.minRoundness / 100;
    let roundness = s.roundness / 100;
    roundness *= 1 - (s.roundnessJitter / 100) * (1 - minR) * rnd();

    // Scatter perpendicular to the stroke (or both ways).
    const spread = (s.scatter / 100) * s.size;
    const across = (rnd() * 2 - 1) * spread;
    const along = s.scatterBothAxes ? (rnd() * 2 - 1) * spread : 0;
    const nx = -Math.sin(direction);
    const ny = Math.cos(direction);
    const x = at.x + nx * across + Math.cos(direction) * along;
    const y = at.y + ny * across + Math.sin(direction) * along;

    const flowCtl = controlFactor(s.flowControl, at.pressure, dabIndex, s.fadeSteps);
    const opacityCtl = controlFactor(s.opacityControl, at.pressure, dabIndex, s.fadeSteps);
    const alpha =
      (s.flow / 100) *
      flowCtl *
      opacityCtl *
      (1 - (s.flowJitter / 100) * rnd()) *
      (1 - (s.opacityJitter / 100) * rnd());

    out.push({
      x,
      y,
      size: Math.max(0.5, size),
      angle,
      roundness: Math.max(0.01, roundness),
      alpha: clamp01(alpha),
      color: s.colorPerTip ? jitterColor(s, rnd) : strokeColor,
    });
  }
  return out;
};

/**
 * Alpha (0–1) of a tip at normalised position (u, v) in [-1, 1]², before
 * any rotation. Used to build the cached tip masks.
 */
export const tipAlpha = (tip: BrushTip, hardness: number, u: number, v: number, rnd: () => number): number => {
  const hard = Math.min(Math.max(hardness / 100, 0), 0.985);
  const falloff = (d: number) => {
    if (d <= hard) return 1;
    if (d >= 1) return 0;
    const t = (d - hard) / (1 - hard);
    return 1 - t * t * (3 - 2 * t); // smoothstep
  };
  switch (tip) {
    case "round":
      return falloff(Math.hypot(u, v));
    case "square":
      return falloff(Math.max(Math.abs(u), Math.abs(v)));
    case "chalk":
      return falloff(Math.hypot(u, v)) * (rnd() < 0.62 ? 1 : 0.15);
    case "spray": {
      const d = Math.hypot(u, v);
      return d < 1 && rnd() < 0.06 * (1 - d * 0.6) ? 1 : 0;
    }
    case "bristle": {
      const d = Math.hypot(u, v);
      // Streaks across the tip, like hairs of a dry brush.
      const streak = 0.5 + 0.5 * Math.sin(v * 23 + Math.sin(v * 7) * 2);
      return falloff(d) * (streak > 0.35 ? 1 : 0.1);
    }
  }
};

/* -------------------------------------------------------------------------
 * Canvas rendering
 * ---------------------------------------------------------------------- */

const TIP_RES = 128;
const tipCache = new Map<string, HTMLCanvasElement>();

const makeCanvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
};

/** A white tip mask, cached per tip/hardness/noise. */
const tipMask = (s: BrushSettings): HTMLCanvasElement | null => {
  const key = `${s.tip}:${Math.round(s.hardness)}:${s.noise}`;
  const cached = tipCache.get(key);
  if (cached) return cached;
  const canvas = makeCanvas(TIP_RES, TIP_RES);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(TIP_RES, TIP_RES);
  const rnd = mulberry32(1234);
  for (let y = 0; y < TIP_RES; y += 1) {
    for (let x = 0; x < TIP_RES; x += 1) {
      const u = ((x + 0.5) / TIP_RES) * 2 - 1;
      const v = ((y + 0.5) / TIP_RES) * 2 - 1;
      let a = tipAlpha(s.tip, s.hardness, u, v, rnd);
      if (s.noise && a > 0 && a < 1) a *= rnd() < 0.5 ? 1 : 0.35;
      const i = (y * TIP_RES + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  tipCache.set(key, canvas);
  return canvas;
};

const coloredTips = new Map<string, HTMLCanvasElement>();

const coloredTip = (s: BrushSettings, color: string): HTMLCanvasElement | null => {
  const mask = tipMask(s);
  if (!mask) return null;
  const key = `${s.tip}:${Math.round(s.hardness)}:${s.noise}:${color}`;
  const hit = coloredTips.get(key);
  if (hit) return hit;
  const c = makeCanvas(TIP_RES, TIP_RES);
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, TIP_RES, TIP_RES);
  if (coloredTips.size > 256) coloredTips.clear();
  coloredTips.set(key, c);
  return c;
};

/**
 * One stroke in progress on a pixel layer. Feed it pointer points in layer
 * pixels; call `render` to draw base + stroke into a display canvas.
 */
export class BrushStroke {
  readonly stroke: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D | null;
  private last: Point | null = null;
  private lazy: Point | null = null;
  private carry = 0;
  private dabIndex = 0;
  private direction = 0;
  private readonly rnd: () => number;
  private readonly strokeColor: string;
  dirty = false;

  constructor(
    width: number,
    height: number,
    readonly settings: BrushSettings,
    readonly erase: boolean,
    seed = Date.now()
  ) {
    this.stroke = makeCanvas(width, height);
    this.ctx = this.stroke.getContext("2d");
    this.rnd = mulberry32(seed);
    this.strokeColor = jitterColor(settings, this.rnd);
  }

  private stamp(at: Point) {
    const ctx = this.ctx;
    if (!ctx) return;
    const s = this.settings;
    for (const dab of dabsAt(s, at, this.dabIndex, this.direction, this.rnd, this.strokeColor)) {
      const tip = coloredTip(s, this.erase ? "#000000" : dab.color);
      if (!tip) continue;
      ctx.save();
      ctx.globalAlpha = dab.alpha;
      ctx.translate(dab.x, dab.y);
      ctx.rotate(dab.angle);
      ctx.scale(((s.flipX ? -1 : 1) * dab.size) / TIP_RES, ((s.flipY ? -1 : 1) * dab.size * dab.roundness) / TIP_RES);
      ctx.drawImage(tip, -TIP_RES / 2, -TIP_RES / 2);
      ctx.restore();
    }
    this.dabIndex += 1;
    this.dirty = true;
  }

  /** Add a pointer sample. */
  addPoint(raw: Point) {
    const s = this.settings;
    if (!this.lazy || !this.last) {
      this.lazy = raw;
      this.last = raw;
      this.stamp(raw);
      return;
    }
    const next = smoothTowards(this.lazy, raw, s.smoothing);
    this.lazy = next;
    const dx = next.x - this.last.x;
    const dy = next.y - this.last.y;
    if (dx || dy) this.direction = Math.atan2(dy, dx);
    const step = Math.max(0.5, (s.spacing / 100) * s.size);
    const { dabs, carry } = dabsAlong(this.last, next, step, this.carry);
    this.carry = carry;
    for (const d of dabs) this.stamp(d);
    this.last = next;
  }

  /** Airbrush build-up: deposit again where the brush is resting. */
  tick() {
    if (this.settings.airbrush && this.last) this.stamp(this.last);
  }

  /** Draw `base` with this stroke composited onto it. */
  render(display: HTMLCanvasElement, base: CanvasImageSource | null) {
    const ctx = display.getContext("2d");
    if (!ctx) return;
    const s = this.settings;
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, display.width, display.height);
    if (base) ctx.drawImage(base, 0, 0, display.width, display.height);
    ctx.globalAlpha = s.opacity / 100;
    ctx.globalCompositeOperation = this.erase
      ? "destination-out"
      : s.protectTransparency
        ? "source-atop"
        : s.blendMode === "normal"
          ? "source-over"
          : s.blendMode;
    ctx.drawImage(this.stroke, 0, 0);
    ctx.restore();
    this.dirty = false;
  }
}
