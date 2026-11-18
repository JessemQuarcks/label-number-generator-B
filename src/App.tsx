import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ImageElement, LabelElement, NumberElement } from "./types";
import { Button, NumberInput, PrintSheet } from "./components";
import Canvas from "./components/Canvas";
import type { CreatableType, CropSession } from "./components/Canvas";
import LayerList from "./components/LayerList";
import Properties from "./components/Properties";
import Toolbar from "./components/Toolbar";
import OptionsBar from "./components/OptionsBar";
import DocumentTabs from "./components/DocumentTabs";
import StatusBar from "./components/StatusBar";
import { Dock, Panel } from "./components/Dock";
import type { PanelChrome } from "./components/Dock";
import { ContextMenu, MenuBar } from "./components/Menu";
import type { ContextMenuState } from "./components/Menu";
import { AppearanceDialog, ShortcutsDialog } from "./components/Dialogs";
import { Icon } from "./components/icons";
import FontManager from "./components/FontManager";
import FontWarnings from "./components/FontWarnings";
import { useDesigns } from "./lib/useDesigns";
import { createElement, createImageOverlayPreset, DEFAULT_TYPOGRAPHY, PRESETS } from "./lib/defaults";
import type { Preset } from "./lib/defaults";
import { MAX_COUNT } from "./lib/storage";
import { PX_PER_MM } from "./lib/units";
import { useTheme } from "./lib/theme";
import { lastNumber } from "./lib/numbering";
import { waitForDesignFonts } from "./lib/fontLoader";
import { useFontsReady } from "./lib/useFontsReady";
import { findMissingFonts } from "./lib/fontAvailability";
import { FONT_OPTIONS } from "./lib/fonts";
import type { ToolId } from "./lib/tools";
import { toolById, toolForKey } from "./lib/tools";
import type { DockSide, PanelId, ToolDefaults } from "./lib/workspace";
import { DEFAULT_TOOL_DEFAULTS, useWorkspace } from "./lib/workspace";
import type { CategoryId } from "./lib/properties";
import { kindOf, resolveCategory } from "./lib/properties";
import type { Alignment, Distribution } from "./lib/align";
import { align, alignReference, distribute } from "./lib/align";
import {
  applyCrop,
  centredCropForRatio,
  clearCrop,
  fullFrame,
  NO_CROP,
} from "./lib/imageEdit";
import type { Rect } from "./lib/imageEdit";
import {
  imageNameOf,
  isImageFile,
  isJsonFile,
  measureImage,
  placementFor,
  readImageFile,
  UNSUPPORTED_IMAGE,
} from "./lib/imageFiles";
import type { MenuCommands, MenuContext } from "./lib/menus";
import { buildEffectMenu, shapeItems } from "./lib/menus";
import BrushPanel from "./components/BrushPanel";
import type { EffectKind, LayerEffect, RasterElement } from "./types";
import { createEffect, duplicateEffect, presetEffects, supportsEffects } from "./lib/effects";
import { expandSelection, itemBounds, membersOf, topLevelItems } from "./lib/layers";
import { nextShape, shapeDef } from "./lib/shapes";

const shapeLabel = (kind: Parameters<typeof shapeDef>[0]) => shapeDef(kind).label;
import { stepBrushSize } from "./lib/brush";
import {
  buildCanvasMenu,
  buildLayerMenu,
  buildMenuBar,
  buildToolMenu,
  newDesignItems,
} from "./lib/menus";

type Status = { tone: "info" | "error"; message: string } | null;

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 8;
const clampZoom = (z: number) => Math.min(Math.max(z, MIN_ZOOM), MAX_ZOOM);

const isTypingTarget = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
};

function App() {
  const designs = useDesigns();
  const {
    state,
    activeDesign,
    selected,
    selectedIds,
    selectedGroup,
    layerState,
    groupSelection,
    ungroupSelection,
    patchGroup,
    moveLayers,
    updateEffects,
    setSelectedId,
    selectElement,
    setSelection,
    selectAll,
    patchDesign,
    patchElement,
    patchElements,
    addElement,
    deleteElement,
    deleteElements,
    duplicateElement,
    duplicateElements,
    reorderElement,
    arrangeElements,
    toggleVisible,
    selectDesign,
    addDesign,
    duplicateDesign,
    deleteDesign,
    setPrint,
    addFont,
    removeFont,
    importJson,
    exportJson,
    undo,
    redo,
    canUndo,
    canRedo,
  } = designs;

  const fontsReady = useFontsReady(activeDesign);

  // Re-measured once fonts are ready, so a just-uploaded family is not
  // reported missing while its file is still decoding.
  const missingFonts = useMemo(
    () => (fontsReady ? findMissingFonts(activeDesign) : []),
    [activeDesign, fontsReady]
  );

  const theme = useTheme();
  const { prefs: ws, update: updateWs, patchPanel, revealPanel, togglePanel, movePanel, resetWorkspace } =
    useWorkspace();

  const [tool, setToolState] = useState<ToolId>("move");
  const [spaceHeld, setSpaceHeld] = useState(false);
  // 0 means "fit the label to the work area".
  const [zoom, setZoom] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [zoomOutMode, setZoomOutMode] = useState(false);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [printing, setPrinting] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [dialog, setDialog] = useState<"appearance" | "shortcuts" | null>(null);
  const [crop, setCrop] = useState<CropSession | null>(null);
  const [cropRatioKey, setCropRatioKey] = useState("free");
  const [focusContentNonce, setFocusContentNonce] = useState(0);
  const [autoSelect, setAutoSelect] = useState<"layer" | "group">("layer");

  const importRef = useRef<HTMLInputElement>(null);
  const placeRef = useRef<HTMLInputElement>(null);
  /** When set, the next placed file replaces this image layer's source. */
  const replaceTarget = useRef<string | null>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const statusTimer = useRef<number | undefined>(undefined);

  const effectiveTool: ToolId = spaceHeld ? "hand" : tool;
  const scale = zoom === 0 ? fitScale : zoom;
  const selectedCount = selectedIds.length;

  const notify = useCallback((tone: "info" | "error", message: string) => {
    setStatus({ tone, message });
    window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(null), 3500);
  }, []);

  /* ---------------------------------------------------------------------
   * Zoom & viewport
   * ------------------------------------------------------------------ */

  // Recompute "fit" whenever the work area or the label size changes, so the
  // whole label stays visible at any window size.
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const recompute = () => {
      const pad = 96;
      const w = (node.clientWidth - pad) / (activeDesign.width * PX_PER_MM);
      const h = (node.clientHeight - pad) / (activeDesign.height * PX_PER_MM);
      setFitScale(Math.max(0.1, Math.min(w, h, 2)));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeDesign.width, activeDesign.height]);

  /** The label point under the cursor, kept there across a zoom change. */
  const zoomAnchor = useRef<{ mmX: number; mmY: number; clientX: number; clientY: number } | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const zoomTo = useCallback((next: number, clientX?: number, clientY?: number) => {
    const target = clampZoom(next);
    const surface = viewportRef.current?.querySelector("[data-label-surface]");
    if (surface && clientX !== undefined && clientY !== undefined && !zoomAnchor.current) {
      const rect = surface.getBoundingClientRect();
      const s = scaleRef.current;
      zoomAnchor.current = {
        mmX: (clientX - rect.left) / (PX_PER_MM * s),
        mmY: (clientY - rect.top) / (PX_PER_MM * s),
        clientX,
        clientY,
      };
    }
    scaleRef.current = target;
    setZoom(target);
  }, []);

  useLayoutEffect(() => {
    const anchor = zoomAnchor.current;
    zoomAnchor.current = null;
    const viewport = viewportRef.current;
    const surface = viewport?.querySelector("[data-label-surface]");
    if (!anchor || !viewport || !surface) return;
    const rect = surface.getBoundingClientRect();
    viewport.scrollLeft += rect.left - (anchor.clientX - anchor.mmX * PX_PER_MM * scale);
    viewport.scrollTop += rect.top - (anchor.clientY - anchor.mmY * PX_PER_MM * scale);
  }, [scale]);

  const stepZoom = useCallback(
    (direction: 1 | -1, clientX?: number, clientY?: number) => {
      const current = scaleRef.current;
      const next =
        direction === 1
          ? ZOOM_STEPS.find((z) => z > current + 0.001)
          : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001);
      if (next) zoomTo(next, clientX, clientY);
    },
    [zoomTo]
  );

  const zoomBy = useCallback(
    (factor: number, clientX: number, clientY: number) => zoomTo(scaleRef.current * factor, clientX, clientY),
    [zoomTo]
  );

  /* ---------------------------------------------------------------------
   * Tabs: which designs are open
   * ------------------------------------------------------------------ */

  const openIds = useMemo(() => {
    const existing = new Set(state.designs.map((d) => d.id));
    let ids = ws.openDesignIds.filter((id) => existing.has(id));
    if (ids.length === 0) ids = state.designs.map((d) => d.id);
    if (!ids.includes(activeDesign.id)) ids = [...ids, activeDesign.id];
    return ids;
  }, [ws.openDesignIds, state.designs, activeDesign.id]);

  useEffect(() => {
    if (openIds.join() !== ws.openDesignIds.join()) updateWs({ openDesignIds: openIds });
  }, [openIds, ws.openDesignIds, updateWs]);

  const openTabs = openIds
    .map((id) => state.designs.find((d) => d.id === id))
    .filter((d): d is NonNullable<typeof d> => !!d);

  const closeTab = (id: string) => {
    if (openIds.length <= 1) return;
    const at = openIds.indexOf(id);
    const rest = openIds.filter((x) => x !== id);
    updateWs({ openDesignIds: rest });
    if (id === activeDesign.id) selectDesign(rest[Math.min(at, rest.length - 1)]);
  };

  /* ---------------------------------------------------------------------
   * Properties category, per kind of selection
   * ------------------------------------------------------------------ */

  const kind = kindOf(selectedCount, selected, !!selectedGroup);
  const category = resolveCategory(kind, ws.propertiesTab[kind]);
  const setCategory = (next: CategoryId, forKind = kind) =>
    updateWs((p) => ({ propertiesTab: { ...p.propertiesTab, [forKind]: next } }));

  /** Show the Properties panel on a given category. */
  const openProperties = (next?: CategoryId, forKind = kind) => {
    if (next) setCategory(next, forKind);
    revealPanel("properties");
  };

  /* ---------------------------------------------------------------------
   * Crop
   * ------------------------------------------------------------------ */

  const cropElement = crop
    ? (activeDesign.elements.find((e) => e.id === crop.id && e.type === "image") as ImageElement | undefined)
    : undefined;

  // A crop whose image vanished (deleted, undone, other design) just ends.
  useEffect(() => {
    if (crop && !cropElement) setCrop(null);
  }, [crop, cropElement]);

  const commitCrop = useCallback(() => {
    if (!crop || !cropElement) return;
    patchElement(cropElement.id, applyCrop(cropElement, crop.crop) as Partial<LabelElement>);
    setCrop(null);
  }, [crop, cropElement, patchElement]);

  const startCrop = (id: string) => {
    const el = activeDesign.elements.find((e) => e.id === id);
    if (!el || el.type !== "image" || !el.src) {
      notify("info", "Select an image layer with a picture to crop.");
      return;
    }
    if (crop && crop.id !== id) commitCrop();
    setSelectedId(id);
    setToolState("crop");
    setCropRatioKey("free");
    setCrop({ id, crop: el.crop ?? { ...NO_CROP }, ratio: null });
  };

  const setCropRatio = (key: string) => {
    setCropRatioKey(key);
    if (!crop || !cropElement) return;
    const frame = fullFrame(cropElement);
    const ratio = key === "free" ? null : key === "original" ? frame.width / frame.height : Number(key);
    setCrop({
      ...crop,
      ratio,
      crop: ratio ? centredCropForRatio(frame, ratio) : crop.crop,
    });
  };

  const setTool = (next: ToolId) => {
    if (next === tool) return;
    // Leaving the crop tool keeps the crop, as switching tools does in
    // desktop editors; Esc is the way to throw it away.
    if (tool === "crop" && crop) commitCrop();
    setToolState(next);
    setContextMenu(null);
    if (next === "crop" && selected?.type === "image" && selected.src && selectedCount === 1) {
      setCropRatioKey("free");
      setCrop({ id: selected.id, crop: selected.crop ?? { ...NO_CROP }, ratio: null });
    }
  };

  /* ---------------------------------------------------------------------
   * Creating layers
   * ------------------------------------------------------------------ */

  /** A new layer styled from the tool defaults, at `rect` or centred on `at`. */
  const createLayer = (type: CreatableType, rect: Rect | null, at?: { x: number; y: number }) => {
    const d = ws.toolDefaults;
    const base = createElement(type, activeDesign);
    let overrides: Partial<LabelElement> = {};
    if (type === "text") {
      overrides = {
        typography: { ...DEFAULT_TYPOGRAPHY, ...d.text, verticalAlign: "middle" },
      } as Partial<LabelElement>;
    } else if (type === "number") {
      const typography = (base as NumberElement).typography;
      overrides = {
        prefix: d.number.prefix,
        padTo: d.number.padTo,
        typography: { ...typography, fontSize: d.number.fontSize, color: d.number.color },
      } as Partial<LabelElement>;
    } else {
      overrides = {
        fill: d.shape.fill,
        border: { ...d.shape.border },
        ...(d.shape.kind !== "rectangle" ? { shape: d.shape.kind, name: shapeLabel(d.shape.kind) } : {}),
        ...(d.shape.kind === "polygon" || d.shape.kind === "star" ? { sides: d.shape.sides } : {}),
        ...(d.shape.kind === "star" || d.shape.kind === "burst" ? { innerRadius: d.shape.innerRadius } : {}),
      } as Partial<LabelElement>;
    }
    const box = rect ?? {
      width: base.width,
      height: base.height,
      x: at ? at.x - base.width / 2 : base.x,
      y: at ? at.y - base.height / 2 : base.y,
    };
    const id = addElement(type, { ...overrides, ...box });
    if (!id) {
      notify("error", "This design has reached its layer limit.");
      return;
    }
    const defaultTab = resolveCategory(type);
    setCategory(defaultTab, type);
    revealPanel("properties");
    if (type === "text") setFocusContentNonce((n) => n + 1);
  };

  const setToolDefaults = <K extends keyof ToolDefaults>(key: K, patch: Partial<ToolDefaults[K]>) =>
    updateWs((p) => ({
      toolDefaults: { ...p.toolDefaults, [key]: { ...p.toolDefaults[key], ...patch } },
    }));

  /* ---------------------------------------------------------------------
   * Images: place, drop, paste, replace, import
   * ------------------------------------------------------------------ */

  const placeFiles = async (files: File[], at?: { x: number; y: number }, targetId?: string | null) => {
    let placed = 0;
    let last = "";
    for (const file of files) {
      try {
        if (isJsonFile(file)) {
          const added = importJson(await file.text());
          notify("info", `Imported ${added} design${added === 1 ? "" : "s"}.`);
          continue;
        }
        if (!isImageFile(file)) {
          notify("error", UNSUPPORTED_IMAGE);
          continue;
        }
        const src = await readImageFile(file);
        const name = imageNameOf(file);
        const target = targetId ? activeDesign.elements.find((e) => e.id === targetId) : undefined;
        // Dropping onto an empty image slot fills it rather than stacking.
        if (placed === 0 && target?.type === "image" && !target.src) {
          patchElement(target.id, { src } as Partial<LabelElement>);
          setSelectedId(target.id);
        } else {
          const natural = await measureImage(src);
          const offset = placed * 4;
          const point = at ? { x: at.x + offset, y: at.y + offset } : undefined;
          const box = placementFor(natural, activeDesign, point);
          addElement("image", { name, src, fit: "contain", ...box } as Partial<LabelElement>);
        }
        placed += 1;
        last = name;
      } catch (error) {
        notify("error", error instanceof Error ? error.message : "Could not place that file.");
      }
    }
    if (placed > 0) {
      setToolState("move");
      setCategory("image", "image");
      notify("info", placed === 1 ? `Placed "${last}".` : `Placed ${placed} images.`);
    }
  };

  const replaceImageSource = async (id: string, file: File) => {
    try {
      const src = await readImageFile(file);
      const el = activeDesign.elements.find((e) => e.id === id);
      if (!el || el.type !== "image") return;
      // A different picture has different content, so an old crop is
      // meaningless against it — grow back to the full frame first.
      const reset = el.crop ? clearCrop(el) : {};
      patchElement(id, { ...reset, src } as Partial<LabelElement>);
      notify("info", `Replaced the image in "${el.name}".`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Could not read that image.");
    }
  };

  const openPlaceDialog = (replaceId: string | null = null) => {
    replaceTarget.current = replaceId;
    placeRef.current?.click();
  };

  const handleImport = async (file: File) => {
    try {
      if (isJsonFile(file)) {
        const added = importJson(await file.text());
        notify("info", `Imported ${added} design${added === 1 ? "" : "s"}.`);
        return;
      }
      const src = await readImageFile(file);
      const imageName = imageNameOf(file) || "Imported image";
      addDesign(createImageOverlayPreset(src, `${imageName} + number`, "contain"));
      notify("info", `Imported "${imageName}" as a new design with a serial number.`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Import failed.");
    }
  };

  const download = (json: string, filename: string) => {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  /* ---------------------------------------------------------------------
   * Print
   * ------------------------------------------------------------------ */

  /**
   * Print only once every font the design uses is loaded. Printing early
   * renders text in a fallback at the wrong advance width, which changes where
   * lines wrap — on paper, at a size that cannot be undone.
   */
  const handlePrint = useCallback(async () => {
    if (printing) return;

    // A missing family cannot be fixed by waiting, and the substitution is
    // invisible on screen. Confirm before committing a run to paper.
    if (missingFonts.length > 0) {
      const names = missingFonts.map((w) => w.requested).join(", ");
      const proceed = window.confirm(
        `${names} ${missingFonts.length === 1 ? "is" : "are"} not installed on this machine.\n\n` +
          `These labels will print in a substitute font with different letter widths, ` +
          `so text may wrap differently than it looks here.\n\n` +
          `Print ${state.print.count} label${state.print.count === 1 ? "" : "s"} anyway?`
      );
      if (!proceed) return;
    }

    setPrinting(true);
    try {
      const { timedOut } = await waitForDesignFonts(activeDesign);
      if (timedOut) {
        notify("error", "Some fonts did not load in time — printing with fallbacks.");
      }
      window.print();
    } finally {
      setPrinting(false);
    }
  }, [activeDesign, notify, printing, missingFonts, state.print.count]);

  /* ---------------------------------------------------------------------
   * Selection-wide commands
   * ------------------------------------------------------------------ */

  /** Selected items as alignable boxes — a group is one box, moved as a unit. */
  const topItems = topLevelItems(selectedIds, layerState);
  const alignBoxes = topItems
    .map((id) => itemBounds(id, layerState))
    .filter((b): b is NonNullable<typeof b> => !!b);

  /** Move each item (and, for groups, every member) to its new box position. */
  const applyItemMoves = (moves: Record<string, { x: number; y: number }>, key: string) => {
    const patches: Record<string, Partial<LabelElement>> = {};
    for (const box of alignBoxes) {
      const to = moves[box.id];
      if (!to) continue;
      const dx = to.x - box.x;
      const dy = to.y - box.y;
      for (const id of expandSelection([box.id], layerState)) {
        const el = activeDesign.elements.find((e) => e.id === id);
        if (el) patches[id] = { x: Math.round((el.x + dx) * 1000) / 1000, y: Math.round((el.y + dy) * 1000) / 1000 };
      }
    }
    patchElements(patches, key);
  };

  const alignSelection = (alignment: Alignment, target = ws.alignTarget) => {
    const ref = alignReference(alignBoxes, target, activeDesign);
    if (!ref) return;
    applyItemMoves(align(alignBoxes, alignment, ref), `align:${Date.now()}`);
  };

  const distributeSelection = (direction: Distribution) => {
    const target = alignBoxes.length < 2 ? "canvas" : ws.alignTarget;
    const ref = alignReference(alignBoxes, target, activeDesign);
    if (!ref) return;
    applyItemMoves(distribute(alignBoxes, direction, ref), `distribute:${Date.now()}`);
  };

  /* ---------------------------------------------------------------------
   * Effects, groups, pixel layers, brush
   * ------------------------------------------------------------------ */

  const effectTarget = selected && supportsEffects(selected) && selectedCount === 1 ? selected : null;

  const addEffect = (kind: EffectKind, id = effectTarget?.id) => {
    if (!id) return;
    updateEffects(id, (list) => [...list, createEffect(kind)]);
    openProperties("effects", activeDesign.elements.find((e) => e.id === id)?.type);
  };
  const applyEffectPreset = (key: string, id = effectTarget?.id) => {
    if (!id) return;
    updateEffects(id, (list) => [...list, ...presetEffects(key)]);
  };
  const patchEffect = (id: string, effectId: string, patch: Partial<LayerEffect>) =>
    updateEffects(id, (list) => list.map((e) => (e.id === effectId ? { ...e, ...patch } : e)));
  /** Toggle one effect, or (effectId null) the whole stack. */
  const toggleEffect = (id: string, effectId: string | null) =>
    updateEffects(id, (list) => {
      if (effectId) return list.map((e) => (e.id === effectId ? { ...e, enabled: !e.enabled } : e));
      const anyOn = list.some((e) => e.enabled);
      return list.map((e) => ({ ...e, enabled: !anyOn }));
    });
  const removeEffect = (id: string, effectId: string) =>
    updateEffects(id, (list) => list.filter((e) => e.id !== effectId));
  const copyEffect = (id: string, effectId: string) => updateEffects(id, (list) => duplicateEffect(list, effectId));
  const openEffects = (id: string) => {
    setSelectedId(id);
    const el = activeDesign.elements.find((e) => e.id === id);
    if (el) openProperties("effects", el.type);
  };

  const groupSelected = () => {
    if (selectedIds.length === 0) return;
    groupSelection(selectedIds);
    openProperties("group", "group");
  };
  const ungroupSelected = () => ungroupSelection(selectedIds);

  const newPixelLayer = (): RasterElement | null => {
    const n = activeDesign.elements.filter((e) => e.type === "raster").length + 1;
    const id = addElement("raster", { name: `Layer ${n}` } as Partial<LabelElement>);
    if (!id) {
      notify("error", "This design has reached its layer limit.");
      return null;
    }
    const base = createElement("raster", activeDesign) as RasterElement;
    return { ...base, id, name: `Layer ${n}` };
  };

  const brush = ws.toolDefaults.brush;
  const setBrush = (patch: Partial<typeof brush>) => setToolDefaults("brush", patch);

  /** The pixel layer a stroke paints on: the selected one, or a new one. */
  const beginPaint = (erase: boolean): RasterElement | null => {
    if (selected?.type === "raster" && selectedCount === 1) {
      if (!isLayerShown(selected)) {
        notify("error", `"${selected.name}" is hidden — show it to paint on it.`);
        return null;
      }
      return selected;
    }
    if (erase) {
      notify("info", "Select a pixel layer to erase from.");
      return null;
    }
    const created = newPixelLayer();
    if (created) notify("info", `Painting on a new pixel layer, "${created.name}".`);
    return created;
  };

  const isLayerShown = (el: LabelElement) => {
    if (!el.visible) return false;
    const chain: string[] = [];
    let g = el.groupId;
    while (g && !chain.includes(g)) {
      chain.push(g);
      const grp = (activeDesign.groups ?? []).find((x) => x.id === g);
      if (grp && !grp.visible) return false;
      g = grp?.parentId;
    }
    return true;
  };

  const patchSelectedImage = (fn: (el: ImageElement) => Partial<ImageElement>) => {
    if (selected?.type !== "image") return;
    patchElement(selected.id, fn(selected) as Partial<LabelElement>);
  };

  const deleteSelection = () => {
    if (crop) setCrop(null);
    // Deleting a group takes its contents too; say how much is going.
    const count = expandSelection(selectedIds, layerState).length;
    if (selectedGroup && count > 1 && !window.confirm(`Delete "${selectedGroup.name}" and the ${count} layers in it?`)) {
      return;
    }
    deleteElements(selectedIds);
  };

  const editElement = (id: string) => {
    const el = activeDesign.elements.find((e) => e.id === id);
    if (!el) return;
    setSelectedId(id);
    const tab: CategoryId =
      el.type === "text" ? "text" : el.type === "number" ? "numbering" : el.type === "image" || el.type === "raster" ? "effects" : "shape";
    openProperties(tab, el.type);
    if (el.type === "text") setFocusContentNonce((n) => n + 1);
  };

  /* ---------------------------------------------------------------------
   * Menus
   * ------------------------------------------------------------------ */

  const cmd: MenuCommands = {
    newDesign: (preset: Preset) => {
      addDesign(preset.create());
      notify("info", `Added "${preset.label}".`);
    },
    openDesign: (id) => {
      if (!openIds.includes(id)) updateWs({ openDesignIds: [...openIds, id] });
      selectDesign(id);
    },
    closeTab,
    placeEmbedded: () => openPlaceDialog(null),
    importFile: () => importRef.current?.click(),
    exportAll: () => {
      download(exportJson("all"), "label-designs.json");
      notify("info", "Exported all designs.");
    },
    exportActive: () => {
      const safe = activeDesign.name.replace(/[^\w\- ]+/g, "").trim() || "label-design";
      download(exportJson("active"), `${safe}.json`);
      notify("info", `Exported "${activeDesign.name}".`);
    },
    duplicateDesign,
    deleteDesign: () => {
      if (state.designs.length <= 1) return;
      if (window.confirm(`Delete "${activeDesign.name}"? You can undo this with ${"Ctrl+Z"}.`)) {
        deleteDesign(activeDesign.id);
      }
    },
    print: () => void handlePrint(),

    undo,
    redo,
    duplicate: () => duplicateElements(selectedIds),
    deleteSelection,
    selectAll,
    deselect: () => setSelection([]),
    appearance: () => setDialog("appearance"),

    crop: () => selected && startCrop(selected.id),
    clearCrop: () => patchSelectedImage((el) => clearCrop(el)),
    effects: () => effectTarget && openEffects(effectTarget.id),
    addEffect: (kind) => addEffect(kind),
    applyEffectPreset: (key) => applyEffectPreset(key),
    clearEffects: () => effectTarget && updateEffects(effectTarget.id, () => []),
    flip: (axis) => patchSelectedImage((el) => (axis === "x" ? { flipX: !el.flipX } : { flipY: !el.flipY })),
    replaceImage: () => selected?.type === "image" && openPlaceDialog(selected.id),
    setFit: (fit) => patchSelectedImage(() => ({ fit })),

    addLayer: (type) => createLayer(type, null),
    newPixelLayer: () => void newPixelLayer(),
    group: groupSelected,
    ungroup: ungroupSelected,
    setShapeKind: (shapeKind) => {
      setToolDefaults("shape", { kind: shapeKind });
      setTool("shape");
    },
    arrange: (to) => arrangeElements(selectedIds, to),
    reorder: (direction) => (selected || selectedGroup) && reorderElement((selected ?? selectedGroup)!.id, direction),
    align: (a) => alignSelection(a),
    alignToLabel: (a) => alignSelection(a, "canvas"),
    distribute: distributeSelection,
    toggleVisible: () => (selected || selectedGroup) && toggleVisible((selected ?? selectedGroup)!.id),
    properties: (next) => openProperties(next),

    zoomIn: () => stepZoom(1),
    zoomOut: () => stepZoom(-1),
    fit: () => setZoom(0),
    actualSize: () => zoomTo(1),
    toggleGrid: () => setShowGrid((g) => !g),
    toggleSnap: () => setSnap((s) => !s),
    toggleEdges: () => updateWs((p) => ({ showLayerEdges: !p.showLayerEdges })),
    toggleFocus: () => updateWs((p) => ({ focusMode: !p.focusMode })),
    togglePanel,
    toggleBar: (key) => updateWs((p) => ({ [key]: !p[key] })),
    resetWorkspace,
    shortcuts: () => setDialog("shortcuts"),
    setTool,
  };

  const menuCtx: MenuContext = {
    groupSelected: !!selectedGroup,
    designs: state.designs,
    activeDesign,
    openIds,
    presets: PRESETS,
    selected,
    selectedCount,
    canUndo,
    canRedo,
    showGrid,
    snap,
    workspace: ws,
    tool,
    cmd,
  };

  const openContextMenu = (event: React.MouseEvent, items: ContextMenuState["items"], label: string) => {
    if (items.length === 0) return;
    setContextMenu({ x: event.clientX, y: event.clientY, items, label });
  };

  // The context menu reads the selection after onSelect has run, so build it
  // on the next render rather than from this render's (stale) closure.
  const [pendingMenu, setPendingMenu] = useState<{ x: number; y: number; target: "layer" | "canvas" } | null>(
    null
  );
  useEffect(() => {
    if (!pendingMenu) return;
    const items = pendingMenu.target === "layer" ? buildLayerMenu(menuCtx) : buildCanvasMenu(menuCtx);
    setPendingMenu(null);
    if (items.length) {
      setContextMenu({
        x: pendingMenu.x,
        y: pendingMenu.y,
        items,
        label: pendingMenu.target === "layer" ? "Layer actions" : "Canvas actions",
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMenu]);

  /* ---------------------------------------------------------------------
   * Keyboard
   * ------------------------------------------------------------------ */

  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  keyRef.current = (event: KeyboardEvent) => {
    if (dialog) return; // the dialog owns the keyboard
    if (isTypingTarget(event.target)) {
      // Esc leaves a field, so tool shortcuts work again straight away.
      if (event.key === "Escape") (event.target as HTMLElement).blur();
      return;
    }
    if ((event.target as HTMLElement | null)?.closest?.('[role="menu"]')) return;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key;

    if (mod) {
      const lower = key.toLowerCase();
      const handled = (() => {
        if (lower === "z" && event.shiftKey) return redo(), true;
        if (lower === "z") return undo(), true;
        if (lower === "y") return redo(), true;
        if (lower === "p") return void handlePrint(), true;
        if (lower === "o") return importRef.current?.click(), true;
        if (lower === "a") return selectAll(), true;
        if (lower === "d") return selectedCount > 0 && duplicateElements(selectedIds), true;
        if (lower === "g" && event.shiftKey) return ungroupSelected(), true;
        if (lower === "g") return groupSelected(), true;
        if (key === "0") return setZoom(0), true;
        if (key === "1") return zoomTo(1), true;
        if (key === "=" || key === "+") return stepZoom(1), true;
        if (key === "-") return stepZoom(-1), true;
        if (event.code === "BracketRight" && selectedCount > 0) {
          if (event.shiftKey) arrangeElements(selectedIds, "front");
          else if (selected) reorderElement(selected.id, 1);
          return true;
        }
        if (event.code === "BracketLeft" && selectedCount > 0) {
          if (event.shiftKey) arrangeElements(selectedIds, "back");
          else if (selected) reorderElement(selected.id, -1);
          return true;
        }
        return false;
      })();
      if (handled) event.preventDefault();
      return;
    }
    if (event.altKey) return;

    if (key === "Escape") {
      if (contextMenu) setContextMenu(null);
      else if (crop) setCrop(null);
      else setSelection([]);
      return;
    }
    if (key === "Enter" && crop) {
      event.preventDefault();
      commitCrop();
      return;
    }
    if ((key === "Delete" || key === "Backspace") && selectedCount > 0) {
      event.preventDefault();
      deleteSelection();
      return;
    }
    if (key === "?") return setDialog("shortcuts");
    // Brush size and hardness: [ and ], with Shift for hardness.
    const bracket =
      event.code === "BracketRight" || key === "]" || key === "}"
        ? 1
        : event.code === "BracketLeft" || key === "[" || key === "{"
          ? -1
          : 0;
    if ((tool === "brush" || tool === "eraser") && bracket) {
      const dir = bracket as 1 | -1;
      if (event.shiftKey) setBrush({ hardness: Math.min(Math.max(brush.hardness + dir * 25, 0), 100) });
      else setBrush({ size: stepBrushSize(brush.size, dir) });
      return;
    }
    if (event.repeat) return;
    // Shift+U cycles the Shape tool through its shapes.
    if (event.shiftKey && key.toLowerCase() === "u") {
      const next = nextShape(ws.toolDefaults.shape.kind);
      setToolDefaults("shape", { kind: next });
      setTool("shape");
      notify("info", `Shape tool: ${shapeLabel(next)}`);
      return;
    }
    if (key.toLowerCase() === "x" && !event.shiftKey) {
      setBrush({ color: brush.secondaryColor, secondaryColor: brush.color });
      return;
    }
    if (key.toLowerCase() === "d" && !event.shiftKey) {
      setBrush({ color: "#000000", secondaryColor: "#ffffff" });
      return;
    }
    const toolKey = toolForKey(key);
    if (toolKey) {
      setTool(toolKey);
      return;
    }
    if (key === "g") setShowGrid((g) => !g);
    else if (key === "f") updateWs((p) => ({ focusMode: !p.focusMode }));
    else if (key === "0") setZoom(0);
    else if (key === "+" || key === "=") stepZoom(1);
    else if (key === "-") stepZoom(-1);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Hold Space for a temporary Hand tool, as in most design apps.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== "Space" || isTypingTarget(e.target)) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && !viewportRef.current?.contains(t)) return;
      e.preventDefault();
      if (!e.repeat) setSpaceHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceHeld(false);
    };
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Paste an image straight onto the label.
  const pasteRef = useRef<(e: ClipboardEvent) => void>(() => {});
  pasteRef.current = (event: ClipboardEvent) => {
    if (isTypingTarget(event.target)) return;
    const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
    if (files.length === 0) return;
    event.preventDefault();
    void placeFiles(files);
  };
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => pasteRef.current(e);
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  // Missing fonts are easy to overlook, so surface the Fonts panel when one
  // appears. It stays collapsible afterwards.
  const hasMissingFonts = missingFonts.length > 0;
  useEffect(() => {
    if (hasMissingFonts) patchPanel("fonts", { collapsed: false });
  }, [hasMissingFonts, patchPanel]);

  /* ---------------------------------------------------------------------
   * Panels
   * ------------------------------------------------------------------ */

  const fontOptions = useMemo(
    () => [
      ...(activeDesign.fonts ?? []).map((font) => ({
        label: `${font.family} (uploaded)`,
        value: `"${font.family}", sans-serif`,
      })),
      ...FONT_OPTIONS,
    ],
    [activeDesign.fonts]
  );

  const alignProps = {
    target: ws.alignTarget,
    onTargetChange: (alignTarget: "selection" | "canvas") => updateWs({ alignTarget }),
    onAlign: (a: Alignment) => alignSelection(a),
    onDistribute: distributeSelection,
  };

  const runEnd = lastNumber(state.print);

  const panelBody = (id: PanelId): PanelChrome => {
    const p = ws.panels[id];
    switch (id) {
      case "layers":
        return {
          id,
          collapsed: p.collapsed,
          content: (
            <LayerList
              elements={activeDesign.elements}
              groups={activeDesign.groups ?? []}
              selectedIds={selectedIds}
              onSelectIds={setSelection}
              onToggleVisible={toggleVisible}
              onToggleCollapse={(gid) => {
                const g = (activeDesign.groups ?? []).find((x) => x.id === gid);
                if (g) patchGroup(gid, { collapsed: !g.collapsed });
              }}
              onRename={(eid, name) =>
                (activeDesign.groups ?? []).some((g) => g.id === eid)
                  ? patchGroup(eid, { name })
                  : patchElement(eid, { name })
              }
              onMove={moveLayers}
              onContextMenu={(e, eid) => {
                e.preventDefault();
                if (!selectedIds.includes(eid)) setSelection([eid]);
                setPendingMenu({ x: e.clientX, y: e.clientY, target: "layer" });
              }}
              onGroup={groupSelected}
              onNewPixelLayer={() => void newPixelLayer()}
              onDelete={deleteSelection}
              onEffectToggle={toggleEffect}
              onEffectDuplicate={copyEffect}
              onEffectDelete={removeEffect}
              onEffectOpen={openEffects}
              onEffectContextMenu={(e, eid, fxId) => {
                const el = activeDesign.elements.find((x) => x.id === eid);
                const fx = el && supportsEffects(el) ? el.effects?.find((f) => f.id === fxId) : undefined;
                openContextMenu(
                  e,
                  buildEffectMenu(
                    {
                      toggle: () => toggleEffect(eid, fxId),
                      duplicate: () => copyEffect(eid, fxId),
                      remove: () => removeEffect(eid, fxId),
                      open: () => openEffects(eid),
                    },
                    fx?.enabled ?? true
                  ),
                  "Effect actions"
                );
              }}
            />
          ),
        };
      case "properties":
        return {
          id,
          collapsed: p.collapsed,
          subtitle:
            selectedCount > 1 ? `${selectedCount} items` : selectedGroup ? "Group" : selected ? undefined : "Label",
          content: (
            <Properties
              design={activeDesign}
              selected={selected}
              selectedCount={selectedCount}
              category={category}
              onCategoryChange={(c) => setCategory(c)}
              onDesignChange={patchDesign}
              onElementChange={patchElement}
              onDeleteElement={deleteElement}
              onDuplicateElement={duplicateElement}
              onReorderElement={reorderElement}
              onArrange={(to) => arrangeElements(selectedIds, to)}
              align={alignProps}
              onReplaceImage={(eid) => openPlaceDialog(eid)}
              onStartCrop={startCrop}
              onClearCrop={(eid) => {
                const el = activeDesign.elements.find((e) => e.id === eid);
                if (el?.type === "image") patchElement(eid, clearCrop(el) as Partial<LabelElement>);
              }}
              focusContentNonce={focusContentNonce}
              selectedGroup={selectedGroup}
              groupMemberCount={selectedGroup ? membersOf(selectedGroup.id, layerState).length : 0}
              onGroupChange={patchGroup}
              onUngroup={(gid) => ungroupSelection([gid])}
              onDeleteGroup={() => deleteSelection()}
              onDuplicateGroup={(gid) => duplicateElements([gid])}
              effects={{
                onAdd: (k) => selected && addEffect(k, selected.id),
                onPreset: (key) => selected && applyEffectPreset(key, selected.id),
                onPatch: (fxId, patch) => selected && patchEffect(selected.id, fxId, patch),
                onToggle: (fxId) => selected && toggleEffect(selected.id, fxId),
                onDuplicate: (fxId) => selected && copyEffect(selected.id, fxId),
                onRemove: (fxId) => selected && removeEffect(selected.id, fxId),
                onClear: () => selected && updateEffects(selected.id, () => []),
              }}
            />
          ),
        };
      case "brush":
        return {
          id,
          collapsed: p.collapsed,
          content: <BrushPanel brush={brush} onChange={setBrush} />,
        };
      case "fonts":
        return {
          id,
          collapsed: p.collapsed,
          subtitle: hasMissingFonts ? `${missingFonts.length} missing` : undefined,
          content: (
            <div className="flex flex-col gap-3 p-3.5">
              <FontWarnings warnings={missingFonts} />
              <FontManager
                fonts={activeDesign.fonts ?? []}
                onAdd={addFont}
                onRemove={removeFont}
                onError={(message) => notify("error", message)}
              />
            </div>
          ),
        };
      case "print":
        return {
          id,
          collapsed: p.collapsed,
          content: (
            <div className="flex flex-col gap-3 p-3.5">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Start at"
                  value={state.print.startNumber}
                  min={0}
                  max={10 ** 9}
                  step={1}
                  integer
                  allowMin
                  onChange={(startNumber) => setPrint({ startNumber })}
                />
                <NumberInput
                  label="How many"
                  value={state.print.count}
                  min={1}
                  max={MAX_COUNT}
                  step={1}
                  integer
                  allowMin
                  onChange={(count) => setPrint({ count })}
                />
              </div>
              <NumberInput
                label="Gap between labels"
                suffix="mm"
                value={state.print.gap}
                min={0}
                max={200}
                step={0.5}
                allowMin
                onChange={(gap) => setPrint({ gap })}
              />
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
                <p className="text-[11px] text-[var(--text-dim)]">
                  Numbers{" "}
                  <strong className="font-semibold text-[var(--text)]">{state.print.startNumber}</strong> →{" "}
                  <strong className="font-semibold text-[var(--text)]">{runEnd}</strong>
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-faint)]">
                  Match your browser's paper size and margins to your stock.
                </p>
              </div>
            </div>
          ),
        };
    }
  };

  const renderDock = (side: DockSide) => {
    if (ws.focusMode) return null;
    const ids = ws.panelOrder.filter((id) => ws.panels[id].dock === side && ws.panels[id].visible);
    if (ids.length === 0) return null;
    return (
      <Dock
        side={side}
        width={ws.dockWidth[side]}
        onResize={(width) => updateWs((p) => ({ dockWidth: { ...p.dockWidth, [side]: width } }))}
      >
        {ids.map((id, i) => (
          <Panel
            key={id}
            panel={panelBody(id)}
            side={side}
            canMoveUp={i > 0}
            canMoveDown={i < ids.length - 1}
            onToggleCollapse={() => patchPanel(id, { collapsed: !ws.panels[id].collapsed })}
            onClose={() => patchPanel(id, { visible: false })}
            onMoveDock={() => patchPanel(id, { dock: side === "left" ? "right" : "left" })}
            onMove={(direction) => movePanel(id, direction)}
          />
        ))}
      </Dock>
    );
  };

  const hint = crop
    ? "Drag the handles to crop · drag inside to reposition · Enter applies · Esc cancels"
    : toolById(effectiveTool).hint;

  return (
    <>
      {/* ---------- Screen UI (hidden when printing) ---------- */}
      <div className="screen-only flex h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
        {/* Hidden inputs. Import comes first: it is the long-standing entry point. */}
        <input
          ref={importRef}
          type="file"
          aria-label="Import designs or an image as a new design"
          accept="application/json,.json,image/*"
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleImport(file);
            event.target.value = "";
          }}
        />
        <input
          ref={placeRef}
          type="file"
          aria-label="Choose images to place"
          accept="image/*"
          multiple
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            const replaceId = replaceTarget.current;
            replaceTarget.current = null;
            if (files.length === 0) return;
            if (replaceId) void replaceImageSource(replaceId, files[0]);
            else void placeFiles(files);
          }}
        />

        {/* ---------- Menu bar ---------- */}
        <header className="relative z-30 flex h-9 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--surface)] px-2">
          <span
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-[5px] bg-[var(--accent)] text-[10px] font-bold text-[var(--accent-text)]"
          >
            #
          </span>
          <h1 className="sr-only">Label Studio</h1>
          <MenuBar menus={buildMenuBar(menuCtx)} />

          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              title="Undo (Ctrl+Z)"
              aria-label="Undo"
              disabled={!canUndo}
              onClick={undo}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-30"
            >
              <Icon name="undo" />
            </button>
            <button
              type="button"
              title="Redo (Ctrl+Shift+Z)"
              aria-label="Redo"
              disabled={!canRedo}
              onClick={redo}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)] disabled:opacity-30"
            >
              <Icon name="redo" />
            </button>
            <span aria-hidden="true" className="mx-1 h-5 w-px bg-[var(--border)]" />
            <button
              type="button"
              title={theme.prefs.mode === "dark" ? "Switch to light" : "Switch to dark"}
              aria-label={theme.prefs.mode === "dark" ? "Switch to light" : "Switch to dark"}
              onClick={theme.toggleMode}
              className="flex h-7 w-7 items-center justify-center rounded-[5px] text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            >
              {theme.prefs.mode === "dark" ? "☀" : "☾"}
            </button>
            <Button variant="ghost" onClick={() => setDialog("appearance")} title="Appearance & workspace">
              Appearance
            </Button>
            <Button variant="primary" disabled={printing} onClick={() => void handlePrint()}>
              {printing ? "Preparing…" : `Print ${state.print.count}`}
            </Button>
          </div>
        </header>

        {ws.showOptionsBar && (
          <OptionsBar
            tool={tool}
            selected={selected}
            selectedCount={alignBoxes.length}
            fontOptions={fontOptions}
            autoSelect={autoSelect}
            onAutoSelect={setAutoSelect}
            onShowBrushPanel={() => revealPanel("brush")}
            toolDefaults={ws.toolDefaults}
            onToolDefaults={setToolDefaults}
            onElementChange={patchElement}
            onOpenProperties={(c) => openProperties(c)}
            align={alignProps}
            zoom={{
              scale,
              isFit: zoom === 0,
              zoomOut: zoomOutMode,
              onZoomOutChange: setZoomOutMode,
              onFit: () => setZoom(0),
              onActual: () => zoomTo(1),
              onStep: (d) => stepZoom(d),
            }}
            crop={{
              session: crop,
              ratioKey: cropRatioKey,
              onRatio: setCropRatio,
              onApply: commitCrop,
              onCancel: () => setCrop(null),
              onReset: () => {
                setCropRatioKey("free");
                if (crop) setCrop({ ...crop, ratio: null, crop: { ...NO_CROP } });
              },
              onClear: () => patchSelectedImage((el) => clearCrop(el)),
            }}
            view={{ grid: showGrid, snap, onGrid: setShowGrid, onSnap: setSnap }}
          />
        )}

        <div className="flex min-h-0 flex-1">
          {ws.showToolbar && (
            <Toolbar
              tool={tool}
              shapeKind={ws.toolDefaults.shape.kind}
              colors={{
                foreground: brush.color,
                background: brush.secondaryColor,
                onForeground: (color) => setBrush({ color }),
                onBackground: (secondaryColor) => setBrush({ secondaryColor }),
                onSwap: () => setBrush({ color: brush.secondaryColor, secondaryColor: brush.color }),
                onReset: () => setBrush({ color: "#000000", secondaryColor: "#ffffff" }),
              }}
              onSelect={setTool}
              onContextMenu={(e, t) =>
                openContextMenu(
                  e,
                  // Right-clicking the Shape tool lists every shape it can draw.
                  t === "shape"
                    ? [
                        ...shapeItems(menuCtx, ws.toolDefaults.shape.kind),
                        { kind: "separator" as const },
                        { label: "Reset tool defaults", onSelect: () => setToolDefaults("shape", DEFAULT_TOOL_DEFAULTS.shape) },
                      ]
                    : buildToolMenu(menuCtx, t, () =>
                        t === "text" || t === "number" || t === "brush"
                          ? setToolDefaults(t, DEFAULT_TOOL_DEFAULTS[t])
                          : undefined
                      ),
                  t === "shape" ? "Shapes" : "Tool actions"
                )
              }
            />
          )}

          {renderDock("left")}

          {/* ---------- Canvas ---------- */}
          <main className="flex min-w-0 flex-1 flex-col">
            {ws.showTabs && (
              <DocumentTabs
                tabs={openTabs}
                activeId={activeDesign.id}
                onSelect={selectDesign}
                onClose={closeTab}
                newMenu={newDesignItems(menuCtx)}
              />
            )}
            <div className="min-h-0 flex-1">
              <Canvas
                design={activeDesign}
                previewNumber={state.print.startNumber}
                selectedIds={selectedIds}
                scale={scale}
                showGrid={showGrid}
                snap={snap}
                fontsReady={fontsReady}
                tool={effectiveTool}
                showLayerEdges={ws.showLayerEdges}
                backdrop={ws.canvasBackdrop}
                viewportRef={viewportRef}
                crop={crop}
                onCropChange={(next) => crop && setCrop({ ...crop, crop: next })}
                onSelect={selectElement}
                onSetSelection={setSelection}
                onPatch={patchElements}
                onCreate={(type, rect, at) => createLayer(type, rect, at)}
                onEditElement={editElement}
                onStartCrop={startCrop}
                onZoomStep={(direction, x, y) => stepZoom(zoomOutMode ? (-direction as 1 | -1) : direction, x, y)}
                onZoomBy={zoomBy}
                onContextMenu={(e, id) => setPendingMenu({ x: e.clientX, y: e.clientY, target: id ? "layer" : "canvas" })}
                onDropFiles={(files, at, targetId) => void placeFiles(files, at, targetId)}
                autoSelect={autoSelect}
                brush={brush}
                onBeginPaint={beginPaint}
                onCommitPaint={(eid, src) => patchElement(eid, { src } as Partial<LabelElement>)}
              />
            </div>
          </main>

          {renderDock("right")}
        </div>

        {ws.showStatusBar && (
          <StatusBar
            hint={hint}
            unit={activeDesign.unit}
            selected={selected}
            selectedCount={selectedCount}
            scale={scale}
            previewNumber={state.print.startNumber}
            missingFonts={missingFonts.length}
            onShowFonts={() => revealPanel("fonts")}
          />
        )}

        {status && (
          <div
            role="status"
            className={`pointer-events-none fixed bottom-10 left-1/2 z-[80] -translate-x-1/2 rounded-[var(--radius)] border px-3 py-2 text-[11.5px] shadow-2xl ${
              status.tone === "error"
                ? "border-[var(--danger)] bg-[var(--surface)] text-[var(--danger)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
            }`}
          >
            {status.message}
          </div>
        )}

        {contextMenu && <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />}

        {dialog === "appearance" && (
          <AppearanceDialog
            theme={theme.prefs}
            onMode={theme.setMode}
            onAccent={theme.setAccent}
            onCustomAccent={theme.setCustomAccent}
            workspace={ws}
            onWorkspace={updateWs}
            onTogglePanel={togglePanel}
            onReset={resetWorkspace}
            onClose={() => setDialog(null)}
          />
        )}
        {dialog === "shortcuts" && <ShortcutsDialog onClose={() => setDialog(null)} />}
      </div>

      {/* ---------- Print output ---------- */}
      <PrintSheet design={activeDesign} print={state.print} fontsReady={fontsReady} />
    </>
  );
}

export default App;
