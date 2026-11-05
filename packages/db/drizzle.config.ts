import { defineConfig } from "drizzle-kit";

// drizzle-kit pipeline (spec §2/§6): `pnpm --filter @formforge/db db:generate`
// diffs src/schema against packages/db/drizzle and emits plain SQL migrations
// that CI applies later (`db:migrate`). No live DB is needed for `generate`.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  strict: true,
  verbose: true,
  // Only used by drizzle-kit commands that talk to a live DB (migrate/push).
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/formforge",
  },
});
