import { useSyncExternalStore } from "react";

/**
 * The pointer's position over the label, in mm. Updated on every mouse move,
 * so it lives outside React state: only the status bar readout re-renders.
 */
type Point = { x: number; y: number } | null;

let current: Point = null;
const listeners = new Set<() => void>();

export const setPointerMm = (point: Point) => {
  if (current === point) return;
  if (current && point && current.x === point.x && current.y === point.y) return;
  current = point;
  listeners.forEach((l) => l());
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const usePointerMm = (): Point =>
  useSyncExternalStore(
    subscribe,
    () => current,
    () => null
  );
