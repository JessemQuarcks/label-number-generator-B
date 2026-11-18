import type { Alignment, AlignTarget, Distribution } from "../lib/align";
import { ALIGNMENTS, DISTRIBUTIONS } from "../lib/align";
import { Icon } from "./icons";
import type { IconName } from "./icons";
import { ToolButton } from "./controls";

const ALIGN_ICONS: Record<Alignment, IconName> = {
  left: "alignLeft",
  hcenter: "alignHCenter",
  right: "alignRight",
  top: "alignTop",
  vcenter: "alignVCenter",
  bottom: "alignBottom",
  center: "alignCenter",
};

const DISTRIBUTE_ICONS: Record<Distribution, IconName> = {
  horizontal: "distributeH",
  vertical: "distributeV",
};

export interface AlignControlsProps {
  count: number;
  target: AlignTarget;
  onTargetChange: (target: AlignTarget) => void;
  onAlign: (alignment: Alignment) => void;
  onDistribute: (direction: Distribution) => void;
  /** "bar" packs everything on one line; "panel" wraps for a narrow dock. */
  layout?: "bar" | "panel";
}

/**
 * Align buttons plus the "relative to" switch. With one layer selected the
 * label is the only sensible reference, so the switch locks to it.
 */
const AlignControls = ({
  count,
  target,
  onTargetChange,
  onAlign,
  onDistribute,
  layout = "bar",
}: AlignControlsProps) => {
  const effective: AlignTarget = count < 2 ? "canvas" : target;
  const disabled = count === 0;
  const suffix = effective === "canvas" ? " to the label" : " to the selection";

  const switcher = (
    <div
      role="group"
      aria-label="Align relative to"
      className="flex h-6 shrink-0 gap-0.5 rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
    >
      {(
        [
          { key: "selection", label: "Selection", title: "Align to the other selected layers" },
          { key: "canvas", label: "Label", title: "Align to the label edges" },
        ] as const
      ).map((option) => (
        <button
          key={option.key}
          type="button"
          title={
            option.key === "selection" && count < 2
              ? "Select two or more layers to align them to each other"
              : option.title
          }
          aria-pressed={effective === option.key}
          disabled={option.key === "selection" && count < 2}
          onClick={() => onTargetChange(option.key)}
          className={`rounded-[4px] px-1.5 text-[10.5px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            effective === option.key
              ? "bg-[var(--accent)] text-[var(--accent-text)]"
              : "text-[var(--text-dim)] hover:text-[var(--text)]"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const buttons = (
    <div role="group" aria-label="Align layers" className="flex flex-wrap items-center gap-0.5">
      {ALIGNMENTS.map((a, i) => (
        <span key={a.key} className="flex items-center">
          {(i === 3 || i === 6) && <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />}
          <ToolButton size="sm" title={`${a.label}${suffix}`} disabled={disabled} onClick={() => onAlign(a.key)}>
            <Icon name={ALIGN_ICONS[a.key]} />
          </ToolButton>
        </span>
      ))}
      <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border)]" />
      {DISTRIBUTIONS.map((d) => {
        // Spreading needs at least three layers between two edges, or two
        // when the label edges are the fixed ends.
        const can = effective === "canvas" ? count >= 2 : count >= 3;
        return (
          <ToolButton
            key={d.key}
            size="sm"
            title={can ? `${d.label}${suffix}` : `${d.label} (select ${effective === "canvas" ? 2 : 3}+ layers)`}
            disabled={!can}
            onClick={() => onDistribute(d.key)}
          >
            <Icon name={DISTRIBUTE_ICONS[d.key]} />
          </ToolButton>
        );
      })}
    </div>
  );

  if (layout === "panel") {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] font-medium text-[var(--text-dim)]">Relative to</span>
          {switcher}
        </div>
        {buttons}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] text-[var(--text-faint)]">Align</span>
      {switcher}
      {buttons}
    </div>
  );
};

export default AlignControls;
