/**
 * Layer masks.
 *
 * A mask is a greyscale PNG laid over its layer's "mask frame": an image's
 * full, uncropped frame (so a later crop never shifts it), or the element
 * box for every other layer. Rendering uses CSS `mask-image` in luminance
 * mode, so what prints is exactly what the editor shows.
 *
 * Converting between a mask and the label-wide pixel selection has to undo
 * the layer's rotation and flips; `labelToMaskUv` and `maskUvToLabel` are
 * that mapping, in both directions.
 */
import type { CSSProperties } from "react";
import type { LabelElement, LayerMask } from "../types";
import type { Rect } from "./imageEdit";
import { fullFrame } from "./imageEdit";
import type { Selection, SelectionSize } from "./selection/mask";
import { emptySelection, sampleGray } from "./selection/mask";
import { encodeGrayPng } from "./selection/pixels";

/** Masks are stored at print resolution, capped like pixel layers but smaller. */
export const MASK_DPI = 300;
export const MASK_MAX_PX = 2048;

/** The rectangle (label mm, unrotated) a layer's mask is stretched over. */
export const maskFrame = (el: LabelElement): Rect =>
  el.type === "image" ? fullFrame(el) : { x: el.x, y: el.y, width: el.width, height: el.height };

/** Pixel size for a mask over `frame`. */
export const maskPixelSize = (frame: Rect) => {
  const ideal = MASK_DPI / 25.4;
  const scale = Math.min(ideal, MASK_MAX_PX / Math.max(frame.width, frame.height, 1e-6));
  return {
    pxWidth: Math.max(1, Math.round(frame.width * scale)),
    pxHeight: Math.max(1, Math.round(frame.height * scale)),
  };
};

const flipsOf = (el: LabelElement) =>
  el.type === "image" ? { fx: !!el.flipX, fy: !!el.flipY } : { fx: false, fy: false };

/**
 * A label point (mm) as mask UV (0–1 over the mask frame). Rotation is about
 * the element box's centre, as it is rendered.
 */
export const labelToMaskUv = (el: LabelElement, frame: Rect, x: number, y: number) => {
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  let px = x;
  let py = y;
  if (el.rotation) {
    const a = (-el.rotation * Math.PI) / 180;
    const dx = x - cx;
    const dy = y - cy;
    px = cx + dx * Math.cos(a) - dy * Math.sin(a);
    py = cy + dx * Math.sin(a) + dy * Math.cos(a);
  }
  let u = (px - frame.x) / frame.width;
  let v = (py - frame.y) / frame.height;
  const { fx, fy } = flipsOf(el);
  // The mask sits on the flipped <img>, so it is mirrored with the picture.
  if (fx) u = 1 - u;
  if (fy) v = 1 - v;
  return { u, v };
};

/** Mask UV as a label point (mm): the inverse of `labelToMaskUv`. */
export const maskUvToLabel = (el: LabelElement, frame: Rect, u: number, v: number) => {
  const { fx, fy } = flipsOf(el);
  const uu = fx ? 1 - u : u;
  const vv = fy ? 1 - v : v;
  const px = frame.x + uu * frame.width;
  const py = frame.y + vv * frame.height;
  if (!el.rotation) return { x: px, y: py };
  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const a = (el.rotation * Math.PI) / 180;
  const dx = px - cx;
  const dy = py - cy;
  return { x: cx + dx * Math.cos(a) - dy * Math.sin(a), y: cy + dx * Math.sin(a) + dy * Math.cos(a) };
};

/**
 * Mask pixels (greyscale) for `el` taken from a label-wide selection. `px`
 * overrides the output size — a pixel layer's own resolution, say.
 */
export const selectionToMaskPixels = (sel: Selection, el: LabelElement, px?: { pxWidth: number; pxHeight: number }) => {
  const frame = maskFrame(el);
  const { pxWidth, pxHeight } = px ?? maskPixelSize(frame);
  const out = new Uint8ClampedArray(pxWidth * pxHeight);
  for (let y = 0; y < pxHeight; y += 1) {
    const v = (y + 0.5) / pxHeight;
    for (let x = 0; x < pxWidth; x += 1) {
      const p = maskUvToLabel(el, frame, (x + 0.5) / pxWidth, v);
      out[y * pxWidth + x] = Math.round(
        sampleGray(sel.data, sel.width, sel.height, p.x * sel.pxPerMm - 0.5, p.y * sel.pxPerMm - 0.5)
      );
    }
  }
  return { data: out, pxWidth, pxHeight };
};

/** A label-wide selection from mask pixels (outside the mask frame = unselected). */
export const maskPixelsToSelection = (
  data: Uint8ClampedArray,
  pxWidth: number,
  pxHeight: number,
  el: LabelElement,
  size: SelectionSize
): Selection => {
  const sel = emptySelection(size);
  const frame = maskFrame(el);
  for (let y = 0; y < size.height; y += 1) {
    const my = (y + 0.5) / size.pxPerMm;
    for (let x = 0; x < size.width; x += 1) {
      const { u, v } = labelToMaskUv(el, frame, (x + 0.5) / size.pxPerMm, my);
      if (u < 0 || v < 0 || u > 1 || v > 1) continue;
      sel.data[y * size.width + x] = Math.round(sampleGray(data, pxWidth, pxHeight, u * pxWidth - 0.5, v * pxHeight - 0.5));
    }
  }
  return sel;
};

/** A uniform mask: 255 reveals everything ("Reveal all"), 0 hides it ("Hide all"). */
export const solidMask = (el: LabelElement, value: number): LayerMask => {
  const { pxWidth, pxHeight } = maskPixelSize(maskFrame(el));
  // Uniform masks compress to almost nothing; keep them small regardless.
  const w = Math.min(pxWidth, 64);
  const h = Math.min(pxHeight, 64);
  return { src: encodeGrayPng(new Uint8ClampedArray(w * h).fill(value), w, h), pxWidth: w, pxHeight: h, enabled: true };
};

export const maskFromPixels = (data: Uint8ClampedArray, pxWidth: number, pxHeight: number): LayerMask => ({
  src: encodeGrayPng(data, pxWidth, pxHeight),
  pxWidth,
  pxHeight,
  enabled: true,
});

export const invertPixels = (data: Uint8ClampedArray): Uint8ClampedArray => Uint8ClampedArray.from(data, (v) => 255 - v);

/** A mask's pixels multiplied by a selection's (both over the same layer). */
export const intersectPixels = (a: Uint8ClampedArray, b: Uint8ClampedArray): Uint8ClampedArray =>
  Uint8ClampedArray.from(a, (v, i) => Math.round((v * b[i]) / 255));

/** Only embedded PNGs are valid mask sources. */
export const isMaskSrc = (src: unknown): src is string =>
  typeof src === "string" && /^data:image\/png;base64,[A-Za-z0-9+/=\s]+$/.test(src);

/** The CSS that applies a mask to the element it is set on. */
export const maskStyle = (mask: LayerMask | undefined): CSSProperties => {
  if (!mask || !mask.enabled || !isMaskSrc(mask.src)) return {};
  const image = `url("${mask.src}")`;
  return {
    maskImage: image,
    WebkitMaskImage: image,
    maskMode: "luminance",
    // Older WebKit spells luminance masks this way.
    ...({ WebkitMaskSourceType: "luminance" } as CSSProperties),
    maskSize: "100% 100%",
    WebkitMaskSize: "100% 100%",
    maskRepeat: "no-repeat",
    WebkitMaskRepeat: "no-repeat",
    maskPosition: "0 0",
    WebkitMaskPosition: "0 0",
  };
};

/** Whether `el` currently shows through a mask. */
export const hasActiveMask = (el: LabelElement) => !!el.mask && el.mask.enabled && isMaskSrc(el.mask.src);

/** A colour as the grey a mask stores for it (its luminance): how much it reveals. */
export const toGrey = (hex: string): string => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1], 16) : 0;
  const lum = Math.round(0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
  const h = lum.toString(16).padStart(2, "0");
  return `#${h}${h}${h}`;
};
