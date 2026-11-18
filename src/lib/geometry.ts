import type { Rect } from "./imageEdit";

/** The smallest an element may be dragged to — never zero. */
export const MIN_ELEMENT_MM = 1;

/**
 * Resize a box by dragging one of its handles.
 * - keepAspect: scale both sides together (Shift, or the default for image corners)
 * - fromCenter: grow symmetrically about the centre (Alt)
 */
export const resizeBox = (
  o: Rect,
  hx: -1 | 0 | 1,
  hy: -1 | 0 | 1,
  dx: number,
  dy: number,
  { keepAspect = false, fromCenter = false, min = MIN_ELEMENT_MM } = {}
): Rect => {
  const k = fromCenter ? 2 : 1;
  let w = hx ? o.width + hx * dx * k : o.width;
  let h = hy ? o.height + hy * dy * k : o.height;
  if (keepAspect && o.height > 0) {
    const ratio = o.width / o.height;
    if (hx && hy) {
      if (Math.abs(w / o.width) >= Math.abs(h / o.height)) h = w / ratio;
      else w = h * ratio;
    } else if (hx) {
      h = w / ratio;
    } else if (hy) {
      w = h * ratio;
    }
    if (w < min || h < min) {
      const grow = Math.max(min / Math.max(w, 1e-6), min / Math.max(h, 1e-6));
      w *= grow;
      h *= grow;
    }
  }
  w = Math.max(min, w);
  h = Math.max(min, h);
  const centreX = fromCenter || (keepAspect && !hx);
  const centreY = fromCenter || (keepAspect && !hy);
  const x = centreX ? o.x + (o.width - w) / 2 : hx === -1 ? o.x + o.width - w : o.x;
  const y = centreY ? o.y + (o.height - h) / 2 : hy === -1 ? o.y + o.height - h : o.y;
  return { x, y, width: w, height: h };
};

/**
 * Resize a crop rectangle inside its image frame. Edges can never leave the
 * frame; with a locked ratio the box shrinks on one axis to keep it.
 */
export const resizeCropRect = (
  r: Rect,
  bounds: Rect,
  hx: -1 | 0 | 1,
  hy: -1 | 0 | 1,
  dx: number,
  dy: number,
  ratio: number | null,
  min = MIN_ELEMENT_MM
): Rect => {
  const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));
  let left = r.x;
  let top = r.y;
  let right = r.x + r.width;
  let bottom = r.y + r.height;
  if (hx === -1) left = clamp(left + dx, bounds.x, right - min);
  if (hx === 1) right = clamp(right + dx, left + min, bounds.x + bounds.width);
  if (hy === -1) top = clamp(top + dy, bounds.y, bottom - min);
  if (hy === 1) bottom = clamp(bottom + dy, top + min, bounds.y + bounds.height);
  if (ratio && hx && hy) {
    let w = right - left;
    let h = bottom - top;
    if (w / h > ratio) w = h * ratio;
    else h = w / ratio;
    if (hx === -1) left = right - w;
    else right = left + w;
    if (hy === -1) top = bottom - h;
    else bottom = top + h;
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
};

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export const normalizeRect = (a: { x: number; y: number }, b: { x: number; y: number }): Rect => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.abs(a.x - b.x),
  height: Math.abs(a.y - b.y),
});

