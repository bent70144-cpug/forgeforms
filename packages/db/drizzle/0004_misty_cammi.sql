-- T07 documents (ticket #7) converged onto T04 tenancy (ticket #4) at
-- integration: 0002_crazy_magneto already created documents,
-- document_versions and snapshots with identical DDL (columns, the
-- unique (workspace_id, slug) constraint, the workspace_id/updated_at index
-- and the document/snapshot FKs). The single remaining delta from T07's
-- canonical schema is the document_versions.created_by → users FK, applied
-- here so the schema state after 0004 matches meta/0004_snapshot.json.
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
