-- Tenancy hardening (T04, issue #4 — spec §6 RLS note):
--   * row-level security on every tenant table, keyed on
--     current_setting('app.workspace_id')
--   * dedicated limited DB roles: formforge_app (application plane) and
--     formforge_ingest (public ingest plane; T14 may reuse)
--
-- IDEMPOTENT by construction:
--   * `ALTER TABLE … ENABLE ROW LEVEL SECURITY` is a no-op when already set
--   * policies are DROP POLICY IF EXISTS + CREATE POLICY (re-runs converge
--     to this file's definitions even if someone hand-edited them)
--   * roles are created only when missing; GRANTs are additive
--   * tables that do not exist yet (owned by later tickets) are skipped via
--     to_regclass() — re-apply this file after their DDL lands to pick their
--     policies up
--
-- SECURITY MODEL:
--   * users / workspaces are NOT tenant tables: users is the global login
--     plane and workspaces is the tenant root (its id IS app.workspace_id).
--   * The application plane MUST reach the DB through
--     withTenantScope() (packages/db/src/repositories/tenant.ts), which runs
--     `set local app.workspace_id = …; set local role formforge_app` per
--     transaction. SET ROLE makes RLS bind even when the connection user is
--     the table owner or a superuser (both otherwise bypass row security).
--   * Pre-auth lookups (login by email, token-hash lookup, registration)
--     deliberately run OUTSIDE the tenant scope (owner plane, RLS-bypassed);
--     see packages/db/TENANCY.md for the rationale and prod guidance.

-- ---------------------------------------------------------------------------
-- 1. Roles (cluster-level; created only when missing)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'formforge_app') THEN
    CREATE ROLE formforge_app NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'formforge_ingest') THEN
    CREATE ROLE formforge_ingest NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
-- The migration runner is the runtime connection user in the common setup
-- (same DATABASE_URL); let it assume the restricted roles for
-- `set local role …`. Superusers can do this regardless.
GRANT formforge_app TO CURRENT_USER;
--> statement-breakpoint
GRANT formforge_ingest TO CURRENT_USER;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO formforge_app, formforge_ingest;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 2. Enable RLS (idempotent no-ops when already enabled)
-- ---------------------------------------------------------------------------
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE document_versions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE snapshots ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE submissions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE answers ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 3. Policies — strict tenant isolation (fail closed: unset GUC ⇒ no rows)
-- ---------------------------------------------------------------------------
-- documents: direct workspace_id column.
DROP POLICY IF EXISTS tenant_isolation ON documents;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON documents
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- Public ingest plane may read published documents of any workspace (they are
-- public by definition); all other commands stay tenant-strict for it.
DROP POLICY IF EXISTS ingest_published_read ON documents;
--> statement-breakpoint
CREATE POLICY ingest_published_read ON documents
  FOR SELECT TO formforge_ingest
  USING (status = 'published');
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON document_versions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON document_versions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- snapshots: tenant key reachable through the owning document.
DROP POLICY IF EXISTS tenant_isolation ON snapshots;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON snapshots
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = snapshots.document_id
      AND d.workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = snapshots.document_id
      AND d.workspace_id = current_setting('app.workspace_id', true)::uuid
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS ingest_published_read ON snapshots;
--> statement-breakpoint
CREATE POLICY ingest_published_read ON snapshots
  FOR SELECT TO formforge_ingest
  USING (EXISTS (
    SELECT 1 FROM documents d
    WHERE d.id = snapshots.document_id
      AND d.status = 'published'
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS tenant_isolation ON submissions;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON submissions
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
-- The public plane resolves a submission by its opaque public_token before any
-- workspace is known; the unguessable token is the credential there. Writes
-- are NOT relaxed — ingest transactions must set app.workspace_id (TENANCY.md).
DROP POLICY IF EXISTS ingest_token_plane ON submissions;
--> statement-breakpoint
CREATE POLICY ingest_token_plane ON submissions
  FOR SELECT TO formforge_ingest
  USING (true);
--> statement-breakpoint
-- answers: tenant key reachable through the owning submission.
DROP POLICY IF EXISTS tenant_isolation ON answers;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON answers
  USING (EXISTS (
    SELECT 1 FROM submissions s
    WHERE s.id = answers.submission_id
      AND s.workspace_id = current_setting('app.workspace_id', true)::uuid
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM submissions s
    WHERE s.id = answers.submission_id
      AND s.workspace_id = current_setting('app.workspace_id', true)::uuid
  ));
--> statement-breakpoint
DROP POLICY IF EXISTS ingest_token_plane ON answers;
--> statement-breakpoint
CREATE POLICY ingest_token_plane ON answers
  FOR SELECT TO formforge_ingest
  USING (EXISTS (
    SELECT 1 FROM submissions s WHERE s.id = answers.submission_id
  ));
--> statement-breakpoint
-- memberships: tenant-scoped member management, PLUS the login plane reading
-- the caller's own memberships (app.user_id arm) so pre-auth flows keep
-- working when the connection user is not the table owner.
DROP POLICY IF EXISTS tenant_isolation ON memberships;
--> statement-breakpoint
CREATE POLICY tenant_isolation ON memberships
  USING (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR user_id = current_setting('app.user_id', true)::uuid
  )
  WITH CHECK (
    workspace_id = current_setting('app.workspace_id', true)::uuid
    OR user_id = current_setting('app.user_id', true)::uuid
  );
--> statement-breakpoint
-- api_tokens: SELECT is the pre-auth bearer-lookup plane (the sha256 token
-- hash IS the credential; queries are hash-keyed). Writes stay tenant-strict.
DROP POLICY IF EXISTS token_lookup_plane ON api_tokens;
--> statement-breakpoint
CREATE POLICY token_lookup_plane ON api_tokens
  FOR SELECT
  USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS token_tenant_writes ON api_tokens;
--> statement-breakpoint
CREATE POLICY token_tenant_writes ON api_tokens
  FOR INSERT
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS token_tenant_update ON api_tokens;
--> statement-breakpoint
CREATE POLICY token_tenant_update ON api_tokens
  FOR UPDATE
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid)
  WITH CHECK (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint
DROP POLICY IF EXISTS token_tenant_delete ON api_tokens;
--> statement-breakpoint
CREATE POLICY token_tenant_delete ON api_tokens
  FOR DELETE
  USING (workspace_id = current_setting('app.workspace_id', true)::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 4. Future tenant tables (skip silently until their DDL lands; re-apply this
--    file to pick them up). Tables with a direct workspace_id column:
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['assets', 'events', 'usage_counters', 'audit_log', 'webhook_endpoints']
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
      EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
      EXECUTE format(
        'CREATE POLICY tenant_isolation ON %I '
        || 'USING (workspace_id = current_setting(''app.workspace_id'', true)::uuid) '
        || 'WITH CHECK (workspace_id = current_setting(''app.workspace_id'', true)::uuid)',
        t
      );
    END IF;
  END LOOP;
END
$$;
--> statement-breakpoint
-- webhook_deliveries (tenant key via webhook_endpoints):
DO $$
BEGIN
  IF to_regclass('public.webhook_deliveries') IS NOT NULL
     AND to_regclass('public.webhook_endpoints') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE webhook_deliveries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON webhook_deliveries';
    EXECUTE 'CREATE POLICY tenant_isolation ON webhook_deliveries '
      || 'USING (EXISTS (SELECT 1 FROM webhook_endpoints e '
      || 'WHERE e.id = webhook_deliveries.webhook_id '
      || 'AND e.workspace_id = current_setting(''app.workspace_id'', true)::uuid)) '
      || 'WITH CHECK (EXISTS (SELECT 1 FROM webhook_endpoints e '
      || 'WHERE e.id = webhook_deliveries.webhook_id '
      || 'AND e.workspace_id = current_setting(''app.workspace_id'', true)::uuid))';
  END IF;
END
$$;
--> statement-breakpoint
-- analytics_events / analytics_daily (tenant key via the owning document):
DO $$
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON analytics_events';
    EXECUTE 'CREATE POLICY tenant_isolation ON analytics_events '
      || 'USING (EXISTS (SELECT 1 FROM documents d '
      || 'WHERE d.id = analytics_events.document_id '
      || 'AND d.workspace_id = current_setting(''app.workspace_id'', true)::uuid)) '
      || 'WITH CHECK (EXISTS (SELECT 1 FROM documents d '
      || 'WHERE d.id = analytics_events.document_id '
      || 'AND d.workspace_id = current_setting(''app.workspace_id'', true)::uuid))';
  END IF;
  IF to_regclass('public.analytics_daily') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE analytics_daily ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS tenant_isolation ON analytics_daily';
    EXECUTE 'CREATE POLICY tenant_isolation ON analytics_daily '
      || 'USING (EXISTS (SELECT 1 FROM documents d '
      || 'WHERE d.id = analytics_daily.document_id '
      || 'AND d.workspace_id = current_setting(''app.workspace_id'', true)::uuid)) '
      || 'WITH CHECK (EXISTS (SELECT 1 FROM documents d '
      || 'WHERE d.id = analytics_daily.document_id '
      || 'AND d.workspace_id = current_setting(''app.workspace_id'', true)::uuid))';
  END IF;
END
$$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- 5. Grants
-- ---------------------------------------------------------------------------
-- Application plane: full CRUD on tenant tables + the workspace row itself
-- (plan / stripe columns are managed by the billing service via Ctx ops).
GRANT SELECT, INSERT, UPDATE, DELETE ON
  documents, document_versions, snapshots, submissions, answers,
  memberships, api_tokens
TO formforge_app;
--> statement-breakpoint
GRANT SELECT, UPDATE ON workspaces TO formforge_app;
--> statement-breakpoint
-- Public ingest plane (spec §6: "limited to submissions, answers, assets
-- inserts/updates for published documents"). NOTE: no DELETE anywhere, no
-- access beyond published SELECT on documents/snapshots, nothing else.
GRANT SELECT ON documents, snapshots TO formforge_ingest;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON submissions, answers TO formforge_ingest;
--> statement-breakpoint
DO $$
BEGIN
  IF to_regclass('public.assets') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE ON assets TO formforge_ingest';
  END IF;
END
$$;
