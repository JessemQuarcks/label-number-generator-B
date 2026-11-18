import { useState } from "react";
import type { LabelDesign } from "../types";
import type { MenuEntry } from "./Menu";
import { MenuList } from "./Menu";
import { Icon } from "./icons";

/**
 * Open designs as tabs. Closing a tab only hides the design from the strip —
 * it stays saved and comes back from the "+" menu or File › Open.
 */
const DocumentTabs = ({
  tabs,
  activeId,
  onSelect,
  onClose,
  newMenu,
}: {
  tabs: LabelDesign[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  newMenu: MenuEntry[];
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const closable = tabs.length > 1;

  return (
    <div
      role="tablist"
      aria-label="Open designs"
      className="flex h-8 shrink-0 items-end gap-px overflow-x-auto border-b border-[var(--border)] bg-[var(--bg)] px-1.5"
    >
      {tabs.map((design) => {
        const active = design.id === activeId;
        return (
          <div
            key={design.id}
            className={`group flex h-7 max-w-[14rem] shrink-0 items-center gap-1 rounded-t-[6px] border border-b-0 pl-2.5 pr-1 text-[11px] transition-colors ${
              active
                ? "border-[var(--border)] bg-[var(--surface)] text-[var(--text)]"
                : "border-transparent text-[var(--text-faint)] hover:bg-[var(--surface-2)] hover:text-[var(--text-dim)]"
            }`}
            onAuxClick={(e) => {
              // Middle-click closes, as in browsers.
              if (e.button === 1 && closable) onClose(design.id);
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={active}
              title={`${design.name} · ${design.width}×${design.height}mm`}
              onClick={() => onSelect(design.id)}
              className="min-w-0 truncate py-1 text-left"
            >
              {design.name}
            </button>
            {closable && (
              <button
                type="button"
                aria-label={`Close ${design.name} tab`}
                title="Close tab (the design stays saved)"
                onClick={() => onClose(design.id)}
                className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[3px] text-[var(--text-faint)] transition hover:bg-[var(--surface-3)] hover:text-[var(--text)] ${
                  active ? "opacity-70" : "opacity-0 group-hover:opacity-70"
                }`}
              >
                <Icon name="close" size={10} />
              </button>
            )}
          </div>
        );
      })}
      <div className="relative mb-0.5 ml-0.5 shrink-0">
        <button
          type="button"
          aria-label="New or open design"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="New or open a design"
          onClick={() => setMenuOpen((o) => !o)}
          className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
        >
          <Icon name="plus" size={13} />
        </button>
        {menuOpen && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenuOpen(false)} />
            <div className="fixed z-50 mt-1">
              <MenuList items={newMenu} label="New or open design" onClose={() => setMenuOpen(false)} />
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default DocumentTabs;
