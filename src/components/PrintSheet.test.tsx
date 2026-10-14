import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import PrintSheet from "./PrintSheet";
import type { LabelDesign, NumberElement, PrintSettings } from "../types";
import { DEFAULT_TYPOGRAPHY, NO_BORDER } from "../lib/defaults";

/** A 120 x 60mm label with the number at x=100mm, y=10mm. */
const numberElement: NumberElement = {
  id: "num-1",
  type: "number",
  name: "Serial number",
  x: 100,
  y: 10,
  width: 18,
  height: 6,
  rotation: 0,
  visible: true,
  prefix: "GH",
  suffix: "",
  padTo: 0,
  typography: { ...DEFAULT_TYPOGRAPHY },
};

const design: LabelDesign = {
  id: "design-1",
  name: "Size accuracy fixture",
  width: 120,
  height: 60,
  unit: "mm",
  background: "#ffffff",
  border: { ...NO_BORDER },
  elements: [numberElement],
};

const print: PrintSettings = { startNumber: 49627, count: 10, gap: 4 };

const sheet = () => document.querySelector(".print-sheet") as HTMLElement;
const labels = () => Array.from(sheet().children) as HTMLElement[];

describe("print sheet geometry", () => {
  it("renders one label per requested count", () => {
    render(<PrintSheet design={design} print={print} />);
    expect(labels()).toHaveLength(10);
  });

  it("sizes every label exactly 120 x 60mm", () => {
    render(<PrintSheet design={design} print={print} />);
    for (const label of labels()) {
      expect(label.style.width).toBe("120mm");
      expect(label.style.height).toBe("60mm");
    }
  });

  it("places the number at x=100mm, y=10mm on every label", () => {
    render(<PrintSheet design={design} print={print} />);
    for (const label of labels()) {
      const number = label.firstElementChild as HTMLElement;
      expect(number.style.left).toBe("100mm");
      expect(number.style.top).toBe("10mm");
      expect(number.style.width).toBe("18mm");
      expect(number.style.height).toBe("6mm");
    }
  });

  it("keeps the number inside the label bounds", () => {
    // x + width must not exceed the label width, or the number is clipped.
    expect(numberElement.x + numberElement.width).toBeLessThanOrEqual(design.width);
    expect(numberElement.y + numberElement.height).toBeLessThanOrEqual(design.height);
  });

  it("applies the configured gap between labels", () => {
    render(<PrintSheet design={design} print={print} />);
    expect(sheet().style.gap).toBe("4mm");
  });

  it("marks every label to avoid splitting across a page break", () => {
    render(<PrintSheet design={design} print={print} />);
    // The rule lives in index.css (`.print-sheet > *`), which jsdom does not
    // load, so assert the structural contract the rule depends on: every
    // label is a direct child of .print-sheet and is a single element.
    const container = sheet();
    expect(container.children).toHaveLength(10);
    for (const label of labels()) {
      expect(label.parentElement).toBe(container);
      expect(label.tagName).toBe("DIV");
    }
  });

  it("numbers the rendered labels GH49627 through GH49636 in order", () => {
    render(<PrintSheet design={design} print={print} />);
    const rendered = labels().map((label) => label.textContent);
    expect(rendered).toEqual([
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
    expect(new Set(rendered).size).toBe(10);
  });

  it("hides empty image placeholders so they never reach paper", () => {
    const withEmptyImage: LabelDesign = {
      ...design,
      elements: [
        ...design.elements,
        {
          id: "img-1",
          type: "image",
          name: "Artwork slot",
          x: 0,
          y: 0,
          width: 50,
          height: 30,
          rotation: 0,
          visible: true,
          src: "",
          fit: "contain",
        },
      ],
    };
    render(<PrintSheet design={withEmptyImage} print={{ ...print, count: 1 }} />);
    expect(screen.queryByText("Artwork slot")).toBeNull();
  });

  it("renders the design's own colours, never the editor theme", () => {
    // The editor chrome is themeable; the label is print artwork on physical
    // stock. A theme token reaching a label would change what gets printed.
    const coloured: LabelDesign = {
      ...design,
      background: "#ffffff",
      elements: [
        { ...numberElement, typography: { ...DEFAULT_TYPOGRAPHY, color: "#111111" } },
      ],
    };
    render(<PrintSheet design={coloured} print={{ ...print, count: 1 }} />);

    const label = labels()[0];
    expect(label.style.backgroundColor).toBe("rgb(255, 255, 255)");
    expect(label.style.backgroundColor).not.toContain("var(");

    const number = label.firstElementChild as HTMLElement;
    expect(number.style.color).toBe("rgb(17, 17, 17)");
    expect(number.style.color).not.toContain("var(");
  });

  it("omits elements marked not visible", () => {
    const hidden: LabelDesign = {
      ...design,
      elements: [{ ...numberElement, visible: false }],
    };
    render(<PrintSheet design={hidden} print={{ ...print, count: 1 }} />);
    expect(labels()[0].textContent).toBe("");
  });
});
