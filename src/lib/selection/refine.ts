/**
 * Select and Mask: edge refinement.
 *
 * The heart of it is a guided filter (He, Sun & Tang): the selection is
 * re-fitted, locally, as a linear function of the image's brightness. Where
 * the image has fine structure — hair against sky, fur against a wall — the
 * soft selection follows it; where the image is flat it stays smooth. It is
 * only applied in a band around the existing edge (the "edge detection
 * radius"), so the solid interior and the clear exterior never change.
 *
 * This runs entirely in the browser. The AI server's matting model, when
 * available, is a stronger alternative for hair; see "Refine hair".
 */
import type { Selection } from "./mask";
import { withData } from "./mask";
import { contractSelection, edgeBand, expandSelection, featherSelection, smoothSelection } from "./morph";
import type { Rgba } from "./wand";

/** Mean over a (2r+1)² window, edges clamped, using an integral image. */
const boxMean = (src: Float32Array, width: number, height: number, r: number): Float32Array => {
  const stride = width + 1;
  const integral = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    for (let x = 0; x < width; x += 1) {
      rowSum += src[y * width + x];
      integral[(y + 1) * stride + (x + 1)] = integral[y * stride + (x + 1)] + rowSum;
    }
  }
  const out = new Float32Array(src.length);
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(height - 1, y + r) + 1;
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(width - 1, x + r) + 1;
      const sum =
        integral[y1 * stride + x1] - integral[y0 * stride + x1] - integral[y1 * stride + x0] + integral[y0 * stride + x0];
      out[y * width + x] = sum / ((x1 - x0) * (y1 - y0));
    }
  }
  return out;
};

/**
 * Guided filter. `guide` and `input` are 0–1 floats of the same size; `eps`
 * sets how strong an image edge must be to be followed (smaller = finer).
 */
export const guidedFilter = (
  guide: Float32Array,
  input: Float32Array,
  width: number,
  height: number,
  r: number,
  eps: number
): Float32Array => {
  const n = guide.length;
  const meanI = boxMean(guide, width, height, r);
  const meanP = boxMean(input, width, height, r);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    ip[i] = guide[i] * input[i];
    ii[i] = guide[i] * guide[i];
  }
  const corrIp = boxMean(ip, width, height, r);
  const corrI = boxMean(ii, width, height, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const varI = corrI[i] - meanI[i] * meanI[i];
    const covIp = corrIp[i] - meanI[i] * meanP[i];
    a[i] = covIp / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, width, height, r);
  const meanB = boxMean(b, width, height, r);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i += 1) out[i] = meanA[i] * guide[i] + meanB[i];
  return out;
};

/** Perceived brightness, 0–1. */
export const luminance = (img: Rgba): Float32Array => {
  const out = new Float32Array(img.width * img.height);
  const d = img.data;
  for (let i = 0; i < out.length; i += 1) {
    out[i] = (0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]) / 255;
  }
  return out;
};

export interface RefineSettings {
  /** Edge detection radius, selection pixels. 0 = no edge refinement. */
  radius: number;
  /** Finer detail tracking for hair and fur (a smaller epsilon, wider window). */
  hair: boolean;
  /** Smooth, selection pixels. */
  smooth: number;
  /** Feather, selection pixels. */
  feather: number;
  /** Contrast, 0–100 %: hardens soft edges. */
  contrast: number;
  /** Shift edge, −100…100 %: of the edge radius (or 4 px), negative shrinks. */
  shiftEdge: number;
}

export const DEFAULT_REFINE: RefineSettings = {
  radius: 0,
  hair: false,
  smooth: 0,
  feather: 0,
  contrast: 0,
  shiftEdge: 0,
};

/** Re-fit the selection to image detail inside the edge band. */
export const refineEdges = (sel: Selection, img: Rgba, radius: number, hair: boolean): Selection => {
  if (radius <= 0 || img.width !== sel.width || img.height !== sel.height) return sel;
  const { width, height } = sel;
  const guide = luminance(img);
  const input = Float32Array.from(sel.data, (v) => v / 255);
  const r = Math.max(1, Math.round(hair ? radius * 0.75 : radius / 2));
  const eps = hair ? 1e-4 : 1e-3;
  const fitted = guidedFilter(guide, input, width, height, r, eps);
  const band = edgeBand(sel, radius);
  const out = new Uint8ClampedArray(sel.data.length);
  for (let i = 0; i < out.length; i += 1) {
    out[i] = band[i] ? Math.round(Math.min(1, Math.max(0, fitted[i])) * 255) : sel.data[i];
  }
  return withData(sel, out);
};

/** Push soft values towards 0 or 255. */
export const applyContrast = (sel: Selection, contrast: number): Selection => {
  if (contrast <= 0) return sel;
  const k = 1 + (Math.min(100, contrast) / 100) * 15;
  const out = new Uint8ClampedArray(sel.data.length);
  for (let i = 0; i < out.length; i += 1) {
    const v = (sel.data[i] / 255 - 0.5) * k + 0.5;
    out[i] = Math.round(Math.min(1, Math.max(0, v)) * 255);
  }
  return withData(sel, out);
};

/** Every Select and Mask setting, in Photoshop's order. */
export const refineSelection = (sel: Selection, img: Rgba | null, s: RefineSettings): Selection => {
  let out = sel;
  if (img && s.radius > 0) out = refineEdges(out, img, s.radius, s.hair);
  if (s.smooth > 0) out = smoothSelection(out, s.smooth);
  if (s.feather > 0) out = featherSelection(out, s.feather);
  if (s.contrast > 0) out = applyContrast(out, s.contrast);
  if (s.shiftEdge !== 0) {
    const px = (Math.abs(s.shiftEdge) / 100) * Math.max(4, s.radius);
    out = s.shiftEdge > 0 ? expandSelection(out, px) : contractSelection(out, px);
  }
  return out;
};
