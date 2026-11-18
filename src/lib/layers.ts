import type { LabelElement, LayerGroup } from "../types";
import { boundsOf } from "./align";
import type { Bounds } from "./align";

/**
 * Layer groups over a flat element array.
 *
 * Elements stay in one array whose order IS the stacking order (first =
 * bottom). Each element may point at a group, and groups may nest. Every
 * operation here keeps a group's members contiguous in the array, so a group
 * occupies one slot in the stack — which is what makes the Layers panel tree
 * and drag-and-drop reordering well defined.
 */

export type LayerNode =
  | { kind: "element"; element: LabelElement }
  | { kind: "group"; group: LayerGroup; children: LayerNode[] };

export interface LayerState {
  elements: LabelElement[];
  groups: LayerGroup[];
}

export type DropPosition = "above" | "below" | "inside";

const groupMap = (groups: LayerGroup[]) => new Map(groups.map((g) => [g.id, g]));

/** Group ids from the innermost (`startId`) outwards. Cycle-safe. */
export const ancestorChain = (startId: string | undefined, groups: LayerGroup[]): string[] => {
  const byId = groupMap(groups);
  const chain: string[] = [];
  let id = startId;
  while (id && byId.has(id) && !chain.includes(id)) {
    chain.push(id);
    id = byId.get(id)?.parentId;
  }
  return chain;
};

/** The groups enclosing an item (element or group), innermost first. */
export const ancestorsOfItem = (id: string, state: LayerState): string[] => {
  const el = state.elements.find((e) => e.id === id);
  if (el) return ancestorChain(el.groupId, state.groups);
  const g = state.groups.find((x) => x.id === id);
  return g ? ancestorChain(g.parentId, state.groups) : [];
};

export const isGroupId = (id: string, groups: LayerGroup[]) => groups.some((g) => g.id === id);

/** A layer shows only if it and every enclosing group are visible. */
export const isEffectivelyVisible = (el: LabelElement, groups: LayerGroup[] | undefined): boolean => {
  if (!el.visible) return false;
  if (!el.groupId || !groups?.length) return true;
  const byId = groupMap(groups);
  return ancestorChain(el.groupId, groups).every((id) => byId.get(id)?.visible !== false);
};

/** Element ids inside a group, at any depth, in stacking order. */
export const membersOf = (groupId: string, state: LayerState): string[] =>
  state.elements.filter((e) => ancestorChain(e.groupId, state.groups).includes(groupId)).map((e) => e.id);

/** Turn a selection of elements and groups into the elements it covers. */
export const expandSelection = (ids: string[], state: LayerState): string[] => {
  const set = new Set(ids);
  return state.elements
    .filter((e) => set.has(e.id) || ancestorChain(e.groupId, state.groups).some((g) => set.has(g)))
    .map((e) => e.id);
};

/** Drop items already covered by a selected ancestor group. */
export const topLevelItems = (ids: string[], state: LayerState): string[] => {
  const known = new Set([...state.elements.map((e) => e.id), ...state.groups.map((g) => g.id)]);
  const set = new Set(ids.filter((id) => known.has(id)));
  return [...set].filter((id) => !ancestorsOfItem(id, state).some((a) => set.has(a)));
};

/** The outermost group containing an element, or null. */
export const outermostGroupOf = (elementId: string, state: LayerState): string | null => {
  const el = state.elements.find((e) => e.id === elementId);
  const chain = ancestorChain(el?.groupId, state.groups);
  return chain.at(-1) ?? null;
};

/** The box an item occupies: an element's own, or the union of a group's. */
export const itemBounds = (id: string, state: LayerState): (Bounds & { id: string }) | null => {
  const el = state.elements.find((e) => e.id === id);
  if (el) return { id, x: el.x, y: el.y, width: el.width, height: el.height };
  const members = state.elements.filter((e) => membersOf(id, state).includes(e.id));
  const b = boundsOf(members);
  return b ? { id, ...b } : null;
};

/* -------------------------------------------------------------------------
 * Tree
 * ---------------------------------------------------------------------- */

/** The layer tree, bottom to top, built from the flat array. */
export const buildTree = (state: LayerState): LayerNode[] => {
  const byId = groupMap(state.groups);
  const root: LayerNode[] = [];
  const nodes = new Map<string, Extract<LayerNode, { kind: "group" }>>();
  for (const element of state.elements) {
    const chain = ancestorChain(element.groupId, state.groups).reverse(); // outer → inner
    let container = root;
    for (const gid of chain) {
      let node = nodes.get(gid);
      if (!node) {
        node = { kind: "group", group: byId.get(gid) as LayerGroup, children: [] };
        nodes.set(gid, node);
        container.push(node);
      }
      container = node.children;
    }
    container.push({ kind: "element", element });
  }
  return root;
};

const flattenTree = (nodes: LayerNode[]): LabelElement[] =>
  nodes.flatMap((n) => (n.kind === "element" ? [n.element] : flattenTree(n.children)));

const usedGroupIds = (nodes: LayerNode[], out = new Set<string>()) => {
  for (const n of nodes) {
    if (n.kind === "group") {
      out.add(n.group.id);
      usedGroupIds(n.children, out);
    }
  }
  return out;
};

/**
 * Repair anything that breaks the invariants: references to missing groups,
 * parent cycles, non-contiguous members and empty groups. Every structural
 * operation finishes with this, so the result is always well formed.
 */
export const canonicalize = (state: LayerState): LayerState => {
  const ids = new Set(state.groups.map((g) => g.id));
  // Break cycles and dangling parents.
  let groups = state.groups.map((g) => ({
    ...g,
    parentId: g.parentId && ids.has(g.parentId) && g.parentId !== g.id ? g.parentId : undefined,
  }));
  for (const g of groups) {
    const seen = new Set<string>([g.id]);
    let p = g.parentId;
    while (p) {
      if (seen.has(p)) {
        g.parentId = undefined;
        break;
      }
      seen.add(p);
      p = groups.find((x) => x.id === p)?.parentId;
    }
  }
  const elements = state.elements.map((e) => {
    if (e.groupId && !ids.has(e.groupId)) {
      const { groupId: _drop, ...rest } = e;
      void _drop;
      return rest as LabelElement;
    }
    return e;
  });
  const tree = buildTree({ elements, groups });
  const used = usedGroupIds(tree);
  groups = groups.filter((g) => used.has(g.id));
  return { elements: flattenTree(tree), groups };
};

export interface PanelRow {
  kind: "element" | "group";
  id: string;
  depth: number;
}

/** Rows as the Layers panel lists them: top of the stack first. */
export const panelRows = (state: LayerState): PanelRow[] => {
  const rows: PanelRow[] = [];
  const walk = (nodes: LayerNode[], depth: number) => {
    for (let i = nodes.length - 1; i >= 0; i -= 1) {
      const n = nodes[i];
      if (n.kind === "element") rows.push({ kind: "element", id: n.element.id, depth });
      else {
        rows.push({ kind: "group", id: n.group.id, depth });
        if (!n.group.collapsed) walk(n.children, depth + 1);
      }
    }
  };
  walk(buildTree(state), 0);
  return rows;
};

/** Shift-click: every row between the anchor and the clicked row. */
export const rowRange = (rows: PanelRow[], anchorId: string, id: string): string[] => {
  const a = rows.findIndex((r) => r.id === anchorId);
  const b = rows.findIndex((r) => r.id === id);
  if (a === -1 || b === -1) return [id];
  const [from, to] = a < b ? [a, b] : [b, a];
  return rows.slice(from, to + 1).map((r) => r.id);
};

/* -------------------------------------------------------------------------
 * Operations
 * ---------------------------------------------------------------------- */

const setParent = (state: LayerState, ids: string[], parent: string | undefined): LayerState => {
  const set = new Set(ids);
  return {
    elements: state.elements.map((e) => {
      if (!set.has(e.id)) return e;
      if (parent) return { ...e, groupId: parent };
      const { groupId: _drop, ...rest } = e;
      void _drop;
      return rest as LabelElement;
    }),
    groups: state.groups.map((g) => (set.has(g.id) ? { ...g, parentId: parent } : g)),
  };
};

const parentOfItem = (id: string, state: LayerState): string | undefined => {
  const el = state.elements.find((e) => e.id === id);
  if (el) return el.groupId;
  return state.groups.find((g) => g.id === id)?.parentId;
};

/** Index range [first, last] an item's members occupy in the array. */
const blockOf = (id: string, state: LayerState): [number, number] | null => {
  const members = new Set(expandSelection([id], state));
  let first = -1;
  let last = -1;
  state.elements.forEach((e, i) => {
    if (!members.has(e.id)) return;
    if (first === -1) first = i;
    last = i;
  });
  return first === -1 ? null : [first, last];
};

/** Wrap the selection in a new group, placed where its topmost item was. */
export const groupItems = (state: LayerState, ids: string[], group: LayerGroup): LayerState => {
  const top = topLevelItems(ids, state);
  const memberIds = new Set(expandSelection(top, state));
  if (memberIds.size === 0) return state;

  // The new group joins the parent of the topmost selected item.
  const topmost = [...top].sort((a, b) => (blockOf(b, state)?.[1] ?? 0) - (blockOf(a, state)?.[1] ?? 0))[0];
  const parent = parentOfItem(topmost, state);

  const lastIndex = Math.max(...state.elements.map((e, i) => (memberIds.has(e.id) ? i : -1)));
  const members = state.elements.filter((e) => memberIds.has(e.id));
  const rest = state.elements.filter((e) => !memberIds.has(e.id));
  const insertAt = lastIndex - (members.length - 1);
  const elements = [...rest.slice(0, insertAt), ...members, ...rest.slice(insertAt)];

  const next = setParent(
    { elements, groups: [...state.groups, { ...group, parentId: parent }] },
    top,
    group.id
  );
  return canonicalize(next);
};

/** Dissolve a group; its contents move up to the group's own parent. */
export const ungroup = (state: LayerState, groupId: string): LayerState => {
  const group = state.groups.find((g) => g.id === groupId);
  if (!group) return state;
  const childIds = [
    ...state.elements.filter((e) => e.groupId === groupId).map((e) => e.id),
    ...state.groups.filter((g) => g.parentId === groupId).map((g) => g.id),
  ];
  const next = setParent(state, childIds, group.parentId);
  return canonicalize({ ...next, groups: next.groups.filter((g) => g.id !== groupId) });
};

/**
 * Drag-and-drop: move items above/below a target row, or into a group. A
 * group never moves into itself or one of its own subgroups.
 */
export const moveItems = (
  state: LayerState,
  ids: string[],
  targetId: string,
  position: DropPosition
): LayerState => {
  const top = topLevelItems(ids, state);
  if (top.length === 0 || top.includes(targetId)) return state;
  // Dropping into (or next to) something inside a moving group is a no-op.
  const targetChain = [targetId, ...ancestorsOfItem(targetId, state)];
  if (top.some((id) => targetChain.includes(id))) return state;

  const targetIsGroup = isGroupId(targetId, state.groups);
  if (position === "inside" && !targetIsGroup) position = "above";
  const parent = position === "inside" ? targetId : parentOfItem(targetId, state);

  const block = blockOf(targetId, state);
  if (!block) return state;
  const anchor = position === "below" ? block[0] : block[1] + 1;

  const moving = new Set(expandSelection(top, state));
  const movingEls = state.elements.filter((e) => moving.has(e.id));
  const rest = state.elements.filter((e) => !moving.has(e.id));
  const insertAt = state.elements.slice(0, anchor).filter((e) => !moving.has(e.id)).length;
  const elements = [...rest.slice(0, insertAt), ...movingEls, ...rest.slice(insertAt)];

  return canonicalize(setParent({ elements, groups: state.groups }, top, parent));
};

/** Delete items; deleting a group deletes everything in it. */
export const deleteItems = (state: LayerState, ids: string[]): LayerState => {
  const gone = new Set(expandSelection(ids, state));
  const goneGroups = new Set(
    state.groups.filter((g) => [g.id, ...ancestorChain(g.parentId, state.groups)].some((x) => ids.includes(x))).map((g) => g.id)
  );
  return canonicalize({
    elements: state.elements.filter((e) => !gone.has(e.id)),
    groups: state.groups.filter((g) => !goneGroups.has(g.id)),
  });
};

/**
 * Copy items, each copy placed just above its original. Copied groups get
 * fresh ids all the way down. Returns the new top-level ids for selection.
 */
export const duplicateItems = (
  state: LayerState,
  ids: string[],
  makeId: () => string,
  offset = 2
): LayerState & { copies: string[] } => {
  const top = topLevelItems(ids, state);
  const after = new Map<number, LabelElement[]>();
  const newGroups: LayerGroup[] = [];
  const copies: string[] = [];

  const shift = (e: LabelElement, groupId: string | undefined, name?: string): LabelElement => {
    const copy = { ...e, id: makeId(), x: e.x + offset, y: e.y + offset, name: name ?? e.name } as LabelElement;
    if (groupId) copy.groupId = groupId;
    else delete copy.groupId;
    return copy;
  };

  for (const id of top) {
    const block = blockOf(id, state);
    if (!block) continue;
    const list = after.get(block[1]) ?? [];
    const el = state.elements.find((e) => e.id === id);
    if (el) {
      const copy = shift(el, el.groupId, `${el.name} copy`);
      list.push(copy);
      copies.push(copy.id);
    } else {
      // Clone the group subtree with a mapping from old to new group ids.
      const map = new Map<string, string>();
      const subtree = state.groups.filter((g) => g.id === id || ancestorChain(g.parentId, state.groups).includes(id));
      for (const g of subtree) map.set(g.id, makeId());
      for (const g of subtree) {
        newGroups.push({
          ...g,
          id: map.get(g.id) as string,
          name: g.id === id ? `${g.name} copy` : g.name,
          parentId: g.id === id ? g.parentId : map.get(g.parentId as string),
        });
      }
      for (const memberId of membersOf(id, state)) {
        const m = state.elements.find((e) => e.id === memberId) as LabelElement;
        list.push(shift(m, map.get(m.groupId as string)));
      }
      copies.push(map.get(id) as string);
    }
    after.set(block[1], list);
  }

  const elements: LabelElement[] = [];
  state.elements.forEach((e, i) => {
    elements.push(e);
    elements.push(...(after.get(i) ?? []));
  });
  return { ...canonicalize({ elements, groups: [...state.groups, ...newGroups] }), copies };
};

/** Items sharing a parent, bottom to top. */
const siblingsOf = (parent: string | undefined, state: LayerState): string[] => {
  const seen: string[] = [];
  for (const e of state.elements) {
    // Climb from the element to the child of `parent` on its path.
    const chain = [e.id, ...ancestorChain(e.groupId, state.groups)];
    const at = parent ? chain.indexOf(parent) : chain.length;
    if (at <= 0) continue;
    const child = chain[at - 1];
    if (!seen.includes(child)) seen.push(child);
  }
  return seen;
};

/** Bring to front / send to back — within each item's own group. */
export const arrangeItems = (state: LayerState, ids: string[], to: "front" | "back"): LayerState => {
  const top = topLevelItems(ids, state);
  const byParent = new Map<string | undefined, string[]>();
  for (const id of top) {
    const p = parentOfItem(id, state);
    byParent.set(p, [...(byParent.get(p) ?? []), id]);
  }
  let next = state;
  byParent.forEach((items, parent) => {
    const others = siblingsOf(parent, next).filter((s) => !items.includes(s));
    const target = to === "front" ? others.at(-1) : others[0];
    if (target) next = moveItems(next, items, target, to === "front" ? "above" : "below");
  });
  return next;
};

/** Move one item a single step up (1) or down (-1) among its siblings. */
export const stepItem = (state: LayerState, id: string, direction: 1 | -1): LayerState => {
  const siblings = siblingsOf(parentOfItem(id, state), state);
  const at = siblings.indexOf(id);
  const target = siblings[at + direction];
  if (at === -1 || !target) return state;
  return moveItems(state, [id], target, direction === 1 ? "above" : "below");
};
