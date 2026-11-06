// Multi-tab coordination (spec §7.4 + §22.2 — followed exactly).
//
// Every builder tab for the same document joins `BroadcastChannel("ff-doc-<docId>")`
// and exchanges `{ type: "TAB_OPENED" | "REV_ACKED" | "LOCK_TAKEN", tabId, rev }`.
//
// - On creation the channel announces itself with `TAB_OPENED`.
// - Receiving `TAB_OPENED` or `REV_ACKED` notifies subscribers — that is the
//   signal for the "Open in another tab — edits there may conflict" banner
//   (§7.4; wave 3 wires the banner). Receiving `TAB_OPENED` also triggers a
//   single loop-free `REV_ACKED` reply so the *newcomer* tab learns it has
//   company too (BroadcastChannel never echoes to the sender).
// - `LOCK_TAKEN` is posted for Phase 2 (read-only takeover) but does not
//   notify subscribers yet.
//
// Graceful degradation: when `BroadcastChannel` is unavailable (SSR, old
// browsers) the channel becomes a no-op stub — nothing throws. The channel
// factory is injectable so tests can drive message delivery with plain
// objects (this repo's vitest runs in plain node, no DOM).

export type MultitabMessageType = "TAB_OPENED" | "REV_ACKED" | "LOCK_TAKEN";

/** §22.2 wire shape. `rev` is included when known (REV_ACKED after a save). */
export type MultitabMessage = {
  type: MultitabMessageType;
  tabId: string;
  rev?: number;
};

/** Structural subset of BroadcastChannel the channel needs (injectable). */
export type BroadcastChannelLike = {
  name: string;
  postMessage(message: unknown): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
};

export type MultitabChannelOptions = {
  /** Overrides the `BroadcastChannel` constructor (tests inject a fake bus). */
  channelFactory?: (name: string) => BroadcastChannelLike | null;
  /** Overrides `crypto.randomUUID()` (tests pin a stable tab id). */
  tabId?: string;
};

export type MultitabChannel = {
  readonly docId: string;
  readonly tabId: string;
  /** Broadcast a §22.2 message to the other tabs of this document. */
  post(type: MultitabMessageType, rev?: number): void;
  /** Convenience: post REV_ACKED with the freshly acked rev after a save. */
  announceRev(rev: number): void;
  /**
   * Registers a listener invoked for every received TAB_OPENED / REV_ACKED
   * (the §7.4 banner signal). Returns an unsubscribe function.
   */
  subscribe(listener: (message: MultitabMessage) => void): () => void;
  /** Stops listening and closes the underlying channel (idempotent). */
  close(): void;
};

/** §22.2 channel naming. */
export function multitabChannelName(docId: string): string {
  return `ff-doc-${docId}`;
}

function randomTabId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoObj?.randomUUID === "function") return cryptoObj.randomUUID();
  return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseMessage(data: unknown, selfTabId: string): MultitabMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const msg = data as { type?: unknown; tabId?: unknown; rev?: unknown };
  if (typeof msg.tabId !== "string" || msg.tabId === selfTabId) return null;
  if (msg.type !== "TAB_OPENED" && msg.type !== "REV_ACKED" && msg.type !== "LOCK_TAKEN") {
    return null;
  }
  return {
    type: msg.type,
    tabId: msg.tabId,
    ...(typeof msg.rev === "number" ? { rev: msg.rev } : {}),
  };
}

function defaultChannelFactory(name: string): BroadcastChannelLike | null {
  if (typeof BroadcastChannel !== "function") return null;
  try {
    return new BroadcastChannel(name) as unknown as BroadcastChannelLike;
  } catch {
    return null;
  }
}

/** Builds the multi-tab channel for one document. Never throws. */
export function createMultitabChannel(
  docId: string,
  options: MultitabChannelOptions = {},
): MultitabChannel {
  const tabId = options.tabId ?? randomTabId();
  const factory = options.channelFactory ?? defaultChannelFactory;

  let channel: BroadcastChannelLike | null = null;
  try {
    channel = factory(multitabChannelName(docId));
  } catch {
    channel = null;
  }
  const listeners = new Set<(message: MultitabMessage) => void>();

  const post = (type: MultitabMessageType, rev?: number): void => {
    if (!channel) return;
    const message: MultitabMessage = { type, tabId, ...(rev !== undefined ? { rev } : {}) };
    try {
      channel.postMessage(message);
    } catch {
      // Structured-clone failures etc. must never break the builder.
    }
  };

  const notify = (message: MultitabMessage): void => {
    for (const listener of listeners) {
      try {
        listener(message);
      } catch {
        // A broken banner listener must not break the other tabs' wiring.
      }
    }
  };

  if (channel) {
    channel.onmessage = (event: { data: unknown }) => {
      const message = parseMessage(event.data, tabId);
      if (!message) return;
      if (message.type === "TAB_OPENED") {
        // Loop-free handshake: tell the newcomer we exist (it will show the
        // §7.4 banner). REV_ACKED does not auto-reply, so this terminates.
        post("REV_ACKED");
        notify(message);
        return;
      }
      if (message.type === "REV_ACKED") {
        notify(message);
      }
      // LOCK_TAKEN: Phase 2 — posted but not yet surfaced.
    };
    // Announce this tab (§22.2) — existing tabs show the §7.4 banner and
    // each answers with a single REV_ACKED so the newcomer learns about them.
    post("TAB_OPENED");
  }

  return {
    docId,
    tabId,
    post,
    announceRev(rev: number): void {
      post("REV_ACKED", rev);
    },
    subscribe(listener: (message: MultitabMessage) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close(): void {
      listeners.clear();
      if (channel) {
        try {
          channel.close();
        } catch {
          // already closed — nothing to do
        }
        channel = null;
      }
    },
  };
}
