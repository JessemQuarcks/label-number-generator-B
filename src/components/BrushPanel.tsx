import { useState } from "react";
import type { BrushControl, BrushSettings } from "../lib/brush";
import { BLEND_MODES, BRUSH_MAX, BRUSH_MIN, BRUSH_PRESETS, BRUSH_TIPS, DEFAULT_BRUSH } from "../lib/brush";
import { Button, ColorInput, SegmentedControl, Select, Slider, Toggle } from "./controls";

type Section = "tip" | "shape" | "scatter" | "transfer" | "color" | "other";

const SECTIONS: { id: Section; label: string }[] = [
  { id: "tip", label: "Tip" },
  { id: "shape", label: "Shape dynamics" },
  { id: "scatter", label: "Scattering" },
  { id: "transfer", label: "Transfer" },
  { id: "color", label: "Colour" },
  { id: "other", label: "Other" },
];

const CONTROLS: { label: string; value: BrushControl }[] = [
  { label: "Off", value: "off" },
  { label: "Pen pressure", value: "pressure" },
  { label: "Fade", value: "fade" },
];

/**
 * Every brush setting, split into categories so only one group of settings
 * is on screen at a time. The options bar holds the everyday ones.
 */
const BrushPanel = ({
  brush,
  onChange,
}: {
  brush: BrushSettings;
  onChange: (patch: Partial<BrushSettings>) => void;
}) => {
  const [section, setSection] = useState<Section>("tip");
  const pct = (label: string, key: keyof BrushSettings, min = 0, max = 100, suffix = "%", step = 1) => (
    <Slider
      label={label}
      value={brush[key] as number}
      min={min}
      max={max}
      step={step}
      suffix={suffix}
      resetTo={DEFAULT_BRUSH[key] as number}
      onChange={(v) => onChange({ [key]: v } as Partial<BrushSettings>)}
    />
  );

  const body = () => {
    switch (section) {
      case "tip":
        return (
          <>
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-medium text-[var(--text-dim)]">Presets</span>
              <div className="flex flex-wrap gap-1">
                {BRUSH_PRESETS.map((p) => (
                  <Button key={p.key} onClick={() => onChange(p.settings)}>
                    {p.label}
                  </Button>
                ))}
              </div>
            </div>
            <Select label="Tip shape" value={brush.tip} options={BRUSH_TIPS} onChange={(tip) => onChange({ tip })} />
            {pct("Size", "size", BRUSH_MIN, 500, "px")}
            {pct("Hardness", "hardness")}
            {pct("Spacing", "spacing", 1, 200)}
            {pct("Angle", "angle", -180, 180, "°")}
            {pct("Roundness", "roundness", 1, 100)}
            <div className="flex gap-5">
              <Toggle label="Flip X" checked={brush.flipX} onChange={(flipX) => onChange({ flipX })} />
              <Toggle label="Flip Y" checked={brush.flipY} onChange={(flipY) => onChange({ flipY })} />
            </div>
            <p className="text-[11px] leading-snug text-[var(--text-faint)]">
              Size is in pixel-layer pixels (300 dpi, about 11.8 px per mm). Up to {BRUSH_MAX}px
              from the options bar.
            </p>
          </>
        );
      case "shape":
        return (
          <>
            {pct("Size jitter", "sizeJitter")}
            <Select label="Size control" value={brush.sizeControl} options={CONTROLS} onChange={(sizeControl) => onChange({ sizeControl })} />
            {pct("Minimum diameter", "minDiameter")}
            {brush.sizeControl === "fade" || brush.opacityControl === "fade" || brush.flowControl === "fade"
              ? pct("Fade steps", "fadeSteps", 1, 500, "")
              : null}
            {pct("Angle jitter", "angleJitter")}
            <Toggle
              label="Angle follows stroke direction"
              checked={brush.angleFollowsDirection}
              onChange={(angleFollowsDirection) => onChange({ angleFollowsDirection })}
            />
            {pct("Roundness jitter", "roundnessJitter")}
            {pct("Minimum roundness", "minRoundness", 1, 100)}
          </>
        );
      case "scatter":
        return (
          <>
            {pct("Scatter", "scatter", 0, 1000)}
            <Toggle label="Both axes" checked={brush.scatterBothAxes} onChange={(scatterBothAxes) => onChange({ scatterBothAxes })} />
            {pct("Count", "count", 1, 16, "")}
            {pct("Count jitter", "countJitter")}
          </>
        );
      case "transfer":
        return (
          <>
            {pct("Opacity", "opacity", 1, 100)}
            {pct("Opacity jitter", "opacityJitter")}
            <Select
              label="Opacity control"
              value={brush.opacityControl}
              options={CONTROLS}
              onChange={(opacityControl) => onChange({ opacityControl })}
            />
            {pct("Flow", "flow", 1, 100)}
            {pct("Flow jitter", "flowJitter")}
            <Select label="Flow control" value={brush.flowControl} options={CONTROLS} onChange={(flowControl) => onChange({ flowControl })} />
            <Select label="Blend mode" value={brush.blendMode} options={BLEND_MODES} onChange={(blendMode) => onChange({ blendMode })} />
          </>
        );
      case "color":
        return (
          <>
            <ColorInput label="Foreground" value={brush.color} onChange={(color) => onChange({ color })} />
            <ColorInput label="Background" value={brush.secondaryColor} onChange={(secondaryColor) => onChange({ secondaryColor })} />
            <SegmentedControl
              label="Apply colour dynamics"
              value={brush.colorPerTip ? "tip" : "stroke"}
              options={[
                { label: "Per tip", value: "tip" as const },
                { label: "Per stroke", value: "stroke" as const },
              ]}
              onChange={(v) => onChange({ colorPerTip: v === "tip" })}
            />
            {pct("Foreground/background jitter", "fgBgJitter")}
            {pct("Hue jitter", "hueJitter")}
            {pct("Saturation jitter", "saturationJitter")}
            {pct("Brightness jitter", "brightnessJitter")}
          </>
        );
      case "other":
        return (
          <>
            {pct("Smoothing", "smoothing")}
            <Toggle label="Noise (grainy edges)" checked={brush.noise} onChange={(noise) => onChange({ noise })} />
            <Toggle label="Build-up (airbrush)" checked={brush.airbrush} onChange={(airbrush) => onChange({ airbrush })} />
            <Toggle
              label="Protect transparency"
              checked={brush.protectTransparency}
              onChange={(protectTransparency) => onChange({ protectTransparency })}
            />
            <Button variant="ghost" onClick={() => onChange({ ...DEFAULT_BRUSH, color: brush.color, secondaryColor: brush.secondaryColor })}>
              Reset brush settings
            </Button>
          </>
        );
    }
  };

  return (
    <div className="flex flex-col">
      <div role="tablist" aria-label="Brush setting categories" className="flex flex-wrap gap-0.5 border-b border-[var(--border)] px-2 py-1.5">
        {SECTIONS.map((sec) => (
          <button
            key={sec.id}
            type="button"
            role="tab"
            aria-selected={section === sec.id}
            onClick={() => setSection(sec.id)}
            className={`shrink-0 rounded-[5px] px-1.5 py-1 text-[11px] font-medium transition-colors ${
              section === sec.id
                ? "bg-[var(--accent-soft)] text-[var(--accent)]"
                : "text-[var(--text-dim)] hover:bg-[var(--surface-3)] hover:text-[var(--text)]"
            }`}
          >
            {sec.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" className="flex flex-col gap-3 p-3.5">
        {body()}
      </div>
    </div>
  );
};

export default BrushPanel;
