export type ToolId =
  | "move"
  | "hand"
  | "zoom"
  | "marquee-rect"
  | "marquee-ellipse"
  | "lasso"
  | "lasso-poly"
  | "object-select"
  | "quick-select"
  | "magic-wand"
  | "text"
  | "number"
  | "shape"
  | "brush"
  | "eraser"
  | "remove"
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
    id: "marquee-rect",
    label: "Rectangular marquee",
    shortcut: "M",
    hint: "Drag to select · Shift adds (or squares a new one) · Alt subtracts (or draws from the centre) · Shift+Alt intersects · Shift+M for ellipse",
  },
  {
    id: "marquee-ellipse",
    label: "Elliptical marquee",
    shortcut: "M",
    hint: "Drag to select an ellipse · Shift adds · Alt subtracts · Shift+Alt intersects · Shift+M for rectangle",
  },
  {
    id: "lasso",
    label: "Lasso",
    shortcut: "L",
    hint: "Drag around an area to select it freehand · release to close · Shift adds · Alt subtracts · Shift+L for polygonal",
  },
  {
    id: "lasso-poly",
    label: "Polygonal lasso",
    shortcut: "L",
    hint: "Click to place corners · click the start, double-click or Enter to close · Backspace removes a corner · Esc cancels",
  },
  {
    id: "object-select",
    label: "Object selection",
    shortcut: "W",
    hint: "AI: click an object to select it, or drag a box around one · Shift-click adds more objects · Alt-click subtracts",
  },
  {
    id: "quick-select",
    label: "Quick selection",
    shortcut: "W",
    hint: "Paint over an area to select it · Shift paints more in · Alt paints out · [ ] brush size · AI assist in the options bar",
  },
  {
    id: "magic-wand",
    label: "Magic wand",
    shortcut: "W",
    hint: "Click a colour to select it · Tolerance and Contiguous in the options bar · Shift adds · Alt subtracts",
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
    id: "remove",
    label: "Remove",
    shortcut: "J",
    hint: "AI: paint over something to remove it — the gap is filled from its surroundings · [ ] brush size",
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

/**
 * Tools that share a toolbar slot and a shortcut, as in Photoshop: the slot
 * shows the last one used, its key picks it, Shift+key cycles through them.
 */
export interface ToolFamily {
  id: string;
  label: string;
  tools: ToolId[];
}

export const TOOL_FAMILIES: ToolFamily[] = [
  { id: "marquee", label: "Marquee tools", tools: ["marquee-rect", "marquee-ellipse"] },
  { id: "lasso", label: "Lasso tools", tools: ["lasso", "lasso-poly"] },
  { id: "select", label: "Selection tools", tools: ["object-select", "quick-select", "magic-wand"] },
];

export const familyOf = (tool: ToolId): ToolFamily | undefined => TOOL_FAMILIES.find((f) => f.tools.includes(tool));

export const familyForKey = (key: string): ToolFamily | undefined => {
  const tool = toolForKey(key);
  return tool ? familyOf(tool) : undefined;
};

/** The family member after `tool`, wrapping. */
export const nextInFamily = (tool: ToolId): ToolId => {
  const family = familyOf(tool);
  if (!family) return tool;
  const at = family.tools.indexOf(tool);
  return family.tools[(at + 1) % family.tools.length];
};

/** Tools that make or change the pixel selection. */
export const SELECTION_TOOLS: ToolId[] = [
  "marquee-rect",
  "marquee-ellipse",
  "lasso",
  "lasso-poly",
  "object-select",
  "quick-select",
  "magic-wand",
];

export const isSelectionTool = (tool: ToolId) => SELECTION_TOOLS.includes(tool);
