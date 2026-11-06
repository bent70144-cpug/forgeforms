// packages/mcp/src/audit.ts — audit logging (issue #26; spec §6 `audit_log`).
// Every MCP tool call — successful or failed — is appended exactly once through
// the injected AuditLog. The server never imports a concrete sink itself; the
// process composition root picks one (ConsoleAuditLog for stdio usage).
import { randomUUID } from "node:crypto";
import type { ActorType, AppErrorCode } from "@formforge/core";

// SPEC-NOTE: shape mirrors spec §6 `audit_log` columns (id, workspace_id,
// actor_type, actor_id, action, target, created_at). Two additive fields are
// included for operability (`status`, `errorCode`); the spec table has no such
// columns, so a future DB-backed AuditLog may drop them or persist them
// elsewhere. `workspaceId`/`actorId` are nullable ONLY for calls rejected
// before token resolution (e.g. an invalid API token) where the workspace
// cannot be attributed; spec declares `workspace_id not null`, so a DB-backed
// implementation may choose to skip those rows or use a sentinel.
export type AuditEntry = {
  id: string;
  workspaceId: string | null;
  actorType: ActorType;
  actorId: string | null;
  action: string;
  target: string | null;
  createdAt: Date;
  status: "ok" | "error";
  errorCode?: AppErrorCode;
};

export interface AuditLog {
  append(entry: AuditEntry): void | Promise<void>;
}

export function newAuditEntry(entry: Omit<AuditEntry, "id">): AuditEntry {
  // INTEGRATION-DEBT: awaiting T02 — use the shared uuidv7() helper from
  // @formforge/core (spec §4 "IDs: UUIDv7") instead of randomUUID().
  return { id: randomUUID(), ...entry };
}

/**
 * Writes one JSON line per entry to stderr. Stderr (not stdout!) because the
 * stdio MCP transport reserves stdout for the JSON-RPC protocol stream.
 */
export class ConsoleAuditLog implements AuditLog {
  private readonly sink: (line: string) => void;

  constructor(sink: (line: string) => void = (line) => console.error(line)) {
    this.sink = sink;
  }

  append(entry: AuditEntry): void {
    this.sink(
      JSON.stringify({
        ...entry,
        createdAt: entry.createdAt.toISOString(),
      }),
    );
  }
}

/** Array-backed implementation for tests and inspection. */
export class InMemoryAuditLog implements AuditLog {
  readonly entries: AuditEntry[] = [];

  append(entry: AuditEntry): void {
    this.entries.push(entry);
  }

  byAction(action: string): AuditEntry[] {
    return this.entries.filter((entry) => entry.action === action);
  }
}
