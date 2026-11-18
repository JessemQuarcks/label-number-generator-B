import { round } from "./units";

export type Alignment =
  | "left"
  | "hcenter"
  | "right"
  | "top"
  | "vcenter"
  | "bottom"
  | "center";

export type Distribution = "horizontal" | "vertical";

/** What the selection is lined up against. */
export type AlignTarget = "selection" | "canvas";

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const ALIGNMENTS: { key: Alignment; label: string }[] = [
  { key: "left", label: "Align left edges" },
  { key: "hcenter", label: "Align horizontal centres" },
  { key: "right", label: "Align right edges" },
  { key: "top", label: "Align top edges" },
  { key: "vcenter", label: "Align vertical centres" },
  { key: "bottom", label: "Align bottom edges" },
  { key: "center", label: "Centre both ways" },
];

export const DISTRIBUTIONS: { key: Distribution; label: string }[] = [
  { key: "horizontal", label: "Distribute horizontally" },
  { key: "vertical", label: "Distribute vertically" },
];

/** The smallest rectangle containing every box. */
export const boundsOf = (boxes: Box[]): Bounds | null => {
  if (boxes.length === 0) return null;
  const left = Math.min(...boxes.map((b) => b.x));
  const top = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x: left, y: top, width: right - left, height: bottom - top };
};

/**
 * Where to line things up. Aligning a lone layer "to the selection" would do
 * nothing, so a single layer always aligns to the label instead.
 */
export const alignReference = (
  boxes: Box[],
  target: AlignTarget,
  canvas: { width: number; height: number }
): Bounds | null => {
  if (boxes.length === 0) return null;
  if (target === "canvas" || boxes.length === 1) {
    return { x: 0, y: 0, width: canvas.width, height: canvas.height };
  }
  return boundsOf(boxes);
};

/** New positions for each box, keyed by id. Sizes are never changed. */
export const align = (
  boxes: Box[],
  alignment: Alignment,
  reference: Bounds
): Record<string, { x: number; y: number }> => {
  const out: Record<string, { x: number; y: number }> = {};
  const r = (n: number) => round(n, 3);
  for (const b of boxes) {
    let { x, y } = b;
    if (alignment === "left") x = reference.x;
    if (alignment === "right") x = reference.x + reference.width - b.width;
    if (alignment === "hcenter" || alignment === "center") {
      x = reference.x + (reference.width - b.width) / 2;
    }
    if (alignment === "top") y = reference.y;
    if (alignment === "bottom") y = reference.y + reference.height - b.height;
    if (alignment === "vcenter" || alignment === "center") {
      y = reference.y + (reference.height - b.height) / 2;
    }
    out[b.id] = { x: r(x), y: r(y) };
  }
  return out;
};

/**
 * Spread boxes so the gaps between them are equal. The outermost boxes stay
 * put — against the label, they are first pinned to its edges.
 */
export const distribute = (
  boxes: Box[],
  direction: Distribution,
  reference: Bounds
): Record<string, { x: number; y: number }> => {
  const out: Record<string, { x: number; y: number }> = {};
  if (boxes.length < 2) return out;
  const horizontal = direction === "horizontal";
  const start = horizontal ? reference.x : reference.y;
  const span = horizontal ? reference.width : reference.height;
  const sizeOf = (b: Box) => (horizontal ? b.width : b.height);
  const posOf = (b: Box) => (horizontal ? b.x : b.y);
  const sorted = [...boxes].sort((a, b) => posOf(a) - posOf(b));
  const total = sorted.reduce((sum, b) => sum + sizeOf(b), 0);
  const gap = (span - total) / (sorted.length - 1);
  let cursor = start;
  for (const b of sorted) {
    const next = round(cursor, 3);
    out[b.id] = horizontal ? { x: next, y: b.y } : { x: b.x, y: next };
    cursor += sizeOf(b) + gap;
  }
  return out;
};
