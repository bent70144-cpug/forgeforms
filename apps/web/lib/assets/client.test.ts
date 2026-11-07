// Unit tests for the v1 assets client (builder asset picker, §10) — mock
// fetch only, no network / S3 / DB. Covers the exact request contracts, the
// §4 error mapping and the presign → PUT → confirm orchestration order.
import { describe, expect, it } from "vitest";
import {
  confirmMediaUpload,
  listWorkspaceAssets,
  presignMediaUpload,
  putUploadToStorage,
  uploadMediaAsset,
  type FetchLike,
} from "./client";

type Call = { url: string; init?: RequestInit };

/** Records calls and routes by (url, method). */
function mockFetch(route: (call: Call) => { status: number; body?: unknown } | undefined): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (input, init) => {
    calls.push({ url: input, init });
    const matched = route({ url: input, init });
    if (!matched) return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "unrouted" } }), { status: 404 });
    return new Response(matched.body === undefined ? "" : JSON.stringify(matched.body), {
      status: matched.status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

const PRESIGN_OK = {
  assetId: "ast-1",
  key: "media/ws_1/ast-1/hero.png",
  uploadUrl: "https://s3.test/put",
  mime: "image/png",
  maxSizeMb: 10,
  expiresInSeconds: 600,
  scanStatus: "pending",
};

const CONFIRM_OK = { assetId: "ast-1", key: "media/ws_1/ast-1/hero.png", mime: "image/png", scanStatus: "pending" };

describe("presignMediaUpload", () => {
  it("POSTs the exact v1 contract with purpose media", async () => {
    const { fetchImpl, calls } = mockFetch((call) =>
      call.url === "/api/v1/assets/presign" ? { status: 200, body: PRESIGN_OK } : undefined,
    );
    const result = await presignMediaUpload({ fileName: "hero.png", mime: "image/png", sizeBytes: 2048 }, fetchImpl);
    expect(result.assetId).toBe("ast-1");
    expect(result.uploadUrl).toBe("https://s3.test/put");
    const init = calls[0]!.init!;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      fileName: "hero.png",
      mime: "image/png",
      sizeBytes: 2048,
      purpose: "media",
    });
  });

  it("surfaces the §4 error message on failure", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 422,
      body: { error: { code: "VALIDATION", message: "File exceeds the 10 MB upload limit" } },
    }));
    await expect(
      presignMediaUpload({ fileName: "big.png", mime: "image/png", sizeBytes: 999999999 }, fetchImpl),
    ).rejects.toThrow("File exceeds the 10 MB upload limit");
  });

  it("falls back to a friendly message on non-JSON error bodies", async () => {
    const fetchImpl: FetchLike = async () => new Response("Bad Gateway", { status: 502 });
    await expect(
      presignMediaUpload({ fileName: "a.png", mime: "image/png", sizeBytes: 1 }, fetchImpl),
    ).rejects.toThrow("Could not start the upload");
  });
});

describe("putUploadToStorage", () => {
  it("PUTs the raw bytes with the presigned content type", async () => {
    const { fetchImpl, calls } = mockFetch((call) =>
      call.url === "https://s3.test/put" ? { status: 200 } : undefined,
    );
    await putUploadToStorage(
      "https://s3.test/put",
      { name: "hero.png", type: "image/png", size: 4, body: "bytes" },
      "image/png",
      fetchImpl,
    );
    expect(calls[0]!.init).toMatchObject({ method: "PUT", headers: { "content-type": "image/png" } });
  });

  it("throws on a storage failure (non-2xx PUT)", async () => {
    const { fetchImpl } = mockFetch(() => ({ status: 403 }));
    await expect(
      putUploadToStorage(
        "https://s3.test/put",
        { name: "hero.png", type: "image/png", size: 4, body: "bytes" },
        "image/png",
        fetchImpl,
      ),
    ).rejects.toThrow("Upload failed — the file could not be stored");
  });
});

describe("confirmMediaUpload", () => {
  it("POSTs { assetId } and returns the scan status", async () => {
    const { fetchImpl, calls } = mockFetch((call) =>
      call.url === "/api/v1/assets/confirm" ? { status: 200, body: CONFIRM_OK } : undefined,
    );
    const result = await confirmMediaUpload({ assetId: "ast-1" }, fetchImpl);
    expect(result).toMatchObject({ assetId: "ast-1", scanStatus: "pending" });
    expect(JSON.parse(String(calls[0]!.init!.body))).toEqual({ assetId: "ast-1" });
  });
});

describe("listWorkspaceAssets", () => {
  it("GETs the §4 envelope with purpose/limit params", async () => {
    const { fetchImpl, calls } = mockFetch((call) =>
      call.url.startsWith("/api/v1/assets?")
        ? { status: 200, body: { data: [{ asset: { id: "ast-1", scanStatus: "skipped" }, download: null }], nextCursor: null } }
        : undefined,
    );
    const items = await listWorkspaceAssets({ purpose: "media", limit: 10 }, fetchImpl);
    expect(calls[0]!.url).toBe("/api/v1/assets?purpose=media&limit=10");
    expect(calls[0]!.init!.method).toBe("GET");
    expect(items).toHaveLength(1);
    expect(items[0]!.asset.id).toBe("ast-1");
  });

  it("defaults the limit to 50 and omits an unset purpose", async () => {
    const { fetchImpl, calls } = mockFetch(() => ({ status: 200, body: { data: [], nextCursor: null } }));
    await listWorkspaceAssets({}, fetchImpl);
    expect(calls[0]!.url).toBe("/api/v1/assets?limit=50");
  });

  it("maps errors to a friendly message", async () => {
    const { fetchImpl } = mockFetch(() => ({
      status: 403,
      body: { error: { code: "FORBIDDEN", message: "Credential missing the docs:read scope" } },
    }));
    await expect(listWorkspaceAssets({}, fetchImpl)).rejects.toThrow("Credential missing the docs:read scope");
  });
});

describe("uploadMediaAsset (presign → PUT → confirm)", () => {
  const file = { name: "hero.png", type: "image/png", size: 4, body: "bytes" };

  it("runs the three steps in order and reports each phase", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url === "/api/v1/assets/presign") return { status: 200, body: PRESIGN_OK };
      if (call.url === "https://s3.test/put") return { status: 200 };
      if (call.url === "/api/v1/assets/confirm") return { status: 200, body: CONFIRM_OK };
      return undefined;
    });
    const phases: string[] = [];
    const result = await uploadMediaAsset(file, (phase) => phases.push(phase), fetchImpl);
    expect(result).toMatchObject({ assetId: "ast-1", scanStatus: "pending" });
    expect(phases).toEqual(["presigning", "uploading", "confirming"]);
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/assets/presign", "https://s3.test/put", "/api/v1/assets/confirm"]);
  });

  it("aborts without confirming when the PUT fails", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url === "/api/v1/assets/presign") return { status: 200, body: PRESIGN_OK };
      if (call.url === "https://s3.test/put") return { status: 500 };
      return undefined;
    });
    await expect(uploadMediaAsset(file, () => {}, fetchImpl)).rejects.toThrow("Upload failed");
    expect(calls.map((c) => c.url)).toEqual(["/api/v1/assets/presign", "https://s3.test/put"]);
  });

  it("uses application/octet-stream when the file has no type", async () => {
    const { fetchImpl, calls } = mockFetch((call) => {
      if (call.url === "/api/v1/assets/presign") return { status: 200, body: { ...PRESIGN_OK, mime: "application/octet-stream" } };
      if (call.url === "https://s3.test/put") return { status: 200 };
      if (call.url === "/api/v1/assets/confirm") return { status: 200, body: { ...CONFIRM_OK, mime: "application/octet-stream" } };
      return undefined;
    });
    await uploadMediaAsset({ name: "blob", type: "", size: 1, body: "x" }, () => {}, fetchImpl);
    expect(JSON.parse(String(calls[0]!.init!.body))).toMatchObject({ mime: "application/octet-stream" });
  });
});
