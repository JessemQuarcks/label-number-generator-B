import type { CustomFont, LabelDesign } from "../types";

/**
 * Font readiness for the label canvas and for printing.
 *
 * Two separate problems are solved here:
 *
 * 1. Uploaded fonts must be registered with the document before a label is
 *    rendered, or the first paint shows a fallback at the wrong advance width.
 * 2. `document.fonts.ready` is NOT sufficient on its own. It resolves once the
 *    fonts the browser has *chosen* to load are done, but CSS font loading is
 *    lazy: a family referenced only by a not-yet-painted element may not have
 *    started loading at all. So before printing we explicitly `load()` every
 *    family/weight/style combination the design actually uses, then await
 *    `ready` to catch anything else still in flight.
 */

/** Families registered this session, keyed by font id, so we never double-add. */
const registered = new Map<string, FontFace[]>();

const hasFontApi = (): boolean =>
  typeof document !== "undefined" &&
  "fonts" in document &&
  typeof (document as Document).fonts?.add === "function" &&
  typeof FontFace !== "undefined";

/**
 * The families a design references, paired with the weights and styles it uses
 * them at. A weight that is never used need not be loaded before printing.
 */
export interface UsedFace {
  family: string;
  weight: string;
  style: string;
  /** Largest size the family is used at, in pt — used to build a load string. */
  sizePt: number;
}

export const facesUsedBy = (design: LabelDesign): UsedFace[] => {
  const seen = new Map<string, UsedFace>();
  for (const element of design.elements) {
    if (element.type !== "text" && element.type !== "number") continue;
    const t = element.typography;
    const style = t.italic ? "italic" : "normal";
    const key = `${t.fontFamily}|${t.fontWeight}|${style}`;
    const existing = seen.get(key);
    if (existing) {
      existing.sizePt = Math.max(existing.sizePt, t.fontSize);
    } else {
      seen.set(key, {
        family: t.fontFamily,
        weight: String(t.fontWeight),
        style,
        sizePt: t.fontSize,
      });
    }
  }
  return [...seen.values()];
};

/**
 * A shorthand string for `document.fonts.load()`. The size must be non-zero
 * and the family list is passed through as authored, so a stack like
 * "Arial, Helvetica, sans-serif" resolves the same way it does in CSS.
 */
export const toLoadSpec = ({ family, weight, style, sizePt }: UsedFace): string => {
  const size = Number.isFinite(sizePt) && sizePt > 0 ? sizePt : 10;
  return `${style} ${weight} ${size}pt ${family}`;
};

/**
 * Register a design's uploaded fonts with the document and wait for the files
 * to decode. Resolves once they are usable for layout.
 */
export const registerCustomFonts = async (fonts: CustomFont[]): Promise<void> => {
  if (!hasFontApi() || fonts.length === 0) return;

  await Promise.all(
    fonts.map(async (font) => {
      if (registered.has(font.id)) return;
      try {
        const face = new FontFace(font.family, `url(${font.src})`, {
          weight: font.weight,
          style: font.style,
          // Hold text unrendered rather than paint a wrong-width fallback:
          // for print, correct-but-late beats fast-but-wrong.
          display: "block",
        });
        const loaded = await face.load();
        document.fonts.add(loaded);
        registered.set(font.id, [loaded]);
      } catch {
        // A corrupt or unsupported file must not block the editor; the design
        // falls back to the next family in the stack.
        registered.set(font.id, []);
      }
    })
  );
};

/** Drop a font's registration, so a deleted upload stops resolving. */
export const unregisterCustomFont = (id: string): void => {
  const faces = registered.get(id);
  if (!faces) return;
  for (const face of faces) {
    try {
      document.fonts.delete(face);
    } catch {
      // Already gone.
    }
  }
  registered.delete(id);
};

/**
 * Wait until every face the design uses is loaded and ready for layout.
 *
 * Call this before printing. It explicitly requests each used face rather than
 * relying on `document.fonts.ready` alone, because lazy loading means `ready`
 * can resolve while a referenced family has not begun loading.
 */
export const waitForDesignFonts = async (
  design: LabelDesign,
  { timeoutMs = 5000 }: { timeoutMs?: number } = {}
): Promise<{ ok: boolean; timedOut: boolean }> => {
  if (!hasFontApi()) return { ok: true, timedOut: false };

  const work = (async () => {
    await registerCustomFonts(design.fonts ?? []);
    await Promise.all(
      facesUsedBy(design).map((face) =>
        // A family the machine does not have rejects or resolves empty; either
        // way it is a permanent substitution, not something waiting helps.
        document.fonts.load(toLoadSpec(face)).catch(() => [])
      )
    );
    await document.fonts.ready;
  })();

  // Never let a hung font request block printing indefinitely.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<"timeout">((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });

  try {
    const result = await Promise.race([work.then(() => "done" as const), timeout]);
    return { ok: result === "done", timedOut: result === "timeout" };
  } finally {
    clearTimeout(timer);
  }
};

/** Reset module state. Tests only. */
export const __resetFontRegistry = (): void => registered.clear();
