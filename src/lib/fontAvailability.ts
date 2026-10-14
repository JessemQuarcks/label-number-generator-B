import type { LabelDesign } from "../types";
import { facesUsedBy } from "./fontLoader";

/**
 * Detects families the current machine cannot render.
 *
 * A missing family is NOT a loading problem — waiting never fixes it. The
 * browser silently substitutes the next entry in the stack, which has a
 * different advance width, so text wraps differently and may overflow its box.
 * On a millimetre canvas destined for physical stock, that is a defect you
 * would otherwise only discover after printing.
 *
 * `document.fonts.check()` cannot be used for this: it answers "is this stack
 * ready to use", and a stack is always ready because it always falls back. It
 * returns true even for a family name that does not exist anywhere.
 *
 * So availability is measured instead: render a probe string in the candidate
 * family backed by a generic base, and compare against the base alone. If the
 * family is absent the two measure identically. The comparison runs against
 * three different bases because a font that happens to match one base's
 * metrics is unlikely to match all three.
 */

/** Mixes wide, narrow and symbol glyphs so metric differences show up. */
const PROBE_TEXT = "mmmmmmmmmmlliWWWWWW@@@@";
const PROBE_SIZE = 72;
const BASES = ["monospace", "serif", "sans-serif"] as const;
/** Sub-pixel noise is not a real difference. */
const EPSILON = 0.5;

type Ctx = CanvasRenderingContext2D;

let sharedCtx: Ctx | null | undefined;

const getCtx = (): Ctx | null => {
  if (sharedCtx !== undefined) return sharedCtx;
  try {
    sharedCtx = document.createElement("canvas").getContext("2d");
  } catch {
    sharedCtx = null;
  }
  return sharedCtx;
};

/** Quote a family name for use in a canvas font shorthand. */
const quote = (family: string): string =>
  /^["']/.test(family) ? family : `"${family}"`;

/**
 * Is a single family name renderable here?
 *
 * Generic keywords always resolve to something real, so they are available by
 * definition.
 */
export const isFamilyAvailable = (family: string): boolean => {
  const name = family.trim().replace(/^["']|["']$/g, "");
  if (!name) return false;
  if (BASES.includes(name.toLowerCase() as (typeof BASES)[number])) return true;
  if (/^(cursive|fantasy|system-ui|ui-[\w-]+|math|emoji)$/i.test(name)) return true;

  const ctx = getCtx();
  // With no canvas (or no DOM) we cannot tell, so do not cry wolf.
  if (!ctx) return true;

  return BASES.some((base) => {
    ctx.font = `${PROBE_SIZE}px ${base}`;
    const baseline = ctx.measureText(PROBE_TEXT).width;
    ctx.font = `${PROBE_SIZE}px ${quote(name)}, ${base}`;
    const candidate = ctx.measureText(PROBE_TEXT).width;
    return Math.abs(candidate - baseline) > EPSILON;
  });
};

/** Split a CSS font stack into its individual family names. */
export const splitStack = (stack: string): string[] =>
  stack
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

export interface FontWarning {
  /** The full stack as authored on the element. */
  stack: string;
  /** The family that was asked for and is missing — the first in the stack. */
  requested: string;
  /** The family that will actually be used, if any is available. */
  substitute: string | null;
  /** Names of the elements affected. */
  elements: string[];
}

/**
 * Families a design asks for that this machine cannot render.
 *
 * Only the FIRST family in each stack is reported: the later entries are
 * declared fallbacks, so using one is the stack working as intended. What
 * matters is that the author's actual choice is not what will print.
 */
export const findMissingFonts = (design: LabelDesign): FontWarning[] => {
  const uploaded = new Set(
    (design.fonts ?? []).map((f) => f.family.trim().toLowerCase())
  );

  const byStack = new Map<string, FontWarning>();

  for (const element of design.elements) {
    if (element.type !== "text" && element.type !== "number") continue;
    if (!element.visible) continue;

    const stack = element.typography.fontFamily;
    const families = splitStack(stack);
    if (families.length === 0) continue;

    const [requested, ...fallbacks] = families;

    // A font uploaded with the design travels with it, so it is available
    // wherever the design goes even if the machine lacks it system-wide.
    if (uploaded.has(requested.toLowerCase())) continue;
    if (isFamilyAvailable(requested)) continue;

    const existing = byStack.get(stack);
    if (existing) {
      existing.elements.push(element.name);
      continue;
    }

    byStack.set(stack, {
      stack,
      requested,
      substitute:
        fallbacks.find(
          (f) => uploaded.has(f.toLowerCase()) || isFamilyAvailable(f)
        ) ?? null,
      elements: [element.name],
    });
  }

  return [...byStack.values()];
};

/** Re-measure on the next check; call after registering uploaded fonts. */
export const resetAvailabilityCache = (): void => {
  sharedCtx = undefined;
};

/** Every distinct family a design references, for diagnostics. */
export const familiesUsedBy = (design: LabelDesign): string[] => {
  const all = new Set<string>();
  for (const face of facesUsedBy(design)) {
    for (const family of splitStack(face.family)) all.add(family);
  }
  return [...all];
};
