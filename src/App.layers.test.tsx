import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "./App";
import { STORAGE_KEY } from "./lib/storage";
import { PX_PER_MM } from "./lib/units";
import type { AppState, ImageElement, LabelDesign, LabelElement, ShapeElement } from "./types";

/**
 * Layers panel, groups, shapes, effects and the brush, end to end.
 */

const saved = () => JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as AppState | null;
const savedDesign = () => saved()?.designs[0];
const savedEl = (name: string) => savedDesign()?.elements.find((e) => e.name === name);
const order = () => savedDesign()?.elements.map((e) => e.name);

const box = (name: string, x: number): LabelElement => ({
  id: name.replace(/\W/g, "").toLowerCase(),
  type: "shape",
  name,
  x,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  visible: true,
  fill: "#ff0000",
  border: { style: "solid", width: 0.5, color: "#000000", radius: 0 },
});

/** Bottom → top: Photo, Box A, Box B, Box C. */
const seed = (extra: Partial<LabelDesign> = {}) => {
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
        x: 50,
        y: 20,
        width: 40,
        height: 20,
        rotation: 0,
        visible: true,
        src: "photo.png",
        fit: "fill",
      },
      box("Box A", 0),
      box("Box B", 20),
      box("Box C", 40),
    ],
    ...extra,
  };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ version: 1, designs: [design], activeId: "d1", print: { startNumber: 1, count: 1, gap: 4 } })
  );
};

const layersList = () => screen.getByRole("list", { name: "Layers" });
const row = (name: string) => within(layersList()).getByRole("button", { name });
const rowBox = (name: string) => row(name).closest("[data-row-id]") as HTMLElement;
const dt = () => ({ setData: () => {}, getData: () => "", types: ["application/x-label-layers"] });

/** The first label on the print sheet — what actually reaches paper. */
const printed = () => document.querySelector(".print-sheet")?.firstElementChild as HTMLElement;

afterEach(() => vi.restoreAllMocks());

describe("Layers panel", () => {
  it("has no up/down buttons — layers reorder by drag and drop", async () => {
    seed();
    render(<App />);
    expect(screen.queryByRole("button", { name: /Move .* (forward|backward)/ })).toBeNull();

    // Drag Box A above Box C (jsdom rows have no height, so drops land "above").
    fireEvent.dragStart(rowBox("Box A"), { dataTransfer: dt() });
    fireEvent.dragOver(rowBox("Box C"), { dataTransfer: dt(), clientY: 0 });
    fireEvent.drop(rowBox("Box C"), { dataTransfer: dt(), clientY: 0 });

    await waitFor(() => expect(order()).toEqual(["Photo", "Box B", "Box C", "Box A"]));
  });

  it("Shift-click selects every layer between two clicks; Ctrl-click deselects", async () => {
    seed();
    render(<App />);
    fireEvent.click(row("Box C"));
    fireEvent.click(row("Photo"), { shiftKey: true });
    for (const name of ["Box C", "Box B", "Box A", "Photo"]) {
      expect(rowBox(name).className).toContain("accent-soft");
    }

    fireEvent.click(row("Box B"), { ctrlKey: true });
    expect(rowBox("Box B").className).not.toContain("accent-soft");
    expect(rowBox("Box A").className).toContain("accent-soft");
  });

  it("filters layers by kind with icon-only buttons", async () => {
    seed();
    render(<App />);
    const filter = screen.getByRole("button", { name: "Images" });
    // The label is a hover tooltip, not visible text next to the icon.
    expect(filter.textContent).toBe("");
    expect(filter).toHaveAttribute("data-tip", "Images");

    fireEvent.click(filter);
    expect(within(layersList()).getByRole("button", { name: "Photo" })).toBeInTheDocument();
    expect(within(layersList()).queryByRole("button", { name: "Box A" })).toBeNull();
    fireEvent.click(filter);
    expect(row("Box A")).toBeInTheDocument();
  });

  it("creates a pixel layer and deletes the selection from the footer icons", async () => {
    seed();
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "New pixel layer" }));
    await waitFor(() => expect(savedEl("Layer 1")?.type).toBe("raster"));

    fireEvent.click(row("Box B"));
    fireEvent.click(screen.getByRole("button", { name: "Delete selected layers" }));
    await waitFor(() => expect(savedEl("Box B")).toBeUndefined());
  });
});

describe("groups", () => {
  it("groups the selection with Ctrl+G and works on it as one", async () => {
    seed();
    render(<App />);
    fireEvent.click(row("Box A"));
    fireEvent.click(row("Box B"), { shiftKey: true });
    await userEvent.keyboard("{Control>}g{/Control}");

    await waitFor(() => expect(savedDesign()?.groups).toHaveLength(1));
    const groupId = savedDesign()!.groups![0].id;
    expect(savedEl("Box A")?.groupId).toBe(groupId);
    expect(savedEl("Box B")?.groupId).toBe(groupId);
    expect(within(layersList()).getByRole("button", { name: "Group 1" })).toBeInTheDocument();

    // Dragging one member on the canvas moves the whole selected group.
    await userEvent.keyboard("{Control>}1{/Control}");
    const hit = screen.getByRole("button", { name: "Select Box A" });
    fireEvent.pointerDown(hit, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 5 * PX_PER_MM, clientY: 0 });
    fireEvent.pointerUp(window);
    await waitFor(() => {
      expect(savedEl("Box A")?.x).toBeCloseTo(5);
      expect(savedEl("Box B")?.x).toBeCloseTo(25);
    });
    expect(savedEl("Box C")?.x).toBe(40);
  });

  it("hiding a group hides its layers on paper", async () => {
    seed({
      groups: [{ id: "g", name: "Pair", visible: true, collapsed: false }],
      elements: [{ ...box("Box A", 0), groupId: "g" }, { ...box("Box B", 20), groupId: "g" }, box("Box C", 40)],
    });
    render(<App />);
    expect(printed().children).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: "Hide Pair" }));
    await waitFor(() => expect(printed().children).toHaveLength(1));
  });

  it("aligns a group as a single unit", async () => {
    seed({
      groups: [{ id: "g", name: "Pair", visible: true, collapsed: false }],
      elements: [{ ...box("Box A", 10), groupId: "g" }, { ...box("Box B", 30), groupId: "g" }],
    });
    render(<App />);
    fireEvent.click(row("Pair"));
    const options = screen.getByRole("toolbar", { name: "Move tool options" });
    fireEvent.click(within(options).getByRole("button", { name: "Align right edges to the label" }));
    // The pair spans 10–40mm; aligned right on a 100mm label it spans 70–100.
    await waitFor(() => {
      expect(savedEl("Box A")?.x).toBe(70);
      expect(savedEl("Box B")?.x).toBe(90);
    });
  });

  it("drops a layer into a group and ungroups with Ctrl+Shift+G", async () => {
    seed({
      groups: [{ id: "g", name: "Pair", visible: true, collapsed: false }],
      elements: [{ ...box("Box A", 0), groupId: "g" }, { ...box("Box B", 20), groupId: "g" }, box("Box C", 40)],
    });
    render(<App />);
    const target = rowBox("Pair");
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, height: 20, left: 0, width: 100, right: 100, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    fireEvent.dragStart(rowBox("Box C"), { dataTransfer: dt() });
    fireEvent.dragOver(target, { dataTransfer: dt(), clientY: 10 });
    fireEvent.drop(target, { dataTransfer: dt(), clientY: 10 });
    await waitFor(() => expect(savedEl("Box C")?.groupId).toBe("g"));

    fireEvent.click(row("Pair"));
    await userEvent.keyboard("{Control>}{Shift>}g{/Shift}{/Control}");
    await waitFor(() => expect(savedDesign()?.groups ?? []).toHaveLength(0));
    expect(savedEl("Box C")?.groupId).toBeUndefined();
  });
});

describe("shapes", () => {
  it("offers more shapes on right-click of the shape tool and draws the chosen one", async () => {
    seed();
    render(<App />);
    fireEvent.contextMenu(screen.getByRole("button", { name: "Shape tool" }));
    for (const name of ["Ellipse", "Triangle", "Polygon", "Star", "Heart", "Arrow"]) {
      expect(screen.getByRole("menuitemcheckbox", { name })).toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("menuitemcheckbox", { name: "Ellipse" }));
    expect(screen.getByRole("button", { name: "Shape tool" })).toHaveAttribute("aria-pressed", "true");

    await userEvent.keyboard("{Control>}1{/Control}");
    const viewport = document.querySelector(".canvas-viewport") as HTMLElement;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 20 * PX_PER_MM, clientY: 10 * PX_PER_MM });
    fireEvent.pointerUp(window);
    await waitFor(() => expect((savedEl("Ellipse") as ShapeElement | undefined)?.shape).toBe("ellipse"));
  });

  it("cycles shapes with Shift+U", async () => {
    render(<App />);
    const tool = () => screen.getByRole("button", { name: "Shape tool" });
    await userEvent.keyboard("{Shift>}u{/Shift}");
    expect(tool()).toHaveAttribute("title", expect.stringMatching(/^Ellipse tool/));
    await userEvent.keyboard("{Shift>}u{/Shift}");
    expect(tool()).toHaveAttribute("title", expect.stringMatching(/^Triangle tool/));
  });

  it("can have no fill while keeping its stroke", async () => {
    seed();
    render(<App />);
    fireEvent.click(row("Box A"));
    fireEvent.click(screen.getByRole("tab", { name: "Fill" }));
    fireEvent.click(screen.getByRole("switch", { name: "No fill (transparent)" }));
    await waitFor(() => expect((savedEl("Box A") as ShapeElement).fill).toBe("none"));

    const shape = printed().children[1] as HTMLElement;
    expect(shape.style.backgroundColor).toBe("transparent");
    expect(shape.style.borderStyle).toBe("solid");
    expect(shape.style.borderWidth).toBe("0.5mm");
  });
});

describe("effects in the Layers panel", () => {
  it("lists an image's effects under it, to switch off, duplicate and delete", async () => {
    seed();
    render(<App />);
    fireEvent.click(row("Photo"));
    await userEvent.click(screen.getByRole("menuitem", { name: "Image" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /^Add effect/ }));
    await userEvent.click(screen.getByRole("menuitem", { name: "Sepia" }));

    const fx = () => screen.getByRole("list", { name: "Effects on Photo" });
    expect(within(fx()).getByRole("button", { name: "Sepia" })).toBeInTheDocument();
    const frame = () => within(printed()).getByRole("img", { name: "Photo" }).parentElement as HTMLElement;
    expect(frame().style.filter).toContain("sepia(80%)");

    fireEvent.click(within(fx()).getByRole("button", { name: "Turn off Sepia" }));
    await waitFor(() => expect((savedEl("Photo") as ImageElement).effects?.[0].enabled).toBe(false));
    expect(frame().style.filter).toBe("");

    fireEvent.click(within(fx()).getByRole("button", { name: "Duplicate Sepia" }));
    await waitFor(() => expect((savedEl("Photo") as ImageElement).effects).toHaveLength(2));

    fireEvent.click(within(fx()).getAllByRole("button", { name: "Delete Sepia" })[0]);
    await waitFor(() => expect((savedEl("Photo") as ImageElement).effects).toHaveLength(1));
  });
});

describe("brush", () => {
  it("paints onto a new pixel layer when none is selected", async () => {
    seed();
    render(<App />);
    await userEvent.keyboard("b");
    const viewport = document.querySelector(".canvas-viewport") as HTMLElement;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
    await waitFor(() => expect(savedEl("Layer 1")?.type).toBe("raster"));
    expect(await screen.findByText(/Painting on a new pixel layer/)).toBeInTheDocument();
  });

  it("shows brush options and resizes with [ and ]", async () => {
    render(<App />);
    await userEvent.keyboard("b");
    const options = screen.getByRole("toolbar", { name: "Brush tool options" });
    const size = within(options).getByLabelText("Size") as HTMLInputElement;
    expect(size.value).toBe("30");
    // user-event treats "[" as syntax, so fire the keys directly.
    fireEvent.keyDown(window, { key: "]", code: "BracketRight" });
    expect(size.value).toBe("35");
    fireEvent.keyDown(window, { key: "[", code: "BracketLeft" });
    fireEvent.keyDown(window, { key: "[", code: "BracketLeft" });
    expect(size.value).toBe("25");
    // Shift+] raises hardness.
    const hardness = within(options).getByLabelText("Hardness") as HTMLInputElement;
    fireEvent.keyDown(window, { key: "}", code: "BracketRight", shiftKey: true });
    expect(hardness.value).toBe("100");
  });

  it("opens the categorised Brush settings panel", async () => {
    render(<App />);
    await userEvent.keyboard("b");
    await userEvent.click(screen.getByRole("button", { name: /Brush settings/ }));
    const panel = screen.getByRole("region", { name: "Brush settings panel" });
    for (const tab of ["Tip", "Shape dynamics", "Scattering", "Transfer", "Colour", "Other"]) {
      expect(within(panel).getByRole("tab", { name: tab })).toBeInTheDocument();
    }
    await userEvent.click(within(panel).getByRole("tab", { name: "Scattering" }));
    expect(within(panel).getByText("Scatter")).toBeInTheDocument();
  });

  it("will not erase without a pixel layer selected", async () => {
    seed();
    render(<App />);
    await userEvent.keyboard("e");
    const viewport = document.querySelector(".canvas-viewport") as HTMLElement;
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10 });
    fireEvent.pointerUp(window);
    expect(await screen.findByText(/Select a pixel layer to erase from/)).toBeInTheDocument();
    expect(savedDesign()?.elements.some((e) => e.type === "raster") ?? false).toBe(false);
  });
});
