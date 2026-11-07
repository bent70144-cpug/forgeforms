// Tests for the §15 telemetry sink (builder audit follow-up #9).
//
// Two seams keep these tests environment-free (vitest node env, no jsdom):
//   • setTelemetrySink    — synchronous capture, replaces the whole pipeline;
//   • setTelemetryDelivery — swaps only the network call so batching, the
//     10 s/20-event flush, the pagehide beacon and the keepalive fallback all
//     run for real under fake timers + stubbed globals.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TELEMETRY_ENDPOINT,
  TELEMETRY_FLUSH_INTERVAL_MS,
  TELEMETRY_FLUSH_MAX_EVENTS,
  TELEMETRY_PREFIX,
  flushTelemetry,
  setTelemetryDelivery,
  setTelemetrySink,
  track,
  type TelemetryEvent,
} from "./telemetry";

afterEach(() => {
  setTelemetrySink(null);
  setTelemetryDelivery(null);
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// Browser-ish environment for the queue pipeline: a window whose listeners can
// be dispatched by the test, plus an optional navigator.sendBeacon (omitted →
// the sink must take the keepalive-fetch fallback). Blob/fetch are node globals.
function stubBrowser(sendBeacon?: (url: string, blob: Blob) => boolean) {
  const listeners = new Map<string, (event?: unknown) => void>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn((name: string, handler: (event?: unknown) => void) => {
      listeners.set(name, handler);
    }),
    removeEventListener: vi.fn((name: string) => {
      listeners.delete(name);
    }),
  });
  vi.stubGlobal(
    "navigator",
    sendBeacon ? { sendBeacon } : ({} as Navigator),
  );
  return {
    dispatchWindow: (type: string) => listeners.get(type)?.({ type }),
    pagehideInstalled: () => listeners.has("pagehide"),
  };
}

describe("track — capture sink seam (component-test surface)", () => {
  it("hands events synchronously to an injected sink", () => {
    const captured: TelemetryEvent[] = [];
    setTelemetrySink((event, props) => captured.push({ event, props }));

    track("template_used", { id: "contact-form" });
    track("ai_applied", { opsCount: 3 });
    track("builder_opened");

    expect(captured).toEqual([
      { event: "template_used", props: { id: "contact-form" } },
      { event: "ai_applied", props: { opsCount: 3 } },
      { event: "builder_opened", props: {} },
    ]);
  });

  it("never throws on omitted props and restores the default pipeline on null", async () => {
    setTelemetrySink(() => {
      throw new Error("sink exploded");
    });
    expect(() => track("builder_opened")).toThrow("sink exploded");

    setTelemetrySink(null);
    // Back to the default pipeline: in tests it is a silent no-op — no throw.
    expect(() => track("builder_opened")).not.toThrow();
    // Nothing queued → flush is a no-op success.
    await expect(flushTelemetry()).resolves.toBe(true);
  });
});

describe("track — default pipeline gates", () => {
  it("is a no-op without a browser (SSR/static render)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const deliver = vi.fn(async () => undefined);
    setTelemetryDelivery(deliver);
    track("builder_opened");
    await expect(flushTelemetry()).resolves.toBe(true);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("is silent in tests unless a delivery was injected", async () => {
    // NODE_ENV=test (vitest default), no injection → dropped, queue stays empty.
    expect(() => track("builder_opened")).not.toThrow();
    await expect(flushTelemetry()).resolves.toBe(true);
  });

  it("keeps the [ff-telemetry] console.debug line in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const debug = vi.fn();
    vi.stubGlobal("console", { debug });
    stubBrowser();
    setTelemetryDelivery(async () => undefined);

    track("undo");

    expect(debug).toHaveBeenCalledWith(`${TELEMETRY_PREFIX} undo`, {});
    await expect(flushTelemetry()).resolves.toBe(true);
  });
});

describe("sink queue — batching and flush (10 s / 20 events)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "production");
  });

  it("flushes the whole queue after ~10 s", async () => {
    const deliver = vi.fn(async (_batch: readonly TelemetryEvent[]) => undefined);
    setTelemetryDelivery(deliver);
    stubBrowser();

    track("block_added", { kind: "short-text" });
    track("block_moved");
    track("undo");
    expect(deliver).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_INTERVAL_MS);

    expect(deliver).toHaveBeenCalledTimes(1);
    const batch = deliver.mock.calls[0]?.[0] as readonly TelemetryEvent[];
    expect(batch).toEqual([
      { event: "block_added", props: { kind: "short-text" } },
      { event: "block_moved", props: {} },
      { event: "undo", props: {} },
    ]);
    // Queue drained: a manual flush afterwards is a no-op.
    await expect(flushTelemetry()).resolves.toBe(true);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("flushes immediately when the queue reaches 20 events", async () => {
    const deliver = vi.fn(async (_batch: readonly TelemetryEvent[]) => undefined);
    setTelemetryDelivery(deliver);
    stubBrowser();

    for (let i = 0; i < TELEMETRY_FLUSH_MAX_EVENTS; i++) track("block_added", { kind: "hero" });
    expect(deliver).toHaveBeenCalledTimes(1);
    expect((deliver.mock.calls[0]?.[0] as readonly TelemetryEvent[]).length).toBe(20);

    // The 10 s timer was cancelled by the size flush — no second delivery.
    await vi.advanceTimersByTimeAsync(TELEMETRY_FLUSH_INTERVAL_MS * 2);
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("swallows delivery failures (resolves false, never throws)", async () => {
    const deliver = vi.fn(async () => {
      throw new Error("network down");
    });
    setTelemetryDelivery(deliver);
    stubBrowser();

    track("redo");
    await expect(flushTelemetry()).resolves.toBe(false);
    expect(() => track("publish_ok", { issues: 0 })).not.toThrow();
  });
});

describe("sink queue — pagehide tail", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  it("sends the tail via navigator.sendBeacon on pagehide", async () => {
    const sendBeacon = vi.fn(() => true);
    const { dispatchWindow } = stubBrowser(sendBeacon);
    // The fetch delivery would be the wrong path for a pagehide tail — fail
    // the test if the sink used it.
    const deliver = vi.fn(async (_batch: readonly TelemetryEvent[]) => undefined);
    setTelemetryDelivery(deliver);

    track("autosave_ok", { opsCount: 4, ms: 82 });
    track("preview_opened");
    dispatchWindow("pagehide");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as unknown as [string, Blob];
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(await blob.text()).toBe(
      JSON.stringify({
        events: [
          { event: "autosave_ok", props: { opsCount: 4, ms: 82 } },
          { event: "preview_opened", props: {} },
        ],
      }),
    );
    // The fetch delivery never saw the tail, and the queue is drained.
    expect(deliver).not.toHaveBeenCalled();
    await expect(flushTelemetry()).resolves.toBe(true);
  });

  it("falls back to a keepalive fetch when sendBeacon is unavailable", async () => {
    const { dispatchWindow, pagehideInstalled } = stubBrowser(); // navigator without sendBeacon
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    track("conflict", { resolved: true });
    expect(pagehideInstalled()).toBe(true);
    dispatchWindow("pagehide");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TELEMETRY_ENDPOINT);
    expect(init.keepalive).toBe(true);
    expect(init.body).toBe(
      JSON.stringify({ events: [{ event: "conflict", props: { resolved: true } }] }),
    );
  });

  it("falls back to a keepalive fetch when sendBeacon rejects the payload", async () => {
    const sendBeacon = vi.fn(() => false);
    const { dispatchWindow } = stubBrowser(sendBeacon);
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({ ok: true }));
    vi.stubGlobal("fetch", fetchMock);

    track("block_deleted");
    dispatchWindow("pagehide");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.keepalive).toBe(true);
  });
});
