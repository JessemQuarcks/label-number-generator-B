/**
 * Rasterise a label (or some of its layers) to pixels.
 *
 * AI models, the Magic Wand and Select and Mask all need real pixels, while
 * the label itself is HTML laid out in millimetres. This draws each layer
 * onto a canvas the way `Label` renders it — images with their crop, fit and
 * flips, pixel layers, shapes, text, rotation, opacity, effects (as canvas
 * filters) and layer masks — at any resolution, for any rectangle of the
 * label. Text is an approximation (canvas has no CSS layout), which is fine
 * for analysis but is never used for print.
 */
import type { LabelDesign, LabelElement, Typography } from "../../types";
import type { Rect } from "../imageEdit";
import { cropOf, fullFrame } from "../imageEdit";
import { effectsToCss } from "../effects";
import { isEffectivelyVisible } from "../layers";
import { formatNumber } from "../numbering";
import { isOpenShape, shapePath } from "../shapes";
import { maskFrame } from "../masks";
import { context2d, loadImage, makeCanvas } from "./pixels";
import type { Rgba } from "./wand";

const PT_PER_MM = 72 / 25.4;

export interface ComposeOptions {
  /** The label area to render, in mm. Defaults to the whole label. */
  rect?: Rect;
  /** Output resolution. */
  pxPerMm: number;
  /** Which layers to draw; defaults to every visible one. */
  include?: (el: LabelElement, index: number) => boolean;
  /** Paint the label background first (default true). */
  background?: boolean;
  /** Serial number shown by number layers. */
  number?: number;
}

/** CSS filters in mm do not exist on canvas; convert lengths to output px. */
const filterForCanvas = (css: string | undefined, pxPerMm: number) =>
  css?.replace(/(-?\d*\.?\d+)mm/g, (_, n: string) => `${Number(n) * pxPerMm}px`) ?? "none";

/** A greyscale (luminance) mask as an alpha-only canvas, for destination-in. */
const maskCanvas = async (src: string, w: number, h: number): Promise<HTMLCanvasElement | null> => {
  const img = await loadImage(src);
  if (!img) return null;
  const c = makeCanvas(w, h);
  const ctx = context2d(c);
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const data = ctx.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < data.data.length; i += 4) {
    const lum = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
    data.data[i + 3] = Math.round((lum * data.data[i + 3]) / 255);
  }
  ctx.putImageData(data, 0, 0);
  return c;
};

/** Where an image's pixels land inside its frame for a given object-fit. */
const fitBox = (fit: string, frameW: number, frameH: number, natW: number, natH: number) => {
  if (fit === "fill" || !natW || !natH) return { x: 0, y: 0, w: frameW, h: frameH };
  const s = fit === "cover" ? Math.max(frameW / natW, frameH / natH) : Math.min(frameW / natW, frameH / natH);
  const w = natW * s;
  const h = natH * s;
  return { x: (frameW - w) / 2, y: (frameH - h) / 2, w, h };
};

const fontFor = (t: Typography, pxPerMm: number) => {
  const sizePx = (t.fontSize / PT_PER_MM) * pxPerMm;
  return { font: `${t.italic ? "italic " : ""}${t.fontWeight} ${sizePx}px ${t.fontFamily}`, sizePx };
};

const transformText = (text: string, t: Typography) =>
  t.textTransform === "uppercase"
    ? text.toUpperCase()
    : t.textTransform === "lowercase"
      ? text.toLowerCase()
      : t.textTransform === "capitalize"
        ? text.replace(/\b\w/g, (c) => c.toUpperCase())
        : text;

/** Greedy word wrap — close to the browser's for plain text. */
const wrap = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (line && ctx.measureText(next).width > maxWidth && w.trim()) {
        lines.push(line.trimEnd());
        line = w.trimStart();
      } else {
        line = next;
      }
    }
    lines.push(line);
  }
  return lines;
};

/** Draw one layer, unrotated, into a canvas the size of its box (or frame). */
const drawLayer = async (
  el: LabelElement,
  pxPerMm: number,
  number: number
): Promise<{ canvas: HTMLCanvasElement; frame: Rect } | null> => {
  const box: Rect = { x: el.x, y: el.y, width: el.width, height: el.height };
  const canvas = makeCanvas(box.width * pxPerMm, box.height * pxPerMm);
  const ctx = context2d(canvas);
  if (!ctx) return null;
  const W = canvas.width;
  const H = canvas.height;
  // Content is drawn on its own canvas so the mask can be applied to the
  // content alone, before effects — the order Label renders in.
  const content = makeCanvas(W, H);
  const cctx = context2d(content);
  if (!cctx) return null;

  switch (el.type) {
    case "image": {
      if (!el.src) return null;
      const img = await loadImage(el.src);
      if (!img) return null;
      const frame = fullFrame(el);
      const c = cropOf(el);
      // The full frame relative to the visible box, in px.
      const fx = -c.left * frame.width * pxPerMm;
      const fy = -c.top * frame.height * pxPerMm;
      const fw = frame.width * pxPerMm;
      const fh = frame.height * pxPerMm;
      // Draw the picture over its full frame, flipped and masked there.
      const full = makeCanvas(fw, fh);
      const fctx = context2d(full);
      if (!fctx) return null;
      const fit = fitBox(el.fit, full.width, full.height, img.naturalWidth, img.naturalHeight);
      fctx.save();
      fctx.translate(el.flipX ? full.width : 0, el.flipY ? full.height : 0);
      fctx.scale(el.flipX ? -1 : 1, el.flipY ? -1 : 1);
      fctx.drawImage(img, fit.x, fit.y, fit.w, fit.h);
      if (el.mask?.enabled && el.mask.src) {
        const m = await maskCanvas(el.mask.src, full.width, full.height);
        if (m) {
          fctx.globalCompositeOperation = "destination-in";
          fctx.drawImage(m, 0, 0);
        }
      }
      fctx.restore();
      cctx.drawImage(full, fx, fy, fw, fh);
      break;
    }
    case "raster": {
      if (!el.src) return null;
      const img = await loadImage(el.src);
      if (!img) return null;
      cctx.drawImage(img, 0, 0, W, H);
      break;
    }
    case "shape": {
      const kind = el.shape ?? "rectangle";
      const stroked = el.border.style !== "none" && el.border.width > 0;
      const open = isOpenShape(kind);
      const strokeMm = stroked ? el.border.width : open ? 0.5 : 0;
      cctx.save();
      cctx.scale(pxPerMm, pxPerMm);
      const path =
        kind === "rectangle"
          ? (() => {
              const p = new Path2D();
              const inset = strokeMm / 2;
              const r = Math.min(el.border.radius, el.width / 2, el.height / 2);
              p.roundRect(inset, inset, Math.max(0.01, el.width - strokeMm), Math.max(0.01, el.height - strokeMm), r);
              return p;
            })()
          : new Path2D(
              shapePath(kind, el.width, el.height, {
                inset: strokeMm / 2,
                sides: el.sides,
                innerRadius: el.innerRadius,
                cornerRadius: el.border.radius,
              })
            );
      if (!open && el.fill !== "none") {
        cctx.fillStyle = el.fill;
        cctx.fill(path);
      }
      if (strokeMm > 0) {
        cctx.lineWidth = strokeMm;
        cctx.strokeStyle = stroked ? el.border.color : el.fill === "none" ? "#000000" : el.fill;
        cctx.lineJoin = "round";
        cctx.stroke(path);
      }
      cctx.restore();
      break;
    }
    case "text":
    case "number": {
      const t = el.typography;
      const raw = el.type === "text" ? el.text : formatNumber(number, el);
      const { font, sizePx } = fontFor(t, pxPerMm);
      cctx.font = font;
      cctx.fillStyle = t.color;
      cctx.textBaseline = "top";
      const lines = wrap(cctx, transformText(raw, t), W);
      const lineH = sizePx * t.lineHeight;
      const total = lines.length * lineH;
      let y = t.verticalAlign === "top" ? 0 : t.verticalAlign === "bottom" ? H - total : (H - total) / 2;
      for (const line of lines) {
        const w = cctx.measureText(line).width;
        const x = t.align === "right" ? W - w : t.align === "center" ? (W - w) / 2 : 0;
        cctx.fillText(line, x, y + (lineH - sizePx) / 2);
        y += lineH;
      }
      break;
    }
  }

  // Non-image layers carry their mask over the element box.
  if (el.type !== "image" && el.mask?.enabled && el.mask.src) {
    const m = await maskCanvas(el.mask.src, W, H);
    if (m) {
      cctx.globalCompositeOperation = "destination-in";
      cctx.drawImage(m, 0, 0);
      cctx.globalCompositeOperation = "source-over";
    }
  }

  const css = "effects" in el ? effectsToCss(el.effects) : undefined;
  ctx.filter = filterForCanvas(css, pxPerMm);
  ctx.globalAlpha = el.opacity !== undefined ? el.opacity / 100 : 1;
  ctx.drawImage(content, 0, 0);
  return { canvas, frame: maskFrame(el) };
};

/** Render to a canvas. Resolves null where there is no 2D canvas. */
export const composeCanvas = async (design: LabelDesign, opts: ComposeOptions): Promise<HTMLCanvasElement | null> => {
  const rect = opts.rect ?? { x: 0, y: 0, width: design.width, height: design.height };
  const { pxPerMm } = opts;
  const out = makeCanvas(rect.width * pxPerMm, rect.height * pxPerMm);
  const ctx = context2d(out);
  if (!ctx) return null;
  if (opts.background !== false) {
    ctx.fillStyle = design.background;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  const number = opts.number ?? 1;
  for (let i = 0; i < design.elements.length; i += 1) {
    const el = design.elements[i];
    if (!isEffectivelyVisible(el, design.groups)) continue;
    if (opts.include && !opts.include(el, i)) continue;
    const layer = await drawLayer(el, pxPerMm, number);
    if (!layer) continue;
    ctx.save();
    // Into output space, then about the element's centre for rotation.
    ctx.translate((el.x + el.width / 2 - rect.x) * pxPerMm, (el.y + el.height / 2 - rect.y) * pxPerMm);
    if (el.rotation) ctx.rotate((el.rotation * Math.PI) / 180);
    ctx.drawImage(layer.canvas, (-el.width / 2) * pxPerMm, (-el.height / 2) * pxPerMm, el.width * pxPerMm, el.height * pxPerMm);
    ctx.restore();
  }
  return out;
};

/** Render to RGBA pixels. */
export const composeRgba = async (design: LabelDesign, opts: ComposeOptions): Promise<Rgba | null> => {
  const canvas = await composeCanvas(design, opts);
  if (!canvas) return null;
  const ctx = context2d(canvas);
  if (!ctx) return null;
  try {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { width: canvas.width, height: canvas.height, data: data.data };
  } catch {
    // A remote image without CORS headers taints the canvas.
    return null;
  }
};
