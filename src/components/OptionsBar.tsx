import { useId, useState } from "react";
import type { ReactNode } from "react";
import type {
  BorderStyle,
  LabelElement,
  NumberElement,
  ShapeElement,
  ShapeKind,
  TextAlign,
  TextElement,
  Typography,
} from "../types";
import type { ToolId } from "../lib/tools";
import { toolById } from "../lib/tools";
import type { ToolDefaults } from "../lib/workspace";
import type { CategoryId } from "../lib/properties";
import { FONT_WEIGHTS } from "../lib/fonts";
import { CROP_RATIOS, isCropped } from "../lib/imageEdit";
import {
  BarDivider,
  Button,
  InlineColor,
  InlineNumber,
  InlineSelect,
  Toggle,
  ToolButton,
} from "./controls";
import AlignControls from "./AlignControls";
import type { AlignControlsProps } from "./AlignControls";
import { Icon } from "./icons";
import type { CropSession } from "./Canvas";
import { SHAPE_ICONS, SHAPES, shapeDef } from "../lib/shapes";
import type { BrushSettings } from "../lib/brush";
import { BLEND_MODES, BRUSH_MAX, BRUSH_MIN, BRUSH_PRESETS } from "../lib/brush";
import { MenuList } from "./Menu";


export interface OptionsBarProps {
  tool: ToolId;
  selected: LabelElement | null;
  selectedCount: number;
  fontOptions: { label: string; value: string }[];
  toolDefaults: ToolDefaults;
  onToolDefaults: <K extends keyof ToolDefaults>(tool: K, patch: Partial<ToolDefaults[K]>) => void;
  onElementChange: (id: string, patch: Partial<LabelElement>) => void;
  onOpenProperties: (category: CategoryId) => void;
  align: Omit<AlignControlsProps, "count" | "layout">;
  zoom: {
    scale: number;
    isFit: boolean;
    zoomOut: boolean;
    onZoomOutChange: (out: boolean) => void;
    onFit: () => void;
    onActual: () => void;
    onStep: (direction: 1 | -1) => void;
  };
  crop: {
    session: CropSession | null;
    ratioKey: string;
    onRatio: (key: string) => void;
    onApply: () => void;
    onCancel: () => void;
    onReset: () => void;
    onClear: () => void;
  };
  /** Move tool: what a click on a grouped layer selects. */
  autoSelect: "layer" | "group";
  onAutoSelect: (mode: "layer" | "group") => void;
  onShowBrushPanel: () => void;
  view: {
    grid: boolean;
    snap: boolean;
    onGrid: (on: boolean) => void;
    onSnap: (on: boolean) => void;
  };
}

const InlineText = ({
  label,
  value,
  onChange,
  width = "4rem",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  width?: string;
}) => {
  const id = useId();
  return (
    <span className="flex items-center gap-1.5">
      <label htmlFor={id} className="text-[11px] text-[var(--text-faint)]">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-6 rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 text-[11px] text-[var(--text)] hover:border-[var(--border-strong)] focus:border-[var(--accent)] focus:outline-none"
        style={{ width }}
      />
    </span>
  );
};

const ALIGN_BUTTONS: { value: TextAlign; icon: "alignLeft" | "alignHCenter" | "alignRight"; label: string }[] = [
  { value: "left", icon: "alignLeft", label: "Align text left" },
  { value: "center", icon: "alignHCenter", label: "Centre text" },
  { value: "right", icon: "alignRight", label: "Align text right" },
];

/** Who the options bar is editing: the selected layer, or the tool's defaults. */
const Target = ({ name }: { name: string | null }) => (
  <span
    className="max-w-[10rem] truncate rounded-[4px] bg-[var(--surface-2)] px-1.5 py-0.5 text-[10.5px] text-[var(--text-faint)]"
    title={name ? `Editing ${name}` : "Settings for new layers"}
  >
    {name ? `Editing: ${name}` : "New layers"}
  </span>
);

const MoreButton = ({ onClick, label = "More…" }: { onClick: () => void; label?: string }) => (
  <Button variant="ghost" onClick={onClick} title="Open every setting in the Properties panel">
    <Icon name="sliders" size={12} /> {label}
  </Button>
);

/**
 * The tool options bar. It only ever shows what the active tool needs; the
 * rest lives in Properties (via "More…") or the right-click menu.
 */
const OptionsBar = ({
  tool,
  selected,
  selectedCount,
  fontOptions,
  toolDefaults,
  onToolDefaults,
  onElementChange,
  onOpenProperties,
  align,
  zoom,
  crop,
  view,
  autoSelect,
  onAutoSelect,
  onShowBrushPanel,
}: OptionsBarProps) => {
  const def = toolById(tool);
  const [shapeMenu, setShapeMenu] = useState(false);
  const [presetMenu, setPresetMenu] = useState(false);
  const brush = toolDefaults.brush;
  const setBrush = (patch: Partial<BrushSettings>) => onToolDefaults("brush", patch);

  const content = (): ReactNode => {
    switch (tool) {
      case "move":
        return (
          <>
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] text-[var(--text-faint)]">Auto-select</span>
              <span
                role="group"
                aria-label="Auto-select"
                className="flex h-6 gap-0.5 rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] p-0.5"
              >
                {(["layer", "group"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    aria-pressed={autoSelect === m}
                    title={m === "layer" ? "Clicks select the layer itself" : "Clicks select the layer's whole group"}
                    onClick={() => onAutoSelect(m)}
                    className={`rounded-[4px] px-1.5 text-[10.5px] font-medium capitalize ${
                      autoSelect === m ? "bg-[var(--accent)] text-[var(--accent-text)]" : "text-[var(--text-dim)] hover:text-[var(--text)]"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </span>
            </span>
            <BarDivider />
            <AlignControls {...align} count={selectedCount} />
            {selected && selectedCount === 1 && (
              <>
                <BarDivider />
                <MoreButton
                  label="Properties…"
                  onClick={() => onOpenProperties(selected.type === "text" ? "text" : "layer")}
                />
              </>
            )}
          </>
        );

      case "hand":
      case "zoom": {
        return (
          <>
            {tool === "zoom" && (
              <>
                <ToolButton size="sm" title="Zoom in (click)" pressed={!zoom.zoomOut} onClick={() => zoom.onZoomOutChange(false)}>
                  <Icon name="zoom" />
                </ToolButton>
                <ToolButton size="sm" title="Zoom out (Alt-click)" pressed={zoom.zoomOut} onClick={() => zoom.onZoomOutChange(true)}>
                  <Icon name="zoomOut" />
                </ToolButton>
                <BarDivider />
              </>
            )}
            <ToolButton size="sm" title="Zoom out (−)" onClick={() => zoom.onStep(-1)}>
              <Icon name="zoomOut" />
            </ToolButton>
            <span className="min-w-[3rem] text-center text-[11px] tabular-nums text-[var(--text-dim)]">
              {Math.round(zoom.scale * 100)}%
            </span>
            <ToolButton size="sm" title="Zoom in (+)" onClick={() => zoom.onStep(1)}>
              <Icon name="zoom" />
            </ToolButton>
            <Button variant={zoom.isFit ? "primary" : "default"} onClick={zoom.onFit} title="Fit on screen (0)">
              Fit
            </Button>
            <Button onClick={zoom.onActual} title="Actual size (Ctrl+1)">
              100%
            </Button>
          </>
        );
      }

      case "text": {
        const el = selected?.type === "text" ? (selected as TextElement) : null;
        const t = el ? el.typography : toolDefaults.text;
        const set = (patch: Partial<Typography>) =>
          el
            ? onElementChange(el.id, { typography: { ...el.typography, ...patch } } as Partial<LabelElement>)
            : onToolDefaults("text", patch as Partial<ToolDefaults["text"]>);
        return (
          <>
            <Target name={el?.name ?? null} />
            <InlineSelect
              label="Font"
              hideLabel
              width="9.5rem"
              value={t.fontFamily}
              options={
                fontOptions.some((o) => o.value === t.fontFamily)
                  ? fontOptions
                  : [{ label: "Custom font", value: t.fontFamily }, ...fontOptions]
              }
              onChange={(fontFamily) => set({ fontFamily })}
            />
            <InlineSelect
              label="Weight"
              hideLabel
              width="6.5rem"
              value={t.fontWeight}
              options={FONT_WEIGHTS}
              onChange={(fontWeight) => set({ fontWeight })}
            />
            <InlineNumber
              label="Size"
              suffix="pt"
              value={t.fontSize}
              min={0.5}
              max={400}
              step={0.5}
              onChange={(fontSize) => set({ fontSize })}
            />
            <InlineColor label="Colour" value={t.color} onChange={(color) => set({ color })} />
            <BarDivider />
            {ALIGN_BUTTONS.map((b) => (
              <ToolButton
                key={b.value}
                size="sm"
                title={b.label}
                pressed={t.align === b.value}
                onClick={() => set({ align: b.value })}
              >
                <Icon name={b.icon} />
              </ToolButton>
            ))}
            {el && (
              <>
                <BarDivider />
                <MoreButton onClick={() => onOpenProperties("character")} />
              </>
            )}
          </>
        );
      }

      case "number": {
        const el = selected?.type === "number" ? (selected as NumberElement) : null;
        const d = toolDefaults.number;
        const prefix = el ? el.prefix : d.prefix;
        const padTo = el ? el.padTo : d.padTo;
        const fontSize = el ? el.typography.fontSize : d.fontSize;
        const color = el ? el.typography.color : d.color;
        return (
          <>
            <Target name={el?.name ?? null} />
            <InlineText
              label="Prefix"
              value={prefix}
              onChange={(v) =>
                el ? onElementChange(el.id, { prefix: v.slice(0, 40) }) : onToolDefaults("number", { prefix: v.slice(0, 40) })
              }
            />
            <InlineNumber
              label="Digits"
              value={padTo}
              min={0}
              max={12}
              integer
              onChange={(v) => (el ? onElementChange(el.id, { padTo: v }) : onToolDefaults("number", { padTo: v }))}
            />
            <InlineNumber
              label="Size"
              suffix="pt"
              value={fontSize}
              min={0.5}
              max={400}
              step={0.5}
              onChange={(v) =>
                el
                  ? onElementChange(el.id, { typography: { ...el.typography, fontSize: v } } as Partial<LabelElement>)
                  : onToolDefaults("number", { fontSize: v })
              }
            />
            <InlineColor
              label="Colour"
              value={color}
              onChange={(v) =>
                el
                  ? onElementChange(el.id, { typography: { ...el.typography, color: v } } as Partial<LabelElement>)
                  : onToolDefaults("number", { color: v })
              }
            />
            {el && (
              <>
                <BarDivider />
                <MoreButton onClick={() => onOpenProperties("numbering")} />
              </>
            )}
          </>
        );
      }

      case "shape": {
        const el = selected?.type === "shape" ? (selected as ShapeElement) : null;
        const fill = el ? el.fill : toolDefaults.shape.fill;
        const border = el ? el.border : toolDefaults.shape.border;
        const setBorder = (patch: Partial<ShapeElement["border"]>) =>
          el
            ? onElementChange(el.id, { border: { ...el.border, ...patch } } as Partial<LabelElement>)
            : onToolDefaults("shape", { border: { ...toolDefaults.shape.border, ...patch } });
        const kind: ShapeKind = el ? el.shape ?? "rectangle" : toolDefaults.shape.kind;
        const setKind = (k: ShapeKind) =>
          el ? onElementChange(el.id, { shape: k } as Partial<LabelElement>) : onToolDefaults("shape", { kind: k });
        const sides = el ? el.sides ?? (kind === "star" ? 5 : 6) : toolDefaults.shape.sides;
        const setFill = (v: string) => (el ? onElementChange(el.id, { fill: v }) : onToolDefaults("shape", { fill: v }));
        return (
          <>
            <Target name={el?.name ?? null} />
            <span className="relative">
              <Button onClick={() => setShapeMenu((m) => !m)} title="Choose a shape (Shift+U cycles)">
                <Icon name={SHAPE_ICONS[kind]} size={13} /> {shapeDef(kind).label} ▾
              </Button>
              {shapeMenu && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setShapeMenu(false)} />
                  <div className="absolute left-0 top-full z-50 mt-1">
                    <MenuList
                      label="Shapes"
                      onClose={() => setShapeMenu(false)}
                      items={SHAPES.map((sh) => ({
                        label: sh.label,
                        checked: sh.kind === kind,
                        onSelect: () => setKind(sh.kind),
                      }))}
                    />
                  </div>
                </>
              )}
            </span>
            {(kind === "polygon" || kind === "star") && (
              <InlineNumber
                label={kind === "star" ? "Points" : "Sides"}
                value={sides}
                min={3}
                max={64}
                integer
                onChange={(v) =>
                  el ? onElementChange(el.id, { sides: v } as Partial<LabelElement>) : onToolDefaults("shape", { sides: v })
                }
              />
            )}
            <BarDivider />
            <Toggle label="No fill" checked={fill === "none"} onChange={(on) => setFill(on ? "none" : "#e5e7eb")} />
            {fill !== "none" && <InlineColor label="Fill" value={fill} onChange={setFill} />}
            <BarDivider />
            <InlineSelect<BorderStyle>
              label="Stroke"
              width="5.5rem"
              value={border.style}
              options={[
                { label: "None", value: "none" },
                { label: "Solid", value: "solid" },
                { label: "Dashed", value: "dashed" },
                { label: "Dotted", value: "dotted" },
                { label: "Double", value: "double" },
              ]}
              onChange={(style) => setBorder({ style, width: style !== "none" && border.width <= 0 ? 0.3 : border.width })}
            />
            {border.style !== "none" && (
              <>
                <InlineNumber
                  label="Width"
                  suffix="mm"
                  value={border.width}
                  min={0}
                  max={100}
                  step={0.1}
                  onChange={(width) => setBorder({ width })}
                />
                <InlineColor label="Stroke colour" value={border.color} onChange={(color) => setBorder({ color })} />
              </>
            )}
            <InlineNumber
              label="Corners"
              suffix="mm"
              value={border.radius}
              min={0}
              max={500}
              step={0.5}
              onChange={(radius) => setBorder({ radius })}
            />
            {el && (
              <>
                <BarDivider />
                <MoreButton onClick={() => onOpenProperties("fill")} />
              </>
            )}
          </>
        );
      }

      case "brush":
      case "eraser": {
        return (
          <>
            <span className="relative">
              <Button onClick={() => setPresetMenu((m) => !m)} title="Brush presets">
                <span
                  aria-hidden="true"
                  className="inline-block rounded-full border border-[var(--border-strong)]"
                  style={{
                    width: 12,
                    height: 12 * (brush.roundness / 100),
                    background: `radial-gradient(circle, ${tool === "eraser" ? "#888" : brush.color} ${brush.hardness * 0.7}%, transparent 72%)`,
                  }}
                />
                Presets ▾
              </Button>
              {presetMenu && (
                <>
                  <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setPresetMenu(false)} />
                  <div className="absolute left-0 top-full z-50 mt-1">
                    <MenuList
                      label="Brush presets"
                      onClose={() => setPresetMenu(false)}
                      items={BRUSH_PRESETS.map((p) => ({ label: p.label, onSelect: () => setBrush(p.settings) }))}
                    />
                  </div>
                </>
              )}
            </span>
            <InlineNumber label="Size" suffix="px" value={brush.size} min={BRUSH_MIN} max={BRUSH_MAX} integer onChange={(size) => setBrush({ size })} />
            <InlineNumber label="Hardness" suffix="%" value={brush.hardness} min={0} max={100} integer onChange={(hardness) => setBrush({ hardness })} />
            <BarDivider />
            {tool === "brush" && (
              <InlineSelect
                label="Mode"
                width="7rem"
                value={brush.blendMode}
                options={BLEND_MODES}
                onChange={(blendMode) => setBrush({ blendMode })}
              />
            )}
            <InlineNumber label="Opacity" suffix="%" value={brush.opacity} min={1} max={100} integer onChange={(opacity) => setBrush({ opacity })} />
            <InlineNumber label="Flow" suffix="%" value={brush.flow} min={1} max={100} integer onChange={(flow) => setBrush({ flow })} />
            <ToolButton size="sm" title="Airbrush build-up" pressed={brush.airbrush} onClick={() => setBrush({ airbrush: !brush.airbrush })}>
              <Icon name="drop" size={13} />
            </ToolButton>
            <InlineNumber label="Smoothing" suffix="%" value={brush.smoothing} min={0} max={100} integer onChange={(smoothing) => setBrush({ smoothing })} />
            <ToolButton
              size="sm"
              title="Pressure controls size (pen tablets)"
              pressed={brush.sizeControl === "pressure"}
              onClick={() => setBrush({ sizeControl: brush.sizeControl === "pressure" ? "off" : "pressure" })}
            >
              <Icon name="brush" size={13} />
            </ToolButton>
            {tool === "brush" && <InlineColor label="Colour" value={brush.color} onChange={(color) => setBrush({ color })} />}
            <BarDivider />
            <MoreButton label="Brush settings…" onClick={onShowBrushPanel} />
          </>
        );
      }

      case "crop": {
        if (!crop.session) {
          const image = selected?.type === "image" ? selected : null;
          return (
            <>
              <span className="text-[11px] text-[var(--text-dim)]">
                {image ? "Image selected." : "Click an image on the label to crop it."}
              </span>
              {image && isCropped(image.crop) && (
                <Button onClick={crop.onClear}>Clear crop</Button>
              )}
            </>
          );
        }
        return (
          <>
            <InlineSelect
              label="Ratio"
              width="6rem"
              value={crop.ratioKey}
              options={CROP_RATIOS}
              onChange={crop.onRatio}
            />
            <Button onClick={crop.onReset} title="Show the whole image again">
              Reset
            </Button>
            <BarDivider />
            <Button onClick={crop.onCancel} title="Discard this crop (Esc)">
              <Icon name="close" size={12} /> Cancel
            </Button>
            <Button variant="primary" onClick={crop.onApply} title="Apply the crop (Enter)">
              <Icon name="check" size={12} /> Apply
            </Button>
          </>
        );
      }
    }
  };

  return (
    <div
      role="toolbar"
      aria-label={`${def.label} tool options`}
      className="flex h-9 shrink-0 items-center gap-2 overflow-x-auto border-b border-[var(--border)] bg-[var(--surface)] px-3"
    >
      <span className="flex shrink-0 items-center gap-1.5 pr-1 text-[11px] font-semibold text-[var(--text)]">
        {def.label}
        <kbd className="rounded-[3px] border border-[var(--border)] px-1 font-sans text-[9.5px] font-medium text-[var(--text-faint)]">
          {def.shortcut}
        </kbd>
      </span>
      <BarDivider />
      <div className="flex min-w-0 shrink-0 items-center gap-2">{content()}</div>
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-3">
        <Toggle label="Grid" checked={view.grid} onChange={view.onGrid} />
        <Toggle label="Snap" checked={view.snap} onChange={view.onSnap} />
      </div>
    </div>
  );
};

export default OptionsBar;
