/**
 * Moving pixels between buffers, canvases and data URLs.
 *
 * Masks are stored as opaque greyscale PNGs. Where a 2D canvas exists the
 * browser encodes them (compressed); where it does not (tests, very old
 * engines) a tiny built-in encoder writes a valid, uncompressed PNG so the
 * data still round-trips.
 */
import type { Rgba } from "./wand";

/* ---------- a minimal PNG encoder (stored deflate) ---------- */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

const crc32 = (bytes: Uint8Array, start: number, end: number) => {
  let c = 0xffffffff;
  for (let i = start; i < end; i += 1) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const adler32 = (bytes: Uint8Array) => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
};

/** Encode raw scanlines (`channels` = 1 grey or 4 RGBA) as a PNG data URL, uncompressed. */
export const encodePngFallback = (pixels: Uint8ClampedArray, width: number, height: number, channels: 1 | 4): string => {
  const rowLen = width * channels + 1;
  const raw = new Uint8Array(rowLen * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * rowLen] = 0; // filter: none
    raw.set(pixels.subarray(y * width * channels, (y + 1) * width * channels), y * rowLen + 1);
  }
  // zlib stream of stored blocks.
  const blocks = Math.max(1, Math.ceil(raw.length / 65535));
  const zlib = new Uint8Array(2 + raw.length + blocks * 5 + 4);
  let o = 0;
  zlib[o++] = 0x78;
  zlib[o++] = 0x01;
  for (let b = 0; b < blocks; b += 1) {
    const start = b * 65535;
    const len = Math.min(65535, raw.length - start);
    zlib[o++] = b === blocks - 1 ? 1 : 0;
    zlib[o++] = len & 0xff;
    zlib[o++] = len >>> 8;
    zlib[o++] = ~len & 0xff;
    zlib[o++] = (~len >>> 8) & 0xff;
    zlib.set(raw.subarray(start, start + len), o);
    o += len;
  }
  const ad = adler32(raw);
  zlib[o++] = ad >>> 24;
  zlib[o++] = (ad >>> 16) & 0xff;
  zlib[o++] = (ad >>> 8) & 0xff;
  zlib[o++] = ad & 0xff;

  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length);
    for (let i = 0; i < 4; i += 1) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = channels === 1 ? 0 : 6; // grey / RGBA
  const parts = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.subarray(0, o)),
    chunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const png = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    png.set(p, at);
    at += p.length;
  }
  return `data:image/png;base64,${toBase64(png)}`;
};

/* ---------- canvas helpers ---------- */

export const makeCanvas = (width: number, height: number): HTMLCanvasElement => {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
};

/** A 2D context, or null where the environment has none (jsdom). */
export const context2d = (canvas: HTMLCanvasElement): CanvasRenderingContext2D | null => {
  try {
    return canvas.getContext("2d", { willReadFrequently: true });
  } catch {
    return null;
  }
};

const canvasDataUrl = (canvas: HTMLCanvasElement, type: string, quality?: number): string | null => {
  try {
    const out: unknown = canvas.toDataURL(type, quality);
    return typeof out === "string" && out.startsWith("data:image/") ? out : null;
  } catch {
    return null;
  }
};

/** A greyscale buffer as an opaque greyscale PNG (white = 255). */
export const encodeGrayPng = (gray: Uint8ClampedArray, width: number, height: number): string => {
  if (typeof document !== "undefined") {
    const canvas = makeCanvas(width, height);
    const ctx = context2d(canvas);
    if (ctx) {
      const img = ctx.createImageData(width, height);
      for (let i = 0; i < gray.length; i += 1) {
        img.data[i * 4] = gray[i];
        img.data[i * 4 + 1] = gray[i];
        img.data[i * 4 + 2] = gray[i];
        img.data[i * 4 + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      const url = canvasDataUrl(canvas, "image/png");
      if (url?.startsWith("data:image/png")) return url;
    }
  }
  return encodePngFallback(gray, width, height, 1);
};

/** RGBA pixels as a PNG data URL. */
export const encodeRgbaPng = (img: Rgba): string => {
  if (typeof document !== "undefined") {
    const canvas = makeCanvas(img.width, img.height);
    const ctx = context2d(canvas);
    if (ctx) {
      const data = ctx.createImageData(img.width, img.height);
      data.data.set(img.data);
      ctx.putImageData(data, 0, 0);
      const url = canvasDataUrl(canvas, "image/png");
      if (url?.startsWith("data:image/png")) return url;
    }
  }
  return encodePngFallback(img.data, img.width, img.height, 4);
};

/**
 * A compact encoding for generated pictures, which are photographic and can
 * be large: WebP where the browser can write it, else PNG. Transparency is
 * kept (WebP supports alpha).
 */
export const encodePhoto = (canvas: HTMLCanvasElement): string => {
  const webp = canvasDataUrl(canvas, "image/webp", 0.92);
  if (webp?.startsWith("data:image/webp")) return webp;
  return canvasDataUrl(canvas, "image/png") ?? "";
};

/** Load any image URL. Resolves null if it cannot be decoded here. */
export const loadImage = (src: string): Promise<HTMLImageElement | null> =>
  new Promise((resolve) => {
    if (!src || typeof Image === "undefined") return resolve(null);
    const img = new Image();
    let settled = false;
    const done = (value: HTMLImageElement | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    img.onload = () => done(img);
    img.onerror = () => done(null);
    // Remote images need CORS for their pixels to be readable.
    if (/^https?:/i.test(src)) img.crossOrigin = "anonymous";
    img.src = src;
    // jsdom never fires load for data URLs; don't hang forever.
    window.setTimeout(() => done(img.complete && img.naturalWidth > 0 ? img : null), 15000);
  });

/** Decode an image to RGBA at its natural size (or at `width`×`height`). */
export const decodeToRgba = async (src: string, width?: number, height?: number): Promise<Rgba | null> => {
  const img = await loadImage(src);
  if (!img) return null;
  const w = width ?? img.naturalWidth;
  const h = height ?? img.naturalHeight;
  if (!w || !h) return null;
  const canvas = makeCanvas(w, h);
  const ctx = context2d(canvas);
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, w, h);
  try {
    const data = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: data.data };
  } catch {
    return null; // tainted by a cross-origin image
  }
};

/** A greyscale image (a mask) decoded to one channel, resized to `width`×`height`. */
export const decodeToGray = async (src: string, width: number, height: number): Promise<Uint8ClampedArray | null> => {
  const rgba = await decodeToRgba(src, width, height);
  if (!rgba) return null;
  const out = new Uint8ClampedArray(width * height);
  const d = rgba.data;
  // Opaque greys carry the value in colour; an alpha-only mask carries it in alpha.
  let alphaVaries = false;
  for (let i = 0; i < out.length; i += 1) {
    if (d[i * 4 + 3] !== 255) {
      alphaVaries = true;
      break;
    }
  }
  for (let i = 0; i < out.length; i += 1) {
    const lum = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    out[i] = alphaVaries ? Math.round((lum * d[i * 4 + 3]) / 255) : lum;
  }
  return out;
};

/** Pixels → canvas. */
export const rgbaToCanvas = (img: Rgba): HTMLCanvasElement | null => {
  const canvas = makeCanvas(img.width, img.height);
  const ctx = context2d(canvas);
  if (!ctx) return null;
  const data = ctx.createImageData(img.width, img.height);
  data.data.set(img.data);
  ctx.putImageData(data, 0, 0);
  return canvas;
};

/** Multiply an image's alpha by a mask of the same size. */
export const applyAlphaMask = (img: Rgba, mask: Uint8ClampedArray): Rgba => {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < mask.length; i += 1) out[i * 4 + 3] = Math.round((out[i * 4 + 3] * mask[i]) / 255);
  return { width: img.width, height: img.height, data: out };
};

/** Copy a box out of an RGBA buffer. */
export const cropRgba = (img: Rgba, x0: number, y0: number, x1: number, y1: number): Rgba => {
  const w = Math.max(0, x1 - x0);
  const h = Math.max(0, y1 - y0);
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const src = ((y0 + y) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
};
