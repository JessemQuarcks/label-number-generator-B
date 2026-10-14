import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Canvas,
  IconButton,
  Inspector,
  LayerList,
  NumberInput,
  PrintSheet,
  Section,
  Toggle,
} from "./components";
import { useDesigns } from "./lib/useDesigns";
import { PRESETS } from "./lib/defaults";
import { MAX_COUNT } from "./lib/storage";
import { PX_PER_MM } from "./lib/units";
import { ACCENTS, useTheme } from "./lib/theme";
import { lastNumber } from "./lib/numbering";
import { waitForDesignFonts } from "./lib/fontLoader";
import { useFontsReady } from "./lib/useFontsReady";
import { findMissingFonts } from "./lib/fontAvailability";
import FontManager from "./components/FontManager";
import FontWarnings from "./components/FontWarnings";

type Status = { tone: "info" | "error"; message: string } | null;

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3];

function App() {
  const {
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
  } = useDesigns();

  const fontsReady = useFontsReady(activeDesign);

  // Re-measured once fonts are ready, so a just-uploaded family is not
  // reported missing while its file is still decoding.
  const missingFonts = useMemo(
    () => (fontsReady ? findMissingFonts(activeDesign) : []),
    [activeDesign, fontsReady]
  );

  const { prefs, setAccent, toggleMode } = useTheme();

  // 0 means "fit the label to the work area".
  const [zoom, setZoom] = useState(0);
  const [showGrid, setShowGrid] = useState(false);
  const [snap, setSnap] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [showPresets, setShowPresets] = useState(false);
  const [printing, setPrinting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const workAreaRef = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);

  // Recompute "fit" whenever the work area or the label size changes, so the
  // whole label stays visible at any window size.
  useEffect(() => {
    const node = workAreaRef.current;
    if (!node) return;
    const recompute = () => {
      const pad = 80;
      const w = (node.clientWidth - pad) / (activeDesign.width * PX_PER_MM);
      const h = (node.clientHeight - pad) / (activeDesign.height * PX_PER_MM);
      setFitScale(Math.max(0.1, Math.min(w, h, 2)));
    };
    recompute();
    const observer = new ResizeObserver(recompute);
    observer.observe(node);
    return () => observer.disconnect();
  }, [activeDesign.width, activeDesign.height]);

  const scale = zoom === 0 ? fitScale : zoom;

  const notify = useCallback((tone: "info" | "error", message: string) => {
    setStatus({ tone, message });
    window.setTimeout(() => setStatus(null), 3500);
  }, []);

  const handleImport = async (file: File) => {
    try {
      const added = importJson(await file.text());
      notify("info", `Imported ${added} design${added === 1 ? "" : "s"}.`);
    } catch (error) {
      notify("error", error instanceof Error ? error.message : "Import failed.");
    }
  };

  const handleExport = () => {
    const blob = new Blob([exportJson("all")], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "label-designs.json";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("info", "Exported all designs.");
  };

  /**
   * Print only once every font the design uses is loaded. Printing early
   * renders text in a fallback at the wrong advance width, which changes where
   * lines wrap — on paper, at a size that cannot be undone.
   */
  const handlePrint = useCallback(async () => {
    if (printing) return;

    // A missing family cannot be fixed by waiting, and the substitution is
    // invisible on screen. Confirm before committing a run to paper.
    if (missingFonts.length > 0) {
      const names = missingFonts.map((w) => w.requested).join(", ");
      const proceed = window.confirm(
        `${names} ${missingFonts.length === 1 ? "is" : "are"} not installed on this machine.\n\n` +
          `These labels will print in a substitute font with different letter widths, ` +
          `so text may wrap differently than it looks here.\n\n` +
          `Print ${state.print.count} label${state.print.count === 1 ? "" : "s"} anyway?`
      );
      if (!proceed) return;
    }

    setPrinting(true);
    try {
      const { timedOut } = await waitForDesignFonts(activeDesign);
      if (timedOut) {
        notify(
          "error",
          "Some fonts did not load in time — printing with fallbacks."
        );
      }
      window.print();
    } finally {
      setPrinting(false);
    }
  }, [activeDesign, notify, printing, missingFonts, state.print.count]);

  const stepZoom = (direction: -1 | 1) => {
    const current = scale;
    const next =
      direction === 1
        ? ZOOM_STEPS.find((z) => z > current + 0.001)
        : [...ZOOM_STEPS].reverse().find((z) => z < current - 0.001);
    if (next) setZoom(next);
  };

  // Keyboard shortcuts for the actions reached most often.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
      if (typing) return;

      if ((event.ctrlKey || event.metaKey) && event.key === "p") {
        event.preventDefault();
        void handlePrint();
      } else if ((event.ctrlKey || event.metaKey) && event.key === "d" && selectedId) {
        event.preventDefault();
        duplicateElement(selectedId);
      } else if ((event.key === "Delete" || event.key === "Backspace") && selectedId) {
        event.preventDefault();
        deleteElement(selectedId);
      } else if (event.key === "Escape") {
        setSelectedId(null);
        setShowPresets(false);
      } else if (event.key === "g") {
        setShowGrid((g) => !g);
      } else if (event.key === "0") {
        setZoom(0);
      } else if (event.key === "+" || event.key === "=") {
        stepZoom(1);
      } else if (event.key === "-") {
        stepZoom(-1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, duplicateElement, deleteElement, setSelectedId, scale, handlePrint]);

  const runEnd = lastNumber(state.print);

  return (
    <>
      {/* ---------- Screen UI (hidden when printing) ---------- */}
      <div className="screen-only flex h-screen flex-col bg-[var(--bg)] text-[var(--text)]">
        {/* ---------- Top bar ---------- */}
        <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-6 w-6 items-center justify-center rounded-[6px] bg-[var(--accent)] text-[11px] font-bold text-[var(--accent-text)]"
            >
              #
            </span>
            <h1 className="text-xs font-semibold tracking-tight">Label Studio</h1>
          </div>

          <div className="mx-1 h-5 w-px bg-[var(--border)]" />

          <select
            className="max-w-[18rem] cursor-pointer rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11px] text-[var(--text)] transition-colors hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none"
            value={activeDesign.id}
            onChange={(e) => selectDesign(e.target.value)}
            aria-label="Active design"
          >
            {state.designs.map((design) => (
              <option key={design.id} value={design.id}>
                {design.name} · {design.width}×{design.height}mm
              </option>
            ))}
          </select>

          <div className="relative">
            <Button onClick={() => setShowPresets((s) => !s)}>+ New</Button>
            {showPresets && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowPresets(false)}
                  aria-hidden="true"
                />
                <div className="absolute left-0 top-full z-20 mt-1.5 w-72 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl">
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.key}
                      type="button"
                      onClick={() => {
                        addDesign(preset.create());
                        setShowPresets(false);
                        notify("info", `Added "${preset.label}".`);
                      }}
                      className="block w-full border-b border-[var(--border)] px-3 py-2.5 text-left transition-colors last:border-b-0 hover:bg-[var(--surface-3)]"
                    >
                      <span className="block text-[11px] font-medium">{preset.label}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-[var(--text-faint)]">
                        {preset.description}
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          <IconButton title="Duplicate this design" onClick={duplicateDesign}>
            ⧉
          </IconButton>
          <IconButton
            danger
            title={
              state.designs.length <= 1
                ? "Keep at least one design"
                : "Delete this design"
            }
            disabled={state.designs.length <= 1}
            onClick={() => deleteDesign(activeDesign.id)}
          >
            ✕
          </IconButton>

          <div className="ml-auto flex items-center gap-2">
            {status && (
              <span
                role="status"
                className={`text-[11px] ${
                  status.tone === "error"
                    ? "text-[var(--danger)]"
                    : "text-[var(--text-dim)]"
                }`}
              >
                {status.message}
              </span>
            )}

            {/* Accent picker — personalisation in one click. */}
            <div
              role="group"
              aria-label="Accent colour"
              className="flex items-center gap-1 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-1"
            >
              {ACCENTS.map((accent) => (
                <button
                  key={accent.key}
                  type="button"
                  title={accent.label}
                  aria-label={`${accent.label} accent`}
                  aria-pressed={prefs.accent === accent.key}
                  onClick={() => setAccent(accent.key)}
                  className={`h-3.5 w-3.5 rounded-full transition-transform hover:scale-125 ${
                    prefs.accent === accent.key
                      ? "ring-2 ring-[var(--text)] ring-offset-2 ring-offset-[var(--surface-2)]"
                      : ""
                  }`}
                  style={{ background: accent.value }}
                />
              ))}
            </div>

            <IconButton
              title={prefs.mode === "dark" ? "Switch to light" : "Switch to dark"}
              onClick={toggleMode}
            >
              {prefs.mode === "dark" ? "☀" : "☾"}
            </IconButton>

            <div className="mx-0.5 h-5 w-px bg-[var(--border)]" />

            <input
              ref={fileRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleImport(file);
                event.target.value = "";
              }}
            />
            <Button onClick={() => fileRef.current?.click()}>Import</Button>
            <Button onClick={handleExport}>Export</Button>
            <Button variant="primary" disabled={printing} onClick={() => void handlePrint()}>
              {printing ? "Preparing…" : `Print ${state.print.count}`}
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ---------- Left rail ---------- */}
          <aside className="flex w-[15.5rem] shrink-0 flex-col overflow-y-auto border-r border-[var(--border)] bg-[var(--surface)]">
            <Section title="Elements">
              <LayerList
                elements={activeDesign.elements}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onAdd={addElement}
                onToggleVisible={toggleVisible}
                onDelete={deleteElement}
                onReorder={reorderElement}
              />
            </Section>

            <Section title="Fonts" collapsible defaultOpen={missingFonts.length > 0}>
              <FontWarnings warnings={missingFonts} />
              <FontManager
                fonts={activeDesign.fonts ?? []}
                onAdd={addFont}
                onRemove={removeFont}
                onError={(message) => notify("error", message)}
              />
            </Section>

            <Section title="Print run">
              <div className="grid grid-cols-2 gap-2">
                <NumberInput
                  label="Start at"
                  value={state.print.startNumber}
                  min={0}
                  max={10 ** 9}
                  step={1}
                  integer
                  allowMin
                  onChange={(startNumber) => setPrint({ startNumber })}
                />
                <NumberInput
                  label="How many"
                  value={state.print.count}
                  min={1}
                  max={MAX_COUNT}
                  step={1}
                  integer
                  allowMin
                  onChange={(count) => setPrint({ count })}
                />
              </div>
              <NumberInput
                label="Gap between labels"
                suffix="mm"
                value={state.print.gap}
                min={0}
                max={200}
                step={0.5}
                allowMin
                onChange={(gap) => setPrint({ gap })}
              />
              <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-2">
                <p className="text-[11px] text-[var(--text-dim)]">
                  Numbers{" "}
                  <strong className="font-semibold text-[var(--text)]">
                    {state.print.startNumber}
                  </strong>{" "}
                  →{" "}
                  <strong className="font-semibold text-[var(--text)]">{runEnd}</strong>
                </p>
                <p className="mt-1 text-[11px] leading-snug text-[var(--text-faint)]">
                  Match your browser's paper size and margins to your stock.
                </p>
              </div>
            </Section>
          </aside>

          {/* ---------- Canvas ---------- */}
          <main className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] bg-[var(--surface)] px-3 py-1.5">
              <div className="flex items-center gap-0.5">
                <IconButton title="Zoom out (−)" onClick={() => stepZoom(-1)}>
                  −
                </IconButton>
                <button
                  type="button"
                  onClick={() => setZoom(0)}
                  title="Fit to window (0)"
                  className="min-w-[3.5rem] rounded-[5px] px-1.5 py-1 text-[11px] font-medium tabular-nums text-[var(--text-dim)] transition-colors hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
                >
                  {zoom === 0 ? "Fit" : `${Math.round(scale * 100)}%`}
                </button>
                <IconButton title="Zoom in (+)" onClick={() => stepZoom(1)}>
                  +
                </IconButton>
              </div>

              <div className="h-4 w-px bg-[var(--border)]" />

              <Toggle label="Grid" checked={showGrid} onChange={setShowGrid} />
              <Toggle label="Snap" checked={snap} onChange={setSnap} />

              <span className="ml-auto text-[11px] text-[var(--text-faint)]">
                Drag to move · arrows nudge · corners resize · previewing #
                {state.print.startNumber}
              </span>
            </div>

            <div ref={workAreaRef} className="min-h-0 flex-1 overflow-auto">
              <Canvas
                design={activeDesign}
                previewNumber={state.print.startNumber}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onMove={moveElement}
                onResize={patchElement}
                scale={scale}
                showGrid={showGrid}
                snap={snap}
                fontsReady={fontsReady}
              />
            </div>
          </main>

          {/* ---------- Inspector ---------- */}
          <Inspector
            design={activeDesign}
            selected={selected}
            onDesignChange={patchDesign}
            onElementChange={patchElement}
            onDeleteElement={deleteElement}
            onDuplicateElement={duplicateElement}
            onReorderElement={reorderElement}
          />
        </div>
      </div>

      {/* ---------- Print output ---------- */}
      <PrintSheet design={activeDesign} print={state.print} fontsReady={fontsReady} />
    </>
  );
}

export default App;
