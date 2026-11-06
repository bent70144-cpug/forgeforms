// Unit tests for the §15 telemetry stub. The sink is injected so these never
// touch the real console; production gating is asserted by faking the env.
import { afterEach, describe, expect, it, vi } from "vitest";
import { TELEMETRY_PREFIX, track } from "./telemetry";

function fakeSink() {
  return { debug: vi.fn() };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("track (spec §15 telemetry stub)", () => {
  it("logs the prefixed event name + props through the injected sink", () => {
    const sink = fakeSink();
    track("template_used", { id: "contact-form" }, sink);
    expect(sink.debug).toHaveBeenCalledTimes(1);
    expect(sink.debug).toHaveBeenCalledWith(`${TELEMETRY_PREFIX} template_used`, { id: "contact-form" });
  });

  it("never throws on omitted / undefined props (logs an empty object)", () => {
    const sink = fakeSink();
    expect(() => track("builder_opened", undefined, sink)).not.toThrow();
    expect(() => track("ai_applied", { opsCount: 3 }, sink)).not.toThrow();
    expect(sink.debug).toHaveBeenNthCalledWith(1, `${TELEMETRY_PREFIX} builder_opened`, {});
    expect(sink.debug).toHaveBeenNthCalledWith(2, `${TELEMETRY_PREFIX} ai_applied`, { opsCount: 3 });
  });

  it("is silent in production (spec: stub, not a real collector)", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sink = fakeSink();
    track("publish_ok", { documentId: "d1" }, sink);
    expect(sink.debug).not.toHaveBeenCalled();
  });
});
