// Route handler tests for the authenticated media plane (T16, spec §11):
// auth context supplies the workspace, docs:write scope for tokens, §4 error
// mapping, signed-download enforcement on GET /assets/:id.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@formforge/core";

vi.mock("../../../../../lib/assets/server", () => ({
  getTenantAssetsService: vi.fn(),
}));

vi.mock("../../_lib/auth", () => ({
  authenticate: vi.fn(),
}));

import { POST as presignRoute } from "./route";
import { POST as confirmRoute } from "../confirm/route";
import { GET as getAssetRoute } from "../[id]/route";
import { authenticate } from "../../_lib/auth";
import { getTenantAssetsService } from "../../../../../lib/assets/server";

const SESSION_CTX = {
  workspaceId: "ws_1",
  requestId: "req_1",
  actor: { kind: "session", userId: "u_1", role: "owner" },
  userId: "u_1",
  role: "owner",
  scopes: ["docs:read", "docs:write", "docs:publish", "submissions:read"],
  now: () => new Date(),
};

const TOKEN_CTX_READONLY = {
  ...SESSION_CTX,
  actor: { kind: "token", tokenId: "t_1", scopes: ["docs:read"] },
  scopes: ["docs:read"],
};

function jsonRequest(body?: unknown, url = "http://localhost/api/v1/assets/presign"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

type ServiceMock = {
  presign: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
  downloadUrl: ReturnType<typeof vi.fn>;
  repo: { getById: ReturnType<typeof vi.fn> };
};

function mockService(partial: Partial<ServiceMock> = {}): ServiceMock {
  const service: ServiceMock = {
    presign: partial.presign ?? vi.fn(),
    confirm: partial.confirm ?? vi.fn(),
    downloadUrl: partial.downloadUrl ?? vi.fn(),
    repo: partial.repo ?? { getById: vi.fn() },
  };
  vi.mocked(getTenantAssetsService).mockReturnValue(service as never);
  return service;
}

beforeEach(() => {
  vi.mocked(authenticate).mockReset();
  vi.mocked(getTenantAssetsService).mockReset();
  vi.mocked(authenticate).mockImplementation(async () => SESSION_CTX as never);
});

describe("POST /api/v1/assets/presign", () => {
  it("presigns with the ctx workspace (default purpose media)", async () => {
    const service = mockService({
      presign: vi.fn(async () => ({
        assetId: "ast-1",
        key: "media/ws_1/ast-1/hero.png",
        uploadUrl: "https://s3.test/put",
        mime: "image/png",
        maxSizeMb: 10,
        expiresInSeconds: 600,
        scanStatus: "pending",
      })),
    });
    const res = await presignRoute(jsonRequest({ fileName: "hero.png", mime: "image/png", sizeBytes: 2048 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ assetId: "ast-1", maxSizeMb: 10 });
    expect(service.presign).toHaveBeenCalledWith({
      workspaceId: "ws_1",
      purpose: "media",
      fileName: "hero.png",
      mime: "image/png",
      sizeBytes: 2048,
    });
  });

  it("rejects bearer tokens without docs:write (403)", async () => {
    vi.mocked(authenticate).mockImplementation(async () => TOKEN_CTX_READONLY as never);
    mockService();
    const res = await presignRoute(jsonRequest({ fileName: "a.png", mime: "image/png", sizeBytes: 10 }));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("422s invalid bodies (zod → VALIDATION)", async () => {
    mockService();
    const res = await presignRoute(jsonRequest({ mime: "image/png" }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("maps service VALIDATION (over-cap) to 422", async () => {
    mockService({
      presign: vi.fn(async () => {
        throw AppError.validation("Upload exceeds size limit", [
          { path: "sizeBytes", message: "File exceeds the 10 MB upload limit" },
        ]);
      }),
    });
    const res = await presignRoute(jsonRequest({ fileName: "a.png", mime: "image/png", sizeBytes: 999999999 }));
    expect(res.status).toBe(422);
  });
});

describe("POST /api/v1/assets/confirm", () => {
  it("confirms within the tenant scope", async () => {
    const service = mockService({
      confirm: vi.fn(async () => ({ assetId: "ast-2", key: "k", mime: "image/png", scanStatus: "pending" })),
    });
    const res = await confirmRoute(jsonRequest({ assetId: "ast-2" }, "http://localhost/api/v1/assets/confirm"));
    expect(res.status).toBe(200);
    expect(service.confirm).toHaveBeenCalledWith({ workspaceId: "ws_1", assetId: "ast-2" });
  });

  it("rejects bearer tokens without docs:write", async () => {
    vi.mocked(authenticate).mockImplementation(async () => TOKEN_CTX_READONLY as never);
    mockService();
    const res = await confirmRoute(jsonRequest({ assetId: "a" }, "http://localhost/api/v1/assets/confirm"));
    expect(res.status).toBe(403);
  });
});

describe("GET /api/v1/assets/:id — signed downloads only (§17)", () => {
  const ASSET_ROW = {
    id: "ast-3",
    workspaceId: "ws_1",
    key: "media/ws_1/ast-3/hero.png",
    mime: "image/png",
    sizeBytes: 2048,
    purpose: "media",
    scanStatus: "skipped",
    variants: null,
    createdAt: new Date("2026-11-06T00:00:00Z"),
  };

  function getRequest(url = "http://localhost/api/v1/assets/ast-3"): Request {
    return new Request(url, { method: "GET" });
  }

  it("returns metadata + a signed URL for servable (clean/skipped) assets", async () => {
    const service = mockService({
      repo: { getById: vi.fn(async () => ASSET_ROW) },
      downloadUrl: vi.fn(async () => ({
        url: "mem://formforge/media/ws_1/ast-3/hero.png?sig=1",
        key: ASSET_ROW.key,
        mime: "image/png",
        sizeBytes: 2048,
        scanStatus: "skipped",
        expiresInSeconds: 3600,
      })),
    });
    const res = await getAssetRoute(getRequest(), { params: Promise.resolve({ id: "ast-3" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { asset: Record<string, unknown>; download: Record<string, unknown> | null };
    expect(body.asset).toMatchObject({ id: "ast-3", scanStatus: "skipped" });
    expect(body.download).toMatchObject({ url: expect.stringContaining("sig=1"), expiresInSeconds: 3600 });
    expect(service.downloadUrl).toHaveBeenCalledWith({ workspaceId: "ws_1", assetId: "ast-3" });
  });

  it("returns metadata with download:null while the scan is pending (retryable)", async () => {
    mockService({
      repo: { getById: vi.fn(async () => ({ ...ASSET_ROW, scanStatus: "pending" })) },
      downloadUrl: vi.fn(async () => {
        throw AppError.forbidden("Asset is not available for download", [
          { path: "assetId", message: 'Scan status is "pending"' },
        ]);
      }),
    });
    const res = await getAssetRoute(getRequest(), { params: Promise.resolve({ id: "ast-3" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { asset: { scanStatus: string }; download: unknown };
    expect(body.asset.scanStatus).toBe("pending");
    expect(body.download).toBeNull(); // never an unsigned URL, never a 403 page
  });

  it("404s foreign/missing assets (fail closed)", async () => {
    mockService({ repo: { getById: vi.fn(async () => null) } });
    const res = await getAssetRoute(getRequest(), { params: Promise.resolve({ id: "nope" }) });
    expect(res.status).toBe(404);
  });

  it("rejects bearer tokens without docs:read", async () => {
    vi.mocked(authenticate).mockImplementation(async () => ({
      ...SESSION_CTX,
      actor: { kind: "token", tokenId: "t_1", scopes: ["submissions:read"] },
      scopes: ["submissions:read"],
    }) as never);
    mockService();
    const res = await getAssetRoute(getRequest(), { params: Promise.resolve({ id: "ast-3" }) });
    expect(res.status).toBe(403);
  });
});
