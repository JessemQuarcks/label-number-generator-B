import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  findMissingFonts,
  isFamilyAvailable,
  resetAvailabilityCache,
  splitStack,
} from "./fontAvailability";
import { DEFAULT_TYPOGRAPHY, NO_BORDER } from "./defaults";
import type { CustomFont, LabelDesign, TextElement } from "../types";

const text = (
  family: string,
  overrides: Partial<TextElement> = {}
): TextElement => ({
  id: `t-${family}-${Math.random()}`,
  type: "text",
  name: `Text ${family}`,
  x: 0,
  y: 0,
  width: 20,
  height: 10,
  rotation: 0,
  visible: true,
  text: "Hello",
  ...overrides,
  typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: family, ...overrides.typography },
});

const design = (overrides: Partial<LabelDesign> = {}): LabelDesign => ({
  id: "d1",
  name: "D",
  width: 120,
  height: 60,
  unit: "mm",
  background: "#ffffff",
  border: { ...NO_BORDER },
  elements: [],
  fonts: [],
  ...overrides,
});

const font = (family: string): CustomFont => ({
  id: `f-${family}`,
  family,
  src: "data:font/woff2;base64,AAAA",
  weight: "normal",
  style: "normal",
});

/**
 * jsdom's canvas returns a width of 0 for everything, so availability has to
 * be simulated. INSTALLED families measure differently from the generic base;
 * absent ones measure identically, exactly as a real engine behaves.
 */
const INSTALLED = new Set(["Arial", "Georgia", "Impact", "Acme Sans"]);

beforeEach(() => {
  resetAvailabilityCache();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
    let current = "";
    return {
      set font(value: string) {
        current = value;
      },
      get font() {
        return current;
      },
      measureText: () => {
        // The shorthand is either "72px base" or '72px "Family", base'.
        const match = /^\d+px\s+"([^"]+)",/.exec(current);
        const family = match?.[1];
        const base = 100;
        return { width: family && INSTALLED.has(family) ? base + 25 : base };
      },
    } as unknown as CanvasRenderingContext2D;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  resetAvailabilityCache();
});

describe("splitting a font stack", () => {
  it("separates families and strips quotes", () => {
    expect(splitStack(`"Segoe UI", Tahoma, sans-serif`)).toEqual([
      "Segoe UI",
      "Tahoma",
      "sans-serif",
    ]);
  });

  it("handles a single family", () => {
    expect(splitStack("Arial")).toEqual(["Arial"]);
  });

  it("ignores empty entries", () => {
    expect(splitStack("Arial, , serif")).toEqual(["Arial", "serif"]);
  });
});

describe("detecting an available family", () => {
  it("reports an installed family as available", () => {
    expect(isFamilyAvailable("Arial")).toBe(true);
    expect(isFamilyAvailable("Georgia")).toBe(true);
  });

  it("reports an absent family as unavailable", () => {
    expect(isFamilyAvailable("Totally Fake Font XYZ")).toBe(false);
  });

  it("treats generic keywords as always available", () => {
    for (const generic of ["serif", "sans-serif", "monospace", "cursive", "system-ui"]) {
      expect(isFamilyAvailable(generic)).toBe(true);
    }
  });

  it("ignores surrounding quotes on the name", () => {
    expect(isFamilyAvailable('"Arial"')).toBe(true);
    expect(isFamilyAvailable("'Arial'")).toBe(true);
  });

  it("assumes available when no canvas is obtainable", () => {
    // Without a way to measure we cannot tell, and a false alarm on every
    // font would be worse than staying quiet.
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    resetAvailabilityCache();
    expect(isFamilyAvailable("Totally Fake Font XYZ")).toBe(true);
  });
});

describe("flagging families a design cannot render", () => {
  it("flags a first-choice family the machine lacks", () => {
    const d = design({ elements: [text("Missing Font, sans-serif")] });
    const warnings = findMissingFonts(d);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].requested).toBe("Missing Font");
    expect(warnings[0].substitute).toBe("sans-serif");
  });

  it("stays silent when the first choice is installed", () => {
    expect(findMissingFonts(design({ elements: [text("Arial, Helvetica, sans-serif")] }))).toEqual(
      []
    );
  });

  it("does not flag a stack whose later entries are missing", () => {
    // Falling through to a declared fallback is the stack working as intended;
    // only the author's actual first choice matters.
    const d = design({ elements: [text("Arial, Missing Font, serif")] });
    expect(findMissingFonts(d)).toEqual([]);
  });

  it("names the installed family that will be substituted", () => {
    const d = design({ elements: [text("Missing Font, Georgia, serif")] });
    expect(findMissingFonts(d)[0].substitute).toBe("Georgia");
  });

  it("reports no substitute when nothing in the stack resolves", () => {
    const d = design({ elements: [text("Missing One, Missing Two")] });
    expect(findMissingFonts(d)[0].substitute).toBeNull();
  });

  it("does not flag a family uploaded with the design", () => {
    // An uploaded font travels with the design, so it is available wherever
    // the design goes even though the machine lacks it system-wide.
    const d = design({
      fonts: [font("Brand Script")],
      elements: [text('"Brand Script", cursive')],
    });
    expect(findMissingFonts(d)).toEqual([]);
  });

  it("matches an uploaded family regardless of case", () => {
    const d = design({
      fonts: [font("Brand Script")],
      elements: [text('"brand script", cursive')],
    });
    expect(findMissingFonts(d)).toEqual([]);
  });

  it("groups every element sharing one missing stack", () => {
    const d = design({
      elements: [
        text("Missing Font, serif", { name: "Title" }),
        text("Missing Font, serif", { name: "Subtitle" }),
      ],
    });

    const warnings = findMissingFonts(d);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].elements).toEqual(["Title", "Subtitle"]);
  });

  it("reports distinct stacks separately", () => {
    const d = design({
      elements: [text("Missing One, serif"), text("Missing Two, serif")],
    });
    expect(findMissingFonts(d).map((w) => w.requested).sort()).toEqual([
      "Missing One",
      "Missing Two",
    ]);
  });

  it("skips hidden elements", () => {
    // A hidden element never prints, so it cannot print wrong.
    const d = design({
      elements: [text("Missing Font, serif", { visible: false })],
    });
    expect(findMissingFonts(d)).toEqual([]);
  });

  it("checks number elements as well as text", () => {
    const d = design({
      elements: [
        {
          id: "n1",
          type: "number",
          name: "Serial",
          x: 0,
          y: 0,
          width: 10,
          height: 5,
          rotation: 0,
          visible: true,
          prefix: "GH",
          suffix: "",
          padTo: 0,
          typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "Missing Font, monospace" },
        },
      ],
    });

    expect(findMissingFonts(d)[0].requested).toBe("Missing Font");
  });

  it("ignores elements that carry no typography", () => {
    const d = design({
      elements: [
        {
          id: "s1",
          type: "shape",
          name: "Band",
          x: 0,
          y: 0,
          width: 10,
          height: 5,
          rotation: 0,
          visible: true,
          fill: "#eee",
          border: { ...NO_BORDER },
        },
      ],
    });
    expect(findMissingFonts(d)).toEqual([]);
  });

  it("returns nothing for a design with no elements", () => {
    expect(findMissingFonts(design())).toEqual([]);
  });
});
