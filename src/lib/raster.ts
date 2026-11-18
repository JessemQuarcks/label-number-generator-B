import type { RasterElement } from "../types";

/** Pixel layers are created at print resolution. */
export const RASTER_DPI = 300;
/** Upper bound per side, to keep saved designs within storage limits. */
export const RASTER_MAX_PX = 4000;

/** Pixel size for a pixel layer covering `widthMm` × `heightMm`. */
export const rasterPixelSize = (widthMm: number, heightMm: number) => {
  const raw = { w: (widthMm / 25.4) * RASTER_DPI, h: (heightMm / 25.4) * RASTER_DPI };
  const shrink = Math.min(1, RASTER_MAX_PX / Math.max(raw.w, raw.h));
  return {
    pxWidth: Math.max(1, Math.round(raw.w * shrink)),
    pxHeight: Math.max(1, Math.round(raw.h * shrink)),
  };
};

/** Layer pixels per label millimetre (horizontal, vertical). */
export const pxPerMm = (el: Pick<RasterElement, "pxWidth" | "pxHeight" | "width" | "height">) => ({
  x: el.pxWidth / el.width,
  y: el.pxHeight / el.height,
});

interface Decoded {
  image: HTMLImageElement;
  /** Alpha channel, or null where canvas readback is unavailable. */
  alpha: Uint8ClampedArray | null;
  width: number;
  height: number;
}

const decoded = new Map<string, Decoded>();
const pending = new Map<string, Promise<Decoded | null>>();

/** Decode a pixel layer's PNG once; later calls reuse it. */
export const decodeRaster = (src: string): Promise<Decoded | null> => {
  if (!src) return Promise.resolve(null);
  const hit = decoded.get(src);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(src);
  if (inflight) return inflight;
  const promise = new Promise<Decoded | null>((resolve) => {
    if (typeof Image === "undefined") return resolve(null);
    const image = new Image();
    image.onload = () => {
      let alpha: Uint8ClampedArray | null = null;
      try {
        const c = document.createElement("canvas");
        c.width = image.naturalWidth;
        c.height = image.naturalHeight;
        const ctx = c.getContext("2d");
        if (ctx) {
          ctx.drawImage(image, 0, 0);
          const data = ctx.getImageData(0, 0, c.width, c.height).data;
          alpha = new Uint8ClampedArray(c.width * c.height);
          for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * 4 + 3];
        }
      } catch {
        alpha = null;
      }
      const entry = { image, alpha, width: image.naturalWidth, height: image.naturalHeight };
      // Keep the cache small: strokes create a new src every time.
      if (decoded.size > 24) decoded.delete(decoded.keys().next().value as string);
      decoded.set(src, entry);
      pending.delete(src);
      resolve(entry);
    };
    image.onerror = () => {
      pending.delete(src);
      resolve(null);
    };
    image.src = src;
  });
  pending.set(src, promise);
  return promise;
};

export const decodedRaster = (src: string): Decoded | null => decoded.get(src) ?? null;

/**
 * Whether a label point (mm) lands on painted pixels of the layer. Unknown
 * (not decoded yet) counts as a miss, so empty-looking layers never steal
 * clicks from the layers beneath them.
 */
export const rasterHit = (el: RasterElement, xMm: number, yMm: number, threshold = 16): boolean => {
  if (!el.src) return false;
  const d = decoded.get(el.src);
  if (!d?.alpha) return false;
  const u = (xMm - el.x) / el.width;
  const v = (yMm - el.y) / el.height;
  if (u < 0 || v < 0 || u >= 1 || v >= 1) return false;
  const px = Math.floor(u * d.width);
  const py = Math.floor(v * d.height);
  return d.alpha[py * d.width + px] > threshold;
};
