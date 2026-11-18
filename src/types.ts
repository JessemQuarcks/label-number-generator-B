/**
 * Domain model for label designs.
 *
 * All geometry (x, y, width, height, border width/radius) is stored in
 * MILLIMETRES, which is the canonical unit. `LabelDesign.unit` only decides
 * which unit the editor shows and accepts — it never changes what is stored.
 * Typography (font size, letter spacing) is stored in POINTS, the usual unit
 * for print type.
 */

export type Unit = "mm" | "cm";

export type BorderStyle =
  | "none"
  | "solid"
  | "dashed"
  | "dotted"
  | "double"
  | "groove"
  | "ridge";

export interface Border {
  style: BorderStyle;
  /** mm */
  width: number;
  color: string;
  /** mm — corner radius */
  radius: number;
}

export type TextAlign = "left" | "center" | "right" | "justify";
export type VerticalAlign = "top" | "middle" | "bottom";
export type TextTransform = "none" | "uppercase" | "lowercase" | "capitalize";

export interface Typography {
  fontFamily: string;
  /** pt */
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  color: string;
  align: TextAlign;
  verticalAlign: VerticalAlign;
  /** pt */
  letterSpacing: number;
  /** unitless multiplier */
  lineHeight: number;
  textTransform: TextTransform;
}

export interface ElementBase {
  id: string;
  name: string;
  /** mm, from the label's top-left corner */
  x: number;
  /** mm, from the label's top-left corner */
  y: number;
  /** mm */
  width: number;
  /** mm */
  height: number;
  /** degrees, clockwise, about the element's centre */
  rotation: number;
  visible: boolean;
  /** The group this layer sits in, if any. Optional: older saves predate groups. */
  groupId?: string;
  /** percent, 100 = fully opaque. Optional: older saves predate it. */
  opacity?: number;
}

/**
 * A folder in the Layers panel. Layers point at their group with `groupId`,
 * and groups can nest through `parentId`. The elements array stays flat, so
 * stacking order is still simply array order — a group's members are kept
 * contiguous in it.
 */
export interface LayerGroup {
  id: string;
  name: string;
  visible: boolean;
  /** Folded closed in the Layers panel. */
  collapsed: boolean;
  parentId?: string;
}

export interface TextElement extends ElementBase {
  type: "text";
  text: string;
  typography: Typography;
}

/** The serial number that increments once per printed label. */
export interface NumberElement extends ElementBase {
  type: "number";
  prefix: string;
  suffix: string;
  /** left-pad the number with zeros to this many digits */
  padTo: number;
  typography: Typography;
}

export type ImageFit = "contain" | "cover" | "fill";

/**
 * A non-destructive crop. Each inset is a FRACTION (0–1) of the uncropped
 * image frame, so the crop survives resizing: the element box is always the
 * visible (cropped) region and the full frame is derived from it.
 */
export interface ImageCrop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type EffectKind =
  | "brightness"
  | "contrast"
  | "saturation"
  | "hue"
  | "grayscale"
  | "sepia"
  | "invert"
  | "blur"
  | "dropShadow"
  | "glow";

/**
 * One non-destructive effect in a layer's effect stack. Effects show in the
 * Layers panel under their layer and can be switched off, duplicated or
 * deleted individually. They render, in order, as a CSS filter.
 */
export interface LayerEffect {
  id: string;
  kind: EffectKind;
  enabled: boolean;
  /** The effect's main amount; units depend on the kind (see lib/effects). */
  amount: number;
  /** Shadow and glow only: mm offsets, mm blur radius and a colour. */
  offsetX?: number;
  offsetY?: number;
  radius?: number;
  color?: string;
}

export interface ImageElement extends ElementBase {
  type: "image";
  /** a path under /public, an http(s) URL, or a data: URL from an upload */
  src: string;
  fit: ImageFit;
  /** Optional: older saves predate cropping. */
  crop?: ImageCrop;
  /** Optional: older saves predate image editing. */
  effects?: LayerEffect[];
  flipX?: boolean;
  flipY?: boolean;
}

export type ShapeKind =
  | "rectangle"
  | "ellipse"
  | "triangle"
  | "polygon"
  | "star"
  | "line"
  | "arrow"
  | "heart"
  | "speech"
  | "burst"
  | "cross"
  | "check"
  | "drop";

export interface ShapeElement extends ElementBase {
  type: "shape";
  /** Optional: older saves are all rectangles. */
  shape?: ShapeKind;
  /** Polygon sides / star points. */
  sides?: number;
  /** Star and burst: inner radius as a percentage of the outer. */
  innerRadius?: number;
  /** A CSS colour, or "none" for no fill (the stroke still shows). */
  fill: string;
  border: Border;
}

/**
 * A pixel layer for the brush. The bitmap is a PNG data URL stretched over
 * the element box; `pxWidth`/`pxHeight` are its pixel size.
 */
export interface RasterElement extends ElementBase {
  type: "raster";
  /** data:image/png… or "" for a fresh, empty layer. */
  src: string;
  pxWidth: number;
  pxHeight: number;
  effects?: LayerEffect[];
}

export type LabelElement =
  | TextElement
  | NumberElement
  | ImageElement
  | ShapeElement
  | RasterElement;

export type ElementType = LabelElement["type"];

/**
 * A font file embedded in the design. Stored as a data URL so it survives
 * reloads and travels with an export, exactly like an uploaded image.
 */
export interface CustomFont {
  id: string;
  /** The family name, as referenced by Typography.fontFamily. */
  family: string;
  /** data:font/... or data:application/font... URL holding the file. */
  src: string;
  /** Weight this file supplies; "normal"/"bold" or a numeric range. */
  weight: string;
  style: "normal" | "italic";
}

export interface LabelDesign {
  id: string;
  name: string;
  /** mm */
  width: number;
  /** mm */
  height: number;
  /** the unit the editor displays geometry in */
  unit: Unit;
  background: string;
  border: Border;
  elements: LabelElement[];
  /** Fonts uploaded with this design. Optional: older saves predate it. */
  fonts?: CustomFont[];
  /** Layer groups. Optional: older saves predate them. */
  groups?: LayerGroup[];
}

export interface PrintSettings {
  startNumber: number;
  count: number;
  /** mm — space between labels on the sheet */
  gap: number;
}

export interface AppState {
  version: 1;
  designs: LabelDesign[];
  activeId: string | null;
  print: PrintSettings;
}
