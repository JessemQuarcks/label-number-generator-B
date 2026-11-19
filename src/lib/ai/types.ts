/**
 * The AI capabilities the editor uses, and their request/response shapes.
 *
 * A capability is a job ("segment", "inpaint", …), not a model. Any number
 * of models can serve one, and the user picks among them in the AI panel.
 * The shapes below match the local AI server's HTTP API (ai-server/README).
 * All images and masks are data URLs; masks are greyscale PNGs, white = yes.
 */

export type Capability =
  | "segment"
  | "subject"
  | "segment_text"
  | "matte"
  | "remove"
  | "inpaint"
  | "generate"
  | "variations"
  | "edit";

export const CAPABILITIES: { id: Capability; label: string; hint: string }[] = [
  { id: "segment", label: "Object selection", hint: "Click to select, object selection, AI quick selection" },
  { id: "subject", label: "Select subject", hint: "Select subject / background, remove background" },
  { id: "segment_text", label: "Select by description", hint: "Select sky, select objects by name" },
  { id: "matte", label: "Refine hair", hint: "Select and Mask ▸ Refine hair" },
  { id: "remove", label: "Remove (prompt-free)", hint: "Remove tool, Generative remove" },
  { id: "inpaint", label: "Generative fill", hint: "Generative fill / replace, expand (outpainting)" },
  { id: "generate", label: "Text to image", hint: "Generate image" },
  { id: "variations", label: "Generate similar", hint: "Variations of a picture" },
  { id: "edit", label: "Edit with instructions", hint: "Instruction-based editing" },
];

export interface Point {
  x: number;
  y: number;
  /** 1 = part of the object, 0 = not. */
  label: 0 | 1;
}

export interface SegmentParams {
  image: string;
  points?: Point[];
  boxes?: [number, number, number, number][];
  multimask?: boolean;
}

export interface MaskResult {
  mask: string;
  score?: number;
  found?: boolean;
}

export interface ImagesResult {
  images: string[];
  seeds: number[];
}

export interface CapabilityParams {
  segment: SegmentParams;
  subject: { image: string };
  segment_text: { image: string; prompt: string; threshold?: number };
  matte: { image: string; mask: string; radius?: number };
  remove: { image: string; mask: string };
  inpaint: {
    image: string;
    mask: string;
    prompt: string;
    negative_prompt?: string;
    count?: number;
    seed?: number;
    steps?: number;
    guidance?: number;
    strength?: number;
  };
  generate: {
    prompt: string;
    negative_prompt?: string;
    width: number;
    height: number;
    count?: number;
    seed?: number;
    steps?: number;
    guidance?: number;
  };
  variations: { image: string; prompt?: string; strength?: number; count?: number; seed?: number };
  edit: { image: string; instruction: string; count?: number; seed?: number; steps?: number; guidance?: number };
}

export interface CapabilityResults {
  segment: MaskResult;
  subject: MaskResult;
  segment_text: MaskResult;
  matte: MaskResult;
  remove: ImagesResult;
  inpaint: ImagesResult;
  generate: ImagesResult;
  variations: ImagesResult;
  edit: ImagesResult;
}

export interface ModelInfo {
  id: string;
  name: string;
  capabilities: Capability[];
  description: string;
  license: string;
  available: boolean;
  loaded: boolean;
  reason: string | null;
  size: string | null;
}

export interface CapabilityModels {
  default: string | null;
  models: ModelInfo[];
}

export type ModelCatalog = Partial<Record<Capability, CapabilityModels>>;

export interface Health {
  status: string;
  version: string;
  device: string;
  profile: string;
}

export interface Progress {
  /** 0–1, or null when unknown. */
  fraction: number | null;
  message: string | null;
}

export interface RunOptions {
  model?: string;
  signal?: AbortSignal;
  onProgress?: (p: Progress) => void;
  /** Long-running work goes through the job queue (progress + cancel). */
  background?: boolean;
}

/**
 * Anything that can run capabilities. The HTTP provider talks to the local
 * Python server; another provider (say, in-browser ONNX models) only has to
 * implement this to plug in.
 */
export interface AiProvider {
  readonly id: string;
  health(signal?: AbortSignal): Promise<Health>;
  models(signal?: AbortSignal): Promise<ModelCatalog>;
  run<C extends Capability>(capability: C, params: CapabilityParams[C], opts?: RunOptions): Promise<CapabilityResults[C]>;
}

export class AiError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 0
  ) {
    super(message);
    this.name = "AiError";
  }
}

/** Capabilities that are slow enough to deserve progress and a Cancel button. */
export const HEAVY: Capability[] = ["remove", "inpaint", "generate", "variations", "edit", "matte"];
