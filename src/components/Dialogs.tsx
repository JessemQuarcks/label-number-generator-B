import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { ACCENTS } from "../lib/theme";
import type { ThemePrefs } from "../lib/theme";
import type { CanvasBackdrop, Corners, PanelId, WorkspacePrefs } from "../lib/workspace";
import { PANEL_TITLES } from "../lib/workspace";
import { TOOLS } from "../lib/tools";
import { Button, SegmentedControl, Toggle } from "./controls";
import { Icon } from "./icons";

/** A centred modal. Esc or the backdrop closes it; focus moves inside. */
export const Modal = ({
  title,
  onClose,
  children,
  width = "32rem",
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-6" onPointerDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onPointerDown={(e) => e.stopPropagation()}
        className="flex max-h-full flex-col overflow-hidden rounded-[calc(var(--radius)+4px)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl outline-none"
        style={{ width }}
      >
        <header className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-[5px] text-[var(--text-faint)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
          >
            <Icon name="close" size={12} />
          </button>
        </header>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">{label}</h3>
    {children}
  </div>
);

export const AppearanceDialog = ({
  theme,
  onMode,
  onAccent,
  onCustomAccent,
  workspace,
  onWorkspace,
  onTogglePanel,
  onReset,
  onClose,
}: {
  theme: ThemePrefs;
  onMode: (mode: "dark" | "light") => void;
  onAccent: (key: string) => void;
  onCustomAccent: (hex: string) => void;
  workspace: WorkspacePrefs;
  onWorkspace: (patch: Partial<WorkspacePrefs>) => void;
  onTogglePanel: (id: PanelId) => void;
  onReset: () => void;
  onClose: () => void;
}) => (
  <Modal title="Appearance & workspace" onClose={onClose}>
    <div className="flex flex-col gap-5">
      <Row label="Theme">
        <SegmentedControl
          label="Mode"
          value={theme.mode}
          options={[
            { label: "Dark", value: "dark" as const },
            { label: "Light", value: "light" as const },
          ]}
          onChange={onMode}
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-[11px] font-medium text-[var(--text-dim)]">Accent colour</span>
          <div role="group" aria-label="Accent colour" className="flex flex-wrap items-center gap-2">
            {ACCENTS.map((accent) => (
              <button
                key={accent.key}
                type="button"
                title={accent.label}
                aria-label={`${accent.label} accent`}
                aria-pressed={theme.accent === accent.key}
                onClick={() => onAccent(accent.key)}
                className={`h-6 w-6 rounded-full transition-transform hover:scale-110 ${
                  theme.accent === accent.key
                    ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface)]"
                    : ""
                }`}
                style={{ background: accent.value }}
              />
            ))}
            <label
              className={`flex h-6 items-center gap-1.5 rounded-full border border-[var(--border)] pl-1 pr-2 text-[11px] text-[var(--text-dim)] ${
                theme.accent === "custom" ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface)]" : ""
              }`}
            >
              <input
                type="color"
                aria-label="Custom accent colour"
                className="h-4 w-4"
                value={theme.customAccent ?? "#4f8ef7"}
                onChange={(e) => onCustomAccent(e.target.value)}
              />
              Custom
            </label>
          </div>
        </div>
        <SegmentedControl<Corners>
          label="Corners"
          value={workspace.corners}
          options={[
            { label: "Sharp", value: "sharp" },
            { label: "Default", value: "default" },
            { label: "Round", value: "round" },
          ]}
          onChange={(corners) => onWorkspace({ corners })}
        />
      </Row>

      <Row label="Canvas">
        <SegmentedControl<CanvasBackdrop>
          label="Backdrop behind the label"
          value={workspace.canvasBackdrop}
          options={[
            { label: "Theme", value: "default" },
            { label: "Light", value: "light" },
            { label: "Dark", value: "dark" },
            { label: "Checker", value: "checker" },
          ]}
          onChange={(canvasBackdrop) => onWorkspace({ canvasBackdrop })}
        />
        <Toggle
          label="Show layer edges"
          checked={workspace.showLayerEdges}
          onChange={(showLayerEdges) => onWorkspace({ showLayerEdges })}
        />
      </Row>

      <Row label="Panels & bars">
        <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          {(Object.keys(PANEL_TITLES) as PanelId[]).map((id) => (
            <Toggle
              key={id}
              label={PANEL_TITLES[id]}
              checked={workspace.panels[id].visible}
              onChange={() => onTogglePanel(id)}
            />
          ))}
          <Toggle label="Tools" checked={workspace.showToolbar} onChange={(showToolbar) => onWorkspace({ showToolbar })} />
          <Toggle
            label="Tool options bar"
            checked={workspace.showOptionsBar}
            onChange={(showOptionsBar) => onWorkspace({ showOptionsBar })}
          />
          <Toggle label="Document tabs" checked={workspace.showTabs} onChange={(showTabs) => onWorkspace({ showTabs })} />
          <Toggle
            label="Status bar"
            checked={workspace.showStatusBar}
            onChange={(showStatusBar) => onWorkspace({ showStatusBar })}
          />
        </div>
        <p className="text-[11px] leading-snug text-[var(--text-faint)]">
          Panels can also be closed from their title bar, moved between docks from their ⋯ menu,
          and resized by dragging the dock edge. Press F to hide every panel at once.
        </p>
      </Row>

      <div className="flex justify-between border-t border-[var(--border)] pt-4">
        <Button variant="ghost" onClick={onReset}>
          Reset workspace
        </Button>
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      </div>
    </div>
  </Modal>
);

const mod = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: "Tools",
    items: TOOLS.map((t) => [t.shortcut, `${t.label} tool`] as [string, string]).concat([
      ["Space (hold)", "Pan with any tool"],
      ["Shift + U", "Next shape for the Shape tool"],
    ]),
  },
  {
    title: "View",
    items: [
      ["Alt + scroll", "Zoom in / out at the cursor"],
      [`${mod} + scroll / pinch`, "Zoom in / out at the cursor"],
      ["+ / −", "Zoom in / out"],
      ["0", "Fit on screen"],
      [`${mod} + 1`, "Actual size (100%)"],
      ["G", "Toggle grid"],
      ["F", "Hide / show all panels"],
    ],
  },
  {
    title: "Edit",
    items: [
      [`${mod} + Z`, "Undo"],
      [`${mod} + Shift + Z`, "Redo"],
      [`${mod} + D`, "Duplicate selection"],
      [`${mod} + A`, "Select all layers"],
      ["Delete", "Delete selection"],
      ["Arrows", "Nudge 1 mm (Shift: 0.1 mm)"],
      ["Esc", "Drop the pixel selection, then deselect layers / cancel crop"],
      ["Enter", "Apply crop"],
      [`${mod} + V`, "Paste an image from the clipboard"],
    ],
  },
  {
    title: "Selections",
    items: [
      ["M / L / W", "Marquee / lasso / object, quick & wand"],
      ["Shift + M / L / W", "Next tool in the slot"],
      ["Shift-drag / Alt-drag", "Add to / subtract from the selection"],
      [`With a selection tool: ${mod} + A`, "Select the whole label"],
      [`With a selection tool: ${mod} + D`, "Deselect"],
      [`${mod} + Shift + D`, "Reselect"],
      [`${mod} + Shift + I`, "Inverse"],
      [`${mod} + Alt + R`, "Select and Mask"],
      ["Shift + F6", "Feather"],
      [`${mod} + J`, "Layer via copy"],
      ["Delete (with a selection)", "Clear / hide the selected pixels"],
      ["J", "Remove tool (AI)"],
    ],
  },
  {
    title: "Brush",
    items: [
      ["[ / ]", "Smaller / larger brush"],
      ["Shift + [ / ]", "Softer / harder brush"],
      ["Shift-click", "Straight line from the last stroke"],
      ["X", "Swap foreground and background colours"],
      ["D", "Default colours (black / white)"],
    ],
  },
  {
    title: "Layers",
    items: [
      [`${mod} + G`, "Group selected layers"],
      [`${mod} + Shift + G`, "Ungroup"],
      ["Shift-click a layer", "Select a range of layers"],
      [`${mod}-click a layer`, "Add / remove one layer"],
      [`${mod} + ]`, "Bring forward"],
      [`${mod} + [`, "Send backward"],
      [`${mod} + Shift + ]`, "Bring to front"],
      [`${mod} + Shift + [`, "Send to back"],
      [`${mod} + P`, "Print"],
      ["?", "This list"],
    ],
  },
];

export const ShortcutsDialog = ({ onClose }: { onClose: () => void }) => (
  <Modal title="Keyboard shortcuts" onClose={onClose} width="40rem">
    <div className="grid grid-cols-2 gap-x-8 gap-y-5">
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.title} className="flex flex-col gap-1.5">
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
            {group.title}
          </h3>
          {group.items.map(([keys, action]) => (
            <div key={keys + action} className="flex items-center justify-between gap-3 text-[11.5px]">
              <span className="text-[var(--text-dim)]">{action}</span>
              <kbd className="shrink-0 rounded-[4px] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 font-sans text-[10.5px] text-[var(--text)]">
                {keys}
              </kbd>
            </div>
          ))}
        </div>
      ))}
    </div>
  </Modal>
);
