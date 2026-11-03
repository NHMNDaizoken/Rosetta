-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'rosetta_api') THEN
    CREATE ROLE rosetta_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_api TO rosetta_data;
CREATE SCHEMA IF NOT EXISTS core;
REVOKE ALL ON SCHEMA core FROM PUBLIC;
GRANT USAGE ON SCHEMA core TO rosetta_api;
CREATE TABLE IF NOT EXISTS core.schema_migrations (
  version integer PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.records (
  tenant_id text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
  id uuid NOT NULL,
  collection text NOT NULL CHECK (collection ~ '^[a-z][a-z0-9_-]{0,62}$'),
  data jsonb NOT NULL CHECK (jsonb_typeof(data) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
ALTER TABLE core.records ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.records FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'core' AND tablename = 'records' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON core.records TO rosetta_api
      USING (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'))
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'));
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON core.records TO rosetta_api;
INSERT INTO core.schema_migrations(version) VALUES (1) ON CONFLICT DO NOTHING;
COMMIT;
