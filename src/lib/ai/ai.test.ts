import { describe, expect, it, vi } from "vitest";
import { HttpProvider, normalizeEndpoint, DEFAULT_ENDPOINT } from "./http";
import { AiError } from "./types";
import {
  generationSize,
  mmToRegionPx,
  regionForRect,
  regionForSelection,
  regionToSelection,
  selectionToRegion,
} from "./regions";
import { fillRect } from "../selection/shapes";

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("HTTP provider", () => {
  it("normalises endpoints", () => {
    expect(normalizeEndpoint("")).toBe(DEFAULT_ENDPOINT);
    expect(normalizeEndpoint("localhost:9000/")).toBe("http://localhost:9000");
    expect(normalizeEndpoint("https://gpu-box:8765")).toBe("https://gpu-box:8765");
  });

  it("runs quick capabilities synchronously", async () => {
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      expect(url).toBe("http://127.0.0.1:8765/api/run/segment");
      expect(JSON.parse(String(init?.body))).toEqual({ model: "sam", params: { image: "data:x", points: [{ x: 1, y: 2, label: 1 }] } });
      return json({ mask: "data:image/png;base64,AAA", score: 0.9 });
    });
    const p = new HttpProvider(DEFAULT_ENDPOINT, fetcher as unknown as typeof fetch);
    const out = await p.run("segment", { image: "data:x", points: [{ x: 1, y: 2, label: 1 }] }, { model: "sam" });
    expect(out.mask).toBe("data:image/png;base64,AAA");
  });

  it("queues heavy capabilities as jobs, reports progress and returns the result", async () => {
    const statuses = [
      { id: "j1", status: "running", progress: 0.5, message: "Step 2/4", result: null, error: null },
      { id: "j1", status: "done", progress: 1, message: null, result: { images: ["data:a"], seeds: [3] }, error: null },
    ];
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith("/api/jobs") && init?.method === "POST") {
        expect(JSON.parse(String(init.body)).capability).toBe("inpaint");
        return json({ id: "j1", status: "queued" }, 202);
      }
      return json(statuses.shift());
    });
    vi.useFakeTimers();
    const p = new HttpProvider(DEFAULT_ENDPOINT, fetcher as unknown as typeof fetch);
    const progress = vi.fn();
    const promise = p.run("inpaint", { image: "data:x", mask: "data:m", prompt: "a cat" }, { onProgress: progress });
    await vi.runAllTimersAsync();
    const out = await promise;
    vi.useRealTimers();
    expect(out).toEqual({ images: ["data:a"], seeds: [3] });
    expect(progress).toHaveBeenCalledWith({ fraction: 0.5, message: "Step 2/4" });
  });

  it("surfaces server errors and an offline server clearly", async () => {
    const failing = new HttpProvider(DEFAULT_ENDPOINT, (() =>
      json({ error: { code: "model_unavailable", message: "Install torch" } }, 409)) as unknown as typeof fetch);
    await expect(failing.run("subject", { image: "data:x" })).rejects.toMatchObject({ code: "model_unavailable", message: "Install torch" });

    const offline = new HttpProvider(DEFAULT_ENDPOINT, (() => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch);
    const err = await offline.health().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiError);
    expect((err as AiError).code).toBe("offline");
    expect((err as AiError).message).toContain("python -m label_ai");
  });

  it("cancels a running job on the server when aborted", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn((url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? "GET"} ${url.replace(DEFAULT_ENDPOINT, "")}`);
      if (init?.method === "POST") return json({ id: "j9", status: "queued" }, 202);
      if (init?.method === "DELETE") return json({ id: "j9", status: "cancelled" });
      return json({ id: "j9", status: "running", progress: 0.1, message: null, result: null, error: null });
    });
    const controller = new AbortController();
    const p = new HttpProvider(DEFAULT_ENDPOINT, fetcher as unknown as typeof fetch);
    const promise = p.run("generate", { prompt: "x", width: 512, height: 512 }, { signal: controller.signal });
    await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toContain("DELETE /api/jobs/j9");
  });
});

describe("AI regions", () => {
  const label = { width: 100, height: 50 };

  it("renders small regions up to the model's minimum and big ones down to its maximum", () => {
    const small = regionForRect({ x: 10, y: 10, width: 10, height: 5 }, label, { minPx: 768, maxPx: 1536 });
    expect(small?.width).toBe(768);
    const big = regionForRect({ x: 0, y: 0, width: 100, height: 50 }, label, { minPx: 512, maxPx: 1024 });
    expect(big?.width).toBe(1024);
    expect(regionForRect({ x: 200, y: 0, width: 5, height: 5 }, label)).toBeNull();
  });

  it("adds context around a selection, clamped to the label", () => {
    const sel = fillRect({ width: 100, height: 50, pxPerMm: 1 }, { x: 40, y: 20, width: 10, height: 10 }, false);
    const region = regionForSelection(sel, label, { margin: 0.5 });
    expect(region?.rect).toEqual({ x: 35, y: 15, width: 20, height: 20 });
    expect(mmToRegionPx(region!, { x: 45, y: 25 }).x).toBeCloseTo(region!.width / 2);
  });

  it("moves masks between the selection grid and a region without shifting them", () => {
    const size = { width: 100, height: 50, pxPerMm: 1 };
    const sel = fillRect(size, { x: 40, y: 20, width: 10, height: 10 }, false);
    const region = regionForRect({ x: 30, y: 10, width: 30, height: 30 }, label, { minPx: 300, maxPx: 300 })!;
    const patch = selectionToRegion(sel, region);
    expect(patch[150 * 300 + 150]).toBe(255);
    expect(patch[10 * 300 + 10]).toBe(0);
    const back = regionToSelection(patch, region.width, region.height, region, size);
    expect(back.data[25 * 100 + 45]).toBe(255);
    expect(back.data[25 * 100 + 35]).toBe(0);
    expect(back.data[5 * 100 + 5]).toBe(0);
  });

  it("picks generation sizes in multiples of 64", () => {
    const s = generationSize(16 / 9);
    expect(s.width % 64).toBe(0);
    expect(s.height % 64).toBe(0);
    expect(s.width / s.height).toBeCloseTo(16 / 9, 0);
    expect(generationSize(1)).toEqual({ width: 1024, height: 1024 });
  });
});
