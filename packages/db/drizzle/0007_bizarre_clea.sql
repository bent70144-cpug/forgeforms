-- T16 (issue #16) — assets table (spec §6) + RLS + grants.
--
-- Hand-assembled from `drizzle-kit generate` output (the generate diff
-- re-emitted the whole schema because earlier snapshots lagged the committed
-- migrations — see PR notes); this file carries ONLY the assets delta so it
-- applies cleanly on a fully migrated database.
--
-- RLS + grants live here (not in 0003) because 0003's future-tables block
-- already ran before this DDL existed — its to_regclass() guards skipped
-- assets. Re-applying 0003 remains safe (idempotent).

CREATE TABLE "assets" (
        "id" uuid PRIMARY KEY NOT NULL,
        "workspace_id" uuid NOT NULL,
        "key" text NOT NULL,
        "mime" text NOT NULL,
        "size_bytes" bigint NOT NULL,
        "purpose" text NOT NULL,
        "scan_status" text DEFAULT 'pending' NOT NULL,
        "confirmed_at" timestamp with time zone,
        "variants" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        CONSTRAINT "assets_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE INDEX "assets_workspace_id_created_at_idx" ON "assets" USING btree ("workspace_id","created_at" DESC NULLS LAST);
--> statement-breakpoint
-- Row-level security (spec §6 note; keyed like 0003 on app.workspace_id).
ALTER TABLE "assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON "assets";
--> statement-breakpoint
CREATE POLICY tenant_isolation ON "assets"
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- Public ingest plane resolves an asset by its unguessable uuid before any
-- workspace is known (mirror of 0003's `ingest_token_plane` on submissions):
-- SELECT is allowed, writes stay tenant-strict via tenant_isolation.
DROP POLICY IF EXISTS ingest_asset_read ON "assets";
--> statement-breakpoint
CREATE POLICY ingest_asset_read ON "assets"
  FOR SELECT TO formforge_ingest
  USING (true);
--> statement-breakpoint
-- Application plane: full CRUD (mirrors 0003's app grants, which predate the
-- table).
GRANT SELECT, INSERT, UPDATE, DELETE ON "assets" TO formforge_app;
--> statement-breakpoint
-- Public ingest plane (spec §6: "limited to submissions, answers, assets
-- inserts/updates for published documents"): SELECT/INSERT/UPDATE, no DELETE.
GRANT SELECT, INSERT, UPDATE ON "assets" TO formforge_ingest;
