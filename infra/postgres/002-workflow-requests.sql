-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
CREATE TABLE IF NOT EXISTS core.workflow_requests (
  tenant_id text NOT NULL DEFAULT (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'),
  key uuid NOT NULL,
  definition_id text NOT NULL,
  input_hash text NOT NULL CHECK (length(input_hash) = 64),
  engine_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, key)
);
ALTER TABLE core.workflow_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.workflow_requests FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname = 'core' AND tablename = 'workflow_requests' AND policyname = 'tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON core.workflow_requests TO rosetta_api
      USING (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'))
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims', true)::jsonb ->> 'tenant_id'));
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE ON core.workflow_requests TO rosetta_api;
INSERT INTO core.schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
NOTIFY pgrst, 'reload schema';
COMMIT;
