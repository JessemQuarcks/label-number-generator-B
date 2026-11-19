import type { ImageFit, LabelDesign, LabelElement } from "../types";
import type { MenuDef, MenuEntry } from "../components/Menu";
import type { Alignment, Distribution } from "./align";
import { ALIGNMENTS, DISTRIBUTIONS } from "./align";
import type { Preset } from "./defaults";
import type { ToolId } from "./tools";
import { TOOLS } from "./tools";
import type { CategoryId } from "./properties";
import type { PanelId, WorkspacePrefs } from "./workspace";
import { PANEL_TITLES } from "./workspace";
import { isCropped } from "./imageEdit";
import { EFFECT_DEFS, EFFECT_PRESETS, supportsEffects } from "./effects";
import type { ShapeKind } from "../types";
import { SHAPES } from "./shapes";
import type { ModifyKind } from "./selection/useSelection";
import type { AddMaskKind } from "./layerOps";
import type { Capability } from "./ai/types";
import { TOOL_FAMILIES } from "./tools";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

export type BarKey = "showToolbar" | "showOptionsBar" | "showTabs" | "showStatusBar";

/** Everything a menu can do. Built once per render in App. */
export interface MenuCommands {
  newDesign: (preset: Preset) => void;
  openDesign: (id: string) => void;
  closeTab: (id: string) => void;
  placeEmbedded: () => void;
  importFile: () => void;
  exportAll: () => void;
  exportActive: () => void;
  duplicateDesign: () => void;
  deleteDesign: () => void;
  print: () => void;

  undo: () => void;
  redo: () => void;
  duplicate: () => void;
  deleteSelection: () => void;
  selectAll: () => void;
  deselect: () => void;
  appearance: () => void;

  crop: () => void;
  clearCrop: () => void;
  /** Open the Effects category for the selected layer. */
  effects: () => void;
  addEffect: (kind: (typeof EFFECT_DEFS)[number]["kind"]) => void;
  applyEffectPreset: (key: string) => void;
  clearEffects: () => void;
  flip: (axis: "x" | "y") => void;
  replaceImage: () => void;
  setFit: (fit: ImageFit) => void;

  addLayer: (type: "text" | "number" | "shape") => void;
  newPixelLayer: () => void;
  group: () => void;
  ungroup: () => void;
  setShapeKind: (kind: ShapeKind) => void;
  arrange: (to: "front" | "back") => void;
  reorder: (direction: 1 | -1) => void;
  align: (alignment: Alignment) => void;
  alignToLabel: (alignment: Alignment) => void;
  distribute: (direction: Distribution) => void;
  toggleVisible: () => void;
  properties: (category?: CategoryId) => void;

  zoomIn: () => void;
  zoomOut: () => void;
  fit: () => void;
  actualSize: () => void;
  toggleGrid: () => void;
  toggleSnap: () => void;
  toggleEdges: () => void;
  toggleFocus: () => void;
  togglePanel: (id: PanelId) => void;
  toggleBar: (key: BarKey) => void;
  resetWorkspace: () => void;
  shortcuts: () => void;
  setTool: (tool: ToolId) => void;

  // Pixel selection (Select menu).
  selectAllPixels: () => void;
  deselectPixels: () => void;
  reselect: () => void;
  inverse: () => void;
  selectSubject: () => void;
  selectBackground: () => void;
  selectSky: () => void;
  selectByDescription: () => void;
  selectAndMask: () => void;
  modifySelection: (kind: ModifyKind) => void;
  loadLayerPixels: () => void;
  loadLayerMask: () => void;
  layerViaCopy: () => void;

  // Layer masks.
  addMask: (kind: AddMaskKind) => void;
  toggleMask: () => void;
  invertMask: () => void;
  applyMask: () => void;
  deleteMask: () => void;
  editMask: () => void;

  // Generative AI.
  generativeFill: () => void;
  generativeRemove: () => void;
  generativeExpand: () => void;
  removeBackground: () => void;
  generateSimilar: () => void;
  generateImage: () => void;
}

export interface MenuContext {
  /** The selected group, if the primary selection is a group. */
  groupSelected: boolean;
  designs: LabelDesign[];
  activeDesign: LabelDesign;
  openIds: string[];
  presets: Preset[];
  selected: LabelElement | null;
  selectedCount: number;
  canUndo: boolean;
  canRedo: boolean;
  showGrid: boolean;
  snap: boolean;
  workspace: WorkspacePrefs;
  tool: ToolId;
  cmd: MenuCommands;
  /** A pixel selection exists. */
  hasPixelSelection: boolean;
  canReselect: boolean;
  /** Whether the local AI server can do this right now. */
  aiCan: (capability: Capability) => boolean;
  /** The layer whose mask the brush is painting on. */
  maskTarget: string | null;
}

const sep: MenuEntry = { kind: "separator" };

export const newDesignItems = (ctx: MenuContext): MenuEntry[] => [
  { kind: "heading", label: "New design" },
  ...ctx.presets.map((preset) => ({ label: preset.label, onSelect: () => ctx.cmd.newDesign(preset) })),
  ...(ctx.designs.length > ctx.openIds.length
    ? [
        sep,
        { kind: "heading" as const, label: "Reopen" },
        ...ctx.designs
          .filter((d) => !ctx.openIds.includes(d.id))
          .map((d) => ({ label: d.name, onSelect: () => ctx.cmd.openDesign(d.id) })),
      ]
    : []),
];

const arrangeItems = (ctx: MenuContext, disabled: boolean): MenuEntry[] => [
  { label: "Bring to front", shortcut: `${MOD}${SHIFT}]`, onSelect: () => ctx.cmd.arrange("front"), disabled },
  {
    label: "Bring forward",
    shortcut: `${MOD}]`,
    onSelect: () => ctx.cmd.reorder(1),
    disabled: disabled || ctx.selectedCount !== 1,
  },
  {
    label: "Send backward",
    shortcut: `${MOD}[`,
    onSelect: () => ctx.cmd.reorder(-1),
    disabled: disabled || ctx.selectedCount !== 1,
  },
  { label: "Send to back", shortcut: `${MOD}${SHIFT}[`, onSelect: () => ctx.cmd.arrange("back"), disabled },
];

const alignItems = (ctx: MenuContext, toLabel: boolean, disabled: boolean): MenuEntry[] => [
  ...ALIGNMENTS.map((a) => ({
    label: a.label,
    disabled,
    onSelect: () => (toLabel ? ctx.cmd.alignToLabel(a.key) : ctx.cmd.align(a.key)),
  })),
  ...(toLabel
    ? []
    : [
        sep,
        ...DISTRIBUTIONS.map((d) => ({
          label: d.label,
          disabled: ctx.selectedCount < 2,
          onSelect: () => ctx.cmd.distribute(d.key),
        })),
      ]),
];

/** Effects work on images and pixel layers. */
const effectItems = (ctx: MenuContext): MenuEntry[] => {
  const layer = ctx.selected && supportsEffects(ctx.selected) && ctx.selectedCount === 1 ? ctx.selected : null;
  const none = !layer;
  return [
    {
      kind: "submenu",
      label: "Add effect",
      disabled: none,
      items: EFFECT_DEFS.map((d) => ({ label: d.label, onSelect: () => ctx.cmd.addEffect(d.kind) })),
    },
    {
      kind: "submenu",
      label: "Quick looks",
      disabled: none,
      items: EFFECT_PRESETS.map((p) => ({ label: p.label, onSelect: () => ctx.cmd.applyEffectPreset(p.key) })),
    },
    { label: "Effects…", onSelect: ctx.cmd.effects, disabled: none },
    { label: "Remove all effects", onSelect: ctx.cmd.clearEffects, disabled: none || !layer?.effects?.length },
  ];
};

/** The Shape tool's shapes; right-click on the tool, or Shift+U to cycle. */
export const shapeItems = (ctx: MenuContext, current: ShapeKind): MenuEntry[] => [
  { kind: "heading", label: "Shapes · Shift+U cycles" },
  ...SHAPES.filter((s) => s.group === "basic").map((s) => ({
    label: s.label,
    checked: current === s.kind,
    onSelect: () => ctx.cmd.setShapeKind(s.kind),
  })),
  { kind: "separator" },
  { kind: "heading", label: "Custom shapes" },
  ...SHAPES.filter((s) => s.group === "custom").map((s) => ({
    label: s.label,
    checked: current === s.kind,
    onSelect: () => ctx.cmd.setShapeKind(s.kind),
  })),
];

/** Layer ▸ Layer Mask. */
const maskItems = (ctx: MenuContext): MenuEntry[] => {
  const { cmd, selected, selectedCount, hasPixelSelection } = ctx;
  const layer = selectedCount === 1 ? selected : null;
  const mask = layer?.mask;
  return [
    { label: "Reveal all", onSelect: () => cmd.addMask("reveal-all"), disabled: !layer },
    { label: "Hide all", onSelect: () => cmd.addMask("hide-all"), disabled: !layer },
    { label: "Reveal selection", onSelect: () => cmd.addMask("reveal-selection"), disabled: !layer || !hasPixelSelection },
    { label: "Hide selection", onSelect: () => cmd.addMask("hide-selection"), disabled: !layer || !hasPixelSelection },
    sep,
    {
      label: "Paint on mask",
      checked: !!layer && ctx.maskTarget === layer.id,
      onSelect: cmd.editMask,
      disabled: !mask,
    },
    { label: mask?.enabled === false ? "Enable" : "Disable", onSelect: cmd.toggleMask, disabled: !mask },
    { label: "Invert mask", onSelect: cmd.invertMask, disabled: !mask },
    { label: "Load as selection", onSelect: cmd.loadLayerMask, disabled: !mask },
    { label: "Apply", onSelect: cmd.applyMask, disabled: !mask || layer?.type !== "raster" },
    { label: "Delete", onSelect: cmd.deleteMask, disabled: !mask, danger: true },
  ];
};

/** AI actions on the selected layer's pixels. */
const generativeLayerItems = (ctx: MenuContext): MenuEntry[] => {
  const layer = ctx.selectedCount === 1 && ctx.selected && (ctx.selected.type === "image" || ctx.selected.type === "raster") ? ctx.selected : null;
  return [
    { label: "Remove background", onSelect: ctx.cmd.removeBackground, disabled: !layer || !ctx.aiCan("subject") },
    { label: "Generate similar", onSelect: ctx.cmd.generateSimilar, disabled: !layer || !ctx.aiCan("variations") },
    {
      label: "Generative expand…",
      onSelect: ctx.cmd.generativeExpand,
      disabled: layer?.type !== "image" || (!ctx.aiCan("inpaint") && !ctx.aiCan("remove")),
    },
  ];
};

const imageItems = (ctx: MenuContext): MenuEntry[] => {
  const image = ctx.selected?.type === "image" ? ctx.selected : null;
  const none = !image || ctx.selectedCount !== 1;
  const noSrc = none || !image?.src;
  return [
    { label: "Crop", shortcut: "C", onSelect: ctx.cmd.crop, disabled: noSrc },
    { label: "Clear crop", onSelect: ctx.cmd.clearCrop, disabled: none || !isCropped(image?.crop) },
    sep,
    ...effectItems(ctx),
    sep,
    { label: "Flip horizontal", onSelect: () => ctx.cmd.flip("x"), disabled: none, checked: !!image?.flipX },
    { label: "Flip vertical", onSelect: () => ctx.cmd.flip("y"), disabled: none, checked: !!image?.flipY },
    {
      kind: "submenu",
      label: "Fit in box",
      disabled: none,
      items: (
        [
          ["contain", "Contain — show it all"],
          ["cover", "Cover — fill and trim"],
          ["fill", "Stretch"],
        ] as [ImageFit, string][]
      ).map(([fit, label]) => ({ label, checked: image?.fit === fit, onSelect: () => ctx.cmd.setFit(fit) })),
    },
    sep,
    { label: image?.src ? "Replace image…" : "Choose image…", onSelect: ctx.cmd.replaceImage, disabled: none },
    sep,
    ...generativeLayerItems(ctx),
  ];
};

/** The Select menu. */
const selectItems = (ctx: MenuContext): MenuEntry[] => {
  const { cmd, hasPixelSelection } = ctx;
  const layer = ctx.selectedCount === 1 ? ctx.selected : null;
  return [
    { label: "All", shortcut: `${MOD}A`, onSelect: cmd.selectAllPixels },
    { label: "Deselect", shortcut: `${MOD}D`, onSelect: cmd.deselectPixels, disabled: !hasPixelSelection },
    { label: "Reselect", shortcut: `${MOD}${SHIFT}D`, onSelect: cmd.reselect, disabled: !ctx.canReselect },
    { label: "Inverse", shortcut: `${MOD}${SHIFT}I`, onSelect: cmd.inverse },
    sep,
    { kind: "heading", label: "AI" },
    { label: "Subject", onSelect: cmd.selectSubject, disabled: !ctx.aiCan("subject") },
    { label: "Background", onSelect: cmd.selectBackground, disabled: !ctx.aiCan("subject") },
    { label: "Sky", onSelect: cmd.selectSky, disabled: !ctx.aiCan("segment_text") },
    { label: "Objects by description…", onSelect: cmd.selectByDescription, disabled: !ctx.aiCan("segment_text") },
    sep,
    { label: "Select and Mask…", shortcut: `${MOD}${isMac ? "⌥" : "Alt+"}R`, onSelect: cmd.selectAndMask, disabled: !hasPixelSelection },
    {
      kind: "submenu",
      label: "Modify",
      disabled: !hasPixelSelection,
      items: [
        { label: "Border…", onSelect: () => cmd.modifySelection("border") },
        { label: "Smooth…", onSelect: () => cmd.modifySelection("smooth") },
        { label: "Expand…", onSelect: () => cmd.modifySelection("expand") },
        { label: "Contract…", onSelect: () => cmd.modifySelection("contract") },
        { label: "Feather…", shortcut: `${SHIFT}F6`, onSelect: () => cmd.modifySelection("feather") },
      ],
    },
    sep,
    { label: "Load from layer pixels", onSelect: cmd.loadLayerPixels, disabled: !layer },
    { label: "Load from layer mask", onSelect: cmd.loadLayerMask, disabled: !layer?.mask },
    sep,
    { kind: "heading", label: "Tools" },
    ...TOOL_FAMILIES.flatMap((f) => f.tools).map((id) => {
      const t = TOOLS.find((x) => x.id === id);
      return { label: t?.label ?? id, shortcut: t?.shortcut, checked: ctx.tool === id, onSelect: () => cmd.setTool(id) };
    }),
  ];
};

export const buildMenuBar = (ctx: MenuContext): MenuDef[] => {
  const { cmd, selected, selectedCount, workspace: ws } = ctx;
  const nothing = selectedCount === 0;
  return [
    {
      label: "File",
      items: [
        { kind: "submenu", label: "New design", items: ctx.presets.map((p) => ({ label: p.label, onSelect: () => cmd.newDesign(p) })) },
        {
          kind: "submenu",
          label: "Open design",
          items: ctx.designs.map((d) => ({
            label: d.name,
            checked: d.id === ctx.activeDesign.id,
            onSelect: () => cmd.openDesign(d.id),
          })),
        },
        {
          label: "Close tab",
          onSelect: () => cmd.closeTab(ctx.activeDesign.id),
          disabled: ctx.openIds.length <= 1,
        },
        sep,
        { label: "Place Embedded…", onSelect: cmd.placeEmbedded },
        { label: "Import…", shortcut: `${MOD}O`, onSelect: cmd.importFile },
        { label: "Export this design…", onSelect: cmd.exportActive },
        { label: "Export all designs…", onSelect: cmd.exportAll },
        sep,
        { label: "Duplicate design", onSelect: cmd.duplicateDesign },
        { label: "Delete design…", onSelect: cmd.deleteDesign, disabled: ctx.designs.length <= 1, danger: true },
        sep,
        { label: "Print…", shortcut: `${MOD}P`, onSelect: cmd.print },
      ],
    },
    {
      label: "Edit",
      items: [
        { label: "Undo", shortcut: `${MOD}Z`, onSelect: cmd.undo, disabled: !ctx.canUndo },
        { label: "Redo", shortcut: `${MOD}${SHIFT}Z`, onSelect: cmd.redo, disabled: !ctx.canRedo },
        sep,
        { label: "Duplicate", shortcut: `${MOD}D`, onSelect: cmd.duplicate, disabled: nothing },
        { label: "Delete", shortcut: "Del", onSelect: cmd.deleteSelection, disabled: nothing },
        sep,
        { label: "Select all layers", shortcut: `${MOD}A`, onSelect: cmd.selectAll },
        { label: "Deselect", shortcut: "Esc", onSelect: cmd.deselect, disabled: nothing },
        sep,
        { kind: "heading", label: "Generative AI" },
        {
          label: "Generative fill…",
          onSelect: cmd.generativeFill,
          disabled: !ctx.hasPixelSelection || (!ctx.aiCan("inpaint") && !ctx.aiCan("remove")),
        },
        {
          label: "Remove selected (no prompt)",
          onSelect: cmd.generativeRemove,
          disabled: !ctx.hasPixelSelection || (!ctx.aiCan("remove") && !ctx.aiCan("inpaint")),
        },
        { label: "Generate image…", onSelect: cmd.generateImage },
        sep,
        { label: "Appearance & workspace…", onSelect: cmd.appearance },
      ],
    },
    { label: "Image", items: imageItems(ctx) },
    {
      label: "Layer",
      items: [
        {
          kind: "submenu",
          label: "New layer",
          items: [
            { label: "Text", shortcut: "T", onSelect: () => cmd.addLayer("text") },
            { label: "Serial number", shortcut: "N", onSelect: () => cmd.addLayer("number") },
            { label: "Shape", shortcut: "U", onSelect: () => cmd.addLayer("shape") },
            { label: "Pixel layer", onSelect: cmd.newPixelLayer },
            { label: "Image (Place Embedded…)", onSelect: cmd.placeEmbedded },
            sep,
            { label: "Layer via copy", shortcut: `${MOD}J`, onSelect: cmd.layerViaCopy, disabled: !ctx.hasPixelSelection },
          ],
        },
        { kind: "submenu", label: "Layer mask", items: maskItems(ctx), disabled: selectedCount !== 1 },
        { label: "Group layers", shortcut: `${MOD}G`, onSelect: cmd.group, disabled: nothing },
        { label: "Ungroup", shortcut: `${MOD}${SHIFT}G`, onSelect: cmd.ungroup, disabled: !ctx.groupSelected },
        sep,
        ...effectItems(ctx),
        { label: "Layer properties…", onSelect: () => cmd.properties(), disabled: selectedCount !== 1 },
        {
          label: selected?.visible === false ? "Show layer" : "Hide layer",
          onSelect: cmd.toggleVisible,
          disabled: selectedCount !== 1,
        },
        sep,
        { kind: "submenu", label: "Arrange", items: arrangeItems(ctx, nothing), disabled: nothing },
        {
          kind: "submenu",
          label: selectedCount > 1 ? "Align selection" : "Align to label",
          items: alignItems(ctx, false, nothing),
          disabled: nothing,
        },
      ],
    },
    { label: "Select", items: selectItems(ctx) },
    {
      label: "View",
      items: [
        { label: "Zoom in", shortcut: "+", onSelect: cmd.zoomIn },
        { label: "Zoom out", shortcut: "−", onSelect: cmd.zoomOut },
        { label: "Fit on screen", shortcut: "0", onSelect: cmd.fit },
        { label: "Actual size", shortcut: `${MOD}1`, onSelect: cmd.actualSize },
        sep,
        { label: "Grid", shortcut: "G", checked: ctx.showGrid, onSelect: cmd.toggleGrid },
        { label: "Snap to grid", checked: ctx.snap, onSelect: cmd.toggleSnap },
        { label: "Layer edges", checked: ws.showLayerEdges, onSelect: cmd.toggleEdges },
        sep,
        { label: "Hide all panels", shortcut: "F", checked: ws.focusMode, onSelect: cmd.toggleFocus },
      ],
    },
    {
      label: "Window",
      items: [
        { kind: "heading", label: "Panels" },
        ...(Object.keys(PANEL_TITLES) as PanelId[]).map((id) => ({
          label: PANEL_TITLES[id],
          checked: ws.panels[id].visible && !ws.focusMode,
          onSelect: () => cmd.togglePanel(id),
        })),
        sep,
        { kind: "heading", label: "Bars" },
        { label: "Tools", checked: ws.showToolbar, onSelect: () => cmd.toggleBar("showToolbar") },
        { label: "Tool options", checked: ws.showOptionsBar, onSelect: () => cmd.toggleBar("showOptionsBar") },
        { label: "Document tabs", checked: ws.showTabs, onSelect: () => cmd.toggleBar("showTabs") },
        { label: "Status bar", checked: ws.showStatusBar, onSelect: () => cmd.toggleBar("showStatusBar") },
        sep,
        { label: "Appearance & workspace…", onSelect: cmd.appearance },
        { label: "Reset workspace", onSelect: cmd.resetWorkspace },
      ],
    },
    {
      label: "Help",
      items: [
        { label: "Keyboard shortcuts", shortcut: "?", onSelect: cmd.shortcuts },
        sep,
        { kind: "heading", label: "Tools" },
        ...TOOLS.map((t) => ({
          label: `${t.label} tool`,
          shortcut: t.shortcut,
          checked: ctx.tool === t.id,
          onSelect: () => cmd.setTool(t.id),
        })),
      ],
    },
  ];
};

/** Right-click on one or more layers. */
export const buildLayerMenu = (ctx: MenuContext): MenuEntry[] => {
  const { cmd, selected, selectedCount, groupSelected } = ctx;
  if (!selected && !groupSelected) return [];
  const multi = selectedCount > 1;
  const typeItems: MenuEntry[] = [];
  if (!multi && selected) {
    if (selected.type === "text") {
      typeItems.push(
        { label: "Edit text…", onSelect: () => cmd.properties("text") },
        { label: "Character…", onSelect: () => cmd.properties("character") },
        { label: "Paragraph…", onSelect: () => cmd.properties("paragraph") },
        sep
      );
    } else if (selected.type === "number") {
      typeItems.push(
        { label: "Numbering…", onSelect: () => cmd.properties("numbering") },
        { label: "Character…", onSelect: () => cmd.properties("character") },
        sep
      );
    } else if (selected.type === "shape") {
      typeItems.push(
        { label: "Shape…", onSelect: () => cmd.properties("shape") },
        { label: "Fill…", onSelect: () => cmd.properties("fill") },
        { label: "Stroke…", onSelect: () => cmd.properties("border") },
        sep
      );
    } else if (selected.type === "image") {
      typeItems.push({ kind: "submenu", label: "Image", items: imageItems(ctx) }, sep);
    } else if (selected.type === "raster") {
      typeItems.push(...effectItems(ctx), sep, ...generativeLayerItems(ctx), sep);
    }
    typeItems.push({ kind: "submenu", label: "Layer mask", items: maskItems(ctx) }, sep);
  }
  const visibleLabel = groupSelected ? "Show / hide group" : selected?.visible ? "Hide layer" : "Show layer";
  return [
    ...(multi ? [{ kind: "heading" as const, label: `${selectedCount} items` }] : []),
    ...typeItems,
    ...(!multi
      ? [
          {
            label: groupSelected ? "Group properties…" : "Layer properties…",
            onSelect: () => cmd.properties(groupSelected ? "group" : "layer"),
          },
        ]
      : []),
    { label: "Duplicate", shortcut: `${MOD}D`, onSelect: cmd.duplicate },
    { label: "Delete", shortcut: "Del", onSelect: cmd.deleteSelection, danger: true },
    ...(!multi ? [{ label: visibleLabel, onSelect: cmd.toggleVisible }] : []),
    sep,
    { label: "Group layers", shortcut: `${MOD}G`, onSelect: cmd.group },
    ...(groupSelected ? [{ label: "Ungroup", shortcut: `${MOD}${SHIFT}G`, onSelect: cmd.ungroup }] : []),
    sep,
    { kind: "submenu", label: "Arrange", items: arrangeItems(ctx, false) },
    ...(multi
      ? [{ kind: "submenu" as const, label: "Align selection", items: alignItems(ctx, false, false) }]
      : []),
    { kind: "submenu", label: "Align to label", items: alignItems(ctx, true, false) },
  ];
};

/** Right-click on an effect row in the Layers panel. */
export const buildEffectMenu = (
  actions: { toggle: () => void; duplicate: () => void; remove: () => void; open: () => void },
  enabled: boolean
): MenuEntry[] => [
  { label: enabled ? "Turn effect off" : "Turn effect on", onSelect: actions.toggle },
  { label: "Duplicate effect", onSelect: actions.duplicate },
  { label: "Delete effect", onSelect: actions.remove, danger: true },
  { kind: "separator" },
  { label: "Edit in Properties…", onSelect: actions.open },
];

/** Right-click on empty canvas. */
export const buildCanvasMenu = (ctx: MenuContext): MenuEntry[] => {
  const { cmd } = ctx;
  const selectionMenu: MenuEntry[] = ctx.hasPixelSelection
    ? [
        { label: "Deselect", onSelect: cmd.deselectPixels },
        { label: "Select inverse", onSelect: cmd.inverse },
        { label: "Select and Mask…", onSelect: cmd.selectAndMask },
        { label: "Feather…", onSelect: () => cmd.modifySelection("feather") },
        { label: "Layer via copy", onSelect: cmd.layerViaCopy },
        { label: "Generative fill…", onSelect: cmd.generativeFill, disabled: !ctx.aiCan("inpaint") && !ctx.aiCan("remove") },
        { label: "Remove", onSelect: cmd.generativeRemove, disabled: !ctx.aiCan("remove") && !ctx.aiCan("inpaint") },
        sep,
      ]
    : [];
  return [
    ...selectionMenu,
    { label: "Place Embedded…", onSelect: cmd.placeEmbedded },
    {
      kind: "submenu",
      label: "New layer",
      items: [
        { label: "Text", onSelect: () => cmd.addLayer("text") },
        { label: "Serial number", onSelect: () => cmd.addLayer("number") },
        { label: "Shape", onSelect: () => cmd.addLayer("shape") },
        { label: "Pixel layer", onSelect: cmd.newPixelLayer },
      ],
    },
    sep,
    { label: "Select all layers", shortcut: `${MOD}A`, onSelect: cmd.selectAll },
    { label: "Undo", shortcut: `${MOD}Z`, onSelect: cmd.undo, disabled: !ctx.canUndo },
    sep,
    { label: "Fit on screen", shortcut: "0", onSelect: cmd.fit },
    { label: "Actual size", shortcut: `${MOD}1`, onSelect: cmd.actualSize },
    { label: "Grid", shortcut: "G", checked: ctx.showGrid, onSelect: cmd.toggleGrid },
    { label: "Snap to grid", checked: ctx.snap, onSelect: cmd.toggleSnap },
    sep,
    { label: "Label properties…", onSelect: () => cmd.properties("document") },
  ];
};

/** Right-click on a tool button. */
export const buildToolMenu = (ctx: MenuContext, tool: ToolId, resetDefaults: () => void): MenuEntry[] => {
  const def = TOOLS.find((t) => t.id === tool);
  const hasDefaults = tool === "text" || tool === "number" || tool === "shape" || tool === "brush";
  const family = TOOL_FAMILIES.find((f) => f.tools.includes(tool));
  if (family) {
    return [
      { kind: "heading", label: `${family.label} · Shift+${def?.shortcut ?? ""} cycles` },
      ...family.tools.map((id) => {
        const t = TOOLS.find((x) => x.id === id);
        return { label: t?.label ?? id, shortcut: t?.shortcut, checked: ctx.tool === id, onSelect: () => ctx.cmd.setTool(id) };
      }),
      sep,
      { label: "Show tool options bar", checked: ctx.workspace.showOptionsBar, onSelect: () => ctx.cmd.toggleBar("showOptionsBar") },
    ];
  }
  return [
    { kind: "heading", label: `${def?.label ?? ""} tool · ${def?.shortcut ?? ""}` },
    { label: "Use this tool", onSelect: () => ctx.cmd.setTool(tool), checked: ctx.tool === tool },
    ...(hasDefaults ? [{ label: "Reset tool defaults", onSelect: resetDefaults }] : []),
    sep,
    { label: "Show tool options bar", checked: ctx.workspace.showOptionsBar, onSelect: () => ctx.cmd.toggleBar("showOptionsBar") },
    { label: "Keyboard shortcuts…", onSelect: ctx.cmd.shortcuts },
  ];
};

/** Right-click on a layer's mask thumbnail. */
export const buildMaskMenu = (ctx: MenuContext): MenuEntry[] => [
  { kind: "heading", label: "Layer mask" },
  ...maskItems(ctx).filter((item) => !("label" in item) || !["Reveal all", "Hide all"].includes(item.label)),
];
