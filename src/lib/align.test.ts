import { describe, expect, it } from "vitest";
import { align, alignReference, boundsOf, distribute } from "./align";
import type { Box } from "./align";

const label = { width: 120, height: 90 };
const a: Box = { id: "a", x: 10, y: 20, width: 20, height: 10 };
const b: Box = { id: "b", x: 50, y: 5, width: 30, height: 40 };

describe("alignment reference", () => {
  it("uses the selection bounds for two or more layers", () => {
    expect(alignReference([a, b], "selection", label)).toEqual({ x: 10, y: 5, width: 70, height: 40 });
  });

  it("falls back to the label for a single layer, where the selection would be a no-op", () => {
    expect(alignReference([a], "selection", label)).toEqual({ x: 0, y: 0, width: 120, height: 90 });
  });

  it("uses the label when asked to", () => {
    expect(alignReference([a, b], "canvas", label)).toEqual({ x: 0, y: 0, width: 120, height: 90 });
  });

  it("has no reference for an empty selection", () => {
    expect(alignReference([], "canvas", label)).toBeNull();
    expect(boundsOf([])).toBeNull();
  });
});

describe("align to the selection", () => {
  const ref = boundsOf([a, b])!;

  it.each([
    ["left", { a: { x: 10, y: 20 }, b: { x: 10, y: 5 } }],
    ["right", { a: { x: 60, y: 20 }, b: { x: 50, y: 5 } }],
    ["hcenter", { a: { x: 35, y: 20 }, b: { x: 30, y: 5 } }],
    ["top", { a: { x: 10, y: 5 }, b: { x: 50, y: 5 } }],
    ["bottom", { a: { x: 10, y: 35 }, b: { x: 50, y: 5 } }],
    ["vcenter", { a: { x: 10, y: 20 }, b: { x: 50, y: 5 } }],
    ["center", { a: { x: 35, y: 20 }, b: { x: 30, y: 5 } }],
  ] as const)("%s", (alignment, expected) => {
    expect(align([a, b], alignment, ref)).toEqual(expected);
  });
});

describe("align to the label", () => {
  const ref = { x: 0, y: 0, ...label };

  it("centres both ways", () => {
    expect(align([a], "center", ref)).toEqual({ a: { x: 50, y: 40 } });
  });

  it("pins to the right and bottom edges", () => {
    expect(align([a], "right", ref).a.x).toBe(100);
    expect(align([a], "bottom", ref).a.y).toBe(80);
  });

  it("never changes a layer's size", () => {
    const out = align([a, b], "center", ref);
    for (const pos of Object.values(out)) {
      expect(Object.keys(pos).sort()).toEqual(["x", "y"]);
    }
  });
});

describe("distribute", () => {
  it("spaces three layers with equal gaps, keeping the outer two in place", () => {
    const boxes: Box[] = [
      { id: "l", x: 0, y: 0, width: 10, height: 10 },
      { id: "m", x: 15, y: 0, width: 10, height: 10 },
      { id: "r", x: 90, y: 0, width: 10, height: 10 },
    ];
    const out = distribute(boxes, "horizontal", boundsOf(boxes)!);
    expect(out.l.x).toBe(0);
    expect(out.m.x).toBe(45);
    expect(out.r.x).toBe(90);
  });

  it("spreads across the label when the label is the reference", () => {
    const out = distribute([a, b], "vertical", { x: 0, y: 0, ...label });
    // b sits higher, so it is pinned to the top and a to the bottom.
    expect(out.b.y).toBe(0);
    expect(out.a.y).toBe(80);
  });
});
