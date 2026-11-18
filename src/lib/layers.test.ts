import { describe, expect, it } from "vitest";
import type { LabelElement, LayerGroup } from "../types";
import {
  buildTree,
  canonicalize,
  deleteItems,
  duplicateItems,
  expandSelection,
  groupItems,
  isEffectivelyVisible,
  itemBounds,
  moveItems,
  panelRows,
  rowRange,
  topLevelItems,
  ungroup,
} from "./layers";
import type { LayerState } from "./layers";

const el = (id: string, groupId?: string, x = 0): LabelElement => ({
  id,
  type: "shape",
  name: id.toUpperCase(),
  x,
  y: 0,
  width: 10,
  height: 10,
  rotation: 0,
  visible: true,
  fill: "#000000",
  border: { style: "none", width: 0, color: "#000000", radius: 0 },
  ...(groupId ? { groupId } : {}),
});

const group = (id: string, parentId?: string): LayerGroup => ({
  id,
  name: id.toUpperCase(),
  visible: true,
  collapsed: false,
  ...(parentId ? { parentId } : {}),
});

const order = (s: LayerState) => s.elements.map((e) => e.id).join(",");
const parentOf = (s: LayerState, id: string) => s.elements.find((e) => e.id === id)?.groupId;

/** a, b, c, d bottom→top; b and c in group G. */
const base = (): LayerState => ({
  elements: [el("a"), el("b", "g"), el("c", "g"), el("d")],
  groups: [group("g")],
});

let n = 0;
const makeId = () => `n${++n}`;

describe("tree and rows", () => {
  it("builds a tree from the flat array", () => {
    const tree = buildTree(base());
    expect(tree.map((t) => (t.kind === "group" ? `[${t.children.length}]` : t.element.id))).toEqual(["a", "[2]", "d"]);
  });

  it("lists rows top first, with depth, hiding collapsed children", () => {
    expect(panelRows(base()).map((r) => `${r.id}:${r.depth}`)).toEqual(["d:0", "g:0", "c:1", "b:1", "a:0"]);
    const collapsed = { ...base(), groups: [{ ...group("g"), collapsed: true }] };
    expect(panelRows(collapsed).map((r) => r.id)).toEqual(["d", "g", "a"]);
  });

  it("selects a range of rows between two clicks", () => {
    const rows = panelRows(base());
    expect(rowRange(rows, "d", "b")).toEqual(["d", "g", "c", "b"]);
    expect(rowRange(rows, "a", "c")).toEqual(["c", "b", "a"]);
  });
});

describe("selection helpers", () => {
  it("expands a group into its members", () => {
    expect(expandSelection(["g", "d"], base())).toEqual(["b", "c", "d"]);
  });

  it("ignores items already covered by a selected group", () => {
    expect(topLevelItems(["g", "b", "d"], base()).sort()).toEqual(["d", "g"]);
  });

  it("measures a group by its members", () => {
    const s: LayerState = { elements: [el("a", "g", 0), el("b", "g", 30)], groups: [group("g")] };
    expect(itemBounds("g", s)).toEqual({ id: "g", x: 0, y: 0, width: 40, height: 10 });
  });

  it("hides a layer when its group is hidden", () => {
    const groups = [{ ...group("g"), visible: false }];
    expect(isEffectivelyVisible(el("b", "g"), groups)).toBe(false);
    expect(isEffectivelyVisible(el("a"), groups)).toBe(true);
  });
});

describe("grouping", () => {
  it("groups layers into a contiguous block where the topmost one was", () => {
    const s: LayerState = { elements: [el("a"), el("b"), el("c"), el("d")], groups: [] };
    const out = groupItems(s, ["a", "c"], group("h"));
    expect(order(out)).toBe("b,a,c,d");
    expect(parentOf(out, "a")).toBe("h");
    expect(parentOf(out, "c")).toBe("h");
    expect(parentOf(out, "b")).toBeUndefined();
  });

  it("nests a group inside a new group", () => {
    const out = groupItems(base(), ["g", "d"], group("h"));
    expect(out.groups.find((g) => g.id === "g")?.parentId).toBe("h");
    expect(parentOf(out, "d")).toBe("h");
    expect(parentOf(out, "b")).toBe("g");
  });

  it("ungroups back to the parent and removes the group", () => {
    const out = ungroup(base(), "g");
    expect(out.groups).toHaveLength(0);
    expect(parentOf(out, "b")).toBeUndefined();
    expect(order(out)).toBe("a,b,c,d");
  });
});

describe("drag and drop", () => {
  it("moves a layer above another", () => {
    expect(order(moveItems(base(), ["a"], "d", "above"))).toBe("b,c,d,a");
  });

  it("moves a layer into a group, at the top of it", () => {
    const out = moveItems(base(), ["d"], "g", "inside");
    expect(order(out)).toBe("a,b,c,d");
    expect(parentOf(out, "d")).toBe("g");
  });

  it("dropping next to a grouped layer joins its group", () => {
    const out = moveItems(base(), ["a"], "b", "above");
    expect(order(out)).toBe("b,a,c,d");
    expect(parentOf(out, "a")).toBe("g");
  });

  it("moves a layer out of a group", () => {
    const out = moveItems(base(), ["c"], "d", "above");
    expect(order(out)).toBe("a,b,d,c");
    expect(parentOf(out, "c")).toBeUndefined();
  });

  it("moves a whole group, keeping it together", () => {
    const out = moveItems(base(), ["g"], "a", "below");
    expect(order(out)).toBe("b,c,a,d");
    expect(parentOf(out, "b")).toBe("g");
  });

  it("refuses to drop a group into itself", () => {
    expect(moveItems(base(), ["g"], "b", "above")).toEqual(base());
    expect(moveItems(base(), ["g"], "g", "inside")).toEqual(base());
  });

  it("drops an emptied group", () => {
    const out = moveItems(base(), ["b", "c"], "d", "above");
    expect(out.groups).toHaveLength(0);
  });
});

describe("delete and duplicate", () => {
  it("deletes a group with its contents", () => {
    const out = deleteItems(base(), ["g"]);
    expect(order(out)).toBe("a,d");
    expect(out.groups).toHaveLength(0);
  });

  it("duplicates a group with fresh ids, just above the original", () => {
    const out = duplicateItems(base(), ["g"], makeId);
    expect(out.elements).toHaveLength(6);
    expect(out.groups).toHaveLength(2);
    const copyGroup = out.groups.find((g) => g.id === out.copies[0]);
    expect(copyGroup?.name).toBe("G copy");
    // a, b, c, (copies of b, c), d
    expect(out.elements[5].id).toBe("d");
    expect(out.elements[3].groupId).toBe(copyGroup?.id);
  });
});

describe("repair", () => {
  it("makes scattered members contiguous and drops dangling references", () => {
    const out = canonicalize({
      elements: [el("a", "g"), el("b"), el("c", "g"), el("d", "missing")],
      groups: [group("g"), group("empty")],
    });
    expect(order(out)).toBe("a,c,b,d");
    expect(out.elements[3].groupId).toBeUndefined();
    expect(out.groups.map((g) => g.id)).toEqual(["g"]);
  });

  it("breaks a parent cycle", () => {
    const out = canonicalize({ elements: [el("a", "g")], groups: [group("g", "h"), group("h", "g")] });
    expect(panelRows(out).length).toBeGreaterThan(0);
  });
});
