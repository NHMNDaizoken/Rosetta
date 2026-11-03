-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_audit_api') THEN
    CREATE ROLE rosetta_audit_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_audit_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_audit_api;
GRANT USAGE ON SCHEMA core TO rosetta_app_owner;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;

-- A1 keeps the existing app_private.audit table. These columns add the
-- control-plane metadata needed by later capability lifecycle events without
-- creating a second audit store.
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS schema_version smallint NOT NULL DEFAULT 1;
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS actor_app_id uuid;
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS resource_type text;
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS outcome text NOT NULL DEFAULT 'success';
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS reason_code text;
UPDATE app_private.audit SET resource_type = CASE
  WHEN event LIKE 'application.%' THEN 'application'
  WHEN event LIKE 'approval.%' THEN 'approval'
  WHEN event LIKE 'resource.%' THEN 'resource_share'
  WHEN event LIKE 'capability.%' THEN 'capability'
  WHEN event LIKE 'grant.%' THEN 'grant'
  WHEN event LIKE 'delegation.%' THEN 'delegation'
  WHEN event LIKE 'composition.%' THEN 'composition'
  WHEN event LIKE 'execution.%' THEN 'execution'
  WHEN event LIKE 'invocation.%' THEN 'invocation'
  WHEN event LIKE 'authorization.%' THEN 'authorization'
  ELSE 'legacy' END
WHERE resource_type IS NULL;
ALTER TABLE app_private.audit ALTER COLUMN resource_type SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_schema_version_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_schema_version_check
      CHECK (schema_version=1);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_resource_type_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_resource_type_check
      CHECK (resource_type IN ('application','approval','resource_share','capability','grant',
        'delegation','composition','execution','invocation','authorization','audit','legacy'));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_outcome_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_outcome_check
      CHECK (outcome IN ('success','denied','failed','unknown'));
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_reason_code_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_reason_code_check
      CHECK (reason_code IS NULL OR reason_code ~ '^[a-z][a-z0-9_]{0,63}$');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_event_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_event_check
      CHECK (event ~ '^(application|approval|resource|capability|grant|delegation|composition|execution|invocation|authorization|audit)\.[a-z][a-z0-9_]{0,62}$');
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_revision_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_revision_check CHECK (revision>=0);
  END IF;
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_actor_app_fk') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_actor_app_fk
      FOREIGN KEY (tenant_id,actor_app_id) REFERENCES app_private.applications(tenant_id,app_id) NOT VALID;
  END IF;
END $$;
ALTER TABLE app_private.audit VALIDATE CONSTRAINT audit_actor_app_fk;
CREATE INDEX IF NOT EXISTS audit_tenant_time_idx
  ON app_private.audit (tenant_id,occurred_at DESC,event_id DESC);

ALTER TABLE app_private.principals DROP CONSTRAINT IF EXISTS principals_permissions_check;
ALTER TABLE app_private.principals ADD CONSTRAINT principals_permissions_check
  CHECK (permissions <@ ARRAY['applications.register','applications.approve','trust.approve','audit.read']::text[]);

-- Best-effort redaction for the only free-text audit field. Sensitive values
-- have no audit column at all; arbitrary payloads are not accepted.
CREATE OR REPLACE FUNCTION app_private.audit_redact_text(value text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT CASE WHEN value IS NULL THEN NULL ELSE left(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(value,'[[:cntrl:]]','','g'),
          '\y[Bb]earer\s+[A-Za-z0-9._~+/=-]+','Bearer [redacted]','g'),
        '\yeyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\y','[redacted-jwt]','g'),
      '(?i)\y(password|passwd|secret|token|api[_-]?key|authorization|credential|client[_-]?secret)\y\s*[:=]\s*("[^"]*"|''[^'']*''|[^\s,;]+)',
      '\1=[redacted]','g'),
    512)
  END
$$;

-- Server-derived actor, tenant and event metadata. Callers cannot choose their
-- own tenant, subject, client, timestamp or event ID.
CREATE OR REPLACE FUNCTION app_private.audit_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb; tenant text; who text; iss text; client text; actor uuid; derived text;
BEGIN
  BEGIN c := current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c := NULL; END;
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='audit actor claims required';
  END IF;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss'; client:=c->>'client_id';
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR
     coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='audit actor claims invalid';
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM tenant THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='audit tenant mismatch';
  END IF;
  IF NEW.event IS NULL OR NEW.event !~ '^(application|approval|resource|capability|grant|delegation|composition|execution|invocation|authorization|audit)\.[a-z][a-z0-9_]{0,62}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid audit event';
  END IF;
  IF NEW.resource_id IS NULL OR NEW.revision IS NULL OR NEW.revision<0 THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid audit target';
  END IF;
  derived:=CASE split_part(NEW.event,'.',1)
    WHEN 'resource' THEN 'resource_share'
    ELSE split_part(NEW.event,'.',1) END;
  IF NEW.resource_type IS NULL THEN NEW.resource_type:=derived; END IF;
  IF NEW.resource_type IS DISTINCT FROM derived THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid audit resource type';
  END IF;
  IF NEW.outcome IS NULL THEN NEW.outcome:='success'; END IF;
  IF NEW.outcome NOT IN ('success','denied','failed','unknown') THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid audit outcome';
  END IF;
  IF NEW.reason_code IS NOT NULL AND NEW.reason_code !~ '^[a-z][a-z0-9_]{0,63}$' THEN
    RAISE EXCEPTION USING ERRCODE='22023', MESSAGE='invalid audit reason code';
  END IF;
  actor:=core.resource_actor();
  NEW.tenant_id:=tenant; NEW.issuer:=iss; NEW.subject:=who; NEW.management_client:=client;
  NEW.actor_app_id:=actor; NEW.event_id:=gen_random_uuid(); NEW.occurred_at:=clock_timestamp();
  NEW.schema_version:=1; NEW.reason:=app_private.audit_redact_text(NEW.reason);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS audit_guard ON app_private.audit;
CREATE TRIGGER audit_guard BEFORE INSERT ON app_private.audit
  FOR EACH ROW EXECUTE FUNCTION app_private.audit_guard();

-- Trusted owner interface for new control-plane domains. No application role
-- can execute it; existing owner functions may call it in their transaction.
CREATE OR REPLACE FUNCTION app_private.audit_append(
  p_event text, p_resource_type text, p_resource_id uuid, p_revision integer,
  p_outcome text DEFAULT 'success', p_reason_code text DEFAULT NULL,
  p_reason text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE c jsonb; tenant text; event uuid;
BEGIN
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='audit actor claims required';
  END IF;
  tenant:=c->>'tenant_id';
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' THEN
    RAISE EXCEPTION USING ERRCODE='42501', MESSAGE='audit tenant required';
  END IF;
  INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,
    resource_type,resource_id,revision,outcome,reason_code,reason)
    VALUES(tenant,c->>'iss',c->>'sub',c->>'client_id',p_event,p_resource_type,p_resource_id,
      p_revision,p_outcome,p_reason_code,p_reason)
    RETURNING event_id INTO event;
  RETURN event;
END $$;

-- Internal tenant/time-filtered read contract. It is intentionally not exposed
-- by a Core HTTP route; rosetta_audit_api can only be asserted by trusted Core.
CREATE OR REPLACE FUNCTION core.audit_query(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb; tenant text; who text; iss text; client text;
  v_since timestamptz; v_until timestamptz; v_limit integer:=50;
  v_cursor_time timestamptz; v_cursor_id uuid; v_cursor_text text; v_next text;
  items jsonb;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' THEN
    RETURN jsonb_build_object('status',400,'error','invalid_audit_query');
  END IF;
  IF EXISTS (SELECT FROM jsonb_object_keys(payload) AS k
      WHERE k NOT IN ('since','until','limit','cursor')) THEN
    RETURN jsonb_build_object('status',400,'error','invalid_audit_query');
  END IF;
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss'; client:=c->>'client_id';
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR
     coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;
  PERFORM 1 FROM app_private.principals p
    WHERE p.tenant_id=tenant AND p.issuer=iss AND p.subject=who
      AND p.management_client=client AND p.enabled
      AND p.permissions @> ARRAY['audit.read']::text[];
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;
  BEGIN
    IF payload ? 'since' THEN
      IF jsonb_typeof(payload->'since')<>'string' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_time_range');
      END IF;
      v_since:=(payload->>'since')::timestamptz;
    END IF;
    IF payload ? 'until' THEN
      IF jsonb_typeof(payload->'until')<>'string' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_time_range');
      END IF;
      v_until:=(payload->>'until')::timestamptz;
    END IF;
    IF payload ? 'limit' THEN
      IF jsonb_typeof(payload->'limit')<>'number' OR (payload->>'limit') !~ '^[0-9]{1,3}$' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_limit');
      END IF;
      v_limit:=(payload->>'limit')::integer;
      IF v_limit<1 OR v_limit>100 THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_limit');
      END IF;
    END IF;
    IF payload ? 'cursor' THEN
      IF jsonb_typeof(payload->'cursor')<>'string' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_cursor');
      END IF;
      v_cursor_text:=convert_from(decode(payload->>'cursor','hex'),'UTF8');
      IF position('|' IN v_cursor_text)=0 OR position('|' IN v_cursor_text)=length(v_cursor_text) THEN
        RETURN jsonb_build_object('status',400,'error','invalid_audit_cursor');
      END IF;
      v_cursor_time:=split_part(v_cursor_text,'|',1)::timestamptz;
      v_cursor_id:=split_part(v_cursor_text,'|',2)::uuid;
    END IF;
  EXCEPTION WHEN others THEN
    RETURN jsonb_build_object('status',400,'error','invalid_audit_query');
  END;
  IF v_since IS NOT NULL AND v_until IS NOT NULL AND v_since>v_until THEN
    RETURN jsonb_build_object('status',400,'error','invalid_audit_time_range');
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
      'eventId',a.event_id,'occurredAt',a.occurred_at,'tenantId',a.tenant_id,
      'schemaVersion',a.schema_version,'event',a.event,'resourceType',a.resource_type,
      'resourceId',a.resource_id,'revision',a.revision,'actorAppId',a.actor_app_id,
      'issuer',a.issuer,'subject',a.subject,'managementClient',a.management_client,
      'outcome',a.outcome,'reasonCode',a.reason_code,'reason',a.reason)
      ORDER BY a.occurred_at DESC,a.event_id DESC),'[]'::jsonb)
    INTO items
    FROM (
      SELECT * FROM app_private.audit
      WHERE tenant_id=tenant
        AND (v_since IS NULL OR occurred_at>=v_since)
        AND (v_until IS NULL OR occurred_at<=v_until)
        AND (v_cursor_time IS NULL OR (occurred_at,event_id)<(v_cursor_time,v_cursor_id))
      ORDER BY occurred_at DESC,event_id DESC
      LIMIT v_limit+1
    ) a;
  IF jsonb_array_length(items)>v_limit THEN
    v_next:=encode(convert_to(
      (items->(v_limit-1)->>'occurredAt')||'|'||(items->(v_limit-1)->>'eventId'),
      'UTF8'),'hex');
    items:=items-v_limit;
  END IF;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object('items',items,'nextCursor',v_next));
END $$;

ALTER FUNCTION app_private.audit_append(text,text,uuid,integer,text,text,text) OWNER TO rosetta_app_owner;
ALTER FUNCTION core.audit_query(jsonb) OWNER TO rosetta_app_owner;
REVOKE ALL ON app_private.audit FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api,rosetta_audit_api;
REVOKE ALL ON FUNCTION app_private.audit_redact_text(text) FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api,rosetta_audit_api;
REVOKE ALL ON FUNCTION app_private.audit_guard() FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api,rosetta_audit_api;
REVOKE ALL ON FUNCTION app_private.audit_append(text,text,uuid,integer,text,text,text) FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api,rosetta_audit_api;
REVOKE ALL ON FUNCTION core.audit_query(jsonb) FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api;
GRANT EXECUTE ON FUNCTION core.audit_query(jsonb) TO rosetta_audit_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(5) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
