import { useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DockSide, PanelId } from "../lib/workspace";
import { DOCK_MAX, DOCK_MIN, PANEL_TITLES } from "../lib/workspace";
import { Icon } from "./icons";
import { MenuList } from "./Menu";

export interface PanelChrome {
  id: PanelId;
  collapsed: boolean;
  /** Extra header controls, shown only while expanded. */
  actions?: ReactNode;
  /** Optional header subtitle, e.g. the selected layer's name. */
  subtitle?: string;
  content: ReactNode;
}

/**
 * One panel: a title bar you can click to fold, a menu to move it, and a
 * close button. Closed panels come back from the Window menu.
 */
export const Panel = ({
  panel,
  side,
  canMoveUp,
  canMoveDown,
  onToggleCollapse,
  onClose,
  onMoveDock,
  onMove,
}: {
  panel: PanelChrome;
  side: DockSide;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onToggleCollapse: () => void;
  onClose: () => void;
  onMoveDock: () => void;
  onMove: (direction: -1 | 1) => void;
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = PANEL_TITLES[panel.id];

  return (
    <section
      aria-label={`${title} panel`}
      // shrink-0: panels keep their natural height and the dock scrolls,
      // rather than squashing one panel on top of the next.
      className="flex shrink-0 flex-col border-b border-[var(--border)]"
    >
      <header className="group flex h-8 shrink-0 items-center gap-1 bg-[var(--surface-2)] pl-1.5 pr-1">
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-expanded={!panel.collapsed}
          aria-label={`${panel.collapsed ? "Expand" : "Collapse"} ${title} panel`}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span
            aria-hidden="true"
            className={`text-[var(--text-faint)] transition-transform ${panel.collapsed ? "" : "rotate-90"}`}
          >
            <Icon name="chevron" size={11} />
          </span>
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.07em] text-[var(--text-dim)]">
            {title}
          </span>
          {panel.subtitle && (
            <span className="truncate text-[11px] text-[var(--text-faint)]">· {panel.subtitle}</span>
          )}
        </button>
        {!panel.collapsed && panel.actions}
        <div className="relative">
          <button
            type="button"
            aria-label={`Options for ${title} panel`}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title="Panel options"
            onClick={() => setMenuOpen((o) => !o)}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] opacity-60 transition hover:bg-[var(--surface-3)] hover:text-[var(--text)] hover:opacity-100 group-hover:opacity-100"
          >
            <Icon name="more" size={14} />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
              <div className={`absolute top-full z-50 mt-1 ${side === "right" ? "right-0" : "left-0"}`}>
                <MenuList
                  label={`${title} panel options`}
                  onClose={() => setMenuOpen(false)}
                  items={[
                    {
                      label: panel.collapsed ? "Expand" : "Collapse",
                      onSelect: onToggleCollapse,
                    },
                    { label: "Move up", onSelect: () => onMove(-1), disabled: !canMoveUp },
                    { label: "Move down", onSelect: () => onMove(1), disabled: !canMoveDown },
                    {
                      label: `Dock on the ${side === "left" ? "right" : "left"}`,
                      onSelect: onMoveDock,
                    },
                    { kind: "separator" },
                    { label: "Close panel", onSelect: onClose },
                  ]}
                />
              </div>
            </>
          )}
        </div>
        <button
          type="button"
          aria-label={`Close ${title} panel`}
          title="Close panel (reopen from Window)"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] opacity-60 transition hover:bg-[var(--surface-3)] hover:text-[var(--text)] hover:opacity-100 group-hover:opacity-100"
        >
          <Icon name="close" size={12} />
        </button>
      </header>
      {!panel.collapsed && <div className="flex flex-col">{panel.content}</div>}
    </section>
  );
};

/**
 * A column of panels beside the canvas. Drag its inner edge to resize; it
 * disappears entirely when every panel in it is closed.
 */
export const Dock = ({
  side,
  width,
  onResize,
  children,
}: {
  side: DockSide;
  width: number;
  onResize: (width: number) => void;
  children: ReactNode;
}) => {
  const start = useRef<{ x: number; width: number } | null>(null);

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();
    start.current = { x: event.clientX, width };
    const move = (e: PointerEvent) => {
      if (!start.current) return;
      const delta = (e.clientX - start.current.x) * (side === "left" ? 1 : -1);
      onResize(Math.min(Math.max(start.current.width + delta, DOCK_MIN), DOCK_MAX));
    };
    const end = () => {
      start.current = null;
      document.body.style.cursor = "";
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  };

  return (
    <div className="relative flex shrink-0" style={{ width }}>
      <aside
        aria-label={`${side === "left" ? "Left" : "Right"} dock`}
        className={`flex min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--surface)] ${
          side === "left" ? "border-r" : "border-l"
        } border-[var(--border)]`}
      >
        {children}
      </aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={`Resize ${side} dock`}
        aria-valuenow={width}
        aria-valuemin={DOCK_MIN}
        aria-valuemax={DOCK_MAX}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const grow = (e.key === "ArrowRight") === (side === "left") ? 16 : -16;
          onResize(Math.min(Math.max(width + grow, DOCK_MIN), DOCK_MAX));
        }}
        title="Drag to resize"
        className={`absolute inset-y-0 z-20 w-1.5 cursor-col-resize transition-colors hover:bg-[var(--accent)] focus-visible:bg-[var(--accent)] ${
          side === "left" ? "-right-[3px]" : "-left-[3px]"
        }`}
      />
    </div>
  );
};
