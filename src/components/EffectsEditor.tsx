import { useState } from "react";
import type { EffectKind, LayerEffect } from "../types";
import { EFFECT_DEFS, EFFECT_PRESETS, effectDef, hasShadowParams } from "../lib/effects";
import { Button, ColorInput, Slider, ToolButton } from "./controls";
import { Icon } from "./icons";
import { MenuList } from "./Menu";

export interface EffectsEditorProps {
  layerName: string;
  effects: LayerEffect[];
  onAdd: (kind: EffectKind) => void;
  onPreset: (key: string) => void;
  onPatch: (effectId: string, patch: Partial<LayerEffect>) => void;
  onToggle: (effectId: string) => void;
  onDuplicate: (effectId: string) => void;
  onRemove: (effectId: string) => void;
  onClear: () => void;
}

/**
 * A layer's effect stack. Each effect is its own card that can be switched
 * off, duplicated or removed — the same actions the Layers panel offers on
 * the effect rows under the layer.
 */
const EffectsEditor = ({
  layerName,
  effects,
  onAdd,
  onPreset,
  onPatch,
  onToggle,
  onDuplicate,
  onRemove,
  onClear,
}: EffectsEditorProps) => {
  const [menu, setMenu] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="relative flex gap-1.5">
        <Button full onClick={() => setMenu((m) => !m)}>
          <Icon name="fx" size={13} /> Add effect…
        </Button>
        {menu && (
          <>
            <div className="fixed inset-0 z-40" aria-hidden="true" onClick={() => setMenu(false)} />
            <div className="absolute left-0 top-full z-50 mt-1">
              <MenuList
                label="Add effect"
                onClose={() => setMenu(false)}
                items={[
                  { kind: "heading", label: "Effect" },
                  ...EFFECT_DEFS.map((d) => ({ label: d.label, onSelect: () => onAdd(d.kind) })),
                  { kind: "separator" },
                  { kind: "heading", label: "Quick looks" },
                  ...EFFECT_PRESETS.map((p) => ({ label: p.label, onSelect: () => onPreset(p.key) })),
                ]}
              />
            </div>
          </>
        )}
      </div>

      {effects.length === 0 ? (
        <p className="rounded-[var(--radius)] border border-dashed border-[var(--border)] px-3 py-3 text-center text-[11px] leading-relaxed text-[var(--text-faint)]">
          No effects on {layerName}. Added effects also appear under the layer in the Layers panel,
          where they can be switched off, copied or deleted.
        </p>
      ) : (
        <ul aria-label="Effect stack" className="flex flex-col gap-2">
          {effects.map((fx) => {
            const def = effectDef(fx.kind);
            return (
              <li
                key={fx.id}
                className={`flex flex-col gap-2 rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 ${
                  fx.enabled ? "" : "opacity-60"
                }`}
              >
                <div className="flex items-center gap-1">
                  <ToolButton
                    size="sm"
                    title={fx.enabled ? `Turn off ${def.label}` : `Turn on ${def.label}`}
                    pressed={fx.enabled}
                    onClick={() => onToggle(fx.id)}
                  >
                    <Icon name={fx.enabled ? "eye" : "eyeOff"} size={12} />
                  </ToolButton>
                  <span className="flex-1 text-[11px] font-medium text-[var(--text)]">{def.label}</span>
                  <ToolButton size="sm" title={`Duplicate ${def.label}`} onClick={() => onDuplicate(fx.id)}>
                    <Icon name="copy" size={12} />
                  </ToolButton>
                  <ToolButton size="sm" title={`Remove ${def.label}`} onClick={() => onRemove(fx.id)}>
                    <Icon name="trash" size={12} />
                  </ToolButton>
                </div>
                <Slider
                  label={hasShadowParams(fx.kind) ? "Opacity" : "Amount"}
                  value={fx.amount}
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  suffix={def.suffix}
                  resetTo={def.initial}
                  onChange={(amount) => onPatch(fx.id, { amount })}
                />
                {hasShadowParams(fx.kind) && (
                  <>
                    <div className="grid grid-cols-2 gap-2">
                      <Slider
                        label="Offset X"
                        value={fx.offsetX ?? 0}
                        min={-10}
                        max={10}
                        step={0.1}
                        suffix="mm"
                        resetTo={fx.kind === "glow" ? 0 : 0.8}
                        onChange={(offsetX) => onPatch(fx.id, { offsetX })}
                      />
                      <Slider
                        label="Offset Y"
                        value={fx.offsetY ?? 0}
                        min={-10}
                        max={10}
                        step={0.1}
                        suffix="mm"
                        resetTo={fx.kind === "glow" ? 0 : 0.8}
                        onChange={(offsetY) => onPatch(fx.id, { offsetY })}
                      />
                    </div>
                    <Slider
                      label="Softness"
                      value={fx.radius ?? 1}
                      min={0}
                      max={10}
                      step={0.1}
                      suffix="mm"
                      onChange={(radius) => onPatch(fx.id, { radius })}
                    />
                    <ColorInput
                      label="Colour"
                      value={fx.color ?? "#000000"}
                      onChange={(color) => onPatch(fx.id, { color })}
                    />
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {effects.length > 0 && (
        <Button variant="ghost" onClick={onClear}>
          Remove all effects
        </Button>
      )}
    </div>
  );
};

export default EffectsEditor;
