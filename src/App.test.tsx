import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { STORAGE_KEY } from "./lib/storage";
import type { AppState } from "./types";
import { __resetFontRegistry } from "./lib/fontLoader";
import { resetAvailabilityCache } from "./lib/fontAvailability";

/**
 * Unmounting and re-rendering <App /> is a true reload for persistence
 * purposes: the hook re-reads localStorage from scratch on mount, exactly as
 * it does after a browser refresh.
 */
const reload = async (ui: { unmount: () => void }) => {
  ui.unmount();
  return render(<App />);
};

const sheet = () => document.querySelector(".print-sheet") as HTMLElement;

const setField = async (label: RegExp | string, value: string) => {
  const input = screen.getByLabelText(label);
  await userEvent.clear(input);
  await userEvent.type(input, value);
  return input;
};

/**
 * Waits for the debounced save to flush every pending edit.
 *
 * Asserting on one field is not enough: saves are debounced, so storage can
 * already hold an earlier edit while a later one is still in flight.
 */
const savedState = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AppState) : null;
};

const waitForSave = (predicate: (state: AppState) => boolean) =>
  waitFor(() => {
    const state = savedState();
    expect(state).not.toBeNull();
    expect(predicate(state as AppState)).toBe(true);
  });

describe("validation in the running app", () => {
  it("rejects a non-positive label width and leaves the design untouched", async () => {
    render(<App />);

    await setField(/^Width/, "0");

    expect(await screen.findByText(/Must be greater than 0/)).toBeInTheDocument();
    // The rendered label keeps its last valid width.
    const label = sheet().firstElementChild as HTMLElement;
    expect(label.style.width).not.toBe("0mm");
  });

  it("rejects a non-positive print count", async () => {
    render(<App />);

    await setField(/How many/, "0");

    expect(await screen.findByText(/Must be 1 or more/)).toBeInTheDocument();
    expect(sheet().children.length).toBeGreaterThan(0);
  });

  it("does not persist a rejected value across a reload", async () => {
    const ui = render(<App />);
    await setField(/^Width/, "-20");
    await new Promise((r) => setTimeout(r, 500)); // let the save debounce settle

    const reloaded = await reload(ui);
    const width = within(reloaded.container).getByLabelText(/^Width/) as HTMLInputElement;
    expect(Number(width.value)).toBeGreaterThan(0);
  });
});

describe("persistence across a reload", () => {
  it("restores an edited template from localStorage", async () => {
    const ui = render(<App />);

    await setField("Design name", "Lime Juice 2026 run");
    await setField(/^Width/, "120");
    await setField(/^Height/, "60");
    await waitForSave((s) => {
      const d = s.designs.find((x) => x.name === "Lime Juice 2026 run");
      return d?.width === 120 && d?.height === 60;
    });

    await reload(ui);

    expect((screen.getByLabelText("Design name") as HTMLInputElement).value).toBe(
      "Lime Juice 2026 run"
    );
    expect((screen.getByLabelText(/^Width/) as HTMLInputElement).value).toBe("120");
    expect((screen.getByLabelText(/^Height/) as HTMLInputElement).value).toBe("60");
  });

  it("restores the print run settings", async () => {
    const ui = render(<App />);

    await setField(/Start at/, "49627");
    await setField(/How many/, "10");
    await waitForSave((s) => s.print.startNumber === 49627 && s.print.count === 10);

    await reload(ui);

    expect((screen.getByLabelText(/Start at/) as HTMLInputElement).value).toBe("49627");
    expect((screen.getByLabelText(/How many/) as HTMLInputElement).value).toBe("10");
    expect(sheet().children).toHaveLength(10);
  });

  it("restores an added element and its content", async () => {
    const ui = render(<App />);

    await userEvent.click(screen.getByRole("button", { name: /Add text/i }));
    await setField("Content", "Batch GH");
    await waitForSave((s) =>
      s.designs.some((d) =>
        d.elements.some((e) => e.type === "text" && e.text === "Batch GH")
      )
    );

    await reload(ui);

    expect(sheet().textContent).toContain("Batch GH");
  });
});

describe("image imports", () => {
  it("imports an image as label artwork with a serial number", async () => {
    render(<App />);
    const input = document.querySelector('input[type="file"]');
    expect(input).not.toBeNull();

    const image = new File(["image data"], "citrus-label.png", { type: "image/png" });
    await userEvent.upload(input as HTMLInputElement, image);

    expect(
      await screen.findByRole("option", { name: /citrus-label \+ number/i })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("img", { name: "Label artwork" })[0]).toHaveAttribute(
      "src",
      "data:image/png;base64,aW1hZ2UgZGF0YQ=="
    );
    expect(screen.getAllByRole("img", { name: "Label artwork" })[0]).toHaveStyle({
      objectFit: "contain",
    });
    expect(screen.getAllByText("001").length).toBeGreaterThan(0);
  });
});

describe("fonts are ready before anything is shown or printed", () => {
  const FONT_SRC = "data:font/woff2;base64,AAAA";

  /** Seed a design that carries an uploaded font. */
  const seedWithFont = (resolveLoad: () => Promise<unknown>) => {
    const state: AppState = {
      version: 1,
      designs: [
        {
          id: "d1",
          name: "Custom font design",
          width: 120,
          height: 60,
          unit: "mm",
          background: "#ffffff",
          border: { style: "none", width: 0, color: "#000000", radius: 0 },
          fonts: [
            { id: "f1", family: "Acme Sans", src: FONT_SRC, weight: "normal", style: "normal" },
          ],
          elements: [
            {
              id: "t1",
              type: "text",
              name: "Title",
              x: 5,
              y: 5,
              width: 80,
              height: 10,
              rotation: 0,
              visible: true,
              text: "Pressed Juice",
              typography: {
                fontFamily: '"Acme Sans", sans-serif',
                fontSize: 14,
                fontWeight: 400,
                italic: false,
                underline: false,
                color: "#000000",
                align: "left",
                verticalAlign: "top",
                letterSpacing: 0,
                lineHeight: 1.25,
                textTransform: "none",
              },
            },
          ],
        },
      ],
      activeId: "d1",
      print: { startNumber: 1, count: 3, gap: 4 },
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));

    class FakeFontFace {
      constructor(
        public family: string,
        public source: string,
        public descriptors: Record<string, string> = {}
      ) {}
      load() {
        return resolveLoad().then(() => this);
      }
    }
    vi.stubGlobal("FontFace", FakeFontFace);

    // jsdom ships no document.fonts at all, so the loader's real-browser path
    // is never taken unless one is supplied. Without this the gate silently
    // short-circuits and these tests would pass while proving nothing.
    Object.defineProperty(document, "fonts", {
      configurable: true,
      value: {
        add: () => {},
        delete: () => true,
        load: () => Promise.resolve([]),
        ready: Promise.resolve(),
        status: "loaded",
        size: 0,
      },
    });
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    __resetFontRegistry();
    // Leave the environment as we found it for tests that assume no font API.
    Reflect.deleteProperty(document, "fonts");
  });

  it("does not paint label text until an uploaded font has loaded", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    seedWithFont(() => gate);

    render(<App />);

    // The text lives in two places — the canvas and the print sheet — so each
    // is checked on its own rather than through a document-wide query.
    const canvas = () => document.querySelector("main") as HTMLElement;
    const sheet = () => document.querySelector(".print-sheet") as HTMLElement;

    // Before the font resolves the text must not be rendered anywhere:
    // painting it in a fallback shows the wrong advance width, then reflows.
    expect(within(canvas()).queryByText("Pressed Juice")).toBeNull();
    expect(sheet().textContent).toBe("");
    expect(within(canvas()).getByText(/Loading fonts/)).toBeInTheDocument();

    release();

    await waitFor(() =>
      expect(within(canvas()).getByText("Pressed Juice")).toBeInTheDocument()
    );
    expect(within(canvas()).queryByText(/Loading fonts/)).toBeNull();
    expect(sheet().textContent).toContain("Pressed Juice");
  });

  it("waits for fonts before opening the print dialog", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    seedWithFont(() => gate);

    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(<App />);

    // While the face is still decoding, the sheet holds no labels — so even a
    // print triggered outside the app would have nothing to put on paper.
    const sheet = () => document.querySelector(".print-sheet") as HTMLElement;
    expect(sheet().children).toHaveLength(0);

    await userEvent.click(screen.getByRole("button", { name: /Print 3/ }));
    expect(printSpy).not.toHaveBeenCalled();

    release();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
    // By the time the dialog opens, the labels exist and are in the real font.
    expect(sheet().children).toHaveLength(3);
  });

  it("keeps the print sheet empty until fonts load, for browser-menu prints", async () => {
    // Ctrl+P from the browser chrome never runs our handler, so the sheet
    // itself must not hold fallback-rendered labels.
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    seedWithFont(() => gate);

    render(<App />);
    const sheet = () => document.querySelector(".print-sheet") as HTMLElement;

    expect(sheet().children).toHaveLength(0);
    expect(sheet().textContent).toBe("");

    release();
    await waitFor(() => expect(sheet().children).toHaveLength(3));
  });

  it("still prints when fonts never load, rather than hanging", async () => {
    // A font that never resolves must not strand the user: print proceeds
    // with fallbacks after the timeout, and says so.
    seedWithFont(() => new Promise(() => {}));
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Print 3/ }));

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1), { timeout: 15000 });
    expect(await screen.findByText(/did not load in time/i)).toBeInTheDocument();
  }, 20000);

  it("prints immediately when a design has no uploaded fonts", async () => {
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);

    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /^Print/ }));

    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });
});

describe("flagging fonts this machine lacks", () => {
  const INSTALLED = new Set(["Arial", "Georgia"]);

  /** Simulate a machine that has some families and not others. */
  const stubCanvasMetrics = () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      let current = "";
      return {
        set font(v: string) {
          current = v;
        },
        get font() {
          return current;
        },
        measureText: () => {
          const m = /^\d+px\s+"([^"]+)",/.exec(current);
          return { width: m?.[1] && INSTALLED.has(m[1]) ? 125 : 100 };
        },
      } as unknown as CanvasRenderingContext2D;
    });
  };

  const seedDesign = (fontFamily: string, fonts: unknown[] = []) => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        version: 1,
        designs: [
          {
            id: "d1",
            name: "Font check",
            width: 120,
            height: 60,
            unit: "mm",
            background: "#ffffff",
            border: { style: "none", width: 0, color: "#000000", radius: 0 },
            fonts,
            elements: [
              {
                id: "t1",
                type: "text",
                name: "Headline",
                x: 5,
                y: 5,
                width: 80,
                height: 10,
                rotation: 0,
                visible: true,
                text: "Pressed Juice",
                typography: {
                  fontFamily,
                  fontSize: 14,
                  fontWeight: 400,
                  italic: false,
                  underline: false,
                  color: "#000000",
                  align: "left",
                  verticalAlign: "top",
                  letterSpacing: 0,
                  lineHeight: 1.25,
                  textTransform: "none",
                },
              },
            ],
          },
        ],
        activeId: "d1",
        print: { startNumber: 1, count: 5, gap: 4 },
      })
    );
  };

  beforeEach(() => {
    resetAvailabilityCache();
    stubCanvasMetrics();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    resetAvailabilityCache();
  });

  it("warns when a design asks for a family the machine lacks", async () => {
    seedDesign("Brush Script MT, cursive");
    render(<App />);

    expect(await screen.findByText(/not installed here/i)).toBeInTheDocument();
    expect(screen.getByText("Brush Script MT")).toBeInTheDocument();
    expect(screen.getByText(/printing as cursive/i)).toBeInTheDocument();
  });

  it("names the element affected", async () => {
    seedDesign("Brush Script MT, cursive");
    render(<App />);

    // "Headline" also appears in the layer list, so scope to the warning.
    const warning = (await screen.findByText(/not installed here/i)).closest("div");
    expect(within(warning as HTMLElement).getByText("Headline")).toBeInTheDocument();
  });

  it("stays silent when the family is installed", async () => {
    seedDesign("Arial, Helvetica, sans-serif");
    render(<App />);
    const canvas = () => document.querySelector("main") as HTMLElement;
    await waitFor(() =>
      expect(within(canvas()).getByText("Pressed Juice")).toBeInTheDocument()
    );

    expect(screen.queryByText(/not installed here/i)).toBeNull();
  });

  it("stays silent for a family uploaded with the design", async () => {
    seedDesign('"Brand Script", cursive', [
      {
        id: "f1",
        family: "Brand Script",
        src: "data:font/woff2;base64,AAAA",
        weight: "normal",
        style: "normal",
      },
    ]);
    render(<App />);

    await waitFor(() => expect(screen.queryByText(/Loading fonts/)).toBeNull());
    expect(screen.queryByText(/not installed here/i)).toBeNull();
  });

  it("asks for confirmation before printing with a substituted font", async () => {
    seedDesign("Brush Script MT, cursive");
    const printSpy = vi.fn();
    const confirmSpy: Mock<(message: string) => boolean> = vi.fn(() => true);
    vi.stubGlobal("print", printSpy);
    vi.stubGlobal("confirm", confirmSpy);

    render(<App />);
    await screen.findByText(/not installed here/i);
    await userEvent.click(screen.getByRole("button", { name: /Print 5/ }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    const message = confirmSpy.mock.calls[0][0] ?? "";
    expect(message).toContain("Brush Script MT");
    expect(message).toMatch(/not installed/i);
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it("does not print when the confirmation is declined", async () => {
    seedDesign("Brush Script MT, cursive");
    const printSpy = vi.fn();
    vi.stubGlobal("print", printSpy);
    vi.stubGlobal("confirm", vi.fn(() => false));

    render(<App />);
    await screen.findByText(/not installed here/i);
    await userEvent.click(screen.getByRole("button", { name: /Print 5/ }));

    expect(printSpy).not.toHaveBeenCalled();
  });

  it("does not ask for confirmation when every font is available", async () => {
    seedDesign("Arial, Helvetica, sans-serif");
    const printSpy = vi.fn();
    const confirmSpy = vi.fn(() => true);
    vi.stubGlobal("print", printSpy);
    vi.stubGlobal("confirm", confirmSpy);

    render(<App />);
    const canvas = document.querySelector("main") as HTMLElement;
    await waitFor(() =>
      expect(within(canvas).getByText("Pressed Juice")).toBeInTheDocument()
    );
    await userEvent.click(screen.getByRole("button", { name: /Print 5/ }));

    expect(confirmSpy).not.toHaveBeenCalled();
    await waitFor(() => expect(printSpy).toHaveBeenCalledTimes(1));
  });

  it("flags the missing family on the selected element too", async () => {
    seedDesign("Brush Script MT, cursive");
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: /Select Headline/ }));

    expect(
      await screen.findByText(/prints in a substitute with different widths/i)
    ).toBeInTheDocument();
  });
});

describe("numbering end to end", () => {
  // Drives six fields through the whole app, so it needs more than the
  // default 5s budget on a cold run.
  it('produces GH49627 to GH49636 for prefix "GH", start 49627, count 10', { timeout: 20000 }, async () => {
    render(<App />);

    // Start from a blank design so the only number element is the one we set up.
    await userEvent.click(screen.getByRole("button", { name: "+ New" }));
    await userEvent.click(screen.getByRole("button", { name: /Blank 120/ }));
    await userEvent.click(screen.getByRole("button", { name: /Select Serial number/ }));

    await setField("Prefix", "GH");
    await setField(/Pad to digits/, "0");
    await setField(/Start at/, "49627");
    await setField(/How many/, "10");

    await waitFor(() => expect(sheet().children).toHaveLength(10));

    const rendered = Array.from(sheet().children).map((label) => label.textContent);
    expect(rendered[0]).toBe("GH49627");
    expect(rendered.at(-1)).toBe("GH49636");
    expect(new Set(rendered).size).toBe(10);
  });
});
