import { useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./Dialogs";
import { Button, NumberInput, Slider, Toggle } from "./controls";
import { Icon } from "./icons";
import type { ModifyKind, RefineSession, RefineUi, RefineView } from "../lib/selection/useSelection";
import type { ExpandBy } from "../lib/ai/useGenerative";

const Actions = ({ children }: { children: ReactNode }) => (
  <div className="mt-4 flex justify-end gap-2">{children}</div>
);

const MODIFY_TEXT: Record<ModifyKind, { title: string; label: string; initial: number; max: number }> = {
  expand: { title: "Expand selection", label: "Expand by", initial: 1, max: 100 },
  contract: { title: "Contract selection", label: "Contract by", initial: 1, max: 100 },
  feather: { title: "Feather selection", label: "Feather radius", initial: 1, max: 50 },
  smooth: { title: "Smooth selection", label: "Sample radius", initial: 0.5, max: 20 },
  border: { title: "Border selection", label: "Width", initial: 1, max: 50 },
};

/** Select ▸ Modify ▸ Expand / Contract / Feather / Smooth / Border, in mm. */
export const ModifyDialog = ({
  kind,
  onApply,
  onClose,
}: {
  kind: ModifyKind;
  onApply: (kind: ModifyKind, mm: number) => void;
  onClose: () => void;
}) => {
  const text = MODIFY_TEXT[kind];
  const [value, setValue] = useState(text.initial);
  return (
    <Modal title={text.title} onClose={onClose} width="20rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onApply(kind, value);
          onClose();
        }}
      >
        <NumberInput label={text.label} suffix="mm" value={value} min={0} max={text.max} step={0.1} onChange={setValue} />
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            OK
          </Button>
        </Actions>
      </form>
    </Modal>
  );
};

/** Select ▸ Object by description… (and Sky, pre-filled). */
export const DescribeDialog = ({
  onSelect,
  onClose,
}: {
  onSelect: (prompt: string) => void;
  onClose: () => void;
}) => {
  const [prompt, setPrompt] = useState("");
  return (
    <Modal title="Select by description" onClose={onClose} width="24rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!prompt.trim()) return;
          onSelect(prompt);
          onClose();
        }}
        className="flex flex-col gap-2"
      >
        <label htmlFor="describe-prompt" className="text-[11px] font-medium text-[var(--text-dim)]">
          What should be selected?
        </label>
        <input
          id="describe-prompt"
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="the lemons · the bottle · people · text"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        <p className="text-[10.5px] text-[var(--text-faint)]">Every matching object is selected. Hold Shift when choosing the menu item to add to the current selection.</p>
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!prompt.trim()}>
            Select
          </Button>
        </Actions>
      </form>
    </Modal>
  );
};

/** Generative expand: how far to grow an image on each side, and what to fill with. */
export const ExpandDialog = ({
  name,
  size,
  onExpand,
  onClose,
}: {
  name: string;
  size: { width: number; height: number };
  onExpand: (by: ExpandBy, prompt: string) => void;
  onClose: () => void;
}) => {
  const quarter = Math.round(Math.min(size.width, size.height) * 25) / 100;
  const [by, setBy] = useState<ExpandBy>({ left: quarter, top: 0, right: quarter, bottom: 0 });
  const [prompt, setPrompt] = useState("");
  const set = (k: keyof ExpandBy) => (v: number) => setBy((b) => ({ ...b, [k]: v }));
  return (
    <Modal title={`Generative expand — ${name}`} onClose={onClose} width="24rem">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onExpand(by, prompt);
          onClose();
        }}
        className="flex flex-col gap-3"
      >
        <div className="grid grid-cols-2 gap-2">
          <NumberInput label="Left" suffix="mm" value={by.left} min={0} max={500} step={0.5} allowMin onChange={set("left")} />
          <NumberInput label="Right" suffix="mm" value={by.right} min={0} max={500} step={0.5} allowMin onChange={set("right")} />
          <NumberInput label="Top" suffix="mm" value={by.top} min={0} max={500} step={0.5} allowMin onChange={set("top")} />
          <NumberInput label="Bottom" suffix="mm" value={by.bottom} min={0} max={500} step={0.5} allowMin onChange={set("bottom")} />
        </div>
        <p className="text-[11px] text-[var(--text-dim)]">
          New size: {(size.width + by.left + by.right).toFixed(1)} × {(size.height + by.top + by.bottom).toFixed(1)} mm
        </p>
        <label htmlFor="expand-prompt" className="text-[11px] font-medium text-[var(--text-dim)]">
          Prompt (optional)
        </label>
        <input
          id="expand-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Leave empty to continue the picture naturally"
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[12px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        <Actions>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={by.left + by.right + by.top + by.bottom <= 0}>
            <Icon name="sparkle" size={12} /> Expand
          </Button>
        </Actions>
      </form>
    </Modal>
  );
};

const VIEWS: { value: RefineView; label: string }[] = [
  { value: "overlay", label: "Overlay" },
  { value: "black", label: "On black" },
  { value: "white", label: "On white" },
  { value: "bw", label: "Black & white" },
  { value: "ants", label: "Marching ants" },
];

export type RefineOutput = "selection" | "mask" | "layer";

/**
 * Select and Mask. A floating panel rather than a modal, so the label stays
 * visible with the live preview drawn over it.
 */
export const SelectAndMaskPanel = ({
  session,
  canMatte,
  busy,
  hasLayer,
  onChange,
  onRefineHair,
  onCancel,
  onApply,
}: {
  session: RefineSession;
  /** The AI matting model is available. */
  canMatte: boolean;
  busy: boolean;
  /** A layer is selected (mask outputs need one). */
  hasLayer: boolean;
  onChange: (patch: { settings?: Partial<RefineUi>; view?: RefineView; opacity?: number }) => void;
  onRefineHair: () => void;
  onCancel: () => void;
  onApply: (output: RefineOutput) => void;
}) => {
  const [output, setOutput] = useState<RefineOutput>(hasLayer ? "mask" : "selection");
  const s = session.settings;
  return (
    <section
      role="dialog"
      aria-label="Select and Mask"
      className="absolute right-3 top-3 z-40 flex max-h-[calc(100%-1.5rem)] w-72 flex-col overflow-hidden rounded-[calc(var(--radius)+2px)] border border-[var(--border)] bg-[var(--surface)] shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2">
        <Icon name="refine" size={13} />
        <h2 className="text-[12px] font-semibold">Select and Mask</h2>
      </header>
      <div className="flex flex-col gap-3 overflow-y-auto p-3">
        <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--text-dim)]">
          View
          <select
            value={session.view}
            onChange={(e) => onChange({ view: e.target.value as RefineView })}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text)]"
          >
            {VIEWS.map((v) => (
              <option key={v.value} value={v.value}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        {session.view !== "ants" && session.view !== "bw" && (
          <Slider label="Opacity" value={session.opacity} min={0} max={100} suffix="%" onChange={(opacity) => onChange({ opacity })} />
        )}

        <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">Edge detection</h3>
        <Slider label="Radius" value={s.radiusMm} min={0} max={10} step={0.1} suffix=" mm" resetTo={0} onChange={(radiusMm) => onChange({ settings: { radiusMm } })} />
        <Toggle label="Fine detail (hair, fur)" checked={s.hair} onChange={(hair) => onChange({ settings: { hair } })} />
        <Button onClick={onRefineHair} disabled={busy} title={canMatte ? "AI matting model on the local server" : "Built-in hair filter (no AI matting model available)"}>
          <Icon name="sparkle" size={12} /> Refine hair
        </Button>

        <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">Global refinements</h3>
        <Slider label="Smooth" value={s.smoothMm} min={0} max={5} step={0.05} suffix=" mm" resetTo={0} onChange={(smoothMm) => onChange({ settings: { smoothMm } })} />
        <Slider label="Feather" value={s.featherMm} min={0} max={10} step={0.05} suffix=" mm" resetTo={0} onChange={(featherMm) => onChange({ settings: { featherMm } })} />
        <Slider label="Contrast" value={s.contrast} min={0} max={100} suffix="%" resetTo={0} onChange={(contrast) => onChange({ settings: { contrast } })} />
        <Slider label="Shift edge" value={s.shiftEdge} min={-100} max={100} suffix="%" resetTo={0} onChange={(shiftEdge) => onChange({ settings: { shiftEdge } })} />

        <label className="flex flex-col gap-1 text-[11px] font-medium text-[var(--text-dim)]">
          Output to
          <select
            value={output}
            onChange={(e) => setOutput(e.target.value as RefineOutput)}
            className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1 text-[11.5px] text-[var(--text)]"
          >
            <option value="selection">Selection</option>
            <option value="mask" disabled={!hasLayer}>
              Layer mask
            </option>
            <option value="layer" disabled={!hasLayer}>
              New layer with layer mask
            </option>
          </select>
        </label>
      </div>
      <footer className="flex justify-end gap-2 border-t border-[var(--border)] px-3 py-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button variant="primary" onClick={() => onApply(output)} disabled={busy}>
          OK
        </Button>
      </footer>
    </section>
  );
};
