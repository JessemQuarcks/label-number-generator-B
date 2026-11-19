/**
 * Operations that combine the pixel selection with layers: masks from
 * selections, deleting selected pixels, copying them to a new layer. Each
 * returns the patch (or new layer) to apply, so they stay undoable through
 * the normal design history.
 */
import type { ImageElement, LabelDesign, LabelElement, LayerMask, RasterElement } from "../types";
import type { Rect } from "./imageEdit";
import type { Selection } from "./selection/mask";
import { boundsToMm, invertSelection, selectionBounds } from "./selection/mask";
import {
  intersectPixels,
  invertPixels,
  labelToMaskUv,
  maskFrame,
  maskFromPixels,
  maskPixelSize,
  selectionToMaskPixels,
  solidMask,
} from "./masks";
import { applyAlphaMask, decodeToGray, decodeToRgba, encodePhoto, encodeRgbaPng, loadImage, makeCanvas, context2d, rgbaToCanvas } from "./selection/pixels";
import { composeRgba } from "./selection/compose";

export type AddMaskKind = "reveal-all" | "hide-all" | "reveal-selection" | "hide-selection";

/** Decode a layer's mask, or null. */
export const maskPixels = async (el: LabelElement): Promise<Uint8ClampedArray | null> =>
  el.mask ? decodeToGray(el.mask.src, el.mask.pxWidth, el.mask.pxHeight) : null;

/**
 * Layer ▸ Layer Mask ▸ Reveal all / Hide all / Reveal selection / Hide
 * selection. Replaces any mask the layer had.
 */
export const buildMask = async (el: LabelElement, kind: AddMaskKind, sel: Selection | null): Promise<LayerMask | null> => {
  if (kind === "reveal-all") return solidMask(el, 255);
  if (kind === "hide-all") return solidMask(el, 0);
  if (!sel) return null;
  const source = kind === "hide-selection" ? invertSelection(sel) : sel;
  const fresh = selectionToMaskPixels(source, el);
  return maskFromPixels(fresh.data, fresh.pxWidth, fresh.pxHeight);
};

/** Hide the selected area of a layer, keeping anything its mask already hides. */
export const hideSelectionInMask = async (el: LabelElement, sel: Selection): Promise<LayerMask> => {
  const hide = selectionToMaskPixels(invertSelection(sel), el);
  if (el.mask) {
    const old = await decodeToGray(el.mask.src, hide.pxWidth, hide.pxHeight);
    if (old) return maskFromPixels(intersectPixels(old, hide.data), hide.pxWidth, hide.pxHeight);
  }
  return maskFromPixels(hide.data, hide.pxWidth, hide.pxHeight);
};

export const invertMask = async (el: LabelElement): Promise<LayerMask | null> => {
  if (!el.mask) return null;
  const px = await maskPixels(el);
  if (!px) return null;
  return { ...maskFromPixels(invertPixels(px), el.mask.pxWidth, el.mask.pxHeight), enabled: el.mask.enabled };
};

/** Layer ▸ Layer Mask ▸ Apply: bake a pixel layer's mask into its pixels. */
export const applyMaskToRaster = async (el: RasterElement): Promise<string | null> => {
  if (!el.mask || !el.src) return null;
  const rgba = await decodeToRgba(el.src, el.pxWidth, el.pxHeight);
  const mask = await decodeToGray(el.mask.src, el.pxWidth, el.pxHeight);
  if (!rgba || !mask) return null;
  return encodeRgbaPng(applyAlphaMask(rgba, mask));
};

/** Delete on a pixel layer: clear the selected pixels. */
export const clearRasterPixels = async (el: RasterElement, sel: Selection): Promise<string | null> => {
  if (!el.src) return null;
  const rgba = await decodeToRgba(el.src, el.pxWidth, el.pxHeight);
  if (!rgba) return null;
  const keep = selectionToMaskPixels(invertSelection(sel), el, { pxWidth: el.pxWidth, pxHeight: el.pxHeight });
  return encodeRgbaPng(applyAlphaMask(rgba, keep.data));
};

/** A picture for storage: WebP where possible, else PNG. */
export const compactImage = async (src: string): Promise<string> => {
  const img = await loadImage(src);
  if (!img || !img.naturalWidth) return src;
  const canvas = makeCanvas(img.naturalWidth, img.naturalHeight);
  const ctx = context2d(canvas);
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0);
  return encodePhoto(canvas) || src;
};

/**
 * Layer ▸ New ▸ Layer via copy (Ctrl+J): the selected pixels — of the
 * selected layer, or of everything visible — on a new image layer that keeps
 * the selection as its mask.
 */
export const layerViaCopy = async (
  design: LabelDesign,
  sel: Selection,
  source: LabelElement | null,
  number: number
): Promise<Partial<ImageElement> | null> => {
  const b = selectionBounds(sel, 4);
  if (!b) return null;
  const rect = boundsToMm(sel, b);
  const ownPixels = source && (source.type === "image" || source.type === "raster");
  const rgba = await composeRgba(design, {
    rect,
    pxPerMm: sel.pxPerMm,
    include: ownPixels ? (e) => e.id === source.id : undefined,
    background: !ownPixels,
    number,
  });
  if (!rgba) return null;
  const canvas = rgbaToCanvas(rgba);
  if (!canvas) return null;
  const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  const stub = { ...box, type: "image", rotation: 0 } as LabelElement;
  const m = selectionToMaskPixels(sel, stub);
  return {
    name: ownPixels ? `${source.name} copy` : "Layer via copy",
    src: encodePhoto(canvas),
    fit: "fill",
    ...box,
    mask: maskFromPixels(m.data, m.pxWidth, m.pxHeight),
  };
};

/**
 * Re-lay a mask over a layer's new frame (after Generative expand grew it):
 * the old mask keeps its place, the new area is revealed.
 */
export const remapMask = async (before: LabelElement, after: LabelElement): Promise<LayerMask | undefined> => {
  if (!before.mask) return undefined;
  const old = await maskPixels(before);
  if (!old) return undefined;
  const frame = maskFrame(after);
  const oldFrame = maskFrame(before);
  const { pxWidth, pxHeight } = maskPixelSize(frame);
  const out = new Uint8ClampedArray(pxWidth * pxHeight);
  const ow = before.mask.pxWidth;
  const oh = before.mask.pxHeight;
  for (let y = 0; y < pxHeight; y += 1) {
    for (let x = 0; x < pxWidth; x += 1) {
      const mx = frame.x + ((x + 0.5) / pxWidth) * frame.width;
      const my = frame.y + ((y + 0.5) / pxHeight) * frame.height;
      const { u, v } = labelToMaskUv(before, oldFrame, mx, my);
      out[y * pxWidth + x] =
        u < 0 || v < 0 || u >= 1 || v >= 1 ? 255 : old[Math.min(oh - 1, Math.floor(v * oh)) * ow + Math.min(ow - 1, Math.floor(u * ow))];
    }
  }
  return { ...maskFromPixels(out, pxWidth, pxHeight), enabled: before.mask.enabled };
};

/** A layer's own rendering (no mask, effects or opacity) over `rect`, for AI input. */
export const renderBareLayer = (design: LabelDesign, el: LabelElement, rect: Rect, pxPerMm: number, number: number) => {
  const bare = { ...el, opacity: undefined, mask: undefined, ...("effects" in el ? { effects: undefined } : {}) } as LabelElement;
  const d = { ...design, elements: design.elements.map((e) => (e.id === el.id ? bare : e)) };
  return composeRgba(d, { rect, pxPerMm, include: (e) => e.id === el.id, background: false, number });
};
