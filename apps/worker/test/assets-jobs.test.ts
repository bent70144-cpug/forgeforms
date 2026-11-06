// T16 — `assets` queue job handlers (spec §12): scan lifecycle
// (pending → clean | infected | skipped) + process-image variant planning.
// The registry wiring is asserted too (the T17 contract: handlers resolve by
// queue/job name and unwrap Results into BullMQ failures).
import { describe, expect, it } from "vitest";
import { registerJobs } from "../src/jobs/registry";
import { processProcessImageJob } from "../src/jobs/assets-process-image";
import { processScanJob } from "../src/jobs/assets-scan";
import { FakeScanner, makeDeps } from "./fakes";

/** 32×32 PNG header (mirrors the core fixtures). */
const PNG_BYTES: Uint8Array = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x20, 0x08, 0x06, 0x00, 0x00, 0x00,
]);
/** AVIF-less payload for the unparseable-header case. */
const AVIF_BYTES: Uint8Array = new Uint8Array(64);

const WS = "11111111-1111-4111-8111-111111111111";

function seedPending(h: ReturnType<typeof makeDeps>, id: string, mime = "image/png"): string {
  const key = `upload/${WS}/${id}/photo.png`;
  h.assets.seed({
    id,
    workspaceId: WS,
    key,
    mime,
    sizeBytes: PNG_BYTES.byteLength,
    purpose: "upload",
    scanStatus: "pending",
    variants: null,
    confirmedAt: new Date(),
    createdAt: new Date(),
  });
  void h.store.put({ key, body: PNG_BYTES });
  return key;
}

describe("scan job — pending → clean | infected | skipped (spec §6/§12)", () => {
  const jobData = (assetId: string, key: string) => ({ assetId, workspaceId: WS, key });

  it("clean verdict marks the asset clean and keeps the object", async () => {
    const h = makeDeps({ scanner: new FakeScanner("clean") });
    const key = seedPending(h, "ast-1");
    const result = await processScanJob(h.deps, "job-1", jobData("ast-1", key));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("ast-1")!.scanStatus).toBe("clean");
    expect(h.store.has(key)).toBe(true);
  });

  it("infected verdict marks infected AND purges the object (§17 defense in depth)", async () => {
    const h = makeDeps({ scanner: new FakeScanner("infected") });
    const key = seedPending(h, "ast-2");
    const result = await processScanJob(h.deps, "job-2", jobData("ast-2", key));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("ast-2")!.scanStatus).toBe("infected");
    expect(h.store.has(key)).toBe(false);
  });

  it("no AV in dev → `skipped` (spec §12 'or skipped in dev')", async () => {
    const h = makeDeps({ scanner: new FakeScanner("unavailable") });
    const key = seedPending(h, "ast-3");
    const result = await processScanJob(h.deps, "job-3", jobData("ast-3", key));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("ast-3")!.scanStatus).toBe("skipped");
  });

  it("never advances a non-pending row (idempotent retries)", async () => {
    const scanner = new FakeScanner("infected");
    const h = makeDeps({ scanner });
    const key = seedPending(h, "ast-4");
    h.assets.patch("ast-4", { scanStatus: "clean" }); // already resolved
    const result = await processScanJob(h.deps, "job-4", jobData("ast-4", key));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("ast-4")!.scanStatus).toBe("clean");
    expect(scanner.scannedKeys).toHaveLength(0);
    expect(h.store.has(key)).toBe(true);
  });

  it("missing asset row is a NOT_FOUND failure (BullMQ will retry then drop)", async () => {
    const h = makeDeps();
    const result = await processScanJob(h.deps, "job-5", jobData("missing", "upload/x/y.png"));
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("NOT_FOUND");
  });

  it("malformed job payload is a VALIDATION failure", async () => {
    const h = makeDeps();
    const result = await processScanJob(h.deps, "job-6", { assetId: "a" });
    expect(result.ok).toBe(false);
    expect(result.error!.code).toBe("VALIDATION");
  });
});

describe("process-image job — WebP/AVIF ladder planning (spec §12)", () => {
  const jobData = (assetId: string, key: string, mime = "image/png") => ({
    assetId,
    workspaceId: WS,
    key,
    mime,
  });

  it("plans + stores variants for a PNG (widths × webp/avif + blur placeholder)", async () => {
    const h = makeDeps();
    // 64×48 PNG: sizes ladder below 64 is empty → single intrinsic pair.
    seedPending(h, "img-1");
    const result = await processProcessImageJob(h.deps, "job-1", jobData("img-1", `upload/${WS}/img-1/photo.png`));
    expect(result.ok).toBe(true);
    const variants = h.assets.rows.get("img-1")!.variants as {
      width: number;
      height: number;
      sizes: string;
      blurDataURL: string;
      variants: Array<{ key: string; format: string; width: number }>;
    };
    expect(variants.width).toBe(32); // PNG_BYTES IHDR is 32×32
    expect(variants.height).toBe(32);
    expect(variants.variants.map((v) => `${v.format}@${v.width}`)).toEqual(["webp@32", "avif@32"]);
    expect(variants.variants[0]!.key).toBe(`upload/${WS}/img-1/photo.32w.webp`);
    expect(variants.blurDataURL).toMatch(/^data:image\/svg\+xml,/);
    expect(variants.sizes).toBe("(max-width: 640px) 100vw, 640px");
  });

  it("non-raster assets are left untouched (no variants)", async () => {
    const h = makeDeps();
    seedPending(h, "doc-1", "application/pdf");
    const result = await processProcessImageJob(h.deps, "job-2", jobData("doc-1", `upload/${WS}/doc-1/photo.png`, "application/pdf"));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("doc-1")!.variants).toBeNull();
  });

  it("unparseable headers (avif) store no variants and do not fail (INTEGRATION-DEBT)", async () => {
    const h = makeDeps();
    const key = `upload/${WS}/img-2/photo.avif`;
    h.assets.seed({
      id: "img-2",
      workspaceId: WS,
      key,
      mime: "image/avif",
      sizeBytes: 64,
      purpose: "upload",
      scanStatus: "pending",
      variants: null,
      confirmedAt: new Date(),
      createdAt: new Date(),
    });
    void h.store.put({ key, body: AVIF_BYTES });
    const result = await processProcessImageJob(h.deps, "job-3", jobData("img-2", key, "image/avif"));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("img-2")!.variants).toBeNull();
  });

  it("idempotent: rows with variants already stored are not re-planned", async () => {
    const h = makeDeps();
    const key = seedPending(h, "img-3");
    const planned = { width: 32, height: 32, sizes: "s", blurDataURL: "b", variants: [] as unknown[] };
    h.assets.patch("img-3", { variants: planned });
    const result = await processProcessImageJob(h.deps, "job-4", jobData("img-3", key));
    expect(result.ok).toBe(true);
    expect(h.assets.rows.get("img-3")!.variants).toBe(planned); // same reference — untouched
  });

  it("missing row → NOT_FOUND; bad payload → VALIDATION", async () => {
    const h = makeDeps();
    const missing = await processProcessImageJob(h.deps, "job-5", jobData("nope", "k.png"));
    expect(missing.ok).toBe(false);
    expect(missing.error!.code).toBe("NOT_FOUND");
    const bad = await processProcessImageJob(h.deps, "job-6", { assetId: "a", workspaceId: WS, key: "k" });
    expect(bad.ok).toBe(false);
    expect(bad.error!.code).toBe("VALIDATION");
  });
});

describe("registry wiring (T17 contract)", () => {
  it("registers scan + process-image on the assets queue and they run end-to-end", async () => {
    const h = makeDeps({ scanner: new FakeScanner("clean") });
    const registry = registerJobs(h.deps);
    const handlers = registry.assets;
    expect(handlers).toBeDefined();
    expect(Object.keys(handlers!).sort()).toEqual(["process-image", "scan"]);

    const key = seedPending(h, "img-9");
    await handlers!["scan"]({ id: "1", name: "scan", data: { assetId: "img-9", workspaceId: WS, key } });
    expect(h.assets.rows.get("img-9")!.scanStatus).toBe("clean");
    await handlers!["process-image"]({
      id: "2",
      name: "process-image",
      data: { assetId: "img-9", workspaceId: WS, key, mime: "image/png" },
    });
    expect(h.assets.rows.get("img-9")!.variants).not.toBeNull();
  });
});
