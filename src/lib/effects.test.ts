import { describe, expect, it } from "vitest";
import { createEffect, duplicateEffect, effectsToCss, migrateAdjustments, presetEffects } from "./effects";
import { dashFor, nextShape, shapePath } from "./shapes";

describe("effect stacks", () => {
  it("renders enabled effects in stack order and skips disabled ones", () => {
    const effects = [
      createEffect("grayscale", 100),
      { ...createEffect("blur", 0.5), enabled: false },
      createEffect("contrast", 120),
    ];
    expect(effectsToCss(effects)).toBe("grayscale(100%) contrast(120%)");
  });

  it("renders nothing for an empty or neutral stack", () => {
    expect(effectsToCss(undefined)).toBeUndefined();
    expect(effectsToCss([createEffect("brightness", 100)])).toBeUndefined();
  });

  it("draws shadows in mm so they print at physical size", () => {
    const css = effectsToCss([createEffect("dropShadow", 50)]);
    expect(css).toBe("drop-shadow(0.8mm 0.8mm 1mm rgba(0, 0, 0, 0.5))");
  });

  it("duplicates an effect just above the original with a new id", () => {
    const a = createEffect("sepia");
    const b = createEffect("invert");
    const out = duplicateEffect([a, b], a.id);
    expect(out.map((e) => e.kind)).toEqual(["sepia", "sepia", "invert"]);
    expect(out[1].id).not.toBe(a.id);
  });

  it("presets add several effects", () => {
    expect(presetEffects("bw").map((e) => e.kind)).toEqual(["grayscale", "contrast"]);
  });

  it("migrates old adjustments, converting blur from px to mm", () => {
    const { effects, opacity } = migrateAdjustments({ blur: 10, sepia: 0, opacity: 50 });
    expect(opacity).toBe(50);
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({ kind: "blur", amount: 2.65 });
  });
});

describe("shape paths", () => {
  const vertices = (d: string) => (d.match(/[ML]/g) ?? []).length;

  it("builds polygons and stars with the requested number of points", () => {
    expect(vertices(shapePath("polygon", 10, 10, { sides: 6 }))).toBe(6);
    expect(vertices(shapePath("star", 10, 10, { sides: 5 }))).toBe(10);
    expect(vertices(shapePath("triangle", 10, 10))).toBe(3);
  });

  it("insets the outline so a stroke stays inside the box", () => {
    expect(shapePath("triangle", 10, 10, { inset: 1 })).toBe("M5 1 L9 9 L1 9 Z");
  });

  it("rounds rectangle corners with arcs", () => {
    expect(shapePath("rectangle", 10, 10, { cornerRadius: 2 })).toContain("A2 2");
  });

  it("leaves open shapes unclosed", () => {
    expect(shapePath("line", 10, 4)).not.toContain("Z");
  });

  it("cycles through every shape for Shift+U", () => {
    expect(nextShape("rectangle")).toBe("ellipse");
    expect(nextShape("drop")).toBe("rectangle");
  });

  it("dashes strokes in proportion to their width", () => {
    expect(dashFor("dashed", 1)).toBe("3 2");
    expect(dashFor("solid", 1)).toBeUndefined();
  });
});
