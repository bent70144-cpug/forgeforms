// apps/web/app/api/public/ingest/_lib/idempotency.ts
// Redis-backed IdempotencyStore (spec §4: keys stored 24h, replay returns the
// original response).
//
// NOTE (untested here): this implementation is NOT exercised by the vitest
// suite (no Redis in unit CI); the in-memory store in @formforge/core is used
// for tests and as dev fallback. On Redis read failure we fail open (treat as
// a miss) so ingest stays available; only replays are lost.

import Redis from "ioredis";
import type {
  IdempotencyStore,
  StoredIdempotentResponse,
} from "@formforge/core/submissions";

const PREFIX = "ff:idem:";

export function createRedisIdempotencyStore(url: string): IdempotencyStore {
  const redis = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  return {
    async get(key: string): Promise<StoredIdempotentResponse | null> {
      try {
        const raw = await redis.get(PREFIX + key);
        return raw ? (JSON.parse(raw) as StoredIdempotentResponse) : null;
      } catch {
        return null;
      }
    },
    async put(key: string, response: StoredIdempotentResponse, ttlSeconds: number): Promise<void> {
      await redis.set(PREFIX + key, JSON.stringify(response), "EX", Math.max(1, ttlSeconds));
    },
  };
}
