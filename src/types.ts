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

export interface ImageElement extends ElementBase {
  type: "image";
  /** a path under /public, an http(s) URL, or a data: URL from an upload */
  src: string;
  fit: ImageFit;
}

export interface ShapeElement extends ElementBase {
  type: "shape";
  fill: string;
  border: Border;
}

export type LabelElement =
  | TextElement
  | NumberElement
  | ImageElement
  | ShapeElement;

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
