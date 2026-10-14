import type {
  Border,
  LabelDesign,
  LabelElement,
  Typography,
  Unit,
} from "../types";
import {
  ColorInput,
  IconButton,
  NumberInput,
  Section,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  Toggle,
} from "./controls";
import { FONT_OPTIONS, FONT_WEIGHTS } from "../lib/fonts";
import { fromMm, round, stepFor, toMm } from "../lib/units";
import { isFamilyAvailable, splitStack } from "../lib/fontAvailability";
import { MAX_SIZE_MM } from "../lib/storage";

/** A size input that displays in the design's unit but stores millimetres. */
const SizeInput = ({
  label,
  mmValue,
  unit,
  onChange,
  allowMin = false,
  min = 0,
  hint,
}: {
  label: string;
  mmValue: number;
  unit: Unit;
  onChange: (mm: number) => void;
  /** true for offsets (0 and negatives allowed), false for sizes. */
  allowMin?: boolean;
  min?: number;
  hint?: string;
}) => (
  <NumberInput
    label={label}
    suffix={unit}
    value={round(fromMm(mmValue, unit), 3)}
    min={allowMin ? min : fromMm(0, unit)}
    max={fromMm(MAX_SIZE_MM, unit)}
    step={stepFor(unit)}
    allowMin={allowMin}
    hint={hint}
    onChange={(value) => onChange(round(toMm(value, unit), 4))}
  />
);

const BORDER_STYLE_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Solid", value: "solid" },
  { label: "Dashed", value: "dashed" },
  { label: "Dotted", value: "dotted" },
  { label: "Double", value: "double" },
  { label: "Groove", value: "groove" },
  { label: "Ridge", value: "ridge" },
] as const;

const BorderEditor = ({
  border,
  unit,
  onChange,
}: {
  border: Border;
  unit: Unit;
  onChange: (patch: Partial<Border>) => void;
}) => (
  <>
    <Select
      label="Border style"
      value={border.style}
      options={BORDER_STYLE_OPTIONS.map((o) => ({ ...o }))}
      onChange={(style) => onChange({ style })}
    />
    {border.style !== "none" && (
      <>
        <div className="grid grid-cols-2 gap-2">
          <SizeInput
            label="Thickness"
            mmValue={border.width}
            unit={unit}
            allowMin
            onChange={(width) => onChange({ width })}
          />
          <SizeInput
            label="Radius"
            mmValue={border.radius}
            unit={unit}
            allowMin
            onChange={(radius) => onChange({ radius })}
          />
        </div>
        <ColorInput
          label="Border colour"
          value={border.color}
          onChange={(color) => onChange({ color })}
        />
      </>
    )}
  </>
);

const TypographyEditor = ({
  typography,
  fontOptions,
  missingFamily,
  onChange,
}: {
  typography: Typography;
  fontOptions: { label: string; value: string }[];
  /** Set when this element's first-choice family is absent on this machine. */
  missingFamily: string | null;
  onChange: (patch: Partial<Typography>) => void;
}) => (
  <>
    <Select
      label="Font"
      value={typography.fontFamily}
      options={fontOptions}
      onChange={(fontFamily) => onChange({ fontFamily })}
    />
    {missingFamily && (
      <p
        role="status"
        className="-mt-1.5 flex items-start gap-1.5 text-[11px] leading-snug text-[var(--danger)]"
      >
        <span aria-hidden="true">⚠</span>
        <span>
          <strong className="font-semibold">{missingFamily}</strong> is not
          installed here — this text prints in a substitute with different
          widths.
        </span>
      </p>
    )}
    <div className="grid grid-cols-2 gap-2">
      <NumberInput
        label="Size"
        suffix="pt"
        value={typography.fontSize}
        min={0}
        max={400}
        step={0.5}
        onChange={(fontSize) => onChange({ fontSize })}
      />
      <Select
        label="Weight"
        value={typography.fontWeight}
        options={FONT_WEIGHTS}
        onChange={(fontWeight) => onChange({ fontWeight })}
      />
    </div>
    <ColorInput
      label="Text colour"
      value={typography.color}
      onChange={(color) => onChange({ color })}
    />
    <SegmentedControl
      label="Align"
      value={typography.align}
      options={[
        { label: "⌐", value: "left" as const, title: "Left" },
        { label: "≡", value: "center" as const, title: "Centre" },
        { label: "¬", value: "right" as const, title: "Right" },
        { label: "☰", value: "justify" as const, title: "Justify" },
      ]}
      onChange={(align) => onChange({ align })}
    />
    <SegmentedControl
      label="Vertical align"
      value={typography.verticalAlign}
      options={[
        { label: "Top", value: "top" as const },
        { label: "Middle", value: "middle" as const },
        { label: "Bottom", value: "bottom" as const },
      ]}
      onChange={(verticalAlign) => onChange({ verticalAlign })}
    />
    <div className="flex gap-5">
      <Toggle
        label="Italic"
        checked={typography.italic}
        onChange={(italic) => onChange({ italic })}
      />
      <Toggle
        label="Underline"
        checked={typography.underline}
        onChange={(underline) => onChange({ underline })}
      />
    </div>
    <div className="grid grid-cols-2 gap-2">
      <NumberInput
        label="Tracking"
        suffix="pt"
        value={typography.letterSpacing}
        min={-50}
        max={100}
        step={0.1}
        allowMin
        onChange={(letterSpacing) => onChange({ letterSpacing })}
      />
      <NumberInput
        label="Line height"
        suffix="×"
        value={typography.lineHeight}
        min={0}
        max={10}
        step={0.05}
        onChange={(lineHeight) => onChange({ lineHeight })}
      />
    </div>
    <Select
      label="Capitalisation"
      value={typography.textTransform}
      options={[
        { label: "As typed", value: "none" as const },
        { label: "UPPERCASE", value: "uppercase" as const },
        { label: "lowercase", value: "lowercase" as const },
        { label: "Capitalise", value: "capitalize" as const },
      ]}
      onChange={(textTransform) => onChange({ textTransform })}
    />
  </>
);

export interface InspectorProps {
  design: LabelDesign;
  selected: LabelElement | null;
  onDesignChange: (patch: Partial<LabelDesign>) => void;
  onElementChange: (id: string, patch: Partial<LabelElement>) => void;
  onDeleteElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  onReorderElement: (id: string, direction: -1 | 1) => void;
}

const Inspector = ({
  design,
  selected,
  onDesignChange,
  onElementChange,
  onDeleteElement,
  onDuplicateElement,
  onReorderElement,
}: InspectorProps) => {
  const unit = design.unit;

  // Uploaded families are offered above the built-in stacks, so a font that
  // travels with the design is the easiest one to pick.
  const custom = design.fonts ?? [];
  const fontOptions = [
    ...custom.map((font) => ({
      label: `${font.family} (uploaded)`,
      value: `"${font.family}", sans-serif`,
    })),
    ...FONT_OPTIONS,
  ];

  // The selected element's own first-choice family, if this machine lacks it.
  const missingFamily = (() => {
    if (!selected || (selected.type !== "text" && selected.type !== "number")) {
      return null;
    }
    const [requested] = splitStack(selected.typography.fontFamily);
    if (!requested) return null;
    const isUploaded = custom.some(
      (f) => f.family.trim().toLowerCase() === requested.toLowerCase()
    );
    if (isUploaded || isFamilyAvailable(requested)) return null;
    return requested;
  })();

  const patchTypography = (patch: Partial<Typography>) => {
    if (!selected || (selected.type !== "text" && selected.type !== "number")) return;
    onElementChange(selected.id, {
      typography: { ...selected.typography, ...patch },
    } as Partial<LabelElement>);
  };

  return (
    <aside className="flex w-[19rem] shrink-0 flex-col overflow-y-auto border-l border-[var(--border)] bg-[var(--surface)]">
      <Section title="Label" collapsible>
        <TextInput
          label="Design name"
          value={design.name}
          onChange={(name) => onDesignChange({ name })}
        />
        <SegmentedControl
          label="Unit"
          value={unit}
          options={[
            { label: "Millimetres", value: "mm" as const },
            { label: "Centimetres", value: "cm" as const },
          ]}
          onChange={(next) => onDesignChange({ unit: next })}
        />
        <div className="grid grid-cols-2 gap-2">
          <SizeInput
            label="Width"
            mmValue={design.width}
            unit={unit}
            onChange={(width) => onDesignChange({ width })}
          />
          <SizeInput
            label="Height"
            mmValue={design.height}
            unit={unit}
            onChange={(height) => onDesignChange({ height })}
          />
        </div>
        <ColorInput
          label="Background"
          value={design.background}
          onChange={(background) => onDesignChange({ background })}
        />
        <BorderEditor
          border={design.border}
          unit={unit}
          onChange={(patch) => onDesignChange({ border: { ...design.border, ...patch } })}
        />
      </Section>

      {!selected ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <span aria-hidden="true" className="text-2xl opacity-25">
            ◇
          </span>
          <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
            Select an element on the canvas or in the layer list to edit it.
          </p>
        </div>
      ) : (
        <>
          <Section
            title="Position & size"
            actions={
              <div className="flex items-center">
                <IconButton
                  title="Duplicate element"
                  onClick={() => onDuplicateElement(selected.id)}
                >
                  ⧉
                </IconButton>
                <IconButton
                  title="Move forward"
                  onClick={() => onReorderElement(selected.id, 1)}
                >
                  ↑
                </IconButton>
                <IconButton
                  title="Move backward"
                  onClick={() => onReorderElement(selected.id, -1)}
                >
                  ↓
                </IconButton>
                <IconButton
                  danger
                  title="Delete element"
                  onClick={() => onDeleteElement(selected.id)}
                >
                  ✕
                </IconButton>
              </div>
            }
          >
            <TextInput
              label="Name"
              value={selected.name}
              onChange={(name) => onElementChange(selected.id, { name })}
            />
            <div className="grid grid-cols-2 gap-2">
              <SizeInput
                label="X"
                mmValue={selected.x}
                unit={unit}
                allowMin
                min={-fromMm(MAX_SIZE_MM, unit)}
                onChange={(x) => onElementChange(selected.id, { x })}
              />
              <SizeInput
                label="Y"
                mmValue={selected.y}
                unit={unit}
                allowMin
                min={-fromMm(MAX_SIZE_MM, unit)}
                onChange={(y) => onElementChange(selected.id, { y })}
              />
              <SizeInput
                label="Width"
                mmValue={selected.width}
                unit={unit}
                onChange={(width) => onElementChange(selected.id, { width })}
              />
              <SizeInput
                label="Height"
                mmValue={selected.height}
                unit={unit}
                onChange={(height) => onElementChange(selected.id, { height })}
              />
            </div>
            <NumberInput
              label="Rotation"
              suffix="°"
              value={selected.rotation}
              min={-360}
              max={360}
              step={1}
              allowMin
              onChange={(rotation) => onElementChange(selected.id, { rotation })}
            />
            <Toggle
              label="Visible"
              checked={selected.visible}
              onChange={(visible) => onElementChange(selected.id, { visible })}
            />
          </Section>

          {selected.type === "text" && (
            <Section title="Text">
              <TextArea
                label="Content"
                value={selected.text}
                hint="Line breaks are preserved."
                onChange={(text) => onElementChange(selected.id, { text })}
              />
              <TypographyEditor
                typography={selected.typography}
                fontOptions={fontOptions}
                missingFamily={missingFamily}
                onChange={patchTypography}
              />
            </Section>
          )}

          {selected.type === "number" && (
            <Section title="Serial number">
              <div className="grid grid-cols-2 gap-2">
                <TextInput
                  label="Prefix"
                  value={selected.prefix}
                  placeholder="GH"
                  onChange={(prefix) => onElementChange(selected.id, { prefix })}
                />
                <TextInput
                  label="Suffix"
                  value={selected.suffix}
                  onChange={(suffix) => onElementChange(selected.id, { suffix })}
                />
              </div>
              <NumberInput
                label="Pad to digits"
                value={selected.padTo}
                min={0}
                max={12}
                step={1}
                integer
                allowMin
                hint="3 renders label 7 as 007."
                onChange={(padTo) => onElementChange(selected.id, { padTo })}
              />
              <TypographyEditor
                typography={selected.typography}
                fontOptions={fontOptions}
                missingFamily={missingFamily}
                onChange={patchTypography}
              />
            </Section>
          )}

          {selected.type === "image" && (
            <Section title="Image">
              <TextInput
                label="Source"
                value={selected.src}
                placeholder="my-artwork.jpg"
                hint="A file in /public, a URL, or upload below."
                onChange={(src) => onElementChange(selected.id, { src })}
              />
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium text-[var(--text-dim)]">
                  Upload
                </span>
                <label className="flex cursor-pointer items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-[var(--border-strong)] px-3 py-3 text-[11px] text-[var(--text-dim)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]">
                  <span aria-hidden="true">↥</span>
                  Choose an image
                  <input
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      const reader = new FileReader();
                      reader.onload = () => {
                        if (typeof reader.result === "string") {
                          onElementChange(selected.id, { src: reader.result });
                        }
                      };
                      reader.readAsDataURL(file);
                      event.target.value = "";
                    }}
                  />
                </label>
                <span className="text-[11px] leading-snug text-[var(--text-faint)]">
                  Embedded in the design, so it survives reloads and exports.
                </span>
              </div>
              <SegmentedControl
                label="Fit"
                value={selected.fit}
                options={[
                  { label: "Contain", value: "contain" as const, title: "Show the whole image" },
                  { label: "Cover", value: "cover" as const, title: "Fill the box, cropping" },
                  { label: "Stretch", value: "fill" as const, title: "Stretch to the box" },
                ]}
                onChange={(fit) => onElementChange(selected.id, { fit })}
              />
            </Section>
          )}

          {selected.type === "shape" && (
            <Section title="Shape">
              <ColorInput
                label="Fill"
                value={selected.fill}
                onChange={(fill) => onElementChange(selected.id, { fill })}
              />
              <BorderEditor
                border={selected.border}
                unit={unit}
                onChange={(patch) =>
                  onElementChange(selected.id, {
                    border: { ...selected.border, ...patch },
                  } as Partial<LabelElement>)
                }
              />
            </Section>
          )}
        </>
      )}
    </aside>
  );
};

export default Inspector;
