// apps/web/app/api/public/ingest/_lib/deps.ts
// Production wiring for the public ingest service (T14). Builds the IngestDeps
// seams once per process and caches on globalThis (survives Next dev HMR).
//
// INTEGRATION-DEBT:
// - block registry: bootstrap registry (spec §7.2 shapes) until T04/T05 land.
// - snapshot reader: minimal drizzle reader in @formforge/db; compiles routing
//   from rendered.logic rules THROUGH THE T13 ENGINE (T20) when T10 hasn't.
// - rate limiter: in-memory token bucket — per-process only; swap to a Redis
//   limiter for multi-instance deploys.
// - usage counter: in-memory placeholder until billing lands.

import { uuidv7, type Block, type Rule, type Snapshot } from "@formforge/core/bridge";
import { compiledRouting, engineEvaluate } from "@/lib/ingest/engine";
import {
  CaptureEventQueue,
  InMemoryIdempotencyStore,
  InMemoryRateLimiter,
  InMemoryUsageCounter,
  StubTurnstileVerifier,
  createBootstrapBlockRegistry,
  type BlockRegistry,
  type IngestDeps,
} from "@formforge/core/submissions";
import {
  connectSubmissionsStore,
  type SnapshotLike,
} from "@formforge/db/repositories/submissions";
import { createRedisIdempotencyStore } from "./idempotency";
import { createBullMqEventQueue } from "./queue";
import { createRealTurnstileVerifier } from "./turnstile";

type Wiring = { deps: IngestDeps; dispose: () => Promise<void> };

const globalStore = globalThis as unknown as { __ffIngestWiring?: Wiring };

export async function getIngestDeps(): Promise<IngestDeps> {
  globalStore.__ffIngestWiring ??= await buildWiring();
  return globalStore.__ffIngestWiring.deps;
}

async function buildWiring(): Promise<Wiring> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for the public ingest API");
  }
  const store = await connectSubmissionsStore(databaseUrl);
  const redisUrl = process.env.REDIS_URL;
  const blocks = createBootstrapBlockRegistry();

  const deps: IngestDeps = {
    repo: store.repo,
    snapshots: {
      getPublishedSnapshot: async (documentId: string) => {
        const raw = await store.snapshots.getPublishedSnapshot(documentId);
        return raw ? toSnapshot(raw, blocks) : null;
      },
    },
    blocks,
    idempotency: redisUrl
      ? createRedisIdempotencyStore(redisUrl)
      : new InMemoryIdempotencyStore(),
    // INTEGRATION-DEBT: per-process limiter; see file header.
    rateLimiter: new InMemoryRateLimiter(),
    turnstile: process.env.TURNSTILE_SECRET_KEY
      ? createRealTurnstileVerifier(process.env.TURNSTILE_SECRET_KEY)
      : new StubTurnstileVerifier(),
    // Without REDIS_URL (local dev without docker) events are captured and dropped.
    queue: redisUrl ? createBullMqEventQueue(redisUrl) : new CaptureEventQueue(),
    usage: new InMemoryUsageCounter(),
    now: () => new Date(),
    generateId: uuidv7,
    // T20 (issue #20): ingest computes `next` through the T13 logic engine —
    // the same package surface the builder canvas + publish lint use.
    evaluate: engineEvaluate,
  };
  return { deps, dispose: store.close };
}

/** Map the db-layer snapshot DTO to the core Snapshot (compile via the T13 engine if T10 hasn't). */
function toSnapshot(raw: SnapshotLike, _blocks: BlockRegistry): Snapshot {
  let routing = raw.routing as Snapshot["routing"];
  if (Object.keys(routing).length === 0 && (raw.logicRules?.length ?? 0) > 0) {
    const blockList = raw.blocks as Block[];
    routing = compiledRouting(raw.logicRules as Rule[], blockList, raw.endings);
  }
  return {
    documentId: raw.documentId,
    workspaceId: raw.workspaceId,
    versionId: raw.versionId,
    type: raw.type,
    title: raw.title,
    blocks: raw.blocks as Block[],
    endings: raw.endings,
    routing,
    settings: raw.settings,
  };
}
