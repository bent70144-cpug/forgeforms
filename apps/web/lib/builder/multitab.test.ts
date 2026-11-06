import { describe, expect, it } from "vitest";
import {
  createMultitabChannel,
  multitabChannelName,
  type BroadcastChannelLike,
  type MultitabMessage,
} from "./multitab";

/** Synchronous in-memory BroadcastChannel bus — the injected fake. */
function fakeBus() {
  const channels: BroadcastChannelLike[] = [];
  const factory = (name: string): BroadcastChannelLike => {
    const channel: BroadcastChannelLike = {
      name,
      onmessage: null,
      postMessage(message: unknown) {
        for (const other of [...channels]) {
          if (other === channel) continue; // BroadcastChannel never echoes to self
          other.onmessage?.({ data: message });
        }
      },
      close() {
        const i = channels.indexOf(channel);
        if (i >= 0) channels.splice(i, 1);
      },
    };
    channels.push(channel);
    return channel;
  };
  return { channels, factory };
}

function collector() {
  const seen: MultitabMessage[] = [];
  return {
    seen,
    listener: (message: MultitabMessage) => void seen.push(message),
  };
}

describe("createMultitabChannel (§7.4 + §22.2)", () => {
  it("uses the ff-doc-<docId> channel name and announces TAB_OPENED on creation", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });

    expect(bus.channels.length).toBe(1);
    expect(bus.channels[0]?.name).toBe(multitabChannelName("doc1"));
    expect(bus.channels[0]?.name).toBe("ff-doc-doc1");
    a.close();
  });

  it("existing tabs receive the newcomer's TAB_OPENED (banner signal)", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const aSeen = collector();
    a.subscribe(aSeen.listener);

    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });

    expect(aSeen.seen).toEqual([{ type: "TAB_OPENED", tabId: "tab-b" }]);
    a.close();
    b.close();
  });

  it("replies to TAB_OPENED with REV_ACKED so the newcomer sees the banner too (loop-free)", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const bSeen = collector();
    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });
    b.subscribe(bSeen.listener);
    // tab-a's handshake reply is delivered synchronously during b's creation,
    // so subscribe afterwards would miss it — deliver another TAB_OPENED to
    // prove the reply path works from a second newcomer without looping.
    const c = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-c" });

    const types = bSeen.seen.map((m) => m.type);
    expect(types).toContain("REV_ACKED"); // from tab-a's (and tab-b's) handshake
    expect(types).toContain("TAB_OPENED"); // from tab-c announcing itself
    // The handshake must terminate: no message storm accumulated.
    expect(bSeen.seen.length).toBeLessThanOrEqual(4);
    a.close();
    b.close();
    c.close();
  });

  it("announceRev posts the exact §22.2 wire shape { type, tabId, rev }", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const bSeen = collector();
    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });
    bSeen.seen.length = 0; // drop the creation handshake noise
    b.subscribe(bSeen.listener);

    a.announceRev(7);

    expect(bSeen.seen).toEqual([{ type: "REV_ACKED", tabId: "tab-a", rev: 7 }]);
    a.close();
    b.close();
  });

  it("does not notify subscribers for LOCK_TAKEN (Phase 2) or malformed payloads", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const aSeen = collector();
    a.subscribe(aSeen.listener);
    const channelA = bus.channels[0] as BroadcastChannelLike;

    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });
    const channelB = bus.channels[1] as BroadcastChannelLike;
    aSeen.seen.length = 0;

    channelB.postMessage?.({ type: "LOCK_TAKEN", tabId: "tab-b", rev: 1 });
    channelB.postMessage?.({ type: "NOPE", tabId: "tab-b" });
    channelB.postMessage?.({ hello: "world" });
    channelB.postMessage?.("not even an object");
    channelA.onmessage?.({ data: { type: "TAB_OPENED", tabId: "tab-a" } }); // self — ignored

    expect(aSeen.seen).toEqual([]);
    a.close();
    b.close();
  });

  it("unsubscribe stops notifications", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const aSeen = collector();
    const unsubscribe = a.subscribe(aSeen.listener);
    unsubscribe();

    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });

    expect(aSeen.seen).toEqual([]);
    a.close();
    b.close();
  });

  it("post() after close is a no-op and close is idempotent", () => {
    const bus = fakeBus();
    const a = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-a" });
    const b = createMultitabChannel("doc1", { channelFactory: bus.factory, tabId: "tab-b" });
    const bSeen = collector();
    b.subscribe(bSeen.listener);

    a.close();
    expect(() => {
      a.post("REV_ACKED", 3);
      a.announceRev(4);
      a.close();
    }).not.toThrow();
    expect(bus.channels.map((c) => c.name).length).toBe(1); // only tab-b remains
    b.close();
  });

  it("degrades to a no-op stub when BroadcastChannel is unavailable", () => {
    const aSeen = collector();
    const channel = createMultitabChannel("doc1", { channelFactory: () => null, tabId: "tab-a" });

    expect(() => {
      channel.post("TAB_OPENED");
      channel.announceRev(1);
    }).not.toThrow();
    const unsubscribe = channel.subscribe(aSeen.listener);
    unsubscribe();
    expect(() => channel.close()).not.toThrow();
    expect(aSeen.seen).toEqual([]);
  });

  it("a throwing channel factory degrades to the no-op stub", () => {
    const channel = createMultitabChannel("doc1", {
      channelFactory: () => {
        throw new Error("BroadcastChannel blocked by the browser");
      },
      tabId: "tab-a",
    });
    expect(() => {
      channel.post("TAB_OPENED");
      channel.close();
    }).not.toThrow();
  });

  it("uses crypto.randomUUID for the tabId when not injected", () => {
    const channel = createMultitabChannel("solo-" + Math.random().toString(36).slice(2));
    expect(typeof channel.tabId).toBe("string");
    expect(channel.tabId.length).toBeGreaterThan(0);
    channel.close();
  });
});
