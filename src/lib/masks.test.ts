import { describe, expect, it } from "vitest";
import type { ImageElement, LabelElement, ShapeElement } from "../types";
import {
  labelToMaskUv,
  maskFrame,
  maskPixelSize,
  maskPixelsToSelection,
  maskStyle,
  maskUvToLabel,
  selectionToMaskPixels,
  solidMask,
  MASK_MAX_PX,
} from "./masks";
import { fillRect } from "./selection/shapes";
import { normalizeDesign } from "./storage";

const shape = (over: Partial<ShapeElement> = {}): ShapeElement => ({
  id: "s",
  type: "shape",
  name: "Box",
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  rotation: 0,
  visible: true,
  fill: "#000",
  border: { style: "none", width: 0, color: "#000", radius: 0 },
  ...over,
});

const image = (over: Partial<ImageElement> = {}): ImageElement => ({
  id: "i",
  type: "image",
  name: "Photo",
  x: 10,
  y: 10,
  width: 20,
  height: 10,
  rotation: 0,
  visible: true,
  src: "/photo.png",
  fit: "fill",
  ...over,
});

describe("mask geometry", () => {
  it("lays an image's mask over its full uncropped frame", () => {
    const cropped = image({ crop: { left: 0.5, top: 0, right: 0, bottom: 0 } });
    expect(maskFrame(cropped)).toEqual({ x: -10, y: 10, width: 40, height: 10 });
    expect(maskFrame(shape())).toEqual({ x: 10, y: 10, width: 20, height: 10 });
  });

  it("caps mask resolution", () => {
    const { pxWidth, pxHeight } = maskPixelSize({ x: 0, y: 0, width: 1000, height: 10 });
    expect(pxWidth).toBe(MASK_MAX_PX);
    expect(pxHeight).toBeGreaterThan(0);
  });

  it("maps label points to mask UV and back through rotation and flips", () => {
    const els: LabelElement[] = [shape(), shape({ rotation: 30 }), image({ flipX: true, rotation: -45 }), image({ flipY: true })];
    for (const el of els) {
      const frame = maskFrame(el);
      for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]]) {
        const p = maskUvToLabel(el, frame, u, v);
        const back = labelToMaskUv(el, frame, p.x, p.y);
        expect(back.u).toBeCloseTo(u, 6);
        expect(back.v).toBeCloseTo(v, 6);
      }
    }
  });

  it("mirrors the mask with a flipped picture", () => {
    const el = image({ flipX: true });
    const frame = maskFrame(el);
    // The left edge of the box shows the right edge of the mask.
    expect(labelToMaskUv(el, frame, 10, 15).u).toBeCloseTo(1);
  });

  it("turns a selection into a layer mask and back", () => {
    const size = { width: 50, height: 30, pxPerMm: 1 };
    // Select the left half of the shape (x 10–20mm).
    const sel = fillRect(size, { x: 10, y: 10, width: 10, height: 10 }, false);
    const el = shape();
    const mask = selectionToMaskPixels(sel, el);
    const at = (u: number, v: number) =>
      mask.data[Math.floor(v * mask.pxHeight) * mask.pxWidth + Math.floor(u * mask.pxWidth)];
    expect(at(0.2, 0.5)).toBe(255);
    expect(at(0.8, 0.5)).toBe(0);

    const back = maskPixelsToSelection(mask.data, mask.pxWidth, mask.pxHeight, el, size);
    expect(back.data[15 * 50 + 12]).toBe(255);
    expect(back.data[15 * 50 + 27]).toBe(0);
    // Outside the layer is never selected.
    expect(back.data[2 * 50 + 2]).toBe(0);
  });

  it("styles an enabled mask as a luminance CSS mask, and nothing otherwise", () => {
    const mask = solidMask(shape(), 255);
    expect(mask.src.startsWith("data:image/png;base64,")).toBe(true);
    const style = maskStyle(mask);
    expect(style.maskMode).toBe("luminance");
    expect(String(style.maskImage)).toContain(mask.src);
    expect(maskStyle({ ...mask, enabled: false })).toEqual({});
    expect(maskStyle({ ...mask, src: "javascript:alert(1)" })).toEqual({});
  });
});

describe("persisting masks and generated layers", () => {
  const png = solidMask(shape(), 0).src;
  const design = (elements: unknown[]) =>
    normalizeDesign({ id: "d", name: "D", width: 50, height: 30, elements });

  it("keeps a valid mask and generative info", () => {
    const d = design([
      { ...image(), mask: { src: png, pxWidth: 8, pxHeight: 4, enabled: false }, generative: { kind: "fill", prompt: "a cat", model: "sdxl-inpaint", seed: 7 } },
    ]);
    const el = d?.elements[0] as ImageElement;
    expect(el.mask).toEqual({ src: png, pxWidth: 8, pxHeight: 4, enabled: false });
    expect(el.generative).toEqual({ kind: "fill", prompt: "a cat", model: "sdxl-inpaint", seed: 7 });
  });

  it("drops masks that are not embedded PNGs and unknown generative kinds", () => {
    const d = design([
      { ...image(), mask: { src: "https://example.com/x.png", pxWidth: 8, pxHeight: 4 }, generative: { kind: "magic" } },
      { ...shape(), mask: { src: png, pxWidth: 99999, pxHeight: -3 } },
    ]);
    expect(d?.elements[0].mask).toBeUndefined();
    expect((d?.elements[0] as ImageElement).generative).toBeUndefined();
    expect(d?.elements[1].mask?.pxWidth).toBe(MASK_MAX_PX);
    expect(d?.elements[1].mask?.pxHeight).toBe(1);
  });
});
