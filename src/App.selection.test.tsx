import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { STORAGE_KEY } from "./lib/storage";
import { PX_PER_MM } from "./lib/units";
import type { AppState, LabelDesign } from "./types";

/**
 * Pixel selections, the selection tools, layer masks and the AI panel, end
 * to end. jsdom has no 2D canvas, so these cover what doesn't need real
 * pixels; the pixel maths has its own unit tests.
 */

const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as AppState | null;
const savedEl = (name: string) => saved()?.designs[0].elements.find((e) => e.name === name);
const viewport = () => document.querySelector(".canvas-viewport") as HTMLElement;
const ants = () => document.querySelector('[data-testid="marching-ants"]');
const toolButton = (label: string) => screen.getByRole("button", { name: `${label} tool` });

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
        id: "box",
        type: "shape",
        name: "Box",
        x: 10,
        y: 10,
        width: 40,
        height: 20,
        rotation: 0,
        visible: true,
        fill: "#ff0000",
        border: { style: "none", width: 0, color: "#000000", radius: 0 },
      },
    ],
  };
  const state: AppState = { version: 1, designs: [design], activeId: "d1", print: { startNumber: 1, count: 1, gap: 2 } };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
};

/** At 100% zoom, so 1 mm is PX_PER_MM screen pixels from the label's corner. */
const at = (mm: number) => mm * PX_PER_MM;

const drag = (from: [number, number], to: [number, number], init: { shiftKey?: boolean; altKey?: boolean } = {}) => {
  fireEvent.pointerDown(viewport(), { button: 0, clientX: at(from[0]), clientY: at(from[1]), ...init });
  fireEvent.pointerMove(window, { clientX: at((from[0] + to[0]) / 2), clientY: at((from[1] + to[1]) / 2) });
  fireEvent.pointerMove(window, { clientX: at(to[0]), clientY: at(to[1]) });
  fireEvent.pointerUp(window, { clientX: at(to[0]), clientY: at(to[1]) });
};

const openMenu = async (...path: (string | RegExp)[]) => {
  for (const name of path) await userEvent.click(await screen.findByRole("menuitem", { name }));
};

const setup = async () => {
  seed();
  render(<App />);
  await userEvent.keyboard("{Control>}1{/Control}");
};

describe("selection tools", () => {
  it("picks tools from shared slots: M, L and W, with Shift cycling", async () => {
    await setup();
    await userEvent.keyboard("m");
    expect(toolButton("Rectangular marquee")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Shift>}M{/Shift}");
    expect(toolButton("Elliptical marquee")).toHaveAttribute("aria-pressed", "true");
    // The slot remembers the ellipse.
    await userEvent.keyboard("v");
    await userEvent.keyboard("m");
    expect(toolButton("Elliptical marquee")).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("l");
    expect(toolButton("Lasso")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Shift>}L{/Shift}");
    expect(toolButton("Polygonal lasso")).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("w");
    expect(toolButton("Object selection")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Shift>}W{/Shift}");
    expect(toolButton("Quick selection")).toHaveAttribute("aria-pressed", "true");
    await userEvent.keyboard("{Shift>}W{/Shift}");
    expect(toolButton("Magic wand")).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("j");
    expect(toolButton("Remove")).toHaveAttribute("aria-pressed", "true");
  });

  it("drags a marquee into a selection, drops it with Esc and gets it back with Reselect", async () => {
    await setup();
    await userEvent.keyboard("m");
    expect(ants()).toBeNull();
    drag([20, 10], [60, 30]);
    await waitFor(() => expect(ants()).not.toBeNull());
    expect(ants()?.querySelector("path")?.getAttribute("d")).toMatch(/^M/);

    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(ants()).toBeNull());

    await openMenu("Select", /^Reselect/);
    await waitFor(() => expect(ants()).not.toBeNull());
  });

  it("deselects with a plain marquee click and with Ctrl+D while a selection tool is active", async () => {
    await setup();
    await userEvent.keyboard("m");
    drag([20, 10], [60, 30]);
    await waitFor(() => expect(ants()).not.toBeNull());
    fireEvent.pointerDown(viewport(), { button: 0, clientX: at(70), clientY: at(40) });
    fireEvent.pointerUp(window, { clientX: at(70), clientY: at(40) });
    await waitFor(() => expect(ants()).toBeNull());

    drag([20, 10], [60, 30]);
    await waitFor(() => expect(ants()).not.toBeNull());
    const layersBefore = saved()?.designs[0].elements.length;
    await userEvent.keyboard("{Control>}d{/Control}");
    await waitFor(() => expect(ants()).toBeNull());
    // Ctrl+D did not duplicate a layer while a selection tool was active.
    expect(saved()?.designs[0].elements.length).toBe(layersBefore);
  });

  it("subtracts with Alt-drag: the outline of what is left changes", async () => {
    await setup();
    await userEvent.keyboard("m");
    drag([10, 10], [60, 40]);
    await waitFor(() => expect(ants()).not.toBeNull());
    const whole = ants()?.querySelector("path")?.getAttribute("d");
    drag([30, 0], [80, 50], { altKey: true });
    await waitFor(() => expect(ants()?.querySelector("path")?.getAttribute("d")).not.toBe(whole));
    // Subtracting everything leaves no selection.
    drag([0, 0], [100, 50], { altKey: true });
    await waitFor(() => expect(ants()).toBeNull());
  });

  it("selects the whole label with Select › Inverse when nothing is selected", async () => {
    await setup();
    await openMenu("Select", /^Inverse/);
    await waitFor(() => expect(ants()).not.toBeNull());
    await openMenu("Select", /^Deselect/);
    await waitFor(() => expect(ants()).toBeNull());
  });

  it("closes a polygonal lasso with Enter, and Esc abandons one without dropping the selection", async () => {
    await setup();
    await userEvent.keyboard("{Shift>}L{/Shift}");
    expect(toolButton("Polygonal lasso")).toHaveAttribute("aria-pressed", "true");
    const click = (x: number, y: number) => {
      fireEvent.pointerDown(viewport(), { button: 0, clientX: at(x), clientY: at(y) });
      fireEvent.pointerUp(window, { clientX: at(x), clientY: at(y) });
    };
    click(10, 10);
    await new Promise((r) => setTimeout(r, 400)); // not a double-click
    click(60, 10);
    await new Promise((r) => setTimeout(r, 400));
    click(30, 40);
    expect(document.querySelector('[data-testid="selection-draft"]')).not.toBeNull();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(ants()).not.toBeNull());

    // A new polygon, abandoned: the existing selection stays.
    click(70, 10);
    await userEvent.keyboard("{Escape}");
    expect(document.querySelector('[data-testid="selection-draft"]')).toBeNull();
    expect(ants()).not.toBeNull();
  });

  it("feathers from Select › Modify, in millimetres", async () => {
    await setup();
    await userEvent.keyboard("m");
    drag([20, 10], [60, 30]);
    await waitFor(() => expect(ants()).not.toBeNull());
    await openMenu("Select", /Modify/, /^Feather…/);
    const dialog = await screen.findByRole("dialog", { name: "Feather selection" });
    expect(within(dialog).getByText("mm")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: "OK" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Feather selection" })).toBeNull());
    expect(ants()).not.toBeNull();
  });
});

describe("layer masks", () => {
  it("masks a layer to the selection, shows the mask in Layers, and keeps it after a reload", async () => {
    await setup();
    const layers = screen.getByRole("list", { name: "Layers" });
    await userEvent.click(within(layers).getByRole("button", { name: "Box" }));
    await userEvent.keyboard("m");
    drag([10, 10], [30, 30]);
    await waitFor(() => expect(ants()).not.toBeNull());

    await openMenu("Layer", "Layer mask", "Reveal selection");
    await waitFor(() => expect(savedEl("Box")?.mask?.src).toMatch(/^data:image\/png;base64,/));
    expect(savedEl("Box")?.mask?.enabled).toBe(true);
    // Masking with the selection uses it up.
    await waitFor(() => expect(ants()).toBeNull());
    expect(within(layers).getByRole("button", { name: "Mask of Box" })).toBeInTheDocument();

    // Shift-click the thumbnail turns the mask off without losing it.
    fireEvent.click(within(layers).getByRole("button", { name: "Mask of Box" }), { shiftKey: true });
    await waitFor(() => expect(savedEl("Box")?.mask?.enabled).toBe(false));
  });

  it("Delete with a selection hides those pixels with a mask instead of deleting the layer", async () => {
    await setup();
    const layers = screen.getByRole("list", { name: "Layers" });
    await userEvent.click(within(layers).getByRole("button", { name: "Box" }));
    await userEvent.keyboard("m");
    drag([10, 10], [20, 20]);
    await waitFor(() => expect(ants()).not.toBeNull());
    await userEvent.keyboard("{Delete}");
    await waitFor(() => expect(savedEl("Box")?.mask).toBeDefined());
    expect(savedEl("Box")).toBeDefined();
  });

  it("clicking a mask thumbnail targets it for painting, and the layer name targets pixels again", async () => {
    await setup();
    const layers = screen.getByRole("list", { name: "Layers" });
    await userEvent.click(within(layers).getByRole("button", { name: "Box" }));
    await openMenu("Layer", "Layer mask", "Reveal all");
    const thumb = await within(layers).findByRole("button", { name: "Mask of Box" });
    await userEvent.click(thumb);
    expect(thumb).toHaveAttribute("aria-pressed", "true");
    expect(toolButton("Brush")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByText(/Painting on the mask of "Box"/).length).toBeGreaterThan(0);
    await userEvent.click(within(layers).getByRole("button", { name: "Box" }));
    expect(within(layers).getByRole("button", { name: "Mask of Box" })).toHaveAttribute("aria-pressed", "false");
  });
});

describe("generative AI panel", () => {
  it("explains how to start the local server when it is not running, and disables AI commands", async () => {
    await setup();
    await userEvent.click(screen.getByRole("button", { name: /Expand Generative AI panel/ }));
    expect(await screen.findByText("Not running")).toBeInTheDocument();
    expect(screen.getByText(/python -m label_ai/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    expect(screen.getByRole("menuitem", { name: "Subject" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("menuitem", { name: "Sky" })).toHaveAttribute("aria-disabled", "true");
  });

  it("connects to a running server, lists its models and enables the AI commands", async () => {
    const model = (id: string, caps: string[], available = true) => ({
      id,
      name: id,
      capabilities: caps,
      description: "",
      license: "Apache-2.0",
      available,
      loaded: false,
      reason: available ? null : "pip install -r requirements-models.txt",
      size: null,
    });
    const catalog = {
      capabilities: {
        segment: { default: "sam-vit-base", models: [model("sam-vit-base", ["segment"]), model("grabcut", ["segment"])] },
        subject: { default: "birefnet", models: [model("birefnet", ["subject"])] },
        segment_text: { default: null, models: [model("clipseg", ["segment_text"], false)] },
        matte: { default: null, models: [] },
        remove: { default: "lama", models: [model("lama", ["remove"])] },
        inpaint: { default: null, models: [] },
        generate: { default: null, models: [] },
        variations: { default: null, models: [] },
        edit: { default: null, models: [] },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        const body = url.endsWith("/api/health")
          ? { status: "ok", version: "1.0.0", device: "cpu", profile: "standard" }
          : url.endsWith("/api/models")
            ? catalog
            : { error: { code: "not_found", message: "nope" } };
        return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
      })
    );
    await setup();
    await userEvent.click(screen.getByRole("button", { name: /Expand Generative AI panel/ }));
    expect(await screen.findByText("Connected")).toBeInTheDocument();
    expect(screen.getByText(/CPU · standard/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("menuitem", { name: "Select" }));
    expect(screen.getByRole("menuitem", { name: "Subject" })).not.toHaveAttribute("aria-disabled", "true");
    // No text-segmentation model installed: Sky stays off.
    expect(screen.getByRole("menuitem", { name: "Sky" })).toHaveAttribute("aria-disabled", "true");
    await userEvent.keyboard("{Escape}");

    // Model pickers show what the server offers, unavailable ones marked.
    await userEvent.click(screen.getByRole("button", { name: "Models" }));
    const picker = screen.getByRole("combobox", { name: /Object selection/ });
    expect(within(picker).getByRole("option", { name: /Server default \(sam-vit-base\)/ })).toBeInTheDocument();
    expect(within(picker).getByRole("option", { name: /grabcut/ })).toBeInTheDocument();
    const textPicker = screen.getByRole("combobox", { name: /Select by description/ });
    expect(within(textPicker).getByRole("option", { name: /clipseg.*not installed/ })).toBeDisabled();
  });
});
