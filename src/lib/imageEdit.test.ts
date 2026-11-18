import { describe, expect, it } from "vitest";
import type { ImageElement } from "../types";
import {
  applyCrop,
  centredCropForRatio,
  clearCrop,
  cropFromRect,
  cropRect,
  fullFrame,
  imageContentStyle,
  NO_CROP,
} from "./imageEdit";

const image = (overrides: Partial<ImageElement> = {}): ImageElement => ({
  id: "img",
  type: "image",
  name: "Photo",
  x: 10,
  y: 20,
  width: 100,
  height: 50,
  rotation: 0,
  visible: true,
  src: "photo.png",
  fit: "fill",
  ...overrides,
});

describe("crop geometry", () => {
  it("an uncropped image's full frame is its own box", () => {
    expect(fullFrame(image())).toEqual({ x: 10, y: 20, width: 100, height: 50 });
  });

  it("applying a crop shrinks the box to the kept region", () => {
    const patch = applyCrop(image(), { left: 0.1, top: 0.2, right: 0.3, bottom: 0 });
    expect(patch).toEqual({
      x: 20,
      y: 30,
      width: 60,
      height: 40,
      crop: { left: 0.1, top: 0.2, right: 0.3, bottom: 0 },
    });
  });

  it("recovers the same full frame from a cropped element", () => {
    const cropped = { ...image(), ...applyCrop(image(), { left: 0.1, top: 0.2, right: 0.3, bottom: 0 }) };
    const frame = fullFrame(cropped);
    expect(frame.x).toBeCloseTo(10);
    expect(frame.y).toBeCloseTo(20);
    expect(frame.width).toBeCloseTo(100);
    expect(frame.height).toBeCloseTo(50);
  });

  it("clearing a crop grows the box back to the full frame", () => {
    const cropped = { ...image(), ...applyCrop(image(), { left: 0.25, top: 0, right: 0.25, bottom: 0.5 }) };
    const restored = clearCrop(cropped);
    expect(restored.x).toBeCloseTo(10);
    expect(restored.width).toBeCloseTo(100);
    expect(restored.height).toBeCloseTo(50);
    expect(restored.crop).toBeUndefined();
  });

  it("round-trips a rectangle through crop insets", () => {
    const frame = { x: 0, y: 0, width: 200, height: 100 };
    const rect = { x: 50, y: 10, width: 100, height: 60 };
    const back = cropRect(frame, cropFromRect(frame, rect));
    for (const key of ["x", "y", "width", "height"] as const) {
      expect(back[key]).toBeCloseTo(rect[key], 6);
    }
  });

  it("clamps a rectangle that strays outside the frame", () => {
    const crop = cropFromRect({ x: 0, y: 0, width: 100, height: 100 }, { x: -20, y: -5, width: 150, height: 50 });
    expect(crop.left).toBe(0);
    expect(crop.top).toBe(0);
    expect(crop.right).toBe(0);
  });

  it("fits the largest centred crop for an aspect ratio", () => {
    const frame = { x: 0, y: 0, width: 200, height: 100 };
    const square = cropRect(frame, centredCropForRatio(frame, 1));
    expect(square.width).toBeCloseTo(100);
    expect(square.height).toBeCloseTo(100);
    expect(square.x).toBeCloseTo(50);
    const wide = cropRect(frame, centredCropForRatio(frame, 4));
    expect(wide.width).toBeCloseTo(200);
    expect(wide.height).toBeCloseTo(50);
  });

  it("lays the image over the full frame so the box shows only the crop", () => {
    const style = imageContentStyle(image({ crop: { left: 0.25, top: 0, right: 0.25, bottom: 0.5 } }));
    expect(style.width).toBe("200%");
    expect(style.height).toBe("200%");
    expect(style.left).toBe("-50%");
    expect(style.top).toBe("0%");
  });

  it("leaves an uncropped image filling its box", () => {
    const style = imageContentStyle(image());
    expect(style).toMatchObject({ width: "100%", height: "100%", objectFit: "fill" });
    expect(NO_CROP).toEqual({ left: 0, top: 0, right: 0, bottom: 0 });
  });
});

describe("flips", () => {
  it("flips the image itself, inside the crop frame", () => {
    const style = imageContentStyle(image({ flipX: true, flipY: true }));
    expect(style.transform).toBe("scaleX(-1) scaleY(-1)");
  });
});
