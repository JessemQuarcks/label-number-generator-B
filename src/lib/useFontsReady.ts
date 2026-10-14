import { useEffect, useState } from "react";
import type { LabelDesign } from "../types";
import { registerCustomFonts, waitForDesignFonts } from "./fontLoader";

/**
 * Tracks whether the active design's fonts are ready to lay out text.
 *
 * The canvas holds the label back until this is true, so the first thing the
 * user sees is already in the right font rather than a fallback that reflows
 * a moment later — which on a millimetre canvas means text visibly changing
 * width and wrap position.
 */
export const useFontsReady = (design: LabelDesign): boolean => {
  const fonts = design.fonts ?? [];
  // Re-run when the set of uploaded fonts changes, not on every design edit.
  const signature = fonts.map((f) => f.id).join(",");
  const [ready, setReady] = useState(() => fonts.length === 0);

  useEffect(() => {
    let cancelled = false;

    // A design with no uploads has nothing to wait for: its families are
    // resolved synchronously by the OS, so gating would only add a flash.
    if (fonts.length === 0) {
      setReady(true);
      return;
    }

    setReady(false);
    void (async () => {
      await registerCustomFonts(fonts);
      if (!cancelled) setReady(true);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return ready;
};

/** Await full readiness for an imminent print. */
export const printWhenReady = async (
  design: LabelDesign,
  onTimeout?: () => void
): Promise<void> => {
  const { timedOut } = await waitForDesignFonts(design);
  if (timedOut) onTimeout?.();
  window.print();
};
