-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
-- Purpose-bound invocation and the data subject's access log.
-- A C4A reservation may carry a context {purpose, dataSubject}: why the consumer
-- calls and whose data the call concerns. The context is stored next to the
-- execution, sealed into the audit chain (purpose and a SHA-256 of the subject)
-- and handed to the provider on ticket redemption. The data subject can list the
-- calls that named them through core.subject_access. The existing execution
-- authority is wrapped, not rewritten: its applied definition stays byte-identical.
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='junctura_subject_api') THEN
    CREATE ROLE junctura_subject_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT junctura_subject_api TO junctura_data;
GRANT USAGE ON SCHEMA core TO junctura_subject_api;

CREATE TABLE IF NOT EXISTS execution_private.execution_contexts (
  tenant_id text NOT NULL,
  execution_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose ~ '^[a-z][a-z0-9_]{1,62}$'),
  data_subject text CHECK (data_subject IS NULL OR (length(data_subject) BETWEEN 1 AND 255 AND data_subject !~ '[[:cntrl:]]')),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id, execution_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES execution_private.executions(tenant_id, execution_id) ON DELETE CASCADE
);
ALTER TABLE execution_private.execution_contexts OWNER TO junctura_app_owner;
CREATE INDEX IF NOT EXISTS execution_context_subject_idx
  ON execution_private.execution_contexts (tenant_id, data_subject, recorded_at DESC) WHERE data_subject IS NOT NULL;
ALTER TABLE execution_private.execution_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_private.execution_contexts FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='execution_private' AND tablename='execution_contexts' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON execution_private.execution_contexts TO junctura_app_owner
      USING (tenant_id = (current_setting('request.jwt.claims',true)::jsonb ->> 'tenant_id'))
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims',true)::jsonb ->> 'tenant_id'));
  END IF;
END $$;
REVOKE ALL ON execution_private.execution_contexts FROM PUBLIC;

-- Keep the applied authority as the private base implementation.
ALTER FUNCTION core.execution_command(text,jsonb) RENAME TO execution_command_base;
ALTER FUNCTION core.execution_command_base(text,jsonb) SET SCHEMA execution_private;
REVOKE ALL ON FUNCTION execution_private.execution_command_base(text,jsonb) FROM PUBLIC, junctura_execution_api;

CREATE FUNCTION core.execution_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  ctx jsonb; result jsonb; tenant text; execution uuid;
  stored execution_private.execution_contexts; found_context boolean;
BEGIN
  IF operation IS DISTINCT FROM 'reserve' THEN
    result := execution_private.execution_command_base(operation, payload);
    -- The provider learns the declared purpose and data subject with its ticket.
    IF operation='redeem' AND result->'value'->>'active'='true' THEN
      SELECT * INTO stored FROM execution_private.execution_contexts
        WHERE tenant_id=result->'value'->'context'->>'tenantId'
          AND execution_id=(result->'value'->'context'->>'executionId')::uuid;
      IF FOUND THEN
        result := jsonb_set(result, '{value,context}', (result->'value'->'context') ||
          jsonb_strip_nulls(jsonb_build_object('purpose', stored.purpose, 'dataSubject', stored.data_subject)));
      END IF;
    END IF;
    RETURN result;
  END IF;

  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RETURN execution_private.execution_command_base(operation, payload);
  END IF;
  ctx := payload->'context';
  IF ctx IS NOT NULL AND (
       jsonb_typeof(ctx) <> 'object' OR (ctx - 'purpose' - 'dataSubject') <> '{}'::jsonb
       OR jsonb_typeof(ctx->'purpose') IS DISTINCT FROM 'string'
       OR ctx->>'purpose' !~ '^[a-z][a-z0-9_]{1,62}$'
       OR (ctx ? 'dataSubject' AND (jsonb_typeof(ctx->'dataSubject') <> 'string'
           OR length(ctx->>'dataSubject') NOT BETWEEN 1 AND 255 OR ctx->>'dataSubject' ~ '[[:cntrl:]]'))) THEN
    RETURN jsonb_build_object('status',400,'error','invalid_execution_context');
  END IF;

  result := execution_private.execution_command_base('reserve', payload - 'context');
  IF result->>'status' NOT IN ('200','202') THEN RETURN result; END IF;
  tenant := current_setting('request.jwt.claims',true)::jsonb->>'tenant_id';
  execution := (result->'value'->>'executionId')::uuid;
  SELECT * INTO stored FROM execution_private.execution_contexts WHERE tenant_id=tenant AND execution_id=execution;
  found_context := FOUND;

  IF result->>'status' = '202' THEN
    IF ctx IS NOT NULL THEN
      INSERT INTO execution_private.execution_contexts(tenant_id, execution_id, purpose, data_subject)
        VALUES (tenant, execution, ctx->>'purpose', ctx->>'dataSubject');
      PERFORM app_private.audit_append('execution.subject_accessed', 'execution', execution, 1, 'success',
        ctx->>'purpose', CASE WHEN ctx ? 'dataSubject'
          THEN 'data_subject_sha256:' || encode(sha256(convert_to(ctx->>'dataSubject','UTF8')),'hex') END);
    END IF;
  ELSIF found_context <> (ctx IS NOT NULL)
     OR (found_context AND (stored.purpose IS DISTINCT FROM ctx->>'purpose'
                            OR stored.data_subject IS DISTINCT FROM ctx->>'dataSubject')) THEN
    -- A replay must repeat the original context exactly.
    RETURN jsonb_build_object('status',409,'error','idempotency_conflict');
  END IF;
  RETURN result;
END $$;

-- The data subject's view: calls that named the caller, newest first. Only the
-- caller's own subject in its own tenant and issuer; nothing a subject cannot
-- already know about itself (no inputs, outputs, tickets or operator identities).
CREATE OR REPLACE FUNCTION core.subject_access(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; tenant text; who text; iss text; items jsonb; total integer;
  max_items constant integer := 200;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR payload<>'{}'::jsonb THEN
    RETURN jsonb_build_object('status',400,'error','invalid_subject_access_request');
  END IF;
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss';
  IF c IS NULL OR tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR coalesce(iss,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','verified_subject_required');
  END IF;
  WITH mine AS (
    SELECT x.*, e.consumer_app_id, e.provider_app_id, e.capability_id, e.version, e.version_id, e.state
      FROM execution_private.execution_contexts x
      JOIN execution_private.executions e ON e.tenant_id=x.tenant_id AND e.execution_id=x.execution_id
      WHERE x.tenant_id=tenant AND x.data_subject=who AND e.issuer=iss
  ), newest AS (SELECT * FROM mine ORDER BY recorded_at DESC, execution_id LIMIT max_items)
  SELECT (SELECT count(*) FROM mine), coalesce(jsonb_agg(jsonb_build_object(
      'executionId', n.execution_id,
      'accessedAt', to_char(n.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'purpose', n.purpose,
      'state', n.state,
      'consumer', jsonb_build_object('appId', n.consumer_app_id, 'displayName',
        (SELECT a.display_name FROM app_private.applications a WHERE a.tenant_id=n.tenant_id AND a.app_id=n.consumer_app_id)),
      'provider', jsonb_build_object('appId', n.provider_app_id, 'displayName',
        (SELECT a.display_name FROM app_private.applications a WHERE a.tenant_id=n.tenant_id AND a.app_id=n.provider_app_id)),
      'capability', jsonb_build_object('capabilityId', n.capability_id, 'version', n.version, 'title',
        (SELECT v.manifest->>'title' FROM app_private.capability_versions v WHERE v.tenant_id=n.tenant_id AND v.version_id=n.version_id)))
      ORDER BY n.recorded_at DESC, n.execution_id), '[]'::jsonb)
    INTO total, items FROM newest n;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object(
    'entries', items, 'truncated', total > max_items,
    'generatedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
END $$;

ALTER FUNCTION core.execution_command(text,jsonb) OWNER TO junctura_app_owner;
ALTER FUNCTION core.subject_access(jsonb) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION core.execution_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.execution_command(text,jsonb) TO junctura_execution_api;
REVOKE ALL ON FUNCTION core.subject_access(jsonb) FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api,junctura_audit_api,junctura_trust_api,junctura_execution_api;
GRANT EXECUTE ON FUNCTION core.subject_access(jsonb) TO junctura_subject_api;
INSERT INTO core.schema_migrations(version) VALUES(20);
NOTIFY pgrst,'reload schema';
COMMIT;
