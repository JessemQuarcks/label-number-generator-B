import type { NumberElement, PrintSettings } from "../types";

export type NumberFormat = Pick<NumberElement, "prefix" | "suffix" | "padTo">;

/**
 * Renders one serial number. Zero-padding applies to the digits only, so a
 * prefix never changes how wide the number reads: padTo 5 on 49627 with
 * prefix "GH" gives "GH49627", not "GH0049627".
 */
export const formatNumber = (
  value: number,
  { prefix, suffix, padTo }: NumberFormat
): string => `${prefix}${String(value).padStart(padTo, "0")}${suffix}`;

/** The raw numeric series a print run produces, in order. */
export const numberSeries = ({ startNumber, count }: PrintSettings): number[] =>
  Array.from({ length: count }, (_, index) => startNumber + index);

/** The formatted labels a print run produces, in order. */
export const formatSeries = (
  print: PrintSettings,
  format: NumberFormat
): string[] => numberSeries(print).map((value) => formatNumber(value, format));

/** The last number in a run — the inclusive end of the series. */
export const lastNumber = ({ startNumber, count }: PrintSettings): number =>
  startNumber + count - 1;
