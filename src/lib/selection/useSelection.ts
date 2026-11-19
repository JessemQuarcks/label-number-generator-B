import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LabelDesign, LabelElement } from "../../types";
import type { Rect } from "../imageEdit";
import type { SelectToolDefaults } from "../workspace";
import type { AiApi } from "../ai/useAi";
import { isCancel } from "../ai/useAi";
import type { Region } from "../ai/regions";
import { mmToRegionPx, regionForRect, regionForSelection, regionToSelection, selectionToRegion } from "../ai/regions";
import { maskPixelsToSelection } from "../masks";
import type { Selection, SelectionMode, SelectionSize } from "./mask";
import {
  combine,
  fullSelection,
  invertSelection,
  isEmptySelection,
  regridSelection,
  sameGrid,
  selectionSize,
  withData,
} from "./mask";
import type { Pt } from "./shapes";
import { fillEllipse, fillPolygon, fillRect, simplifyPath } from "./shapes";
import {
  borderSelection,
  contractSelection,
  expandSelection,
  featherSelection,
  smoothSelection,
} from "./morph";
import { magicWand, quickSelect } from "./wand";
import type { Rgba } from "./wand";
import { outlinePath } from "./contour";
import { composeRgba } from "./compose";
import { decodeToGray, encodeGrayPng, encodeRgbaPng } from "./pixels";
import type { RefineSettings } from "./refine";
import { DEFAULT_REFINE, refineSelection } from "./refine";

/** A finished gesture from one of the selection tools, in label mm. */
export type SelectionGesture =
  | { kind: "rect" | "ellipse"; rect: Rect | null; mode: SelectionMode }
  | { kind: "lasso"; points: Pt[]; mode: SelectionMode }
  | { kind: "wand"; point: Pt; mode: SelectionMode }
  | { kind: "quick"; points: Pt[]; mode: SelectionMode }
  | { kind: "object"; point?: Pt; box?: Rect; mode: SelectionMode };

export type ModifyKind = "expand" | "contract" | "feather" | "smooth" | "border";

export type RefineView = "overlay" | "black" | "white" | "bw" | "ants";

/** Select and Mask settings, in the units the dialog shows (mm and %). */
export interface RefineUi {
  radiusMm: number;
  hair: boolean;
  smoothMm: number;
  featherMm: number;
  contrast: number;
  shiftEdge: number;
}

export const DEFAULT_REFINE_UI: RefineUi = { radiusMm: 0, hair: false, smoothMm: 0, featherMm: 0, contrast: 0, shiftEdge: 0 };

export interface RefineSession {
  /** The selection when the dialog opened. */
  base: Selection;
  settings: RefineUi;
  view: RefineView;
  /** Overlay opacity, 0–100. */
  opacity: number;
  /** The live result. */
  preview: Selection;
}

export const SKY_PROMPT = "sky";

const toRefine = (ui: RefineUi, pxPerMm: number): RefineSettings => ({
  ...DEFAULT_REFINE,
  radius: ui.radiusMm * pxPerMm,
  hair: ui.hair,
  smooth: ui.smoothMm * pxPerMm,
  feather: ui.featherMm * pxPerMm,
  contrast: ui.contrast,
  shiftEdge: ui.shiftEdge,
});

interface Deps {
  design: LabelDesign;
  /** The primary selected layer, used when not sampling all layers. */
  layer: LabelElement | null;
  prefs: SelectToolDefaults;
  ai: AiApi;
  previewNumber: number;
  notify: (tone: "info" | "error", message: string) => void;
}

/**
 * The pixel selection for the active design and everything that changes it:
 * the selection tools' gestures, Select ▸ commands (including the AI ones),
 * loading a layer's pixels or mask, and the Select and Mask session.
 */
export const useSelection = ({ design, layer, prefs, ai, previewNumber, notify }: Deps) => {
  const size: SelectionSize = useMemo(() => selectionSize(design.width, design.height), [design.width, design.height]);
  const [store, setStore] = useState<Record<string, Selection | null>>({});
  const previous = useRef<Record<string, Selection | null>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [refine, setRefine] = useState<RefineSession | null>(null);

  const raw = store[design.id] ?? null;
  // Keep the selection where it was (in mm) if the label is resized.
  const selection = useMemo(() => (raw && !sameGrid(raw, size) ? regridSelection(raw, size) : raw), [raw, size]);
  const outline = useMemo(() => (selection ? outlinePath(selection) : ""), [selection]);
  const hasSelection = !!selection && !isEmptySelection(selection, 8);

  const latest = useRef({ selection, design, layer, prefs, size, previewNumber });
  latest.current = { selection, design, layer, prefs, size, previewNumber };

  /** Replace the selection (null deselects). Empty selections count as none. */
  const setSelection = useCallback(
    (next: Selection | null) => {
      const id = latest.current.design.id;
      const value = next && !isEmptySelection(next, 2) ? next : null;
      setStore((s) => {
        const current = s[id] ?? null;
        if (current && !value) previous.current[id] = current;
        return { ...s, [id]: value };
      });
    },
    []
  );

  const apply = useCallback(
    (shape: Selection, mode: SelectionMode) => setSelection(combine(latest.current.selection, shape, mode)),
    [setSelection]
  );

  const deselect = useCallback(() => setSelection(null), [setSelection]);
  const reselect = useCallback(() => {
    const prev = previous.current[latest.current.design.id];
    if (prev) setSelection(prev);
  }, [setSelection]);
  const selectAll = useCallback(() => setSelection(fullSelection(latest.current.size)), [setSelection]);
  const invert = useCallback(() => {
    const { selection: sel, size: sz } = latest.current;
    setSelection(sel ? invertSelection(sel) : fullSelection(sz));
  }, [setSelection]);

  /** Select ▸ Modify, with `amountMm` in label millimetres. */
  const modify = useCallback(
    (kind: ModifyKind, amountMm: number) => {
      const sel = latest.current.selection;
      if (!sel) return;
      const px = amountMm * sel.pxPerMm;
      const ops: Record<ModifyKind, (s: Selection, r: number) => Selection> = {
        expand: expandSelection,
        contract: contractSelection,
        feather: featherSelection,
        smooth: smoothSelection,
        border: borderSelection,
      };
      setSelection(ops[kind](sel, px));
    },
    [setSelection]
  );

  /* ---------- pixels to analyse ---------- */

  /** Sample all layers, or just the selected one if it has pixels of its own. */
  const sourceFilter = useCallback(() => {
    const { prefs: p, layer: l } = latest.current;
    if (p.sampleAll || !l || (l.type !== "image" && l.type !== "raster")) return undefined;
    return (el: LabelElement) => el.id === l.id;
  }, []);

  const sourceKey = () => {
    const { design: d, layer: l, prefs: p, previewNumber: n } = latest.current;
    return [d.id, p.sampleAll ? "all" : l?.id ?? "all", n];
  };

  /** RGBA of the label at selection resolution; cached until the design changes. */
  const fullCache = useRef<{ elements: unknown; background: string; key: string; rgba: Rgba } | null>(null);
  const fullRgba = useCallback(async (): Promise<Rgba | null> => {
    const { design: d, size: sz, previewNumber: n } = latest.current;
    const key = JSON.stringify([...sourceKey(), sz.width, sz.height]);
    const c = fullCache.current;
    if (c && c.elements === d.elements && c.background === d.background && c.key === key) return c.rgba;
    const include = sourceFilter();
    const rgba = await composeRgba(d, { pxPerMm: sz.pxPerMm, include, background: !include, number: n });
    if (!rgba || rgba.width !== sz.width || rgba.height !== sz.height) return rgba;
    fullCache.current = { elements: d.elements, background: d.background, key, rgba };
    return rgba;
  }, [sourceFilter]);

  /**
   * A region of the label as a PNG for the AI server. Repeated clicks on an
   * unchanged design send the identical image, so the server's embedding
   * cache makes them fast.
   */
  const pngCache = useRef<{ elements: unknown; key: string; png: string } | null>(null);
  const regionPng = useCallback(
    async (region: Region): Promise<string | null> => {
      const { design: d, previewNumber: n } = latest.current;
      const key = JSON.stringify([...sourceKey(), region.rect, region.width, region.height]);
      const c = pngCache.current;
      if (c && c.elements === d.elements && c.key === key) return c.png;
      const include = sourceFilter();
      const rgba = await composeRgba(d, { rect: region.rect, pxPerMm: region.pxPerMm, include, background: !include, number: n });
      if (!rgba) return null;
      const png = encodeRgbaPng(rgba);
      pngCache.current = { elements: d.elements, key, png };
      return png;
    },
    [sourceFilter]
  );

  /** The whole label as one region, at a resolution segmentation models like. */
  const labelRegion = useCallback(() => {
    const d = latest.current.design;
    return regionForRect({ x: 0, y: 0, width: d.width, height: d.height }, d, { minPx: 1024, maxPx: 1536 });
  }, []);

  /** Run an AI step that returns a mask for `region`, and fold it into the selection. */
  const aiMask = useCallback(
    async (
      label: string,
      region: Region,
      call: (image: string) => Promise<{ mask: string; found?: boolean }>,
      mode: SelectionMode,
      transform?: (sel: Selection) => Selection
    ) => {
      setBusy(label);
      try {
        const image = await regionPng(region);
        if (!image) throw new Error("This browser can't read the label's pixels (a remote image may block it).");
        const out = await call(image);
        if (out.found === false) {
          notify("info", `${label}: nothing found.`);
          return;
        }
        const gray = await decodeToGray(out.mask, region.width, region.height);
        if (!gray) throw new Error("The AI server returned a mask this browser could not read.");
        let shape = regionToSelection(gray, region.width, region.height, region, latest.current.size);
        if (transform) shape = transform(shape);
        if (isEmptySelection(shape, 8) && mode !== "intersect") {
          // Keep the current selection rather than silently dropping it.
          notify("info", `${label}: nothing found there. Try another spot, a box around the object, or another model.`);
          return;
        }
        apply(shape, mode);
      } catch (e) {
        if (!isCancel(e)) notify("error", e instanceof Error ? e.message : `${label} failed.`);
      } finally {
        setBusy(null);
      }
    },
    [apply, notify, regionPng]
  );

  const selectSubject = useCallback(
    (mode: SelectionMode = "new", background = false) => {
      const region = labelRegion();
      if (!region) return;
      void aiMask(
        background ? "Select background" : "Select subject",
        region,
        (image) => ai.run("subject", { image }, "Select subject"),
        mode,
        background ? invertSelection : undefined
      );
    },
    [ai, aiMask, labelRegion]
  );

  const selectByText = useCallback(
    (prompt: string, mode: SelectionMode = "new") => {
      const region = labelRegion();
      const text = prompt.trim();
      if (!region || !text) return;
      void aiMask(
        text === SKY_PROMPT ? "Select sky" : `Select "${text}"`,
        region,
        (image) => ai.run("segment_text", { image, prompt: text }, "Select by description"),
        mode
      );
    },
    [ai, aiMask, labelRegion]
  );

  /* ---------- gestures ---------- */

  const featherNew = (shape: Selection) => {
    const f = latest.current.prefs.feather;
    return f > 0 ? featherSelection(shape, f * shape.pxPerMm) : shape;
  };

  const toPx = (p: Pt): Pt => ({ x: p.x * latest.current.size.pxPerMm, y: p.y * latest.current.size.pxPerMm });

  const handleGesture = useCallback(
    async (g: SelectionGesture) => {
      const { size: sz, prefs: p, selection: current } = latest.current;
      switch (g.kind) {
        case "rect":
        case "ellipse": {
          if (!g.rect) {
            // A plain click with a marquee drops the selection, as in Photoshop.
            if (g.mode === "new") deselect();
            return;
          }
          const r = { x: g.rect.x * sz.pxPerMm, y: g.rect.y * sz.pxPerMm, width: g.rect.width * sz.pxPerMm, height: g.rect.height * sz.pxPerMm };
          const shape = g.kind === "rect" ? fillRect(sz, r, p.antiAlias) : fillEllipse(sz, r, p.antiAlias);
          apply(featherNew(shape), g.mode);
          return;
        }
        case "lasso": {
          const pts = simplifyPath(g.points.map(toPx), 0.75);
          if (pts.length < 3) {
            if (g.mode === "new") deselect();
            return;
          }
          apply(featherNew(fillPolygon(sz, pts, p.antiAlias)), g.mode);
          return;
        }
        case "wand": {
          setBusy("Magic wand");
          try {
            const rgba = await fullRgba();
            if (!rgba) throw new Error("This browser can't read the label's pixels (a remote image may block it).");
            const at = toPx(g.point);
            const mask = magicWand(rgba, at.x, at.y, { tolerance: p.tolerance, contiguous: p.contiguous, antiAlias: p.antiAlias });
            apply(withData(sz, mask), g.mode);
          } catch (e) {
            notify("error", e instanceof Error ? e.message : "Magic wand failed.");
          } finally {
            setBusy(null);
          }
          return;
        }
        case "quick": {
          // Like Photoshop, after the first stroke the brush adds by default.
          const mode = g.mode === "new" && current ? "add" : g.mode;
          if (p.aiAssist && ai.can("segment")) {
            const region = labelRegion();
            if (!region) return;
            // A handful of points spread along the stroke tell the model what was meant.
            const n = Math.min(8, g.points.length);
            const points = Array.from({ length: n }, (_, i) => {
              const q = mmToRegionPx(region, g.points[Math.floor((i * (g.points.length - 1)) / Math.max(1, n - 1))]);
              return { x: Math.round(q.x), y: Math.round(q.y), label: 1 as const };
            });
            await aiMask("Quick selection", region, (image) => ai.run("segment", { image, points }, "Quick selection"), mode);
            return;
          }
          setBusy("Quick selection");
          try {
            const rgba = await fullRgba();
            if (!rgba) throw new Error("This browser can't read the label's pixels (a remote image may block it).");
            const mask = quickSelect(rgba, g.points.map(toPx), {
              radius: (p.size / 2) * sz.pxPerMm,
              tolerance: p.tolerance,
              reach: 6,
            });
            apply(withData(sz, mask), mode);
          } catch (e) {
            notify("error", e instanceof Error ? e.message : "Quick selection failed.");
          } finally {
            setBusy(null);
          }
          return;
        }
        case "object": {
          const region = labelRegion();
          if (!region) return;
          if (!ai.can("segment")) {
            notify("error", "Object selection needs the local AI server with a segmentation model — see the Generative AI panel.");
            return;
          }
          const params = g.box
            ? (() => {
                const a = mmToRegionPx(region, { x: g.box.x, y: g.box.y });
                const b = mmToRegionPx(region, { x: g.box.x + g.box.width, y: g.box.y + g.box.height });
                return { boxes: [[Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y)]] as [number, number, number, number][] };
              })()
            : (() => {
                const q = mmToRegionPx(region, g.point ?? { x: 0, y: 0 });
                return { points: [{ x: Math.round(q.x), y: Math.round(q.y), label: 1 as const }] };
              })();
          await aiMask("Object selection", region, (image) => ai.run("segment", { image, ...params }, "Object selection"), g.mode);
          return;
        }
      }
    },
    [ai, aiMask, apply, deselect, fullRgba, labelRegion, notify]
  );

  /* ---------- from layers ---------- */

  /** Select ▸ Load selection from a layer's pixels (its transparency). */
  const loadLayerPixels = useCallback(
    async (el: LabelElement, mode: SelectionMode = "new") => {
      const { design: d, size: sz, previewNumber: n } = latest.current;
      const rgba = await composeRgba(d, { pxPerMm: sz.pxPerMm, include: (e) => e.id === el.id, background: false, number: n });
      if (!rgba || rgba.width !== sz.width || rgba.height !== sz.height) {
        notify("error", "Couldn't read that layer's pixels in this browser.");
        return;
      }
      const alpha = new Uint8ClampedArray(sz.width * sz.height);
      for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgba.data[i * 4 + 3];
      apply(withData(sz, alpha), mode);
    },
    [apply, notify]
  );

  /** Select ▸ Load selection from a layer mask. */
  const loadLayerMask = useCallback(
    async (el: LabelElement, mode: SelectionMode = "new") => {
      if (!el.mask) return;
      const gray = await decodeToGray(el.mask.src, el.mask.pxWidth, el.mask.pxHeight);
      if (!gray) {
        notify("error", "Couldn't read that mask in this browser.");
        return;
      }
      apply(maskPixelsToSelection(gray, el.mask.pxWidth, el.mask.pxHeight, el, latest.current.size), mode);
    },
    [apply, notify]
  );

  /* ---------- Select and Mask ---------- */

  const refineImage = useRef<Rgba | null>(null);

  const openRefine = useCallback(async () => {
    const sel = latest.current.selection;
    if (!sel) {
      notify("info", "Make a selection first, then refine it with Select and Mask.");
      return;
    }
    refineImage.current = await fullRgba();
    setRefine({ base: sel, settings: { ...DEFAULT_REFINE_UI }, view: "overlay", opacity: 50, preview: sel });
  }, [fullRgba, notify]);

  const patchRefine = useCallback((patch: Partial<Omit<RefineSession, "settings" | "preview">> & { settings?: Partial<RefineUi> }) => {
    setRefine((r) => (r ? { ...r, ...patch, settings: { ...r.settings, ...(patch.settings ?? {}) } } : r));
  }, []);

  // Recompute the preview shortly after settings settle.
  const refineSettings = refine?.settings;
  const refineBase = refine?.base;
  useEffect(() => {
    if (!refineSettings || !refineBase) return;
    const t = window.setTimeout(() => {
      const preview = refineSelection(refineBase, refineImage.current, toRefine(refineSettings, refineBase.pxPerMm));
      setRefine((r) => (r && r.base === refineBase ? { ...r, preview } : r));
    }, 120);
    return () => window.clearTimeout(t);
  }, [refineSettings, refineBase]);

  /** Refine hair with the AI matting model, or the built-in hair filter without one. */
  const refineHair = useCallback(async () => {
    const r = refine;
    if (!r) return;
    const d = latest.current.design;
    if (!ai.can("matte")) {
      patchRefine({ settings: { hair: true, radiusMm: Math.max(r.settings.radiusMm, 1.5) } });
      notify("info", "Refined with the built-in hair filter (no AI matting model available).");
      return;
    }
    const region = regionForSelection(r.base, d, { margin: 0.1, minPx: 768, maxPx: 1536 });
    if (!region) return;
    setBusy("Refine hair");
    try {
      const image = await regionPng(region);
      if (!image) throw new Error("This browser can't read the label's pixels.");
      const patch = selectionToRegion(r.base, region);
      const mask = encodeGrayPng(patch, region.width, region.height);
      const radius = Math.max(4, Math.round(Math.max(r.settings.radiusMm, 1) * region.pxPerMm));
      const out = await ai.run("matte", { image, mask, radius }, "Refine hair");
      const gray = await decodeToGray(out.mask, region.width, region.height);
      if (!gray) throw new Error("The AI server returned a mask this browser could not read.");
      const inRegion = regionToSelection(gray, region.width, region.height, region, latest.current.size);
      // Keep the old selection outside the analysed region.
      const regionSel = regionToSelection(new Uint8ClampedArray(region.width * region.height).fill(255), region.width, region.height, region, latest.current.size);
      const merged = withData(
        r.base,
        Uint8ClampedArray.from(r.base.data, (v, i) => (regionSel.data[i] > 127 ? inRegion.data[i] : v))
      );
      patchRefine({ base: merged });
    } catch (e) {
      if (!isCancel(e)) notify("error", e instanceof Error ? e.message : "Refine hair failed.");
    } finally {
      setBusy(null);
    }
  }, [ai, notify, patchRefine, refine, regionPng]);

  /** In Select and Mask's ants view, the ants follow the refined result. */
  const refineAnts = refine?.view === "ants" ? refine.preview : null;
  const refineOutline = useMemo(() => (refineAnts ? outlinePath(refineAnts) : ""), [refineAnts]);

  /** Close Select and Mask; returns the refined selection when kept. */
  const closeRefine = useCallback(
    (keep: boolean): Selection | null => {
      const r = refine;
      // The preview may lag the last slider move by a tick; compute it fresh.
      const result = r && keep ? refineSelection(r.base, refineImage.current, toRefine(r.settings, r.base.pxPerMm)) : null;
      setRefine(null);
      refineImage.current = null;
      return result;
    },
    [refine]
  );

  return {
    size,
    selection,
    hasSelection,
    /** The ants to draw: the selection's, or the refined preview's in Select and Mask. */
    outline: refine?.view === "ants" ? refineOutline : outline,
    busy,
    setBusy,
    setSelection,
    apply,
    deselect,
    reselect,
    canReselect: !!previous.current[design.id],
    selectAll,
    invert,
    modify,
    handleGesture,
    selectSubject,
    selectByText,
    loadLayerPixels,
    loadLayerMask,
    fullRgba,
    regionPng,
    refine,
    openRefine,
    patchRefine,
    refineHair,
    closeRefine,
  };
};

export type SelectionApi = ReturnType<typeof useSelection>;
