/**
 * Select ▸ Modify: expand, contract, feather, smooth and border.
 *
 * Expand and contract use an exact Euclidean distance transform, so a 2 mm
 * expansion grows a round corner and not a square one. Feather is a
 * Gaussian (three box-blur passes). All radii are in selection pixels;
 * callers convert from millimetres.
 */
import type { Selection } from "./mask";
import { withData } from "./mask";

const INF = 1e20;

/** 1-D squared distance transform (Felzenszwalb & Huttenlocher). */
const edt1d = (f: Float64Array, n: number, d: Float64Array, v: Int32Array, z: Float64Array) => {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q += 1) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q += 1) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
};

/**
 * Squared distance from every pixel to the nearest pixel where `isFeature`
 * holds. Pixels that are features get 0.
 */
export const squaredDistance = (
  width: number,
  height: number,
  isFeature: (i: number) => boolean
): Float64Array => {
  const grid = new Float64Array(width * height);
  for (let i = 0; i < grid.length; i += 1) grid[i] = isFeature(i) ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float64Array(n);
  const d = new Float64Array(n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);
  for (let x = 0; x < width; x += 1) {
    for (let y = 0; y < height; y += 1) f[y] = grid[y * width + x];
    edt1d(f, height, d, v, z);
    for (let y = 0; y < height; y += 1) grid[y * width + x] = d[y];
  }
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) f[x] = grid[row + x];
    edt1d(f, width, d, v, z);
    for (let x = 0; x < width; x += 1) grid[row + x] = d[x];
  }
  return grid;
};

const HALF = 128;

/** Grow the selection outward by `radius` pixels, with a 1 px soft rim. */
export const expandSelection = (sel: Selection, radius: number): Selection => {
  if (radius <= 0) return sel;
  const { width, height, data } = sel;
  const dist = squaredDistance(width, height, (i) => data[i] >= HALF);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < out.length; i += 1) {
    const d = Math.sqrt(dist[i]);
    const grown = Math.round(Math.min(1, Math.max(0, radius - d + 0.5)) * 255);
    out[i] = Math.max(grown, data[i]);
  }
  return withData(sel, out);
};

/** Shrink the selection inward by `radius` pixels. */
export const contractSelection = (sel: Selection, radius: number): Selection => {
  if (radius <= 0) return sel;
  const { width, height, data } = sel;
  const dist = squaredDistance(width, height, (i) => data[i] < HALF);
  const out = new Uint8ClampedArray(data.length);
  for (let i = 0; i < out.length; i += 1) {
    const d = Math.sqrt(dist[i]);
    const kept = Math.round(Math.min(1, Math.max(0, d - radius - 0.5)) * 255);
    out[i] = Math.min(kept, data[i]);
  }
  return withData(sel, out);
};

/** One separable box blur pass, radius `r`, edges clamped. In place via `tmp`. */
const boxBlur = (src: Float32Array, tmp: Float32Array, width: number, height: number, r: number) => {
  if (r < 1) return;
  const span = 2 * r + 1;
  // Horizontal: src → tmp.
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += src[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x += 1) {
      tmp[row + x] = sum / span;
      const add = src[row + Math.min(width - 1, x + r + 1)];
      const drop = src[row + Math.max(0, x - r)];
      sum += add - drop;
    }
  }
  // Vertical: tmp → src.
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -r; k <= r; k += 1) sum += tmp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      src[y * width + x] = sum / span;
      const add = tmp[Math.min(height - 1, y + r + 1) * width + x];
      const drop = tmp[Math.max(0, y - r) * width + x];
      sum += add - drop;
    }
  }
};

/** Box radii whose three passes approximate a Gaussian of `sigma`. */
export const gaussianBoxes = (sigma: number): number[] => {
  const n = 3;
  const ideal = Math.sqrt((12 * sigma * sigma) / n + 1);
  let wl = Math.floor(ideal);
  if (wl % 2 === 0) wl -= 1;
  const wu = wl + 2;
  const m = Math.round((12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4));
  return Array.from({ length: n }, (_, i) => ((i < m ? wl : wu) - 1) / 2);
};

/** Gaussian blur of a float buffer, in place. */
export const gaussianBlur = (buf: Float32Array, width: number, height: number, sigma: number) => {
  if (sigma <= 0.25) return buf;
  const tmp = new Float32Array(buf.length);
  for (const r of gaussianBoxes(sigma)) boxBlur(buf, tmp, width, height, Math.max(0, Math.round(r)));
  return buf;
};

/**
 * Soften the edge by `radius` pixels. As in Photoshop, the feather radius is
 * about twice the blur's standard deviation.
 */
export const featherSelection = (sel: Selection, radius: number): Selection => {
  if (radius <= 0) return sel;
  const buf = Float32Array.from(sel.data);
  gaussianBlur(buf, sel.width, sel.height, radius / 2);
  return withData(sel, Uint8ClampedArray.from(buf, (v) => Math.round(v)));
};

/**
 * Round off corners and stray specks: blur, then cut back to a crisp edge at
 * the midpoint (with a one-pixel ramp so it stays anti-aliased).
 */
export const smoothSelection = (sel: Selection, radius: number): Selection => {
  if (radius <= 0) return sel;
  const buf = Float32Array.from(sel.data);
  gaussianBlur(buf, sel.width, sel.height, radius / 1.5);
  const out = new Uint8ClampedArray(buf.length);
  for (let i = 0; i < buf.length; i += 1) out[i] = Math.round(Math.min(1, Math.max(0, (buf[i] - 96) / 64)) * 255);
  return withData(sel, out);
};

/** A band `width` pixels wide straddling the current edge (Select ▸ Modify ▸ Border). */
export const borderSelection = (sel: Selection, width: number): Selection => {
  if (width <= 0) return sel;
  const half = width / 2;
  const outer = expandSelection(sel, half);
  const inner = contractSelection(sel, half);
  const out = new Uint8ClampedArray(sel.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = Math.max(0, outer.data[i] - inner.data[i]);
  // Photoshop's border is soft-edged.
  return featherSelection(withData(sel, out), Math.min(4, Math.max(1, width / 4)));
};

/**
 * Pixels within `radius` of the selection edge: the band where Select and
 * Mask looks for detail such as hair. 1 inside the band, 0 outside.
 */
export const edgeBand = (sel: Selection, radius: number): Float32Array => {
  const { width, height, data } = sel;
  const toInside = squaredDistance(width, height, (i) => data[i] >= HALF);
  const toOutside = squaredDistance(width, height, (i) => data[i] < HALF);
  const band = new Float32Array(data.length);
  const r2 = radius * radius;
  for (let i = 0; i < band.length; i += 1) {
    // Distance to the other side of the edge.
    const d = data[i] >= HALF ? toOutside[i] : toInside[i];
    band[i] = d <= r2 ? 1 : 0;
  }
  return band;
};
