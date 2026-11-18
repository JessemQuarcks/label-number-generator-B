import type { ShapeElement, ShapeKind } from "../types";
import type { IconName } from "../components/icons";

/** The icon for each shape kind. */
export const SHAPE_ICONS: Record<ShapeKind, IconName> = {
  rectangle: "shape",
  ellipse: "ellipse",
  triangle: "triangle",
  polygon: "polygon",
  star: "star",
  line: "line",
  arrow: "arrow",
  heart: "heart",
  speech: "speech",
  burst: "burst",
  cross: "cross",
  check: "check",
  drop: "drop",
};

export interface ShapeDef {
  kind: ShapeKind;
  label: string;
  /** Shown in the shape picker and on the tool button. */
  group: "basic" | "custom";
}

export const SHAPES: ShapeDef[] = [
  { kind: "rectangle", label: "Rectangle", group: "basic" },
  { kind: "ellipse", label: "Ellipse", group: "basic" },
  { kind: "triangle", label: "Triangle", group: "basic" },
  { kind: "polygon", label: "Polygon", group: "basic" },
  { kind: "star", label: "Star", group: "basic" },
  { kind: "line", label: "Line", group: "basic" },
  { kind: "arrow", label: "Arrow", group: "custom" },
  { kind: "heart", label: "Heart", group: "custom" },
  { kind: "speech", label: "Speech bubble", group: "custom" },
  { kind: "burst", label: "Seal burst", group: "custom" },
  { kind: "cross", label: "Cross", group: "custom" },
  { kind: "check", label: "Check mark", group: "custom" },
  { kind: "drop", label: "Drop", group: "custom" },
];

export const shapeDef = (kind: ShapeKind | undefined): ShapeDef =>
  SHAPES.find((s) => s.kind === (kind ?? "rectangle")) ?? SHAPES[0];

export const SHAPE_KINDS = SHAPES.map((s) => s.kind);

/** The next shape in the list, for Shift+U. */
export const nextShape = (kind: ShapeKind): ShapeKind =>
  SHAPE_KINDS[(SHAPE_KINDS.indexOf(kind) + 1) % SHAPE_KINDS.length];

export const DEFAULT_SIDES = 6;
export const DEFAULT_STAR_POINTS = 5;
export const DEFAULT_INNER_RADIUS = 45;

/** True when the shape is drawn as an SVG path rather than a CSS box. */
export const isPathShape = (el: Pick<ShapeElement, "shape">) => (el.shape ?? "rectangle") !== "rectangle";

/** Shapes with no inside: they are stroke only. */
export const isOpenShape = (kind: ShapeKind | undefined) => kind === "line" || kind === "check";

const f = (n: number) => Math.round(n * 1000) / 1000;
const pts = (points: [number, number][]) =>
  `M${points.map(([x, y]) => `${f(x)} ${f(y)}`).join(" L")} Z`;

/** Regular polygon/star points on an ellipse filling the box. */
const radial = (
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  count: number,
  inner: number | null
): [number, number][] => {
  const out: [number, number][] = [];
  const steps = inner === null ? count : count * 2;
  for (let i = 0; i < steps; i += 1) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / steps;
    const r = inner !== null && i % 2 === 1 ? inner : 1;
    out.push([cx + Math.cos(angle) * rx * r, cy + Math.sin(angle) * ry * r]);
  }
  return out;
};

/**
 * The SVG path for a shape filling a w × h box (in mm), inset by `inset` on
 * every side so a stroke of twice that width stays inside the box.
 */
export const shapePath = (
  kind: ShapeKind,
  w: number,
  h: number,
  { inset = 0, sides = DEFAULT_SIDES, innerRadius = DEFAULT_INNER_RADIUS, cornerRadius = 0 } = {}
): string => {
  const x0 = inset;
  const y0 = inset;
  const x1 = Math.max(x0 + 0.01, w - inset);
  const y1 = Math.max(y0 + 0.01, h - inset);
  const W = x1 - x0;
  const H = y1 - y0;
  const cx = x0 + W / 2;
  const cy = y0 + H / 2;
  const at = (u: number, v: number): [number, number] => [x0 + u * W, y0 + v * H];

  switch (kind) {
    case "rectangle": {
      const r = Math.min(cornerRadius, W / 2, H / 2);
      if (r <= 0) return pts([at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);
      return (
        `M${f(x0 + r)} ${f(y0)} H${f(x1 - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x1)} ${f(y0 + r)} ` +
        `V${f(y1 - r)} A${f(r)} ${f(r)} 0 0 1 ${f(x1 - r)} ${f(y1)} H${f(x0 + r)} ` +
        `A${f(r)} ${f(r)} 0 0 1 ${f(x0)} ${f(y1 - r)} V${f(y0 + r)} A${f(r)} ${f(r)} 0 0 1 ${f(x0 + r)} ${f(y0)} Z`
      );
    }
    case "ellipse":
      return (
        `M${f(x0)} ${f(cy)} A${f(W / 2)} ${f(H / 2)} 0 1 0 ${f(x1)} ${f(cy)} ` +
        `A${f(W / 2)} ${f(H / 2)} 0 1 0 ${f(x0)} ${f(cy)} Z`
      );
    case "triangle":
      return pts([at(0.5, 0), at(1, 1), at(0, 1)]);
    case "polygon":
      return pts(radial(cx, cy, W / 2, H / 2, Math.min(Math.max(Math.round(sides), 3), 64), null));
    case "star":
      return pts(
        radial(cx, cy, W / 2, H / 2, Math.min(Math.max(Math.round(sides), 3), 64), innerRadius / 100)
      );
    case "burst":
      return pts(radial(cx, cy, W / 2, H / 2, Math.max(Math.round(sides), 8) * 2, Math.max(innerRadius, 70) / 100));
    case "line":
      return `M${f(x0)} ${f(cy)} L${f(x1)} ${f(cy)}`;
    case "arrow":
      return pts([at(0, 0.3), at(0.6, 0.3), at(0.6, 0), at(1, 0.5), at(0.6, 1), at(0.6, 0.7), at(0, 0.7)]);
    case "cross":
      return pts([
        at(0.35, 0), at(0.65, 0), at(0.65, 0.35), at(1, 0.35), at(1, 0.65), at(0.65, 0.65),
        at(0.65, 1), at(0.35, 1), at(0.35, 0.65), at(0, 0.65), at(0, 0.35), at(0.35, 0.35),
      ]);
    case "check": {
      const [ax, ay] = at(0.05, 0.55);
      const [bx, by] = at(0.38, 0.9);
      const [cx2, cy2] = at(0.95, 0.1);
      return `M${f(ax)} ${f(ay)} L${f(bx)} ${f(by)} L${f(cx2)} ${f(cy2)}`;
    }
    case "heart": {
      const p = (u: number, v: number) => at(u, v).map(f).join(" ");
      return (
        `M${p(0.5, 0.95)} C${p(0.15, 0.7)} ${p(0, 0.5)} ${p(0, 0.3)} ` +
        `C${p(0, 0.1)} ${p(0.15, 0)} ${p(0.28, 0)} C${p(0.4, 0)} ${p(0.48, 0.08)} ${p(0.5, 0.18)} ` +
        `C${p(0.52, 0.08)} ${p(0.6, 0)} ${p(0.72, 0)} C${p(0.85, 0)} ${p(1, 0.1)} ${p(1, 0.3)} ` +
        `C${p(1, 0.5)} ${p(0.85, 0.7)} ${p(0.5, 0.95)} Z`
      );
    }
    case "speech": {
      const p = (u: number, v: number) => at(u, v).map(f).join(" ");
      const r = Math.min(W, H) * 0.12;
      const [, bottom] = at(0, 0.75);
      return (
        `M${f(x0 + r)} ${f(y0)} H${f(x1 - r)} Q${f(x1)} ${f(y0)} ${f(x1)} ${f(y0 + r)} ` +
        `V${f(bottom - r)} Q${f(x1)} ${f(bottom)} ${f(x1 - r)} ${f(bottom)} ` +
        `L${p(0.45, 0.75)} L${p(0.22, 1)} L${p(0.27, 0.75)} ` +
        `H${f(x0 + r)} Q${f(x0)} ${f(bottom)} ${f(x0)} ${f(bottom - r)} V${f(y0 + r)} Q${f(x0)} ${f(y0)} ${f(x0 + r)} ${f(y0)} Z`
      );
    }
    case "drop": {
      const p = (u: number, v: number) => at(u, v).map(f).join(" ");
      return `M${p(0.5, 0)} C${p(0.5, 0)} ${p(1, 0.5)} ${p(1, 0.68)} C${p(1, 0.88)} ${p(0.78, 1)} ${p(0.5, 1)} C${p(0.22, 1)} ${p(0, 0.88)} ${p(0, 0.68)} C${p(0, 0.5)} ${p(0.5, 0)} ${p(0.5, 0)} Z`;
    }
  }
};

/** SVG stroke-dasharray for a border style, in mm. */
export const dashFor = (style: string, width: number): string | undefined => {
  if (style === "dashed") return `${f(width * 3)} ${f(width * 2)}`;
  if (style === "dotted") return `0 ${f(width * 2)}`;
  return undefined;
};
