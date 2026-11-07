// Route handler tests for GET /api/v1/assets (workspace media list — builder
// asset picker, §10): auth context supplies the workspace, docs:read scope for
// tokens, §4 error mapping, §17 signed-download gating per row.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@formforge/core";

vi.mock("../../../../lib/assets/server", () => ({
  getTenantAssetsService: vi.fn(),
  getTenantAssetsRepo: vi.fn(),
}));

vi.mock("../_lib/auth", () => ({
  authenticate: vi.fn(),
}));

import { GET as listAssetsRoute } from "./route";
import { authenticate } from "../_lib/auth";
import { getTenantAssetsRepo, getTenantAssetsService } from "../../../../lib/assets/server";

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

type AssetRow = {
  id: string;
  workspaceId: string;
  key: string;
  mime: string;
  sizeBytes: number;
  purpose: string;
  scanStatus: string;
  variants: unknown;
  createdAt: Date;
};

function assetRow(overrides: Partial<AssetRow> = {}): AssetRow {
  return {
    id: "ast-1",
    workspaceId: "ws_1",
    key: "media/ws_1/ast-1/hero.png",
    mime: "image/png",
    sizeBytes: 2048,
    purpose: "media",
    scanStatus: "skipped",
    variants: null,
    createdAt: new Date("2026-11-06T00:00:00Z"),
    ...overrides,
  };
}

type RepoMock = { listByWorkspace: ReturnType<typeof vi.fn> };
type ServiceMock = { downloadUrl: ReturnType<typeof vi.fn> };

function mockWiring(repo: RepoMock, service: ServiceMock): void {
  vi.mocked(getTenantAssetsRepo).mockReturnValue(repo as never);
  vi.mocked(getTenantAssetsService).mockReturnValue(service as never);
}

beforeEach(() => {
  vi.mocked(authenticate).mockReset();
  vi.mocked(getTenantAssetsRepo).mockReset();
  vi.mocked(getTenantAssetsService).mockReset();
  vi.mocked(authenticate).mockImplementation(async () => SESSION_CTX as never);
});

describe("GET /api/v1/assets — workspace media list (§10)", () => {
  it("lists the workspace assets newest-first with signed URLs for servable rows", async () => {
    const repo = { listByWorkspace: vi.fn(async () => [assetRow()]) };
    const service = {
      downloadUrl: vi.fn(async () => ({
        url: "mem://formforge/media/ws_1/ast-1/hero.png?sig=1",
        key: assetRow().key,
        mime: "image/png",
        sizeBytes: 2048,
        scanStatus: "skipped",
        expiresInSeconds: 3600,
      })),
    };
    mockWiring(repo, service);

    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ asset: Record<string, unknown>; download: Record<string, unknown> | null }>;
      nextCursor: string | null;
    };
    expect(body.data).toHaveLength(1);
    expect(body.data[0]!.asset).toMatchObject({ id: "ast-1", scanStatus: "skipped", createdAt: "2026-11-06T00:00:00.000Z" });
    expect(body.data[0]!.download).toMatchObject({ url: expect.stringContaining("sig=1"), expiresInSeconds: 3600 });
    expect(body.nextCursor).toBeNull();
    // The workspace ALWAYS comes from the auth context (never a query param).
    expect(repo.listByWorkspace).toHaveBeenCalledWith("ws_1", { purpose: undefined, limit: 50 });
    expect(service.downloadUrl).toHaveBeenCalledWith({ workspaceId: "ws_1", assetId: "ast-1" });
  });

  it("forwards purpose/limit query filters (validated)", async () => {
    const repo = { listByWorkspace: vi.fn(async () => []) };
    mockWiring(repo, { downloadUrl: vi.fn() });
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets?purpose=media&limit=10"));
    expect(res.status).toBe(200);
    expect(repo.listByWorkspace).toHaveBeenCalledWith("ws_1", { purpose: "media", limit: 10 });
  });

  it("422s invalid query params", async () => {
    mockWiring({ listByWorkspace: vi.fn() }, { downloadUrl: vi.fn() });
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets?limit=999"));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("returns download:null (metadata still flows) while a scan is pending (§17)", async () => {
    mockWiring(
      { listByWorkspace: vi.fn(async () => [assetRow({ id: "ast-pending", scanStatus: "pending" })]) },
      {
        downloadUrl: vi.fn(async () => {
          throw AppError.forbidden("Asset is not available for download", [
            { path: "assetId", message: 'Scan status is "pending"' },
          ]);
        }),
      },
    );
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ asset: { scanStatus: string }; download: unknown }> };
    expect(body.data[0]!.asset.scanStatus).toBe("pending");
    expect(body.data[0]!.download).toBeNull(); // never an unsigned URL
  });

  it("accepts bearer tokens holding docs:read (§11 token plane)", async () => {
    vi.mocked(authenticate).mockImplementation(async () => TOKEN_CTX_READONLY as never);
    const repo = { listByWorkspace: vi.fn(async () => [assetRow()]) };
    mockWiring(
      repo,
      {
        downloadUrl: vi.fn(async () => ({
          url: "mem://formforge/media/ws_1/ast-1/hero.png?sig=t",
          key: assetRow().key,
          mime: "image/png",
          sizeBytes: 2048,
          scanStatus: "skipped",
          expiresInSeconds: 3600,
        })),
      },
    );
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets?limit=1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toHaveLength(1);
    expect(repo.listByWorkspace).toHaveBeenCalledWith("ws_1", { purpose: undefined, limit: 1 });
  });

  it("rejects bearer tokens without docs:read (403)", async () => {
    vi.mocked(authenticate).mockImplementation(async () => ({
      ...SESSION_CTX,
      actor: { kind: "token", tokenId: "t_1", scopes: ["submissions:read"] },
      scopes: ["submissions:read"],
    }) as never);
    mockWiring({ listByWorkspace: vi.fn() }, { downloadUrl: vi.fn() });
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets"));
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("maps repo failures to the §4 error envelope", async () => {
    mockWiring(
      {
        listByWorkspace: vi.fn(async () => {
          throw AppError.internal("db down");
        }),
      },
      { downloadUrl: vi.fn() },
    );
    const res = await listAssetsRoute(new Request("http://localhost/api/v1/assets"));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("INTERNAL");
  });
});
