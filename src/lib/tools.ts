export type ToolId =
  | "move"
  | "hand"
  | "zoom"
  | "text"
  | "number"
  | "shape"
  | "brush"
  | "eraser"
  | "crop";

export interface ToolDef {
  id: ToolId;
  label: string;
  /** Single key that selects the tool, shown in tooltips and menus. */
  shortcut: string;
  /** One-line hint for the status bar. */
  hint: string;
}

export const TOOLS: ToolDef[] = [
  {
    id: "move",
    label: "Move",
    shortcut: "V",
    hint: "Click to select · Shift-click to add · drag empty space to marquee · Shift-drag a handle to keep proportions, Alt to resize from the centre",
  },
  {
    id: "hand",
    label: "Hand",
    shortcut: "H",
    hint: "Drag to pan the view · hold Space with any tool to pan",
  },
  {
    id: "zoom",
    label: "Zoom",
    shortcut: "Z",
    hint: "Click to zoom in · Alt-click to zoom out · Alt+scroll zooms with any tool",
  },
  {
    id: "text",
    label: "Text",
    shortcut: "T",
    hint: "Click to place text, or drag to draw a text box · click existing text to edit it",
  },
  {
    id: "number",
    label: "Serial number",
    shortcut: "N",
    hint: "Click or drag to place the number that increments on every printed label",
  },
  {
    id: "shape",
    label: "Shape",
    shortcut: "U",
    hint: "Drag to draw · Shift for equal sides · right-click the tool or press Shift+U for more shapes",
  },
  {
    id: "brush",
    label: "Brush",
    shortcut: "B",
    hint: "Paint on a pixel layer (one is made if needed) · [ ] size · Shift+[ ] hardness · Shift-click draws a straight line · X swaps colours",
  },
  {
    id: "eraser",
    label: "Eraser",
    shortcut: "E",
    hint: "Erase pixels from the selected pixel layer with the current brush · [ ] size",
  },
  {
    id: "crop",
    label: "Crop",
    shortcut: "C",
    hint: "Click an image, drag its handles to crop · Enter applies · Esc cancels",
  },
];

export const toolById = (id: ToolId): ToolDef =>
  TOOLS.find((t) => t.id === id) ?? TOOLS[0];

export const toolForKey = (key: string): ToolId | null =>
  TOOLS.find((t) => t.shortcut.toLowerCase() === key.toLowerCase())?.id ?? null;
