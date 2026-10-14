import type { LabelDesign, PrintSettings } from "../types";
import Label from "./Label";
import { numberSeries } from "../lib/numbering";

interface PrintSheetProps {
  design: LabelDesign;
  print: PrintSettings;
  /**
   * False while uploaded fonts are still decoding. The sheet stays empty until
   * then, so a print triggered outside the app's own button — the browser menu
   * or the OS shortcut — cannot put fallback text on paper.
   */
  fontsReady?: boolean;
}

/**
 * The print output: `count` labels numbered from `startNumber`, laid out at
 * true physical size. Hidden on screen; only `@media print` reveals it.
 */
const PrintSheet = ({ design, print, fontsReady = true }: PrintSheetProps) => (
  <div className="print-sheet" style={{ gap: `${print.gap}mm` }}>
    {fontsReady
      ? numberSeries(print).map((value) => (
          <Label key={value} design={design} number={value} hidePlaceholders />
        ))
      : null}
  </div>
);

export default PrintSheet;
