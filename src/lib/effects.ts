import type { EffectKind, LabelElement, LayerEffect } from "../types";
import { newId } from "./units";

export interface EffectDef {
  kind: EffectKind;
  label: string;
  /** The amount slider. */
  min: number;
  max: number;
  step: number;
  suffix: string;
  /** Amount a freshly added effect starts at — visibly doing something. */
  initial: number;
  /** Amount at which the effect does nothing. */
  neutral: number;
}

export const EFFECT_DEFS: EffectDef[] = [
  { kind: "brightness", label: "Brightness", min: 0, max: 300, step: 1, suffix: "%", initial: 120, neutral: 100 },
  { kind: "contrast", label: "Contrast", min: 0, max: 300, step: 1, suffix: "%", initial: 120, neutral: 100 },
  { kind: "saturation", label: "Saturation", min: 0, max: 300, step: 1, suffix: "%", initial: 140, neutral: 100 },
  { kind: "hue", label: "Hue shift", min: -180, max: 180, step: 1, suffix: "°", initial: 30, neutral: 0 },
  { kind: "grayscale", label: "Greyscale", min: 0, max: 100, step: 1, suffix: "%", initial: 100, neutral: 0 },
  { kind: "sepia", label: "Sepia", min: 0, max: 100, step: 1, suffix: "%", initial: 80, neutral: 0 },
  { kind: "invert", label: "Invert", min: 0, max: 100, step: 1, suffix: "%", initial: 100, neutral: 0 },
  { kind: "blur", label: "Blur", min: 0, max: 5, step: 0.05, suffix: "mm", initial: 0.3, neutral: 0 },
  { kind: "dropShadow", label: "Drop shadow", min: 0, max: 100, step: 1, suffix: "%", initial: 60, neutral: 0 },
  { kind: "glow", label: "Outer glow", min: 0, max: 100, step: 1, suffix: "%", initial: 80, neutral: 0 },
];

export const effectDef = (kind: EffectKind): EffectDef =>
  EFFECT_DEFS.find((d) => d.kind === kind) ?? EFFECT_DEFS[0];

export const hasShadowParams = (kind: EffectKind) => kind === "dropShadow" || kind === "glow";

/** Layer types that carry an effect stack. */
export const supportsEffects = (el: LabelElement): el is Extract<LabelElement, { effects?: LayerEffect[] }> =>
  el.type === "image" || el.type === "raster";

export const createEffect = (kind: EffectKind, amount?: number): LayerEffect => {
  const def = effectDef(kind);
  const base: LayerEffect = { id: newId(), kind, enabled: true, amount: amount ?? def.initial };
  if (kind === "dropShadow") return { ...base, offsetX: 0.8, offsetY: 0.8, radius: 1, color: "#000000" };
  if (kind === "glow") return { ...base, offsetX: 0, offsetY: 0, radius: 1.5, color: "#ffd84d" };
  return base;
};

const hexToRgba = (hex: string, alpha: number) => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex ?? "");
  const n = m ? Number.parseInt(m[1], 16) : 0;
  const a = Math.min(Math.max(alpha, 0), 1);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${Math.round(a * 1000) / 1000})`;
};

/** One effect as a CSS filter function, or null when it would do nothing. */
export const effectToCss = (e: LayerEffect): string | null => {
  if (!e.enabled) return null;
  const def = effectDef(e.kind);
  if (e.amount === def.neutral) return null;
  switch (e.kind) {
    case "brightness":
      return `brightness(${e.amount}%)`;
    case "contrast":
      return `contrast(${e.amount}%)`;
    case "saturation":
      return `saturate(${e.amount}%)`;
    case "hue":
      return `hue-rotate(${e.amount}deg)`;
    case "grayscale":
      return `grayscale(${e.amount}%)`;
    case "sepia":
      return `sepia(${e.amount}%)`;
    case "invert":
      return `invert(${e.amount}%)`;
    case "blur":
      return `blur(${e.amount}mm)`;
    case "dropShadow":
    case "glow":
      // mm units, so the shadow prints at the same physical size.
      return `drop-shadow(${e.offsetX ?? 0}mm ${e.offsetY ?? 0}mm ${e.radius ?? 1}mm ${hexToRgba(
        e.color ?? "#000000",
        e.amount / 100
      )})`;
  }
};

/** The whole stack as a CSS `filter`, applied bottom (first) to top (last). */
export const effectsToCss = (effects: LayerEffect[] | undefined): string | undefined => {
  const parts = (effects ?? []).map(effectToCss).filter((p): p is string => !!p);
  return parts.length ? parts.join(" ") : undefined;
};

export interface EffectPreset {
  key: string;
  label: string;
  effects: [EffectKind, number][];
}

/** One-click looks; applying one adds its effects to the stack. */
export const EFFECT_PRESETS: EffectPreset[] = [
  { key: "bw", label: "Black & white", effects: [["grayscale", 100], ["contrast", 110]] },
  { key: "sepia", label: "Sepia", effects: [["sepia", 80], ["contrast", 105]] },
  { key: "vivid", label: "Vivid", effects: [["saturation", 150], ["contrast", 115]] },
  { key: "muted", label: "Muted", effects: [["saturation", 60], ["brightness", 105]] },
  { key: "invert", label: "Invert colours", effects: [["invert", 100]] },
];

export const presetEffects = (key: string): LayerEffect[] =>
  (EFFECT_PRESETS.find((p) => p.key === key)?.effects ?? []).map(([kind, amount]) => createEffect(kind, amount));

/** A copy placed right after the original, with a fresh id. */
export const duplicateEffect = (effects: LayerEffect[], id: string): LayerEffect[] => {
  const at = effects.findIndex((e) => e.id === id);
  if (at === -1) return effects;
  const copy = { ...effects[at], id: newId() };
  return [...effects.slice(0, at + 1), copy, ...effects.slice(at + 1)];
};

/**
 * Convert the old single "adjustments" object into an effect stack plus a
 * layer opacity, so designs saved before effect stacks keep their look.
 */
export const migrateAdjustments = (
  adjust: Record<string, unknown>
): { effects: LayerEffect[]; opacity?: number } => {
  const num = (k: string, fallback: number) =>
    typeof adjust[k] === "number" && Number.isFinite(adjust[k]) ? (adjust[k] as number) : fallback;
  const map: [string, EffectKind, number][] = [
    ["brightness", "brightness", 100],
    ["contrast", "contrast", 100],
    ["saturation", "saturation", 100],
    ["hue", "hue", 0],
    ["grayscale", "grayscale", 0],
    ["sepia", "sepia", 0],
    ["invert", "invert", 0],
  ];
  const effects: LayerEffect[] = [];
  for (const [key, kind, neutral] of map) {
    const v = num(key, neutral);
    if (v !== neutral) effects.push(createEffect(kind, v));
  }
  // The old blur was in CSS px; 1px ≈ 0.2646mm.
  const blurPx = num("blur", 0);
  if (blurPx > 0) effects.push(createEffect("blur", Math.round(blurPx * 0.2646 * 100) / 100));
  const opacity = num("opacity", 100);
  return { effects, ...(opacity !== 100 ? { opacity } : {}) };
};
