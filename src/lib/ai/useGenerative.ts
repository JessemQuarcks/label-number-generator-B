import { useCallback, useRef, useState } from "react";
import type { GenerativeInfo, GenerativeKind, ImageElement, LabelDesign, LabelElement } from "../../types";
import type { Rect } from "../imageEdit";
import type { AiPrefs } from "../workspace";
import type { AiApi } from "./useAi";
import { isCancel } from "./useAi";
import type { Capability, CapabilityParams, ImagesResult } from "./types";
import type { Region } from "./regions";
import { binarizeForModel, generationSize, regionForRect, regionForSelection, selectionToRegion } from "./regions";
import type { Selection } from "../selection/mask";
import { boundsToMm, resizeGray, selectionBounds, selectionSize } from "../selection/mask";
import { expandSelection, featherSelection } from "../selection/morph";
import type { Pt } from "../selection/shapes";
import { strokeMask } from "../selection/shapes";
import { composeRgba } from "../selection/compose";
import { decodeToGray, encodeGrayPng, encodeRgbaPng } from "../selection/pixels";
import type { Rgba } from "../selection/wand";
import { maskFrame, maskFromPixels, maskPixelSize, selectionToMaskPixels } from "../masks";
import { compactImage, remapMask, renderBareLayer } from "../layerOps";

/** Results for one generated layer, kept for this session so the user can flip between them. */
export interface Variations {
  images: string[];
  seeds: number[];
  index: number;
  /** The request that made them, for "Generate more". */
  request?: { capability: Capability; params: CapabilityParams[Capability] };
}

/** Text-to-image results waiting to be placed. */
export interface PendingImages {
  prompt: string;
  images: string[];
  seeds: number[];
  model: string | null;
  /** Where to place: the selection's box, if there was one. */
  rect: Rect | null;
  mask: Selection | null;
  /** The design the selection belonged to. */
  designId: string;
}

export interface ExpandBy {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface Deps {
  design: LabelDesign;
  layer: LabelElement | null;
  selection: Selection | null;
  ai: AiApi;
  prefs: AiPrefs;
  previewNumber: number;
  addElement: (type: "image", overrides: Partial<LabelElement>) => string | null;
  patchElement: (id: string, patch: Partial<LabelElement>) => void;
  notify: (tone: "info" | "error", message: string) => void;
}

const KIND_NAMES: Record<GenerativeKind, string> = {
  fill: "Generative fill",
  replace: "Generative replace",
  remove: "Remove",
  expand: "Generative expand",
  generate: "Generated image",
  similar: "Similar",
  edit: "Edit",
};

const short = (text: string, n = 28) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** Flatten transparency onto grey: models expect opaque RGB input. */
const flatten = (img: Rgba): Rgba => {
  const out = new Uint8ClampedArray(img.data);
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3] / 255;
    out[i] = Math.round(out[i] * a + 128 * (1 - a));
    out[i + 1] = Math.round(out[i + 1] * a + 128 * (1 - a));
    out[i + 2] = Math.round(out[i + 2] * a + 128 * (1 - a));
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
};

/** A region over `rect` that may extend past the label (expand grows images outward). */
const freeRegion = (rect: Rect, minPx = 768, maxPx = 1536): Region => {
  const longest = Math.max(rect.width, rect.height);
  const pxPerMm = Math.min(Math.max(300 / 25.4, minPx / longest), maxPx / longest);
  return { rect, pxPerMm, width: Math.max(1, Math.round(rect.width * pxPerMm)), height: Math.max(1, Math.round(rect.height * pxPerMm)) };
};

/**
 * Generative editing: fill, replace, remove, expand, text-to-image, generate
 * similar and instruction editing. Results become new image layers (or, for
 * expand, the layer itself) carrying a mask from the selection, so they are
 * non-destructive: hide, re-mask or delete them like any other layer.
 */
export const useGenerative = ({ design, layer, selection, ai, prefs, previewNumber, addElement, patchElement, notify }: Deps) => {
  const [variations, setVariations] = useState<Record<string, Variations>>({});
  const [pending, setPending] = useState<PendingImages | null>(null);
  const latest = useRef({ design, layer, selection, prefs, previewNumber });
  latest.current = { design, layer, selection, prefs, previewNumber };

  const count = () => Math.min(4, Math.max(1, latest.current.prefs.count));
  const negative = () => latest.current.prefs.negativePrompt.trim() || undefined;

  const fail = useCallback(
    (e: unknown, what: string) => {
      if (!isCancel(e)) notify("error", e instanceof Error ? e.message : `${what} failed.`);
    },
    [notify]
  );

  /** The visible label (or the layers below `belowIndex`) over a region, as PNG. */
  const renderRegion = async (region: Region, belowIndex?: number) => {
    const { design: d, previewNumber: n } = latest.current;
    const rgba = await composeRgba(d, {
      rect: region.rect,
      pxPerMm: region.pxPerMm,
      include: belowIndex === undefined ? undefined : (_e, i) => i < belowIndex,
      number: n,
    });
    if (!rgba) throw new Error("This browser can't read the label's pixels (a remote image may block it).");
    return encodeRgbaPng(flatten(rgba));
  };

  /** Mask for a model: the selection over the region, hardened. */
  const regionMask = (sel: Selection, region: Region) =>
    encodeGrayPng(binarizeForModel(selectionToRegion(sel, region)), region.width, region.height);

  /**
   * Store and place results as a new masked image layer above the selected
   * one. `designId` is the design the request was made for: if the user
   * switched designs while it ran, the result would land in the wrong one.
   */
  const placeLayer = async (
    rect: Rect,
    result: ImagesResult,
    info: GenerativeInfo,
    mask: Selection | null,
    request: Variations["request"] | undefined,
    designId: string
  ) => {
    const images = await Promise.all(result.images.map(compactImage));
    if (!images.length) throw new Error("The AI server returned no images.");
    if (latest.current.design.id !== designId) {
      throw new Error(`${KIND_NAMES[info.kind]} finished after you switched designs, so the result was discarded.`);
    }
    const stub = { ...rect, type: "image", rotation: 0 } as LabelElement;
    const m = mask ? selectionToMaskPixels(mask, stub) : null;
    const name = info.prompt ? `${KIND_NAMES[info.kind]}: ${short(info.prompt)}` : KIND_NAMES[info.kind];
    const id = addElement("image", {
      name,
      src: images[0],
      fit: "fill",
      ...rect,
      ...(m ? { mask: maskFromPixels(m.data, m.pxWidth, m.pxHeight) } : {}),
      generative: { ...info, seed: result.seeds[0] },
    } as Partial<LabelElement>);
    if (!id) throw new Error("This design has reached its layer limit.");
    setVariations((v) => ({ ...v, [id]: { images, seeds: result.seeds, index: 0, request } }));
    return id;
  };

  /* ---------- selection-based ---------- */

  /** Generative fill / replace: new content inside the selection, guided by a prompt. */
  const fill = useCallback(
    async (prompt: string, kind: "fill" | "replace" = "fill") => {
      const { selection: sel, design: d } = latest.current;
      if (!sel) return notify("info", "Make a selection first.");
      // Replace grows the area a touch so the old object's outline goes too.
      const target = kind === "replace" ? expandSelection(sel, 0.6 * sel.pxPerMm) : sel;
      const region = regionForSelection(target, d, { margin: 0.35, minPx: 768, maxPx: 1280 });
      if (!region) return;
      try {
        const image = await renderRegion(region);
        const params: CapabilityParams["inpaint"] = {
          image,
          mask: regionMask(target, region),
          prompt: prompt.trim(),
          negative_prompt: negative(),
          count: count(),
        };
        // An empty prompt is Photoshop's "fill from surroundings": use the remover.
        const capability: Capability = params.prompt || !ai.can("remove") ? "inpaint" : "remove";
        const result =
          capability === "inpaint"
            ? await ai.run("inpaint", params, KIND_NAMES[kind])
            : await ai.run("remove", { image, mask: params.mask }, KIND_NAMES[kind]);
        await placeLayer(
          region.rect,
          result,
          { kind, prompt: params.prompt, model: ai.modelFor(capability) ?? undefined },
          target,
          { capability, params: capability === "inpaint" ? params : { image, mask: params.mask } },
          d.id
        );
      } catch (e) {
        fail(e, KIND_NAMES[kind]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai, fail, notify]
  );

  /** Prompt-free removal of the selected area, or of a Remove-tool stroke. */
  const remove = useCallback(
    async (stroke?: { points: Pt[]; diameterMm: number }) => {
      const { selection: sel, design: d } = latest.current;
      let target: Selection | null = sel;
      if (stroke) {
        // The stroke is rasterised on the (size-capped) selection grid.
        const size = sel ?? selectionSize(d.width, d.height);
        const k = size.pxPerMm;
        target = strokeMask(size, stroke.points.map((p) => ({ x: p.x * k, y: p.y * k })), (stroke.diameterMm / 2) * k);
      }
      if (!target || !selectionBounds(target, 8)) return notify("info", "Select or paint over what to remove.");
      // Removal needs a little room around the object and a soft seam.
      const grown = featherSelection(expandSelection(target, 0.4 * target.pxPerMm), 0.4 * target.pxPerMm);
      const region = regionForSelection(grown, d, { margin: 0.6, minMarginMm: 3, minPx: 512, maxPx: 1280 });
      if (!region) return;
      if (!ai.can("remove") && !ai.can("inpaint")) {
        return notify("error", "Removing needs the local AI server — see the Generative AI panel.");
      }
      try {
        const image = await renderRegion(region);
        const mask = regionMask(grown, region);
        const result = ai.can("remove")
          ? await ai.run("remove", { image, mask }, "Remove")
          : await ai.run("inpaint", { image, mask, prompt: "background", count: 1 }, "Remove");
        await placeLayer(
          region.rect,
          result,
          { kind: "remove", prompt: "", model: ai.modelFor("remove") ?? undefined },
          grown,
          { capability: "remove", params: { image, mask } },
          d.id
        );
      } catch (e) {
        fail(e, "Remove");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai, fail, notify]
  );

  /* ---------- layer-based ---------- */

  /** Generative expand (outpainting): grow an image layer outward and fill the new area. */
  const expand = useCallback(
    async (el: ImageElement, by: ExpandBy, prompt: string) => {
      if (el.rotation) return notify("info", "Straighten the image (rotation 0°) before expanding it.");
      const { design: d, previewNumber: n } = latest.current;
      const rect: Rect = { x: el.x - by.left, y: el.y - by.top, width: el.width + by.left + by.right, height: el.height + by.top + by.bottom };
      if (rect.width <= el.width && rect.height <= el.height) return notify("info", "Choose how far to expand on at least one side.");
      const region = freeRegion(rect);
      try {
        const rgba = await renderBareLayer(d, el, rect, region.pxPerMm, n);
        if (!rgba) throw new Error("This browser can't read the image's pixels (a remote image may block it).");
        // Fill where the picture isn't, plus a couple of pixels of overlap for a clean seam.
        const hole = new Uint8ClampedArray(region.width * region.height);
        for (let i = 0; i < hole.length; i += 1) hole[i] = rgba.data[i * 4 + 3] < 250 ? 255 : 0;
        const holeSel = expandSelection({ width: region.width, height: region.height, pxPerMm: 1, data: hole }, 2);
        const image = encodeRgbaPng(flatten(rgba));
        const mask = encodeGrayPng(holeSel.data, region.width, region.height);
        const text = prompt.trim();
        const capability: Capability = text || !ai.can("remove") ? "inpaint" : "remove";
        const params = capability === "inpaint"
          ? { image, mask, prompt: text, negative_prompt: negative(), count: count() }
          : { image, mask };
        const result = capability === "inpaint"
          ? await ai.run("inpaint", params as CapabilityParams["inpaint"], "Generative expand")
          : await ai.run("remove", params, "Generative expand");
        const images = await Promise.all(result.images.map(compactImage));
        const after = { ...el, ...rect, crop: undefined, flipX: undefined, flipY: undefined, fit: "fill" as const };
        const mask2 = await remapMask(el, after);
        patchElement(el.id, {
          src: images[0],
          ...rect,
          crop: undefined,
          flipX: undefined,
          flipY: undefined,
          fit: "fill",
          mask: mask2,
          generative: { kind: "expand", prompt: text, model: ai.modelFor(capability) ?? undefined, seed: result.seeds[0] },
        } as Partial<LabelElement>);
        setVariations((v) => ({ ...v, [el.id]: { images, seeds: result.seeds, index: 0, request: { capability, params } } }));
      } catch (e) {
        fail(e, "Generative expand");
      }
    },
    [ai, fail, notify, patchElement]
  );

  /** Generate similar: variations of a layer's picture, as a new layer above it. */
  const similar = useCallback(
    async (el: LabelElement) => {
      const { design: d, previewNumber: n } = latest.current;
      const rect: Rect = { x: el.x, y: el.y, width: el.width, height: el.height };
      const region = freeRegion(rect, 768, 1024);
      try {
        const rgba = await renderBareLayer(d, { ...el, rotation: 0 }, rect, region.pxPerMm, n);
        if (!rgba) throw new Error("This browser can't read the image's pixels.");
        const image = encodeRgbaPng(flatten(rgba));
        const prompt = el.type === "image" && el.generative?.prompt ? el.generative.prompt : "";
        const params = { image, prompt: prompt || undefined, strength: 0.55, count: count() };
        const result = await ai.run("variations", params, "Generate similar");
        const id = await placeLayer(
          rect,
          result,
          { kind: "similar", prompt, model: ai.modelFor("variations") ?? undefined },
          null,
          { capability: "variations", params },
          d.id
        );
        // Keep the original's rotation and mask so the copy sits exactly on it.
        patchElement(id, { rotation: el.rotation, ...(el.mask ? { mask: el.mask } : {}) });
      } catch (e) {
        fail(e, "Generate similar");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai, fail, patchElement]
  );

  /** Instruction-based editing ("make it night", "turn the label blue") of a layer or the selected area. */
  const edit = useCallback(
    async (instruction: string, el: LabelElement | null) => {
      const text = instruction.trim();
      if (!text) return;
      const { design: d, selection: sel, previewNumber: n } = latest.current;
      try {
        if (sel) {
          const region = regionForSelection(sel, d, { margin: 0.35, minPx: 768, maxPx: 1280 });
          if (!region) return;
          const image = await renderRegion(region);
          const params = { image, instruction: text, count: count() };
          const result = await ai.run("edit", params, "Edit");
          await placeLayer(region.rect, result, { kind: "edit", prompt: text, model: ai.modelFor("edit") ?? undefined }, sel, { capability: "edit", params }, d.id);
          return;
        }
        if (!el) return notify("info", "Select a layer or an area to edit.");
        const rect: Rect = { x: el.x, y: el.y, width: el.width, height: el.height };
        const region = freeRegion(rect, 768, 1024);
        const rgba = await renderBareLayer(d, { ...el, rotation: 0 }, rect, region.pxPerMm, n);
        if (!rgba) throw new Error("This browser can't read the layer's pixels.");
        const params = { image: encodeRgbaPng(flatten(rgba)), instruction: text, count: count() };
        const result = await ai.run("edit", params, "Edit");
        const id = await placeLayer(rect, result, { kind: "edit", prompt: text, model: ai.modelFor("edit") ?? undefined }, null, { capability: "edit", params }, d.id);
        patchElement(id, { rotation: el.rotation, ...(el.mask ? { mask: el.mask } : {}) });
      } catch (e) {
        fail(e, "Edit");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ai, fail, notify, patchElement]
  );

  /** Remove background: mask the layer to its subject (non-destructive). */
  const removeBackground = useCallback(
    async (el: LabelElement) => {
      const { design: d, previewNumber: n } = latest.current;
      // Analyse the layer over its mask frame — for an image, the whole
      // uncropped picture — so the result is directly the mask's pixels.
      const frame = maskFrame(el);
      const region = freeRegion(frame, 1024, 1024);
      const flat = { ...el, ...frame, rotation: 0, mask: undefined, ...(el.type === "image" ? { crop: undefined } : {}) } as LabelElement;
      try {
        const rgba = await renderBareLayer(d, flat, frame, region.pxPerMm, n);
        if (!rgba) throw new Error("This browser can't read the layer's pixels.");
        const out = await ai.run("subject", { image: encodeRgbaPng(flatten(rgba)) }, "Remove background");
        const gray = await decodeToGray(out.mask, region.width, region.height);
        if (!gray) throw new Error("The AI server returned a mask this browser could not read.");
        const { pxWidth, pxHeight } = maskPixelSize(frame);
        let data = resizeGray(gray, region.width, region.height, pxWidth, pxHeight);
        // The render shows a flipped picture flipped; its mask is stored unflipped.
        if (el.type === "image" && (el.flipX || el.flipY)) data = mirror(data, pxWidth, pxHeight, !!el.flipX, !!el.flipY);
        // Keep anything an existing mask already hides.
        const old = el.mask ? await decodeToGray(el.mask.src, pxWidth, pxHeight) : null;
        if (old) data = Uint8ClampedArray.from(data, (v, i) => Math.min(v, old[i]));
        patchElement(el.id, { mask: maskFromPixels(data, pxWidth, pxHeight) });
        notify("info", `Removed the background of "${el.name}" with a layer mask — paint on the mask to adjust it.`);
      } catch (e) {
        fail(e, "Remove background");
      }
    },
    [ai, fail, notify, patchElement]
  );

  /* ---------- text to image ---------- */

  const generate = useCallback(
    async (prompt: string, aspect: number) => {
      const text = prompt.trim();
      if (!text) return;
      const sel = latest.current.selection;
      const b = sel ? selectionBounds(sel, 8) : null;
      const rect = sel && b ? boundsToMm(sel, b) : null;
      const ratio = rect ? rect.width / rect.height : aspect;
      try {
        const size = generationSize(ratio);
        const result = await ai.run(
          "generate",
          { prompt: text, negative_prompt: negative(), width: size.width, height: size.height, count: count() },
          "Generate image"
        );
        setPending({
          prompt: text,
          images: result.images,
          seeds: result.seeds,
          model: ai.modelFor("generate"),
          rect,
          mask: rect ? sel : null,
          designId: latest.current.design.id,
        });
      } catch (e) {
        fail(e, "Generate image");
      }
    },
    [ai, fail]
  );

  /** Place one pending text-to-image result (others stay as variations). */
  const placePending = useCallback(
    async (index: number) => {
      const p = pending;
      if (!p) return;
      const d = latest.current.design;
      const order = [index, ...p.images.map((_, i) => i).filter((i) => i !== index)];
      // In another design, the old selection means nothing: centre it instead.
      const sameDesign = p.designId === d.id;
      let rect = sameDesign ? p.rect : null;
      if (!rect) {
        // Fit inside 60% of the label, centred, at the result's aspect ratio.
        const probe = new Image();
        const aspect = await new Promise<number>((resolve) => {
          probe.onload = () => resolve(probe.naturalWidth / Math.max(1, probe.naturalHeight));
          probe.onerror = () => resolve(1);
          probe.src = p.images[index];
          window.setTimeout(() => resolve(1), 3000);
        });
        const w = Math.min(d.width * 0.6, d.height * 0.6 * aspect);
        const h = w / aspect;
        rect = { x: (d.width - w) / 2, y: (d.height - h) / 2, width: w, height: h };
      }
      try {
        await placeLayer(
          rect,
          { images: order.map((i) => p.images[i]), seeds: order.map((i) => p.seeds[i]) },
          { kind: "generate", prompt: p.prompt, model: p.model ?? undefined },
          sameDesign ? p.mask : null,
          undefined,
          d.id
        );
        setPending(null);
      } catch (e) {
        fail(e, "Place image");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pending, fail]
  );

  /* ---------- variations ---------- */

  const showVariation = useCallback(
    (id: string, index: number) => {
      const v = variations[id];
      if (!v || !v.images[index]) return;
      setVariations((all) => ({ ...all, [id]: { ...v, index } }));
      const el = latest.current.design.elements.find((e) => e.id === id);
      const info = el?.type === "image" ? el.generative : undefined;
      patchElement(id, { src: v.images[index], ...(info ? { generative: { ...info, seed: v.seeds[index] } } : {}) } as Partial<LabelElement>);
    },
    [variations, patchElement]
  );

  /**
   * More results for a generated layer. Within a session the original
   * request is replayed with new seeds; after a reload it is rebuilt from
   * the layers beneath and the layer's own mask.
   */
  const generateMore = useCallback(
    async (el: ImageElement) => {
      const info = el.generative;
      if (!info) return;
      const v = variations[el.id];
      const seed = Math.floor(Math.random() * 2 ** 31);
      try {
        let capability: Capability;
        let params: CapabilityParams[Capability];
        if (v?.request) {
          capability = v.request.capability;
          params = { ...v.request.params, seed } as CapabilityParams[Capability];
        } else if (info.kind === "generate") {
          const size = generationSize(el.width / el.height);
          capability = "generate";
          params = { prompt: info.prompt, negative_prompt: negative(), width: size.width, height: size.height, count: count(), seed };
        } else if (info.kind === "fill" || info.kind === "replace" || info.kind === "remove") {
          const d = latest.current.design;
          const index = d.elements.findIndex((e) => e.id === el.id);
          const region = regionForRect({ x: el.x, y: el.y, width: el.width, height: el.height }, d, { minPx: 768, maxPx: 1280 });
          if (!region) return;
          const image = await renderRegion(region, index);
          const px = el.mask ? await decodeToGray(el.mask.src, region.width, region.height) : null;
          const mask = encodeGrayPng(binarizeForModel(px ?? new Uint8ClampedArray(region.width * region.height).fill(255)), region.width, region.height);
          capability = info.kind === "remove" || !info.prompt ? "remove" : "inpaint";
          params = capability === "inpaint"
            ? { image, mask, prompt: info.prompt, negative_prompt: negative(), count: count(), seed }
            : { image, mask };
        } else {
          return notify("info", "Make a new request for more results — the original input is no longer available.");
        }
        const label = KIND_NAMES[info.kind];
        const result = (await ai.run(capability, params as never, label)) as ImagesResult;
        const images = await Promise.all(result.images.map(compactImage));
        const prev = v ?? { images: [el.src], seeds: [info.seed ?? 0], index: 0 };
        const next: Variations = { images: [...prev.images, ...images], seeds: [...prev.seeds, ...result.seeds], index: prev.images.length, request: { capability, params } };
        setVariations((all) => ({ ...all, [el.id]: next }));
        patchElement(el.id, { src: images[0], generative: { ...info, seed: result.seeds[0] } } as Partial<LabelElement>);
      } catch (e) {
        fail(e, "Generate more");
      }
    },
    [ai, fail, notify, patchElement, variations]
  );

  return {
    variations,
    pending,
    setPending,
    fill,
    remove,
    expand,
    similar,
    edit,
    removeBackground,
    generate,
    placePending,
    showVariation,
    generateMore,
  };
};

const mirror = (data: Uint8ClampedArray, w: number, h: number, fx: boolean, fy: boolean) => {
  const out = new Uint8ClampedArray(data.length);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      out[y * w + x] = data[(fy ? h - 1 - y : y) * w + (fx ? w - 1 - x : x)];
    }
  }
  return out;
};

export type GenerativeApi = ReturnType<typeof useGenerative>;
