import { useState } from "react";
import type { LabelElement } from "../types";
import type { AiApi } from "../lib/ai/useAi";
import { Icon } from "./icons";
import type { IconName } from "./icons";

const Action = ({
  icon,
  label,
  onClick,
  disabled,
  title,
  primary,
}: {
  icon?: IconName;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title ?? label}
    className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-[11px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
      primary
        ? "bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110"
        : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
    }`}
  >
    {icon && <Icon name={icon} size={13} />}
    {label}
  </button>
);

export interface TaskBarProps {
  ai: AiApi;
  hasSelection: boolean;
  /** Something is computing a selection right now. */
  busy: string | null;
  selected: LabelElement | null;
  onFill: (prompt: string) => void;
  onRemove: () => void;
  onRefine: () => void;
  onInvert: () => void;
  onMask: () => void;
  onDeselect: () => void;
  onSelectSubject: () => void;
  onRemoveBackground: () => void;
  onSimilar: () => void;
  onExpand: () => void;
}

/**
 * The contextual task bar under the label: the next likely steps for what
 * is selected — a pixel selection, or an image layer — one click away.
 */
const TaskBar = ({
  ai,
  hasSelection,
  busy,
  selected,
  onFill,
  onRemove,
  onRefine,
  onInvert,
  onMask,
  onDeselect,
  onSelectSubject,
  onRemoveBackground,
  onSimilar,
  onExpand,
}: TaskBarProps) => {
  const [prompt, setPrompt] = useState("");
  const [prompting, setPrompting] = useState(false);
  const job = ai.job;
  const pixelLayer = selected && (selected.type === "image" || selected.type === "raster") ? selected : null;

  let body: JSX.Element | null = null;
  if (job || busy) {
    const pct = job?.progress.fraction;
    body = (
      <div role="status" className="flex min-w-[16rem] items-center gap-2 px-2">
        <span aria-hidden="true" className="ai-spinner" />
        <span className="text-[11px] font-medium text-[var(--text)]">{job?.label ?? busy}…</span>
        {pct !== null && pct !== undefined && (
          <span className="text-[11px] tabular-nums text-[var(--text-faint)]">{Math.round(pct * 100)}%</span>
        )}
        {job?.progress.message && <span className="max-w-[14rem] truncate text-[10.5px] text-[var(--text-faint)]">{job.progress.message}</span>}
        {job && <Action label="Cancel" onClick={ai.cancel} />}
      </div>
    );
  } else if (hasSelection && prompting) {
    body = (
      <form
        className="flex items-center gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          onFill(prompt);
          setPrompting(false);
        }}
      >
        <input
          autoFocus
          aria-label="Generative fill prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), setPrompting(false))}
          placeholder="Describe what to add (optional)"
          className="h-7 w-64 rounded-[6px] border border-[var(--border)] bg-[var(--surface-2)] px-2 text-[11.5px] text-[var(--text)] focus:border-[var(--accent)] focus:outline-none"
        />
        <button
          type="submit"
          className="inline-flex h-7 items-center gap-1.5 rounded-[6px] bg-[var(--accent)] px-2.5 text-[11px] font-medium text-[var(--accent-text)] hover:brightness-110"
        >
          <Icon name="sparkle" size={12} /> Generate
        </button>
        <Action label="Back" onClick={() => setPrompting(false)} />
      </form>
    );
  } else if (hasSelection) {
    const canFill = ai.can("inpaint") || ai.can("remove");
    body = (
      <>
        <Action
          primary
          icon="sparkle"
          label="Generative fill"
          onClick={() => setPrompting(true)}
          disabled={!canFill}
          title={canFill ? "Fill the selection from a prompt" : "Needs the local AI server — see the Generative AI panel"}
        />
        <Action icon="remove" label="Remove" onClick={onRemove} disabled={!canFill} title="Remove what is selected (AI, no prompt)" />
        <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
        <Action icon="refine" label="Select and Mask" onClick={onRefine} />
        <Action icon="invertSelection" label="Invert" onClick={onInvert} />
        <Action icon="mask" label="Mask" onClick={onMask} disabled={!selected} title="Add a layer mask from the selection" />
        <Action icon="deselect" label="Deselect" onClick={onDeselect} />
      </>
    );
  } else if (pixelLayer) {
    const can = ai.can("subject");
    body = (
      <>
        <Action icon="subject" label="Select subject" onClick={onSelectSubject} disabled={!can} />
        <Action icon="mask" label="Remove background" onClick={onRemoveBackground} disabled={!can} />
        <Action icon="sparkle" label="Generate similar" onClick={onSimilar} disabled={!ai.can("variations")} />
        {pixelLayer.type === "image" && (
          <Action icon="expand" label="Expand" onClick={onExpand} disabled={!ai.can("inpaint") && !ai.can("remove")} />
        )}
      </>
    );
  }

  if (!body) return null;
  return (
    <div
      role="toolbar"
      aria-label="Contextual task bar"
      className="pointer-events-auto absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] p-1 shadow-2xl"
    >
      {body}
    </div>
  );
};

export default TaskBar;
