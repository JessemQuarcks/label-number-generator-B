import type {
  AppState,
  Border,
  CustomFont,
  EffectKind,
  ImageCrop,
  LabelDesign,
  LabelElement,
  LayerEffect,
  LayerGroup,
  PrintSettings,
  Typography,
} from "../types";
import { DEFAULT_BORDER, DEFAULT_PRINT, DEFAULT_TYPOGRAPHY } from "./defaults";
import {
  asBoolean,
  asCssValue,
  asEnum,
  asFontFamily,
  asFontSrc,
  asImageSrc,
  asInteger,
  asNonNegative,
  asNumber,
  asPositive,
  asString,
  isRecord,
} from "./sanitize";
import { newId } from "./units";
import { isCropped, MIN_CROP_FRACTION } from "./imageEdit";
import { EFFECT_DEFS, effectDef, migrateAdjustments } from "./effects";
import { SHAPE_KINDS } from "./shapes";
import { RASTER_MAX_PX } from "./raster";
import { canonicalize } from "./layers";

export const STORAGE_KEY = "label-number-generator:state:v1";

/** Hard bounds — a label larger than this is almost certainly a bad import. */
export const MIN_SIZE_MM = 1;
export const MAX_SIZE_MM = 2000;
export const MAX_COUNT = 5000;
export const MAX_ELEMENTS = 200;
export const MAX_DESIGNS = 100;
export const MAX_FONTS = 12;
export const MAX_GROUPS = 100;
export const MAX_EFFECTS = 20;

const BORDER_STYLES = [
  "none",
  "solid",
  "dashed",
  "dotted",
  "double",
  "groove",
  "ridge",
] as const;
const ALIGNS = ["left", "center", "right", "justify"] as const;
const V_ALIGNS = ["top", "middle", "bottom"] as const;
const TRANSFORMS = ["none", "uppercase", "lowercase", "capitalize"] as const;
const FITS = ["contain", "cover", "fill"] as const;
const UNITS = ["mm", "cm"] as const;

const normalizeBorder = (value: unknown, fallback: Border = DEFAULT_BORDER): Border => {
  if (!isRecord(value)) return { ...fallback };
  return {
    style: asEnum(value.style, BORDER_STYLES, fallback.style),
    width: Math.min(asNonNegative(value.width, fallback.width), 100),
    color: asCssValue(value.color, fallback.color),
    radius: Math.min(asNonNegative(value.radius, fallback.radius), MAX_SIZE_MM),
  };
};

/** Snap an arbitrary number to the nearest CSS font weight step (100–900). */
const normalizeWeight = (value: unknown): number => {
  const n = asNumber(value, DEFAULT_TYPOGRAPHY.fontWeight);
  const snapped = Math.round(n / 100) * 100;
  return Math.min(Math.max(snapped, 100), 900);
};

const normalizeTypography = (value: unknown): Typography => {
  if (!isRecord(value)) return { ...DEFAULT_TYPOGRAPHY };
  return {
    fontFamily: asCssValue(value.fontFamily, DEFAULT_TYPOGRAPHY.fontFamily, 200),
    fontSize: Math.min(asPositive(value.fontSize, DEFAULT_TYPOGRAPHY.fontSize), 400),
    fontWeight: normalizeWeight(value.fontWeight),
    italic: asBoolean(value.italic, DEFAULT_TYPOGRAPHY.italic),
    underline: asBoolean(value.underline, DEFAULT_TYPOGRAPHY.underline),
    color: asCssValue(value.color, DEFAULT_TYPOGRAPHY.color),
    align: asEnum(value.align, ALIGNS, DEFAULT_TYPOGRAPHY.align),
    verticalAlign: asEnum(value.verticalAlign, V_ALIGNS, DEFAULT_TYPOGRAPHY.verticalAlign),
    letterSpacing: Math.min(
      Math.max(asNumber(value.letterSpacing, DEFAULT_TYPOGRAPHY.letterSpacing), -50),
      100
    ),
    lineHeight: Math.min(asPositive(value.lineHeight, DEFAULT_TYPOGRAPHY.lineHeight), 10),
    textTransform: asEnum(value.textTransform, TRANSFORMS, DEFAULT_TYPOGRAPHY.textTransform),
  };
};

/**
 * A crop is four fractions of the full frame. Anything that would leave less
 * than a sliver visible is rejected outright rather than rendering nothing.
 */
const normalizeCrop = (value: unknown): ImageCrop | undefined => {
  if (!isRecord(value)) return undefined;
  const inset = (n: unknown) => Math.min(Math.max(asNumber(n, 0), 0), 1);
  const crop = {
    left: inset(value.left),
    top: inset(value.top),
    right: inset(value.right),
    bottom: inset(value.bottom),
  };
  if (1 - crop.left - crop.right < MIN_CROP_FRACTION) return undefined;
  if (1 - crop.top - crop.bottom < MIN_CROP_FRACTION) return undefined;
  return isCropped(crop) ? crop : undefined;
};

const EFFECT_KINDS = EFFECT_DEFS.map((d) => d.kind) as EffectKind[];

const normalizeEffect = (value: unknown): LayerEffect | null => {
  if (!isRecord(value)) return null;
  const kind = asEnum(value.kind, EFFECT_KINDS, "brightness");
  if (value.kind !== kind) return null;
  const def = effectDef(kind);
  const effect: LayerEffect = {
    id: asString(value.id, newId(), 100) || newId(),
    kind,
    enabled: asBoolean(value.enabled, true),
    amount: Math.min(Math.max(asNumber(value.amount, def.initial), def.min), def.max),
  };
  if (kind === "dropShadow" || kind === "glow") {
    effect.offsetX = Math.min(Math.max(asNumber(value.offsetX, 0), -50), 50);
    effect.offsetY = Math.min(Math.max(asNumber(value.offsetY, 0), -50), 50);
    effect.radius = Math.min(asNonNegative(value.radius, 1), 50);
    const color = typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color : "#000000";
    effect.color = color;
  }
  return effect;
};

/**
 * The effect stack. Designs saved before stacks carry one `adjust` object
 * instead; it is converted so they keep their look.
 */
const normalizeEffects = (value: Record<string, unknown>): { effects?: LayerEffect[]; opacity?: number } => {
  if (Array.isArray(value.effects)) {
    const effects = value.effects
      .slice(0, MAX_EFFECTS)
      .map(normalizeEffect)
      .filter((e): e is LayerEffect => e !== null);
    return effects.length ? { effects } : {};
  }
  if (isRecord(value.adjust)) {
    const migrated = migrateAdjustments(value.adjust);
    return {
      ...(migrated.effects.length ? { effects: migrated.effects } : {}),
      ...(migrated.opacity !== undefined ? { opacity: Math.min(Math.max(migrated.opacity, 0), 100) } : {}),
    };
  }
  return {};
};

const normalizeGroup = (value: unknown): LayerGroup | null => {
  if (!isRecord(value)) return null;
  const id = asString(value.id, "", 100);
  if (!id) return null;
  const parentId = asString(value.parentId, "", 100);
  return {
    id,
    name: asString(value.name, "Group", 120) || "Group",
    visible: asBoolean(value.visible, true),
    collapsed: asBoolean(value.collapsed, false),
    ...(parentId ? { parentId } : {}),
  };
};

const normalizeElement = (value: unknown): LabelElement | null => {
  if (!isRecord(value)) return null;
  const type = asEnum(value.type, ["text", "number", "image", "shape", "raster"] as const, "text");

  const base = {
    id: asString(value.id, newId(), 100) || newId(),
    name: asString(value.name, "Element", 120),
    x: Math.min(Math.max(asNumber(value.x, 0), -MAX_SIZE_MM), MAX_SIZE_MM),
    y: Math.min(Math.max(asNumber(value.y, 0), -MAX_SIZE_MM), MAX_SIZE_MM),
    width: Math.min(asPositive(value.width, 20), MAX_SIZE_MM),
    height: Math.min(asPositive(value.height, 10), MAX_SIZE_MM),
    rotation: Math.min(Math.max(asNumber(value.rotation, 0), -360), 360),
    visible: asBoolean(value.visible, true),
    ...(typeof value.groupId === "string" && value.groupId ? { groupId: value.groupId.slice(0, 100) } : {}),
    ...(typeof value.opacity === "number" && Number.isFinite(value.opacity) && value.opacity !== 100
      ? { opacity: Math.min(Math.max(value.opacity, 0), 100) }
      : {}),
  };

  switch (type) {
    case "text":
      return {
        ...base,
        type: "text",
        text: asString(value.text, "", 5000),
        typography: normalizeTypography(value.typography),
      };
    case "number":
      return {
        ...base,
        type: "number",
        prefix: asString(value.prefix, "", 40),
        suffix: asString(value.suffix, "", 40),
        padTo: Math.min(asInteger(value.padTo, 3, 0), 12),
        typography: normalizeTypography(value.typography),
      };
    case "image": {
      const crop = normalizeCrop(value.crop);
      const { effects, opacity } = normalizeEffects(value);
      return {
        ...base,
        ...(opacity !== undefined && base.opacity === undefined ? { opacity } : {}),
        type: "image",
        src: asImageSrc(value.src, ""),
        fit: asEnum(value.fit, FITS, "contain"),
        // Optional fields are only written when set, so older saves and the
        // default case round-trip unchanged.
        ...(crop ? { crop } : {}),
        ...(effects ? { effects } : {}),
        ...(value.flipX === true ? { flipX: true } : {}),
        ...(value.flipY === true ? { flipY: true } : {}),
      };
    }
    case "shape": {
      const shape = asEnum(value.shape, SHAPE_KINDS, "rectangle");
      return {
        ...base,
        type: "shape",
        ...(shape !== "rectangle" ? { shape } : {}),
        ...(typeof value.sides === "number" ? { sides: Math.min(Math.max(Math.round(value.sides), 3), 64) } : {}),
        ...(typeof value.innerRadius === "number"
          ? { innerRadius: Math.min(Math.max(value.innerRadius, 5), 95) }
          : {}),
        fill: asCssValue(value.fill, "#e5e7eb"),
        border: normalizeBorder(value.border, { ...DEFAULT_BORDER, style: "none", width: 0 }),
      };
    }
    case "raster": {
      const src = asImageSrc(value.src, "");
      const { effects } = normalizeEffects(value);
      return {
        ...base,
        type: "raster",
        // Pixel layers only ever hold embedded PNG data, never a URL.
        src: /^data:image\/png;base64,/i.test(src) ? src : "",
        pxWidth: Math.min(Math.max(asInteger(value.pxWidth, 1, 1), 1), RASTER_MAX_PX),
        pxHeight: Math.min(Math.max(asInteger(value.pxHeight, 1, 1), 1), RASTER_MAX_PX),
        ...(effects ? { effects } : {}),
      };
    }
  }
};

const WEIGHT_PATTERN = /^(normal|bold|[1-9]00( [1-9]00)?)$/;

const normalizeFont = (value: unknown): CustomFont | null => {
  if (!isRecord(value)) return null;
  const src = asFontSrc(value.src, "");
  const family = asFontFamily(value.family, "");
  // A font with no usable file or no name can never resolve, so drop it
  // rather than register a face that silently does nothing.
  if (!src || !family) return null;
  const weight = asString(value.weight, "normal", 20);
  return {
    id: asString(value.id, newId(), 100) || newId(),
    family,
    src,
    weight: WEIGHT_PATTERN.test(weight) ? weight : "normal",
    style: value.style === "italic" ? "italic" : "normal",
  };
};

export const normalizeDesign = (value: unknown): LabelDesign | null => {
  if (!isRecord(value)) return null;
  const elements = Array.isArray(value.elements)
    ? value.elements
        .slice(0, MAX_ELEMENTS)
        .map(normalizeElement)
        .filter((e): e is LabelElement => e !== null)
    : [];
  const fonts = Array.isArray(value.fonts)
    ? value.fonts
        .slice(0, MAX_FONTS)
        .map(normalizeFont)
        .filter((f): f is CustomFont => f !== null)
    : [];
  const rawGroups = Array.isArray(value.groups)
    ? value.groups
        .slice(0, MAX_GROUPS)
        .map(normalizeGroup)
        .filter((g): g is LayerGroup => g !== null)
    : [];
  // Repairs dangling group references, cycles and split groups.
  const layers = canonicalize({ elements, groups: rawGroups });

  return {
    id: asString(value.id, newId(), 100) || newId(),
    name: asString(value.name, "Imported label", 120) || "Imported label",
    width: Math.min(Math.max(asPositive(value.width, 120), MIN_SIZE_MM), MAX_SIZE_MM),
    height: Math.min(Math.max(asPositive(value.height, 90), MIN_SIZE_MM), MAX_SIZE_MM),
    unit: asEnum(value.unit, UNITS, "mm"),
    background: asCssValue(value.background, "#ffffff"),
    border: normalizeBorder(value.border),
    elements: layers.elements,
    fonts,
    // Only written when used, so older saves round-trip unchanged.
    ...(layers.groups.length ? { groups: layers.groups } : {}),
  };
};

const normalizePrint = (value: unknown): PrintSettings => {
  if (!isRecord(value)) return { ...DEFAULT_PRINT };
  return {
    startNumber: Math.min(asInteger(value.startNumber, DEFAULT_PRINT.startNumber, 0), 10 ** 9),
    count: Math.min(
      Math.max(asInteger(value.count, DEFAULT_PRINT.count, 1), 1),
      MAX_COUNT
    ),
    gap: Math.min(asNonNegative(value.gap, DEFAULT_PRINT.gap), 200),
  };
};

export const normalizeState = (value: unknown): AppState | null => {
  if (!isRecord(value)) return null;
  const rawDesigns = Array.isArray(value.designs) ? value.designs : [];
  const designs = rawDesigns
    .slice(0, MAX_DESIGNS)
    .map(normalizeDesign)
    .filter((d): d is LabelDesign => d !== null);
  if (designs.length === 0) return null;

  const activeId = asString(value.activeId, "", 100);
  return {
    version: 1,
    designs,
    activeId: designs.some((d) => d.id === activeId) ? activeId : designs[0].id,
    print: normalizePrint(value.print),
  };
};

export const loadState = (): AppState | null => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch {
    // Corrupt or unavailable storage: start fresh rather than crashing.
    return null;
  }
};

export const saveState = (state: AppState): void => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Quota exceeded or storage blocked (private mode) — designs stay in memory.
  }
};

export interface ImportResult {
  designs: LabelDesign[];
  print?: PrintSettings;
}

/**
 * Accepts either a full exported state (`{ version, designs, ... }`), a bare
 * array of designs, or a single design object.
 */
export const parseImport = (text: string): ImportResult => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("That file is not valid JSON.");
  }

  if (Array.isArray(parsed)) {
    const designs = parsed
      .slice(0, MAX_DESIGNS)
      .map(normalizeDesign)
      .filter((d): d is LabelDesign => d !== null);
    if (!designs.length) throw new Error("No usable label designs found in that file.");
    return { designs };
  }

  if (isRecord(parsed) && Array.isArray(parsed.designs)) {
    const state = normalizeState(parsed);
    if (!state) throw new Error("No usable label designs found in that file.");
    return { designs: state.designs, print: state.print };
  }

  const single = normalizeDesign(parsed);
  if (!single) throw new Error("No usable label designs found in that file.");
  return { designs: [single] };
};

export const exportState = (designs: LabelDesign[], print: PrintSettings): string =>
  JSON.stringify({ version: 1, designs, print }, null, 2);
