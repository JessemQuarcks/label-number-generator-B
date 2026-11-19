import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
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

/**
 * jsdom ships no PointerEvent, so testing-library falls back to a bare Event
 * and drops clientX/clientY/button. A MouseEvent subclass keeps them, which
 * the canvas's pointer maths needs.
 */
if (!("PointerEvent" in globalThis)) {
  class PointerEventStub extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
    }
  }
  globalThis.PointerEvent = PointerEventStub as unknown as typeof globalThis.PointerEvent;
}

/**
 * The editor looks for the local AI server on start-up. Tests must never
 * reach the network, so by default the server is simply "not running";
 * tests of the AI features install their own fake with `vi.stubGlobal`.
 */
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("No network in tests")))
  );
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});
