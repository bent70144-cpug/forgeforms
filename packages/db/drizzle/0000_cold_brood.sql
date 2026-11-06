-- Custom migration: enable extensions required by the identity schema.
-- `citext` backs users.email (spec §6: `email citext unique not null`).
-- Runs FIRST (idx 0), before the table DDL references the citext type.
CREATE EXTENSION IF NOT EXISTS citext;
