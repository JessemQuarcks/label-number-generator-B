import type { LabelElement, Unit } from "../types";
import { usePointerMm } from "../lib/pointerStore";
import { fromMm, round } from "../lib/units";

const fmt = (mm: number, unit: Unit) => `${round(fromMm(mm, unit), unit === "cm" ? 2 : 1)}`;

/** Cursor position, selection size and zoom — read-outs, never controls. */
const StatusBar = ({
  hint,
  unit,
  selected,
  selectedCount,
  scale,
  previewNumber,
  missingFonts,
  onShowFonts,
}: {
  hint: string;
  unit: Unit;
  selected: LabelElement | null;
  selectedCount: number;
  scale: number;
  previewNumber: number;
  missingFonts: number;
  onShowFonts: () => void;
}) => {
  const pointer = usePointerMm();
  return (
    <footer className="flex h-6 shrink-0 items-center gap-4 border-t border-[var(--border)] bg-[var(--surface)] px-3 text-[10.5px] text-[var(--text-faint)]">
      <span className="min-w-0 flex-1 truncate" title={hint}>
        {hint}
      </span>
      {missingFonts > 0 && (
        <button
          type="button"
          onClick={onShowFonts}
          className="shrink-0 font-medium text-[var(--danger)] hover:underline"
          title="Show the Fonts panel"
        >
          ⚠ {missingFonts} font{missingFonts === 1 ? "" : "s"} missing
        </button>
      )}
      <span className="shrink-0 tabular-nums">
        {selectedCount > 1
          ? `${selectedCount} layers selected`
          : selected
            ? `${selected.name}: ${fmt(selected.width, unit)} × ${fmt(selected.height, unit)} ${unit}`
            : "No selection"}
      </span>
      <span className="w-28 shrink-0 tabular-nums">
        {pointer ? `X ${fmt(pointer.x, unit)}  Y ${fmt(pointer.y, unit)} ${unit}` : ""}
      </span>
      <span className="shrink-0">Previewing #{previewNumber}</span>
      <span className="w-10 shrink-0 text-right tabular-nums">{Math.round(scale * 100)}%</span>
    </footer>
  );
};

export default StatusBar;
