import type { ShapeKind } from "../types";
import type { ToolId } from "../lib/tools";
import { TOOLS } from "../lib/tools";
import { SHAPE_ICONS, shapeDef } from "../lib/shapes";
import { Icon } from "./icons";
import type { IconName } from "./icons";

const TOOL_ICONS: Record<ToolId, IconName> = {
  move: "move",
  hand: "hand",
  zoom: "zoom",
  text: "text",
  number: "number",
  shape: "shape",
  brush: "brush",
  eraser: "eraser",
  crop: "crop",
};

/** Groups separated by a rule: navigate, create, edit. */
const GROUPS: ToolId[][] = [["move", "hand", "zoom"], ["text", "number", "shape"], ["brush", "eraser"], ["crop"]];

/**
 * The tool strip. Each tool's key is shown in its tooltip and as a small
 * badge, so the shortcut is learnt by using the button.
 */
const Toolbar = ({
  tool,
  shapeKind,
  colors,
  onSelect,
  onContextMenu,
}: {
  tool: ToolId;
  /** The shape the Shape tool draws; its icon and name follow it. */
  shapeKind: ShapeKind;
  colors: {
    foreground: string;
    background: string;
    onForeground: (hex: string) => void;
    onBackground: (hex: string) => void;
    onSwap: () => void;
    onReset: () => void;
  };
  onSelect: (tool: ToolId) => void;
  onContextMenu: (event: React.MouseEvent, tool: ToolId) => void;
}) => (
  <nav
    aria-label="Tools"
    className="flex w-11 shrink-0 flex-col items-center gap-0.5 border-r border-[var(--border)] bg-[var(--surface)] py-2"
  >
    {GROUPS.map((group, i) => (
      <div key={i} className="flex flex-col items-center gap-0.5">
        {i > 0 && <span aria-hidden="true" className="my-1 h-px w-6 bg-[var(--border)]" />}
        {group.map((id) => {
          const def = TOOLS.find((t) => t.id === id);
          if (!def) return null;
          const active = tool === id;
          const isShape = id === "shape";
          const label = isShape ? shapeDef(shapeKind).label : def.label;
          return (
            <button
              key={id}
              type="button"
              title={
                isShape
                  ? `${label} tool (U) · right-click or Shift+U for more shapes`
                  : `${def.label} tool (${def.shortcut})`
              }
              aria-label={isShape ? "Shape tool" : `${def.label} tool`}
              aria-keyshortcuts={def.shortcut}
              aria-pressed={active}
              onClick={() => onSelect(id)}
              onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e, id);
              }}
              className={`relative flex h-8 w-8 items-center justify-center rounded-[6px] transition-colors ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-text)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              }`}
            >
              <Icon name={isShape ? SHAPE_ICONS[shapeKind] : TOOL_ICONS[id]} />
              {isShape && (
                // The small corner triangle marks a tool with more options.
                <span
                  aria-hidden="true"
                  className="absolute bottom-[2px] left-[2px] h-0 w-0 border-l-[4px] border-t-[4px] border-l-transparent border-t-current opacity-60"
                  style={{ transform: "rotate(180deg)" }}
                />
              )}
              <span
                aria-hidden="true"
                className={`absolute bottom-[1px] right-[2px] text-[8px] font-semibold leading-none ${
                  active ? "text-[var(--accent-text)] opacity-80" : "text-[var(--text-faint)]"
                }`}
              >
                {def.shortcut}
              </span>
            </button>
          );
        })}
      </div>
    ))}

    {/* Foreground / background colours, as in Photoshop: X swaps, D resets. */}
    <div className="mt-auto flex flex-col items-center gap-1 pb-1 pt-3">
      <div className="relative h-9 w-9">
        <label
          title="Background colour"
          className="absolute bottom-0 right-0 h-5 w-5 cursor-pointer rounded-[3px] border border-[var(--border-strong)] shadow"
          style={{ background: colors.background }}
        >
          <input
            type="color"
            aria-label="Background colour"
            className="sr-only"
            value={colors.background}
            onChange={(e) => colors.onBackground(e.target.value)}
          />
        </label>
        <label
          title="Foreground (brush) colour"
          className="absolute left-0 top-0 h-5 w-5 cursor-pointer rounded-[3px] border border-[var(--border-strong)] shadow"
          style={{ background: colors.foreground }}
        >
          <input
            type="color"
            aria-label="Foreground colour"
            className="sr-only"
            value={colors.foreground}
            onChange={(e) => colors.onForeground(e.target.value)}
          />
        </label>
      </div>
      <div className="flex gap-0.5">
        <button
          type="button"
          title="Swap colours (X)"
          aria-label="Swap colours"
          onClick={colors.onSwap}
          className="flex h-4 w-4 items-center justify-center rounded text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          <Icon name="swap" size={11} />
        </button>
        <button
          type="button"
          title="Default colours (D)"
          aria-label="Default colours"
          onClick={colors.onReset}
          className="flex h-4 w-4 items-center justify-center rounded text-[9px] font-bold text-[var(--text-faint)] hover:text-[var(--text)]"
        >
          ◩
        </button>
      </div>
    </div>
  </nav>
);

export default Toolbar;
