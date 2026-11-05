import { describe, expect, it } from "vitest";
import { createCtx, systemCtx } from "./ctx.ts";
import { buildAuditEntry } from "./audit.ts";
import { isUuidV7 } from "./ids.ts";

describe("Ctx", () => {
  it("createCtx applies defaults and overrides", () => {
    const ctx = createCtx({ workspaceId: "ws-1", actor: { type: "user", id: "u-1" } });
    expect(ctx.workspaceId).toBe("ws-1");
    expect(ctx.actor).toEqual({ type: "user", id: "u-1" });
    expect(ctx.requestId).toBeTruthy();
    expect(ctx.now()).toBeInstanceOf(Date);
  });

  it("systemCtx marks the actor as system (background jobs/seeds)", () => {
    const ctx = systemCtx("ws-2");
    expect(ctx.actor).toEqual({ type: "system", id: "system" });
    expect(ctx.workspaceId).toBe("ws-2");
  });
});

describe("buildAuditEntry — sample service using the module contract", () => {
  it("uses the injected ctx.now() clock — no hidden new Date()", () => {
    const frozen = new Date("2026-11-05T12:00:00.000Z");
    const clock = { calls: 0, now: () => (clock.calls++, frozen) };
    const ctx = createCtx({
      workspaceId: "ws-1",
      actor: { type: "user", id: "u-1" },
      requestId: "req-1",
      now: clock.now,
    });

    const entry = buildAuditEntry(ctx, "document.publish", "doc_1");

    // the sample service touched time exactly through ctx.now()
    expect(clock.calls).toBe(2); // id timestamp + row timestamp
    expect(entry.created_at).toBe(frozen);
    expect(entry.created_at.toISOString()).toBe("2026-11-05T12:00:00.000Z");

    // scoped by ctx fields
    expect(entry.workspace_id).toBe("ws-1");
    expect(entry.actor_type).toBe("user");
    expect(entry.actor_id).toBe("u-1");
    expect(entry.action).toBe("document.publish");
    expect(entry.target).toBe("doc_1");

    // the id is a UUIDv7 stamped with the frozen clock's ms
    expect(isUuidV7(entry.id)).toBe(true);
    const idMs = Number.parseInt(entry.id.replaceAll("-", "").slice(0, 12), 16);
    expect(idMs).toBe(frozen.getTime());
  });

  it("is deterministic under a frozen clock (id excluded — ids are unique per call)", () => {
    const frozen = new Date("2026-01-01T00:00:00.000Z");
    const ctx = createCtx({ workspaceId: "ws-9", now: () => frozen });
    const { id: _id1, ...a } = buildAuditEntry(ctx, "a");
    const { id: _id2, ...b } = buildAuditEntry(ctx, "a");
    expect(a).toEqual(b);
    expect(_id1).not.toBe(_id2); // fresh unique id each call
  });
});
