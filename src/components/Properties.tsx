import { useEffect, useRef } from "react";
import type { ReactNode } from "react";
import type {
  Border,
  LabelDesign,
  LabelElement,
  LayerGroup,
  ShapeKind,
  Typography,
  Unit,
} from "../types";
import {
  Button,
  ColorInput,
  Disclosure,
  NumberInput,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  TextInput,
  Toggle,
  ToolButton,
} from "./controls";
import { Icon } from "./icons";
import type { CategoryId } from "../lib/properties";
import { categoriesFor, kindOf } from "../lib/properties";
import AlignControls from "./AlignControls";
import type { AlignControlsProps } from "./AlignControls";
import { FONT_OPTIONS, FONT_WEIGHTS } from "../lib/fonts";
import { fromMm, round, stepFor, toMm } from "../lib/units";
import { isFamilyAvailable, splitStack } from "../lib/fontAvailability";
import { MAX_SIZE_MM } from "../lib/storage";
import { isCropped } from "../lib/imageEdit";
import { supportsEffects } from "../lib/effects";
import { DEFAULT_INNER_RADIUS, DEFAULT_SIDES, SHAPE_ICONS, SHAPES } from "../lib/shapes";
import EffectsEditor from "./EffectsEditor";
import type { EffectsEditorProps } from "./EffectsEditor";

/* -------------------------------------------------------------------------
 * Shared field groups
 * ---------------------------------------------------------------------- */

/** A size input that displays in the design's unit but stores millimetres. */
export const SizeInput = ({
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

const CharacterFields = ({
  typography,
  fontOptions,
  onChange,
}: {
  typography: Typography;
  fontOptions: { label: string; value: string }[];
  onChange: (patch: Partial<Typography>) => void;
}) => (
  <>
    <Select
      label="Font"
      value={typography.fontFamily}
      options={
        fontOptions.some((o) => o.value === typography.fontFamily)
          ? fontOptions
          : [{ label: splitStack(typography.fontFamily)[0] ?? "Custom", value: typography.fontFamily }, ...fontOptions]
      }
      onChange={(fontFamily) => onChange({ fontFamily })}
    />
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
    <Disclosure>
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
    </Disclosure>
  </>
);

const ParagraphFields = ({
  typography,
  onChange,
}: {
  typography: Typography;
  onChange: (patch: Partial<Typography>) => void;
}) => (
  <>
    <SegmentedControl
      label="Align"
      value={typography.align}
      options={[
        { label: "Left", value: "left" as const, title: "Align left" },
        { label: "Centre", value: "center" as const, title: "Centre" },
        { label: "Right", value: "right" as const, title: "Align right" },
        { label: "Justify", value: "justify" as const, title: "Justify" },
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
    <NumberInput
      label="Line height"
      suffix="×"
      value={typography.lineHeight}
      min={0}
      max={10}
      step={0.05}
      onChange={(lineHeight) => onChange({ lineHeight })}
    />
  </>
);

/* -------------------------------------------------------------------------
 * Panel
 * ---------------------------------------------------------------------- */

export interface PropertiesProps {
  design: LabelDesign;
  /** The primary selection, or null. */
  selected: LabelElement | null;
  selectedCount: number;
  category: CategoryId;
  onCategoryChange: (category: CategoryId) => void;
  onDesignChange: (patch: Partial<LabelDesign>) => void;
  onElementChange: (id: string, patch: Partial<LabelElement>) => void;
  onDeleteElement: (id: string) => void;
  onDuplicateElement: (id: string) => void;
  onReorderElement: (id: string, direction: -1 | 1) => void;
  onArrange: (to: "front" | "back") => void;
  align: Omit<AlignControlsProps, "layout" | "count">;
  onReplaceImage: (id: string) => void;
  onStartCrop: (id: string) => void;
  onClearCrop: (id: string) => void;
  /** Bumped to focus the text content field, e.g. after placing new text. */
  focusContentNonce?: number;
  /** The selected group, when the primary selection is a group. */
  selectedGroup: LayerGroup | null;
  groupMemberCount: number;
  onGroupChange: (id: string, patch: Partial<LayerGroup>) => void;
  onUngroup: (id: string) => void;
  onDeleteGroup: (id: string) => void;
  onDuplicateGroup: (id: string) => void;
  /** Effect stack actions for the selected layer. */
  effects: Omit<EffectsEditorProps, "layerName" | "effects">;
}

/** A fill colour with an explicit "No fill" choice (transparent, stroke stays). */
export const FillInput = ({ value, onChange }: { value: string; onChange: (fill: string) => void }) => {
  const none = value === "none";
  return (
    <div className="flex flex-col gap-2">
      <Toggle
        label="No fill (transparent)"
        checked={none}
        onChange={(on) => onChange(on ? "none" : "#e5e7eb")}
      />
      {!none && <ColorInput label="Fill colour" value={value} onChange={onChange} />}
      {none && (
        <p className="text-[11px] leading-snug text-[var(--text-faint)]">
          The shape is see-through; its stroke still shows. Add one under Stroke.
        </p>
      )}
    </div>
  );
};

const Group = ({ title, children }: { title?: string; children: ReactNode }) => (
  <div className="flex flex-col gap-3">
    {title && (
      <h4 className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[var(--text-faint)]">
        {title}
      </h4>
    )}
    {children}
  </div>
);

const Properties = ({
  design,
  selected,
  selectedCount,
  category,
  onCategoryChange,
  onDesignChange,
  onElementChange,
  onDeleteElement,
  onDuplicateElement,
  onReorderElement,
  onArrange,
  align,
  onReplaceImage,
  onStartCrop,
  onClearCrop,
  focusContentNonce,
  selectedGroup,
  groupMemberCount,
  onGroupChange,
  onUngroup,
  onDeleteGroup,
  onDuplicateGroup,
  effects: fx,
}: PropertiesProps) => {
  const unit = design.unit;
  const kind = kindOf(selectedCount, selected, !!selectedGroup);
  const categories = categoriesFor(kind);
  const contentRef = useRef<HTMLDivElement>(null);

  // Focus the content box when asked — placing a text layer drops the
  // cursor straight into it, so typing is the next thing that happens.
  useEffect(() => {
    if (!focusContentNonce) return;
    const box = contentRef.current?.querySelector("textarea");
    if (box) {
      box.focus();
      box.select();
    }
  }, [focusContentNonce, category]);

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
    if (!selected || (selected.type !== "text" && selected.type !== "number")) return null;
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

  const body = (): ReactNode => {
    if (kind === "document") {
      switch (category) {
        case "document":
          return (
            <Group>
              <TextInput
                label="Design name"
                value={design.name}
                onChange={(name) => onDesignChange({ name })}
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
              <SegmentedControl
                label="Unit"
                value={unit}
                options={[
                  { label: "Millimetres", value: "mm" as const },
                  { label: "Centimetres", value: "cm" as const },
                ]}
                onChange={(next) => onDesignChange({ unit: next })}
              />
            </Group>
          );
        case "background":
          return (
            <ColorInput
              label="Background"
              value={design.background}
              onChange={(background) => onDesignChange({ background })}
            />
          );
        case "docBorder":
          return (
            <BorderEditor
              border={design.border}
              unit={unit}
              onChange={(patch) => onDesignChange({ border: { ...design.border, ...patch } })}
            />
          );
        default:
          return null;
      }
    }

    if (kind === "group" && selectedGroup && category === "group") {
      return (
        <Group>
          <TextInput
            label="Group name"
            value={selectedGroup.name}
            onChange={(name) => onGroupChange(selectedGroup.id, { name })}
          />
          <Toggle
            label="Visible"
            checked={selectedGroup.visible}
            onChange={(visible) => onGroupChange(selectedGroup.id, { visible })}
          />
          <p className="text-[11px] leading-snug text-[var(--text-dim)]">
            {groupMemberCount} layer{groupMemberCount === 1 ? "" : "s"} inside. Moving, aligning,
            scaling, hiding, duplicating and deleting act on the whole group.
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            <Button onClick={() => onUngroup(selectedGroup.id)}>Ungroup</Button>
            <Button onClick={() => onDuplicateGroup(selectedGroup.id)}>Duplicate</Button>
          </div>
          <Button variant="danger" onClick={() => onDeleteGroup(selectedGroup.id)}>
            Delete group and contents
          </Button>
        </Group>
      );
    }

    if (kind === "multi" || kind === "group" || category === "arrange") {
      return (
        <Group>
          {kind === "multi" && (
            <p className="text-[11px] text-[var(--text-dim)]">
              <strong className="text-[var(--text)]">{selectedCount} layers</strong> selected.
              Shift-click a layer to add or remove it.
            </p>
          )}
          <AlignControls {...align} count={selectedCount} layout="panel" />
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--text-dim)]">Stacking order</span>
            <div className="grid grid-cols-2 gap-1.5">
              <Button onClick={() => onArrange("front")}>Bring to front</Button>
              <Button onClick={() => onArrange("back")}>Send to back</Button>
              {(selected || selectedGroup) && kind !== "multi" && (
                <>
                  <Button onClick={() => onReorderElement((selected ?? selectedGroup)!.id, 1)}>Forward</Button>
                  <Button onClick={() => onReorderElement((selected ?? selectedGroup)!.id, -1)}>Backward</Button>
                </>
              )}
            </div>
          </div>
        </Group>
      );
    }

    if (!selected) return null;

    if (category === "layer") {
      return (
        <Group>
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
          <Slider
            label="Layer opacity"
            value={selected.opacity ?? 100}
            min={0}
            max={100}
            suffix="%"
            resetTo={100}
            onChange={(opacity) =>
              onElementChange(selected.id, { opacity: opacity === 100 ? undefined : opacity })
            }
          />
        </Group>
      );
    }

    if (selected.type === "text" || selected.type === "number") {
      if (category === "character") {
        return (
          <CharacterFields
            typography={selected.typography}
            fontOptions={fontOptions}
            onChange={patchTypography}
          />
        );
      }
      if (category === "paragraph") {
        return <ParagraphFields typography={selected.typography} onChange={patchTypography} />;
      }
    }

    if (selected.type === "text" && category === "text") {
      return (
        <div ref={contentRef} className="flex flex-col gap-3">
          <TextArea
            label="Content"
            value={selected.text}
            hint="Line breaks are preserved."
            onChange={(text) => onElementChange(selected.id, { text })}
          />
        </div>
      );
    }

    if (selected.type === "number" && category === "numbering") {
      return (
        <Group>
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
        </Group>
      );
    }

    if (selected.type === "image" && category === "image") {
      const cropped = isCropped(selected.crop);
      return (
        <Group>
          <div className="flex gap-1.5">
            <Button full onClick={() => onReplaceImage(selected.id)}>
              <Icon name="image" size={13} />
              {selected.src ? "Replace image…" : "Choose image…"}
            </Button>
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
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--text-dim)]">Crop</span>
            <div className="grid grid-cols-2 gap-1.5">
              <Button disabled={!selected.src} onClick={() => onStartCrop(selected.id)}>
                <Icon name="crop" size={13} /> Crop (C)
              </Button>
              <Button disabled={!cropped} onClick={() => onClearCrop(selected.id)}>
                Clear crop
              </Button>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-[11px] font-medium text-[var(--text-dim)]">Flip</span>
            <div className="flex gap-1">
              <ToolButton
                title="Flip horizontal"
                pressed={!!selected.flipX}
                onClick={() =>
                  onElementChange(selected.id, { flipX: !selected.flipX } as Partial<LabelElement>)
                }
              >
                <Icon name="flipH" />
              </ToolButton>
              <ToolButton
                title="Flip vertical"
                pressed={!!selected.flipY}
                onClick={() =>
                  onElementChange(selected.id, { flipY: !selected.flipY } as Partial<LabelElement>)
                }
              >
                <Icon name="flipV" />
              </ToolButton>
            </div>
          </div>
          <Disclosure label="Image source">
            <TextInput
              label="Source"
              value={selected.src.startsWith("data:") ? "(embedded image)" : selected.src}
              placeholder="my-artwork.jpg"
              hint="A file in /public or a URL. Placed and dropped images are embedded in the design."
              onChange={(src) => {
                if (src !== "(embedded image)") onElementChange(selected.id, { src });
              }}
            />
          </Disclosure>
        </Group>
      );
    }

    if (category === "effects" && supportsEffects(selected)) {
      return <EffectsEditor layerName={selected.name} effects={selected.effects ?? []} {...fx} />;
    }

    if (selected.type === "shape") {
      if (category === "shape") {
        const current = selected.shape ?? "rectangle";
        return (
          <Group>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-[var(--text-dim)]">Shape</span>
              <div role="group" aria-label="Shape" className="grid grid-cols-7 gap-1">
                {SHAPES.map((sh) => (
                  <ToolButton
                    key={sh.kind}
                    size="sm"
                    title={sh.label}
                    pressed={current === sh.kind}
                    onClick={() => onElementChange(selected.id, { shape: sh.kind as ShapeKind } as Partial<LabelElement>)}
                  >
                    <Icon name={SHAPE_ICONS[sh.kind]} size={14} />
                  </ToolButton>
                ))}
              </div>
            </div>
            {(current === "polygon" || current === "star") && (
              <NumberInput
                label={current === "star" ? "Points" : "Sides"}
                value={selected.sides ?? (current === "star" ? 5 : DEFAULT_SIDES)}
                min={3}
                max={64}
                step={1}
                integer
                allowMin
                onChange={(sides) => onElementChange(selected.id, { sides } as Partial<LabelElement>)}
              />
            )}
            {(current === "star" || current === "burst") && (
              <Slider
                label="Inner radius"
                value={selected.innerRadius ?? DEFAULT_INNER_RADIUS}
                min={5}
                max={95}
                suffix="%"
                resetTo={DEFAULT_INNER_RADIUS}
                onChange={(innerRadius) => onElementChange(selected.id, { innerRadius } as Partial<LabelElement>)}
              />
            )}
          </Group>
        );
      }
      if (category === "fill") {
        return <FillInput value={selected.fill} onChange={(fill) => onElementChange(selected.id, { fill })} />;
      }
      if (category === "border") {
        return (
          <BorderEditor
            border={selected.border}
            unit={unit}
            onChange={(patch) =>
              onElementChange(selected.id, {
                border: { ...selected.border, ...patch },
              } as Partial<LabelElement>)
            }
          />
        );
      }
    }
    return null;
  };

  return (
    <div className="flex flex-col">
      {selectedGroup && kind === "group" && (
        <div className="flex items-center gap-1.5 border-b border-[var(--border)] px-3 py-1.5">
          <Icon name="folder" size={13} />
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text)]">
            {selectedGroup.name}
          </span>
        </div>
      )}

      {selected && kind !== "multi" && (
        <div className="flex items-center gap-1 border-b border-[var(--border)] px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[var(--text)]">
            {selected.name}
          </span>
          <ToolButton size="sm" title="Duplicate layer (Ctrl+D)" onClick={() => onDuplicateElement(selected.id)}>
            <Icon name="copy" size={13} />
          </ToolButton>
          <ToolButton size="sm" title="Delete layer (Del)" onClick={() => onDeleteElement(selected.id)}>
            <Icon name="trash" size={13} />
          </ToolButton>
        </div>
      )}

      {missingFamily && (
        <p
          role="status"
          className="mx-3 mt-2.5 flex items-start gap-1.5 rounded-[var(--radius)] bg-[var(--danger-soft)] px-2 py-1.5 text-[11px] leading-snug text-[var(--danger)]"
        >
          <span aria-hidden="true">⚠</span>
          <span>
            <strong className="font-semibold">{missingFamily}</strong> is not installed here — this
            text prints in a substitute with different widths.
          </span>
        </p>
      )}

      {categories.length > 1 && (
        <div
          role="tablist"
          aria-label="Property categories"
          className="flex gap-0.5 overflow-x-auto border-b border-[var(--border)] px-2 py-1.5"
        >
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              id={`prop-tab-${c.id}`}
              aria-selected={category === c.id}
              aria-controls="prop-tabpanel"
              onClick={() => onCategoryChange(c.id)}
              className={`shrink-0 rounded-[5px] px-1.5 py-1 text-[11px] font-medium transition-colors ${
                category === c.id
                  ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                  : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
      )}

      <div
        id="prop-tabpanel"
        role="tabpanel"
        aria-labelledby={`prop-tab-${category}`}
        className="flex flex-col gap-3 p-3.5"
      >
        {body()}
      </div>
    </div>
  );
};

export default Properties;
