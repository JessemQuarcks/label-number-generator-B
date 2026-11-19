/**
 * The pixel selection.
 *
 * Like Photoshop's, a selection here is a greyscale mask over the whole
 * label: 255 is fully selected, 0 is not, and anything between is a soft
 * (feathered or anti-aliased) edge. It is laid out in label millimetres at a
 * uniform `pxPerMm`, so it is independent of zoom and of any one layer.
 *
 * Selections are immutable values: every operation returns a new one, which
 * keeps "Reselect" and React state updates trivial.
 */

export interface Selection {
  width: number;
  height: number;
  /** Selection pixels per label millimetre (same on both axes). */
  pxPerMm: number;
  /** Row-major coverage, 0–255. */
  data: Uint8ClampedArray;
}

export type SelectionMode = "new" | "add" | "subtract" | "intersect";

export interface SelectionSize {
  width: number;
  height: number;
  pxPerMm: number;
}

/** Print resolution, as for pixel layers. */
export const SELECTION_DPI = 300;
/** Longest side, in selection pixels. Keeps every operation interactive. */
export const SELECTION_MAX_PX = 2048;

/** The selection grid for a label of `widthMm` × `heightMm`. */
export const selectionSize = (widthMm: number, heightMm: number): SelectionSize => {
  const ideal = SELECTION_DPI / 25.4;
  const longest = Math.max(widthMm, heightMm, 1e-6);
  const pxPerMm = Math.min(ideal, SELECTION_MAX_PX / longest);
  return {
    width: Math.max(1, Math.round(widthMm * pxPerMm)),
    height: Math.max(1, Math.round(heightMm * pxPerMm)),
    pxPerMm,
  };
};

export const sameGrid = (a: SelectionSize, b: SelectionSize) =>
  a.width === b.width && a.height === b.height && Math.abs(a.pxPerMm - b.pxPerMm) < 1e-9;

export const emptySelection = (size: SelectionSize): Selection => ({
  width: size.width,
  height: size.height,
  pxPerMm: size.pxPerMm,
  data: new Uint8ClampedArray(size.width * size.height),
});

export const fullSelection = (size: SelectionSize): Selection => {
  const sel = emptySelection(size);
  sel.data.fill(255);
  return sel;
};

export const withData = (size: SelectionSize, data: Uint8ClampedArray): Selection => ({
  width: size.width,
  height: size.height,
  pxPerMm: size.pxPerMm,
  data,
});

export interface PxBounds {
  x0: number;
  y0: number;
  /** Exclusive. */
  x1: number;
  y1: number;
}

/** The smallest box holding every pixel above `threshold`, or null if none. */
export const selectionBounds = (sel: Selection, threshold = 0): PxBounds | null => {
  const { width, height, data } = sel;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let first = -1;
    let last = -1;
    for (let x = 0; x < width; x += 1) {
      if (data[row + x] > threshold) {
        if (first < 0) first = x;
        last = x;
      }
    }
    if (first < 0) continue;
    if (first < x0) x0 = first;
    if (last > x1) x1 = last;
    if (y < y0) y0 = y;
    y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
};

/** True when nothing is selected (every pixel at or below `threshold`). */
export const isEmptySelection = (sel: Selection | null, threshold = 0): boolean => {
  if (!sel) return true;
  const { data } = sel;
  for (let i = 0; i < data.length; i += 1) if (data[i] > threshold) return false;
  return true;
};

/** Selected share of the label, 0–1, counting soft pixels by coverage. */
export const coverage = (sel: Selection): number => {
  let sum = 0;
  for (let i = 0; i < sel.data.length; i += 1) sum += sel.data[i];
  return sum / (255 * Math.max(1, sel.data.length));
};

/**
 * Combine a new shape with the current selection. Soft values combine the
 * way Photoshop's do: add keeps the stronger, subtract scales the base down
 * by the shape, intersect keeps the weaker.
 */
export const combine = (
  base: Selection | null,
  shape: Selection,
  mode: SelectionMode
): Selection => {
  if (mode === "new") return shape;
  if (!base || base.width !== shape.width || base.height !== shape.height) {
    // With no selection to work against, adding starts one, while taking
    // away from or overlapping with nothing leaves nothing.
    return mode === "add" ? shape : emptySelection(shape);
  }
  const out = new Uint8ClampedArray(shape.data.length);
  const a = base.data;
  const b = shape.data;
  switch (mode) {
    case "add":
      for (let i = 0; i < out.length; i += 1) out[i] = a[i] > b[i] ? a[i] : b[i];
      break;
    case "subtract":
      for (let i = 0; i < out.length; i += 1) out[i] = Math.round((a[i] * (255 - b[i])) / 255);
      break;
    case "intersect":
      for (let i = 0; i < out.length; i += 1) out[i] = a[i] < b[i] ? a[i] : b[i];
      break;
  }
  return withData(shape, out);
};

export const invertSelection = (sel: Selection): Selection => {
  const out = new Uint8ClampedArray(sel.data.length);
  for (let i = 0; i < out.length; i += 1) out[i] = 255 - sel.data[i];
  return withData(sel, out);
};

/** Photoshop's modifier keys: Shift adds, Alt subtracts, both intersect. */
export const modeFromModifiers = (
  e: { shiftKey: boolean; altKey: boolean },
  fallback: SelectionMode
): SelectionMode => {
  if (e.shiftKey && e.altKey) return "intersect";
  if (e.shiftKey) return "add";
  if (e.altKey) return "subtract";
  return fallback;
};

/* -------------------------------------------------------------------------
 * Coordinates
 * ---------------------------------------------------------------------- */

export const mmToPx = (sel: SelectionSize, mm: number) => mm * sel.pxPerMm;
export const pxToMm = (sel: SelectionSize, px: number) => px / sel.pxPerMm;

/** A selection-pixel box as a label rectangle in mm. */
export const boundsToMm = (sel: SelectionSize, b: PxBounds) => ({
  x: b.x0 / sel.pxPerMm,
  y: b.y0 / sel.pxPerMm,
  width: (b.x1 - b.x0) / sel.pxPerMm,
  height: (b.y1 - b.y0) / sel.pxPerMm,
});

/** A label rectangle (mm) as whole selection pixels, clamped to the grid. */
export const mmRectToPx = (
  sel: SelectionSize,
  r: { x: number; y: number; width: number; height: number }
): PxBounds => {
  const x0 = Math.max(0, Math.floor(r.x * sel.pxPerMm));
  const y0 = Math.max(0, Math.floor(r.y * sel.pxPerMm));
  const x1 = Math.min(sel.width, Math.ceil((r.x + r.width) * sel.pxPerMm));
  const y1 = Math.min(sel.height, Math.ceil((r.y + r.height) * sel.pxPerMm));
  return { x0, y0, x1: Math.max(x0, x1), y1: Math.max(y0, y1) };
};

/** Copy a box out of a single-channel buffer. */
export const cropGray = (
  data: Uint8ClampedArray,
  width: number,
  b: PxBounds
): Uint8ClampedArray => {
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  const out = new Uint8ClampedArray(Math.max(0, w * h));
  for (let y = 0; y < h; y += 1) {
    const src = (b.y0 + y) * width + b.x0;
    out.set(data.subarray(src, src + w), y * w);
  }
  return out;
};

/** Paste a `w`×`h` single-channel buffer into a selection at (x, y). */
export const pasteGray = (
  size: SelectionSize,
  patch: Uint8ClampedArray,
  w: number,
  h: number,
  x: number,
  y: number
): Selection => {
  const sel = emptySelection(size);
  for (let row = 0; row < h; row += 1) {
    const ty = y + row;
    if (ty < 0 || ty >= size.height) continue;
    for (let col = 0; col < w; col += 1) {
      const tx = x + col;
      if (tx < 0 || tx >= size.width) continue;
      sel.data[ty * size.width + tx] = patch[row * w + col];
    }
  }
  return sel;
};

/** Bilinear resample of a single-channel buffer. */
export const resizeGray = (
  data: Uint8ClampedArray,
  w: number,
  h: number,
  tw: number,
  th: number
): Uint8ClampedArray => {
  if (w === tw && h === th) return new Uint8ClampedArray(data);
  const out = new Uint8ClampedArray(tw * th);
  const sx = w / tw;
  const sy = h / th;
  for (let y = 0; y < th; y += 1) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), h - 1);
    const y0 = Math.floor(fy);
    const y1 = Math.min(y0 + 1, h - 1);
    const ty = fy - y0;
    for (let x = 0; x < tw; x += 1) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), w - 1);
      const x0 = Math.floor(fx);
      const x1 = Math.min(x0 + 1, w - 1);
      const tx = fx - x0;
      const top = data[y0 * w + x0] * (1 - tx) + data[y0 * w + x1] * tx;
      const bottom = data[y1 * w + x0] * (1 - tx) + data[y1 * w + x1] * tx;
      out[y * tw + x] = Math.round(top * (1 - ty) + bottom * ty);
    }
  }
  return out;
};

/** Bilinear sample of a single-channel buffer at fractional pixel (x, y). */
export const sampleGray = (data: Uint8ClampedArray, w: number, h: number, x: number, y: number): number => {
  if (x < -0.5 || y < -0.5 || x > w - 0.5 || y > h - 0.5) return 0;
  const fx = Math.min(Math.max(x, 0), w - 1);
  const fy = Math.min(Math.max(y, 0), h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = data[y0 * w + x0] * (1 - tx) + data[y0 * w + x1] * tx;
  const bottom = data[y1 * w + x0] * (1 - tx) + data[y1 * w + x1] * tx;
  return top * (1 - ty) + bottom * ty;
};

/** Resample a selection onto another grid (a label resize, say). */
export const resampleSelection = (sel: Selection, size: SelectionSize): Selection =>
  withData(size, resizeGray(sel.data, sel.width, sel.height, size.width, size.height));

/**
 * Move a selection onto a new grid keeping its position in millimetres —
 * for when the label is resized and the selection grid changes with it.
 */
export const regridSelection = (sel: Selection, size: SelectionSize): Selection => {
  const out = emptySelection(size);
  const k = sel.pxPerMm / size.pxPerMm;
  for (let y = 0; y < size.height; y += 1) {
    const sy = (y + 0.5) * k - 0.5;
    for (let x = 0; x < size.width; x += 1) {
      out.data[y * size.width + x] = Math.round(sampleGray(sel.data, sel.width, sel.height, (x + 0.5) * k - 0.5, sy));
    }
  }
  return out;
};
