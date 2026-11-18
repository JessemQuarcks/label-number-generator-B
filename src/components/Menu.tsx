import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./icons";

export type MenuEntry =
  | {
      kind?: "item";
      label: string;
      onSelect: () => void;
      shortcut?: string;
      disabled?: boolean;
      /** Renders a checkmark slot; true shows the mark. */
      checked?: boolean;
      danger?: boolean;
      icon?: ReactNode;
    }
  | { kind: "submenu"; label: string; items: MenuEntry[]; disabled?: boolean; icon?: ReactNode }
  | { kind: "separator" }
  | { kind: "heading"; label: string };

export interface MenuDef {
  label: string;
  items: MenuEntry[];
}

/**
 * A vertical list of menu entries, keyboard navigable. Used for menu bar
 * drop-downs, submenus and right-click menus alike, so all three behave the
 * same way.
 */
export const MenuList = ({
  items,
  onClose,
  label,
  autoFocus = true,
  onLeft,
}: {
  items: MenuEntry[];
  onClose: () => void;
  label: string;
  autoFocus?: boolean;
  /** Left arrow inside a submenu returns to the parent. */
  onLeft?: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [openSub, setOpenSub] = useState<number | null>(null);

  useEffect(() => {
    if (!autoFocus) return;
    const first = ref.current?.querySelector<HTMLElement>('[role^="menuitem"]:not([aria-disabled="true"])');
    first?.focus();
  }, [autoFocus]);

  const focusables = () =>
    Array.from(ref.current?.querySelectorAll<HTMLElement>(':scope > [role^="menuitem"]') ?? []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const list = focusables();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const step = (dir: 1 | -1) => {
      for (let i = 1; i <= list.length; i += 1) {
        const next = list[(at + dir * i + list.length) % list.length];
        if (next.getAttribute("aria-disabled") !== "true") {
          next.focus();
          return;
        }
      }
    };
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      step(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      step(-1);
    } else if (event.key === "ArrowLeft" && onLeft) {
      event.preventDefault();
      event.stopPropagation();
      onLeft();
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="menu-pop min-w-[13rem] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-2xl"
    >
      {items.map((entry, index) => {
        if (entry.kind === "separator") {
          return <div key={`sep-${index}`} role="separator" className="my-1 h-px bg-[var(--border)]" />;
        }
        if (entry.kind === "heading") {
          return (
            <div
              key={`h-${index}`}
              className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]"
            >
              {entry.label}
            </div>
          );
        }
        if (entry.kind === "submenu") {
          const open = openSub === index;
          return (
            <div
              key={entry.label}
              role="menuitem"
              tabIndex={-1}
              aria-haspopup="menu"
              aria-expanded={open}
              aria-disabled={entry.disabled || undefined}
              className="menu-row relative"
              onMouseEnter={() => !entry.disabled && setOpenSub(index)}
              onMouseLeave={() => setOpenSub((s) => (s === index ? null : s))}
              onClick={() => !entry.disabled && setOpenSub(index)}
              onKeyDown={(e) => {
                if ((e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") && !entry.disabled) {
                  e.preventDefault();
                  e.stopPropagation();
                  setOpenSub(index);
                }
              }}
            >
              <span className="menu-check">{entry.icon}</span>
              <span className="flex-1">{entry.label}</span>
              <span className="text-[var(--text-faint)]">
                <Icon name="chevron" size={12} />
              </span>
              {open && (
                <div
                  className="absolute left-full top-[-5px] z-10 pl-1"
                  onClick={(e) => e.stopPropagation()}
                >
                  <MenuList
                    items={entry.items}
                    label={entry.label}
                    onClose={onClose}
                    onLeft={() => {
                      setOpenSub(null);
                      focusables()[index]?.focus();
                    }}
                  />
                </div>
              )}
            </div>
          );
        }
        const checkable = entry.checked !== undefined;
        return (
          <div
            key={`${entry.label}-${index}`}
            role={checkable ? "menuitemcheckbox" : "menuitem"}
            aria-checked={checkable ? entry.checked : undefined}
            aria-disabled={entry.disabled || undefined}
            tabIndex={-1}
            className={`menu-row ${entry.danger ? "text-[var(--danger)]" : ""}`}
            onMouseEnter={(e) => {
              setOpenSub(null);
              (e.currentTarget as HTMLElement).focus();
            }}
            onClick={() => {
              if (entry.disabled) return;
              onClose();
              entry.onSelect();
            }}
            onKeyDown={(e) => {
              if ((e.key === "Enter" || e.key === " ") && !entry.disabled) {
                e.preventDefault();
                e.stopPropagation();
                onClose();
                entry.onSelect();
              }
            }}
          >
            <span className="menu-check">
              {checkable ? entry.checked ? <Icon name="check" size={12} /> : null : entry.icon}
            </span>
            <span className="flex-1">{entry.label}</span>
            {entry.shortcut && (
              <kbd className="ml-6 font-sans text-[10px] tracking-wide text-[var(--text-faint)]">
                {entry.shortcut}
              </kbd>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * The application menu bar. Click to open; once a menu is open, hovering a
 * sibling switches to it, as in desktop apps.
 */
export const MenuBar = ({ menus }: { menus: MenuDef[] }) => {
  const [open, setOpen] = useState<number | null>(null);
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open === null) return;
    const onDown = (e: PointerEvent) => {
      if (!barRef.current?.contains(e.target as Node)) setOpen(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [open]);

  const close = () => setOpen(null);

  return (
    <div ref={barRef} role="menubar" aria-label="Main menu" className="flex items-center">
      {menus.map((menu, index) => (
        <div key={menu.label} className="relative">
          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={open === index}
            onClick={() => setOpen((o) => (o === index ? null : index))}
            onMouseEnter={() => open !== null && setOpen(index)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(index);
              } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = (index + (e.key === "ArrowRight" ? 1 : -1) + menus.length) % menus.length;
                const buttons = barRef.current?.querySelectorAll<HTMLElement>(':scope > div > button');
                buttons?.[next]?.focus();
                if (open !== null) setOpen(next);
              }
            }}
            className={`rounded-[5px] px-2 py-1 text-[11.5px] transition-colors ${
              open === index
                ? "bg-[var(--surface-3)] text-[var(--text)]"
                : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            }`}
          >
            {menu.label}
          </button>
          {open === index && (
            <div className="absolute left-0 top-full z-50 mt-1">
              <MenuList items={menu.items} label={menu.label} onClose={close} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export interface ContextMenuState {
  x: number;
  y: number;
  items: MenuEntry[];
  label: string;
}

/** A right-click menu at a screen point, nudged to stay inside the window. */
export const ContextMenu = ({
  menu,
  onClose,
}: {
  menu: ContextMenuState;
  onClose: () => void;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const x = Math.min(menu.x, window.innerWidth - rect.width - 8);
    const y = Math.min(menu.y, window.innerHeight - rect.height - 8);
    setPos({ x: Math.max(8, x), y: Math.max(8, y) });
  }, [menu.x, menu.y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onBlur = () => onClose();
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("blur", onBlur);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[60]"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuList items={menu.items} label={menu.label} onClose={onClose} />
    </div>
  );
};
