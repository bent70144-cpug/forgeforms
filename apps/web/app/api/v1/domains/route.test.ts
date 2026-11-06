// Route handler tests for /api/v1/domains (issue #24): auth, payload
// validation, PLAN_LIMIT→402 mapping, remove + list shapes. The domains
// service and the auth gate are mocked — route wiring only.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppError, ok, err } from "@formforge/core/domains";

vi.mock("../../../../lib/domains/server", () => ({
  getDomainsService: vi.fn(),
  routingTarget: vi.fn(() => "sites.formforge.test"),
}));

vi.mock("../_lib/auth", () => ({
  authenticate: vi.fn(),
}));

import { DELETE, GET, POST } from "./route";
import { authenticate } from "../_lib/auth";
import { getDomainsService } from "../../../../lib/domains/server";

type ServiceMock = {
  addDomain: ReturnType<typeof vi.fn>;
  listDomains: ReturnType<typeof vi.fn>;
  removeDomain: ReturnType<typeof vi.fn>;
};

const DOMAIN_PENDING = {
  id: "018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f70",
  workspaceId: "ws_1",
  hostname: "docs.example.com",
  documentId: "018f1c2e-7c1a-7cc2-9d3b-2f8a4d5e6f71",
  status: "pending" as const,
  verificationToken: "ab".repeat(16),
  lastCheckedAt: null,
  verifiedAt: null,
  lastError: null,
  provisionMode: "manual" as const,
  customHostnameId: null,
  createdAt: new Date("2026-11-06T12:00:00.000Z"),
  updatedAt: new Date("2026-11-06T12:00:00.000Z"),
};

const SESSION_CTX = {
  workspaceId: "ws_1",
  requestId: "req_1",
  actor: { kind: "session", userId: "u_1", role: "owner" },
  userId: "u_1",
  role: "owner",
  scopes: [],
  now: () => new Date(),
};

const TOKEN_CTX = {
  ...SESSION_CTX,
  actor: { kind: "token", tokenId: "t_1", scopes: ["docs:read"] },
  scopes: ["docs:read"],
};

function jsonRequest(method: string, body?: unknown, url = "http://localhost/api/v1/domains") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function mockService(): ServiceMock {
  const service = {
    addDomain: vi.fn(),
    listDomains: vi.fn(async () => [DOMAIN_PENDING]),
    removeDomain: vi.fn(async () => ({
      ok: true as const,
      value: { domainId: DOMAIN_PENDING.id, hostname: DOMAIN_PENDING.hostname, documentId: DOMAIN_PENDING.documentId, routingRemoved: false },
    })),
  };
  vi.mocked(getDomainsService).mockReturnValue(service as never);
  return service as ServiceMock;
}

beforeEach(() => {
  vi.mocked(authenticate).mockReset();
  vi.mocked(authenticate).mockResolvedValue(SESSION_CTX as never);
});

describe("GET /api/v1/domains", () => {
  it("lists domains with verification state and DNS lookup values", async () => {
    mockService();
    const response = await GET(new Request("http://localhost/api/v1/domains"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<Record<string, unknown>>; nextCursor: null };
    expect(body.nextCursor).toBeNull();
    expect(body.data[0]).toMatchObject({
      hostname: "docs.example.com",
      status: "pending",
      txtName: "_formforge-verify.docs.example.com",
      txtValue: `ff-domain-verification=${"ab".repeat(16)}`,
      cnameTarget: "sites.formforge.test",
      provisionMode: "manual",
    });
  });

  it("403 when a bearer token lacks docs:write", async () => {
    vi.mocked(authenticate).mockResolvedValue(TOKEN_CTX as never);
    const response = await GET(new Request("http://localhost/api/v1/domains"));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("FORBIDDEN");
  });
});

describe("POST /api/v1/domains", () => {
  it("401 without an authenticated context", async () => {
    vi.mocked(authenticate).mockRejectedValue(AppError.forbidden("Authentication required"));
    const response = await POST(jsonRequest("POST", { hostname: "docs.example.com", documentId: DOMAIN_PENDING.documentId }));
    expect(response.status).toBe(403);
  });

  it("422 on a malformed hostname", async () => {
    mockService();
    const response = await POST(jsonRequest("POST", { hostname: "not a domain!", documentId: DOMAIN_PENDING.documentId }));
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION");
  });

  it("402 PLAN_LIMIT maps from the service (spec §13 quota)", async () => {
    const service = mockService();
    service.addDomain.mockResolvedValue(err(AppError.planLimit("Plan limit reached for \"customDomains\" — upgrade to pro.", [
      { path: "capability", message: "customDomains" },
      { path: "requiredPlan", message: "pro" },
    ])));
    const response = await POST(jsonRequest("POST", { hostname: "docs.example.com", documentId: DOMAIN_PENDING.documentId }));
    expect(response.status).toBe(402);
    const body = (await response.json()) as { error: { code: string; details: { capability?: string } } };
    expect(body.error.code).toBe("PLAN_LIMIT");
    expect(body.error.details.capability).toBe("customDomains");
  });

  it("409 on a hostname that is already attached", async () => {
    const service = mockService();
    service.addDomain.mockResolvedValue(err(new AppError("CONFLICT", "Hostname docs.example.com is already attached")));
    const response = await POST(jsonRequest("POST", { hostname: "docs.example.com", documentId: DOMAIN_PENDING.documentId }));
    expect(response.status).toBe(409);
  });

  it("201 with the pending domain + DNS instructions", async () => {
    const service = mockService();
    service.addDomain.mockResolvedValue(
      ok({
        domain: DOMAIN_PENDING,
        instructions: {
          mode: "manual",
          records: [
            { type: "TXT", name: "_formforge-verify.docs.example.com", value: `ff-domain-verification=${"ab".repeat(16)}`, purpose: "prove" },
            { type: "CNAME", name: "docs.example.com", value: "sites.formforge.test", purpose: "route" },
          ],
        },
      }),
    );
    const response = await POST(jsonRequest("POST", { hostname: "docs.example.com", documentId: DOMAIN_PENDING.documentId }));
    expect(response.status).toBe(201);
    const body = (await response.json()) as { domain: { status: string }; instructions: { records: unknown[] } };
    expect(body.domain.status).toBe("pending");
    expect(body.instructions.records).toHaveLength(2);
  });
});

describe("DELETE /api/v1/domains", () => {
  it("204 on success", async () => {
    mockService();
    const response = await DELETE(jsonRequest("DELETE", undefined, "http://localhost/api/v1/domains?id=" + DOMAIN_PENDING.id));
    expect(response.status).toBe(204);
  });

  it("422 when the id query parameter is missing", async () => {
    mockService();
    const response = await DELETE(jsonRequest("DELETE", undefined, "http://localhost/api/v1/domains"));
    expect(response.status).toBe(422);
  });

  it("404 when the domain is not in this workspace", async () => {
    const service = mockService();
    service.removeDomain.mockResolvedValue(err(AppError.notFound("Domain not found")));
    const response = await DELETE(jsonRequest("DELETE", undefined, "http://localhost/api/v1/domains?id=" + DOMAIN_PENDING.id));
    expect(response.status).toBe(404);
  });
});
