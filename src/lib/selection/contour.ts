/**
 * The selection outline ("marching ants").
 *
 * The outline follows pixel edges between pixels on either side of the 50%
 * line — where Photoshop draws it for soft selections too. Edges are
 * oriented (selected side always on the right) and chained vertex to vertex
 * into closed loops, so each island and hole is one continuous subpath.
 * That matters for the ants: a dash pattern restarts at every subpath, and
 * only continuous loops "march" evenly along diagonal edges. Straight runs
 * are merged, and the result is an SVG path in selection pixels that the
 * overlay scales with a viewBox, so zooming never recomputes it.
 */
import type { Selection } from "./mask";

/** Past this many corner points the outline is traced at half resolution. */
const MAX_POINTS = 120_000;

const traceLoops = (inside: (x: number, y: number) => boolean, width: number, height: number, unit: number) => {
  const vw = width + 1;
  const n = vw * (height + 1);
  // Each vertex has at most two outgoing edges (two at a diagonal saddle).
  const outA = new Int32Array(n).fill(-1);
  const outB = new Int32Array(n).fill(-1);
  const add = (from: number, to: number) => {
    if (outA[from] < 0) outA[from] = to;
    else outB[from] = to;
  };
  const v = (x: number, y: number) => y * vw + x;

  // Horizontal edges between row y-1 (above) and row y (below).
  for (let y = 0; y <= height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const above = inside(x, y - 1);
      const below = inside(x, y);
      if (below && !above) add(v(x, y), v(x + 1, y));
      else if (above && !below) add(v(x + 1, y), v(x, y));
    }
  }
  // Vertical edges between column x-1 (left) and column x (right).
  for (let x = 0; x <= width; x += 1) {
    for (let y = 0; y < height; y += 1) {
      const left = inside(x - 1, y);
      const right = inside(x, y);
      if (right && !left) add(v(x, y + 1), v(x, y));
      else if (left && !right) add(v(x, y), v(x, y + 1));
    }
  }

  const parts: string[] = [];
  let points = 0;
  const take = (from: number): number => {
    if (outA[from] >= 0) {
      const to = outA[from];
      outA[from] = -1;
      return to;
    }
    const to = outB[from];
    outB[from] = -1;
    return to;
  };
  for (let start = 0; start < n; start += 1) {
    while (outA[start] >= 0 || outB[start] >= 0) {
      // Walk one loop, keeping only the corners.
      const corners: number[] = [start];
      let cur = take(start);
      let dir = cur - start;
      while (cur !== start && cur >= 0) {
        const next = take(cur);
        if (next < 0) break;
        const nextDir = next - cur;
        if (nextDir !== dir) corners.push(cur);
        cur = next;
        dir = nextDir;
      }
      if (corners.length < 2) continue;
      points += corners.length;
      let d = "";
      for (let i = 0; i < corners.length; i += 1) {
        const c = corners[i];
        const x = (c % vw) * unit;
        const y = Math.floor(c / vw) * unit;
        d += `${i === 0 ? "M" : "L"}${x} ${y}`;
      }
      parts.push(`${d}Z`);
    }
  }
  return { path: parts.join(""), points };
};

/** An SVG path of the selection edge, in selection pixel units. "" when nothing is selected. */
export const outlinePath = (sel: Selection, threshold = 127): string => {
  const { width, height, data } = sel;
  const full = traceLoops(
    (x, y) => x >= 0 && y >= 0 && x < width && y < height && data[y * width + x] > threshold,
    width,
    height,
    1
  );
  if (full.points <= MAX_POINTS) return full.path;
  // Very busy selections (a wand on noise) would make a huge path; trace a
  // half-resolution version instead. It is only a guide for the eye.
  const hw = Math.ceil(width / 2);
  const hh = Math.ceil(height / 2);
  const half = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= hw || y >= hh) return false;
    const sx = Math.min(width - 1, x * 2);
    const sy = Math.min(height - 1, y * 2);
    return data[sy * width + sx] > threshold;
  };
  return traceLoops(half, hw, hh, 2).path;
};
