import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { STORAGE_KEY } from "./lib/storage";
import { PX_PER_MM } from "./lib/units";
import type { AppState, ImageElement, LabelDesign } from "./types";

/**
 * End-to-end checks for the editor chrome: tools and their shortcuts, the
 * options bar, categorised properties, panels, tabs, placing and cropping
 * images, alignment and zoom.
 */

const saved = () => {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? (JSON.parse(raw) as AppState) : null;
};
const savedElement = (name: string) =>
  saved()?.designs[0].elements.find((e) => e.name === name);

const viewport = () => document.querySelector(".canvas-viewport") as HTMLElement;
const sheet = () => document.querySelector(".print-sheet") as HTMLElement;
const toolButton = (label: string) => screen.getByRole("button", { name: `${label} tool` });
const docTabs = () => within(screen.getByRole("tablist", { name: "Open designs" })).getAllByRole("tab");

/** A 100 × 50 mm label holding one image and one text layer. */
const seed = () => {
  const design: LabelDesign = {
    id: "d1",
    name: "Seeded",
    width: 100,
    height: 50,
    unit: "mm",
    background: "#ffffff",
    border: { style: "none", width: 0, color: "#000000", radius: 0 },
    fonts: [],
    elements: [
      {
        id: "img",
        type: "image",
        name: "Photo",
        x: 0,
        y: 0,
        width: 100,
        height: 50,
        rotation: 0,
        visible: true,
        src: "photo.png",
        fit: "fill",
      },
      {
        id: "t1",
        type: "text",
        name: "Title",
        x: 30,
        y: 10,
        width: 40,
        height: 10,
        rotation: 0,
        visible: true,
        text: "Hello",
        typography: {
          fontFamily: "Arial, Helvetica, sans-serif",
          fontSize: 10,
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
  };
  const state: AppState = {
    version: 1,
    designs: [design],
    activeId: "d1",
    print: { startNumber: 1, count: 2, gap: 4 },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

/** Natural size reported for any placed image: 378 × 189 px ≈ 100 × 50 mm. */
class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  set src(_value: string) {
    setTimeout(() => {
      this.naturalWidth = 378;
      this.naturalHeight = 189;
      this.onload?.();
    }, 0);
  }
}

beforeEach(() => {
  vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Zoom to 100% so 1 mm is exactly PX_PER_MM screen pixels. */
const actualSize = async () => {
  await userEvent.keyboard("{Control>}1{/Control}");
};

describe("tools and keyboard shortcuts", () => {
  it.each([
    ["t", "Text"],
    ["n", "Serial number"],
    ["u", "Shape"],
    ["b", "Brush"],
    ["e", "Eraser"],
    ["c", "Crop"],
    ["z", "Zoom"],
    ["h", "Hand"],
    ["v", "Move"],
  ])("pressing %s selects the %s tool", async (key, label) => {
    render(<App />);
    await userEvent.keyboard(key);
    expect(toolButton(label)).toHaveAttribute("aria-pressed", "true");
    // The options bar follows the tool.
    expect(screen.getByRole("toolbar", { name: `${label} tool options` })).toBeInTheDocument();
  });

  it("ignores tool shortcuts while typing in a field", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("Design name"), "t");
    expect(toolButton("Move")).toHaveAttribute("aria-pressed", "true");
  });

  it("has no dimension-first image tool any more", () => {
    render(<App />);
    expect(screen.queryByRole("button", { name: "Add image" })).toBeNull();
    // No quick-add buttons for text, numbers or images in the Layers panel either.
    expect(screen.queryByRole("button", { name: /^Add (text|number|shape)$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Place embedded image" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Image tool/ })).toBeNull();
  });

  it("places text where the text tool is clicked and focuses its content", async () => {
    seed();
    render(<App />);
    await userEvent.keyboard("t");
    const before = saved()?.designs[0].elements.length ?? 2;
    fireEvent.pointerDown(viewport(), { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerUp(window, { clientX: 0, clientY: 0 });

    await waitFor(() => expect(saved()?.designs[0].elements.length).toBe(before + 1));
    expect(screen.getByLabelText("Content")).toHaveFocus();
  });
});

describe("options bar", () => {
  it("aligns a single layer to the label from the Move tool options", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Title" }));
    const options = screen.getByRole("toolbar", { name: "Move tool options" });
    await userEvent.click(within(options).getByRole("button", { name: "Align left edges to the label" }));
    await waitFor(() => expect(savedElement("Title")?.x).toBe(0));

    await userEvent.click(within(options).getByRole("button", { name: "Centre both ways to the label" }));
    await waitFor(() => {
      expect(savedElement("Title")?.x).toBe(30);
      expect(savedElement("Title")?.y).toBe(20);
    });
  });

  it("aligns several layers to each other", async () => {
    seed();
    render(<App />);
    const layers = screen.getByRole("list", { name: "Layers" });
    fireEvent.click(within(layers).getByRole("button", { name: "Title" }));
    fireEvent.click(within(layers).getByRole("button", { name: "Photo" }), { shiftKey: true });

    const options = screen.getByRole("toolbar", { name: "Move tool options" });
    await userEvent.click(within(options).getByRole("button", { name: "Align right edges to the selection" }));
    // The selection spans 0–100 mm, so the 40 mm title moves to x = 60.
    await waitFor(() => expect(savedElement("Title")?.x).toBe(60));
    expect(savedElement("Photo")?.x).toBe(0);
  });

  it("edits the selected text from the Text tool options", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Title" }));
    await userEvent.keyboard("{Escape}");
    await userEvent.click(screen.getByRole("button", { name: "Select Title" }));
    await userEvent.click(toolButton("Text"));
    const size = screen.getByLabelText("Size");
    await userEvent.clear(size);
    await userEvent.type(size, "24");
    await waitFor(() => {
      const t = savedElement("Title");
      expect(t?.type === "text" && t.typography.fontSize).toBe(24);
    });
  });
});

describe("transform handles", () => {
  it("shows eight handles around the selected layer", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Photo" }));
    expect(screen.getAllByRole("button", { name: /^Resize Photo/ })).toHaveLength(8);
  });

  it("stretches only the width from a side handle", async () => {
    seed();
    render(<App />);
    await actualSize();
    await userEvent.click(screen.getByRole("button", { name: "Select Title" }));
    const east = screen.getByRole("button", { name: "Resize Title (e)" });
    fireEvent.pointerDown(east, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 10 * PX_PER_MM, clientY: 50 });
    fireEvent.pointerUp(window);
    await waitFor(() => {
      expect(savedElement("Title")?.width).toBeCloseTo(50);
      expect(savedElement("Title")?.height).toBe(10);
    });
  });
});

describe("categorised properties", () => {
  it("shows one category at a time", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Title" }));

    expect(screen.getByRole("tab", { name: "Text" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByLabelText("Content")).toBeInTheDocument();
    expect(screen.queryByLabelText("Font")).toBeNull();

    await userEvent.click(screen.getByRole("tab", { name: "Character" }));
    expect(screen.getByLabelText("Font")).toBeInTheDocument();
    expect(screen.queryByLabelText("Content")).toBeNull();
    // Rarely used settings stay folded until asked for.
    expect(screen.queryByText("Tracking")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "More options" }));
    expect(screen.getByText("Tracking")).toBeInTheDocument();
  });

  it("opens a category from the right-click menu", async () => {
    seed();
    render(<App />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Select Title" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Paragraph…" }));
    expect(screen.getByRole("tab", { name: "Paragraph" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("panels and tabs", () => {
  it("closes a panel and brings it back from the Window menu", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Close Layers panel" }));
    expect(screen.queryByRole("region", { name: "Layers panel" })).toBeNull();

    await userEvent.click(screen.getByRole("menuitem", { name: "Window" }));
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Layers" }));
    expect(screen.getByRole("region", { name: "Layers panel" })).toBeInTheDocument();
  });

  it("hides every panel with F and restores them", async () => {
    render(<App />);
    await userEvent.keyboard("f");
    expect(screen.queryByRole("region", { name: "Properties panel" })).toBeNull();
    await userEvent.keyboard("f");
    expect(screen.getByRole("region", { name: "Properties panel" })).toBeInTheDocument();
  });

  it("closing a design tab keeps the design", async () => {
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "New or open design" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Blank 120/ }));
    expect(docTabs()).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Close Untitled label tab" }));
    expect(docTabs()).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "New or open design" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Untitled label" }));
    expect(screen.getByRole("tab", { name: "Untitled label" })).toHaveAttribute("aria-selected", "true");
  });
});

describe("placing images", () => {
  const png = () => new File(["png-bytes"], "logo.png", { type: "image/png" });

  it("places an embedded image into the current design from File › Place Embedded…", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("menuitem", { name: "File" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Place Embedded…" }));
    await userEvent.upload(screen.getByLabelText("Choose images to place"), png());

    const layer = await screen.findByRole("button", { name: "Select logo" });
    expect(layer).toBeInTheDocument();
    // Still the same design — placing never creates a new one.
    expect(docTabs()).toHaveLength(1);
    await waitFor(() => {
      const logo = savedElement("logo") as ImageElement | undefined;
      expect(logo?.src).toMatch(/^data:image\/png;base64,/);
      // Natural 378 × 189 px is 100 × 50 mm, scaled to fit 80% of the label.
      expect(logo?.width).toBeCloseTo(80);
      expect(logo?.height).toBeCloseTo(40);
    });
  });

  it("places an image dropped on the canvas", async () => {
    seed();
    render(<App />);
    fireEvent.drop(viewport(), {
      dataTransfer: { files: [png()], types: ["Files"] },
      clientX: 0,
      clientY: 0,
    });
    expect(await screen.findByRole("button", { name: "Select logo" })).toBeInTheDocument();
  });

  it("fills an empty image slot when dropped onto it", async () => {
    seed();
    const state = JSON.parse(localStorage.getItem(STORAGE_KEY)!) as AppState;
    (state.designs[0].elements[0] as ImageElement).src = "";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    render(<App />);

    fireEvent.drop(screen.getByRole("button", { name: "Select Photo" }), {
      dataTransfer: { files: [png()], types: ["Files"] },
    });
    await waitFor(() => expect((savedElement("Photo") as ImageElement).src).toMatch(/^data:image\/png/));
    expect(screen.queryByRole("button", { name: "Select logo" })).toBeNull();
  });
});

describe("cropping and editing images", () => {
  it("crops with the crop tool and applies with Enter", async () => {
    seed();
    render(<App />);
    await actualSize();
    await userEvent.click(screen.getByRole("button", { name: "Select Photo" }));
    await userEvent.keyboard("c");
    expect(screen.getByRole("group", { name: "Crop Photo" })).toBeInTheDocument();

    // Drag the right edge 40 mm in.
    const east = screen.getByRole("button", { name: "Crop handle e" });
    fireEvent.pointerDown(east, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: -40 * PX_PER_MM, clientY: 0 });
    fireEvent.pointerUp(window);
    await userEvent.keyboard("{Enter}");

    await waitFor(() => {
      const photo = savedElement("Photo") as ImageElement;
      expect(photo.width).toBeCloseTo(60);
      expect(photo.crop?.right).toBeCloseTo(0.4);
    });
    expect(screen.queryByRole("group", { name: "Crop Photo" })).toBeNull();
    // The printed image is laid over the full frame and clipped to the crop.
    const printed = within(sheet()).getAllByRole("img", { name: "Photo" })[0];
    expect(printed.style.width).toMatch(/^166\.66/);
  });

  it("cancels a crop with Esc", async () => {
    seed();
    render(<App />);
    await actualSize();
    await userEvent.click(screen.getByRole("button", { name: "Select Photo" }));
    await userEvent.keyboard("c");
    const east = screen.getByRole("button", { name: "Crop handle e" });
    fireEvent.pointerDown(east, { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: -40 * PX_PER_MM, clientY: 0 });
    fireEvent.pointerUp(window);
    await userEvent.keyboard("{Escape}");

    expect(screen.queryByRole("group", { name: "Crop Photo" })).toBeNull();
    await new Promise((r) => setTimeout(r, 400));
    expect((savedElement("Photo") as ImageElement).crop).toBeUndefined();
  });

  it("applies an adjustment preset from the Image menu", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Photo" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Image" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /Quick looks/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Black & white" }));

    // Effects apply to the whole layer frame, after any crop.
    for (const img of screen.getAllByRole("img", { name: "Photo" })) {
      expect((img.parentElement as HTMLElement).style.filter).toContain("grayscale(100%)");
    }
  });

  it("adds and edits an effect in the Effects category", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: "Select Photo" }));
    await userEvent.click(screen.getByRole("tab", { name: "Effects" }));
    await userEvent.click(screen.getByRole("button", { name: /Add effect/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Brightness" }));
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    await waitFor(() =>
      expect((savedElement("Photo") as ImageElement).effects?.[0]).toMatchObject({ kind: "brightness", amount: 150 })
    );
    const frame = screen.getAllByRole("img", { name: "Photo" })[0].parentElement as HTMLElement;
    expect(frame.style.filter).toContain("brightness(150%)");
  });
});

describe("zoom", () => {
  const zoomReadout = () => {
    const footer = document.querySelector("footer") as HTMLElement;
    return within(footer).getByText(/^\d+%$/).textContent;
  };

  it("zooms with Alt + scroll, and not with a plain scroll", async () => {
    render(<App />);
    const start = zoomReadout();
    fireEvent.wheel(viewport(), { deltaY: 100 });
    expect(zoomReadout()).toBe(start);

    fireEvent.wheel(viewport(), { deltaY: -300, altKey: true });
    await waitFor(() => expect(Number.parseInt(zoomReadout() ?? "0")).toBeGreaterThan(Number.parseInt(start ?? "0")));
  });

  it("zooms in on click with the zoom tool", async () => {
    render(<App />);
    await actualSize();
    expect(zoomReadout()).toBe("100%");
    await userEvent.keyboard("z");
    fireEvent.pointerDown(viewport(), { button: 0, clientX: 10, clientY: 10 });
    expect(zoomReadout()).toBe("125%");
    fireEvent.pointerDown(viewport(), { button: 0, clientX: 10, clientY: 10, altKey: true });
    expect(zoomReadout()).toBe("100%");
  });
});

describe("undo", () => {
  it("undoes and redoes adding a layer", async () => {
    seed();
    render(<App />);
    await userEvent.click(screen.getByRole("menuitem", { name: "Layer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: "New layer" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Shape/ }));
    expect(screen.getByRole("button", { name: "Select Shape" })).toBeInTheDocument();

    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(screen.queryByRole("button", { name: "Select Shape" })).toBeNull();

    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(screen.getByRole("button", { name: "Select Shape" })).toBeInTheDocument();
  });

  it("undoes a whole drag in one step", async () => {
    seed();
    render(<App />);
    await actualSize();
    const title = screen.getByRole("button", { name: "Select Title" });
    fireEvent.pointerDown(title, { button: 0, clientX: 0, clientY: 0 });
    for (let i = 1; i <= 5; i += 1) {
      fireEvent.pointerMove(window, { clientX: i * 2 * PX_PER_MM, clientY: 0 });
    }
    fireEvent.pointerUp(window);
    await waitFor(() => expect(savedElement("Title")?.x).toBeCloseTo(40));

    await userEvent.keyboard("{Control>}z{/Control}");
    await waitFor(() => expect(savedElement("Title")?.x).toBe(30));
  });
});
