import type { FontWarning } from "../lib/fontAvailability";

interface FontWarningsProps {
  warnings: FontWarning[];
}

/**
 * Surfaces families the machine cannot render. A substitution is silent by
 * nature — nothing flashes, the text just has different metrics — so it needs
 * to be stated plainly before a run is committed to paper.
 */
const FontWarnings = ({ warnings }: FontWarningsProps) => {
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--danger)] bg-[var(--danger-soft)] px-2.5 py-2"
    >
      <p className="flex items-start gap-1.5 text-[11px] font-semibold text-[var(--danger)]">
        <span aria-hidden="true">⚠</span>
        {warnings.length === 1
          ? "1 font is not installed here"
          : `${warnings.length} fonts are not installed here`}
      </p>

      <ul className="flex flex-col gap-1.5">
        {warnings.map((warning) => (
          <li key={warning.stack} className="text-[11px] leading-snug">
            <span className="font-medium text-[var(--text)]">{warning.requested}</span>
            <span className="text-[var(--text-dim)]">
              {warning.substitute ? (
                <> → printing as {warning.substitute}</>
              ) : (
                <> → printing in a system default</>
              )}
            </span>
            <span className="mt-0.5 block text-[var(--text-faint)]">
              {warning.elements.length === 1
                ? warning.elements[0]
                : `${warning.elements.length} elements`}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] leading-snug text-[var(--text-faint)]">
        Substituted text has different widths, so lines may wrap differently.
        Upload the font above to make it travel with the design.
      </p>
    </div>
  );
};

export default FontWarnings;
