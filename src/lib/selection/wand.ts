/**
 * Colour-based selection: the Magic Wand and the classic (non-AI) Quick
 * Selection brush. Both run on an RGBA render of the label at selection
 * resolution and need no AI server.
 */
import type { Pt } from "./shapes";

export interface Rgba {
  width: number;
  height: number;
  /** Row-major RGBA, as in ImageData. */
  data: Uint8ClampedArray;
}

/** Largest per-channel difference, alpha included — Photoshop's tolerance measure. */
const channelDistance = (d: Uint8ClampedArray, i: number, r: number, g: number, b: number, a: number) =>
  Math.max(Math.abs(d[i] - r), Math.abs(d[i + 1] - g), Math.abs(d[i + 2] - b), Math.abs(d[i + 3] - a));

/** Soften a hard 0/255 mask's edge by one pixel (3×3 average), for anti-aliasing. */
export const antiAliasEdges = (mask: Uint8ClampedArray, width: number, height: number): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x;
      const v = mask[i];
      // Interior pixels stay crisp; only edge pixels average.
      let sum = 0;
      let n = 0;
      let mixed = false;
      for (let dy = -1; dy <= 1; dy += 1) {
        const yy = y + dy;
        if (yy < 0 || yy >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          if (xx < 0 || xx >= width) continue;
          const w = mask[yy * width + xx];
          if (w !== v) mixed = true;
          sum += w;
          n += 1;
        }
      }
      out[i] = mixed ? Math.round((sum / n + v) / 2) : v;
    }
  }
  return out;
};

export interface WandOptions {
  /** 0–255, per channel. */
  tolerance: number;
  /** Only pixels connected to the click; otherwise every matching pixel. */
  contiguous: boolean;
  antiAlias: boolean;
}

/** Select pixels that match the colour at (x, y). */
export const magicWand = (img: Rgba, x: number, y: number, opts: WandOptions): Uint8ClampedArray => {
  const { width, height, data } = img;
  const mask = new Uint8ClampedArray(width * height);
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= width || py >= height) return mask;
  const seed = (py * width + px) * 4;
  const r = data[seed];
  const g = data[seed + 1];
  const b = data[seed + 2];
  const a = data[seed + 3];
  const tol = Math.max(0, Math.min(255, opts.tolerance));
  const matches = (i: number) => channelDistance(data, i * 4, r, g, b, a) <= tol;

  if (!opts.contiguous) {
    for (let i = 0; i < mask.length; i += 1) if (matches(i)) mask[i] = 255;
  } else {
    // Scanline flood fill.
    const stack: number[] = [px, py];
    while (stack.length) {
      const sy = stack.pop() as number;
      const sx = stack.pop() as number;
      let lx = sx;
      const row = sy * width;
      if (mask[row + lx] || !matches(row + lx)) continue;
      while (lx > 0 && !mask[row + lx - 1] && matches(row + lx - 1)) lx -= 1;
      let rx = sx;
      while (rx < width - 1 && !mask[row + rx + 1] && matches(row + rx + 1)) rx += 1;
      for (let xx = lx; xx <= rx; xx += 1) mask[row + xx] = 255;
      for (const ny of [sy - 1, sy + 1]) {
        if (ny < 0 || ny >= height) continue;
        const nrow = ny * width;
        let inRun = false;
        for (let xx = lx; xx <= rx; xx += 1) {
          const ok = !mask[nrow + xx] && matches(nrow + xx);
          if (ok && !inRun) {
            stack.push(xx, ny);
            inRun = true;
          } else if (!ok) {
            inRun = false;
          }
        }
      }
    }
  }
  return opts.antiAlias ? antiAliasEdges(mask, width, height) : mask;
};

export interface QuickSelectOptions {
  /** Brush radius, selection pixels. */
  radius: number;
  /**
   * How far from the brushed colours a pixel may stray and still join, 0–255.
   * Grows automatically with the variety of colours under the brush.
   */
  tolerance: number;
  /** How far, in brush radii, the region may grow beyond the stroke. */
  reach: number;
}

/**
 * The classic Quick Selection: grow outward from the pixels under the brush,
 * joining neighbours whose colour is close both to the brushed colours and
 * to the pixel they are reached from. The second test is what makes growth
 * stop at edges instead of leaking through gentle gradients.
 */
export const quickSelect = (img: Rgba, stroke: Pt[], opts: QuickSelectOptions): Uint8ClampedArray => {
  const { width, height, data } = img;
  const mask = new Uint8ClampedArray(width * height);
  if (stroke.length === 0) return mask;
  const r = Math.max(1, opts.radius);
  const r2 = r * r;

  // Seeds: every pixel under the brush.
  const seeds: number[] = [];
  const seen = new Uint8Array(width * height);
  const addSeedsAround = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(width - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(height - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const i = y * width + x;
        if (seen[i]) continue;
        seen[i] = 1;
        seeds.push(i);
      }
    }
  };
  addSeedsAround(stroke[0].x, stroke[0].y);
  for (let k = 1; k < stroke.length; k += 1) {
    const a = stroke[k - 1];
    const b = stroke[k];
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 2));
    for (let s = 1; s <= steps; s += 1) addSeedsAround(a.x + ((b.x - a.x) * s) / steps, a.y + ((b.y - a.y) * s) / steps);
  }
  if (seeds.length === 0) return mask;

  // Colour statistics of the brushed pixels.
  let mr = 0;
  let mg = 0;
  let mb = 0;
  for (const i of seeds) {
    mr += data[i * 4];
    mg += data[i * 4 + 1];
    mb += data[i * 4 + 2];
  }
  mr /= seeds.length;
  mg /= seeds.length;
  mb /= seeds.length;
  let spread = 0;
  for (const i of seeds) {
    spread += Math.max(Math.abs(data[i * 4] - mr), Math.abs(data[i * 4 + 1] - mg), Math.abs(data[i * 4 + 2] - mb));
  }
  spread /= seeds.length;
  const globalTol = Math.min(255, opts.tolerance + spread * 1.5);
  const localTol = Math.max(8, opts.tolerance * 0.6);

  // Growth is limited to a neighbourhood of the stroke, as Photoshop's is.
  let minX = width;
  let minY = height;
  let maxX = 0;
  let maxY = 0;
  for (const p of stroke) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const reach = r * Math.max(1, opts.reach);
  const bx0 = Math.max(0, Math.floor(minX - reach));
  const by0 = Math.max(0, Math.floor(minY - reach));
  const bx1 = Math.min(width - 1, Math.ceil(maxX + reach));
  const by1 = Math.min(height - 1, Math.ceil(maxY + reach));

  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  for (const i of seeds) {
    mask[i] = 255;
    queue[tail++] = i;
  }
  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    const pr = data[i * 4];
    const pg = data[i * 4 + 1];
    const pb = data[i * 4 + 2];
    for (let n = 0; n < 4; n += 1) {
      const nx = n === 0 ? x - 1 : n === 1 ? x + 1 : x;
      const ny = n === 2 ? y - 1 : n === 3 ? y + 1 : y;
      if (nx < bx0 || nx > bx1 || ny < by0 || ny > by1) continue;
      const j = ny * width + nx;
      if (mask[j]) continue;
      const qr = data[j * 4];
      const qg = data[j * 4 + 1];
      const qb = data[j * 4 + 2];
      const toMean = Math.max(Math.abs(qr - mr), Math.abs(qg - mg), Math.abs(qb - mb));
      const toNeighbour = Math.max(Math.abs(qr - pr), Math.abs(qg - pg), Math.abs(qb - pb));
      if (toMean <= globalTol && toNeighbour <= localTol) {
        mask[j] = 255;
        queue[tail++] = j;
      }
    }
  }
  return antiAliasEdges(mask, width, height);
};
