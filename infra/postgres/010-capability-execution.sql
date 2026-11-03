-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
-- C4A private authority. Apply only after the fresh-database/security checks.
BEGIN;

-- Repair the two identified C1 prerequisites without replaying migration 006
-- over later authority changes. Exact, unique anchors fail on unexpected drift.
DO $migration$
DECLARE
  -- Migration 008 put the C1 implementation behind its approval-syntax
  -- wrapper; 009 renamed that wrapper. Preserve both later wrappers.
  definition text := pg_get_functiondef('app_private.capability_command_c1(text,jsonb)'::regprocedure);
  old_guard text := 'IF v.validation_status<>''valid'' OR v.validation_digest<>v.digest OR v.validation_revision<>v.revision THEN';
  old_return text := 'RETURN jsonb_build_object(''status'',200,''value'',report||jsonb_build_object(''versionId'',v.version_id));';
BEGIN
  IF (length(definition)-length(replace(definition,old_guard,'')))/length(old_guard) <> 1
    OR (length(definition)-length(replace(definition,old_return,'')))/length(old_return) <> 1 THEN
    RAISE EXCEPTION 'Unexpected C1 management definition; inspect installed authority before migration 010';
  END IF;
  definition := replace(definition,old_guard,
    'IF v.validation_status IS DISTINCT FROM ''valid'' OR v.validation_digest IS DISTINCT FROM v.digest
      OR v.validation_revision IS DISTINCT FROM v.revision OR v.validation_policy_revision IS DISTINCT FROM 1
      OR v.validated_at IS NULL OR v.validation_report->>''status'' IS DISTINCT FROM ''valid''
      OR v.validation_report->>''digest'' IS DISTINCT FROM v.digest
      OR v.validation_report->>''revision'' IS DISTINCT FROM v.revision::text
      OR v.validation_report->>''policyRevision'' IS DISTINCT FROM ''1'' THEN');
  definition := replace(definition,old_return,
    'PERFORM app_private.audit_append(''capability.validated'',''capability'',v.version_id,v.revision,
      CASE WHEN report_status=''valid'' THEN ''success'' ELSE ''failed'' END,report_status,NULL);
        ' || old_return);
  EXECUTE definition;
END $migration$;

-- An optional trusted Core claim restricts the existing C2 predicate to the
-- single grant reserved by C4A. Ordinary C2 assertions do not carry this claim.
-- Reuse the predicate rather than maintaining a second permission algorithm.
DO $grant_binding$
DECLARE definition text:=pg_get_functiondef('trust_private.granted(app_private.capability_versions,text)'::regprocedure);
  anchor text:='AND g.state=''active'' AND g.expires_at>statement_timestamp()';
BEGIN
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Unexpected C2 eligibility definition; inspect authority before migration 010';
  END IF;
  definition:=replace(definition,anchor,anchor || '
      AND (current_setting(''request.jwt.claims'',true)::jsonb->>''c4a_grant_id'' IS NULL OR
        (g.grant_id::text=current_setting(''request.jwt.claims'',true)::jsonb->>''c4a_grant_id'' AND g.expires_at>clock_timestamp()))');
  EXECUTE definition;
END $grant_binding$;

-- Existing invalid publication authority must block migration, not be silently
-- blessed. The published revision includes the publication transition itself.
ALTER TABLE app_private.capability_versions ADD CONSTRAINT capability_published_validation
  CHECK (state <> 'published' OR (
    validation_status IS NOT DISTINCT FROM 'valid'
    AND validation_digest IS NOT DISTINCT FROM digest
    AND validation_revision IS NOT DISTINCT FROM revision-1
    AND validation_policy_revision IS NOT DISTINCT FROM 1
    AND validated_at IS NOT NULL
    AND validation_report->>'status' IS NOT DISTINCT FROM 'valid'
    AND validation_report->>'digest' IS NOT DISTINCT FROM digest
    AND validation_report->>'revision' IS NOT DISTINCT FROM validation_revision::text
    AND validation_report->>'policyRevision' IS NOT DISTINCT FROM '1'));

DO $roles$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_execution_api') THEN
    CREATE ROLE rosetta_execution_api NOLOGIN NOBYPASSRLS;
  END IF;
END $roles$;
GRANT rosetta_execution_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_execution_api;
CREATE SCHEMA execution_private AUTHORIZATION rosetta_app_owner;
REVOKE ALL ON SCHEMA execution_private FROM PUBLIC;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;

CREATE TABLE execution_private.executions (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  execution_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  initiating_subject text NOT NULL CHECK (length(initiating_subject) BETWEEN 1 AND 255),
  initiating_client text NOT NULL CHECK (length(initiating_client) BETWEEN 1 AND 255),
  consumer_app_id uuid NOT NULL,
  provider_app_id uuid NOT NULL,
  version_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  capability_id text NOT NULL,
  version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  -- Core enforces 64 KiB on the original wire and canonical value. PostgreSQL
  -- expands exponent notation/spacing, so its representation has its own bound.
  input jsonb NOT NULL CHECK (pg_column_size(input) <= 1048576),
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  deadline_at timestamptz NOT NULL,
  authority_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state text NOT NULL DEFAULT 'accepted' CHECK (state IN
    ('accepted','running','auth_required','succeeded','failed','cancelled','timed_out','outcome_unknown')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  engine_definition_id text CHECK (length(engine_definition_id) BETWEEN 1 AND 128),
  engine_process_id text UNIQUE CHECK (length(engine_process_id) BETWEEN 1 AND 128),
  engine_business_key text NOT NULL UNIQUE,
  engine_start_attempted_at timestamptz,
  engine_job_id text UNIQUE CHECK (length(engine_job_id) BETWEEN 1 AND 128),
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 1),
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  dispatch_phase text NOT NULL DEFAULT 'reserved' CHECK (dispatch_phase IN
    ('reserved','prepared','dispatched','redeemed','finished')),
  ticket_hash text UNIQUE CHECK (ticket_hash ~ '^sha256:[0-9a-f]{64}$'),
  ticket_expires_at timestamptz,
  ticket_consumed_at timestamptz,
  output jsonb CHECK (pg_column_size(output) <= 1048576),
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  finished_at timestamptz,
  result_expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,execution_id),
  UNIQUE (execution_id),
  UNIQUE (tenant_id,issuer,initiating_subject,initiating_client,consumer_app_id,idempotency_key),
  FOREIGN KEY (tenant_id,consumer_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,provider_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,version_id) REFERENCES app_private.capability_versions(tenant_id,version_id),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES trust_private.grants(tenant_id,grant_id),
  CHECK (consumer_app_id <> provider_app_id),
  CHECK (deadline_at <= authority_expires_at),
  CHECK (result_expires_at >= created_at + interval '24 hours'),
  CHECK ((ticket_hash IS NULL) = (ticket_expires_at IS NULL)),
  CHECK (ticket_expires_at IS NULL OR ticket_expires_at <= deadline_at),
  CHECK (ticket_consumed_at IS NULL OR ticket_hash IS NOT NULL),
  CHECK (attempt=0 OR engine_job_id IS NOT NULL),
  CHECK (engine_start_attempted_at IS NULL OR engine_definition_id IS NOT NULL),
  CHECK (engine_process_id IS NULL OR engine_start_attempted_at IS NOT NULL),
  CHECK (state <> 'succeeded' OR (ticket_consumed_at IS NOT NULL AND finished_at IS NOT NULL AND output IS NOT NULL))
);
ALTER TABLE execution_private.executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE execution_private.executions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON execution_private.executions TO rosetta_app_owner
  USING (tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id')
  WITH CHECK (tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id');
CREATE INDEX execution_tenant_pending ON execution_private.executions(tenant_id,deadline_at)
  WHERE state IN ('accepted','running','auth_required');

CREATE FUNCTION execution_private.view(e execution_private.executions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('executionId',e.execution_id,'tenantId',e.tenant_id,
    'target',jsonb_build_object('kind','capability','capability',jsonb_build_object(
      'capabilityId',e.capability_id,'version',e.version,'manifestDigest',e.manifest_digest)),
    'state',e.state,'revision',e.revision,
    'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadlineAt',to_char(e.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    || CASE WHEN e.state='succeeded' THEN jsonb_build_object('output',e.output) ELSE '{}'::jsonb END
    || CASE WHEN e.error_code IS NOT NULL THEN jsonb_build_object('error',e.error_code) ELSE '{}'::jsonb END
$$;

-- Resolve invoke authority independently of discovery permission. No metadata
-- response from this internal helper is itself an execution authorization cache.
CREATE FUNCTION execution_private.resolve_reference(reference jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  v app_private.capability_versions; provider app_private.applications;
  actor uuid:=core.resource_actor(); authority_expiry timestamptz; selected_grant uuid; candidate record;
BEGIN
  IF actor IS NULL OR c->'trust_writer' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('status',403,'error','consumer_binding_required');
  END IF;
  IF jsonb_typeof(reference) IS DISTINCT FROM 'object' OR
    EXISTS(SELECT FROM jsonb_object_keys(reference) k WHERE k NOT IN ('capabilityId','version','manifestDigest')) THEN
    RETURN jsonb_build_object('status',400,'error','invalid_capability_reference');
  END IF;
  SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=c->>'tenant_id'
    AND capability_id=reference->>'capabilityId' AND version=reference->>'version'
    AND digest=reference->>'manifestDigest' AND state='published';
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
  FOR candidate IN SELECT g.grant_id,g.expires_at FROM trust_private.grants g WHERE g.tenant_id=v.tenant_id
    AND g.issuer=c->>'iss' AND g.consumer_app_id=actor AND g.provider_app_id=v.provider_app_id
    AND g.version_id=v.version_id AND g.manifest_digest=v.digest AND g.state='active' AND g.expires_at>clock_timestamp()
    AND (c->>'c4a_grant_id' IS NULL OR g.grant_id::text=c->>'c4a_grant_id')
    ORDER BY g.expires_at DESC,g.grant_id LIMIT 32 FOR SHARE LOOP
    PERFORM set_config('request.jwt.claims',(c||jsonb_build_object('c4a_grant_id',candidate.grant_id))::text,true);
    IF trust_private.granted(v,'invoke') THEN selected_grant:=candidate.grant_id; authority_expiry:=candidate.expires_at; END IF;
    PERFORM set_config('request.jwt.claims',c::text,true);
    EXIT WHEN selected_grant IS NOT NULL;
  END LOOP;
  IF selected_grant IS NULL THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
  IF v.manifest->'sideEffects'->>'kind' IS DISTINCT FROM 'none'
    OR v.manifest->'preconditions'->>'approval' IS DISTINCT FROM 'none' THEN
    RETURN jsonb_build_object('status',422,'error','unsupported_execution_precondition');
  END IF;
  SELECT * INTO provider FROM app_private.applications WHERE tenant_id=v.tenant_id AND app_id=v.provider_app_id
    AND issuer=c->>'iss' AND state='active';
  IF NOT FOUND OR NOT EXISTS(SELECT FROM app_private.enrollments e WHERE
    (e.tenant_id,e.issuer,e.oauth_client_id,e.owner_subject,e.provider_origin)=
    (provider.tenant_id,provider.issuer,provider.oauth_client_id,provider.owner_subject,provider.provider_origin)
    AND e.enabled AND e.resource_subject IS NOT NULL) THEN
    RETURN jsonb_build_object('status',403,'error','provider_not_enrolled');
  END IF;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object(
    'manifest',v.manifest,'providerOrigin',provider.provider_origin,'providerAppId',provider.app_id,
    'consumerAppId',actor,'versionId',v.version_id,'grantId',selected_grant,'authorityExpiresAt',authority_expiry));
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims',c::text,true);
  RAISE;
END $$;

-- Recheck stored consumer authority during provider redemption. The caller must
-- separately prove a live in-memory initiating lease in its signed assertion.
CREATE FUNCTION execution_private.live(e execution_private.executions) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original text:=current_setting('request.jwt.claims',true); decision jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('tenant_id',e.tenant_id,'iss',e.issuer,
    'sub',e.initiating_subject,'client_id',e.initiating_client,'trust_writer',true,'c4a_grant_id',e.grant_id)::text,true);
  decision:=execution_private.resolve_reference(jsonb_build_object('capabilityId',e.capability_id,
    'version',e.version,'manifestDigest',e.manifest_digest));
  PERFORM set_config('request.jwt.claims',original,true);
  RETURN decision->>'status'='200' AND decision->'value'->>'consumerAppId'=e.consumer_app_id::text
    AND e.authority_expires_at>clock_timestamp();
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims',original,true);
  RAISE;
END $$;

CREATE FUNCTION execution_private.lease_valid(e execution_private.executions) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE proof jsonb:=current_setting('request.jwt.claims',true)::jsonb->'c4a_lease'; expiry timestamptz;
BEGIN
  IF proof->>'executionId' IS DISTINCT FROM e.execution_id::text
    OR proof->>'tenantId' IS DISTINCT FROM e.tenant_id OR proof->>'issuer' IS DISTINCT FROM e.issuer
    OR proof->>'subject' IS DISTINCT FROM e.initiating_subject OR proof->>'clientId' IS DISTINCT FROM e.initiating_client
    OR proof->'writer' IS DISTINCT FROM 'true'::jsonb THEN RETURN false; END IF;
  expiry:=(proof->>'expiresAt')::timestamptz;
  RETURN coalesce(expiry>clock_timestamp() AND expiry<=e.deadline_at AND expiry<=e.authority_expires_at,false);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN false;
END $$;

CREATE FUNCTION core.execution_command(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; actor uuid; e execution_private.executions;
  resolved jsonb; reference jsonb; stamp timestamptz:=clock_timestamp();
  deadline timestamptz; ticket_expiry timestamptz; next_state text; event_name text;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR coalesce(c->>'iss','')=''
    OR coalesce(c->>'sub','')='' OR coalesce(c->>'client_id','')='' THEN
    RETURN jsonb_build_object('status',403,'error','verified_principal_required');
  END IF;
  actor:=core.resource_actor();
  IF actor IS NULL THEN RETURN jsonb_build_object('status',403,'error','application_binding_required'); END IF;
  IF operation='resolve' THEN RETURN execution_private.resolve_reference(payload); END IF;
  IF operation='reserve' THEN
    reference:=payload->'target';
    resolved:=execution_private.resolve_reference(reference);
    IF resolved->>'status'<>'200' THEN RETURN resolved; END IF;
    IF coalesce(payload->>'inputDigest','') !~ '^sha256:[0-9a-f]{64}$'
      OR coalesce(payload->>'requestDigest','') !~ '^sha256:[0-9a-f]{64}$'
      OR NOT payload ? 'input' THEN RETURN jsonb_build_object('status',400,'error','invalid_execution_request'); END IF;
    -- Serialize all reservations for this initiating principal/key, including
    -- the no-row case. Hash collisions only reduce concurrency, never authority.
    PERFORM pg_advisory_xact_lock(hashtextextended(tenant||'|'||(c->>'iss')||'|'||(c->>'sub')||'|'||actor::text||'|'||(payload->>'idempotencyKey'),0));
    SELECT * INTO e FROM execution_private.executions WHERE tenant_id=tenant AND issuer=c->>'iss'
      AND initiating_subject=c->>'sub' AND initiating_client=c->>'client_id' AND consumer_app_id=actor
      AND idempotency_key=(payload->>'idempotencyKey')::uuid FOR UPDATE;
    IF FOUND THEN
      IF e.request_digest<>payload->>'requestDigest' OR e.input_digest<>payload->>'inputDigest'
        OR e.input IS DISTINCT FROM payload->'input' OR e.capability_id IS DISTINCT FROM reference->>'capabilityId'
        OR e.version IS DISTINCT FROM reference->>'version' OR e.manifest_digest IS DISTINCT FROM reference->>'manifestDigest' THEN
        RETURN jsonb_build_object('status',409,'error','idempotency_conflict');
      END IF;
      IF NOT execution_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
      IF e.result_expires_at<=stamp THEN RETURN jsonb_build_object('status',409,'error','result_expired'); END IF;
      RETURN jsonb_build_object('status',200,'value',execution_private.view(e));
    END IF;
    deadline:=least((payload->>'deadlineAt')::timestamptz,
      stamp+((resolved->'value'->'manifest'->>'timeoutMs')::integer)*interval '1 millisecond',
      (resolved->'value'->>'authorityExpiresAt')::timestamptz);
    IF deadline IS NULL OR deadline<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','execution_deadline_expired'); END IF;
    INSERT INTO execution_private.executions(tenant_id,execution_id,issuer,initiating_subject,initiating_client,
      consumer_app_id,provider_app_id,version_id,grant_id,capability_id,version,manifest_digest,input,input_digest,
      request_digest,idempotency_key,operation_id,deadline_at,authority_expires_at,created_at,updated_at,result_expires_at,engine_business_key)
      VALUES(tenant,(payload->>'executionId')::uuid,c->>'iss',c->>'sub',c->>'client_id',actor,
        (resolved->'value'->>'providerAppId')::uuid,(resolved->'value'->>'versionId')::uuid,(resolved->'value'->>'grantId')::uuid,
        reference->>'capabilityId',reference->>'version',reference->>'manifestDigest',payload->'input',
        payload->>'inputDigest',payload->>'requestDigest',(payload->>'idempotencyKey')::uuid,(payload->>'executionId')::uuid,deadline,
        (resolved->'value'->>'authorityExpiresAt')::timestamptz,stamp,stamp,stamp+interval '24 hours',
        'c4a:'||tenant||':'||(payload->>'executionId')) RETURNING * INTO e;
    PERFORM app_private.audit_append('execution.accepted','execution',e.execution_id,e.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',202,'value',execution_private.view(e));
  END IF;

  SELECT * INTO e FROM execution_private.executions WHERE tenant_id=tenant AND execution_id=(payload->>'executionId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    IF operation IN ('ticket_context','redeem') THEN RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false)); END IF;
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;
  IF operation IN ('ticket_context','redeem') THEN
    IF actor<>e.provider_app_id OR e.issuer<>c->>'iss' OR e.ticket_hash IS DISTINCT FROM payload->>'ticketHash'
      OR e.input_digest IS DISTINCT FROM payload->>'inputDigest' OR e.ticket_consumed_at IS NOT NULL
      OR e.ticket_expires_at IS NULL OR e.ticket_expires_at<=clock_timestamp() OR e.deadline_at<=clock_timestamp()
      OR e.state<>'running' OR e.dispatch_phase<>'dispatched' OR e.attempt<>1 THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false));
    END IF;
    IF operation='ticket_context' THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',true,'executionId',e.execution_id,
        'tenantId',e.tenant_id,'issuer',e.issuer,'subject',e.initiating_subject,'clientId',e.initiating_client,
        'target',jsonb_build_object('capabilityId',e.capability_id,'version',e.version,'manifestDigest',e.manifest_digest)));
    END IF;
    IF NOT execution_private.lease_valid(e) OR NOT execution_private.live(e) THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false));
    END IF;
    UPDATE execution_private.executions SET ticket_consumed_at=clock_timestamp(),dispatch_phase='redeemed',
      revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    PERFORM app_private.audit_append('authorization.redeemed','authorization',e.execution_id,e.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',true,
      'expiresAt',to_char(e.ticket_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'context',jsonb_build_object('tenantId',e.tenant_id,'issuer',e.issuer,'subject',e.initiating_subject,
        'principalType','service','initiatingSubject',e.initiating_subject,'initiatingAppId',e.consumer_app_id,
        'executorSubject','rosetta-core:c4a','stepId','invoke','grantIds',jsonb_build_array(e.grant_id),'approvalIds','[]'::jsonb,
        'permissions',(SELECT manifest->'requiredPermissions' FROM app_private.capability_versions WHERE tenant_id=e.tenant_id AND version_id=e.version_id),
        'actorAppId',e.consumer_app_id,'providerAppId',e.provider_app_id,'executionId',e.execution_id,
        'invocationId',e.execution_id,'capability',jsonb_build_object('capabilityId',e.capability_id,
          'version',e.version,'manifestDigest',e.manifest_digest),'inputDigest',e.input_digest,'attempt',e.attempt,
        'operationId',e.operation_id,'deadlineAt',to_char(e.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  END IF;
  IF actor<>e.consumer_app_id OR e.issuer<>c->>'iss' OR e.initiating_subject<>c->>'sub' OR e.initiating_client<>c->>'client_id' THEN
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;
  IF operation='get' THEN
    IF c->'trust_writer' IS DISTINCT FROM 'true'::jsonb OR NOT execution_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
    IF e.result_expires_at<=stamp THEN RETURN jsonb_build_object('status',409,'error','result_expired'); END IF;
    RETURN jsonb_build_object('status',200,'value',execution_private.view(e));
  END IF;
  IF operation='internal_get' THEN
    IF c->'trust_writer' IS DISTINCT FROM 'true'::jsonb OR NOT execution_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
    RETURN jsonb_build_object('status',200,'value',to_jsonb(e));
  END IF;
  IF operation IN ('reauthorize','engine_reserve','engine_bind','prepare','dispatch') THEN
    IF e.deadline_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','execution_deadline_expired'); END IF;
    IF NOT execution_private.lease_valid(e) THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    IF NOT execution_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
  END IF;
  IF operation='reauthorize' THEN
    IF e.state<>'auth_required' OR e.attempt<>0 OR e.dispatch_phase<>'reserved' THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    UPDATE execution_private.executions SET state='accepted',error_code=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.reauthorized';
  ELSIF operation='engine_reserve' THEN
    IF e.engine_start_attempted_at IS NOT NULL OR e.state<>'accepted' THEN RETURN jsonb_build_object('status',409,'error','execution_pending_reconciliation'); END IF;
    UPDATE execution_private.executions SET engine_definition_id=payload->>'definitionId',
      engine_start_attempted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.engine_reserved';
  ELSIF operation='engine_bind' THEN
    IF e.engine_start_attempted_at IS NULL OR e.engine_definition_id IS DISTINCT FROM payload->>'definitionId'
      OR (e.engine_process_id IS NOT NULL AND e.engine_process_id IS DISTINCT FROM payload->>'processId') THEN
      RETURN jsonb_build_object('status',409,'error','execution_pending_reconciliation');
    END IF;
    UPDATE execution_private.executions SET engine_process_id=payload->>'processId',revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.engine_bound';
  ELSIF operation='prepare' THEN
    IF e.state<>'accepted' OR e.attempt<>0 OR e.engine_process_id IS NULL
      OR e.engine_process_id IS DISTINCT FROM payload->>'processId' OR e.engine_definition_id IS DISTINCT FROM payload->>'definitionId' THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    ticket_expiry:=least((payload->>'ticketExpiresAt')::timestamptz,e.deadline_at,e.authority_expires_at,
      (c->'c4a_lease'->>'expiresAt')::timestamptz,clock_timestamp()+interval '30 seconds');
    IF ticket_expiry<=clock_timestamp() OR ticket_expiry IS NULL THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    UPDATE execution_private.executions SET attempt=1,engine_job_id=payload->>'jobId',
      ticket_hash=payload->>'ticketHash',ticket_expires_at=ticket_expiry,dispatch_phase='prepared',
      revision=revision+1,updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='invocation.prepared';
  ELSIF operation='dispatch' THEN
    IF e.state<>'accepted' OR e.dispatch_phase<>'prepared' OR e.engine_job_id IS DISTINCT FROM payload->>'jobId'
      OR e.ticket_hash IS NULL OR e.ticket_expires_at<=clock_timestamp() THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    UPDATE execution_private.executions SET state='running',dispatch_phase='dispatched',revision=revision+1,
      updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='invocation.dispatched';
  ELSIF operation='finish' THEN
    next_state:=payload->>'state';
    IF e.state NOT IN ('accepted','running','auth_required') OR next_state NOT IN
      ('succeeded','failed','auth_required','timed_out','outcome_unknown') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    IF next_state='succeeded' AND (e.ticket_consumed_at IS NULL OR NOT payload ? 'output') THEN
      RETURN jsonb_build_object('status',409,'error','provider_authorization_required');
    END IF;
    IF e.dispatch_phase IN ('dispatched','redeemed') AND next_state IN ('auth_required','timed_out') THEN next_state:='outcome_unknown'; END IF;
    IF next_state='succeeded' AND e.deadline_at<=clock_timestamp() THEN next_state:='outcome_unknown'; END IF;
    UPDATE execution_private.executions SET state=next_state,output=CASE WHEN next_state='succeeded' THEN payload->'output' ELSE NULL END,
      error_code=CASE WHEN next_state='succeeded' THEN NULL ELSE coalesce(payload->>'error','execution_failed') END,
      dispatch_phase=CASE WHEN next_state='auth_required' THEN dispatch_phase ELSE 'finished' END,
      ticket_expires_at=CASE WHEN next_state='auth_required' THEN ticket_expires_at ELSE least(ticket_expires_at,clock_timestamp()) END,
      revision=revision+1,finished_at=CASE WHEN next_state='auth_required' THEN NULL ELSE clock_timestamp() END,
      updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.'||CASE WHEN next_state='succeeded' THEN 'completed' ELSE next_state END;
  ELSE RETURN jsonb_build_object('status',400,'error','invalid_operation');
  END IF;
  PERFORM app_private.audit_append(event_name,CASE WHEN event_name LIKE 'invocation.%' THEN 'invocation' ELSE 'execution' END,
    e.execution_id,e.revision,CASE WHEN e.state='outcome_unknown' THEN 'unknown' WHEN e.state IN ('failed','timed_out','auth_required') THEN 'failed' ELSE 'success' END,
    e.error_code,NULL);
  RETURN jsonb_build_object('status',200,'value',execution_private.view(e));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('status',400,'error','invalid_execution_request');
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA execution_private FROM PUBLIC;
REVOKE ALL ON FUNCTION core.execution_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.execution_command(text,jsonb) TO rosetta_execution_api;

-- No table grants, credentials, automatic retention deletion or public routes.
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(10);
NOTIFY pgrst,'reload schema';
COMMIT;
