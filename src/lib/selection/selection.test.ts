import { describe, expect, it } from "vitest";
import {
  combine,
  coverage,
  cropGray,
  emptySelection,
  fullSelection,
  invertSelection,
  isEmptySelection,
  mmRectToPx,
  modeFromModifiers,
  pasteGray,
  resizeGray,
  sampleGray,
  selectionBounds,
  selectionSize,
  SELECTION_MAX_PX,
} from "./mask";
import type { Selection } from "./mask";
import { ellipsePoints, fillEllipse, fillPolygon, fillRect, marqueeRect, strokeMask } from "./shapes";
import {
  borderSelection,
  contractSelection,
  edgeBand,
  expandSelection,
  featherSelection,
  smoothSelection,
} from "./morph";
import { magicWand, quickSelect } from "./wand";
import type { Rgba } from "./wand";
import { outlinePath } from "./contour";
import { applyContrast, guidedFilter, refineSelection, DEFAULT_REFINE } from "./refine";
import { encodePngFallback, encodeGrayPng } from "./pixels";

const size = { width: 40, height: 30, pxPerMm: 1 };
const at = (sel: Selection, x: number, y: number) => sel.data[y * sel.width + x];
const count = (sel: Selection, threshold = 127) => sel.data.reduce((n, v) => n + (v > threshold ? 1 : 0), 0);

/** A two-colour test image: left half red, right half blue. */
const halves = (w = 40, h = 30): Rgba => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const left = x < w / 2;
      data[i] = left ? 220 : 10;
      data[i + 1] = 20;
      data[i + 2] = left ? 10 : 220;
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
};

describe("selection grid", () => {
  it("uses print resolution, capped so the longest side stays interactive", () => {
    const small = selectionSize(100, 50);
    expect(small.pxPerMm).toBeCloseTo(300 / 25.4);
    expect(small.width).toBe(Math.round(100 * (300 / 25.4)));
    const huge = selectionSize(2000, 500);
    expect(Math.max(huge.width, huge.height)).toBeLessThanOrEqual(SELECTION_MAX_PX);
    expect(huge.width / huge.height).toBeCloseTo(4, 1);
  });

  it("converts mm rectangles to clamped pixel boxes", () => {
    expect(mmRectToPx(size, { x: -5, y: 2.2, width: 10, height: 100 })).toEqual({ x0: 0, y0: 2, x1: 5, y1: 30 });
  });
});

describe("combining selections", () => {
  const a = fillRect(size, { x: 0, y: 0, width: 20, height: 30 }, false);
  const b = fillRect(size, { x: 10, y: 0, width: 20, height: 30 }, false);

  it("adds, subtracts and intersects", () => {
    expect(count(combine(a, b, "add"))).toBe(30 * 30);
    expect(count(combine(a, b, "subtract"))).toBe(10 * 30);
    expect(count(combine(a, b, "intersect"))).toBe(10 * 30);
    expect(combine(a, b, "new")).toBe(b);
  });

  it("starts a selection when adding to nothing, and leaves nothing when subtracting from nothing", () => {
    expect(combine(null, b, "add")).toBe(b);
    expect(isEmptySelection(combine(null, b, "subtract"))).toBe(true);
    expect(isEmptySelection(combine(null, b, "intersect"))).toBe(true);
  });

  it("inverts", () => {
    const inv = invertSelection(a);
    expect(at(inv, 5, 5)).toBe(0);
    expect(at(inv, 35, 5)).toBe(255);
    expect(isEmptySelection(invertSelection(fullSelection(size)))).toBe(true);
  });

  it("reads Photoshop's modifier keys", () => {
    expect(modeFromModifiers({ shiftKey: true, altKey: false }, "new")).toBe("add");
    expect(modeFromModifiers({ shiftKey: false, altKey: true }, "new")).toBe("subtract");
    expect(modeFromModifiers({ shiftKey: true, altKey: true }, "new")).toBe("intersect");
    expect(modeFromModifiers({ shiftKey: false, altKey: false }, "add")).toBe("add");
  });

  it("finds bounds and coverage", () => {
    expect(selectionBounds(emptySelection(size))).toBeNull();
    expect(selectionBounds(b)).toEqual({ x0: 10, y0: 0, x1: 30, y1: 30 });
    expect(coverage(fullSelection(size))).toBe(1);
    expect(coverage(a)).toBeCloseTo(0.5);
  });
});

describe("rasterising shapes", () => {
  it("fills a rectangle exactly when it sits on pixel edges", () => {
    const r = fillRect(size, { x: 5, y: 5, width: 10, height: 4 });
    expect(count(r, 0)).toBe(40);
    expect(at(r, 5, 5)).toBe(255);
    expect(at(r, 4, 5)).toBe(0);
  });

  it("anti-aliases fractional edges", () => {
    const r = fillRect(size, { x: 5.5, y: 5, width: 10, height: 4 });
    expect(at(r, 5, 6)).toBeGreaterThan(100);
    expect(at(r, 5, 6)).toBeLessThan(160);
    expect(at(r, 6, 6)).toBe(255);
  });

  it("fills an ellipse with about the right area", () => {
    const e = fillEllipse({ width: 200, height: 200, pxPerMm: 1 }, { x: 20, y: 20, width: 160, height: 100 });
    const area = e.data.reduce((n, v) => n + v / 255, 0);
    expect(area).toBeGreaterThan(Math.PI * 80 * 50 * 0.98);
    expect(area).toBeLessThan(Math.PI * 80 * 50 * 1.02);
    expect(ellipsePoints({ x: 0, y: 0, width: 4, height: 4 }).length).toBeGreaterThanOrEqual(32);
  });

  it("uses the even-odd rule so a self-crossing lasso leaves its overlap out", () => {
    // Two overlapping squares traced as one path.
    const path = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 10, y: 20 },
      { x: 10, y: 10 },
      { x: 30, y: 10 },
      { x: 30, y: 30 },
      { x: 0, y: 30 },
    ];
    const sel = fillPolygon({ width: 40, height: 40, pxPerMm: 1 }, path, false);
    expect(at(sel, 5, 5)).toBe(255);
    expect(at(sel, 15, 15)).toBe(0);
  });

  it("covers a brush stroke", () => {
    const s = strokeMask(size, [{ x: 5, y: 15 }, { x: 35, y: 15 }], 3);
    expect(at(s, 20, 15)).toBe(255);
    expect(at(s, 20, 20)).toBe(0);
  });

  it("constrains marquees to squares and grows them from the centre", () => {
    expect(marqueeRect({ x: 10, y: 10 }, { x: 14, y: 20 }, { square: true })).toEqual({ x: 10, y: 10, width: 10, height: 10 });
    expect(marqueeRect({ x: 10, y: 10 }, { x: 14, y: 12 }, { fromCenter: true })).toEqual({ x: 6, y: 8, width: 8, height: 4 });
    expect(marqueeRect({ x: 10, y: 10 }, { x: 4, y: 2 })).toEqual({ x: 4, y: 2, width: 6, height: 8 });
  });
});

describe("modify", () => {
  const big = { width: 60, height: 60, pxPerMm: 1 };
  const square = fillRect(big, { x: 20, y: 20, width: 20, height: 20 }, false);

  it("expands with round corners and contracts back inside", () => {
    const grown = expandSelection(square, 5);
    expect(at(grown, 17, 30)).toBe(255);
    expect(at(grown, 14, 30)).toBe(0);
    // A corner rounds off: the diagonal point 5px out on both axes is beyond radius.
    expect(at(grown, 15, 15)).toBe(0);
    const shrunk = contractSelection(square, 5);
    expect(at(shrunk, 30, 30)).toBe(255);
    expect(at(shrunk, 22, 30)).toBe(0);
    expect(count(shrunk)).toBeLessThan(count(square));
  });

  it("feathers into a soft edge without moving the midpoint much", () => {
    const soft = featherSelection(square, 6);
    expect(at(soft, 30, 30)).toBeGreaterThan(240);
    expect(at(soft, 20, 30)).toBeGreaterThan(90);
    expect(at(soft, 20, 30)).toBeLessThan(170);
    expect(at(soft, 5, 5)).toBe(0);
  });

  it("smooths away specks while keeping solid areas", () => {
    const speckled = combine(square, fillRect(big, { x: 50, y: 50, width: 1, height: 1 }, false), "add");
    const smooth = smoothSelection(speckled, 3);
    expect(at(smooth, 50, 50)).toBe(0);
    expect(at(smooth, 30, 30)).toBe(255);
  });

  it("makes a border band across the edge", () => {
    const band = borderSelection(square, 6);
    expect(at(band, 20, 30)).toBeGreaterThan(150);
    expect(at(band, 30, 30)).toBe(0);
    expect(at(band, 5, 5)).toBe(0);
  });

  it("marks only pixels near the edge as the refinement band", () => {
    const band = edgeBand(square, 3);
    expect(band[30 * 60 + 20]).toBe(1);
    expect(band[30 * 60 + 18]).toBe(1);
    expect(band[30 * 60 + 30]).toBe(0);
    expect(band[5 * 60 + 5]).toBe(0);
  });
});

describe("magic wand and quick selection", () => {
  const img = halves();

  it("selects the contiguous colour region under the click", () => {
    const mask = magicWand(img, 5, 5, { tolerance: 32, contiguous: true, antiAlias: false });
    expect(mask[5 * 40 + 5]).toBe(255);
    expect(mask[5 * 40 + 19]).toBe(255);
    expect(mask[5 * 40 + 20]).toBe(0);
  });

  it("selects matching colour everywhere when not contiguous", () => {
    const stripes = halves();
    // A red patch on the blue side, unconnected to the left half.
    for (let y = 10; y < 15; y += 1) {
      for (let x = 30; x < 35; x += 1) {
        const i = (y * 40 + x) * 4;
        stripes.data[i] = 220;
        stripes.data[i + 2] = 10;
      }
    }
    const linked = magicWand(stripes, 5, 5, { tolerance: 10, contiguous: true, antiAlias: false });
    const global = magicWand(stripes, 5, 5, { tolerance: 10, contiguous: false, antiAlias: false });
    expect(linked[12 * 40 + 32]).toBe(0);
    expect(global[12 * 40 + 32]).toBe(255);
  });

  it("grows a quick selection to the colour edge and no further", () => {
    const mask = quickSelect(img, [{ x: 6, y: 15 }, { x: 8, y: 15 }], { radius: 3, tolerance: 30, reach: 10 });
    expect(mask[15 * 40 + 2]).toBe(255);
    expect(mask[2 * 40 + 15]).toBe(255);
    expect(mask[15 * 40 + 30]).toBe(0);
  });
});

describe("outline and refinement", () => {
  it("traces the outline as one closed loop per island and hole", () => {
    expect(outlinePath(emptySelection(size))).toBe("");
    // A rectangle is a single loop with just its four corners.
    expect(outlinePath(fillRect(size, { x: 2, y: 3, width: 4, height: 5 }, false))).toBe("M2 3L6 3L6 8L2 8Z");
    // Two islands, and a ring (an island with a hole): one subpath each.
    const two = combine(fillRect(size, { x: 1, y: 1, width: 3, height: 3 }, false), fillRect(size, { x: 10, y: 1, width: 3, height: 3 }, false), "add");
    expect(outlinePath(two).match(/M/g)).toHaveLength(2);
    const ring = combine(fillRect(size, { x: 5, y: 5, width: 10, height: 10 }, false), fillRect(size, { x: 8, y: 8, width: 4, height: 4 }, false), "subtract");
    expect(outlinePath(ring).match(/Z/g)).toHaveLength(2);
    // A diagonal edge stays one continuous subpath (so the dashes march evenly).
    const tri = fillPolygon({ width: 40, height: 40, pxPerMm: 1 }, [{ x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 }], false);
    expect(outlinePath(tri).match(/M/g)).toHaveLength(1);
  });

  it("guided filter keeps a flat input flat", () => {
    const n = 16 * 16;
    const guide = Float32Array.from({ length: n }, (_, i) => (i % 16) / 16);
    const flat = new Float32Array(n).fill(0.4);
    const out = guidedFilter(guide, flat, 16, 16, 2, 1e-3);
    for (const v of out) expect(v).toBeCloseTo(0.4, 3);
  });

  it("snaps a rough selection to the image edge", () => {
    const img = halves();
    // A sloppy selection reaching 4px past the red/blue boundary.
    const rough = fillRect(size, { x: 0, y: 0, width: 24, height: 30 }, false);
    const refined = refineSelection(rough, img, { ...DEFAULT_REFINE, radius: 6 });
    expect(at(refined, 22, 15)).toBeLessThan(at(rough, 22, 15));
    expect(at(refined, 5, 15)).toBe(255);
  });

  it("contrast hardens soft edges", () => {
    const soft = featherSelection(fillRect(size, { x: 10, y: 0, width: 20, height: 30 }, false), 6);
    const hard = applyContrast(soft, 100);
    expect(at(hard, 10, 15)).not.toBe(at(soft, 10, 15));
    expect(at(hard, 20, 15)).toBe(255);
  });
});

describe("buffers and PNGs", () => {
  it("crops, pastes and resizes greyscale buffers", () => {
    const sel = fillRect(size, { x: 10, y: 10, width: 5, height: 5 }, false);
    const patch = cropGray(sel.data, sel.width, { x0: 8, y0: 8, x1: 18, y1: 18 });
    expect(patch.length).toBe(100);
    const back = pasteGray(size, patch, 10, 10, 8, 8);
    expect(Array.from(back.data)).toEqual(Array.from(sel.data));
    const up = resizeGray(new Uint8ClampedArray([0, 255]), 2, 1, 4, 1);
    expect(up[0]).toBe(0);
    expect(up[3]).toBe(255);
    expect(sampleGray(new Uint8ClampedArray([0, 255]), 2, 1, 0.5, 0)).toBeCloseTo(127.5);
  });

  it("writes a valid PNG without a canvas", () => {
    const url = encodePngFallback(new Uint8ClampedArray([0, 128, 255, 64]), 2, 2, 1);
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    const bytes = Uint8Array.from(atob(url.split(",")[1]), (c) => c.charCodeAt(0));
    expect(Array.from(bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(encodeGrayPng(new Uint8ClampedArray(4), 2, 2).startsWith("data:image/png")).toBe(true);
  });
});
