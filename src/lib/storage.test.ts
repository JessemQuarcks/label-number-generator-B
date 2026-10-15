import { beforeEach, describe, expect, it } from "vitest";
import {
  exportState,
  loadState,
  normalizeDesign,
  parseImport,
  saveState,
  STORAGE_KEY,
} from "./storage";
import { createBlankDesign, DEFAULT_PRINT } from "./defaults";
import type { AppState, LabelDesign } from "../types";

const design = (overrides: Partial<LabelDesign> = {}): LabelDesign => ({
  ...createBlankDesign("Fixture"),
  width: 120,
  height: 60,
  // Normalization always materialises this, so a round-trip fixture must
  // carry it too or the comparison fails on a field nobody set.
  fonts: [],
  ...overrides,
});

const state = (overrides: Partial<AppState> = {}): AppState => {
  const d = design();
  return {
    version: 1,
    designs: [d],
    activeId: d.id,
    print: { ...DEFAULT_PRINT },
    ...overrides,
  };
};

beforeEach(() => localStorage.clear());

describe("persistence round trip", () => {
  it("restores a saved template from localStorage", () => {
    const saved = state();
    saveState(saved);

    const restored = loadState();
    expect(restored).not.toBeNull();
    expect(restored!.designs).toHaveLength(1);
    expect(restored!.designs[0].name).toBe("Fixture");
    expect(restored!.designs[0].width).toBe(120);
    expect(restored!.designs[0].height).toBe(60);
    expect(restored!.activeId).toBe(saved.activeId);
  });

  it("restores print settings alongside the design", () => {
    saveState(state({ print: { startNumber: 49627, count: 10, gap: 4 } }));

    const restored = loadState();
    expect(restored!.print).toEqual({ startNumber: 49627, count: 10, gap: 4 });
  });

  it("restores every element with its geometry and typography intact", () => {
    const withNumber = design();
    const element = withNumber.elements[0];
    saveState(state({ designs: [withNumber], activeId: withNumber.id }));

    const restored = loadState()!.designs[0].elements[0];
    expect(restored).toEqual(element);
  });

  it("returns null when nothing has been saved", () => {
    expect(loadState()).toBeNull();
  });

  it("falls back to null rather than throwing on corrupt storage", () => {
    localStorage.setItem(STORAGE_KEY, "{not valid json");
    expect(loadState()).toBeNull();
  });

  it("discards a saved payload that holds no usable designs", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, designs: [] }));
    expect(loadState()).toBeNull();
  });

  it("repairs an activeId that points at a design no longer present", () => {
    const d = design();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, designs: [d], activeId: "gone", print: DEFAULT_PRINT })
    );
    expect(loadState()!.activeId).toBe(d.id);
  });
});

describe("non-positive sizes are never restored", () => {
  it("repairs a zero or negative label size read back from storage", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        designs: [{ ...design(), width: 0, height: -40 }],
        print: DEFAULT_PRINT,
      })
    );

    const restored = loadState()!.designs[0];
    expect(restored.width).toBeGreaterThan(0);
    expect(restored.height).toBeGreaterThan(0);
  });

  it("repairs a non-positive element size", () => {
    const broken = normalizeDesign({
      name: "Broken",
      width: 120,
      height: 60,
      elements: [{ type: "text", text: "hi", width: 0, height: -5 }],
    });

    expect(broken!.elements[0].width).toBeGreaterThan(0);
    expect(broken!.elements[0].height).toBeGreaterThan(0);
  });

  it("rejects NaN and Infinity as sizes", () => {
    const d = normalizeDesign({ name: "X", width: "abc", height: null, elements: [] });
    expect(Number.isFinite(d!.width)).toBe(true);
    expect(d!.width).toBeGreaterThan(0);
    expect(Number.isFinite(d!.height)).toBe(true);
    expect(d!.height).toBeGreaterThan(0);
  });

  it("keeps a count of at least one", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        designs: [design()],
        print: { startNumber: 1, count: 0, gap: 4 },
      })
    );
    expect(loadState()!.print.count).toBeGreaterThanOrEqual(1);
  });
});

describe("import", () => {
  it("accepts a full exported state", () => {
    const json = exportState([design({ name: "Exported" })], {
      startNumber: 49627,
      count: 10,
      gap: 4,
    });

    const result = parseImport(json);
    expect(result.designs).toHaveLength(1);
    expect(result.designs[0].name).toBe("Exported");
    expect(result.print).toEqual({ startNumber: 49627, count: 10, gap: 4 });
  });

  it("accepts a bare array of designs", () => {
    const result = parseImport(JSON.stringify([design({ name: "A" }), design({ name: "B" })]));
    expect(result.designs.map((d) => d.name)).toEqual(["A", "B"]);
  });

  it("accepts a single design object", () => {
    const result = parseImport(JSON.stringify(design({ name: "Solo" })));
    expect(result.designs).toHaveLength(1);
    expect(result.designs[0].name).toBe("Solo");
  });

  it("rejects malformed JSON with a readable message", () => {
    expect(() => parseImport("not json")).toThrow(/not valid JSON/i);
  });

  it("rejects JSON that holds no designs", () => {
    expect(() => parseImport(JSON.stringify({ designs: [] }))).toThrow(/no usable/i);
  });

  it("repairs non-positive sizes in an imported file", () => {
    const result = parseImport(
      JSON.stringify({ name: "Hostile", width: -5, height: 0, elements: [] })
    );
    expect(result.designs[0].width).toBeGreaterThan(0);
    expect(result.designs[0].height).toBeGreaterThan(0);
  });

  it("drops an image source that is not a safe reference", () => {
    const result = parseImport(
      JSON.stringify({
        name: "X",
        width: 120,
        height: 60,
        elements: [{ type: "image", src: "javascript:alert(1)", width: 10, height: 10 }],
      })
    );
    const element = result.designs[0].elements[0];
    expect(element.type).toBe("image");
    expect(element.type === "image" && element.src).toBe("");
  });

  it.each(["png", "bmp"])(
    "keeps an uploaded %s data URL so embedded artwork survives a round trip",
    (format) => {
      const src = `data:image/${format};base64,AAAA`;
      const result = parseImport(
        JSON.stringify({
          name: "X",
          width: 120,
          height: 60,
          elements: [{ type: "image", src, width: 10, height: 10 }],
        })
      );
      const element = result.designs[0].elements[0];
      expect(element.type === "image" && element.src).toBe(src);
    }
  );

  it("survives a save, export, re-import cycle unchanged", () => {
    const original = design({ name: "Round trip", width: 120, height: 60 });
    const json = exportState([original], { startNumber: 49627, count: 10, gap: 4 });

    const reimported = parseImport(json).designs[0];
    expect(reimported).toEqual(original);
  });
});
