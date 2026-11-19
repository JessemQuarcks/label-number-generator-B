/**
 * The provider for the local AI server (ai-server/). Everything stays on
 * this machine: the browser posts pixels to localhost and gets pixels back.
 */
import type {
  AiProvider,
  Capability,
  CapabilityParams,
  CapabilityResults,
  Health,
  ModelCatalog,
  RunOptions,
} from "./types";
import { AiError, HEAVY } from "./types";

export const DEFAULT_ENDPOINT = "http://127.0.0.1:8765";

/** Poll interval for queued jobs. */
const POLL_MS = 400;

interface JobStatus {
  id: string;
  status: "queued" | "running" | "done" | "error" | "cancelled";
  progress: number | null;
  message: string | null;
  result: unknown;
  error: { code: string; message: string } | null;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AiError("Cancelled.", "cancelled"));
      },
      { once: true }
    );
  });

/** Normalise "localhost:8765/" → "http://localhost:8765". */
export const normalizeEndpoint = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return DEFAULT_ENDPOINT;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
};

export class HttpProvider implements AiProvider {
  readonly id = "local-server";
  readonly endpoint: string;

  constructor(endpoint: string, private readonly fetcher: typeof fetch = (...a) => fetch(...a)) {
    this.endpoint = normalizeEndpoint(endpoint);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetcher(`${this.endpoint}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
    } catch {
      if (init.signal?.aborted) throw new AiError("Cancelled.", "cancelled");
      throw new AiError(
        `Can't reach the AI server at ${this.endpoint}. Start it with "python -m label_ai" (see ai-server/README.md).`,
        "offline"
      );
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (!res.ok) {
      const err = (body as { error?: { code?: string; message?: string } } | null)?.error;
      throw new AiError(err?.message ?? `AI server error (${res.status}).`, err?.code ?? "http", res.status);
    }
    return body as T;
  }

  health(signal?: AbortSignal) {
    return this.request<Health>("/api/health", { signal });
  }

  async models(signal?: AbortSignal) {
    const out = await this.request<{ capabilities: ModelCatalog }>("/api/models", { signal });
    return out.capabilities ?? {};
  }

  async run<C extends Capability>(capability: C, params: CapabilityParams[C], opts: RunOptions = {}) {
    const background = opts.background ?? HEAVY.includes(capability);
    const body = JSON.stringify({ capability, model: opts.model || undefined, params });
    if (!background) {
      return this.request<CapabilityResults[C]>(`/api/run/${capability}`, {
        method: "POST",
        body: JSON.stringify({ model: opts.model || undefined, params }),
        signal: opts.signal,
      });
    }
    const job = await this.request<{ id: string }>("/api/jobs", { method: "POST", body, signal: opts.signal });
    const cancel = () => {
      // Best effort: tell the server to stop the diffusion loop.
      void this.fetcher(`${this.endpoint}/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => undefined);
    };
    opts.signal?.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        const status = await this.request<JobStatus>(`/api/jobs/${job.id}`, { signal: opts.signal });
        opts.onProgress?.({ fraction: status.progress ?? null, message: status.message ?? null });
        if (status.status === "done") return status.result as CapabilityResults[C];
        if (status.status === "error") {
          throw new AiError(status.error?.message ?? "The AI job failed.", status.error?.code ?? "error");
        }
        if (status.status === "cancelled") throw new AiError("Cancelled.", "cancelled");
        await sleep(POLL_MS, opts.signal);
      }
    } finally {
      opts.signal?.removeEventListener("abort", cancel);
    }
  }
}
