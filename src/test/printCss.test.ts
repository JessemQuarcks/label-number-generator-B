import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * jsdom does not apply stylesheets, so the component tests can only assert the
 * DOM structure the print rules hang off. These tests assert the rules
 * themselves exist in the stylesheet; the browser check in the repo's manual
 * verification confirms they take effect on paper.
 */
const css = readFileSync(resolve(process.cwd(), "src/index.css"), "utf8");

/** Strip comments so a rule mentioned in prose is never mistaken for a rule. */
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

const printBlock = (() => {
  const start = stripped.indexOf("@media print");
  if (start === -1) return "";
  // Walk braces to find the end of the @media block.
  let depth = 0;
  for (let i = stripped.indexOf("{", start); i < stripped.length; i += 1) {
    if (stripped[i] === "{") depth += 1;
    if (stripped[i] === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(start, i + 1);
    }
  }
  return stripped.slice(start);
})();

describe("print stylesheet", () => {
  it("has an @media print block", () => {
    expect(printBlock).not.toBe("");
  });

  it("prevents labels from splitting across a page break", () => {
    expect(printBlock).toMatch(/\.print-sheet\s*>\s*\*/);
    expect(printBlock).toMatch(/break-inside:\s*avoid/);
    // The legacy property keeps older print engines in line.
    expect(printBlock).toMatch(/page-break-inside:\s*avoid/);
  });

  it("shows the print sheet and hides the editor when printing", () => {
    expect(printBlock).toMatch(/\.screen-only[\s\S]*?display:\s*none/);
    expect(printBlock).toMatch(/\.print-sheet[\s\S]*?display:\s*flex/);
  });

  it("keeps the sheet hidden on screen", () => {
    const beforePrint = stripped.slice(0, stripped.indexOf("@media print"));
    expect(beforePrint).toMatch(/\.print-sheet\s*\{[^}]*display:\s*none/);
  });

  it("preserves background colours in print output", () => {
    expect(printBlock).toMatch(/print-color-adjust:\s*exact/);
  });
});
