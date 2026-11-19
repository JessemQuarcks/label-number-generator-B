import { useCallback, useEffect, useState } from "react";
import type { Border, BorderStyle, ShapeKind, Typography } from "../types";
import type { BrushSettings } from "./brush";
import { BLEND_MODES, BRUSH_MAX, BRUSH_MIN, BRUSH_TIPS, DEFAULT_BRUSH } from "./brush";
import { DEFAULT_INNER_RADIUS, DEFAULT_SIDES, SHAPE_KINDS } from "./shapes";
import { asBoolean, asEnum, asNumber, asString, isRecord } from "./sanitize";
import type { SelectionMode } from "./selection/mask";
import type { Capability } from "./ai/types";
import { CAPABILITIES } from "./ai/types";
import { DEFAULT_ENDPOINT } from "./ai/http";

/**
 * The editor's own layout and preferences — which panels are open, where
 * they are docked, tool defaults. Kept apart from label designs, like the
 * theme, so importing a design never rearranges someone's workspace.
 */
export const WORKSPACE_KEY = "label-number-generator:workspace:v1";

export type PanelId = "layers" | "properties" | "brush" | "fonts" | "print" | "ai";
export type DockSide = "left" | "right";

export const PANEL_TITLES: Record<PanelId, string> = {
  layers: "Layers",
  properties: "Properties",
  brush: "Brush settings",
  fonts: "Fonts",
  print: "Print run",
  ai: "Generative AI",
};

export interface PanelPrefs {
  visible: boolean;
  collapsed: boolean;
  dock: DockSide;
}

export type CanvasBackdrop = "default" | "light" | "dark" | "checker";
export type Corners = "sharp" | "default" | "round";

export interface ToolDefaults {
  text: Pick<Typography, "fontFamily" | "fontSize" | "fontWeight" | "color" | "align">;
  number: { prefix: string; padTo: number; fontSize: number; color: string };
  shape: {
    kind: ShapeKind;
    sides: number;
    innerRadius: number;
    fill: string;
    border: Pick<Border, "style" | "width" | "color" | "radius">;
  };
  brush: BrushSettings;
  select: SelectToolDefaults;
}

/** Options shared by the selection tools and the Remove tool. */
export interface SelectToolDefaults {
  /** What a plain drag/click does; Shift / Alt override it per gesture. */
  mode: SelectionMode;
  /** Marquee and lasso feather, mm. */
  feather: number;
  antiAlias: boolean;
  /** Magic wand tolerance, 0–255. */
  tolerance: number;
  contiguous: boolean;
  /** Analyse every visible layer rather than just the selected one. */
  sampleAll: boolean;
  /** Quick selection brush diameter, mm. */
  size: number;
  /** Quick selection sends its strokes to the AI segmenter when available. */
  aiAssist: boolean;
  /** Remove tool brush diameter, mm. */
  removeSize: number;
}

/** The local AI server and which of its models to use. */
export interface AiPrefs {
  endpoint: string;
  /** Model per capability; missing = the server's default. */
  models: Partial<Record<Capability, string>>;
  /** Results per generative request (Photoshop shows three). */
  count: number;
  /** Things to keep out of generated images. */
  negativePrompt: string;
}

export interface WorkspacePrefs {
  panels: Record<PanelId, PanelPrefs>;
  /** Top-to-bottom order of panels within whichever dock they sit in. */
  panelOrder: PanelId[];
  dockWidth: Record<DockSide, number>;
  showToolbar: boolean;
  showOptionsBar: boolean;
  showTabs: boolean;
  showStatusBar: boolean;
  /** Dashed outlines around every layer on the canvas. */
  showLayerEdges: boolean;
  /** Hide every panel at once, for a distraction-free canvas. */
  focusMode: boolean;
  canvasBackdrop: CanvasBackdrop;
  corners: Corners;
  /** Designs shown as tabs. Closing a tab never deletes the design. */
  openDesignIds: string[];
  /** Last properties category used for each kind of selection. */
  propertiesTab: Record<string, string>;
  /** Align against the other selected layers, or against the label. */
  alignTarget: "selection" | "canvas";
  toolDefaults: ToolDefaults;
  ai: AiPrefs;
}

export const DOCK_MIN = 200;
export const DOCK_MAX = 520;

export const DEFAULT_TOOL_DEFAULTS: ToolDefaults = {
  text: {
    fontFamily: "Arial, Helvetica, sans-serif",
    fontSize: 10,
    fontWeight: 400,
    color: "#000000",
    align: "center",
  },
  number: { prefix: "", padTo: 3, fontSize: 9, color: "#000000" },
  shape: {
    kind: "rectangle",
    sides: DEFAULT_SIDES,
    innerRadius: DEFAULT_INNER_RADIUS,
    fill: "#e5e7eb",
    border: { style: "none", width: 0.3, color: "#000000", radius: 0 },
  },
  brush: { ...DEFAULT_BRUSH },
  select: {
    mode: "new",
    feather: 0,
    antiAlias: true,
    tolerance: 32,
    contiguous: true,
    sampleAll: true,
    size: 4,
    aiAssist: true,
    removeSize: 4,
  },
};

export const DEFAULT_AI: AiPrefs = {
  endpoint: DEFAULT_ENDPOINT,
  models: {},
  count: 3,
  negativePrompt: "",
};

export const defaultWorkspace = (): WorkspacePrefs => ({
  panels: {
    layers: { visible: true, collapsed: false, dock: "left" },
    fonts: { visible: true, collapsed: true, dock: "left" },
    properties: { visible: true, collapsed: false, dock: "right" },
    // Opened from the brush options bar ("Brush settings…").
    brush: { visible: false, collapsed: false, dock: "right" },
    print: { visible: true, collapsed: false, dock: "right" },
    ai: { visible: true, collapsed: true, dock: "right" },
  },
  panelOrder: ["layers", "fonts", "properties", "ai", "brush", "print"],
  dockWidth: { left: 248, right: 304 },
  showToolbar: true,
  showOptionsBar: true,
  showTabs: true,
  showStatusBar: true,
  showLayerEdges: true,
  focusMode: false,
  canvasBackdrop: "default",
  corners: "default",
  openDesignIds: [],
  propertiesTab: {},
  alignTarget: "selection",
  toolDefaults: structuredCloneSafe(DEFAULT_TOOL_DEFAULTS),
  ai: structuredCloneSafe(DEFAULT_AI),
});

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const PANEL_IDS: PanelId[] = ["layers", "properties", "brush", "fonts", "print", "ai"];
const BORDER_STYLES: BorderStyle[] = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
];

/** Read stored prefs defensively: any unknown or broken field falls back. */
export const normalizeWorkspace = (value: unknown): WorkspacePrefs => {
  const base = defaultWorkspace();
  if (!isRecord(value)) return base;

  const panels = { ...base.panels };
  if (isRecord(value.panels)) {
    for (const id of PANEL_IDS) {
      const p = value.panels[id];
      if (!isRecord(p)) continue;
      panels[id] = {
        visible: asBoolean(p.visible, base.panels[id].visible),
        collapsed: asBoolean(p.collapsed, base.panels[id].collapsed),
        dock: asEnum(p.dock, ["left", "right"] as const, base.panels[id].dock),
      };
    }
  }

  const order = Array.isArray(value.panelOrder)
    ? value.panelOrder.filter((id): id is PanelId => PANEL_IDS.includes(id as PanelId))
    : [];
  const panelOrder = [...new Set([...order, ...base.panelOrder])];

  const width = (side: DockSide) => {
    const raw = isRecord(value.dockWidth) ? value.dockWidth[side] : undefined;
    return Math.min(Math.max(asNumber(raw, base.dockWidth[side]), DOCK_MIN), DOCK_MAX);
  };

  const td = isRecord(value.toolDefaults) ? value.toolDefaults : {};
  const text = isRecord(td.text) ? td.text : {};
  const number = isRecord(td.number) ? td.number : {};
  const shape = isRecord(td.shape) ? td.shape : {};
  const shapeBorder = isRecord(shape.border) ? shape.border : {};
  const d = base.toolDefaults;
  const hex = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : fallback;
  const between = (v: unknown, fallback: number, min: number, max: number) =>
    Math.min(Math.max(asNumber(v, fallback), min), max);

  const tabs: Record<string, string> = {};
  if (isRecord(value.propertiesTab)) {
    for (const [k, v] of Object.entries(value.propertiesTab)) {
      if (typeof v === "string" && v.length < 40) tabs[k] = v;
    }
  }

  return {
    panels,
    panelOrder,
    dockWidth: { left: width("left"), right: width("right") },
    showToolbar: asBoolean(value.showToolbar, base.showToolbar),
    showOptionsBar: asBoolean(value.showOptionsBar, base.showOptionsBar),
    showTabs: asBoolean(value.showTabs, base.showTabs),
    showStatusBar: asBoolean(value.showStatusBar, base.showStatusBar),
    showLayerEdges: asBoolean(value.showLayerEdges, base.showLayerEdges),
    focusMode: asBoolean(value.focusMode, base.focusMode),
    canvasBackdrop: asEnum(
      value.canvasBackdrop,
      ["default", "light", "dark", "checker"] as const,
      base.canvasBackdrop
    ),
    corners: asEnum(value.corners, ["sharp", "default", "round"] as const, base.corners),
    openDesignIds: Array.isArray(value.openDesignIds)
      ? value.openDesignIds.filter((id): id is string => typeof id === "string").slice(0, 100)
      : [],
    propertiesTab: tabs,
    alignTarget: asEnum(value.alignTarget, ["selection", "canvas"] as const, base.alignTarget),
    toolDefaults: {
      text: {
        fontFamily: asString(text.fontFamily, d.text.fontFamily, 200) || d.text.fontFamily,
        fontSize: between(text.fontSize, d.text.fontSize, 1, 400),
        fontWeight: between(text.fontWeight, d.text.fontWeight, 100, 900),
        color: hex(text.color, d.text.color),
        align: asEnum(text.align, ["left", "center", "right", "justify"] as const, d.text.align),
      },
      number: {
        prefix: asString(number.prefix, d.number.prefix, 40),
        padTo: Math.round(between(number.padTo, d.number.padTo, 0, 12)),
        fontSize: between(number.fontSize, d.number.fontSize, 1, 400),
        color: hex(number.color, d.number.color),
      },
      shape: {
        kind: asEnum(shape.kind, SHAPE_KINDS, d.shape.kind),
        sides: Math.round(between(shape.sides, d.shape.sides, 3, 64)),
        innerRadius: between(shape.innerRadius, d.shape.innerRadius, 5, 95),
        fill: shape.fill === "none" ? "none" : hex(shape.fill, d.shape.fill),
        border: {
          style: asEnum(shapeBorder.style, BORDER_STYLES, d.shape.border.style),
          width: between(shapeBorder.width, d.shape.border.width, 0, 100),
          color: hex(shapeBorder.color, d.shape.border.color),
          radius: between(shapeBorder.radius, d.shape.border.radius, 0, 500),
        },
      },
      brush: normalizeBrush(td.brush),
      select: normalizeSelect(td.select),
    },
    ai: normalizeAi(value.ai),
  };
};

export const normalizeSelect = (value: unknown): SelectToolDefaults => {
  const d = DEFAULT_TOOL_DEFAULTS.select;
  if (!isRecord(value)) return { ...d };
  const num = (k: keyof SelectToolDefaults, min: number, max: number) =>
    Math.min(Math.max(asNumber(value[k], d[k] as number), min), max);
  return {
    mode: asEnum(value.mode, ["new", "add", "subtract", "intersect"] as const, d.mode),
    feather: num("feather", 0, 50),
    antiAlias: asBoolean(value.antiAlias, d.antiAlias),
    tolerance: Math.round(num("tolerance", 0, 255)),
    contiguous: asBoolean(value.contiguous, d.contiguous),
    sampleAll: asBoolean(value.sampleAll, d.sampleAll),
    size: num("size", 0.2, 100),
    aiAssist: asBoolean(value.aiAssist, d.aiAssist),
    removeSize: num("removeSize", 0.2, 100),
  };
};

const CAPABILITY_IDS = CAPABILITIES.map((c) => c.id);

export const normalizeAi = (value: unknown): AiPrefs => {
  if (!isRecord(value)) return { ...DEFAULT_AI, models: {} };
  const endpoint = asString(value.endpoint, DEFAULT_AI.endpoint, 300).trim();
  const models: Partial<Record<Capability, string>> = {};
  if (isRecord(value.models)) {
    for (const [k, v] of Object.entries(value.models)) {
      if (CAPABILITY_IDS.includes(k as Capability) && typeof v === "string" && v && v.length <= 100) {
        models[k as Capability] = v;
      }
    }
  }
  return {
    // Only plain http(s) URLs (or host:port) — never a javascript: or data: URL.
    endpoint: /^(https?:\/\/)?[\w.\-[\]:]+(\/[\w.\-/]*)?$/i.test(endpoint) ? endpoint : DEFAULT_AI.endpoint,
    models,
    count: Math.round(Math.min(Math.max(asNumber(value.count, DEFAULT_AI.count), 1), 4)),
    negativePrompt: asString(value.negativePrompt, "", 500),
  };
};

/** Brush settings, field by field: unknown or out-of-range values fall back. */
export const normalizeBrush = (value: unknown): BrushSettings => {
  const d = DEFAULT_BRUSH;
  if (!isRecord(value)) return { ...d };
  const num = (k: keyof BrushSettings, min: number, max: number) =>
    Math.min(Math.max(asNumber(value[k], d[k] as number), min), max);
  const bool = (k: keyof BrushSettings) => asBoolean(value[k], d[k] as boolean);
  const hex = (k: keyof BrushSettings) =>
    typeof value[k] === "string" && /^#[0-9a-f]{6}$/i.test(value[k] as string) ? (value[k] as string) : (d[k] as string);
  const control = (k: keyof BrushSettings) => asEnum(value[k], ["off", "pressure", "fade"] as const, d[k] as "off");
  return {
    tip: asEnum(value.tip, BRUSH_TIPS.map((t) => t.value), d.tip),
    size: num("size", BRUSH_MIN, BRUSH_MAX),
    hardness: num("hardness", 0, 100),
    opacity: num("opacity", 1, 100),
    flow: num("flow", 1, 100),
    spacing: num("spacing", 1, 500),
    angle: num("angle", -180, 180),
    roundness: num("roundness", 1, 100),
    flipX: bool("flipX"),
    flipY: bool("flipY"),
    smoothing: num("smoothing", 0, 100),
    blendMode: asEnum(value.blendMode, BLEND_MODES.map((b) => b.value), d.blendMode),
    color: hex("color"),
    secondaryColor: hex("secondaryColor"),
    sizeJitter: num("sizeJitter", 0, 100),
    sizeControl: control("sizeControl"),
    minDiameter: num("minDiameter", 0, 100),
    fadeSteps: Math.round(num("fadeSteps", 1, 9999)),
    angleJitter: num("angleJitter", 0, 100),
    angleFollowsDirection: bool("angleFollowsDirection"),
    roundnessJitter: num("roundnessJitter", 0, 100),
    minRoundness: num("minRoundness", 1, 100),
    scatter: num("scatter", 0, 1000),
    scatterBothAxes: bool("scatterBothAxes"),
    count: Math.round(num("count", 1, 16)),
    countJitter: num("countJitter", 0, 100),
    opacityJitter: num("opacityJitter", 0, 100),
    opacityControl: control("opacityControl"),
    flowJitter: num("flowJitter", 0, 100),
    flowControl: control("flowControl"),
    fgBgJitter: num("fgBgJitter", 0, 100),
    hueJitter: num("hueJitter", 0, 100),
    saturationJitter: num("saturationJitter", 0, 100),
    brightnessJitter: num("brightnessJitter", 0, 100),
    colorPerTip: bool("colorPerTip"),
    noise: bool("noise"),
    airbrush: bool("airbrush"),
    protectTransparency: bool("protectTransparency"),
  };
};

const loadWorkspace = (): WorkspacePrefs => {
  try {
    const raw = localStorage.getItem(WORKSPACE_KEY);
    return normalizeWorkspace(raw ? JSON.parse(raw) : null);
  } catch {
    return defaultWorkspace();
  }
};

export const RADIUS_PX: Record<Corners, string> = {
  sharp: "2px",
  default: "7px",
  round: "12px",
};

export const useWorkspace = () => {
  const [prefs, setPrefs] = useState<WorkspacePrefs>(loadWorkspace);

  useEffect(() => {
    document.documentElement.style.setProperty("--radius", RADIUS_PX[prefs.corners]);
    try {
      localStorage.setItem(WORKSPACE_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked: the layout still applies for this session.
    }
  }, [prefs]);

  const update = useCallback(
    (patch: Partial<WorkspacePrefs> | ((p: WorkspacePrefs) => Partial<WorkspacePrefs>)) =>
      setPrefs((p) => ({ ...p, ...(typeof patch === "function" ? patch(p) : patch) })),
    []
  );

  const patchPanel = useCallback(
    (id: PanelId, patch: Partial<PanelPrefs>) =>
      setPrefs((p) => ({ ...p, panels: { ...p.panels, [id]: { ...p.panels[id], ...patch } } })),
    []
  );

  /** Bring a panel into view: shown, expanded, and out of focus mode. */
  const revealPanel = useCallback(
    (id: PanelId) =>
      setPrefs((p) => ({
        ...p,
        focusMode: false,
        panels: { ...p.panels, [id]: { ...p.panels[id], visible: true, collapsed: false } },
      })),
    []
  );

  const togglePanel = useCallback(
    (id: PanelId) =>
      setPrefs((p) => {
        const shown = p.panels[id].visible && !p.focusMode;
        return {
          ...p,
          focusMode: false,
          panels: {
            ...p.panels,
            [id]: { ...p.panels[id], visible: !shown, collapsed: shown ? p.panels[id].collapsed : false },
          },
        };
      }),
    []
  );

  /** Move a panel one slot up or down among its dock neighbours. */
  const movePanel = useCallback(
    (id: PanelId, direction: -1 | 1) =>
      setPrefs((p) => {
        const dock = p.panels[id].dock;
        const siblings = p.panelOrder.filter((x) => p.panels[x].dock === dock);
        const at = siblings.indexOf(id);
        const swapWith = siblings[at + direction];
        if (!swapWith) return p;
        const order = [...p.panelOrder];
        const i = order.indexOf(id);
        const j = order.indexOf(swapWith);
        [order[i], order[j]] = [order[j], order[i]];
        return { ...p, panelOrder: order };
      }),
    []
  );

  const resetWorkspace = useCallback(
    () =>
      setPrefs((p) => ({
        ...defaultWorkspace(),
        // Keep what the user has open and their tool defaults — "reset
        // layout" should not lose work-in-progress context.
        openDesignIds: p.openDesignIds,
        toolDefaults: p.toolDefaults,
        ai: p.ai,
      })),
    []
  );

  return { prefs, update, patchPanel, revealPanel, togglePanel, movePanel, resetWorkspace };
};
