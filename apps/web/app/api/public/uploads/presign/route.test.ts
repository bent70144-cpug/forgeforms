// Route handler tests for the public upload plane (T16): workspace resolution
// from the PUBLISHED documentId, over-cap rejection BEFORE presign, spoof
// handling at confirm, §4 error mapping. The wiring + service are mocked —
// route wiring only (the service itself is covered in @formforge/core).
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@formforge/core";

vi.mock("../../../../../lib/assets/server", () => ({
  getPublicAssetsDeps: vi.fn(),
}));

import { POST as presignRoute } from "./route";
import { POST as confirmRoute } from "../confirm/route";
import { getPublicAssetsDeps } from "../../../../../lib/assets/server";

type ServiceMock = {
  presign: ReturnType<typeof vi.fn>;
  confirm: ReturnType<typeof vi.fn>;
};

const WS = "11111111-1111-4111-8111-111111111111";

function mockDeps(opts: {
  workspace?: string | null;
  presign?: ServiceMock["presign"];
  confirm?: ServiceMock["confirm"];
}): ServiceMock {
  const service: ServiceMock = {
    presign: opts.presign ?? vi.fn(),
    confirm: opts.confirm ?? vi.fn(),
  };
  vi.mocked(getPublicAssetsDeps).mockReturnValue({
    service: service as never,
    resolvePublishedWorkspace: vi.fn(async () => opts.workspace === undefined ? WS : opts.workspace),
  } as never);
  return service;
}

const PRESIGN_BODY = {
  documentId: "doc_4fRq3xkLmNr8VmkAMfeRBT",
  fileName: "photo.png",
  mime: "image/png",
  sizeBytes: 1024,
};

beforeEach(() => {
  vi.mocked(getPublicAssetsDeps).mockReset();
});

function jsonRequest(body?: unknown, url = "http://localhost/api/public/uploads/presign"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("POST /api/public/uploads/presign", () => {
  it("resolves the workspace from the published document and presigns (purpose upload)", async () => {
    const service = mockDeps({
      presign: vi.fn(async () => ({
        assetId: "ast-1",
        key: `upload/${WS}/ast-1/photo.png`,
        uploadUrl: "https://s3.test/put",
        mime: "image/png",
        maxSizeMb: 10,
        expiresInSeconds: 600,
        scanStatus: "pending",
      })),
    });
    const res = await presignRoute(jsonRequest(PRESIGN_BODY));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ assetId: "ast-1", maxSizeMb: 10, expiresInSeconds: 600 });
    expect(service.presign).toHaveBeenCalledWith({
      workspaceId: WS, // resolved server-side — never from the client
      purpose: "upload",
      fileName: "photo.png",
      mime: "image/png",
      sizeBytes: 1024,
    });
  });

  it("404s unknown/unpublished documents (indistinguishable, §10.3)", async () => {
    mockDeps({ workspace: null });
    const res = await presignRoute(jsonRequest(PRESIGN_BODY));
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("maps the over-cap VALIDATION error (acceptance: rejected BEFORE presign)", async () => {
    const service = mockDeps({
      presign: vi.fn(async () => {
        throw AppError.validation("Upload exceeds size limit", [
          { path: "sizeBytes", message: "File exceeds the 10 MB upload limit" },
        ]);
      }),
    });
    const res = await presignRoute(jsonRequest({ ...PRESIGN_BODY, sizeBytes: 10 * 1024 * 1024 + 1 }));
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe("VALIDATION");
    expect(body.error.details[0]!.path).toBe("sizeBytes");
    expect(service.presign).toHaveBeenCalledTimes(1); // threw inside the service
  });

  it("422s disallowed mimes and path-traversal file names", async () => {
    mockDeps({
      presign: vi.fn(async () => {
        throw AppError.validation("File type is not allowed", [{ path: "mime", message: "nope" }]);
      }),
    });
    const mimeRes = await presignRoute(jsonRequest({ ...PRESIGN_BODY, mime: "application/x-msdownload" }));
    expect(mimeRes.status).toBe(422);

    mockDeps({ presign: vi.fn(async () => ({ assetId: "x" })) });
    const nameRes = await presignRoute(jsonRequest({ ...PRESIGN_BODY, fileName: "../escape.png" }));
    expect(nameRes.status).toBe(422);
  });

  it("422s malformed bodies", async () => {
    mockDeps({});
    const res = await presignRoute(jsonRequest({ documentId: 42 }));
    expect(res.status).toBe(422);
    const res2 = await presignRoute(jsonRequest("not-an-object"));
    expect(res2.status).toBe(422);
  });
});

describe("POST /api/public/uploads/confirm", () => {
  it("confirms and returns the scan-pending status", async () => {
    const service = mockDeps({
      confirm: vi.fn(async () => ({ assetId: "ast-1", key: "k", mime: "image/png", scanStatus: "pending" })),
    });
    const res = await confirmRoute(jsonRequest({ assetId: "ast-1" }, "http://localhost/api/public/uploads/confirm"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ assetId: "ast-1", scanStatus: "pending" });
    expect(service.confirm).toHaveBeenCalledWith({ assetId: "ast-1" });
  });

  it("maps the spoof rejection (VALIDATION with the magic-byte detail)", async () => {
    mockDeps({
      confirm: vi.fn(async () => {
        throw AppError.validation("Upload rejected", [
          { path: "mime", message: "Content does not match its declared type (magic-byte check: application/x-msdownload)" },
        ]);
      }),
    });
    const res = await confirmRoute(
      jsonRequest({ assetId: "ast-9" }, "http://localhost/api/public/uploads/confirm"),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: { details: Array<{ path: string; message: string }> } };
    expect(body.error.details[0]!.path).toBe("mime");
    expect(body.error.details[0]!.message).toContain("magic-byte");
  });

  it("404s unknown assets", async () => {
    mockDeps({
      confirm: vi.fn(async () => {
        throw AppError.notFound("Asset not found");
      }),
    });
    const res = await confirmRoute(
      jsonRequest({ assetId: "missing" }, "http://localhost/api/public/uploads/confirm"),
    );
    expect(res.status).toBe(404);
  });
});
