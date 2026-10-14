import { useCallback, useEffect, useRef, useState } from "react";
import type { LabelDesign, LabelElement } from "../types";
import Label from "./Label";
import { PX_PER_MM, round } from "../lib/units";

interface CanvasProps {
  design: LabelDesign;
  previewNumber: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  onResize: (id: string, patch: { x?: number; y?: number; width?: number; height?: number }) => void;
  scale: number;
  showGrid: boolean;
  snap: boolean;
  /** False while uploaded fonts are still decoding. */
  fontsReady: boolean;
}

interface DragState {
  id: string;
  pointerId: number;
  /** Pointer offset from the element's origin, in mm. */
  offsetX: number;
  offsetY: number;
}

interface ResizeState {
  id: string;
  pointerId: number;
  handle: Handle;
  startX: number;
  startY: number;
  origin: { x: number; y: number; width: number; height: number };
}

type Handle = "nw" | "ne" | "sw" | "se";

const HANDLES: { key: Handle; cursor: string; style: React.CSSProperties }[] = [
  { key: "nw", cursor: "nwse-resize", style: { left: -4, top: -4 } },
  { key: "ne", cursor: "nesw-resize", style: { right: -4, top: -4 } },
  { key: "sw", cursor: "nesw-resize", style: { left: -4, bottom: -4 } },
  { key: "se", cursor: "nwse-resize", style: { right: -4, bottom: -4 } },
];

/** The smallest an element may be dragged to — never zero. */
const MIN_ELEMENT_MM = 1;

const SNAP_MM = 1;
const snapTo = (value: number, on: boolean) =>
  on ? Math.round(value / SNAP_MM) * SNAP_MM : round(value, 2);

/**
 * The design surface: the real label render plus a transparent layer of
 * draggable hit-boxes, one per element. Dragging edits x/y in millimetres;
 * the corner handles resize.
 */
const Canvas = ({
  design,
  previewNumber,
  selectedId,
  onSelect,
  onMove,
  onResize,
  scale,
  showGrid,
  snap,
  fontsReady,
}: CanvasProps) => {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [resize, setResize] = useState<ResizeState | null>(null);

  const pointToMm = useCallback(
    (clientX: number, clientY: number) => {
      const rect = surfaceRef.current?.getBoundingClientRect();
      if (!rect) return { x: 0, y: 0 };
      return {
        x: (clientX - rect.left) / (PX_PER_MM * scale),
        y: (clientY - rect.top) / (PX_PER_MM * scale),
      };
    },
    [scale]
  );

  const handlePointerDown = (event: React.PointerEvent, element: LabelElement) => {
    event.stopPropagation();
    onSelect(element.id);
    const point = pointToMm(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDrag({
      id: element.id,
      pointerId: event.pointerId,
      offsetX: point.x - element.x,
      offsetY: point.y - element.y,
    });
  };

  const handlePointerMove = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const point = pointToMm(event.clientX, event.clientY);
    onMove(
      drag.id,
      snapTo(point.x - drag.offsetX, snap),
      snapTo(point.y - drag.offsetY, snap)
    );
  };

  const endDrag = (event: React.PointerEvent) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    setDrag(null);
  };

  const startResize = (
    event: React.PointerEvent,
    element: LabelElement,
    handle: Handle
  ) => {
    event.stopPropagation();
    event.preventDefault();
    onSelect(element.id);
    const point = pointToMm(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setResize({
      id: element.id,
      pointerId: event.pointerId,
      handle,
      startX: point.x,
      startY: point.y,
      origin: {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      },
    });
  };

  const moveResize = (event: React.PointerEvent) => {
    if (!resize || event.pointerId !== resize.pointerId) return;
    const point = pointToMm(event.clientX, event.clientY);
    const dx = point.x - resize.startX;
    const dy = point.y - resize.startY;
    const o = resize.origin;
    const patch: { x?: number; y?: number; width?: number; height?: number } = {};

    // Dragging a west/north handle moves the origin as well as the size, but
    // the size is clamped first so the element can never invert or vanish.
    if (resize.handle === "se" || resize.handle === "ne") {
      patch.width = Math.max(MIN_ELEMENT_MM, snapTo(o.width + dx, snap));
    } else {
      const width = Math.max(MIN_ELEMENT_MM, snapTo(o.width - dx, snap));
      patch.width = width;
      patch.x = snapTo(o.x + (o.width - width), snap);
    }

    if (resize.handle === "se" || resize.handle === "sw") {
      patch.height = Math.max(MIN_ELEMENT_MM, snapTo(o.height + dy, snap));
    } else {
      const height = Math.max(MIN_ELEMENT_MM, snapTo(o.height - dy, snap));
      patch.height = height;
      patch.y = snapTo(o.y + (o.height - height), snap);
    }

    onResize(resize.id, patch);
  };

  const endResize = (event: React.PointerEvent) => {
    if (!resize || event.pointerId !== resize.pointerId) return;
    setResize(null);
  };

  // Nudge the selected element with the arrow keys: 1mm, or 0.1mm with Shift.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedId) return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const deltas: Record<string, [number, number]> = {
        ArrowLeft: [-1, 0],
        ArrowRight: [1, 0],
        ArrowUp: [0, -1],
        ArrowDown: [0, 1],
      };
      const delta = deltas[event.key];
      if (!delta) return;
      const element = design.elements.find((e) => e.id === selectedId);
      if (!element) return;
      event.preventDefault();
      const step = event.shiftKey ? 0.1 : 1;
      onMove(
        element.id,
        round(element.x + delta[0] * step, 2),
        round(element.y + delta[1] * step, 2)
      );
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedId, design.elements, onMove]);

  const gridPx = PX_PER_MM * 5 * scale; // a 5mm grid

  return (
    <div
      className="flex min-h-full items-center justify-center overflow-auto p-10"
      style={{ background: "var(--canvas-bg)" }}
      onPointerDown={() => onSelect(null)}
    >
      <div
        style={{
          width: design.width * PX_PER_MM * scale,
          height: design.height * PX_PER_MM * scale,
          // A checker under the label reads as "nothing here", which matters
          // when a design has a transparent or white background.
          boxShadow: "0 10px 40px rgba(0,0,0,0.45), 0 0 0 1px var(--border-strong)",
        }}
        className="relative shrink-0"
      >
        <div
          ref={surfaceRef}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            width: design.width * PX_PER_MM,
            height: design.height * PX_PER_MM,
            position: "relative",
            touchAction: "none",
          }}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {/* Hold the label back until uploaded fonts are usable, so the first
              thing drawn is already at the right advance width rather than a
              fallback that reflows a moment later. */}
          {fontsReady ? (
            <Label design={design} number={previewNumber} />
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
            const isSelected = element.id === selectedId;
            const px = (mm: number) => mm * PX_PER_MM * scale;
            return (
              <div
                key={element.id}
                style={{
                  position: "absolute",
                  left: px(element.x),
                  top: px(element.y),
                  width: px(element.width),
                  height: px(element.height),
                  transform: element.rotation
                    ? `rotate(${element.rotation}deg)`
                    : undefined,
                  transformOrigin: "center center",
                }}
              >
                <div
                  role="button"
                  tabIndex={0}
                  aria-label={`Select ${element.name}`}
                  aria-pressed={isSelected}
                  onPointerDown={(e) => handlePointerDown(e, element)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      onSelect(element.id);
                    }
                  }}
                  className="absolute inset-0 transition-[outline-color,background-color]"
                  style={{
                    cursor: drag?.id === element.id ? "grabbing" : "grab",
                    outline: isSelected
                      ? "1.5px solid var(--accent)"
                      : "1px dashed rgba(148,163,184,0.5)",
                    background: isSelected ? "var(--accent-soft)" : "transparent",
                    opacity: element.visible ? 1 : 0.4,
                  }}
                />

                {isSelected &&
                  HANDLES.map((handle) => (
                    <div
                      key={handle.key}
                      role="button"
                      tabIndex={-1}
                      aria-label={`Resize ${element.name}`}
                      onPointerDown={(e) => startResize(e, element, handle.key)}
                      onPointerMove={moveResize}
                      onPointerUp={endResize}
                      onPointerCancel={endResize}
                      className="absolute h-2 w-2 rounded-[2px] border border-white"
                      style={{
                        ...handle.style,
                        background: "var(--accent)",
                        cursor: handle.cursor,
                      }}
                    />
                  ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Canvas;
