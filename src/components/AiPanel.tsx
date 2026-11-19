import { useState } from "react";
import type { LabelElement } from "../types";
import type { AiApi } from "../lib/ai/useAi";
import type { GenerativeApi } from "../lib/ai/useGenerative";
import type { Capability } from "../lib/ai/types";
import { CAPABILITIES } from "../lib/ai/types";
import type { AiPrefs } from "../lib/workspace";
import { Button, Disclosure, Section } from "./controls";
import { Icon } from "./icons";

const ASPECTS: { label: string; value: string }[] = [
  { label: "Square 1:1", value: "1" },
  { label: "Landscape 4:3", value: String(4 / 3) },
  { label: "Portrait 3:4", value: String(3 / 4) },
  { label: "Wide 16:9", value: String(16 / 9) },
  { label: "Tall 9:16", value: String(9 / 16) },
  { label: "Like the label", value: "label" },
];

const fieldClass =
  "w-full rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] px-2 py-1.5 text-[11.5px] text-[var(--text)] placeholder:text-[var(--text-faint)] focus:border-[var(--accent)] focus:outline-none";

export interface AiPanelProps {
  ai: AiApi;
  gen: GenerativeApi;
  prefs: AiPrefs;
  onPrefs: (patch: Partial<AiPrefs>) => void;
  hasSelection: boolean;
  selected: LabelElement | null;
  labelAspect: number;
  onExpand: (id: string) => void;
  onSelectSubject: () => void;
}

const StatusDot = ({ status }: { status: AiApi["status"] }) => (
  <span
    aria-hidden="true"
    className="inline-block h-2 w-2 shrink-0 rounded-full"
    style={{ background: status === "online" ? "#22c55e" : status === "checking" ? "#eab308" : "var(--danger)" }}
  />
);

/** A row of result thumbnails; the current one is outlined. */
const Thumbs = ({
  images,
  current,
  label,
  onPick,
}: {
  images: string[];
  current: number | null;
  label: string;
  onPick: (index: number) => void;
}) => (
  <div role="group" aria-label={label} className="grid grid-cols-3 gap-1.5">
    {images.map((src, i) => (
      <button
        key={i}
        type="button"
        aria-label={`${label} ${i + 1}`}
        aria-pressed={current === i}
        onClick={() => onPick(i)}
        className={`aspect-square overflow-hidden rounded-[5px] border bg-[var(--surface-2)] ${
          current === i ? "border-[var(--accent)] ring-2 ring-[var(--accent)]" : "border-[var(--border)] hover:border-[var(--border-strong)]"
        }`}
      >
        <img src={src} alt="" className="h-full w-full object-cover" />
      </button>
    ))}
  </div>
);

/**
 * The Generative AI panel: the local server's status, the running job, and
 * every generative tool — fill, remove, text-to-image, variations, edits —
 * plus which model serves each job.
 */
const AiPanel = ({ ai, gen, prefs, onPrefs, hasSelection, selected, labelAspect, onExpand, onSelectSubject }: AiPanelProps) => {
  const [fillPrompt, setFillPrompt] = useState("");
  const [genPrompt, setGenPrompt] = useState("");
  const [aspect, setAspect] = useState("1");
  const [instruction, setInstruction] = useState("");
  const [endpoint, setEndpoint] = useState(prefs.endpoint);
  const busy = !!ai.job;
  const online = ai.status === "online";

  const generated = selected?.type === "image" && selected.generative ? selected : null;
  const variants = generated ? gen.variations[generated.id] : undefined;
  const pixelLayer = selected && (selected.type === "image" || selected.type === "raster") ? selected : null;

  return (
    <div className="flex flex-col">
      {/* ---------- Server ---------- */}
      <Section title="Local AI server">
        <div className="flex items-center gap-2 text-[11.5px]">
          <StatusDot status={ai.status} />
          <span className="font-medium text-[var(--text)]" role="status">
            {ai.status === "online" ? "Connected" : ai.status === "checking" ? "Connecting…" : "Not running"}
          </span>
          {ai.health && (
            <span className="truncate text-[var(--text-faint)]">
              · {ai.health.device.toUpperCase()} · {ai.health.profile}
            </span>
          )}
          <span className="ml-auto">
            <Button variant="ghost" onClick={ai.refresh} title="Check the server again">
              Retry
            </Button>
          </span>
        </div>
        {ai.status === "offline" && (
          <div className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)] p-2.5 text-[11px] leading-relaxed text-[var(--text-dim)]">
            <p>
              The AI tools run on open-source models on <em>this</em> computer — no account, no fees. Start the server
              once:
            </p>
            <pre className="mt-1.5 overflow-x-auto rounded bg-[var(--surface-3)] p-1.5 text-[10.5px] text-[var(--text)]">
{`cd ai-server
python -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
pip install -r requirements-models.txt
python -m label_ai`}
            </pre>
            <p className="mt-1.5">Marquee, lasso, magic wand, quick selection, masks and Select and Mask work without it.</p>
          </div>
        )}
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            onPrefs({ endpoint: endpoint.trim() });
          }}
        >
          <label className="sr-only" htmlFor="ai-endpoint">
            Server address
          </label>
          <input id="ai-endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className={fieldClass} />
          <Button type="submit" disabled={endpoint.trim() === prefs.endpoint}>
            Use
          </Button>
        </form>
      </Section>

      {/* ---------- Running job ---------- */}
      {ai.job && (
        <div role="status" aria-label="AI job" className="flex flex-col gap-1.5 border-b border-[var(--border)] px-3.5 py-3">
          <div className="flex items-center gap-2 text-[11.5px]">
            <span aria-hidden="true" className="ai-spinner" />
            <span className="font-medium text-[var(--text)]">{ai.job.label}</span>
            <span className="ml-auto">
              <Button variant="danger" onClick={ai.cancel}>
                Cancel
              </Button>
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div
              className="h-full bg-[var(--accent)] transition-[width]"
              style={{ width: `${Math.round((ai.job.progress.fraction ?? 0.05) * 100)}%` }}
            />
          </div>
          {ai.job.progress.message && <p className="text-[10.5px] text-[var(--text-faint)]">{ai.job.progress.message}</p>}
        </div>
      )}

      {/* ---------- Selection: fill / replace / remove ---------- */}
      <Section title="Generative fill">
        {hasSelection ? (
          <>
            <textarea
              aria-label="Generative fill prompt"
              value={fillPrompt}
              onChange={(e) => setFillPrompt(e.target.value)}
              rows={2}
              placeholder="Describe what to add — or leave empty to fill from the surroundings"
              className={fieldClass}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void gen.fill(fillPrompt, "fill");
              }}
            />
            <div className="flex flex-wrap gap-1.5">
              <Button variant="primary" disabled={!online || busy || !ai.can("inpaint")} onClick={() => void gen.fill(fillPrompt, "fill")}>
                <Icon name="sparkle" size={12} /> Generate
              </Button>
              <Button
                disabled={!online || busy || !fillPrompt.trim() || !ai.can("inpaint")}
                onClick={() => void gen.fill(fillPrompt, "replace")}
                title="Replace the selected object with what the prompt describes"
              >
                Replace
              </Button>
              <Button
                disabled={!online || busy || (!ai.can("remove") && !ai.can("inpaint"))}
                onClick={() => void gen.remove()}
                title="Remove the selected object, no prompt needed"
              >
                <Icon name="remove" size={12} /> Remove
              </Button>
            </div>
          </>
        ) : (
          <p className="text-[11px] leading-relaxed text-[var(--text-faint)]">
            Select an area (marquee, lasso, object selection…) to fill, replace or remove it. Or paint over things with the
            Remove tool (J).
          </p>
        )}
      </Section>

      {/* ---------- Variations of a generated layer ---------- */}
      {generated && (
        <Section title="Variations">
          {generated.generative?.prompt && (
            <p className="text-[11px] italic text-[var(--text-dim)]">“{generated.generative.prompt}”</p>
          )}
          {variants && variants.images.length > 1 && (
            <Thumbs
              images={variants.images}
              current={variants.index}
              label="Variation"
              onPick={(i) => gen.showVariation(generated.id, i)}
            />
          )}
          <Button disabled={!online || busy} onClick={() => void gen.generateMore(generated)}>
            <Icon name="sparkle" size={12} /> Generate more
          </Button>
        </Section>
      )}

      {/* ---------- Text to image ---------- */}
      <Section title="Generate image">
        <textarea
          aria-label="Image prompt"
          value={genPrompt}
          onChange={(e) => setGenPrompt(e.target.value)}
          rows={2}
          placeholder="A watercolour lemon on a white background"
          className={fieldClass}
        />
        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="ai-aspect">
            Aspect ratio
          </label>
          <select
            id="ai-aspect"
            value={aspect}
            onChange={(e) => setAspect(e.target.value)}
            className={fieldClass}
            disabled={hasSelection}
            title={hasSelection ? "Fits the selection" : undefined}
          >
            {ASPECTS.map((a) => (
              <option key={a.value} value={a.value}>
                {hasSelection ? "Fit the selection" : a.label}
              </option>
            ))}
          </select>
          <Button
            variant="primary"
            disabled={!online || busy || !genPrompt.trim() || !ai.can("generate")}
            onClick={() => void gen.generate(genPrompt, aspect === "label" ? labelAspect : Number(aspect))}
          >
            Generate
          </Button>
        </div>
        {gen.pending && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] text-[var(--text-dim)]">Click one to place it{gen.pending.rect ? " in the selection" : ""}:</p>
            <Thumbs images={gen.pending.images} current={null} label="Generated image" onPick={(i) => void gen.placePending(i)} />
            <Button variant="ghost" onClick={() => gen.setPending(null)}>
              Discard
            </Button>
          </div>
        )}
      </Section>

      {/* ---------- Layer tools ---------- */}
      <Section title="Selected layer">
        {pixelLayer ? (
          <>
            <div className="flex flex-wrap gap-1.5">
              <Button disabled={!online || busy || !ai.can("subject")} onClick={() => void gen.removeBackground(pixelLayer)}>
                <Icon name="subject" size={12} /> Remove background
              </Button>
              <Button disabled={!online || busy || !ai.can("subject")} onClick={onSelectSubject}>
                Select subject
              </Button>
              <Button disabled={!online || busy || !ai.can("variations")} onClick={() => void gen.similar(pixelLayer)}>
                Generate similar
              </Button>
              {pixelLayer.type === "image" && (
                <Button disabled={!online || busy || (!ai.can("inpaint") && !ai.can("remove"))} onClick={() => onExpand(pixelLayer.id)}>
                  <Icon name="expand" size={12} /> Expand…
                </Button>
              )}
            </div>
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                void gen.edit(instruction, pixelLayer);
              }}
            >
              <input
                aria-label="Edit instruction"
                value={instruction}
                onChange={(e) => setInstruction(e.target.value)}
                placeholder={hasSelection ? "Edit the selected area: “make it autumn”" : "Edit with words: “make it autumn”"}
                className={fieldClass}
              />
              <Button type="submit" disabled={!online || busy || !instruction.trim() || !ai.can("edit")}>
                Edit
              </Button>
            </form>
          </>
        ) : (
          <p className="text-[11px] text-[var(--text-faint)]">Select an image or pixel layer for background removal, variations, expand and edits.</p>
        )}
      </Section>

      {/* ---------- Models ---------- */}
      <Section title="Models" collapsible defaultOpen={false}>
        <label className="flex items-center justify-between gap-2 text-[11px] text-[var(--text-dim)]">
          Results per request
          <select
            value={prefs.count}
            onChange={(e) => onPrefs({ count: Number(e.target.value) })}
            className="rounded-[5px] border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text)]"
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {CAPABILITIES.map((cap) => {
          const entry = ai.catalog[cap.id];
          const models = entry?.models ?? [];
          return (
            <label key={cap.id} className="flex flex-col gap-1 text-[11px] text-[var(--text-dim)]" title={cap.hint}>
              {cap.label}
              <select
                value={prefs.models[cap.id] ?? ""}
                disabled={!online || models.length === 0}
                onChange={(e) =>
                  onPrefs({ models: { ...prefs.models, [cap.id as Capability]: e.target.value || undefined } })
                }
                className={fieldClass}
              >
                <option value="">
                  {entry?.default ? `Server default (${entry.default})` : online ? "No model available" : "—"}
                </option>
                {models.map((m) => (
                  <option key={m.id} value={m.id} disabled={!m.available} title={m.reason ?? m.description}>
                    {m.name} · {m.license}
                    {m.size ? ` · ${m.size}` : ""}
                    {m.available ? "" : " (not installed)"}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
        <Disclosure label="Negative prompt">
          <textarea
            aria-label="Negative prompt"
            value={prefs.negativePrompt}
            onChange={(e) => onPrefs({ negativePrompt: e.target.value.slice(0, 500) })}
            rows={2}
            placeholder="blurry, watermark, text"
            className={fieldClass}
          />
        </Disclosure>
      </Section>
    </div>
  );
};

export default AiPanel;
