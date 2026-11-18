import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImageCrop, ImageElement, LabelDesign, LabelElement, RasterElement } from "../types";
import Label from "./Label";
import { PX_PER_MM, round } from "../lib/units";
import type { ToolId } from "../lib/tools";
import type { SelectMode } from "../lib/useDesigns";
import type { CanvasBackdrop } from "../lib/workspace";
import type { Rect } from "../lib/imageEdit";
import { cropFromRect, cropRect, fullFrame, imageContentStyle } from "../lib/imageEdit";
import { setPointerMm } from "../lib/pointerStore";
import {
  intersects,
  MIN_ELEMENT_MM,
  normalizeRect,
  resizeBox,
  resizeCropRect,
} from "../lib/geometry";
import type { LayerState } from "../lib/layers";
import { expandSelection, isEffectivelyVisible, outermostGroupOf } from "../lib/layers";
import { boundsOf } from "../lib/align";
import type { BrushSettings } from "../lib/brush";
import { BrushStroke } from "../lib/brush";
import { decodeRaster, pxPerMm, rasterHit, RASTER_DPI } from "../lib/raster";
import { effectsToCss } from "../lib/effects";

export interface CropSession {
  id: string;
  /** The draft crop, relative to the image's full frame. */
  crop: ImageCrop;
  /** Locked width:height, or null for a free crop. */
  ratio: number | null;
}

export type CreatableType = "text" | "number" | "shape";

interface CanvasProps {
  design: LabelDesign;
  previewNumber: number;
  selectedIds: string[];
  scale: number;
  showGrid: boolean;
  snap: boolean;
  /** False while uploaded fonts are still decoding. */
  fontsReady: boolean;
  /** The effective tool — Hand while Space is held. */
  tool: ToolId;
  showLayerEdges: boolean;
  backdrop: CanvasBackdrop;
  viewportRef: React.RefObject<HTMLDivElement>;
  crop: CropSession | null;
  onCropChange: (crop: ImageCrop) => void;
  onSelect: (id: string, mode: SelectMode) => void;
  onSetSelection: (ids: string[]) => void;
  /** Patch layers; calls sharing `key` within a gesture form one undo step. */
  onPatch: (patches: Record<string, Partial<LabelElement>>, key: string) => void;
  /** A draw tool finished: `rect` is the drawn box, or null for a plain click. */
  onCreate: (type: CreatableType, rect: Rect | null, at: { x: number; y: number }) => void;
  /** Double-click, or a text-tool click on existing text. */
  onEditElement: (id: string) => void;
  onStartCrop: (id: string) => void;
  onZoomStep: (direction: 1 | -1, clientX: number, clientY: number) => void;
  onZoomBy: (factor: number, clientX: number, clientY: number) => void;
  onContextMenu: (event: React.MouseEvent, id: string | null) => void;
  onDropFiles: (files: File[], at: { x: number; y: number }, targetId: string | null) => void;
  /** Move tool: clicking a grouped layer selects the layer, or its whole group. */
  autoSelect: "layer" | "group";
  brush: BrushSettings;
  /** Find (or create) the pixel layer a stroke paints on; null cancels. */
  onBeginPaint: (erase: boolean) => RasterElement | null;
  /** A finished stroke: the layer's new PNG. */
  onCommitPaint: (id: string, src: string) => void;
}

interface PaintSession {
  id: string;
  rect: Rect;
  pxWidth: number;
  pxHeight: number;
}

/** hx/hy: which edges a handle moves. -1 = left/top, 1 = right/bottom, 0 = neither. */
type Handle = { key: string; hx: -1 | 0 | 1; hy: -1 | 0 | 1; cursor: string };

/** Four corners plus four edge midpoints, so a box can stretch along either axis. */
const HANDLES: Handle[] = [
  { key: "nw", hx: -1, hy: -1, cursor: "nwse-resize" },
  { key: "n", hx: 0, hy: -1, cursor: "ns-resize" },
  { key: "ne", hx: 1, hy: -1, cursor: "nesw-resize" },
  { key: "e", hx: 1, hy: 0, cursor: "ew-resize" },
  { key: "se", hx: 1, hy: 1, cursor: "nwse-resize" },
  { key: "s", hx: 0, hy: 1, cursor: "ns-resize" },
  { key: "sw", hx: -1, hy: 1, cursor: "nesw-resize" },
  { key: "w", hx: -1, hy: 0, cursor: "ew-resize" },
];

const handlePosition = (h: Handle): React.CSSProperties => ({
  left: h.hx === -1 ? 0 : h.hx === 1 ? "100%" : "50%",
  top: h.hy === -1 ? 0 : h.hy === 1 ? "100%" : "50%",
});

/** Pointer travel, in screen px, before a press becomes a drag. */
const DRAG_THRESHOLD_PX = 3;

const SNAP_MM = 1;
const snapTo = (value: number, on: boolean) =>
  on ? Math.round(value / SNAP_MM) * SNAP_MM : round(value, 2);

/** Follow a pointer until release, on window so fast drags never escape. */
const track = (onMove: (e: PointerEvent) => void, onEnd: (e: PointerEvent) => void) => {
  const up = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", up);
    onEnd(e);
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", up);
};

const PAINT_TOOLS: ToolId[] = ["brush", "eraser"];

const TOOL_CURSOR: Partial<Record<ToolId, string>> = {
  brush: "none",
  eraser: "none",
  hand: "grab",
  zoom: "zoom-in",
  text: "text",
  number: "crosshair",
  shape: "crosshair",
};

const CREATE_TOOLS: Partial<Record<ToolId, CreatableType>> = {
  text: "text",
  number: "number",
  shape: "shape",
};

/**
 * The design surface: the real label render plus a layer of hit-boxes, one
 * per element, and whatever the active tool draws on top.
 */
const Canvas = ({
  design,
  previewNumber,
  selectedIds,
  scale,
  showGrid,
  snap,
  fontsReady,
  tool,
  showLayerEdges,
  backdrop,
  viewportRef,
  crop,
  onCropChange,
  onSelect,
  onSetSelection,
  onPatch,
  onCreate,
  onEditElement,
  onStartCrop,
  onZoomStep,
  onZoomBy,
  onContextMenu,
  onDropFiles,
  autoSelect,
  brush,
  onBeginPaint,
  onCommitPaint,
}: CanvasProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [drawing, setDrawing] = useState<Rect | null>(null);
  const [panning, setPanning] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [paint, setPaint] = useState<PaintSession | null>(null);
  const paintCanvasRef = useRef<HTMLCanvasElement>(null);
  const brushCursorRef = useRef<HTMLDivElement>(null);
  /** Where the last stroke ended, per layer, for Shift-click straight lines. */
  const lastPaintPoint = useRef<{ id: string; x: number; y: number } | null>(null);

  const layerState: LayerState = useMemo(
    () => ({ elements: design.elements, groups: design.groups ?? [] }),
    [design.elements, design.groups]
  );
  /** Every element the selection covers; a selected group means its members. */
  const expandedIds = useMemo(() => expandSelection(selectedIds, layerState), [selectedIds, layerState]);

  // Latest props for window-level handlers that outlive a render.
  const latest = useRef({ design, selectedIds, snap, crop, expandedIds });
  latest.current = { design, selectedIds, snap, crop, expandedIds };

  const pointToMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      // A coordinate-less event must never write NaN into a design.
      if (!rect || !Number.isFinite(clientX) || !Number.isFinite(clientY)) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / (PX_PER_MM * scale),
        y: (clientY - rect.top) / (PX_PER_MM * scale),
      };
    },
    [scale]
  );

  /* ---------- wheel: Alt (or Ctrl / pinch) zooms about the cursor ---------- */
  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      if (!(event.altKey || event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const lines = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1;
      const delta = event.deltaY * lines;
      // Pinch gestures arrive as ctrl+wheel with small deltas; mouse wheels
      // send ~100 per notch. Scale so both feel natural.
      const sensitivity = event.ctrlKey && Math.abs(delta) < 50 ? 0.01 : 0.0018;
      onZoomBy(Math.exp(-delta * sensitivity), event.clientX, event.clientY);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [viewportRef, onZoomBy]);

  /* ---------- arrow keys nudge the selection ---------- */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const { expandedIds: ids, design: d } = latest.current;
      if (ids.length === 0 || latest.current.crop) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      if (target?.closest('[role="menu"]')) return;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = deltas[event.key];
      if (!delta || event.ctrlKey || event.metaKey || event.altKey) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.1 : 1;
      const patches: Record<string, Partial<LabelElement>> = {};
      for (const el of d.elements) {
        if (!ids.includes(el.id)) continue;
        patches[el.id] = {
          x: round(el.x + delta[0] * step, 2),
          y: round(el.y + delta[1] * step, 2),
        };
      }
      onPatch(patches, "nudge");
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onPatch]);

  /* ---------- gestures ---------- */

  const startMove = (event: React.PointerEvent, element: LabelElement) => {
    const mode: SelectMode = event.shiftKey ? "add" : event.ctrlKey || event.metaKey ? "toggle" : "replace";
    // With auto-select set to Group, a click picks the layer's outermost group.
    const target =
      autoSelect === "group" ? outermostGroupOf(element.id, layerState) ?? element.id : element.id;
    const covered = expandedIds.includes(element.id);
    const already = selectedIds.includes(target);
    let selection: string[];
    if (mode === "replace") {
      // Clicking anything already covered (say, a member of a selected group)
      // drags the whole selection.
      selection = covered ? selectedIds : [target];
      if (!covered) onSelect(target, "replace");
    } else {
      onSelect(target, mode);
      selection =
        mode === "toggle" && already
          ? selectedIds.filter((id) => id !== target)
          : [...selectedIds.filter((id) => id !== target), target];
    }
    const ids = expandSelection(selection, layerState);
    if (!ids.includes(element.id)) return;

    const origins = new Map(
      design.elements.filter((e) => ids.includes(e.id)).map((e) => [e.id, { x: e.x, y: e.y }])
    );
    const start = pointToMm(event.clientX, event.clientY);
    const startClient = { x: event.clientX, y: event.clientY };
    const primary = origins.get(element.id) ?? { x: element.x, y: element.y };
    const key = `drag:${Date.now()}`;
    let moved = false;

    track(
      (e) => {
        if (
          !moved &&
          Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) < DRAG_THRESHOLD_PX
        ) {
          return;
        }
        if (!moved) setDragging(element.id);
        moved = true;
        const point = pointToMm(e.clientX, e.clientY);
        let dx = point.x - start.x;
        let dy = point.y - start.y;
        // Shift mid-drag constrains to the dominant axis.
        if (e.shiftKey) {
          if (Math.abs(dx) > Math.abs(dy)) dy = 0;
          else dx = 0;
        }
        // Snap the grabbed layer and carry the rest with it unchanged.
        const sdx = snapTo(primary.x + dx, latest.current.snap) - primary.x;
        const sdy = snapTo(primary.y + dy, latest.current.snap) - primary.y;
        const patches: Record<string, Partial<LabelElement>> = {};
        origins.forEach((o, id) => {
          patches[id] = { x: round(o.x + sdx, 2), y: round(o.y + sdy, 2) };
        });
        onPatch(patches, key);
      },
      () => {
        setDragging(null);
        // A plain click on one layer of a multi-selection narrows to it.
        if (!moved && mode === "replace" && already && selectedIds.length > 1) {
          onSelect(target, "replace");
        }
      }
    );
  };

  const startResize = (event: React.PointerEvent, element: LabelElement, handle: Handle) => {
    event.stopPropagation();
    event.preventDefault();
    const start = pointToMm(event.clientX, event.clientY);
    const origin: Rect = { x: element.x, y: element.y, width: element.width, height: element.height };
    const corner = handle.hx !== 0 && handle.hy !== 0;
    const key = `resize:${Date.now()}`;
    track(
      (e) => {
        const point = pointToMm(e.clientX, e.clientY);
        // Images keep their proportions from a corner by default; Shift
        // flips that, for every layer type.
        const keepAspect = (element.type === "image" && corner) !== e.shiftKey;
        const box = resizeBox(origin, handle.hx, handle.hy, point.x - start.x, point.y - start.y, {
          keepAspect,
          fromCenter: e.altKey,
        });
        const s = latest.current.snap;
        onPatch(
          {
            [element.id]: {
              x: snapTo(box.x, s),
              y: snapTo(box.y, s),
              width: Math.max(MIN_ELEMENT_MM, snapTo(box.width, s)),
              height: Math.max(MIN_ELEMENT_MM, snapTo(box.height, s)),
            },
          },
          key
        );
      },
      () => {}
    );
  };

  /** Scale every selected layer together from the selection box's handles. */
  const startSelectionResize = (event: React.PointerEvent, handle: Handle) => {
    event.stopPropagation();
    event.preventDefault();
    const members = design.elements.filter((e) => expandedIds.includes(e.id));
    const box = boundsOf(members);
    if (!box || box.width <= 0 || box.height <= 0) return;
    const start = pointToMm(event.clientX, event.clientY);
    const key = `scale:${Date.now()}`;
    const corner = handle.hx !== 0 && handle.hy !== 0;
    track(
      (e) => {
        const point = pointToMm(e.clientX, e.clientY);
        // Corners keep proportions by default for a group; Shift frees them.
        const next = resizeBox(box, handle.hx, handle.hy, point.x - start.x, point.y - start.y, {
          keepAspect: corner !== e.shiftKey,
          fromCenter: e.altKey,
        });
        const sx = next.width / box.width;
        const sy = next.height / box.height;
        const patches: Record<string, Partial<LabelElement>> = {};
        for (const m of members) {
          patches[m.id] = {
            x: round(next.x + (m.x - box.x) * sx, 3),
            y: round(next.y + (m.y - box.y) * sy, 3),
            width: Math.max(MIN_ELEMENT_MM / 10, round(m.width * sx, 3)),
            height: Math.max(MIN_ELEMENT_MM / 10, round(m.height * sy, 3)),
          };
        }
        onPatch(patches, key);
      },
      () => {}
    );
  };

  /* ---------- painting ---------- */

  /** Topmost visible pixel layer with paint under a point, above `belowIndex`. */
  const rasterAt = (point: { x: number; y: number }, belowIndex = -1): RasterElement | null => {
    for (let i = design.elements.length - 1; i > belowIndex; i -= 1) {
      const el = design.elements[i];
      if (el.type === "raster" && isEffectivelyVisible(el, design.groups) && rasterHit(el, point.x, point.y)) return el;
    }
    return null;
  };

  const startPaint = async (event: React.PointerEvent, erase: boolean) => {
    event.preventDefault();
    const target = onBeginPaint(erase);
    if (!target) return;
    const rect = { x: target.x, y: target.y, width: target.width, height: target.height };
    const scaleX = target.pxWidth / target.width;
    const scaleY = target.pxHeight / target.height;
    const toPx = (e: { clientX: number; clientY: number; pressure?: number; pointerType?: string }) => {
      const p = pointToMm(e.clientX, e.clientY);
      // Mouse pressure is a constant 0.5; treat it as full pressure.
      const pressure = e.pointerType === "pen" && e.pressure ? e.pressure : 1;
      return { x: (p.x - rect.x) * scaleX, y: (p.y - rect.y) * scaleY, pressure };
    };
    const settings = event.shiftKey ? { ...brush, smoothing: 0 } : brush;
    const stroke = new BrushStroke(target.pxWidth, target.pxHeight, settings, erase);
    const first = toPx(event);
    // Shift-click: a straight line from where the last stroke ended.
    const last = lastPaintPoint.current;
    if (event.shiftKey && last && last.id === target.id) {
      stroke.addPoint({ x: last.x, y: last.y, pressure: 1 });
    }
    stroke.addPoint(first);
    let latestPoint = first;

    setPaint({ id: target.id, rect, pxWidth: target.pxWidth, pxHeight: target.pxHeight });
    const base = target.src ? (await decodeRaster(target.src))?.image ?? null : null;

    let frame = 0;
    const draw = () => {
      frame = 0;
      const canvas = paintCanvasRef.current;
      if (canvas && stroke.dirty) stroke.render(canvas, base);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(draw);
    };
    stroke.dirty = true;
    schedule();
    const airbrush = settings.airbrush ? window.setInterval(() => (stroke.tick(), schedule()), 40) : 0;

    track(
      (e) => {
        latestPoint = toPx(e);
        stroke.addPoint(latestPoint);
        schedule();
      },
      () => {
        window.clearInterval(airbrush);
        if (frame) cancelAnimationFrame(frame);
        const canvas = paintCanvasRef.current;
        let src = "";
        if (canvas) {
          stroke.render(canvas, base);
          try {
            // Not every environment returns a string here (jsdom gives null).
            const out: unknown = canvas.toDataURL("image/png");
            src = typeof out === "string" ? out : "";
          } catch {
            src = "";
          }
        }
        lastPaintPoint.current = { id: target.id, x: latestPoint.x, y: latestPoint.y };
        if (src.startsWith("data:image/png")) {
          onCommitPaint(target.id, src);
          // Keep the live canvas up until the new pixels have decoded, so
          // the layer never flickers back to its old state.
          void decodeRaster(src).then(() => setPaint(null));
        } else {
          setPaint(null);
        }
      }
    );
  };

  /** Keep the brush outline under the pointer without re-rendering. */
  const moveBrushCursor = (event: React.PointerEvent) => {
    const node = brushCursorRef.current;
    if (!node) return;
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (!surface) return;
    const target = design.elements.find(
      (e): e is RasterElement => e.type === "raster" && expandedIds.length === 1 && e.id === expandedIds[0]
    );
    const perMm = target ? pxPerMm(target).x : RASTER_DPI / 25.4;
    const d = Math.max(3, (brush.size / perMm) * PX_PER_MM * scale);
    node.style.width = `${d}px`;
    node.style.height = `${d * (brush.roundness / 100)}px`;
    node.style.left = `${event.clientX - surface.left - d / 2}px`;
    node.style.top = `${event.clientY - surface.top - (d * (brush.roundness / 100)) / 2}px`;
    node.style.transform = brush.angle ? `rotate(${brush.angle}deg)` : "";
    node.style.display = "block";
  };

  const startCropDrag = (event: React.PointerEvent, element: ImageElement, handle: Handle | null) => {
    event.stopPropagation();
    event.preventDefault();
    const session = latest.current.crop;
    if (!session) return;
    const frame = fullFrame(element);
    const origin = cropRect(frame, session.crop);
    const start = pointToMm(event.clientX, event.clientY);
    track(
      (e) => {
        const point = pointToMm(e.clientX, e.clientY);
        const dx = point.x - start.x;
        const dy = point.y - start.y;
        let next: Rect;
        if (!handle) {
          // Drag inside the crop to slide it over the image.
          next = {
            ...origin,
            x: Math.min(Math.max(origin.x + dx, frame.x), frame.x + frame.width - origin.width),
            y: Math.min(Math.max(origin.y + dy, frame.y), frame.y + frame.height - origin.height),
          };
        } else {
          next = resizeCropRect(origin, frame, handle.hx, handle.hy, dx, dy, session.ratio);
        }
        onCropChange(cropFromRect(frame, next));
      },
      () => {}
    );
  };

  const startMarquee = (event: React.PointerEvent) => {
    const additive = event.shiftKey || event.ctrlKey || event.metaKey;
    const base = additive ? selectedIds : [];
    if (!additive) onSetSelection([]);
    const start = pointToMm(event.clientX, event.clientY);
    track(
      (e) => {
        const rect = normalizeRect(start, pointToMm(e.clientX, e.clientY));
        setMarquee(rect);
        const hits = latest.current.design.elements
          .filter((el) => el.visible && intersects(rect, el))
          .map((el) => el.id);
        onSetSelection([...new Set([...base, ...hits])]);
      },
      () => setMarquee(null)
    );
  };

  const startDraw = (event: React.PointerEvent, type: CreatableType) => {
    const start = pointToMm(event.clientX, event.clientY);
    const startClient = { x: event.clientX, y: event.clientY };
    let rect: Rect | null = null;
    const s = latest.current.snap;
    track(
      (e) => {
        if (Math.hypot(e.clientX - startClient.x, e.clientY - startClient.y) < DRAG_THRESHOLD_PX) return;
        let end = pointToMm(e.clientX, e.clientY);
        if (e.shiftKey) {
          // Shift draws a square from the starting corner.
          const size = Math.max(Math.abs(end.x - start.x), Math.abs(end.y - start.y));
          end = {
            x: start.x + Math.sign(end.x - start.x || 1) * size,
            y: start.y + Math.sign(end.y - start.y || 1) * size,
          };
        }
        const r = normalizeRect(start, end);
        rect = {
          x: snapTo(r.x, s),
          y: snapTo(r.y, s),
          width: Math.max(MIN_ELEMENT_MM, snapTo(r.width, s)),
          height: Math.max(MIN_ELEMENT_MM, snapTo(r.height, s)),
        };
        setDrawing(rect);
      },
      () => {
        setDrawing(null);
        const tiny = !rect || (rect.width < 1.5 && rect.height < 1.5);
        onCreate(type, tiny ? null : rect, { x: snapTo(start.x, s), y: snapTo(start.y, s) });
      }
    );
  };

  const startPan = (event: React.PointerEvent) => {
    const node = viewportRef.current;
    if (!node) return;
    event.preventDefault();
    const start = { x: event.clientX, y: event.clientY, left: node.scrollLeft, top: node.scrollTop };
    setPanning(true);
    track(
      (e) => {
        node.scrollLeft = start.left - (e.clientX - start.x);
        node.scrollTop = start.top - (e.clientY - start.y);
      },
      () => setPanning(false)
    );
  };

  /** Presses that land on empty canvas (or fall through a layer). */
  const handleViewportPointerDown = (event: React.PointerEvent) => {
    if (event.button === 2) return; // right-click opens the context menu instead
    if (event.button === 1 || tool === "hand") {
      startPan(event);
      return;
    }
    if (tool === "zoom") {
      onZoomStep(event.altKey ? -1 : 1, event.clientX, event.clientY);
      return;
    }
    if (PAINT_TOOLS.includes(tool)) {
      void startPaint(event, tool === "eraser");
      return;
    }
    const createType = CREATE_TOOLS[tool];
    if (createType) {
      event.preventDefault();
      startDraw(event, createType);
      return;
    }
    if (tool === "move") {
      // Painted pixels are clickable even though pixel layers have no hit box.
      const raster = rasterAt(pointToMm(event.clientX, event.clientY));
      if (raster) {
        startMove(event, raster);
        return;
      }
      // A selected pixel layer can be dragged from anywhere in its box.
      const point = pointToMm(event.clientX, event.clientY);
      const selectedRaster = design.elements.find(
        (e) => e.type === "raster" && expandedIds.length === 1 && e.id === expandedIds[0]
      );
      if (
        selectedRaster &&
        point.x >= selectedRaster.x &&
        point.y >= selectedRaster.y &&
        point.x <= selectedRaster.x + selectedRaster.width &&
        point.y <= selectedRaster.y + selectedRaster.height
      ) {
        startMove(event, selectedRaster);
        return;
      }
      startMarquee(event);
    }
  };

  const handleElementPointerDown = (event: React.PointerEvent, element: LabelElement) => {
    if (event.button !== 0 || tool === "hand" || tool === "zoom" || PAINT_TOOLS.includes(tool)) return; // let the viewport handle it
    // Paint on a pixel layer above this one wins the click.
    if (tool === "move") {
      const index = design.elements.findIndex((e) => e.id === element.id);
      const raster = rasterAt(pointToMm(event.clientX, event.clientY), index);
      if (raster) {
        event.stopPropagation();
        startMove(event, raster);
        return;
      }
    }
    const createType = CREATE_TOOLS[tool];
    if (createType) {
      // Clicking existing text with the text tool edits it rather than
      // stacking a new layer on top.
      if (createType === element.type && createType !== "shape") {
        event.stopPropagation();
        onSelect(element.id, "replace");
        onEditElement(element.id);
      }
      return;
    }
    event.stopPropagation();
    if (tool === "crop") {
      if (element.type === "image" && element.src) onStartCrop(element.id);
      else onSelect(element.id, "replace");
      return;
    }
    startMove(event, element);
  };

  /* ---------- drag & drop files ---------- */

  const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDropActive(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
      if (!dropActive) setDropActive(true);
    },
    onDragLeave: (event: React.DragEvent) => {
      const next = event.relatedTarget as Node | null;
      if (!next || !viewportRef.current?.contains(next)) setDropActive(false);
    },
    onDrop: (event: React.DragEvent) => {
      setDropActive(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      event.preventDefault();
      const target = (event.target as HTMLElement | null)?.closest<HTMLElement>("[data-element-id]");
      onDropFiles(files, pointToMm(event.clientX, event.clientY), target?.dataset.elementId ?? null);
    },
  };

  /* ---------- render ---------- */

  // While cropping, the label shows the image through the crop overlay
  // instead, so the committed version must not draw underneath it.
  // Likewise a pixel layer being painted shows through the live canvas.
  const hiddenId = crop?.id ?? paint?.id ?? null;
  const renderDesign = useMemo(
    () =>
      hiddenId
        ? {
            ...design,
            elements: design.elements.map((e) => (e.id === hiddenId ? { ...e, visible: false } : e)),
          }
        : design,
    [design, hiddenId]
  );

  const px = (mm: number) => mm * PX_PER_MM * scale;
  const gridPx = PX_PER_MM * 5 * scale; // a 5mm grid
  // One plain layer gets its own handles; a group or several layers get one
  // selection box that scales them together.
  const single = expandedIds.length === 1 && selectedIds.length === 1 ? expandedIds[0] : null;
  const selectionBox =
    !single && expandedIds.length > 0
      ? boundsOf(design.elements.filter((e) => expandedIds.includes(e.id)))
      : null;
  const paintElement = paint ? design.elements.find((e) => e.id === paint.id) : undefined;
  const cropElement =
    crop && (design.elements.find((e) => e.id === crop.id && e.type === "image") as ImageElement | undefined);

  const viewportCursor = panning ? "grabbing" : TOOL_CURSOR[tool] ?? "default";

  return (
    <div className="relative h-full w-full">
    <div
      ref={viewportRef}
      className="canvas-viewport h-full w-full overflow-auto"
      data-backdrop={backdrop}
      style={{ cursor: viewportCursor }}
      onPointerDown={handleViewportPointerDown}
      onPointerMove={(e) => {
        setPointerMm(pointToMm(e.clientX, e.clientY));
        if (PAINT_TOOLS.includes(tool)) moveBrushCursor(e);
      }}
      onPointerLeave={() => {
        setPointerMm(null);
        if (brushCursorRef.current) brushCursorRef.current.style.display = "none";
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e, null);
      }}
      {...dropHandlers}
    >
      <div className="flex min-h-full min-w-full w-max p-12">
        <div
          style={{
            width: px(design.width),
            height: px(design.height),
            boxShadow: "0 10px 40px rgba(0,0,0,0.35), 0 0 0 1px var(--border-strong)",
          }}
          className="relative m-auto shrink-0"
        >
          <div
            ref={surfaceRef}
            data-label-surface=""
            style={{
              transform: `scale(${scale})`,
              transformOrigin: "top left",
              width: design.width * PX_PER_MM,
              height: design.height * PX_PER_MM,
              position: "relative",
              touchAction: "none",
            }}
          >
            {/* Hold the label back until uploaded fonts are usable, so the first
                thing drawn is already at the right advance width rather than a
                fallback that reflows a moment later. */}
            {fontsReady ? (
              <Label design={renderDesign} number={previewNumber} />
            ) : (
              <div
                className="flex h-full w-full items-center justify-center"
                style={{ background: design.background }}
              >
                <span className="text-xs text-[var(--text-faint)]">Loading fonts…</span>
              </div>
            )}
          </div>

          {/* Grid overlay, drawn above the label but below the hit-boxes. */}
          {showGrid && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(56,110,220,0.28) 1px, transparent 1px)," +
                  "linear-gradient(to bottom, rgba(56,110,220,0.28) 1px, transparent 1px)",
                backgroundSize: `${gridPx}px ${gridPx}px`,
              }}
            />
          )}

          {/* Interaction layer, in screen pixels so handles stay a usable size. */}
          <div className="absolute inset-0">
            {design.elements.map((element) => {
              const isSelected = expandedIds.includes(element.id);
              const isCropping = crop?.id === element.id;
              // Pixel layers are hit-tested by their painted pixels instead,
              // so a full-label layer never blocks the layers beneath it.
              const passThrough =
                tool === "hand" ||
                tool === "zoom" ||
                PAINT_TOOLS.includes(tool) ||
                isCropping ||
                element.type === "raster";
              return (
                <div
                  key={element.id}
                  className="pointer-events-none"
                  style={{
                    position: "absolute",
                    left: px(element.x),
                    top: px(element.y),
                    width: px(element.width),
                    height: px(element.height),
                    transform: element.rotation ? `rotate(${element.rotation}deg)` : undefined,
                    transformOrigin: "center center",
                  }}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    data-element-id={element.id}
                    aria-label={`Select ${element.name}`}
                    aria-pressed={isSelected}
                    onPointerDown={(e) => handleElementPointerDown(e, element)}
                    onDoubleClick={() => tool === "move" && onEditElement(element.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const id =
                        autoSelect === "group" ? outermostGroupOf(element.id, layerState) ?? element.id : element.id;
                      if (!isSelected) onSelect(id, "replace");
                      onContextMenu(e, id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(element.id, e.shiftKey ? "add" : "replace");
                      }
                    }}
                    className={`layer-hit absolute inset-0 transition-[outline-color,background-color] ${
                      showLayerEdges ? "layer-hit-edges" : ""
                    }`}
                    style={{
                      pointerEvents: passThrough ? "none" : "auto",
                      cursor:
                        tool === "move"
                          ? dragging === element.id
                            ? "grabbing"
                            : "move"
                          : tool === "crop"
                            ? element.type === "image"
                              ? "crosshair"
                              : "default"
                            : undefined,
                      // While painting, selection chrome would sit on top of the strokes.
                      outline:
                        isCropping || PAINT_TOOLS.includes(tool)
                          ? "none"
                          : isSelected
                            ? "1.5px solid var(--accent)"
                            : undefined,
                      // A pixel layer usually covers the whole label; tinting it
                      // would wash out everything, so it gets an outline only.
                      background:
                        isSelected && !isCropping && element.type !== "raster" && !PAINT_TOOLS.includes(tool)
                          ? "var(--accent-soft)"
                          : "transparent",
                      opacity: element.visible ? 1 : 0.4,
                    }}
                  />

                  {single === element.id &&
                    tool === "move" &&
                    !crop &&
                    HANDLES.map((handle) => (
                      <div
                        key={handle.key}
                        role="button"
                        tabIndex={-1}
                        aria-label={`Resize ${element.name} (${handle.key})`}
                        data-handle={handle.key}
                        onPointerDown={(e) => startResize(e, element, handle)}
                        className="transform-handle pointer-events-auto absolute"
                        style={{ ...handlePosition(handle), cursor: handle.cursor }}
                      />
                    ))}
                </div>
              );
            })}

            {selectionBox && tool === "move" && !crop && (
              <div
                role="group"
                aria-label="Selection bounds"
                className="pointer-events-none absolute outline-dashed outline-1 outline-[var(--accent)]"
                style={{
                  left: px(selectionBox.x),
                  top: px(selectionBox.y),
                  width: px(selectionBox.width),
                  height: px(selectionBox.height),
                }}
              >
                {HANDLES.map((handle) => (
                  <div
                    key={handle.key}
                    role="button"
                    tabIndex={-1}
                    aria-label={`Scale selection (${handle.key})`}
                    onPointerDown={(e) => startSelectionResize(e, handle)}
                    className="transform-handle pointer-events-auto absolute"
                    style={{ ...handlePosition(handle), cursor: handle.cursor }}
                  />
                ))}
              </div>
            )}

            {paint && (
              <canvas
                ref={paintCanvasRef}
                width={paint.pxWidth}
                height={paint.pxHeight}
                aria-hidden="true"
                className="pointer-events-none absolute"
                style={{
                  left: px(paint.rect.x),
                  top: px(paint.rect.y),
                  width: px(paint.rect.width),
                  height: px(paint.rect.height),
                  opacity: paintElement?.opacity !== undefined ? paintElement.opacity / 100 : undefined,
                  filter:
                    paintElement && "effects" in paintElement ? effectsToCss(paintElement.effects) : undefined,
                }}
              />
            )}

            {PAINT_TOOLS.includes(tool) && (
              <div ref={brushCursorRef} aria-hidden="true" className="brush-cursor" style={{ display: "none" }} />
            )}

            {cropElement && crop && (
              <CropOverlay
                element={cropElement}
                session={crop}
                px={px}
                onDrag={(e, handle) => startCropDrag(e, cropElement, handle)}
              />
            )}

            {marquee && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border border-[var(--accent)] bg-[var(--accent-soft)]"
                style={{
                  left: px(marquee.x),
                  top: px(marquee.y),
                  width: px(marquee.width),
                  height: px(marquee.height),
                }}
              />
            )}

            {drawing && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border border-dashed border-[var(--accent)]"
                style={{
                  left: px(drawing.x),
                  top: px(drawing.y),
                  width: px(drawing.width),
                  height: px(drawing.height),
                }}
              >
                <span className="absolute -bottom-5 left-0 whitespace-nowrap rounded bg-[var(--accent)] px-1 text-[10px] text-[var(--accent-text)]">
                  {round(drawing.width, 1)} × {round(drawing.height, 1)} mm
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

    </div>

      {dropActive && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 flex items-center justify-center rounded-[var(--radius)] border-2 border-dashed border-[var(--accent)] bg-[var(--accent-soft)]"
        >
          <span className="rounded-[var(--radius)] bg-[var(--surface)] px-3 py-2 text-xs font-medium text-[var(--text)] shadow-xl">
            Drop to place image on the label
          </span>
        </div>
      )}
    </div>
  );
};

/** The crop UI: the whole image ghosted, the kept region bright, 8 handles. */
const CropOverlay = ({
  element,
  session,
  px,
  onDrag,
}: {
  element: ImageElement;
  session: CropSession;
  px: (mm: number) => number;
  onDrag: (event: React.PointerEvent, handle: Handle | null) => void;
}) => {
  const frame = fullFrame(element);
  const rect = cropRect(frame, session.crop);
  const uncropped = { ...element, crop: undefined };
  const handles = session.ratio ? HANDLES.filter((h) => h.hx !== 0 && h.hy !== 0) : HANDLES;

  return (
    <>
      {/* Everything outside the crop, dimmed. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute overflow-hidden"
        style={{ left: px(frame.x), top: px(frame.y), width: px(frame.width), height: px(frame.height) }}
      >
        <img src={element.src} alt="" style={{ ...imageContentStyle(uncropped), opacity: 0.35 }} />
        <div className="absolute inset-0 border border-dashed border-white/60" />
      </div>

      {/* The kept region, at full brightness. */}
      <div
        role="group"
        aria-label={`Crop ${element.name}`}
        className="crop-box absolute overflow-visible"
        style={{
          left: px(rect.x),
          top: px(rect.y),
          width: px(rect.width),
          height: px(rect.height),
          cursor: "move",
        }}
        onPointerDown={(e) => onDrag(e, null)}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div
            className="absolute"
            style={{
              left: px(frame.x - rect.x),
              top: px(frame.y - rect.y),
              width: px(frame.width),
              height: px(frame.height),
            }}
          >
            <img src={element.src} alt="" style={imageContentStyle(uncropped)} />
          </div>
          {/* Rule-of-thirds guides. */}
          <div className="crop-thirds absolute inset-0" />
        </div>
        {handles.map((handle) => (
          <div
            key={handle.key}
            role="button"
            tabIndex={-1}
            aria-label={`Crop handle ${handle.key}`}
            onPointerDown={(e) => onDrag(e, handle)}
            className="crop-handle absolute"
            style={{ ...handlePosition(handle), cursor: handle.cursor }}
          />
        ))}
      </div>
    </>
  );
};

export default Canvas;
