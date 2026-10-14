import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { ReactNode } from "react";
import { formatValue } from "../lib/units";

/**
 * Labels a single control. The control is rendered through a function so it can
 * receive the generated id: wrapping it in the <label> instead would fold the
 * hint text and the control's own value into its accessible name.
 */
export const Field = ({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: (props: { id: string; "aria-describedby"?: string }) => ReactNode;
}) => {
  const id = useId();
  const noteId = error || hint ? `${id}-note` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[11px] font-medium text-[var(--text-dim)]">
        {label}
      </label>
      {children({ id, "aria-describedby": noteId })}
      {error ? (
        <span id={noteId} role="alert" className="text-[11px] font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : hint ? (
        <span id={noteId} className="text-[11px] leading-snug text-[var(--text-faint)]">
          {hint}
        </span>
      ) : null}
    </div>
  );
};

export const inputClass =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] " +
  "px-2.5 py-1.5 text-xs text-[var(--text)] transition-colors " +
  "placeholder:text-[var(--text-faint)] " +
  "hover:border-[var(--border-strong)] " +
  "focus:border-[var(--accent)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-soft)] " +
  "aria-[invalid=true]:border-[var(--danger)] aria-[invalid=true]:ring-2 " +
  "aria-[invalid=true]:ring-[var(--danger-soft)]";

export interface NumberInputProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  /** Reject anything at or below this. Use `min: 0, allowMin: true` for offsets. */
  min?: number;
  max?: number;
  step?: number;
  /** When false (the default for sizes), `min` itself is rejected. */
  allowMin?: boolean;
  integer?: boolean;
  suffix?: string;
  hint?: string;
  /** Disable drag-to-scrub, for fields where sweeping values makes no sense. */
  noScrub?: boolean;
}

/**
 * A numeric input that keeps the user's raw keystrokes while they type but only
 * commits valid values upstream. Invalid entries show an inline error and leave
 * the last good value in place, so a design can never hold a non-positive size.
 *
 * The label doubles as a scrub handle: dragging it sideways sweeps the value,
 * which is far quicker than typing when nudging an element into place.
 */
export const NumberInput = ({
  label,
  value,
  onChange,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
  step = 0.1,
  allowMin = false,
  integer = false,
  suffix,
  hint,
  noScrub = false,
}: NumberInputProps) => {
  const [draft, setDraft] = useState(() => formatValue(value));
  const [error, setError] = useState<string | null>(null);
  const [scrubbing, setScrubbing] = useState(false);
  const id = useId();
  // The value as it stood when editing began. Typing "9000" into a field
  // capped at 5000 commits 9, 90 and 900 on the way, so a rejected entry must
  // revert to where the user started, not to the last digit prefix they typed.
  const valueAtFocus = useRef(value);

  // Re-sync when the value changes elsewhere (preset load, drag on canvas)
  // but never stomp on what the user is actively typing.
  useEffect(() => {
    if (error) return;
    if (Number.parseFloat(draft) === value) return;
    setDraft(formatValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const clampToRange = useCallback(
    (n: number) => {
      // When min is exclusive, the smallest legal value is one step above it,
      // so a size can never be clamped to zero.
      const lowest = allowMin ? min : min + (integer ? 1 : step);
      if (!Number.isFinite(n)) return lowest;
      return Math.min(Math.max(n, lowest), max);
    },
    [allowMin, min, max, step, integer]
  );

  const validate = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (trimmed === "") return "Required.";
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return "Enter a number.";
    if (integer && !Number.isInteger(parsed)) return "Whole numbers only.";
    if (allowMin ? parsed < min : parsed <= min) {
      return allowMin ? `Must be ${min} or more.` : `Must be greater than ${min}.`;
    }
    if (parsed > max) return `Must be ${max} or less.`;
    return null;
  };

  const handleChange = (raw: string) => {
    setDraft(raw);
    const problem = validate(raw);
    setError(problem);
    if (!problem) onChange(Number(raw.trim()));
  };

  /** Drag the label horizontally to sweep the value. */
  const startScrub = (event: React.PointerEvent) => {
    if (noScrub) return;
    event.preventDefault();
    const startX = Number.isFinite(event.clientX) ? event.clientX : 0;
    const startValue = value;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture?.(event.pointerId);
    setScrubbing(true);

    const move = (e: PointerEvent) => {
      // Fine control with Shift, coarse with Alt.
      const perPixel = e.shiftKey ? step / 10 : e.altKey ? step * 10 : step;
      const x = Number.isFinite(e.clientX) ? e.clientX : startX;
      const raw = startValue + (x - startX) * perPixel;
      // A non-finite result would otherwise reach the design as NaN and
      // render the label unusable, so fall back to the value we started from.
      const next = clampToRange(
        Number.isFinite(raw) ? (integer ? Math.round(raw) : Number(raw.toFixed(3))) : startValue
      );
      setDraft(formatValue(next));
      setError(null);
      onChange(next);
    };
    const end = () => {
      setScrubbing(false);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <label
        htmlFor={id}
        onPointerDown={startScrub}
        title={noScrub ? undefined : "Drag to adjust · Shift for fine, Alt for coarse"}
        className={`flex items-center justify-between text-[11px] font-medium text-[var(--text-dim)] ${
          noScrub ? "" : "cursor-ew-resize select-none hover:text-[var(--accent)]"
        } ${scrubbing ? "text-[var(--accent)]" : ""}`}
      >
        <span>{label}</span>
        {suffix ? <span className="text-[var(--text-faint)]">{suffix}</span> : null}
      </label>
      <input
        id={id}
        type="number"
        className={inputClass}
        value={draft}
        step={step}
        onChange={(e) => handleChange(e.target.value)}
        onFocus={() => {
          valueAtFocus.current = value;
        }}
        onBlur={() => {
          // Snap a rejected entry back to where this edit started.
          if (error) {
            const restored = valueAtFocus.current;
            setDraft(formatValue(restored));
            setError(null);
            if (restored !== value) onChange(restored);
          }
        }}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <span id={`${id}-error`} role="alert" className="text-[11px] font-medium text-[var(--danger)]">
          {error}
        </span>
      ) : hint ? (
        <span className="text-[11px] leading-snug text-[var(--text-faint)]">{hint}</span>
      ) : null}
    </div>
  );
};

export const TextInput = ({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  hint?: string;
}) => (
  <Field label={label} hint={hint}>
    {(props) => (
      <input
        {...props}
        type="text"
        className={inputClass}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </Field>
);

export const TextArea = ({
  label,
  value,
  onChange,
  rows = 4,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  hint?: string;
}) => (
  <Field label={label} hint={hint}>
    {(props) => (
      <textarea
        {...props}
        className={`${inputClass} resize-y leading-relaxed`}
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </Field>
);

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  value: T;
  options: { label: string; value: T }[];
  onChange: (value: T) => void;
  hint?: string;
}) {
  const isNumeric = typeof value === "number";
  return (
    <Field label={label} hint={hint}>
      {(props) => (
        <select
          {...props}
          className={`${inputClass} cursor-pointer appearance-none bg-[length:9px] bg-[right_0.6rem_center] bg-no-repeat pr-7`}
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%239aa4b2' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E\")",
          }}
          value={String(value)}
          onChange={(e) =>
            onChange((isNumeric ? Number(e.target.value) : e.target.value) as T)
          }
        >
          {options.map((option) => (
            <option key={String(option.value)} value={String(option.value)}>
              {option.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export const ColorInput = ({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) => (
  <Field label={label}>
    {(props) => (
      <div
        className={`flex items-center gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 transition-colors hover:border-[var(--border-strong)] focus-within:border-[var(--accent)] focus-within:ring-2 focus-within:ring-[var(--accent-soft)]`}
      >
        <input
          type="color"
          aria-label={`${label} swatch`}
          className="h-5 w-7 shrink-0"
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          {...props}
          type="text"
          spellCheck={false}
          className="w-full bg-transparent font-mono text-xs uppercase text-[var(--text)] outline-none"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    )}
  </Field>
);

export const Toggle = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onChange(!checked)}
    className="flex items-center gap-2.5 text-[11px] font-medium text-[var(--text-dim)] transition-colors hover:text-[var(--text)]"
  >
    <span
      aria-hidden="true"
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors ${
        checked ? "bg-[var(--accent)]" : "bg-[var(--surface-3)]"
      }`}
    >
      <span
        className={`absolute top-[3px] h-3 w-3 rounded-full bg-white transition-all ${
          checked ? "left-[17px]" : "left-[3px]"
        }`}
      />
    </span>
    {label}
  </button>
);

/**
 * A row of mutually exclusive choices. Faster to hit than a select when there
 * are only a few options, and it shows the alternatives without opening.
 */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T; title?: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-[var(--text-dim)]">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="flex gap-0.5 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
      >
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              title={option.title ?? option.label}
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`flex-1 rounded-[5px] px-1.5 py-1 text-[11px] font-medium transition-colors ${
                active
                  ? "bg-[var(--accent)] text-[var(--accent-text)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A collapsible panel section. Collapsing keeps the inspector scannable. */
export const Section = ({
  title,
  children,
  actions,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string;
  children: ReactNode;
  actions?: ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const isOpen = collapsible ? open : true;

  return (
    <section className="border-b border-[var(--border)] last:border-b-0">
      <header className="flex items-center justify-between gap-2 px-3.5 pt-3.5 pb-2">
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={isOpen}
            className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)] transition-colors hover:text-[var(--text-dim)]"
          >
            <span
              aria-hidden="true"
              className={`transition-transform ${isOpen ? "rotate-90" : ""}`}
            >
              ›
            </span>
            {title}
          </button>
        ) : (
          <h3 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
            {title}
          </h3>
        )}
        {actions}
      </header>
      {isOpen && <div className="flex flex-col gap-3 px-3.5 pb-3.5">{children}</div>}
    </section>
  );
};

export const Button = ({
  children,
  onClick,
  variant = "default",
  title,
  disabled,
  type = "button",
  full = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "danger" | "ghost";
  title?: string;
  disabled?: boolean;
  type?: "button" | "submit";
  full?: boolean;
}) => {
  const variants = {
    default:
      "border-[var(--border)] bg-[var(--surface-2)] text-[var(--text)] hover:border-[var(--border-strong)] hover:bg-[var(--surface-3)]",
    primary:
      "border-transparent bg-[var(--accent)] text-[var(--accent-text)] hover:brightness-110",
    danger:
      "border-transparent bg-transparent text-[var(--danger)] hover:bg-[var(--danger-soft)]",
    ghost:
      "border-transparent bg-transparent text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]",
  };
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius)] border px-2.5 py-1.5 text-[11px] font-medium transition-all disabled:cursor-not-allowed disabled:opacity-35 ${variants[variant]} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
};

/** A small square button for icon-only actions in dense toolbars. */
export const IconButton = ({
  children,
  onClick,
  title,
  disabled,
  danger = false,
}: {
  children: ReactNode;
  onClick?: () => void;
  title: string;
  disabled?: boolean;
  danger?: boolean;
}) => (
  <button
    type="button"
    title={title}
    aria-label={title}
    disabled={disabled}
    onClick={onClick}
    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-30 ${
      danger
        ? "text-[var(--text-faint)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
        : "text-[var(--text-faint)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
    }`}
  >
    {children}
  </button>
);
