-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
-- C2 increment A: private persistence only; no public Trust command yet.
BEGIN;
CREATE SCHEMA IF NOT EXISTS trust_private AUTHORIZATION rosetta_app_owner;
REVOKE ALL ON SCHEMA trust_private FROM PUBLIC;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;
ALTER TABLE app_private.principals DROP CONSTRAINT IF EXISTS principals_permissions_check;
ALTER TABLE app_private.principals ADD CONSTRAINT principals_permissions_check
  CHECK (permissions <@ ARRAY['applications.register','applications.approve','trust.write','trust.approve','audit.read',
    'capabilities.write','capabilities.publish','capabilities.approve']::text[]);

CREATE TABLE IF NOT EXISTS trust_private.grants (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  grant_id uuid NOT NULL,
  issuer text NOT NULL,
  provider_app_id uuid NOT NULL,
  consumer_app_id uuid NOT NULL,
  version_id uuid NOT NULL,
  capability_id text NOT NULL,
  version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  proposal jsonb NOT NULL CHECK (jsonb_typeof(proposal)='object'
    AND proposal->'delegationAllowed'='false'::jsonb AND proposal->'acceptDelegation'='false'::jsonb),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','revoked')),
  expires_at timestamptz NOT NULL,
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 255),
  management_client text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by text,
  reason text,
  PRIMARY KEY (tenant_id,grant_id),
  UNIQUE (grant_id),
  FOREIGN KEY (tenant_id,provider_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,consumer_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,version_id) REFERENCES app_private.capability_versions(tenant_id,version_id),
  CHECK (provider_app_id<>consumer_app_id),
  CHECK ((state='revoked')=(revoked_at IS NOT NULL)),
  CHECK (state<>'active' OR activated_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS direct_grant_consumer_idx ON trust_private.grants
  (tenant_id,consumer_app_id,version_id,state,expires_at);
CREATE TABLE IF NOT EXISTS trust_private.approvals (
  tenant_id text NOT NULL,
  approval_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  decision jsonb NOT NULL,
  approver_subject text NOT NULL,
  management_client text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('approved','denied','consumed','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision>0),
  PRIMARY KEY (tenant_id,approval_id),
  UNIQUE (approval_id),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES trust_private.grants(tenant_id,grant_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['grants','approvals'] LOOP
    EXECUTE format('ALTER TABLE trust_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE trust_private.%I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='trust_private' AND tablename=t AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON trust_private.%I TO rosetta_app_owner USING (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')) WITH CHECK (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id''))',t);
    END IF;
  END LOOP;
END $$;

-- Keep C1's implementation behind its existing RPC. The guard also protects
-- trusted internal callers, before any resource lookup. Reapplication is safe.
DO $$ BEGIN
  IF to_regprocedure('app_private.capability_command_c1(text,jsonb)') IS NULL THEN
    ALTER FUNCTION core.capability_command(text,jsonb) RENAME TO capability_command_c1;
    ALTER FUNCTION core.capability_command_c1(text,jsonb) SET SCHEMA app_private;
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.capability_command_c1(text,jsonb) FROM PUBLIC,rosetta_capability_api;
CREATE OR REPLACE FUNCTION core.capability_command(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE resource text; cap text; ver text; target uuid; matches integer;
BEGIN
  IF operation='approval_create' THEN
    resource:=payload->'decision'->>'resourceId';
    cap:=split_part(resource,'@',1); ver:=split_part(resource,'@',2);
    IF resource IS NULL OR resource ~ '[[:cntrl:][:space:]]' OR NOT (
      resource ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR
      (cap ~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'
        AND (resource=cap OR (resource=cap||'@'||ver AND ver ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$')))) THEN
      RETURN jsonb_build_object('status',400,'error','invalid_capability_approval');
    END IF;
    -- Resolve the documented bare-ID alias without C1's unsupported min(uuid).
    IF resource=cap AND resource LIKE 'urn:%' THEN
      IF NOT EXISTS (SELECT FROM app_private.principals p
        WHERE p.tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
          AND p.issuer=current_setting('request.jwt.claims',true)::jsonb->>'iss'
          AND p.subject=current_setting('request.jwt.claims',true)::jsonb->>'sub'
          AND p.management_client=current_setting('request.jwt.claims',true)::jsonb->>'client_id'
          AND p.enabled AND 'capabilities.approve'=ANY(p.permissions)) THEN
        RETURN app_private.capability_command_c1(operation,payload);
      END IF;
      SELECT count(*)::integer,min(version_id::text)::uuid INTO matches,target
        FROM app_private.capability_versions
        WHERE tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
          AND capability_id=cap AND digest=payload->'decision'->>'resourceDigest'
          AND revision::text=payload->'decision'->>'resourceRevision';
      IF matches=0 THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      IF matches<>1 THEN RETURN jsonb_build_object('status',409,'error','version_reference_required'); END IF;
      payload:=jsonb_set(payload,'{decision,resourceId}',to_jsonb(target::text));
    END IF;
  END IF;
  RETURN app_private.capability_command_c1(operation,payload);
END $$;
REVOKE ALL ON FUNCTION core.capability_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.capability_command(text,jsonb) TO rosetta_capability_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trust_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(7) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
