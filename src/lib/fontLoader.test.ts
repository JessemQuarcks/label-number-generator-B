import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetFontRegistry,
  facesUsedBy,
  registerCustomFonts,
  toLoadSpec,
  waitForDesignFonts,
} from "./fontLoader";
import { DEFAULT_TYPOGRAPHY, NO_BORDER } from "./defaults";
import type { CustomFont, LabelDesign, TextElement } from "../types";

const text = (overrides: Partial<TextElement> = {}): TextElement => ({
  id: `t-${Math.random()}`,
  type: "text",
  name: "Text",
  x: 0,
  y: 0,
  width: 20,
  height: 10,
  rotation: 0,
  visible: true,
  text: "Hello",
  typography: { ...DEFAULT_TYPOGRAPHY },
  ...overrides,
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

const FONT_SRC = "data:font/woff2;base64,AAAA";

const customFont = (overrides: Partial<CustomFont> = {}): CustomFont => ({
  id: "f1",
  family: "Acme Sans",
  src: FONT_SRC,
  weight: "normal",
  style: "normal",
  ...overrides,
});

/** A controllable stand-in for the browser font machinery. */
interface FakeFonts {
  added: unknown[];
  loadCalls: string[];
  readyResolved: boolean;
}

let fake: FakeFonts;
let loadImpl: (spec: string) => Promise<unknown[]>;
let faceLoadImpl: () => Promise<unknown>;

beforeEach(() => {
  __resetFontRegistry();
  fake = { added: [], loadCalls: [], readyResolved: false };
  loadImpl = async () => [];
  faceLoadImpl = async function (this: unknown) {
    return this;
  };

  class FakeFontFace {
    family: string;
    source: string;
    descriptors: Record<string, string>;
    constructor(family: string, source: string, descriptors: Record<string, string> = {}) {
      this.family = family;
      this.source = source;
      this.descriptors = descriptors;
    }
    load() {
      return faceLoadImpl.call(this);
    }
  }
  vi.stubGlobal("FontFace", FakeFontFace);

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: {
      add: (f: unknown) => fake.added.push(f),
      delete: () => true,
      load: (spec: string) => {
        fake.loadCalls.push(spec);
        return loadImpl(spec);
      },
      get ready() {
        fake.readyResolved = true;
        return Promise.resolve();
      },
      status: "loaded",
      size: 0,
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("faces a design actually uses", () => {
  it("collects each family, weight and style combination once", () => {
    const d = design({
      elements: [
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "A", fontWeight: 400 } }),
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "A", fontWeight: 400 } }),
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "A", fontWeight: 700 } }),
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "B", italic: true } }),
      ],
    });

    const faces = facesUsedBy(d);
    expect(faces).toHaveLength(3);
    expect(faces).toContainEqual(
      expect.objectContaining({ family: "A", weight: "400", style: "normal" })
    );
    expect(faces).toContainEqual(
      expect.objectContaining({ family: "A", weight: "700", style: "normal" })
    );
    expect(faces).toContainEqual(
      expect.objectContaining({ family: "B", style: "italic" })
    );
  });

  it("includes number elements, not just text", () => {
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
          typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "Serial Font" },
        },
      ],
    });

    expect(facesUsedBy(d).map((f) => f.family)).toEqual(["Serial Font"]);
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

    expect(facesUsedBy(d)).toEqual([]);
  });

  it("keeps the largest size a family is used at", () => {
    const d = design({
      elements: [
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "A", fontSize: 8 } }),
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "A", fontSize: 26 } }),
      ],
    });

    expect(facesUsedBy(d)[0].sizePt).toBe(26);
  });

  it("builds a load spec the font API accepts", () => {
    expect(
      toLoadSpec({ family: "Arial, sans-serif", weight: "700", style: "italic", sizePt: 12 })
    ).toBe("italic 700 12pt Arial, sans-serif");
  });

  it("never builds a zero-size load spec, which the API rejects", () => {
    // A zero or negative size makes document.fonts.load() throw a SyntaxError.
    expect(toLoadSpec({ family: "A", weight: "400", style: "normal", sizePt: 0 })).toContain(
      "10pt"
    );
  });
});

describe("registering uploaded fonts", () => {
  it("adds each uploaded face to the document", async () => {
    await registerCustomFonts([customFont(), customFont({ id: "f2", family: "Acme Serif" })]);
    expect(fake.added).toHaveLength(2);
  });

  it("requests the file be held rather than swapped mid-render", async () => {
    await registerCustomFonts([customFont()]);
    const face = fake.added[0] as { descriptors: Record<string, string> };
    // font-display: block keeps text unrendered instead of painting a
    // wrong-width fallback that reflows once the real font lands.
    expect(face.descriptors.display).toBe("block");
  });

  it("passes weight and style through to the face", async () => {
    await registerCustomFonts([customFont({ weight: "700", style: "italic" })]);
    const face = fake.added[0] as { descriptors: Record<string, string> };
    expect(face.descriptors.weight).toBe("700");
    expect(face.descriptors.style).toBe("italic");
  });

  it("registers each font only once across repeated calls", async () => {
    await registerCustomFonts([customFont()]);
    await registerCustomFonts([customFont()]);
    expect(fake.added).toHaveLength(1);
  });

  it("survives a corrupt font file without throwing", async () => {
    faceLoadImpl = () => Promise.reject(new Error("bad file"));
    await expect(registerCustomFonts([customFont()])).resolves.toBeUndefined();
    expect(fake.added).toHaveLength(0);
  });

  it("does nothing when a design has no uploads", async () => {
    await registerCustomFonts([]);
    expect(fake.added).toHaveLength(0);
  });
});

describe("waiting for fonts before printing", () => {
  it("explicitly loads every face the design uses", async () => {
    const d = design({
      elements: [
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "Alpha", fontWeight: 700 } }),
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: "Beta", italic: true } }),
      ],
    });

    await waitForDesignFonts(d);

    // Relying on document.fonts.ready alone is not enough: CSS font loading is
    // lazy, so a referenced family may not have started loading at all.
    expect(fake.loadCalls).toHaveLength(2);
    expect(fake.loadCalls.some((s) => s.includes("Alpha") && s.includes("700"))).toBe(true);
    expect(fake.loadCalls.some((s) => s.includes("Beta") && s.includes("italic"))).toBe(true);
  });

  it("awaits document.fonts.ready as well", async () => {
    await waitForDesignFonts(design({ elements: [text()] }));
    expect(fake.readyResolved).toBe(true);
  });

  it("registers uploaded fonts before waiting on them", async () => {
    const d = design({
      fonts: [customFont({ family: "Acme Sans" })],
      elements: [
        text({ typography: { ...DEFAULT_TYPOGRAPHY, fontFamily: '"Acme Sans", sans-serif' } }),
      ],
    });

    const result = await waitForDesignFonts(d);

    expect(result.ok).toBe(true);
    expect(fake.added).toHaveLength(1);
    expect(fake.loadCalls.some((s) => s.includes("Acme Sans"))).toBe(true);
  });

  it("reports success when everything resolves", async () => {
    const result = await waitForDesignFonts(design({ elements: [text()] }));
    expect(result).toEqual({ ok: true, timedOut: false });
  });

  it("does not reject when a family is missing from the machine", async () => {
    // An absent family is a permanent substitution; waiting cannot fix it, and
    // it must not stop the print.
    loadImpl = () => Promise.reject(new Error("no such font"));
    const result = await waitForDesignFonts(design({ elements: [text()] }));
    expect(result.ok).toBe(true);
  });

  it("times out rather than blocking a print forever", async () => {
    loadImpl = () => new Promise(() => {});
    const promise = waitForDesignFonts(design({ elements: [text()] }), { timeoutMs: 50 });
    await expect(promise).resolves.toEqual({ ok: false, timedOut: true });
  });

  it("succeeds when the environment has no font API at all", async () => {
    Object.defineProperty(document, "fonts", { configurable: true, value: undefined });
    const result = await waitForDesignFonts(design({ elements: [text()] }));
    expect(result).toEqual({ ok: true, timedOut: false });
  });
});
