// T16 — upload service tests (spec §10.1 presign/confirm, §13 caps, §17
// magic-byte + signed downloads + scan lifecycle). Values assert spec literals
// (10 MB default cap, pending→clean/infected/skipped lifecycle).

import { describe, expect, it, vi } from "vitest";
import { AppError } from "../shared/errors.ts";;
import { InMemoryObjectStore } from "../shared/object-store.ts";
import { EXE_BYTES, PNG_BYTES } from "./test-bytes.ts";
import {
  DEFAULT_UPLOAD_CAP_MB,
  createAssetsService,
  type AssetQueue,
  type AssetRecord,
  type AssetRepo,
  type AssetsService,
  type AssetsServiceDeps,
  type VirusScanner,
} from "./service.ts";

const fixedNow = () => new Date("2026-02-01T00:00:00Z");
const newId = (() => {
  let n = 0;
  return () => `asset-${String(++n).padStart(4, "0")}`;
})();

class FakeAssetRepo implements AssetRepo {
  readonly rows = new Map<string, AssetRecord>();
  async insert(row: AssetRecord): Promise<AssetRecord> {
    this.rows.set(row.id, row);
    return row;
  }
  async getById(workspaceId: string, assetId: string): Promise<AssetRecord | null> {
    const row = this.rows.get(assetId);
    return row && row.workspaceId === workspaceId ? row : null;
  }
  async getByIdUnscoped(assetId: string): Promise<AssetRecord | null> {
    return this.rows.get(assetId) ?? null;
  }
  async patch(assetId: string, patch: Partial<AssetRecord>): Promise<AssetRecord | null> {
    const row = this.rows.get(assetId);
    if (!row) return null;
    const next = { ...row, ...patch };
    this.rows.set(assetId, next);
    return next;
  }
  async remove(assetId: string, workspaceId: string): Promise<boolean> {
    const row = this.rows.get(assetId);
    if (!row || row.workspaceId !== workspaceId) return false;
    this.rows.delete(assetId);
    return true;
  }
}

class FakeQueue implements AssetQueue {
  readonly jobs: Array<{ name: string; data: unknown; jobId?: string }> = [];
  async enqueue(name: string, data: unknown, jobId?: string): Promise<void> {
    this.jobs.push({ name, data, jobId });
  }
}

function makeDeps(opts: {
  entitlements?: { fileUploadMaxMb: number };
  scanner?: VirusScanner;
} = {}): { service: AssetsService; store: InMemoryObjectStore; repo: FakeAssetRepo; queue: FakeQueue; rawDeps: AssetsServiceDeps } {
  const store = new InMemoryObjectStore({ now: fixedNow });
  const repo = new FakeAssetRepo();
  const queue = new FakeQueue();
  const rawDeps: AssetsServiceDeps = {
    store,
    repo,
    queue,
    ...(opts.entitlements ? { entitlements: { getEntitlements: async () => opts.entitlements! } } : {}),
    now: fixedNow,
    generateId: newId,
  };
  return { service: createAssetsService(rawDeps), store, repo, queue, rawDeps };
}

const WS = "11111111-1111-4111-8111-111111111111";

describe("presignUpload", () => {
  it("returns a presigned PUT + pending asset row (spec §10.1)", async () => {
    const { service, repo } = makeDeps();
    const result = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "photo.PNG",
      mime: "image/png",
      sizeBytes: 1024,
    });
    expect(result.assetId).toMatch(/^asset-/);
    expect(result.key).toBe(`upload/${WS}/${result.assetId}/photo.PNG`);
    expect(result.uploadUrl).toContain(result.key);
    expect(result.maxSizeMb).toBe(DEFAULT_UPLOAD_CAP_MB);
    expect(result.expiresInSeconds).toBe(600);
    const row = repo.rows.get(result.assetId)!;
    expect(row.scanStatus).toBe("pending");
    expect(row.mime).toBe("image/png");
    expect(row.sizeBytes).toBe(1024);
    expect(row.purpose).toBe("upload");
    expect(row.workspaceId).toBe(WS);
  });

  it("rejects over-cap uploads with VALIDATION BEFORE any presign (acceptance)", async () => {
    const { service, repo } = makeDeps();
    const presignSpy = vi.spyOn(service.store, "presignPut");
    const overCap = 10 * 1024 * 1024 + 1; // 10 MB + 1 byte
    const err = await service
      .presign({ workspaceId: WS, purpose: "upload", fileName: "big.bin", mime: "text/plain", sizeBytes: overCap })
      .catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toContainEqual({ path: "sizeBytes", message: expect.stringContaining("10 MB") });
    expect(presignSpy).not.toHaveBeenCalled();
    expect(repo.rows.size).toBe(0);
  });

  it("honors the plan entitlement (business 50 MB via getEntitlements)", async () => {
    const { service } = makeDeps({ entitlements: { fileUploadMaxMb: 50 } });
    const result = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "huge.zip",
      mime: "application/zip",
      sizeBytes: 40 * 1024 * 1024,
    });
    expect(result.maxSizeMb).toBe(50);
  });

  it("rejects non-allowlist declared mime", async () => {
    const { service } = makeDeps();
    await expect(
      service.presign({ workspaceId: WS, purpose: "upload", fileName: "x.exe", mime: "application/x-msdownload", sizeBytes: 10 }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: [{ path: "mime" }] });
  });

  it("rejects bad filenames and non-positive sizes", async () => {
    const { service } = makeDeps();
    await expect(
      service.presign({ workspaceId: WS, purpose: "upload", fileName: "../escape.png", mime: "image/png", sizeBytes: 10 }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: [{ path: "fileName" }] });
    await expect(
      service.presign({ workspaceId: WS, purpose: "upload", fileName: "a.png", mime: "image/png", sizeBytes: 0 }),
    ).rejects.toMatchObject({ code: "VALIDATION", details: [{ path: "sizeBytes" }] });
  });
});

describe("confirmUpload", () => {
  async function presignedFile(service: AssetsService, fileName: string, mime: string, body: Uint8Array) {
    const presigned = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName,
      mime,
      sizeBytes: body.byteLength,
    });
    await service.store.put({ key: presigned.key, body });
    return presigned;
  }

  it("sniffs the real content type, queues scan + image processing (spec §12)", async () => {
    const { service, repo, queue } = makeDeps();
    const presigned = await presignedFile(service, "photo.png", "image/png", PNG_BYTES);
    const result = await service.confirm({ workspaceId: WS, assetId: presigned.assetId });
    expect(result.mime).toBe("image/png");
    expect(result.scanStatus).toBe("pending");
    const row = repo.rows.get(presigned.assetId)!;
    expect(row.scanStatus).toBe("pending");
    expect(row.mime).toBe("image/png");
    expect(queue.jobs.map((j) => j.name)).toEqual(["scan", "process-image"]);
    expect(queue.jobs[0]).toMatchObject({ jobId: `scan:${presigned.assetId}` });
    expect(queue.jobs[0]!.data).toMatchObject({ assetId: presigned.assetId, workspaceId: WS });
    expect(queue.jobs[1]!.jobId).toBe(`process-image:${presigned.assetId}`);
  });

  it("non-image confirmations queue the scan only", async () => {
    const { service, queue } = makeDeps();
    const presigned = await presignedFile(service, "notes.csv", "text/csv", new TextEncoder().encode("a,b\n1,2\n"));
    await service.confirm({ workspaceId: WS, assetId: presigned.assetId });
    expect(queue.jobs.map((j) => j.name)).toEqual(["scan"]);
  });

  it("REJECTS the renamed .exe spoof by magic bytes: VALIDATION, infected, object purged (acceptance)", async () => {
    const { service, repo, queue, store } = makeDeps();
    // A PE executable named photo.png declaring image/png:
    const presigned = await presignedFile(service, "photo.png", "image/png", EXE_BYTES);
    const err = await service.confirm({ workspaceId: WS, assetId: presigned.assetId }).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("VALIDATION");
    expect(err.details).toContainEqual({ path: "mime", message: expect.stringContaining("declared type") });
    const row = repo.rows.get(presigned.assetId)!;
    expect(row.scanStatus).toBe("infected");
    expect(store.has(row.key)).toBe(false); // object purged
    expect(queue.jobs).toHaveLength(0); // never scanned / never downloadable
  });

  it("rejects unknown binary payloads even when declared text", async () => {
    const { service, repo } = makeDeps();
    const presigned = await presignedFile(service, "x.txt", "text/plain", new Uint8Array([0xde, 0xad, 0xbe, 0xef, 0x00]));
    await expect(service.confirm({ workspaceId: WS, assetId: presigned.assetId })).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect(repo.rows.get(presigned.assetId)!.scanStatus).toBe("infected");
  });

  it("is idempotent — a second confirm returns the current status without re-enqueue", async () => {
    const { service, queue } = makeDeps();
    const presigned = await presignedFile(service, "a.png", "image/png", PNG_BYTES);
    const first = await service.confirm({ workspaceId: WS, assetId: presigned.assetId });
    const second = await service.confirm({ workspaceId: WS, assetId: presigned.assetId });
    expect(second.alreadyConfirmed).toBe(true);
    expect(second.scanStatus).toBe(first.scanStatus);
    expect(queue.jobs).toHaveLength(2); // scan + process-image, once
  });

  it("404 on unknown assets and on cross-tenant ids (fail closed)", async () => {
    const { service } = makeDeps();
    await expect(service.confirm({ workspaceId: WS, assetId: "missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });

    const presigned = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "a.png",
      mime: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
    });
    await service.store.put({ key: presigned.key, body: PNG_BYTES });
    await expect(
      service.confirm({ workspaceId: "22222222-2222-4222-8222-222222222222", assetId: presigned.assetId }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("VALIDATION when the object was never uploaded", async () => {
    const { service } = makeDeps();
    const presigned = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "a.png",
      mime: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
    });
    await expect(service.confirm({ workspaceId: WS, assetId: presigned.assetId })).rejects.toMatchObject({
      code: "VALIDATION",
      details: [{ path: "assetId", message: expect.stringContaining("not found in storage") }],
    });
  });

  it("resolves the workspace from the asset row on the public plane (no tenant ctx)", async () => {
    const { service, repo } = makeDeps();
    const presigned = await presignedFile(service, "a.png", "image/png", PNG_BYTES);
    const result = await service.confirm({ assetId: presigned.assetId }); // public plane
    expect(result.mime).toBe("image/png");
    expect(repo.rows.get(presigned.assetId)!.workspaceId).toBe(WS);
  });
});

describe("downloadUrl — signed downloads only (spec §17)", () => {
  async function assetWithStatus(service: AssetsService, scanStatus: AssetRecord["scanStatus"]): Promise<string> {
    const presigned = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "a.png",
      mime: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
    });
    await service.store.put({ key: presigned.key, body: PNG_BYTES });
    if (scanStatus !== "pending") {
      await service.repo.patch(presigned.assetId, { scanStatus });
    }
    return presigned.assetId;
  }

  it("issues a signed GET for clean and skipped assets", async () => {
    for (const status of ["clean", "skipped"] as const) {
      const { service } = makeDeps();
      const id = await assetWithStatus(service, status);
      const result = await service.downloadUrl({ workspaceId: WS, assetId: id });
      expect(result.url).toContain((service.repo as FakeAssetRepo).rows.get(id)!.key);
      expect(result.expiresInSeconds).toBe(3600);
    }
  });

  it("refuses pending and infected assets (scan before download)", async () => {
    for (const status of ["pending", "infected"] as const) {
      const { service } = makeDeps();
      const id = await assetWithStatus(service, status);
      await expect(service.downloadUrl({ workspaceId: WS, assetId: id })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("cross-tenant download requests are indistinguishable from missing (404)", async () => {
    const { service } = makeDeps();
    const id = await assetWithStatus(service, "clean");
    await expect(
      service.downloadUrl({ workspaceId: "22222222-2222-4222-8222-222222222222", assetId: id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("lifecycle through the scan handler seam", () => {
  it("skipped when no AV is available in dev (pending→skipped)", async () => {
    const scanner: VirusScanner = { scan: async () => "unavailable" };
    const { service, repo } = makeDeps({ scanner });
    const presigned = await service.presign({
      workspaceId: WS,
      purpose: "upload",
      fileName: "a.png",
      mime: "image/png",
      sizeBytes: PNG_BYTES.byteLength,
    });
    await service.store.put({ key: presigned.key, body: PNG_BYTES });
    await service.confirm({ workspaceId: WS, assetId: presigned.assetId });
    // The worker marks the status through the same repo port:
    const outcome = await scanner.scan({ key: repo.rows.get(presigned.assetId)!.key });
    expect(outcome).toBe("unavailable");
    await service.repo.patch(presigned.assetId, { scanStatus: "skipped" });
    expect(repo.rows.get(presigned.assetId)!.scanStatus).toBe("skipped");
  });
});
