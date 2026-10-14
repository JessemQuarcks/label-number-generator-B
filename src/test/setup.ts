import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom implements neither of these. Both are layout APIs the editor uses for
 * presentation only — zoom-to-fit and drag capture — so a no-op stand-in lets
 * the behaviour under test run without changing it.
 */
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof globalThis.ResizeObserver;
}

if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
