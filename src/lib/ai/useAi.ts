import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AiPrefs } from "../workspace";
import { HttpProvider } from "./http";
import type {
  AiProvider,
  Capability,
  CapabilityParams,
  CapabilityResults,
  Health,
  ModelCatalog,
  Progress,
} from "./types";
import { AiError } from "./types";

export type AiStatus = "checking" | "online" | "offline";

export interface AiJob {
  id: number;
  label: string;
  capability: Capability;
  progress: Progress;
}

export interface AiApi {
  provider: AiProvider;
  status: AiStatus;
  health: Health | null;
  catalog: ModelCatalog;
  /** Last connection problem, for the AI panel. */
  error: string | null;
  refresh: () => void;
  /** Whether some model can serve this capability right now. */
  can: (capability: Capability) => boolean;
  /** The model a request will use: the user's pick, else the server default. */
  modelFor: (capability: Capability) => string | null;
  job: AiJob | null;
  /** Run a capability as the current job (one at a time, cancellable). */
  run: <C extends Capability>(capability: C, params: CapabilityParams[C], label: string) => Promise<CapabilityResults[C]>;
  cancel: () => void;
}

/** How often to look for a server that isn't running yet. */
const RETRY_MS = 20_000;

/**
 * The connection to the local AI server: its health, its model catalogue,
 * and the one job running at a time (the server is serial anyway).
 */
export const useAi = (prefs: AiPrefs, providerOverride?: AiProvider): AiApi => {
  const provider = useMemo(() => providerOverride ?? new HttpProvider(prefs.endpoint), [prefs.endpoint, providerOverride]);
  const [status, setStatus] = useState<AiStatus>("checking");
  const [health, setHealth] = useState<Health | null>(null);
  const [catalog, setCatalog] = useState<ModelCatalog>({});
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const [job, setJob] = useState<AiJob | null>(null);
  const controller = useRef<AbortController | null>(null);
  const jobId = useRef(0);

  useEffect(() => {
    const abort = new AbortController();
    let timer: number | undefined;
    setStatus("checking");
    const check = async () => {
      try {
        const h = await provider.health(abort.signal);
        const models = await provider.models(abort.signal);
        if (abort.signal.aborted) return;
        setHealth(h);
        setCatalog(models);
        setStatus("online");
        setError(null);
      } catch (e) {
        if (abort.signal.aborted) return;
        setStatus("offline");
        setHealth(null);
        setCatalog({});
        setError(e instanceof Error ? e.message : "The AI server is not reachable.");
        timer = window.setTimeout(() => void check(), RETRY_MS);
      }
    };
    void check();
    return () => {
      abort.abort();
      window.clearTimeout(timer);
    };
  }, [provider, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  const modelFor = useCallback(
    (capability: Capability): string | null => {
      const entry = catalog[capability];
      if (!entry) return null;
      const picked = prefs.models[capability];
      if (picked && entry.models.some((m) => m.id === picked && m.available)) return picked;
      return entry.default;
    },
    [catalog, prefs.models]
  );

  const can = useCallback((capability: Capability) => status === "online" && !!modelFor(capability), [status, modelFor]);

  const cancel = useCallback(() => controller.current?.abort(), []);

  const run = useCallback(
    async <C extends Capability>(capability: C, params: CapabilityParams[C], label: string) => {
      if (status !== "online") {
        throw new AiError(error ?? "The AI server is not running. Start it from ai-server/ (see the AI panel).", "offline");
      }
      const model = modelFor(capability);
      if (!model) {
        throw new AiError(
          `No model on the AI server can do "${label}". Install the model packages (pip install -r requirements-models.txt).`,
          "model_unavailable"
        );
      }
      // One job at a time: a new request replaces a running one.
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const id = (jobId.current += 1);
      setJob({ id, label, capability, progress: { fraction: null, message: null } });
      try {
        return await provider.run(capability, params, {
          model,
          signal: abort.signal,
          onProgress: (progress) => setJob((j) => (j && j.id === id ? { ...j, progress } : j)),
        });
      } finally {
        if (controller.current === abort) controller.current = null;
        setJob((j) => (j && j.id === id ? null : j));
      }
    },
    [provider, status, error, modelFor]
  );

  return { provider, status, health, catalog, error, refresh, can, modelFor, job, run, cancel };
};

/** "Cancelled" is not worth a red error message. */
export const isCancel = (e: unknown) => e instanceof AiError && e.code === "cancelled";
