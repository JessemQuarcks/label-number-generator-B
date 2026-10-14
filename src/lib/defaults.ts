import type {
  Border,
  ElementType,
  LabelDesign,
  LabelElement,
  PrintSettings,
  Typography,
} from "../types";
import { newId } from "./units";

export const DEFAULT_TYPOGRAPHY: Typography = {
  fontFamily: "Arial, Helvetica, sans-serif",
  fontSize: 10,
  fontWeight: 400,
  italic: false,
  underline: false,
  color: "#000000",
  align: "left",
  verticalAlign: "top",
  letterSpacing: 0,
  lineHeight: 1.25,
  textTransform: "none",
};

export const DEFAULT_BORDER: Border = {
  style: "solid",
  width: 0.3,
  color: "#000000",
  radius: 0,
};

export const NO_BORDER: Border = {
  style: "none",
  width: 0,
  color: "#000000",
  radius: 0,
};

export const DEFAULT_PRINT: PrintSettings = {
  startNumber: 1,
  count: 50,
  gap: 4,
};

const typography = (overrides: Partial<Typography> = {}): Typography => ({
  ...DEFAULT_TYPOGRAPHY,
  ...overrides,
});

/** A new element, centred-ish on a label of the given size. */
export const createElement = (
  type: ElementType,
  design: Pick<LabelDesign, "width" | "height">
): LabelElement => {
  const width = Math.min(40, design.width * 0.6);
  const height = Math.min(10, design.height * 0.25);
  const base = {
    id: newId(),
    x: Math.max(0, (design.width - width) / 2),
    y: Math.max(0, (design.height - height) / 2),
    width,
    height,
    rotation: 0,
    visible: true,
  };

  switch (type) {
    case "text":
      return {
        ...base,
        type: "text",
        name: "Text",
        text: "New text",
        typography: typography({ align: "center", verticalAlign: "middle" }),
      };
    case "number":
      return {
        ...base,
        type: "number",
        name: "Serial number",
        width: Math.min(20, design.width * 0.3),
        height: Math.min(6, design.height * 0.2),
        prefix: "",
        suffix: "",
        padTo: 3,
        typography: typography({
          fontWeight: 700,
          fontSize: 9,
          align: "right",
          verticalAlign: "bottom",
        }),
      };
    case "image":
      return {
        ...base,
        type: "image",
        name: "Image",
        height: Math.min(30, design.height * 0.5),
        src: "",
        fit: "contain",
      };
    case "shape":
      return {
        ...base,
        type: "shape",
        name: "Shape",
        fill: "#e5e7eb",
        border: { ...NO_BORDER },
      };
  }
};

export const createBlankDesign = (name = "Untitled label"): LabelDesign => ({
  id: newId(),
  name,
  width: 120,
  height: 90,
  unit: "mm",
  background: "#ffffff",
  border: { ...DEFAULT_BORDER, width: 0.5 },
  elements: [
    {
      id: newId(),
      type: "number",
      name: "Serial number",
      x: 96,
      y: 80,
      width: 18,
      height: 6,
      rotation: 0,
      visible: true,
      prefix: "",
      suffix: "",
      padTo: 3,
      typography: typography({
        fontWeight: 700,
        fontSize: 9,
        align: "right",
        verticalAlign: "bottom",
      }),
    },
  ],
});

/**
 * Recreates "Lime Juice Label - Redo 2026.jpg" with editable elements.
 * Geometry is derived from the 1417×1063px source mapped onto a 120×90mm
 * label (≈11.81px per mm).
 */
export const createLimeJuicePreset = (): LabelDesign => {
  const GREEN = "#1b4d2e";
  const RED = "#e02b1d";
  const BROWN = "#8c6f52";
  const SCRIPT = "'Brush Script MT', 'Segoe Script', cursive";
  const SANS = "'Segoe UI', Tahoma, sans-serif";

  // Distributes over the union so each variant keeps its own fields; a plain
  // Omit<LabelElement, "id"> would collapse them to the shared keys.
  type WithoutId<T> = T extends LabelElement ? Omit<T, "id"> : never;
  const el = (e: WithoutId<LabelElement>): LabelElement =>
    ({ ...e, id: newId() }) as LabelElement;

  return {
    id: newId(),
    name: "Organic Lime Juice (recreated)",
    width: 120,
    height: 90,
    unit: "mm",
    background: "#e9eae9",
    border: { style: "solid", width: 0.5, color: "#000000", radius: 0 },
    elements: [
      el({
        type: "shape",
        name: "Lower info band",
        x: 0,
        y: 60.5,
        width: 120,
        height: 29.5,
        rotation: 0,
        visible: true,
        fill: "#d9d5cd",
        border: { ...NO_BORDER },
      }),
      el({
        type: "text",
        name: "Tagline (arched)",
        x: 3,
        y: 6,
        width: 62,
        height: 11,
        rotation: -12,
        visible: true,
        text: "Fresh Pressed Organic Juice!",
        typography: typography({
          fontFamily: SCRIPT,
          fontSize: 17,
          color: GREEN,
          align: "center",
          verticalAlign: "middle",
        }),
      }),
      el({
        type: "image",
        name: "Product photo",
        x: 32,
        y: 11,
        width: 56,
        height: 37,
        rotation: 0,
        visible: true,
        src: "",
        fit: "contain",
      }),
      el({
        type: "image",
        name: "Brand logo",
        x: 96,
        y: 1.5,
        width: 22,
        height: 11,
        rotation: 0,
        visible: true,
        src: "",
        fit: "contain",
      }),
      el({
        type: "text",
        name: "Keep Frozen",
        x: 86,
        y: 31,
        width: 32,
        height: 8,
        rotation: 0,
        visible: true,
        text: "Keep Frozen",
        typography: typography({
          fontFamily: SANS,
          fontSize: 14,
          color: "#9b1c13",
          underline: true,
          align: "center",
          verticalAlign: "middle",
        }),
      }),
      el({
        type: "text",
        name: "Product name",
        x: 10,
        y: 45,
        width: 100,
        height: 11,
        rotation: 0,
        visible: true,
        text: "Organic Lime Juice",
        typography: typography({
          fontFamily: SANS,
          fontSize: 26,
          fontWeight: 800,
          color: RED,
          align: "center",
          verticalAlign: "middle",
        }),
      }),
      el({
        type: "text",
        name: "Sub-tagline",
        x: 10,
        y: 55,
        width: 100,
        height: 6.5,
        rotation: 0,
        visible: true,
        text: "Organic Produce for Healthy Life",
        typography: typography({
          fontFamily: SCRIPT,
          fontSize: 15,
          color: GREEN,
          align: "center",
          verticalAlign: "middle",
        }),
      }),
      el({
        type: "text",
        name: "Producer",
        x: 3,
        y: 62,
        width: 56,
        height: 6,
        rotation: 0,
        visible: true,
        text: "Product of Quin Organics",
        typography: typography({
          fontFamily: SCRIPT,
          fontSize: 16,
          color: "#b4766b",
          verticalAlign: "middle",
        }),
      }),
      el({
        type: "text",
        name: "Contact block",
        x: 3,
        y: 68,
        width: 60,
        height: 21,
        rotation: 0,
        visible: true,
        text: [
          "P. O. Box TF 313, Trade Fair, Accra.",
          "✉ quarcoo.initiatives@gmail.com",
          "🌐 www.quinorganics.com",
          "✆ +233287010438   +233240865212",
          "Certified organic by CU 819577",
        ].join("\n"),
        typography: typography({
          fontFamily: SANS,
          fontSize: 8,
          color: "#1f2937",
          lineHeight: 1.45,
        }),
      }),
      el({
        type: "text",
        name: "Certification codes",
        x: 68,
        y: 61,
        width: 32,
        height: 10,
        rotation: 0,
        visible: true,
        text: "FDB/DK 13-164\nCU 819577",
        typography: typography({
          fontFamily: "Georgia, 'Times New Roman', serif",
          fontSize: 10,
          color: BROWN,
          lineHeight: 1.4,
        }),
      }),
      el({
        type: "image",
        name: "Certification logos",
        x: 86,
        y: 66,
        width: 31,
        height: 12,
        rotation: 0,
        visible: true,
        src: "",
        fit: "contain",
      }),
      el({
        type: "text",
        name: "Origin & lot",
        x: 68,
        y: 78,
        width: 50,
        height: 11,
        rotation: 0,
        visible: true,
        text: "GH-BIO-149\nNon-EU Agriculture\nLot No: QIHPW-007OLIJ-27226\nBB: 10/2028",
        typography: typography({
          fontFamily: SANS,
          fontSize: 7.5,
          color: RED,
          lineHeight: 1.35,
        }),
      }),
      el({
        type: "number",
        name: "Serial number",
        x: 98,
        y: 83,
        width: 18,
        height: 5,
        rotation: 0,
        visible: true,
        prefix: "",
        suffix: "",
        padTo: 3,
        typography: typography({
          fontFamily: SANS,
          fontSize: 9,
          fontWeight: 700,
          color: "#000000",
          align: "right",
          verticalAlign: "bottom",
        }),
      }),
    ],
  };
};

/** Reproduces the app's original behaviour: a pre-made image plus a number. */
export const createImageOverlayPreset = (
  src = "Lime Juice Label - Redo 2026.jpg",
  name = "Pre-made image + number"
): LabelDesign => ({
  id: newId(),
  name,
  width: 120,
  height: 90,
  unit: "mm",
  background: "#ffffff",
  border: { style: "solid", width: 0.5, color: "#000000", radius: 0 },
  elements: [
    {
      id: newId(),
      type: "image",
      name: "Label artwork",
      x: 0,
      y: 0,
      width: 120,
      height: 90,
      rotation: 0,
      visible: true,
      src,
      fit: "fill",
    },
    {
      id: newId(),
      type: "number",
      name: "Serial number",
      x: 98,
      y: 83,
      width: 18,
      height: 5,
      rotation: 0,
      visible: true,
      prefix: "",
      suffix: "",
      padTo: 3,
      typography: typography({
        fontSize: 9,
        fontWeight: 700,
        align: "right",
        verticalAlign: "bottom",
      }),
    },
  ],
});

export interface Preset {
  key: string;
  label: string;
  description: string;
  create: () => LabelDesign;
}

export const PRESETS: Preset[] = [
  {
    key: "lime-juice",
    label: "Organic Lime Juice (recreated)",
    description:
      "120 × 90 mm recreation of the existing lime juice artwork, fully editable.",
    create: createLimeJuicePreset,
  },
  {
    key: "image-overlay",
    label: "Pre-made image + number",
    description: "The classic behaviour: existing artwork with a number on top.",
    create: () => createImageOverlayPreset(),
  },
  {
    key: "blank",
    label: "Blank 120 × 90 mm",
    description: "An empty bordered label with just a serial number.",
    create: () => createBlankDesign(),
  },
];
