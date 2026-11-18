import { describe, expect, it } from "vitest";
import { intersects, normalizeRect, resizeBox, resizeCropRect } from "./geometry";

const box = { x: 10, y: 10, width: 40, height: 20 };

describe("resizing from the eight transform handles", () => {
  it("east edge changes only the width", () => {
    expect(resizeBox(box, 1, 0, 10, 99)).toEqual({ x: 10, y: 10, width: 50, height: 20 });
  });

  it("west edge moves the left side and keeps the right side fixed", () => {
    expect(resizeBox(box, -1, 0, 5, 0)).toEqual({ x: 15, y: 10, width: 35, height: 20 });
  });

  it("north and south edges change only the height", () => {
    expect(resizeBox(box, 0, -1, 99, -5)).toEqual({ x: 10, y: 5, width: 40, height: 25 });
    expect(resizeBox(box, 0, 1, 99, 5)).toEqual({ x: 10, y: 10, width: 40, height: 25 });
  });

  it("a corner moves both sides", () => {
    expect(resizeBox(box, 1, 1, 10, 10)).toEqual({ x: 10, y: 10, width: 50, height: 30 });
    expect(resizeBox(box, -1, -1, 10, 5)).toEqual({ x: 20, y: 15, width: 30, height: 15 });
  });

  it("keeps proportions when asked", () => {
    const r = resizeBox(box, 1, 1, 40, 0, { keepAspect: true });
    expect(r.width / r.height).toBeCloseTo(2);
    expect(r.width).toBeCloseTo(80);
  });

  it("an edge with proportions locked scales the other side about the centre", () => {
    const r = resizeBox(box, 1, 0, 40, 0, { keepAspect: true });
    expect(r.width).toBeCloseTo(80);
    expect(r.height).toBeCloseTo(40);
    expect(r.y).toBeCloseTo(0); // grew 10 up and 10 down
  });

  it("resizes about the centre with Alt", () => {
    expect(resizeBox(box, 1, 0, 5, 0, { fromCenter: true })).toEqual({ x: 5, y: 10, width: 50, height: 20 });
  });

  it("never shrinks below the minimum or inverts", () => {
    const r = resizeBox(box, 1, 1, -500, -500);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });
});

describe("crop rectangle handles", () => {
  const frame = { x: 0, y: 0, width: 100, height: 50 };
  const full = { ...frame };

  it("cannot be dragged outside the image", () => {
    expect(resizeCropRect(full, frame, 1, 0, 30, 0, null)).toEqual(full);
    expect(resizeCropRect(full, frame, -1, -1, -30, -30, null)).toEqual(full);
  });

  it("trims from the dragged edge", () => {
    expect(resizeCropRect(full, frame, 1, 0, -40, 0, null)).toEqual({ x: 0, y: 0, width: 60, height: 50 });
    expect(resizeCropRect(full, frame, 0, -1, 0, 10, null)).toEqual({ x: 0, y: 10, width: 100, height: 40 });
  });

  it("keeps a locked ratio from a corner", () => {
    const r = resizeCropRect(full, frame, 1, 1, -60, 0, 1);
    expect(r.width).toBeCloseTo(r.height);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });
});

describe("marquee helpers", () => {
  it("normalises a rectangle dragged in any direction", () => {
    expect(normalizeRect({ x: 10, y: 10 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 5 });
  });

  it("detects overlap", () => {
    expect(intersects(box, { x: 45, y: 25, width: 10, height: 10 })).toBe(true);
    expect(intersects(box, { x: 60, y: 0, width: 5, height: 5 })).toBe(false);
  });
});
