import type { Unit } from "../types";

/** CSS reference pixels per millimetre (1in = 96px = 25.4mm). */
export const PX_PER_MM = 96 / 25.4;

export const MM_PER_CM = 10;

export const newId = (): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
};

/** Convert a value typed by the user, in `unit`, into canonical millimetres. */
export const toMm = (value: number, unit: Unit): number =>
  unit === "cm" ? value * MM_PER_CM : value;

/** Convert canonical millimetres into `unit` for display. */
export const fromMm = (mm: number, unit: Unit): number =>
  unit === "cm" ? mm / MM_PER_CM : mm;

export const round = (value: number, decimals = 2): number => {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
};

/** Trim floating point noise so inputs show "12.5" and not "12.500000000001". */
export const formatValue = (value: number, decimals = 3): string =>
  String(round(value, decimals));

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** The smallest step that makes sense in the given unit. */
export const stepFor = (unit: Unit): number => (unit === "cm" ? 0.01 : 0.1);
