-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
-- Data subject consent and emergency ("break-glass") access with review.
-- A call that names a data subject now needs that person's active consent for
-- the consumer application, the capability and the declared purpose. Consent is
-- re-checked when the provider redeems its ticket, so revocation is immediate.
-- An emergency call may proceed without consent only with a justification; it is
-- sealed in the audit chain, shown to the person and queued for review.

CREATE TABLE IF NOT EXISTS execution_private.subject_consents (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  consent_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  data_subject text NOT NULL CHECK (length(data_subject) BETWEEN 1 AND 255),
  consumer_app_id uuid NOT NULL,
  capability_id text NOT NULL CHECK (capability_id ~ '^urn:junctura:capability:[0-9a-f-]{36}:[a-z][a-z0-9-]{0,62}$'),
  purposes text[] NOT NULL CHECK (cardinality(purposes) BETWEEN 1 AND 8),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  PRIMARY KEY (tenant_id, consent_id),
  UNIQUE (consent_id),
  FOREIGN KEY (tenant_id, consumer_app_id) REFERENCES app_private.applications(tenant_id, app_id),
  CHECK (expires_at > created_at)
);
ALTER TABLE execution_private.subject_consents OWNER TO junctura_app_owner;
CREATE INDEX IF NOT EXISTS subject_consent_lookup_idx ON execution_private.subject_consents
  (tenant_id, data_subject, consumer_app_id, capability_id) WHERE revoked_at IS NULL;

ALTER TABLE execution_private.execution_contexts ADD COLUMN IF NOT EXISTS emergency boolean NOT NULL DEFAULT false;
ALTER TABLE execution_private.execution_contexts ADD COLUMN IF NOT EXISTS justification text
  CHECK (justification IS NULL OR (length(justification) BETWEEN 10 AND 500 AND justification !~ '[[:cntrl:]]'));
ALTER TABLE execution_private.execution_contexts ADD COLUMN IF NOT EXISTS consent_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='execution_context_emergency_check') THEN
    ALTER TABLE execution_private.execution_contexts ADD CONSTRAINT execution_context_emergency_check
      CHECK (NOT emergency OR (justification IS NOT NULL AND data_subject IS NOT NULL));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS execution_private.emergency_reviews (
  tenant_id text NOT NULL,
  execution_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','justified','unjustified')),
  reviewer_subject text,
  reviewer_client text,
  note text CHECK (note IS NULL OR (length(note) BETWEEN 1 AND 500 AND note !~ '[[:cntrl:]]')),
  reviewed_at timestamptz,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (tenant_id, execution_id),
  FOREIGN KEY (tenant_id, execution_id) REFERENCES execution_private.executions(tenant_id, execution_id) ON DELETE CASCADE,
  CHECK ((state = 'pending') = (reviewed_at IS NULL))
);
ALTER TABLE execution_private.emergency_reviews OWNER TO junctura_app_owner;

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['subject_consents','emergency_reviews'] LOOP
    EXECUTE format('ALTER TABLE execution_private.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE execution_private.%I FORCE ROW LEVEL SECURITY', t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='execution_private' AND tablename=t AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON execution_private.%I TO junctura_app_owner USING (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')) WITH CHECK (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id''))', t);
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON execution_private.subject_consents, execution_private.emergency_reviews FROM PUBLIC;

-- Active consent for exactly this subject, consumer, capability and purpose.
CREATE OR REPLACE FUNCTION execution_private.active_consent(p_tenant text, p_issuer text, p_subject text,
  p_consumer uuid, p_capability text, p_purpose text) RETURNS uuid
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT s.consent_id FROM execution_private.subject_consents s
   WHERE s.tenant_id=p_tenant AND s.issuer=p_issuer AND s.data_subject=p_subject
     AND s.consumer_app_id=p_consumer AND s.capability_id=p_capability
     AND p_purpose = ANY(s.purposes) AND s.revoked_at IS NULL AND s.expires_at > clock_timestamp()
   ORDER BY s.expires_at DESC, s.consent_id LIMIT 1
$$;
ALTER FUNCTION execution_private.active_consent(text,text,text,uuid,text,text) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION execution_private.active_consent(text,text,text,uuid,text,text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION core.execution_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c jsonb := current_setting('request.jwt.claims',true)::jsonb;
  ctx jsonb; result jsonb; tenant text := c->>'tenant_id'; execution uuid; actor uuid; consent uuid;
  stored execution_private.execution_contexts; found_context boolean; emergency boolean;
  e execution_private.executions; open_emergencies integer;
BEGIN
  IF operation IN ('ticket_context','redeem') AND jsonb_typeof(payload)='object' THEN
    -- Consent is re-checked before the provider receives authority.
    SELECT x.* INTO stored FROM execution_private.execution_contexts x
      WHERE x.tenant_id=tenant AND x.execution_id=(CASE WHEN payload->>'executionId' ~ '^[0-9a-f-]{36}$' THEN (payload->>'executionId')::uuid END);
    IF FOUND AND stored.data_subject IS NOT NULL AND NOT stored.emergency THEN
      SELECT * INTO e FROM execution_private.executions WHERE tenant_id=tenant AND execution_id=stored.execution_id;
      IF execution_private.active_consent(tenant, e.issuer, stored.data_subject, e.consumer_app_id, e.capability_id, stored.purpose) IS NULL THEN
        RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false));
      END IF;
    END IF;
    result := execution_private.execution_command_base(operation, payload);
    IF operation='redeem' AND result->'value'->>'active'='true' THEN
      SELECT * INTO stored FROM execution_private.execution_contexts
        WHERE tenant_id=result->'value'->'context'->>'tenantId'
          AND execution_id=(result->'value'->'context'->>'executionId')::uuid;
      IF FOUND THEN
        result := jsonb_set(result, '{value,context}', (result->'value'->'context') ||
          jsonb_strip_nulls(jsonb_build_object('purpose', stored.purpose, 'dataSubject', stored.data_subject,
            'emergency', CASE WHEN stored.emergency THEN true END)));
      END IF;
    END IF;
    RETURN result;
  END IF;
  IF operation IS DISTINCT FROM 'reserve' OR jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN
    RETURN execution_private.execution_command_base(operation, payload);
  END IF;

  ctx := payload->'context';
  IF ctx IS NOT NULL AND (
       jsonb_typeof(ctx) <> 'object' OR (ctx - 'purpose' - 'dataSubject' - 'emergency' - 'justification') <> '{}'::jsonb
       OR jsonb_typeof(ctx->'purpose') IS DISTINCT FROM 'string' OR ctx->>'purpose' !~ '^[a-z][a-z0-9_]{1,62}$'
       OR (ctx ? 'dataSubject' AND (jsonb_typeof(ctx->'dataSubject') <> 'string'
           OR length(ctx->>'dataSubject') NOT BETWEEN 1 AND 255 OR ctx->>'dataSubject' ~ '[[:cntrl:]]'))
       OR (ctx ? 'emergency' AND ctx->'emergency' IS DISTINCT FROM 'true'::jsonb)
       OR ((ctx ? 'emergency') <> (ctx ? 'justification'))
       OR (ctx ? 'emergency' AND NOT ctx ? 'dataSubject')
       OR (ctx ? 'justification' AND (jsonb_typeof(ctx->'justification') <> 'string'
           OR length(ctx->>'justification') NOT BETWEEN 10 AND 500 OR ctx->>'justification' ~ '[[:cntrl:]]'))) THEN
    RETURN jsonb_build_object('status',400,'error','invalid_execution_context');
  END IF;
  emergency := coalesce(ctx->'emergency' = 'true'::jsonb, false);

  IF emergency THEN
    -- Bounded break-glass use: at most five unreviewed emergency calls per consumer.
    actor := core.resource_actor();
    SELECT count(*) INTO open_emergencies FROM execution_private.emergency_reviews r
      JOIN execution_private.executions x ON x.tenant_id=r.tenant_id AND x.execution_id=r.execution_id
      WHERE r.tenant_id=tenant AND r.state='pending' AND x.consumer_app_id=actor;
    IF open_emergencies >= 5 THEN RETURN jsonb_build_object('status',429,'error','emergency_review_backlog'); END IF;
  ELSIF ctx ? 'dataSubject' THEN
    actor := core.resource_actor();
    consent := execution_private.active_consent(tenant, c->>'iss', ctx->>'dataSubject', actor,
      payload->'target'->>'capabilityId', ctx->>'purpose');
    IF consent IS NULL THEN RETURN jsonb_build_object('status',403,'error','subject_consent_required'); END IF;
  END IF;

  result := execution_private.execution_command_base('reserve', payload - 'context');
  IF result->>'status' NOT IN ('200','202') THEN RETURN result; END IF;
  execution := (result->'value'->>'executionId')::uuid;
  SELECT * INTO stored FROM execution_private.execution_contexts WHERE tenant_id=tenant AND execution_id=execution;
  found_context := FOUND;

  IF result->>'status' = '202' THEN
    IF ctx IS NOT NULL THEN
      INSERT INTO execution_private.execution_contexts(tenant_id, execution_id, purpose, data_subject, emergency, justification, consent_id)
        VALUES (tenant, execution, ctx->>'purpose', ctx->>'dataSubject', emergency, ctx->>'justification', consent);
      PERFORM app_private.audit_append(CASE WHEN emergency THEN 'execution.emergency_access' ELSE 'execution.subject_accessed' END,
        'execution', execution, 1, 'success', ctx->>'purpose', CASE WHEN ctx ? 'dataSubject'
          THEN 'data_subject_sha256:' || encode(sha256(convert_to(ctx->>'dataSubject','UTF8')),'hex') END);
      IF emergency THEN
        INSERT INTO execution_private.emergency_reviews(tenant_id, execution_id) VALUES (tenant, execution);
      END IF;
    END IF;
  ELSIF found_context <> (ctx IS NOT NULL)
     OR (found_context AND (stored.purpose IS DISTINCT FROM ctx->>'purpose'
                            OR stored.data_subject IS DISTINCT FROM ctx->>'dataSubject'
                            OR stored.emergency IS DISTINCT FROM emergency
                            OR stored.justification IS DISTINCT FROM ctx->>'justification')) THEN
    RETURN jsonb_build_object('status',409,'error','idempotency_conflict');
  END IF;
  RETURN result;
END $$;
ALTER FUNCTION core.execution_command(text,jsonb) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION core.execution_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.execution_command(text,jsonb) TO junctura_execution_api;

-- The data subject manages its own consents. Only the caller's own subject;
-- consumer and capability must exist in the caller's tenant.
CREATE OR REPLACE FUNCTION core.subject_consent(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; tenant text; who text; iss text; s execution_private.subject_consents; expiry timestamptz;
  purposes text[]; items jsonb;
BEGIN
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss';
  IF c IS NULL OR tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR coalesce(iss,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','verified_subject_required');
  END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('status',400,'error','invalid_consent'); END IF;
  IF operation='list' THEN
    IF payload<>'{}'::jsonb THEN RETURN jsonb_build_object('status',400,'error','invalid_consent'); END IF;
    SELECT coalesce(jsonb_agg(execution_private.consent_view(x) ORDER BY x.created_at DESC, x.consent_id),'[]'::jsonb) INTO items
      FROM (SELECT * FROM execution_private.subject_consents WHERE tenant_id=tenant AND issuer=iss AND data_subject=who
            ORDER BY created_at DESC, consent_id LIMIT 200) x;
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('consents',items));
  ELSIF operation='create' THEN
    IF (payload - 'consumerAppId' - 'capabilityId' - 'purposes' - 'expiresAt') <> '{}'::jsonb
       OR coalesce(payload->>'consumerAppId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR coalesce(payload->>'capabilityId','') !~ '^urn:junctura:capability:[0-9a-f-]{36}:[a-z][a-z0-9-]{0,62}$'
       OR jsonb_typeof(payload->'purposes') IS DISTINCT FROM 'array'
       OR jsonb_array_length(payload->'purposes') NOT BETWEEN 1 AND 8
       OR EXISTS (SELECT FROM jsonb_array_elements(payload->'purposes') p WHERE jsonb_typeof(p)<>'string' OR p#>>'{}' !~ '^[a-z][a-z0-9_]{1,62}$')
       OR jsonb_typeof(payload->'expiresAt') IS DISTINCT FROM 'string' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_consent');
    END IF;
    BEGIN expiry := (payload->>'expiresAt')::timestamptz;
    EXCEPTION WHEN others THEN RETURN jsonb_build_object('status',400,'error','invalid_consent'); END;
    IF expiry <= clock_timestamp() OR expiry > clock_timestamp() + interval '366 days' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_consent_expiry');
    END IF;
    SELECT array_agg(DISTINCT p ORDER BY p) INTO purposes FROM jsonb_array_elements_text(payload->'purposes') p;
    IF NOT EXISTS (SELECT FROM app_private.applications a WHERE a.tenant_id=tenant AND a.issuer=iss
                     AND a.app_id=(payload->>'consumerAppId')::uuid AND a.state='active')
       OR NOT EXISTS (SELECT FROM app_private.capability_versions v WHERE v.tenant_id=tenant
                     AND v.capability_id=payload->>'capabilityId' AND v.state IN ('published','deprecated')) THEN
      RETURN jsonb_build_object('status',404,'error','not_found');
    END IF;
    IF (SELECT count(*) FROM execution_private.subject_consents WHERE tenant_id=tenant AND issuer=iss AND data_subject=who
          AND revoked_at IS NULL AND expires_at>clock_timestamp()) >= 200 THEN
      RETURN jsonb_build_object('status',429,'error','consent_limit_reached');
    END IF;
    INSERT INTO execution_private.subject_consents(tenant_id, issuer, data_subject, consumer_app_id, capability_id, purposes, expires_at)
      VALUES (tenant, iss, who, (payload->>'consumerAppId')::uuid, payload->>'capabilityId', purposes, expiry) RETURNING * INTO s;
    RETURN jsonb_build_object('status',201,'value',execution_private.consent_view(s));
  ELSIF operation='revoke' THEN
    IF (payload - 'consentId') <> '{}'::jsonb OR coalesce(payload->>'consentId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_consent');
    END IF;
    SELECT * INTO s FROM execution_private.subject_consents WHERE tenant_id=tenant AND issuer=iss AND data_subject=who
      AND consent_id=(payload->>'consentId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF s.revoked_at IS NULL THEN
      UPDATE execution_private.subject_consents SET revoked_at=clock_timestamp()
        WHERE tenant_id=tenant AND consent_id=s.consent_id RETURNING * INTO s;
    END IF;
    RETURN jsonb_build_object('status',200,'value',execution_private.consent_view(s));
  END IF;
  RETURN jsonb_build_object('status',400,'error','invalid_operation');
END $$;

CREATE OR REPLACE FUNCTION execution_private.consent_view(s execution_private.subject_consents) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('consentId',s.consent_id,'consumer',jsonb_build_object('appId',s.consumer_app_id,'displayName',
      (SELECT a.display_name FROM app_private.applications a WHERE a.tenant_id=s.tenant_id AND a.app_id=s.consumer_app_id)),
    'capabilityId',s.capability_id,
    'capabilityTitle',(SELECT v.manifest->>'title' FROM app_private.capability_versions v WHERE v.tenant_id=s.tenant_id
       AND v.capability_id=s.capability_id ORDER BY v.created_at DESC LIMIT 1),
    'purposes',to_jsonb(s.purposes),
    'createdAt',to_char(s.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'expiresAt',to_char(s.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'revokedAt',CASE WHEN s.revoked_at IS NULL THEN NULL ELSE to_char(s.revoked_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'state',CASE WHEN s.revoked_at IS NOT NULL THEN 'revoked' WHEN s.expires_at<=clock_timestamp() THEN 'expired' ELSE 'active' END)
$$;
ALTER FUNCTION execution_private.consent_view(execution_private.subject_consents) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION execution_private.consent_view(execution_private.subject_consents) FROM PUBLIC;

-- Emergency access review for tenant administrators (trust.approve).
CREATE OR REPLACE FUNCTION core.emergency_review(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb; tenant text; who text; iss text; client text; perms text[]; r execution_private.emergency_reviews; items jsonb;
BEGIN
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss'; client:=c->>'client_id';
  IF c IS NULL OR coalesce(tenant,'')='' OR coalesce(who,'')='' OR coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','trust_permission_required');
  END IF;
  SELECT p.permissions INTO perms FROM app_private.principals p
    WHERE p.tenant_id=tenant AND p.issuer=iss AND p.subject=who AND p.management_client=client AND p.enabled;
  IF perms IS NULL OR NOT 'trust.approve'=ANY(perms) THEN RETURN jsonb_build_object('status',403,'error','trust_permission_required'); END IF;
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('status',400,'error','invalid_emergency_review'); END IF;
  IF operation='list' THEN
    IF payload<>'{}'::jsonb THEN RETURN jsonb_build_object('status',400,'error','invalid_emergency_review'); END IF;
    SELECT coalesce(jsonb_agg(execution_private.emergency_view(q.*) ORDER BY q.recorded_at DESC),'[]'::jsonb) INTO items FROM (
      SELECT er.*, x.recorded_at, x.purpose, x.justification, e.consumer_app_id, e.provider_app_id, e.capability_id, e.version, e.state AS execution_state
        FROM execution_private.emergency_reviews er
        JOIN execution_private.execution_contexts x ON x.tenant_id=er.tenant_id AND x.execution_id=er.execution_id
        JOIN execution_private.executions e ON e.tenant_id=er.tenant_id AND e.execution_id=er.execution_id
        WHERE er.tenant_id=tenant AND e.issuer=iss ORDER BY x.recorded_at DESC LIMIT 200) q;
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('reviews',items));
  ELSIF operation='review' THEN
    IF (payload - 'executionId' - 'decision' - 'note') <> '{}'::jsonb
       OR coalesce(payload->>'executionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       OR coalesce(payload->>'decision','') NOT IN ('justified','unjustified')
       OR jsonb_typeof(payload->'note') IS DISTINCT FROM 'string' OR length(payload->>'note') NOT BETWEEN 1 AND 500
       OR payload->>'note' ~ '[[:cntrl:]]' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_emergency_review');
    END IF;
    SELECT r2.* INTO r FROM execution_private.emergency_reviews r2
      JOIN execution_private.executions e ON e.tenant_id=r2.tenant_id AND e.execution_id=r2.execution_id
      WHERE r2.tenant_id=tenant AND r2.execution_id=(payload->>'executionId')::uuid AND e.issuer=iss FOR UPDATE OF r2;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF r.state<>'pending' THEN RETURN jsonb_build_object('status',409,'error','already_reviewed'); END IF;
    UPDATE execution_private.emergency_reviews SET state=payload->>'decision', reviewer_subject=who, reviewer_client=client,
      note=payload->>'note', reviewed_at=clock_timestamp(), revision=revision+1
      WHERE tenant_id=tenant AND execution_id=r.execution_id RETURNING * INTO r;
    PERFORM app_private.audit_append('execution.emergency_reviewed','execution',r.execution_id,r.revision,
      CASE WHEN r.state='justified' THEN 'success' ELSE 'denied' END, r.state, payload->>'note');
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('executionId',r.execution_id,'state',r.state,
      'reviewedAt',to_char(r.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  END IF;
  RETURN jsonb_build_object('status',400,'error','invalid_operation');
END $$;

CREATE OR REPLACE FUNCTION execution_private.emergency_view(q record) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
BEGIN
  RETURN jsonb_build_object('executionId',q.execution_id,'state',q.state,
    'accessedAt',to_char(q.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'purpose',q.purpose,'justification',q.justification,'executionState',q.execution_state,
    'consumer',jsonb_build_object('appId',q.consumer_app_id,'displayName',
      (SELECT a.display_name FROM app_private.applications a WHERE a.tenant_id=q.tenant_id AND a.app_id=q.consumer_app_id)),
    'provider',jsonb_build_object('appId',q.provider_app_id,'displayName',
      (SELECT a.display_name FROM app_private.applications a WHERE a.tenant_id=q.tenant_id AND a.app_id=q.provider_app_id)),
    'capability',jsonb_build_object('capabilityId',q.capability_id,'version',q.version),
    'note',q.note,
    'reviewedAt',CASE WHEN q.reviewed_at IS NULL THEN NULL ELSE to_char(q.reviewed_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END);
END $$;
ALTER FUNCTION execution_private.emergency_view(record) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION execution_private.emergency_view(record) FROM PUBLIC;

-- The subject's access log now shows emergency calls and their review state.
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
    SELECT x.*, e.consumer_app_id, e.provider_app_id, e.capability_id, e.version, e.version_id, e.state,
           r.state AS review_state
      FROM execution_private.execution_contexts x
      JOIN execution_private.executions e ON e.tenant_id=x.tenant_id AND e.execution_id=x.execution_id
      LEFT JOIN execution_private.emergency_reviews r ON r.tenant_id=x.tenant_id AND r.execution_id=x.execution_id
      WHERE x.tenant_id=tenant AND x.data_subject=who AND e.issuer=iss
  ), newest AS (SELECT * FROM mine ORDER BY recorded_at DESC, execution_id LIMIT max_items)
  SELECT (SELECT count(*) FROM mine), coalesce(jsonb_agg(jsonb_build_object(
      'executionId', n.execution_id,
      'accessedAt', to_char(n.recorded_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'purpose', n.purpose,
      'state', n.state,
      'emergency', n.emergency,
      'review', n.review_state,
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

ALTER FUNCTION core.subject_consent(text,jsonb) OWNER TO junctura_app_owner;
ALTER FUNCTION core.emergency_review(text,jsonb) OWNER TO junctura_app_owner;
ALTER FUNCTION core.subject_access(jsonb) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION core.subject_consent(text,jsonb) FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api,junctura_audit_api,junctura_trust_api,junctura_execution_api;
REVOKE ALL ON FUNCTION core.emergency_review(text,jsonb) FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api,junctura_audit_api,junctura_subject_api,junctura_execution_api;
GRANT EXECUTE ON FUNCTION core.subject_consent(text,jsonb) TO junctura_subject_api;
GRANT EXECUTE ON FUNCTION core.emergency_review(text,jsonb) TO junctura_trust_api;
INSERT INTO core.schema_migrations(version) VALUES(21);
NOTIFY pgrst,'reload schema';
COMMIT;
