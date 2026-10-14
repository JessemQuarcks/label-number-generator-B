import type { ElementType, LabelElement } from "../types";
import { IconButton } from "./controls";

const TYPE_ICON: Record<ElementType, string> = {
  text: "T",
  number: "#",
  image: "▣",
  shape: "▢",
};

const ADD_BUTTONS: { type: ElementType; label: string; icon: string }[] = [
  { type: "text", label: "Text", icon: "T" },
  { type: "number", label: "Number", icon: "#" },
  { type: "image", label: "Image", icon: "▣" },
  { type: "shape", label: "Shape", icon: "▢" },
];

interface LayerListProps {
  elements: LabelElement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onAdd: (type: ElementType) => void;
  onToggleVisible: (id: string) => void;
  onDelete: (id: string) => void;
  onReorder: (id: string, direction: -1 | 1) => void;
}

const LayerList = ({
  elements,
  selectedId,
  onSelect,
  onAdd,
  onToggleVisible,
  onDelete,
  onReorder,
}: LayerListProps) => (
  <div className="flex flex-col gap-2.5">
    <div className="grid grid-cols-4 gap-1">
      {ADD_BUTTONS.map(({ type, label, icon }) => (
        <button
          key={type}
          type="button"
          title={`Add ${label.toLowerCase()}`}
          aria-label={`Add ${label.toLowerCase()}`}
          onClick={() => onAdd(type)}
          className="flex flex-col items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] py-2 text-[var(--text-dim)] transition-all hover:border-[var(--accent)] hover:bg-[var(--surface-3)] hover:text-[var(--accent)]"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            {icon}
          </span>
          <span className="text-[10px] font-medium">{label}</span>
        </button>
      ))}
    </div>

    {elements.length === 0 ? (
      <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] py-4 text-center text-[11px] text-[var(--text-faint)]">
        No elements yet — add one above.
      </p>
    ) : (
      <ul className="flex flex-col-reverse gap-0.5">
        {/* Reversed so the topmost layer appears first, as in design tools. */}
        {elements.map((element, index) => {
          const isSelected = element.id === selectedId;
          return (
            <li key={element.id}>
              <div
                className={`group flex items-center gap-1.5 rounded-[var(--radius)] px-1.5 py-1 transition-colors ${
                  isSelected
                    ? "bg-[var(--accent-soft)] text-[var(--text)] ring-1 ring-[var(--accent)]"
                    : "text-[var(--text-dim)] hover:bg-[var(--surface-3)]"
                }`}
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left"
                  onClick={() => onSelect(element.id)}
                >
                  <span
                    aria-hidden="true"
                    className={`w-3 shrink-0 text-center text-[11px] ${
                      isSelected ? "text-[var(--accent)]" : "text-[var(--text-faint)]"
                    }`}
                  >
                    {TYPE_ICON[element.type]}
                  </span>
                  <span
                    className={`truncate text-[11px] ${
                      element.visible ? "" : "line-through opacity-50"
                    }`}
                  >
                    {element.name}
                  </span>
                </button>

                {/* Row actions stay hidden until hover or selection, so the
                    list reads as names rather than a wall of icons. */}
                <div
                  className={`flex items-center transition-opacity ${
                    isSelected
                      ? "opacity-100"
                      : "opacity-0 focus-within:opacity-100 group-hover:opacity-100"
                  }`}
                >
                  <IconButton
                    title={`Move ${element.name} forward`}
                    disabled={index === elements.length - 1}
                    onClick={() => onReorder(element.id, 1)}
                  >
                    ↑
                  </IconButton>
                  <IconButton
                    title={`Move ${element.name} backward`}
                    disabled={index === 0}
                    onClick={() => onReorder(element.id, -1)}
                  >
                    ↓
                  </IconButton>
                  <IconButton
                    title={element.visible ? `Hide ${element.name}` : `Show ${element.name}`}
                    onClick={() => onToggleVisible(element.id)}
                  >
                    {element.visible ? "◉" : "◌"}
                  </IconButton>
                  <IconButton
                    danger
                    title={`Delete ${element.name}`}
                    onClick={() => onDelete(element.id)}
                  >
                    ✕
                  </IconButton>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    )}
  </div>
);

export default LayerList;
