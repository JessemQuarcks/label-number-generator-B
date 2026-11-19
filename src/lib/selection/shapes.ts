/**
 * Turning marquee, lasso and brush shapes into selection pixels.
 *
 * Everything is rasterised in plain JavaScript (no canvas), so it behaves the
 * same in every browser and in tests. Edges are anti-aliased by sampling
 * several sub-scanlines per pixel row and measuring exact horizontal span
 * coverage, which is what makes a lasso edge look smooth rather than jagged.
 */
import type { Selection, SelectionSize } from "./mask";
import { emptySelection } from "./mask";

export interface Pt {
  x: number;
  y: number;
}

/** Sub-scanlines per pixel row when anti-aliasing. */
const SUBSAMPLES = 4;

/**
 * Fill a closed polygon (selection pixel coordinates) using the even-odd
 * rule, so a lasso that crosses itself leaves a hole where it overlaps — as
 * Photoshop's does.
 */
export const fillPolygon = (size: SelectionSize, points: Pt[], antiAlias = true): Selection => {
  const sel = emptySelection(size);
  if (points.length < 3) return sel;
  const { width, height } = size;
  const n = points.length;

  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const rowStart = Math.max(0, Math.floor(minY));
  const rowEnd = Math.min(height - 1, Math.ceil(maxY));
  if (rowEnd < rowStart) return sel;

  // Edges as (x at top, slope, top, bottom), skipping horizontal ones.
  const edges: { x0: number; y0: number; y1: number; dxdy: number }[] = [];
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a.y === b.y) continue;
    const top = a.y < b.y ? a : b;
    const bottom = a.y < b.y ? b : a;
    edges.push({ x0: top.x, y0: top.y, y1: bottom.y, dxdy: (bottom.x - top.x) / (bottom.y - top.y) });
  }

  const subs = antiAlias ? SUBSAMPLES : 1;
  const weight = 1 / subs;
  const acc = new Float32Array(width);
  const xs: number[] = [];

  for (let row = rowStart; row <= rowEnd; row += 1) {
    acc.fill(0);
    let touched = false;
    for (let s = 0; s < subs; s += 1) {
      const y = row + (s + 0.5) / subs;
      xs.length = 0;
      for (const e of edges) {
        // Half-open in y so a shared vertex is counted once.
        if (y >= e.y0 && y < e.y1) xs.push(e.x0 + (y - e.y0) * e.dxdy);
      }
      if (xs.length < 2) continue;
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        let xa = xs[k];
        let xb = xs[k + 1];
        if (!antiAlias) {
          // Pixel centres inside the span.
          xa = Math.ceil(xa - 0.5);
          xb = Math.ceil(xb - 0.5);
        }
        xa = Math.max(0, xa);
        xb = Math.min(width, xb);
        if (xb <= xa) continue;
        touched = true;
        const ia = Math.floor(xa);
        const ib = Math.floor(xb);
        if (ia === ib) {
          acc[ia] += (xb - xa) * weight;
          continue;
        }
        acc[ia] += (ia + 1 - xa) * weight;
        for (let x = ia + 1; x < ib; x += 1) acc[x] += weight;
        if (ib < width) acc[ib] += (xb - ib) * weight;
      }
    }
    if (!touched) continue;
    const offset = row * width;
    for (let x = 0; x < width; x += 1) {
      if (acc[x] > 0) sel.data[offset + x] = Math.round(Math.min(1, acc[x]) * 255);
    }
  }
  return sel;
};

/** An axis-aligned rectangle, in selection pixels. */
export const fillRect = (
  size: SelectionSize,
  r: { x: number; y: number; width: number; height: number },
  antiAlias = true
): Selection =>
  fillPolygon(
    size,
    [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
      { x: r.x, y: r.y + r.height },
    ],
    antiAlias
  );

/** Points around an ellipse inscribed in `r`; enough of them to look round at any size. */
export const ellipsePoints = (r: { x: number; y: number; width: number; height: number }): Pt[] => {
  const cx = r.x + r.width / 2;
  const cy = r.y + r.height / 2;
  const rx = r.width / 2;
  const ry = r.height / 2;
  const steps = Math.min(1024, Math.max(32, Math.ceil(Math.PI * (rx + ry) * 0.75)));
  const out: Pt[] = [];
  for (let i = 0; i < steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
};

export const fillEllipse = (
  size: SelectionSize,
  r: { x: number; y: number; width: number; height: number },
  antiAlias = true
): Selection => fillPolygon(size, ellipsePoints(r), antiAlias);

/**
 * A round brush dragged along `points` — the area a Quick Selection or
 * Remove stroke covers. `radius` is in selection pixels.
 */
export const strokeMask = (size: SelectionSize, points: Pt[], radius: number): Selection => {
  const sel = emptySelection(size);
  if (points.length === 0 || radius <= 0) return sel;
  const { width, height, } = size;
  const r = Math.max(0.5, radius);
  const stamp = (cx: number, cy: number) => {
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(width - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(height - 1, Math.ceil(cy + r + 1));
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        // One pixel of soft edge.
        const v = Math.round(Math.min(1, Math.max(0, r - d + 0.5)) * 255);
        const i = y * width + x;
        if (v > sel.data[i]) sel.data[i] = v;
      }
    }
  };
  stamp(points[0].x, points[0].y);
  const step = Math.max(0.5, r / 3);
  for (let i = 1; i < points.length; i += 1) {
    const a = points[i - 1];
    const b = points[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const count = Math.ceil(len / step);
    for (let k = 1; k <= count; k += 1) {
      const t = k / count;
      stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    }
  }
  return sel;
};

/** Constrain a drag to a square/circle (Shift) and/or grow it from the centre (Alt). */
export const marqueeRect = (
  start: Pt,
  end: Pt,
  { square = false, fromCenter = false }: { square?: boolean; fromCenter?: boolean } = {}
): { x: number; y: number; width: number; height: number } => {
  let dx = end.x - start.x;
  let dy = end.y - start.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  if (fromCenter) {
    return { x: start.x - Math.abs(dx), y: start.y - Math.abs(dy), width: Math.abs(dx) * 2, height: Math.abs(dy) * 2 };
  }
  return {
    x: Math.min(start.x, start.x + dx),
    y: Math.min(start.y, start.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
};

/** Drop points closer than `minDist` to the previous kept one. Lassos collect a lot. */
export const simplifyPath = (points: Pt[], minDist = 0.5): Pt[] => {
  if (points.length < 3) return points.slice();
  const out: Pt[] = [points[0]];
  for (let i = 1; i < points.length; i += 1) {
    const last = out[out.length - 1];
    if (Math.hypot(points[i].x - last.x, points[i].y - last.y) >= minDist) out.push(points[i]);
  }
  return out;
};
