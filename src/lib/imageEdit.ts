import type { CSSProperties } from "react";
import type { ImageCrop, ImageElement } from "../types";

export const NO_CROP: ImageCrop = { left: 0, top: 0, right: 0, bottom: 0 };

/** The smallest share of the full frame a crop may leave visible. */
export const MIN_CROP_FRACTION = 0.01;

export const cropOf = (el: Pick<ImageElement, "crop">): ImageCrop => el.crop ?? NO_CROP;

export const isCropped = (crop: ImageCrop | undefined): boolean =>
  !!crop && (crop.left > 0 || crop.top > 0 || crop.right > 0 || crop.bottom > 0);

/**
 * Style for the <img> inside an element box. The box is the cropped region;
 * the image is laid out over the full (uncropped) frame using percentages of
 * the box, so it needs no knowledge of the image's pixel size and stays
 * correct at any element size.
 */
export const imageContentStyle = (el: ImageElement): CSSProperties => {
  const c = cropOf(el);
  const visibleW = Math.max(MIN_CROP_FRACTION, 1 - c.left - c.right);
  const visibleH = Math.max(MIN_CROP_FRACTION, 1 - c.top - c.bottom);
  const flips = [el.flipX ? "scaleX(-1)" : "", el.flipY ? "scaleY(-1)" : ""]
    .filter(Boolean)
    .join(" ");
  return {
    position: "absolute",
    left: `${(-c.left / visibleW) * 100}%`,
    top: `${(-c.top / visibleH) * 100}%`,
    width: `${(1 / visibleW) * 100}%`,
    height: `${(1 / visibleH) * 100}%`,
    maxWidth: "none",
    objectFit: el.fit,
    transform: flips || undefined,
  };
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The uncropped frame, in label mm, implied by an element box and its crop. */
export const fullFrame = (el: Rect & Pick<ImageElement, "crop">): Rect => {
  const c = cropOf(el);
  const width = el.width / Math.max(MIN_CROP_FRACTION, 1 - c.left - c.right);
  const height = el.height / Math.max(MIN_CROP_FRACTION, 1 - c.top - c.bottom);
  return { x: el.x - c.left * width, y: el.y - c.top * height, width, height };
};

/** The visible rectangle, in label mm, that `crop` leaves of `frame`. */
export const cropRect = (frame: Rect, crop: ImageCrop): Rect => ({
  x: frame.x + crop.left * frame.width,
  y: frame.y + crop.top * frame.height,
  width: frame.width * (1 - crop.left - crop.right),
  height: frame.height * (1 - crop.top - crop.bottom),
});

/** The crop insets that turn `frame` into `rect` (clamped to the frame). */
export const cropFromRect = (frame: Rect, rect: Rect): ImageCrop => {
  const clamp01 = (n: number) => Math.min(Math.max(n, 0), 1);
  const left = clamp01((rect.x - frame.x) / frame.width);
  const top = clamp01((rect.y - frame.y) / frame.height);
  const right = clamp01((frame.x + frame.width - (rect.x + rect.width)) / frame.width);
  const bottom = clamp01((frame.y + frame.height - (rect.y + rect.height)) / frame.height);
  return roundCrop({ left, top, right, bottom });
};

const roundCrop = (c: ImageCrop): ImageCrop => {
  const r = (n: number) => Math.round(n * 1e5) / 1e5;
  return { left: r(c.left), top: r(c.top), right: r(c.right), bottom: r(c.bottom) };
};

/**
 * The element patch that commits `crop`: the element box becomes the visible
 * region, and the crop is stored relative to the (unchanged) full frame.
 */
export const applyCrop = (
  el: ImageElement,
  crop: ImageCrop
): Pick<ImageElement, "x" | "y" | "width" | "height" | "crop"> => {
  const frame = fullFrame(el);
  const rect = cropRect(frame, crop);
  const r = (n: number) => Math.round(n * 1e4) / 1e4;
  return {
    x: r(rect.x),
    y: r(rect.y),
    width: r(rect.width),
    height: r(rect.height),
    crop: isCropped(crop) ? roundCrop(crop) : undefined,
  };
};

/** Undo every crop: the element grows back to its full frame. */
export const clearCrop = (el: ImageElement) => applyCrop(el, NO_CROP);

/**
 * The largest crop of `frame` with the given width:height ratio, centred.
 * Used when the user picks an aspect preset in the crop options.
 */
export const centredCropForRatio = (frame: Rect, ratio: number): ImageCrop => {
  const frameRatio = frame.width / frame.height;
  if (!(ratio > 0) || Math.abs(frameRatio - ratio) < 1e-6) return { ...NO_CROP };
  if (ratio > frameRatio) {
    // Wider than the frame: keep full width, trim top and bottom.
    const h = frame.width / ratio / frame.height;
    const inset = (1 - h) / 2;
    return roundCrop({ left: 0, right: 0, top: inset, bottom: inset });
  }
  const w = (frame.height * ratio) / frame.width;
  const inset = (1 - w) / 2;
  return roundCrop({ left: inset, right: inset, top: 0, bottom: 0 });
};

/** Aspect presets for the crop tool. "original" means the image's own frame. */
export const CROP_RATIOS: { label: string; value: string }[] = [
  { label: "Free", value: "free" },
  { label: "Original", value: "original" },
  { label: "1 : 1", value: "1" },
  { label: "4 : 3", value: String(4 / 3) },
  { label: "3 : 4", value: String(3 / 4) },
  { label: "3 : 2", value: String(3 / 2) },
  { label: "16 : 9", value: String(16 / 9) },
];
