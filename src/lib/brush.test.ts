import { describe, expect, it } from "vitest";
import {
  controlFactor,
  dabsAlong,
  dabsAt,
  DEFAULT_BRUSH,
  jitterColor,
  mulberry32,
  smoothTowards,
  stepBrushSize,
  tipAlpha,
} from "./brush";

const p = (x: number, y: number, pressure = 1) => ({ x, y, pressure });

describe("dab spacing", () => {
  it("lays dabs evenly along a segment", () => {
    const { dabs } = dabsAlong(p(0, 0), p(10, 0), 2, 0);
    expect(dabs.map((d) => d.x)).toEqual([2, 4, 6, 8, 10]);
  });

  it("carries leftover distance into the next segment, so spacing stays even", () => {
    const first = dabsAlong(p(0, 0), p(3, 0), 2, 0);
    expect(first.dabs.map((d) => d.x)).toEqual([2]);
    const second = dabsAlong(p(3, 0), p(6, 0), 2, first.carry);
    expect(second.dabs.map((d) => d.x)).toEqual([4, 6]);
  });

  it("interpolates pressure between samples", () => {
    const { dabs } = dabsAlong(p(0, 0, 0), p(4, 0, 1), 2, 0);
    expect(dabs.map((d) => d.pressure)).toEqual([0.5, 1]);
  });
});

describe("smoothing", () => {
  it("follows exactly at 0 and lags behind at higher values", () => {
    expect(smoothTowards(p(0, 0), p(10, 0), 0).x).toBe(10);
    const lazy = smoothTowards(p(0, 0), p(10, 0), 80).x;
    expect(lazy).toBeGreaterThan(0);
    expect(lazy).toBeLessThan(5);
  });
});

describe("dynamics", () => {
  it("pressure and fade control scale from 0 to 1", () => {
    expect(controlFactor("off", 0.2, 50, 10)).toBe(1);
    expect(controlFactor("pressure", 0.25, 0, 10)).toBe(0.25);
    expect(controlFactor("fade", 1, 5, 10)).toBe(0.5);
    expect(controlFactor("fade", 1, 20, 10)).toBe(0);
  });

  it("a plain brush stamps one dab at full size and flow", () => {
    const [dab, ...rest] = dabsAt(DEFAULT_BRUSH, p(5, 5), 0, 0, mulberry32(1), "#000000");
    expect(rest).toHaveLength(0);
    expect(dab).toMatchObject({ x: 5, y: 5, size: DEFAULT_BRUSH.size, alpha: 1, roundness: 1 });
  });

  it("light pen pressure shrinks the dab, but not below the minimum diameter", () => {
    const [dab] = dabsAt({ ...DEFAULT_BRUSH, minDiameter: 20 }, p(0, 0, 0), 0, 0, mulberry32(1), "#000");
    expect(dab.size).toBeCloseTo(DEFAULT_BRUSH.size * 0.2);
  });

  it("count stamps several dabs, and scatter spreads them across the stroke", () => {
    const s = { ...DEFAULT_BRUSH, count: 4, scatter: 100 };
    const dabs = dabsAt(s, p(0, 0), 0, 0, mulberry32(7), "#000");
    expect(dabs).toHaveLength(4);
    // Heading along +x, so scatter moves dabs in y only.
    expect(dabs.every((d) => d.x === 0)).toBe(true);
    expect(dabs.some((d) => d.y !== 0)).toBe(true);
    expect(dabs.every((d) => Math.abs(d.y) <= s.size)).toBe(true);
  });

  it("flow and opacity jitter only ever reduce a dab's deposit", () => {
    const s = { ...DEFAULT_BRUSH, flow: 50, flowJitter: 100, opacityJitter: 100 };
    const rnd = mulberry32(3);
    for (let i = 0; i < 50; i += 1) {
      const [dab] = dabsAt(s, p(0, 0), i, 0, rnd, "#000");
      expect(dab.alpha).toBeGreaterThanOrEqual(0);
      expect(dab.alpha).toBeLessThanOrEqual(0.5);
    }
  });

  it("angle can follow the stroke direction", () => {
    const [dab] = dabsAt({ ...DEFAULT_BRUSH, angleFollowsDirection: true }, p(0, 0), 0, Math.PI / 2, mulberry32(1), "#000");
    expect(dab.angle).toBeCloseTo(Math.PI / 2);
  });
});

describe("colour dynamics", () => {
  it("leaves the colour alone with no jitter", () => {
    expect(jitterColor(DEFAULT_BRUSH, mulberry32(1))).toBe(DEFAULT_BRUSH.color);
  });

  it("full foreground/background jitter mixes between the two colours", () => {
    const s = { ...DEFAULT_BRUSH, color: "#000000", secondaryColor: "#ffffff", fgBgJitter: 100 };
    const colours = new Set(Array.from({ length: 20 }, (_, i) => jitterColor(s, mulberry32(i + 1))));
    expect(colours.size).toBeGreaterThan(5);
    for (const c of colours) expect(c).toMatch(/^#([0-9a-f]{2})\1\1$/); // greys only
  });

  it("is reproducible for a given seed", () => {
    const s = { ...DEFAULT_BRUSH, color: "#3366cc", hueJitter: 50 };
    expect(jitterColor(s, mulberry32(42))).toBe(jitterColor(s, mulberry32(42)));
  });
});

describe("tips", () => {
  it("a hard round tip is solid inside and empty outside", () => {
    const rnd = mulberry32(1);
    expect(tipAlpha("round", 100, 0, 0, rnd)).toBe(1);
    expect(tipAlpha("round", 100, 0.9, 0, rnd)).toBe(1);
    expect(tipAlpha("round", 100, 0.8, 0.8, rnd)).toBe(0);
  });

  it("a soft tip fades towards the edge", () => {
    const rnd = mulberry32(1);
    const mid = tipAlpha("round", 0, 0.5, 0, rnd);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("a square tip fills its corners", () => {
    expect(tipAlpha("square", 100, 0.9, 0.9, mulberry32(1))).toBe(1);
  });
});

describe("[ and ] brush size steps", () => {
  it("steps finely when small and coarsely when large", () => {
    expect(stepBrushSize(5, 1)).toBe(6);
    expect(stepBrushSize(30, 1)).toBe(35);
    expect(stepBrushSize(200, -1)).toBe(175);
    expect(stepBrushSize(1, -1)).toBe(1);
  });
});
