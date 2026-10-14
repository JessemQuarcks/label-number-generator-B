import { describe, expect, it } from "vitest";
import { formatNumber, formatSeries, lastNumber, numberSeries } from "./numbering";
import type { NumberFormat } from "./numbering";

const GH: NumberFormat = { prefix: "GH", suffix: "", padTo: 0 };

describe("numbering correctness", () => {
  it('prefix "GH" from 49627, count 10, runs GH49627 to GH49636', () => {
    const series = formatSeries(
      { startNumber: 49627, count: 10, gap: 4 },
      GH
    );

    expect(series).toHaveLength(10);
    expect(series[0]).toBe("GH49627");
    expect(series.at(-1)).toBe("GH49636");
    expect(series).toEqual([
      "GH49627",
      "GH49628",
      "GH49629",
      "GH49630",
      "GH49631",
      "GH49632",
      "GH49633",
      "GH49634",
      "GH49635",
      "GH49636",
    ]);
  });

  it("reaches GH49637 only at count 11, since the range is inclusive", () => {
    const series = formatSeries({ startNumber: 49627, count: 11, gap: 4 }, GH);

    expect(series).toHaveLength(11);
    expect(series[0]).toBe("GH49627");
    expect(series.at(-1)).toBe("GH49637");
    // Guards the off-by-one directly: an inclusive run of GH49627..GH49637
    // is 11 labels, so asking for 10 must not reach GH49637.
    expect(formatSeries({ startNumber: 49627, count: 10, gap: 4 }, GH)).not.toContain(
      "GH49637"
    );
  });

  it("produces no duplicates", () => {
    const series = formatSeries({ startNumber: 49627, count: 10, gap: 4 }, GH);
    expect(new Set(series).size).toBe(series.length);
  });

  it("produces no duplicates over a long run", () => {
    const series = formatSeries({ startNumber: 49627, count: 1000, gap: 4 }, GH);
    expect(new Set(series).size).toBe(1000);
    expect(series.at(-1)).toBe("GH50626");
  });

  it("increments by exactly one with no gaps", () => {
    const values = numberSeries({ startNumber: 49627, count: 10, gap: 4 });
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i] - values[i - 1]).toBe(1);
    }
  });

  it("reports the inclusive last number of a run", () => {
    expect(lastNumber({ startNumber: 49627, count: 10, gap: 4 })).toBe(49636);
    expect(lastNumber({ startNumber: 49627, count: 11, gap: 4 })).toBe(49637);
    expect(lastNumber({ startNumber: 1, count: 1, gap: 4 })).toBe(1);
  });
});

describe("number formatting", () => {
  it("pads digits without counting the prefix", () => {
    // Padding must not be swallowed by the prefix: 7 with padTo 3 is GH007.
    expect(formatNumber(7, { prefix: "GH", suffix: "", padTo: 3 })).toBe("GH007");
    // A number already wider than padTo is never truncated.
    expect(formatNumber(49627, { prefix: "GH", suffix: "", padTo: 3 })).toBe("GH49627");
  });

  it("applies prefix and suffix around the padded digits", () => {
    expect(formatNumber(5, { prefix: "GH", suffix: "-A", padTo: 4 })).toBe("GH0005-A");
    expect(formatNumber(5, { prefix: "", suffix: "", padTo: 0 })).toBe("5");
  });

  it("keeps the original three-digit default behaviour", () => {
    expect(formatNumber(1, { prefix: "", suffix: "", padTo: 3 })).toBe("001");
    expect(formatNumber(851, { prefix: "", suffix: "", padTo: 3 })).toBe("851");
  });

  it("starts from zero when asked", () => {
    const series = formatSeries(
      { startNumber: 0, count: 3, gap: 4 },
      { prefix: "", suffix: "", padTo: 3 }
    );
    expect(series).toEqual(["000", "001", "002"]);
  });
});
