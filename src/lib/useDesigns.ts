import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  CustomFont,
  ElementType,
  LabelDesign,
  LabelElement,
  LayerEffect,
  LayerGroup,
  PrintSettings,
} from "../types";
import { unregisterCustomFont } from "./fontLoader";
import { createElement, DEFAULT_PRINT, PRESETS } from "./defaults";
import {
  exportState,
  loadState,
  MAX_DESIGNS,
  MAX_ELEMENTS,
  MAX_FONTS,
  parseImport,
  saveState,
} from "./storage";
import { newId } from "./units";
import type { DropPosition, LayerState } from "./layers";
import {
  arrangeItems,
  deleteItems,
  duplicateItems,
  expandSelection,
  groupItems,
  isGroupId,
  moveItems,
  stepItem,
  ungroup,
} from "./layers";

const initialState = (): AppState => {
  const restored = loadState();
  if (restored) return restored;
  const first = PRESETS[0].create();
  return {
    version: 1,
    designs: [first],
    activeId: first.id,
    print: { ...DEFAULT_PRINT },
  };
};

/** What undo restores. Print settings are a run parameter, not the design. */
interface Snapshot {
  designs: LabelDesign[];
  activeId: string | null;
}

const HISTORY_LIMIT = 100;
/**
 * Edits with the same key arriving closer together than this collapse into
 * one undo step, so a drag or a burst of typing undoes in one go.
 */
const COALESCE_MS = 700;

export type SelectMode = "replace" | "toggle" | "add";
export type ArrangeTo = "front" | "back";

/**
 * Owns all design state and persists it to localStorage, debounced so that
 * dragging an element does not write on every pointer move.
 */
export const useDesigns = () => {
  const [state, setState] = useState<AppState>(initialState);
  /** Ordered: the last id is the primary selection the properties show. */
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const saveTimer = useRef<number | undefined>(undefined);

  // ---- history -----------------------------------------------------------
  const stateRef = useRef(state);
  stateRef.current = state;
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const lastRecord = useRef<{ key: string; at: number } | null>(null);
  const [historyTick, setHistoryTick] = useState(0);

  /**
   * Remember the current designs before a change. Called outside the state
   * updater so React's double-invoked updaters never record twice.
   */
  const record = useCallback((key: string) => {
    const now = Date.now();
    const last = lastRecord.current;
    lastRecord.current = { key, at: now };
    if (last && last.key === key && now - last.at < COALESCE_MS) return;
    const { designs, activeId } = stateRef.current;
    past.current = [...past.current.slice(-(HISTORY_LIMIT - 1)), { designs, activeId }];
    future.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const restore = useCallback((from: React.MutableRefObject<Snapshot[]>, to: React.MutableRefObject<Snapshot[]>) => {
    const snapshot = from.current.at(-1);
    if (!snapshot) return;
    from.current = from.current.slice(0, -1);
    const { designs, activeId } = stateRef.current;
    to.current = [...to.current, { designs, activeId }];
    lastRecord.current = null;
    setState((prev) => ({ ...prev, designs: snapshot.designs, activeId: snapshot.activeId }));
    const active = snapshot.designs.find((d) => d.id === snapshot.activeId);
    setSelectedIds((ids) => ids.filter((id) => active?.elements.some((e) => e.id === id)));
    setHistoryTick((t) => t + 1);
  }, []);

  const undo = useCallback(() => restore(past, future), [restore]);
  const redo = useCallback(() => restore(future, past), [restore]);
  const canUndo = historyTick >= 0 && past.current.length > 0;
  const canRedo = historyTick >= 0 && future.current.length > 0;

  /** The last save was refused by the browser (storage full). */
  const [saveFailed, setSaveFailed] = useState(false);
  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => setSaveFailed(!saveState(state)), 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [state]);

  const activeDesign = useMemo(
    () => state.designs.find((d) => d.id === state.activeId) ?? state.designs[0],
    [state.designs, state.activeId]
  );

  const groups = useMemo(() => activeDesign?.groups ?? [], [activeDesign]);
  const layerState = useMemo<LayerState>(
    () => ({ elements: activeDesign?.elements ?? [], groups }),
    [activeDesign, groups]
  );

  // Drop selections that no longer exist (deleted, or a different design).
  // A selection holds element ids and group ids.
  const liveSelectedIds = useMemo(
    () =>
      selectedIds.filter(
        (id) => activeDesign?.elements.some((e) => e.id === id) || groups.some((g) => g.id === id)
      ),
    [selectedIds, activeDesign, groups]
  );
  const primaryId = liveSelectedIds.at(-1) ?? null;
  const selectedId = primaryId && !isGroupId(primaryId, groups) ? primaryId : null;

  const selected = useMemo(
    () => activeDesign?.elements.find((e) => e.id === selectedId) ?? null,
    [activeDesign, selectedId]
  );

  const selectedGroup = useMemo(
    () => (primaryId ? groups.find((g) => g.id === primaryId) ?? null : null),
    [groups, primaryId]
  );

  /** Every element the selection covers — a selected group counts as its members. */
  const selectedElements = useMemo(() => {
    const ids = new Set(expandSelection(liveSelectedIds, layerState));
    return activeDesign?.elements.filter((e) => ids.has(e.id)) ?? [];
  }, [activeDesign, liveSelectedIds, layerState]);

  const setSelectedId = useCallback(
    (id: string | null) => setSelectedIds(id ? [id] : []),
    []
  );

  const selectElement = useCallback((id: string, mode: SelectMode = "replace") => {
    setSelectedIds((ids) => {
      if (mode === "replace") return [id];
      if (ids.includes(id)) {
        // Re-clicking with a modifier makes a layer primary (add) or drops it (toggle).
        const without = ids.filter((x) => x !== id);
        return mode === "toggle" ? without : [...without, id];
      }
      return [...ids, id];
    });
  }, []);

  const setSelection = useCallback((ids: string[]) => setSelectedIds(ids), []);

  const selectAll = useCallback(
    () => setSelectedIds(activeDesign?.elements.map((e) => e.id) ?? []),
    [activeDesign]
  );

  /** Apply `updater` to the active design only. */
  const updateActive = useCallback(
    (updater: (design: LabelDesign) => LabelDesign, key: string) => {
      record(key);
      setState((prev) => ({
        ...prev,
        designs: prev.designs.map((d) => (d.id === prev.activeId ? updater(d) : d)),
      }));
    },
    [record]
  );

  const patchDesign = useCallback(
    (patch: Partial<LabelDesign>) =>
      updateActive((d) => ({ ...d, ...patch }), `design:${Object.keys(patch).sort().join()}`),
    [updateActive]
  );

  /** Apply a structural layer operation (groups and order) to the active design. */
  const updateLayers = useCallback(
    (op: (layers: LayerState) => LayerState, key: string) =>
      updateActive((design) => {
        const next = op({ elements: design.elements, groups: design.groups ?? [] });
        const { groups: _old, ...rest } = design;
        void _old;
        return { ...rest, elements: next.elements, ...(next.groups.length ? { groups: next.groups } : {}) };
      }, key),
    [updateActive]
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<LabelElement>) =>
      updateActive(
        (design) => ({
          ...design,
          elements: design.elements.map((element) =>
            element.id === id ? ({ ...element, ...patch } as LabelElement) : element
          ),
        }),
        `patch:${id}:${Object.keys(patch).sort().join()}`
      ),
    [updateActive]
  );

  /**
   * Patch several layers as one undo step. `key` groups a stream of calls —
   * every pointer move of one drag, say — into that single step.
   */
  const patchElements = useCallback(
    (patches: Record<string, Partial<LabelElement>>, key = "patch-many") =>
      updateActive(
        (design) => ({
          ...design,
          elements: design.elements.map((element) =>
            patches[element.id]
              ? ({ ...element, ...patches[element.id] } as LabelElement)
              : element
          ),
        }),
        `${key}:${Object.keys(patches).sort().join()}`
      ),
    [updateActive]
  );

  const moveElement = useCallback(
    (id: string, x: number, y: number) => patchElements({ [id]: { x, y } }, "move"),
    [patchElements]
  );

  /**
   * Add a layer. `overrides` place it (a drawn box) or style it (tool
   * defaults). Like Photoshop, it lands just above the selected layer — inside
   * the selected group, if a group is selected.
   */
  const addElement = useCallback(
    (type: ElementType, overrides: Partial<LabelElement> = {}): string | null => {
      if ((activeDesign?.elements.length ?? 0) >= MAX_ELEMENTS) return null;
      const element = { ...createElement(type, activeDesign), ...overrides } as LabelElement;
      element.id = newId();
      delete element.groupId;
      const anchor = primaryId;
      updateLayers((layers) => {
        const appended = { ...layers, elements: [...layers.elements, element] };
        if (!anchor) return appended;
        const into = isGroupId(anchor, layers.groups);
        return moveItems(appended, [element.id], anchor, into ? "inside" : "above");
      }, `add:${element.id}`);
      setSelectedIds([element.id]);
      return element.id;
    },
    [activeDesign, updateLayers, primaryId]
  );

  /** Delete layers and groups (a group goes with everything in it). */
  const deleteElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      updateLayers((layers) => deleteItems(layers, ids), `delete:${ids.join()}:${Date.now()}`);
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
    },
    [updateLayers]
  );

  const deleteElement = useCallback((id: string) => deleteElements([id]), [deleteElements]);

  /** Duplicate layers and groups; the copies become the selection. */
  const duplicateElements = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return;
      const room = MAX_ELEMENTS - (activeDesign?.elements.length ?? 0);
      if (expandSelection(ids, layerState).length > room) return;
      // Ids are generated outside the updater so a double-invoked updater
      // still produces the same copies.
      const pool: string[] = Array.from({ length: 200 }, () => newId());
      let used = 0;
      const makeId = () => pool[used++] ?? newId();
      const preview = duplicateItems(layerState, ids, makeId);
      updateLayers(() => ({ elements: preview.elements, groups: preview.groups }), `duplicate:${Date.now()}`);
      setSelectedIds(preview.copies);
    },
    [updateLayers, activeDesign, layerState]
  );

  const duplicateElement = useCallback(
    (id: string) => duplicateElements([id]),
    [duplicateElements]
  );

  /** Put the selection in a new group (Ctrl+G). Returns the group id. */
  const groupSelection = useCallback(
    (ids: string[]): string | null => {
      if (ids.length === 0) return null;
      const n = (groups.length || 0) + 1;
      const group: LayerGroup = { id: newId(), name: `Group ${n}`, visible: true, collapsed: false };
      updateLayers((layers) => groupItems(layers, ids, group), `group:${group.id}`);
      setSelectedIds([group.id]);
      return group.id;
    },
    [updateLayers, groups.length]
  );

  /** Dissolve groups (Ctrl+Shift+G); their contents stay selected. */
  const ungroupSelection = useCallback(
    (ids: string[]) => {
      const targets = ids.filter((id) => isGroupId(id, groups));
      if (targets.length === 0) return;
      const children = layerState.elements
        .filter((e) => e.groupId && targets.includes(e.groupId))
        .map((e) => e.id)
        .concat(groups.filter((g) => g.parentId && targets.includes(g.parentId)).map((g) => g.id));
      updateLayers(
        (layers) => targets.reduce((acc, id) => ungroup(acc, id), layers),
        `ungroup:${targets.join()}`
      );
      setSelectedIds(children);
    },
    [updateLayers, groups, layerState]
  );

  const patchGroup = useCallback(
    (id: string, patch: Partial<LayerGroup>) =>
      updateActive(
        (design) => ({
          ...design,
          groups: (design.groups ?? []).map((g) => (g.id === id ? { ...g, ...patch } : g)),
        }),
        `group-patch:${id}:${Object.keys(patch).sort().join()}`
      ),
    [updateActive]
  );

  /** Drag-and-drop in the Layers panel. */
  const moveLayers = useCallback(
    (ids: string[], targetId: string, position: DropPosition) =>
      updateLayers((layers) => moveItems(layers, ids, targetId, position), `drop:${Date.now()}`),
    [updateLayers]
  );

  /** Edit one layer's effect stack. */
  const updateEffects = useCallback(
    (id: string, fn: (effects: LayerEffect[]) => LayerEffect[]) =>
      updateActive(
        (design) => ({
          ...design,
          elements: design.elements.map((e) => {
            if (e.id !== id || (e.type !== "image" && e.type !== "raster")) return e;
            const effects = fn(e.effects ?? []);
            const { effects: _old, ...rest } = e;
            void _old;
            return (effects.length ? { ...rest, effects } : rest) as LabelElement;
          }),
        }),
        `effects:${id}`
      ),
    [updateActive]
  );

  /** Move a layer or group one step through the stacking order, within its group. */
  const reorderElement = useCallback(
    (id: string, direction: -1 | 1) =>
      updateLayers((layers) => stepItem(layers, id, direction), `reorder:${id}:${Date.now()}`),
    [updateLayers]
  );

  /** Bring to front / send to back, within each item's own group. */
  const arrangeElements = useCallback(
    (ids: string[], to: ArrangeTo) =>
      updateLayers((layers) => arrangeItems(layers, ids, to), `arrange:${Date.now()}`),
    [updateLayers]
  );

  /** Show or hide a layer or a whole group. */
  const toggleVisible = useCallback(
    (id: string) =>
      updateActive(
        (design) => ({
          ...design,
          elements: design.elements.map((e) => (e.id === id ? { ...e, visible: !e.visible } : e)),
          ...(design.groups
            ? { groups: design.groups.map((g) => (g.id === id ? { ...g, visible: !g.visible } : g)) }
            : {}),
        }),
        `visible:${id}:${Date.now()}`
      ),
    [updateActive]
  );

  const selectDesign = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
    setSelectedIds([]);
  }, []);

  const addDesign = useCallback(
    (design: LabelDesign) => {
      record(`add-design:${design.id}`);
      setState((prev) =>
        prev.designs.length >= MAX_DESIGNS
          ? prev
          : { ...prev, designs: [...prev.designs, design], activeId: design.id }
      );
      setSelectedIds([]);
    },
    [record]
  );

  const duplicateDesign = useCallback(() => {
    const copy: LabelDesign = {
      ...activeDesign,
      id: newId(),
      name: `${activeDesign.name} copy`,
      // Element ids change; group ids can stay, they are scoped to the design.
      elements: activeDesign.elements.map((e) => ({ ...e, id: newId() })),
    };
    addDesign(copy);
  }, [activeDesign, addDesign]);

  const deleteDesign = useCallback(
    (id: string) => {
      record(`delete-design:${id}:${Date.now()}`);
      setState((prev) => {
        // Never leave the app with nothing to edit.
        if (prev.designs.length <= 1) return prev;
        const designs = prev.designs.filter((d) => d.id !== id);
        return {
          ...prev,
          designs,
          activeId: prev.activeId === id ? designs[0].id : prev.activeId,
        };
      });
      setSelectedIds([]);
    },
    [record]
  );

  const addFont = useCallback(
    (font: CustomFont) =>
      updateActive((design) => {
        const fonts = design.fonts ?? [];
        if (fonts.length >= MAX_FONTS) return design;
        // Re-uploading the same family and weight replaces it rather than
        // stacking a second face the browser would have to choose between.
        const without = fonts.filter(
          (f) => !(f.family === font.family && f.weight === font.weight && f.style === font.style)
        );
        return { ...design, fonts: [...without, font] };
      }, `font:${font.id}`),
    [updateActive]
  );

  const removeFont = useCallback(
    (id: string) => {
      unregisterCustomFont(id);
      updateActive(
        (design) => ({
          ...design,
          fonts: (design.fonts ?? []).filter((f) => f.id !== id),
        }),
        `remove-font:${id}`
      );
    },
    [updateActive]
  );

  const setPrint = useCallback(
    (patch: Partial<PrintSettings>) =>
      setState((prev) => ({ ...prev, print: { ...prev.print, ...patch } })),
    []
  );

  /** Merge imported designs alongside the existing ones, never replacing them. */
  const importJson = useCallback(
    (text: string): number => {
      const { designs: imported, print } = parseImport(text);
      const room = Math.max(0, MAX_DESIGNS - stateRef.current.designs.length);
      const existingIds = new Set(stateRef.current.designs.map((d) => d.id));
      const fresh = imported
        .slice(0, room)
        .map((design) => (existingIds.has(design.id) ? { ...design, id: newId() } : design));
      if (!fresh.length) return 0;
      record(`import:${Date.now()}`);
      setState((prev) => ({
        ...prev,
        designs: [...prev.designs, ...fresh],
        activeId: fresh[0].id,
        print: print ?? prev.print,
      }));
      setSelectedIds([]);
      return fresh.length;
    },
    [record]
  );

  const exportJson = useCallback(
    (scope: "active" | "all" = "all") =>
      exportState(scope === "all" ? state.designs : [activeDesign], state.print),
    [state.designs, state.print, activeDesign]
  );

  return {
    state,
    activeDesign,
    selected,
    selectedId,
    selectedIds: liveSelectedIds,
    selectedElements,
    selectedGroup,
    groups,
    layerState,
    groupSelection,
    ungroupSelection,
    patchGroup,
    moveLayers,
    updateEffects,
    setSelectedId,
    selectElement,
    setSelection,
    selectAll,
    patchDesign,
    patchElement,
    patchElements,
    moveElement,
    addElement,
    deleteElement,
    deleteElements,
    duplicateElement,
    duplicateElements,
    reorderElement,
    arrangeElements,
    toggleVisible,
    selectDesign,
    addDesign,
    duplicateDesign,
    deleteDesign,
    setPrint,
    addFont,
    removeFont,
    importJson,
    exportJson,
    undo,
    redo,
    canUndo,
    canRedo,
    saveFailed,
  };
};
