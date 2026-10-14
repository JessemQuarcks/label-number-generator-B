import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AppState,
  CustomFont,
  ElementType,
  LabelDesign,
  LabelElement,
  PrintSettings,
} from "../types";
import { unregisterCustomFont } from "./fontLoader";
import { createElement, DEFAULT_PRINT, PRESETS } from "./defaults";
import {
  exportState,
  loadState,
  MAX_DESIGNS,
  MAX_FONTS,
  parseImport,
  saveState,
} from "./storage";
import { newId } from "./units";

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

/**
 * Owns all design state and persists it to localStorage, debounced so that
 * dragging an element does not write on every pointer move.
 */
export const useDesigns = () => {
  const [state, setState] = useState<AppState>(initialState);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => saveState(state), 300);
    return () => window.clearTimeout(saveTimer.current);
  }, [state]);

  const activeDesign = useMemo(
    () => state.designs.find((d) => d.id === state.activeId) ?? state.designs[0],
    [state.designs, state.activeId]
  );

  const selected = useMemo(
    () => activeDesign?.elements.find((e) => e.id === selectedId) ?? null,
    [activeDesign, selectedId]
  );

  /** Apply `updater` to the active design only. */
  const updateActive = useCallback(
    (updater: (design: LabelDesign) => LabelDesign) => {
      setState((prev) => ({
        ...prev,
        designs: prev.designs.map((d) => (d.id === prev.activeId ? updater(d) : d)),
      }));
    },
    []
  );

  const patchDesign = useCallback(
    (patch: Partial<LabelDesign>) => updateActive((d) => ({ ...d, ...patch })),
    [updateActive]
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<LabelElement>) =>
      updateActive((design) => ({
        ...design,
        elements: design.elements.map((element) =>
          element.id === id ? ({ ...element, ...patch } as LabelElement) : element
        ),
      })),
    [updateActive]
  );

  const moveElement = useCallback(
    (id: string, x: number, y: number) => patchElement(id, { x, y }),
    [patchElement]
  );

  const addElement = useCallback(
    (type: ElementType) => {
      const element = createElement(type, activeDesign);
      updateActive((design) => ({
        ...design,
        elements: [...design.elements, element],
      }));
      setSelectedId(element.id);
    },
    [activeDesign, updateActive]
  );

  const deleteElement = useCallback(
    (id: string) => {
      updateActive((design) => ({
        ...design,
        elements: design.elements.filter((e) => e.id !== id),
      }));
      setSelectedId((current) => (current === id ? null : current));
    },
    [updateActive]
  );

  const duplicateElement = useCallback(
    (id: string) => {
      const copyId = newId();
      updateActive((design) => {
        const index = design.elements.findIndex((e) => e.id === id);
        if (index === -1) return design;
        const source = design.elements[index];
        const copy: LabelElement = {
          ...source,
          id: copyId,
          name: `${source.name} copy`,
          x: source.x + 2,
          y: source.y + 2,
        };
        const elements = [...design.elements];
        elements.splice(index + 1, 0, copy);
        return { ...design, elements };
      });
      setSelectedId(copyId);
    },
    [updateActive]
  );

  /** Move an element one step through the stacking order. */
  const reorderElement = useCallback(
    (id: string, direction: -1 | 1) =>
      updateActive((design) => {
        const index = design.elements.findIndex((e) => e.id === id);
        const target = index + direction;
        if (index === -1 || target < 0 || target >= design.elements.length) return design;
        const elements = [...design.elements];
        [elements[index], elements[target]] = [elements[target], elements[index]];
        return { ...design, elements };
      }),
    [updateActive]
  );

  const toggleVisible = useCallback(
    (id: string) =>
      updateActive((design) => ({
        ...design,
        elements: design.elements.map((e) =>
          e.id === id ? { ...e, visible: !e.visible } : e
        ),
      })),
    [updateActive]
  );

  const selectDesign = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
    setSelectedId(null);
  }, []);

  const addDesign = useCallback((design: LabelDesign) => {
    setState((prev) =>
      prev.designs.length >= MAX_DESIGNS
        ? prev
        : { ...prev, designs: [...prev.designs, design], activeId: design.id }
    );
    setSelectedId(null);
  }, []);

  const duplicateDesign = useCallback(() => {
    const copy: LabelDesign = {
      ...activeDesign,
      id: newId(),
      name: `${activeDesign.name} copy`,
      elements: activeDesign.elements.map((e) => ({ ...e, id: newId() })),
    };
    addDesign(copy);
  }, [activeDesign, addDesign]);

  const deleteDesign = useCallback((id: string) => {
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
    setSelectedId(null);
  }, []);

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
      }),
    [updateActive]
  );

  const removeFont = useCallback(
    (id: string) => {
      unregisterCustomFont(id);
      updateActive((design) => ({
        ...design,
        fonts: (design.fonts ?? []).filter((f) => f.id !== id),
      }));
    },
    [updateActive]
  );

  const setPrint = useCallback(
    (patch: Partial<PrintSettings>) =>
      setState((prev) => ({ ...prev, print: { ...prev.print, ...patch } })),
    []
  );

  /** Merge imported designs alongside the existing ones, never replacing them. */
  const importJson = useCallback((text: string): number => {
    const { designs: imported, print } = parseImport(text);
    let added = 0;
    setState((prev) => {
      const room = Math.max(0, MAX_DESIGNS - prev.designs.length);
      const existingIds = new Set(prev.designs.map((d) => d.id));
      const fresh = imported.slice(0, room).map((design) =>
        existingIds.has(design.id) ? { ...design, id: newId() } : design
      );
      added = fresh.length;
      if (!fresh.length) return prev;
      return {
        ...prev,
        designs: [...prev.designs, ...fresh],
        activeId: fresh[0].id,
        print: print ?? prev.print,
      };
    });
    setSelectedId(null);
    return added;
  }, []);

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
    setSelectedId,
    patchDesign,
    patchElement,
    moveElement,
    addElement,
    deleteElement,
    duplicateElement,
    reorderElement,
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
  };
};
