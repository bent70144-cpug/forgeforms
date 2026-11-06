import { describe, expect, it } from "vitest";
import { ConsoleAuditLog, InMemoryAuditLog, newAuditEntry } from "../src/audit.ts";
import { fixedNow } from "./fakes.ts";

const entry = () =>
  newAuditEntry({
    workspaceId: "ws_1",
    actorType: "mcp",
    actorId: "token_1",
    action: "publish_document",
    target: "doc_1",
    createdAt: fixedNow(),
    status: "ok",
  });

describe("InMemoryAuditLog", () => {
  it("stores every appended entry in order", () => {
    const log = new InMemoryAuditLog();
    log.append(entry());
    log.append({ ...entry(), action: "create_document", status: "error", errorCode: "FORBIDDEN" });

    expect(log.entries).toHaveLength(2);
    expect(log.entries[0]?.action).toBe("publish_document");
    expect(log.entries[1]?.status).toBe("error");
    expect(log.byAction("create_document")).toHaveLength(1);
  });
});

describe("ConsoleAuditLog", () => {
  it("writes one JSON line per entry to the injected sink (stderr in production)", () => {
    const lines: string[] = [];
    const log = new ConsoleAuditLog((line) => lines.push(line));
    log.append(entry());

    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(parsed).toMatchObject({
      workspaceId: "ws_1",
      actorType: "mcp",
      actorId: "token_1",
      action: "publish_document",
      target: "doc_1",
      status: "ok",
      createdAt: "2026-11-06T12:00:00.000Z",
    });
    expect(typeof parsed.id).toBe("string");
  });
});

describe("audit entry shape (spec §6 audit_log columns)", () => {
  it("carries id, workspaceId, actorType, actorId, action, target, createdAt", () => {
    const audit = entry();
    expect(audit.id).toBeTruthy();
    expect(audit.workspaceId).toBe("ws_1");
    expect(audit.actorType).toBe("mcp");
    expect(audit.actorId).toBe("token_1");
    expect(audit.action).toBe("publish_document");
    expect(audit.target).toBe("doc_1");
    expect(audit.createdAt).toBeInstanceOf(Date);
  });
});
