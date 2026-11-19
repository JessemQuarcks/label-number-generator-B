import { useMemo, useRef, useState } from "react";
import type { ElementType, LabelElement, LayerEffect, LayerGroup } from "../types";
import type { DropPosition, PanelRow } from "../lib/layers";
import { isEffectivelyVisible, panelRows, rowRange } from "../lib/layers";
import { effectDef } from "../lib/effects";
import { isCropped } from "../lib/imageEdit";
import { SHAPE_ICONS } from "../lib/shapes";
import { Icon } from "./icons";
import type { IconName } from "./icons";

const TYPE_ICON: Record<ElementType, IconName> = {
  text: "text",
  number: "number",
  image: "image",
  shape: "shape",
  raster: "pixels",
};

/** Kind filters. Icons only — the name shows on hover. */
const FILTERS: { type: ElementType; label: string; icon: IconName }[] = [
  { type: "text", label: "Text layers", icon: "text" },
  { type: "number", label: "Serial numbers", icon: "number" },
  { type: "shape", label: "Shapes", icon: "shape" },
  { type: "image", label: "Images", icon: "image" },
  { type: "raster", label: "Pixel (brush) layers", icon: "pixels" },
];

const iconFor = (el: LabelElement): IconName =>
  el.type === "shape" ? SHAPE_ICONS[el.shape ?? "rectangle"] : TYPE_ICON[el.type];

const effectsOf = (el: LabelElement): LayerEffect[] | null =>
  el.type === "image" || el.type === "raster" ? el.effects ?? [] : null;

export interface LayerListProps {
  elements: LabelElement[];
  groups: LayerGroup[];
  selectedIds: string[];
  onSelectIds: (ids: string[]) => void;
  onToggleVisible: (id: string) => void;
  onToggleCollapse: (groupId: string) => void;
  onRename: (id: string, name: string) => void;
  onMove: (ids: string[], targetId: string, position: DropPosition) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
  onGroup: () => void;
  onNewPixelLayer: () => void;
  onDelete: () => void;
  onEffectToggle: (elementId: string, effectId: string | null) => void;
  onEffectDuplicate: (elementId: string, effectId: string) => void;
  onEffectDelete: (elementId: string, effectId: string) => void;
  onEffectOpen: (elementId: string) => void;
  onEffectContextMenu: (event: React.MouseEvent, elementId: string, effectId: string) => void;
  /** The layer whose mask (rather than pixels) the brush paints on. */
  maskTarget: string | null;
  /** Click a mask thumbnail: target it. Shift toggles it, Ctrl/⌘ loads it as a selection. */
  onMaskClick: (elementId: string, event: React.MouseEvent) => void;
  onMaskContextMenu: (event: React.MouseEvent, elementId: string) => void;
  /** Add a mask to the selected layer (from the selection, if there is one). */
  onAddMask: () => void;
}

/** Which part of a row the pointer is over while dragging. */
const zoneFor = (event: React.DragEvent, isGroup: boolean): DropPosition => {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const t = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0;
  if (isGroup) return t < 0.3 ? "above" : t > 0.7 ? "below" : "inside";
  return t < 0.5 ? "above" : "below";
};

/** A footer or filter button: icon only, label in a hover tooltip. */
const IconTip = ({
  label,
  icon,
  onClick,
  pressed,
  disabled,
  danger,
}: {
  label: string;
  icon: IconName;
  onClick: () => void;
  pressed?: boolean;
  disabled?: boolean;
  danger?: boolean;
}) => (
  <button
    type="button"
    aria-label={label}
    aria-pressed={pressed}
    data-tip={label}
    disabled={disabled}
    onClick={onClick}
    className={`tip flex h-6 w-6 items-center justify-center rounded-[5px] transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
      pressed
        ? "bg-[var(--accent-soft)] text-[var(--accent)]"
        : danger
          ? "text-[var(--text-dim)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
          : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
    }`}
  >
    <Icon name={icon} size={13} />
  </button>
);

const LayerList = ({
  elements,
  groups,
  selectedIds,
  onSelectIds,
  onToggleVisible,
  onToggleCollapse,
  onRename,
  onMove,
  onContextMenu,
  onGroup,
  onNewPixelLayer,
  onDelete,
  onEffectToggle,
  onEffectDuplicate,
  onEffectDelete,
  onEffectOpen,
  onEffectContextMenu,
  maskTarget,
  onMaskClick,
  onMaskContextMenu,
  onAddMask,
}: LayerListProps) => {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [filters, setFilters] = useState<ElementType[]>([]);
  const [foldedEffects, setFoldedEffects] = useState<string[]>([]);
  const [drop, setDrop] = useState<{ id: string; position: DropPosition } | null>(null);
  const dragging = useRef<string[] | null>(null);
  const anchor = useRef<string | null>(null);

  const filtering = filters.length > 0;
  const rows: PanelRow[] = useMemo(() => {
    if (!filtering) return panelRows({ elements, groups });
    // A filtered view is flat: only matching layers, top of the stack first.
    return [...elements]
      .reverse()
      .filter((e) => filters.includes(e.type))
      .map((e) => ({ kind: "element" as const, id: e.id, depth: 0 }));
  }, [elements, groups, filters, filtering]);

  const byId = useMemo(() => new Map(elements.map((e) => [e.id, e])), [elements]);
  const groupById = useMemo(() => new Map(groups.map((g) => [g.id, g])), [groups]);

  /** Click: select. Shift: select the range from the last click. Ctrl/⌘: toggle. */
  const select = (id: string, e: React.MouseEvent) => {
    if (e.shiftKey && (anchor.current || selectedIds.length)) {
      const from = anchor.current ?? selectedIds.at(-1) ?? id;
      const range = rowRange(rows, from, id).filter((x) => x !== id);
      onSelectIds([...range, id]);
      return;
    }
    anchor.current = id;
    if (e.ctrlKey || e.metaKey) {
      onSelectIds(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
      return;
    }
    onSelectIds([id]);
  };

  const dragProps = (id: string, isGroup: boolean) =>
    filtering
      ? {}
      : {
          draggable: renaming !== id,
          onDragStart: (e: React.DragEvent) => {
            // Dragging a selected row carries the whole selection along.
            dragging.current = selectedIds.includes(id) ? selectedIds : [id];
            if (!selectedIds.includes(id)) onSelectIds([id]);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("application/x-label-layers", dragging.current.join(","));
          },
          onDragOver: (e: React.DragEvent) => {
            if (!dragging.current) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            const position = zoneFor(e, isGroup);
            if (drop?.id !== id || drop.position !== position) setDrop({ id, position });
          },
          onDragLeave: (e: React.DragEvent) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setDrop((d) => (d?.id === id ? null : d));
            }
          },
          onDrop: (e: React.DragEvent) => {
            e.preventDefault();
            const ids = dragging.current;
            const position = zoneFor(e, isGroup);
            dragging.current = null;
            setDrop(null);
            if (ids) onMove(ids, id, position);
          },
          onDragEnd: () => {
            dragging.current = null;
            setDrop(null);
          },
        };

  const nameEditor = (id: string, name: string) => (
    <input
      autoFocus
      aria-label={`Rename ${name}`}
      defaultValue={name}
      className="min-w-0 flex-1 rounded-[4px] border border-[var(--accent)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)] outline-none"
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        const next = e.target.value.trim();
        if (next) onRename(id, next.slice(0, 120));
        setRenaming(null);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setRenaming(null);
      }}
    />
  );

  const rowClass = (id: string) => {
    const isSelected = selectedIds.includes(id);
    const isPrimary = selectedIds.at(-1) === id;
    const target = drop?.id === id ? drop.position : null;
    return `layer-row group relative flex items-center gap-1 rounded-[5px] pr-1 transition-colors ${
      isSelected
        ? `bg-[var(--accent-soft)] text-[var(--text)] ${isPrimary ? "ring-1 ring-[var(--accent)]" : ""}`
        : "text-[var(--text-dim)] hover:bg-[var(--surface-3)]"
    } ${target === "inside" ? "outline outline-1 outline-[var(--accent)]" : ""} ${
      target === "above" ? "drop-above" : target === "below" ? "drop-below" : ""
    }`;
  };

  const eye = (id: string, name: string, visible: boolean, dim: boolean) => (
    <button
      type="button"
      title={visible ? `Hide ${name}` : `Show ${name}`}
      aria-label={visible ? `Hide ${name}` : `Show ${name}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggleVisible(id);
      }}
      className={`flex h-7 w-6 shrink-0 items-center justify-center rounded-[5px] text-[var(--text-faint)] transition-colors hover:text-[var(--text)] ${
        dim ? "opacity-40" : ""
      }`}
    >
      <Icon name={visible ? "eye" : "eyeOff"} size={13} />
    </button>
  );

  const renderEffects = (el: LabelElement, depth: number) => {
    const effects = effectsOf(el);
    if (!effects?.length || foldedEffects.includes(el.id)) return null;
    const allOn = effects.some((x) => x.enabled);
    const indent = { paddingLeft: 8 + (depth + 1) * 14 };
    return (
      <ul aria-label={`Effects on ${el.name}`} className="flex flex-col gap-px">
        <li>
          <div className="flex items-center gap-1 rounded-[5px] pr-1 text-[var(--text-faint)] hover:bg-[var(--surface-3)]" style={indent}>
            <button
              type="button"
              aria-label={allOn ? `Turn off all effects on ${el.name}` : `Turn on effects on ${el.name}`}
              title={allOn ? "Turn all effects off" : "Turn all effects on"}
              onClick={() => onEffectToggle(el.id, null)}
              className="flex h-6 w-6 items-center justify-center rounded-[5px] hover:text-[var(--text)]"
            >
              <Icon name={allOn ? "eye" : "eyeOff"} size={12} />
            </button>
            <button
              type="button"
              onClick={() => onEffectOpen(el.id)}
              className="flex flex-1 items-center gap-1.5 py-1 text-left text-[11px] italic"
            >
              <Icon name="fx" size={12} /> Effects
            </button>
          </div>
        </li>
        {[...effects].reverse().map((fx) => {
          const label = effectDef(fx.kind).label;
          return (
            <li key={fx.id}>
              <div
                className="group flex items-center gap-1 rounded-[5px] pr-1 text-[var(--text-dim)] hover:bg-[var(--surface-3)]"
                style={{ paddingLeft: 8 + (depth + 2) * 14 }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onEffectContextMenu(e, el.id, fx.id);
                }}
              >
                <button
                  type="button"
                  aria-label={fx.enabled ? `Turn off ${label}` : `Turn on ${label}`}
                  aria-pressed={fx.enabled}
                  title={fx.enabled ? "Turn effect off" : "Turn effect on"}
                  onClick={() => onEffectToggle(el.id, fx.id)}
                  className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] hover:text-[var(--text)]"
                >
                  <Icon name={fx.enabled ? "eye" : "eyeOff"} size={12} />
                </button>
                <button
                  type="button"
                  onDoubleClick={() => onEffectOpen(el.id)}
                  onClick={() => onEffectOpen(el.id)}
                  className={`min-w-0 flex-1 truncate py-1 text-left text-[11px] ${fx.enabled ? "" : "line-through opacity-50"}`}
                >
                  {label}
                </button>
                <span className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                  <button
                    type="button"
                    aria-label={`Duplicate ${label}`}
                    title="Duplicate effect"
                    onClick={() => onEffectDuplicate(el.id, fx.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                  >
                    <Icon name="copy" size={11} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${label}`}
                    title="Delete effect"
                    onClick={() => onEffectDelete(el.id, fx.id)}
                    className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
                  >
                    <Icon name="trash" size={11} />
                  </button>
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <div className="flex flex-col">
      <div
        role="group"
        aria-label="Filter layers by kind"
        className="flex items-center gap-0.5 border-b border-[var(--border)] px-1.5 py-1"
      >
        {FILTERS.map((f) => (
          <IconTip
            key={f.type}
            label={f.label}
            icon={f.icon}
            pressed={filters.includes(f.type)}
            onClick={() =>
              setFilters((cur) => (cur.includes(f.type) ? cur.filter((t) => t !== f.type) : [...cur, f.type]))
            }
          />
        ))}
        {filtering && (
          <button
            type="button"
            onClick={() => setFilters([])}
            className="ml-auto rounded-[4px] px-1.5 text-[10.5px] text-[var(--text-faint)] hover:text-[var(--accent)]"
          >
            Clear
          </button>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="m-3 rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-4 text-center text-[11px] leading-relaxed text-[var(--text-faint)]">
          {filtering
            ? "No layers of that kind."
            : "No layers yet. Pick a tool on the left or drop an image on the canvas."}
        </p>
      ) : (
        <ul className="flex flex-col gap-px p-1.5" aria-label="Layers">
          {rows.map((row) => {
            const indent = { paddingLeft: row.depth * 14 };
            if (row.kind === "group") {
              const g = groupById.get(row.id);
              if (!g) return null;
              const hiddenByParent = g.parentId ? !isGroupVisible(g.parentId, groupById) : false;
              return (
                <li key={g.id}>
                  <div
                    data-row-id={g.id}
                    className={rowClass(g.id)}
                    style={indent}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onContextMenu(e, g.id);
                    }}
                    {...dragProps(g.id, true)}
                  >
                    {eye(g.id, g.name, g.visible, hiddenByParent)}
                    <button
                      type="button"
                      aria-label={g.collapsed ? `Expand ${g.name}` : `Collapse ${g.name}`}
                      aria-expanded={!g.collapsed}
                      onClick={() => onToggleCollapse(g.id)}
                      className={`flex h-6 w-4 shrink-0 items-center justify-center text-[var(--text-faint)] transition-transform hover:text-[var(--text)] ${
                        g.collapsed ? "" : "rotate-90"
                      }`}
                    >
                      <Icon name="chevron" size={10} />
                    </button>
                    {renaming === g.id ? (
                      nameEditor(g.id, g.name)
                    ) : (
                      <button
                        type="button"
                        title="Click to select · Shift-click for a range · Ctrl-click to toggle · double-click to rename · drag to reorder"
                        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                        onClick={(e) => select(g.id, e)}
                        onDoubleClick={() => setRenaming(g.id)}
                      >
                        <span aria-hidden="true" className="shrink-0 text-[var(--text-faint)]">
                          <Icon name={g.collapsed ? "folder" : "folderOpen"} size={13} />
                        </span>
                        <span className={`min-w-0 truncate text-[11.5px] font-medium ${g.visible ? "" : "opacity-50"}`}>
                          {g.name}
                        </span>
                      </button>
                    )}
                  </div>
                </li>
              );
            }

            const el = byId.get(row.id);
            if (!el) return null;
            const shown = isEffectivelyVisible(el, groups);
            const fx = effectsOf(el);
            const folded = foldedEffects.includes(el.id);
            return (
              <li key={el.id}>
                <div
                  data-row-id={el.id}
                  className={rowClass(el.id)}
                  style={indent}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    onContextMenu(e, el.id);
                  }}
                  {...dragProps(el.id, false)}
                >
                  {eye(el.id, el.name, el.visible, el.visible && !shown)}
                  {renaming === el.id ? (
                    nameEditor(el.id, el.name)
                  ) : (
                    <button
                      type="button"
                      title="Click to select · Shift-click for a range · Ctrl-click to toggle · double-click to rename · drag to reorder"
                      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left"
                      onClick={(e) => select(el.id, e)}
                      onDoubleClick={() => setRenaming(el.id)}
                    >
                      <span
                        aria-hidden="true"
                        className={`shrink-0 ${selectedIds.includes(el.id) ? "text-[var(--accent)]" : "text-[var(--text-faint)]"}`}
                      >
                        <Icon name={iconFor(el)} size={13} />
                      </span>
                      <span className={`min-w-0 truncate text-[11.5px] ${shown ? "" : "line-through opacity-50"}`}>
                        {el.name}
                      </span>
                      {el.type === "image" && el.generative && (
                        <span className="shrink-0 text-[var(--accent)]" title={`Generated (${el.generative.kind})`}>
                          <Icon name="sparkle" size={11} />
                          <span className="sr-only">generated</span>
                        </span>
                      )}
                      {el.type === "image" && isCropped(el.crop) && (
                        <span className="shrink-0 text-[var(--text-faint)]" title="Cropped">
                          <Icon name="crop" size={11} />
                          <span className="sr-only">cropped</span>
                        </span>
                      )}
                    </button>
                  )}
                  {el.mask && (
                    <button
                      type="button"
                      aria-label={`Mask of ${el.name}${el.mask.enabled ? "" : " (disabled)"}`}
                      aria-pressed={maskTarget === el.id}
                      title="Layer mask · click to paint on it (white reveals, black hides) · Shift-click to disable · Ctrl-click to load as a selection · right-click for more"
                      onClick={(e) => {
                        e.stopPropagation();
                        onMaskClick(el.id, e);
                      }}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        onMaskContextMenu(e, el.id);
                      }}
                      className={`relative h-[18px] w-6 shrink-0 overflow-hidden rounded-[3px] border bg-black ${
                        maskTarget === el.id
                          ? "border-[var(--accent)] ring-1 ring-[var(--accent)]"
                          : "border-[var(--border-strong)]"
                      }`}
                    >
                      <img src={el.mask.src} alt="" draggable={false} className="h-full w-full" style={{ objectFit: "fill" }} />
                      {!el.mask.enabled && (
                        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-[13px] font-bold leading-none text-[var(--danger)]">
                          ✕
                        </span>
                      )}
                    </button>
                  )}
                  {fx && fx.length > 0 && (
                    <button
                      type="button"
                      aria-label={folded ? `Show effects on ${el.name}` : `Hide effects list on ${el.name}`}
                      aria-expanded={!folded}
                      title={folded ? "Show effects" : "Fold effects"}
                      onClick={() =>
                        setFoldedEffects((cur) => (cur.includes(el.id) ? cur.filter((x) => x !== el.id) : [...cur, el.id]))
                      }
                      className="flex h-6 shrink-0 items-center gap-0.5 rounded-[4px] px-1 text-[var(--text-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]"
                    >
                      <Icon name="fx" size={11} />
                      <span className={`transition-transform ${folded ? "" : "rotate-90"}`}>
                        <Icon name="chevron" size={9} />
                      </span>
                    </button>
                  )}
                </div>
                {renderEffects(el, row.depth)}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex items-center gap-0.5 border-t border-[var(--border)] px-1.5 py-1">
        <span className="mr-auto pl-1 text-[10.5px] text-[var(--text-faint)]">
          {elements.length} layer{elements.length === 1 ? "" : "s"}
          {filtering ? " · filtered" : ""}
        </span>
        <IconTip label="Group selected layers (Ctrl+G)" icon="folderPlus" onClick={onGroup} disabled={selectedIds.length === 0} />
        <IconTip
          label="Add layer mask (from the selection, if any)"
          icon="mask"
          onClick={onAddMask}
          disabled={selectedIds.length !== 1 || !elements.some((e) => e.id === selectedIds[0])}
        />
        <IconTip label="New pixel layer" icon="newLayer" onClick={onNewPixelLayer} />
        <IconTip label="Delete selected layers" icon="trash" onClick={onDelete} disabled={selectedIds.length === 0} danger />
      </div>
    </div>
  );
};

const isGroupVisible = (id: string, byId: Map<string, LayerGroup>): boolean => {
  let g = byId.get(id);
  const seen = new Set<string>();
  while (g && !seen.has(g.id)) {
    if (!g.visible) return false;
    seen.add(g.id);
    g = g.parentId ? byId.get(g.parentId) : undefined;
  }
  return true;
};

export default LayerList;
