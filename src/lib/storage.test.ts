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

describe("image crop and effects", () => {
  const imageWith = (extra: Record<string, unknown>) =>
    normalizeDesign({
      name: "Img",
      width: 100,
      height: 50,
      elements: [{ type: "image", src: "photo.png", width: 10, height: 10, ...extra }],
    })!.elements[0];

  it("round-trips a crop, an effect stack, opacity and flips", () => {
    const original = design({
      elements: [
        {
          id: "img",
          type: "image",
          name: "Photo",
          x: 0,
          y: 0,
          width: 50,
          height: 25,
          rotation: 0,
          visible: true,
          opacity: 80,
          src: "photo.png",
          fit: "cover",
          crop: { left: 0.1, top: 0, right: 0.2, bottom: 0.3 },
          effects: [
            { id: "e1", kind: "grayscale", enabled: true, amount: 100 },
            { id: "e2", kind: "dropShadow", enabled: false, amount: 50, offsetX: 1, offsetY: 1, radius: 2, color: "#112233" },
          ],
          flipX: true,
        },
      ],
    });
    const reimported = parseImport(exportState([original], DEFAULT_PRINT)).designs[0];
    expect(reimported).toEqual(original);
  });

  it("omits the optional fields when they are neutral, so old saves stay unchanged", () => {
    const el = imageWith({ crop: { left: 0, top: 0, right: 0, bottom: 0 }, effects: [], flipX: false });
    expect(el).not.toHaveProperty("crop");
    expect(el).not.toHaveProperty("effects");
    expect(el).not.toHaveProperty("flipX");
  });

  it("drops a crop that would leave nothing visible", () => {
    expect(imageWith({ crop: { left: 0.6, right: 0.6, top: 0, bottom: 0 } })).not.toHaveProperty("crop");
  });

  it("clamps out-of-range insets and effect amounts, and drops unknown effects", () => {
    const el = imageWith({
      crop: { left: -1, top: 0.2, right: "x", bottom: 0 },
      effects: [
        { kind: "brightness", amount: 9999 },
        { kind: "hue", amount: 720 },
        { kind: "javascript", amount: 1 },
      ],
    });
    expect(el.type === "image" && el.crop).toEqual({ left: 0, top: 0.2, right: 0, bottom: 0 });
    const effects = el.type === "image" ? el.effects ?? [] : [];
    expect(effects.map((e) => [e.kind, e.amount])).toEqual([
      ["brightness", 300],
      ["hue", 180],
    ]);
  });

  it("converts the old single adjustments object into an effect stack", () => {
    const el = imageWith({ adjust: { brightness: 120, grayscale: 100, contrast: 100, opacity: 40 } });
    expect(el.opacity).toBe(40);
    const effects = el.type === "image" ? el.effects ?? [] : [];
    expect(effects.map((e) => [e.kind, e.amount])).toEqual([
      ["brightness", 120],
      ["grayscale", 100],
    ]);
  });
});

describe("groups, shapes and pixel layers", () => {
  it("round-trips groups, shape kinds and a pixel layer", () => {
    const original = design({
      groups: [{ id: "g1", name: "Badge", visible: false, collapsed: true }],
      elements: [
        {
          id: "s1",
          type: "shape",
          name: "Star",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          visible: true,
          groupId: "g1",
          shape: "star",
          sides: 6,
          innerRadius: 40,
          fill: "none",
          border: { style: "solid", width: 0.5, color: "#000000", radius: 0 },
        },
        {
          id: "r1",
          type: "raster",
          name: "Layer 1",
          x: 0,
          y: 0,
          width: 120,
          height: 60,
          rotation: 0,
          visible: true,
          src: "data:image/png;base64,AAAA",
          pxWidth: 1417,
          pxHeight: 709,
        },
      ],
    });
    expect(parseImport(exportState([original], DEFAULT_PRINT)).designs[0]).toEqual(original);
  });

  it("drops references to groups that do not exist", () => {
    const d = normalizeDesign({
      name: "X",
      elements: [{ type: "text", text: "hi", groupId: "ghost" }],
      groups: [{ id: "unused", name: "Empty" }],
    })!;
    expect(d.elements[0].groupId).toBeUndefined();
    expect(d).not.toHaveProperty("groups");
  });

  it("only accepts embedded PNG data on a pixel layer", () => {
    const d = normalizeDesign({
      name: "X",
      elements: [{ type: "raster", src: "https://example.com/x.png", pxWidth: 10, pxHeight: 10 }],
    })!;
    expect(d.elements[0].type === "raster" && d.elements[0].src).toBe("");
  });

  it("rejects an unknown shape kind", () => {
    const d = normalizeDesign({ name: "X", elements: [{ type: "shape", shape: "<script>" }] })!;
    expect(d.elements[0]).not.toHaveProperty("shape");
  });
});
