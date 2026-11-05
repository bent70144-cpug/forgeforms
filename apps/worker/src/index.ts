// FormForge worker entrypoint (T01 scaffold).
// SPEC-NOTE: T17 (issue #17) owns the real queue topology (events fan-out,
// webhooks, email, rollups, exports). This skeleton only proves the dev loop:
// `docker compose up -d && pnpm dev` runs web + worker together.
import { Worker } from "bullmq";
import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });

const worker = new Worker(
  "jobs",
  async (job) => {
    console.log(
      JSON.stringify({ level: "info", msg: "job processed", id: job.id, name: job.name }),
    );
  },
  { connection },
);

async function shutdown(signal: string): Promise<void> {
  console.log(JSON.stringify({ level: "info", msg: "worker shutting down", signal }));
  await worker.close();
  connection.disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

console.log(
  JSON.stringify({ level: "info", msg: "worker started", queue: "jobs", redis: redisUrl }),
);
