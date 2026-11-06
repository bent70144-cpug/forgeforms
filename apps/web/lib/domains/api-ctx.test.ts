// Ctx adapter tests (issue #24): the /api/v1 auth plane Ctx must map onto the
// §3 module-contract Ctx the domains service consumes — actor kinds collapse
// to {type, id}, workspace/requestId/clock pass through untouched.
import { describe, expect, it } from "vitest";
import { makeCtx } from "@formforge/core/api";
import { toServiceCtx } from "./api-ctx";

describe("toServiceCtx — API plane → module-contract Ctx", () => {
  it("maps a session actor to { type: 'user', id: userId }", () => {
    const apiCtx = makeCtx({
      workspaceId: "ws_1",
      actor: { kind: "session", userId: "u_7", role: "owner" },
      requestId: "req_1",
    });
    const ctx = toServiceCtx(apiCtx);
    expect(ctx.workspaceId).toBe("ws_1");
    expect(ctx.requestId).toBe("req_1");
    expect(ctx.actor).toEqual({ type: "user", id: "u_7" });
  });

  it("maps a token actor to { type: 'token', id: tokenId } (scopes stay on the API plane)", () => {
    const apiCtx = makeCtx({
      workspaceId: "ws_2",
      actor: { kind: "token", tokenId: "tok_9", scopes: ["docs:write"] },
    });
    const ctx = toServiceCtx(apiCtx);
    expect(ctx.actor).toEqual({ type: "token", id: "tok_9" });
    expect("scopes" in ctx).toBe(false);
  });

  it("maps the system actor verbatim", () => {
    const apiCtx = makeCtx({ workspaceId: "ws_3", actor: { kind: "system" } });
    expect(toServiceCtx(apiCtx).actor).toEqual({ type: "system", id: "system" });
  });

  it("delegates the clock so services read the same instants as the route", () => {
    const fixed = new Date("2026-11-06T12:00:00.000Z");
    const apiCtx = makeCtx({ workspaceId: "ws_4", now: () => fixed });
    const ctx = toServiceCtx(apiCtx);
    expect(ctx.now()).toEqual(fixed);
    expect(ctx.now().getTime()).toBe(ctx.now().getTime());
  });
});
