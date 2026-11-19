import { useEffect, useRef } from "react";
import type { Rect } from "../lib/imageEdit";
import type { Selection } from "../lib/selection/mask";
import type { RefineView } from "../lib/selection/useSelection";
import type { Pt } from "../lib/selection/shapes";
import { context2d } from "../lib/selection/pixels";

/** A selection tool gesture in progress, in label mm. */
export type SelectionDraft =
  | { kind: "rect" | "ellipse" | "box"; rect: Rect }
  | { kind: "lasso"; points: Pt[] }
  | { kind: "poly"; points: Pt[]; hover: Pt | null }
  | { kind: "stroke"; points: Pt[]; diameter: number; tone: "select" | "remove" };

interface Props {
  /** Screen size of the label. */
  width: number;
  height: number;
  labelMm: { width: number; height: number };
  /** Selection grid size, for the outline's viewBox. */
  grid: { width: number; height: number };
  outline: string;
  draft: SelectionDraft | null;
  /** Select and Mask preview, drawn as a tint instead of ants. */
  refine: { selection: Selection; view: RefineView; opacity: number } | null;
  busy: boolean;
}

const TINTS: Record<Exclude<RefineView, "ants" | "bw">, [number, number, number]> = {
  overlay: [255, 0, 0],
  black: [0, 0, 0],
  white: [255, 255, 255],
};

/** The Select and Mask preview: unselected areas tinted, or the mask itself. */
const RefineTint = ({ selection, view, opacity }: { selection: Selection; view: RefineView; opacity: number }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = context2d(canvas);
    if (!ctx) return;
    const img = ctx.createImageData(selection.width, selection.height);
    const d = img.data;
    const s = selection.data;
    if (view === "bw") {
      for (let i = 0; i < s.length; i += 1) {
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = s[i];
        d[i * 4 + 3] = 255;
      }
    } else if (view !== "ants") {
      const [r, g, b] = TINTS[view];
      const a = opacity / 100;
      for (let i = 0; i < s.length; i += 1) {
        d[i * 4] = r;
        d[i * 4 + 1] = g;
        d[i * 4 + 2] = b;
        d[i * 4 + 3] = Math.round((255 - s[i]) * a);
      }
    }
    ctx.putImageData(img, 0, 0);
  }, [selection, view, opacity]);
  if (view === "ants") return null;
  return (
    <canvas
      ref={ref}
      width={selection.width}
      height={selection.height}
      aria-hidden="true"
      data-testid="refine-preview"
      className="pointer-events-none absolute inset-0 h-full w-full"
    />
  );
};

const polyline = (points: Pt[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

/**
 * Everything the selection tools draw over the label: the marching ants,
 * the shape being dragged, and the Select and Mask preview.
 */
const SelectionOverlay = ({ width, height, labelMm, grid, outline, draft, refine, busy }: Props) => (
  <div
    className="pointer-events-none absolute left-0 top-0"
    style={{ width, height }}
    data-selection-overlay=""
    aria-hidden="true"
  >
    {refine && <RefineTint {...refine} />}
    {outline && (!refine || refine.view === "ants") && (
      <svg
        className={`absolute inset-0 h-full w-full overflow-visible ${busy ? "opacity-60" : ""}`}
        viewBox={`0 0 ${grid.width} ${grid.height}`}
        preserveAspectRatio="none"
        data-testid="marching-ants"
      >
        <path d={outline} className="ants-base" vectorEffect="non-scaling-stroke" fill="none" />
        <path d={outline} className="ants-march" vectorEffect="non-scaling-stroke" fill="none" />
      </svg>
    )}
    {draft && (
      <svg
        className="absolute inset-0 h-full w-full overflow-visible"
        viewBox={`0 0 ${labelMm.width} ${labelMm.height}`}
        preserveAspectRatio="none"
        data-testid="selection-draft"
      >
        {(draft.kind === "rect" || draft.kind === "box") && (
          <>
            <rect {...draft.rect} className="ants-base" vectorEffect="non-scaling-stroke" fill="none" />
            <rect {...draft.rect} className="ants-march" vectorEffect="non-scaling-stroke" fill="none" />
          </>
        )}
        {draft.kind === "ellipse" && (
          <>
            {[
              "ants-base",
              "ants-march",
            ].map((cls) => (
              <ellipse
                key={cls}
                cx={draft.rect.x + draft.rect.width / 2}
                cy={draft.rect.y + draft.rect.height / 2}
                rx={draft.rect.width / 2}
                ry={draft.rect.height / 2}
                className={cls}
                vectorEffect="non-scaling-stroke"
                fill="none"
              />
            ))}
          </>
        )}
        {draft.kind === "lasso" && (
          <>
            <polyline points={polyline(draft.points)} className="ants-base" vectorEffect="non-scaling-stroke" fill="none" />
            <polyline points={polyline(draft.points)} className="ants-march" vectorEffect="non-scaling-stroke" fill="none" />
          </>
        )}
        {draft.kind === "poly" && (
          <>
            <polyline
              points={polyline(draft.hover ? [...draft.points, draft.hover] : draft.points)}
              className="ants-base"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            <polyline
              points={polyline(draft.hover ? [...draft.points, draft.hover] : draft.points)}
              className="ants-march"
              vectorEffect="non-scaling-stroke"
              fill="none"
            />
            {draft.points.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={labelMm.width / 400} className="poly-vertex" />
            ))}
          </>
        )}
        {draft.kind === "stroke" && (
          <polyline
            points={polyline(draft.points)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={draft.diameter}
            className={draft.tone === "remove" ? "stroke-remove" : "stroke-select"}
          />
        )}
      </svg>
    )}
  </div>
);

export default SelectionOverlay;
