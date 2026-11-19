/**
 * Which part of the label an AI call sees, and at what resolution.
 *
 * Models work best on a few hundred to ~1500 pixels a side. A small
 * selection on a label is only a few dozen selection pixels across, so the
 * region around it is rendered at a higher resolution of its own; a big one
 * is rendered no larger than the model needs. Masks move between the
 * label-wide selection grid and a region with the two helpers at the end.
 */
import type { Rect } from "../imageEdit";
import type { Selection, SelectionSize } from "../selection/mask";
import { boundsToMm, emptySelection, sampleGray, selectionBounds } from "../selection/mask";

export interface Region {
  /** Label area, mm. */
  rect: Rect;
  pxPerMm: number;
  /** Pixel size the region is rendered at. */
  width: number;
  height: number;
}

export interface RegionOptions {
  /** Context around the selection, as a share of its larger side. */
  margin?: number;
  /** Smallest margin, mm. */
  minMarginMm?: number;
  /** Render the longer side at least this many pixels… */
  minPx?: number;
  /** …and at most this many. */
  maxPx?: number;
}

const clampRect = (r: Rect, w: number, h: number): Rect => {
  const x0 = Math.max(0, r.x);
  const y0 = Math.max(0, r.y);
  const x1 = Math.min(w, r.x + r.width);
  const y1 = Math.min(h, r.y + r.height);
  return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
};

/** A region covering `rect` (mm), clamped to the label, at a model-friendly resolution. */
export const regionForRect = (
  rect: Rect,
  label: { width: number; height: number },
  { minPx = 768, maxPx = 1536 }: RegionOptions = {}
): Region | null => {
  const r = clampRect(rect, label.width, label.height);
  if (r.width <= 0 || r.height <= 0) return null;
  const longest = Math.max(r.width, r.height);
  // Print resolution, unless that makes the longest side smaller than the
  // model wants (small regions) or bigger than it can take (large ones).
  const pxPerMm = Math.min(Math.max(300 / 25.4, minPx / longest), maxPx / longest);
  return {
    rect: r,
    pxPerMm,
    width: Math.max(1, Math.round(r.width * pxPerMm)),
    height: Math.max(1, Math.round(r.height * pxPerMm)),
  };
};

/** The selection's bounding box plus context, as a region. Null when nothing is selected. */
export const regionForSelection = (
  sel: Selection,
  label: { width: number; height: number },
  opts: RegionOptions = {}
): Region | null => {
  const b = selectionBounds(sel, 8);
  if (!b) return null;
  const box = boundsToMm(sel, b);
  const pad = Math.max(opts.minMarginMm ?? 2, Math.max(box.width, box.height) * (opts.margin ?? 0.3));
  return regionForRect({ x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }, label, opts);
};

/** The selection resampled onto a region's pixels. */
export const selectionToRegion = (sel: Selection, region: Region): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(region.width * region.height);
  const sx = region.rect.width / region.width;
  const sy = region.rect.height / region.height;
  for (let y = 0; y < region.height; y += 1) {
    const my = region.rect.y + (y + 0.5) * sy;
    for (let x = 0; x < region.width; x += 1) {
      const mx = region.rect.x + (x + 0.5) * sx;
      out[y * region.width + x] = Math.round(
        sampleGray(sel.data, sel.width, sel.height, mx * sel.pxPerMm - 0.5, my * sel.pxPerMm - 0.5)
      );
    }
  }
  return out;
};

/** A region-sized mask placed back onto the label-wide selection grid (outside = 0). */
export const regionToSelection = (
  mask: Uint8ClampedArray,
  maskWidth: number,
  maskHeight: number,
  region: Region,
  size: SelectionSize
): Selection => {
  const sel = emptySelection(size);
  const x0 = Math.max(0, Math.floor(region.rect.x * size.pxPerMm));
  const y0 = Math.max(0, Math.floor(region.rect.y * size.pxPerMm));
  const x1 = Math.min(size.width, Math.ceil((region.rect.x + region.rect.width) * size.pxPerMm));
  const y1 = Math.min(size.height, Math.ceil((region.rect.y + region.rect.height) * size.pxPerMm));
  const kx = maskWidth / region.rect.width;
  const ky = maskHeight / region.rect.height;
  for (let y = y0; y < y1; y += 1) {
    const my = (y + 0.5) / size.pxPerMm;
    const v = (my - region.rect.y) * ky - 0.5;
    for (let x = x0; x < x1; x += 1) {
      const mx = (x + 0.5) / size.pxPerMm;
      const u = (mx - region.rect.x) * kx - 0.5;
      sel.data[y * size.width + x] = Math.round(sampleGray(mask, maskWidth, maskHeight, u, v));
    }
  }
  return sel;
};

/** A label point (mm) as region pixels. */
export const mmToRegionPx = (region: Region, p: { x: number; y: number }) => ({
  x: (p.x - region.rect.x) * (region.width / region.rect.width),
  y: (p.y - region.rect.y) * (region.height / region.rect.height),
});

/** Harden a soft mask for a model that wants a binary one, growing it slightly. */
export const binarizeForModel = (mask: Uint8ClampedArray, threshold = 24): Uint8ClampedArray =>
  Uint8ClampedArray.from(mask, (v) => (v > threshold ? 255 : 0));

/** Sizes text-to-image models are happy with: multiples of 64, ~1 megapixel. */
export const generationSize = (aspect: number, megapixels = 1): { width: number; height: number } => {
  const a = Math.min(Math.max(aspect, 1 / 4), 4);
  const area = megapixels * 1024 * 1024;
  const h = Math.sqrt(area / a);
  const snap = (n: number) => Math.min(2048, Math.max(256, Math.round(n / 64) * 64));
  return { width: snap(h * a), height: snap(h) };
};
