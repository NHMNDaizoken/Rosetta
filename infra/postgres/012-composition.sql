-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
-- C4B bounded composition registry and execution authority. Additive only:
-- migrations 001..011 and their installed objects are not modified.
BEGIN;

ALTER TABLE app_private.principals DROP CONSTRAINT IF EXISTS principals_permissions_check;
ALTER TABLE app_private.principals ADD CONSTRAINT principals_permissions_check
  CHECK (permissions <@ ARRAY['applications.register','applications.approve','trust.write','trust.approve','audit.read',
    'capabilities.write','capabilities.publish','capabilities.approve',
    'compositions.write','compositions.publish','compositions.approve']::text[]);

DO $roles$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='junctura_composition_api') THEN
    CREATE ROLE junctura_composition_api NOLOGIN NOBYPASSRLS;
  END IF;
END $roles$;
GRANT junctura_composition_api TO junctura_data;
GRANT USAGE ON SCHEMA core TO junctura_composition_api;

CREATE SCHEMA composition_private AUTHORIZATION junctura_app_owner;
REVOKE ALL ON SCHEMA composition_private FROM PUBLIC;
GRANT CREATE ON SCHEMA core TO junctura_app_owner;
SET LOCAL ROLE junctura_app_owner;

CREATE TABLE composition_private.compositions (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  composition_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_app_id uuid NOT NULL,
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (tenant_id,composition_id),
  UNIQUE (composition_id),
  FOREIGN KEY (tenant_id,owner_app_id) REFERENCES app_private.applications(tenant_id,app_id)
);

CREATE TABLE composition_private.composition_versions (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  composition_id uuid NOT NULL,
  owner_app_id uuid NOT NULL,
  version text NOT NULL CHECK (version ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'),
  composition jsonb NOT NULL CHECK (jsonb_typeof(composition)='object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','deprecated','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  validation_status text CHECK (validation_status IS NULL OR validation_status IN ('valid','invalid','indeterminate')),
  validation_digest text CHECK (validation_digest IS NULL OR validation_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_revision integer CHECK (validation_revision IS NULL OR validation_revision > 0),
  validation_report jsonb,
  validated_at timestamptz,
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 255),
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  published_at timestamptz,
  deprecated_at timestamptz,
  revoked_at timestamptz,
  reason text,
  PRIMARY KEY (tenant_id,version_id),
  UNIQUE (version_id),
  UNIQUE (tenant_id,composition_id,version),
  FOREIGN KEY (tenant_id,composition_id) REFERENCES composition_private.compositions(tenant_id,composition_id),
  FOREIGN KEY (tenant_id,owner_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  CHECK (validation_revision IS NULL OR validation_revision > 0)
);

CREATE TABLE composition_private.composition_publication_approvals (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  approval_id uuid NOT NULL,
  version_id uuid NOT NULL,
  composition_id uuid NOT NULL,
  composition_digest text NOT NULL CHECK (composition_digest ~ '^sha256:[0-9a-f]{64}$'),
  version_revision integer NOT NULL CHECK (version_revision > 0),
  requester_subject text NOT NULL CHECK (length(requester_subject) BETWEEN 1 AND 255),
  requester_app_id uuid NOT NULL,
  decision text NOT NULL CHECK (decision IN ('approve','deny')),
  approver_subject text NOT NULL CHECK (length(approver_subject) BETWEEN 1 AND 255),
  management_client text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('approved','denied','consumed','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY (tenant_id,approval_id),
  UNIQUE (approval_id),
  FOREIGN KEY (tenant_id,version_id) REFERENCES composition_private.composition_versions(tenant_id,version_id),
  CHECK (requester_subject <> approver_subject)
);

DO $rls$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['compositions','composition_versions','composition_publication_approvals'] LOOP
    EXECUTE format('ALTER TABLE composition_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE composition_private.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON composition_private.%I TO junctura_app_owner
      USING (tenant_id=current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')
      WITH CHECK (tenant_id=current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')',t);
  END LOOP;
END $rls$;

CREATE FUNCTION app_private.composition_version_view(v composition_private.composition_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'compositionId',v.composition_id,'ownerAppId',v.owner_app_id,'composition',v.composition,
    'version',v.version,'state',v.state,'revision',v.revision,'digest',v.digest,
    'validation',CASE WHEN v.validation_status IS NULL THEN NULL ELSE jsonb_build_object(
      'status',v.validation_status,'digest',v.validation_digest,'revision',v.validation_revision,
      'report',v.validation_report,'validatedAt',v.validated_at) END,
    'createdBy',v.created_by,'updatedBy',v.updated_by,'createdAt',v.created_at,'updatedAt',v.updated_at,
    'publishedAt',v.published_at,'deprecatedAt',v.deprecated_at,'revokedAt',v.revoked_at)
$$;

CREATE FUNCTION app_private.composition_approval_view(a composition_private.composition_publication_approvals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'approvalId',a.approval_id,'tenantId',a.tenant_id,
    'decision',jsonb_build_object('resourceType','composition-version',
      'resourceId',a.composition_id,'resourceDigest',a.composition_digest,
      'resourceRevision',a.version_revision,'requesterSubject',a.requester_subject,
      'requesterAppId',a.requester_app_id,'decision',a.decision,'expiresAt',a.expires_at),
    'versionId',a.version_id,'compositionId',a.composition_id,
    'state',CASE WHEN a.state IN ('approved','denied') AND a.expires_at<=now() THEN 'expired' ELSE a.state END,
    'approverSubject',a.approver_subject,'revision',a.revision)
$$;

CREATE FUNCTION core.composition_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private,composition_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; who text:=c->>'sub'; iss text:=c->>'iss'; client text:=c->>'client_id';
  perms text[]; writer boolean; publisher boolean; approver boolean;
  v composition_private.composition_versions; ap composition_private.composition_publication_approvals;
  owner composition_private.compositions; app app_private.applications; report jsonb; report_status text;
  cid uuid; ver text; digest text; approval_expiry timestamptz; event_name text; revision_value integer;
BEGIN
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','composition_permission_required');
  END IF;
  SELECT permissions INTO perms FROM app_private.principals
    WHERE tenant_id=tenant AND issuer=iss AND subject=who AND management_client=client AND enabled FOR SHARE;
  IF perms IS NULL THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
  writer:='compositions.write'=ANY(perms);
  publisher:='compositions.publish'=ANY(perms);
  approver:='compositions.approve'=ANY(perms);

  IF operation='register' THEN
    IF NOT writer THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
    IF payload->>'composition' IS NULL OR jsonb_typeof(payload->'composition')<>'object'
      OR coalesce(payload->>'digest','') !~ '^sha256:[0-9a-f]{64}$'
      OR coalesce(payload->'composition'->>'version','') !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_composition');
    END IF;
    IF actor IS NOT NULL THEN
      SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=actor FOR SHARE;
    ELSIF coalesce(payload->>'ownerAppId','') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant
        AND app_id=(payload->>'ownerAppId')::uuid FOR SHARE;
    ELSE
      RETURN jsonb_build_object('status',403,'error','owner_app_binding_required');
    END IF;
    IF NOT FOUND OR app.state<>'active' THEN RETURN jsonb_build_object('status',403,'error','owner_app_not_available'); END IF;
    IF app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
    IF payload ? 'compositionId' THEN
      IF coalesce(payload->>'compositionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_composition');
      END IF;
      SELECT * INTO owner FROM composition_private.compositions WHERE tenant_id=tenant
        AND composition_id=(payload->>'compositionId')::uuid FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      IF owner.owner_app_id<>app.app_id AND NOT publisher THEN
        RETURN jsonb_build_object('status',403,'error','composition_permission_required');
      END IF;
      cid:=owner.composition_id;
    ELSE
      INSERT INTO composition_private.compositions(tenant_id,owner_app_id,created_by)
        VALUES(tenant,app.app_id,who) RETURNING * INTO owner;
      cid:=owner.composition_id;
    END IF;
    ver:=payload->'composition'->>'version'; digest:=payload->>'digest';
    INSERT INTO composition_private.composition_versions(tenant_id,composition_id,owner_app_id,version,composition,digest,created_by,updated_by)
      VALUES(tenant,cid,app.app_id,ver,payload->'composition',digest,who,who) RETURNING * INTO v;
    event_name:='composition.registered';
    RETURN jsonb_build_object('status',201,'value',app_private.composition_version_view(v));
  END IF;

  IF operation IN ('get','update','validate','publish','deprecate','revoke') THEN
    IF coalesce(payload->>'compositionId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(payload->>'version','') !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_composition_reference');
    END IF;
    SELECT * INTO v FROM composition_private.composition_versions WHERE tenant_id=tenant
      AND composition_id=(payload->>'compositionId')::uuid AND version=payload->>'version' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=v.owner_app_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
    IF app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF operation='get' THEN RETURN jsonb_build_object('status',200,'value',app_private.composition_version_view(v)); END IF;
    IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
    IF payload->>'etag'<>('"composition-version-'||v.version_id||'-'||v.revision||'"') THEN
      RETURN jsonb_build_object('status',412,'error','revision_mismatch');
    END IF;
    IF operation='update' THEN
      IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','immutable_version'); END IF;
      IF payload->'composition' IS NULL OR jsonb_typeof(payload->'composition')<>'object'
        OR coalesce(payload->>'digest','') !~ '^sha256:[0-9a-f]{64}$'
        OR payload->'composition'->>'version'<>v.version THEN
        RETURN jsonb_build_object('status',400,'error','invalid_composition');
      END IF;
      UPDATE composition_private.composition_versions SET composition=payload->'composition',digest=payload->>'digest',
        validation_status=NULL,validation_digest=NULL,validation_revision=NULL,validation_report=NULL,validated_at=NULL,
        revision=revision+1,updated_by=who,updated_at=clock_timestamp()
        WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
      event_name:='composition.updated';
    ELSIF operation='validate' THEN
      IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      report_status:=payload->>'validationStatus';
      IF report_status IS NULL OR report_status NOT IN ('valid','invalid','indeterminate')
        OR (payload ? 'validationReport' AND jsonb_typeof(payload->'validationReport')<>'object') THEN
        RETURN jsonb_build_object('status',400,'error','invalid_validation_report');
      END IF;
      report:=coalesce(payload->'validationReport','{}'::jsonb);
      IF report_status='valid' AND (report->>'status'<>'valid' OR report->>'digest'<>v.digest OR report->>'revision'<>v.revision::text) THEN
        report_status:='invalid';
        report:=report||jsonb_build_object('issues',jsonb_build_array(jsonb_build_object(
          'path','/','code','stale_report','message','Validation report does not bind the current draft digest and revision.')));
      END IF;
      UPDATE composition_private.composition_versions SET validation_status=report_status,validation_digest=v.digest,
        validation_revision=v.revision,validation_report=report,validated_at=clock_timestamp(),
        revision=revision+1,updated_by=who,updated_at=clock_timestamp()
        WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
      event_name:='composition.validated';
    ELSIF operation='publish' THEN
      IF NOT publisher THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
      IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      IF app.state<>'active' THEN RETURN jsonb_build_object('status',403,'error','owner_app_not_available'); END IF;
      IF v.validation_status IS DISTINCT FROM 'valid' OR v.validation_digest IS DISTINCT FROM v.digest
        OR v.validation_revision IS DISTINCT FROM v.revision OR v.validated_at IS NULL THEN
        RETURN jsonb_build_object('status',409,'error','validation_required');
      END IF;
      IF coalesce(payload->>'approvalId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_approval');
      END IF;
      SELECT * INTO ap FROM composition_private.composition_publication_approvals
        WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid AND version_id=v.version_id FOR UPDATE;
      IF NOT FOUND OR ap.state<>'approved' OR ap.decision<>'approve' OR ap.approver_subject=who
        OR ap.expires_at<=clock_timestamp() OR ap.composition_digest<>v.digest
        OR ap.version_revision<>v.revision-1 THEN
        RETURN jsonb_build_object('status',409,'error','approval_stale');
      END IF;
      UPDATE composition_private.composition_publication_approvals SET state='consumed',revision=revision+1
        WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
      PERFORM app_private.audit_append('approval.consumed','approval',ap.approval_id,ap.revision,'success','approval_consumed',NULL);
      UPDATE composition_private.composition_versions SET state='published',revision=revision+1,updated_by=who,
        updated_at=clock_timestamp(),published_at=clock_timestamp()
        WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
      event_name:='composition.published';
    ELSIF operation='deprecate' THEN
      IF v.state<>'published' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      UPDATE composition_private.composition_versions SET state='deprecated',revision=revision+1,updated_by=who,
        updated_at=clock_timestamp(),deprecated_at=clock_timestamp(),reason=nullif(payload->>'reason','')
        WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
      event_name:='composition.deprecated';
    ELSIF operation='revoke' THEN
      IF v.state='revoked' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      UPDATE composition_private.composition_versions SET state='revoked',revision=revision+1,updated_by=who,
        updated_at=clock_timestamp(),revoked_at=clock_timestamp(),reason=nullif(payload->>'reason','')
        WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
      event_name:='composition.revoked';
    END IF;
    PERFORM app_private.audit_append(event_name,'composition',v.version_id,v.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',200,'value',app_private.composition_version_view(v));
  END IF;

  IF operation='approval_create' THEN
    IF NOT approver THEN RETURN jsonb_build_object('status',403,'error','composition_approval_required'); END IF;
    IF coalesce(payload->'decision'->>'resourceId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      OR coalesce(payload->'decision'->>'resourceDigest','') !~ '^sha256:[0-9a-f]{64}$'
      OR coalesce(payload->'decision'->>'approvalId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_composition_approval');
    END IF;
    SELECT * INTO v FROM composition_private.composition_versions WHERE tenant_id=tenant
      AND composition_id=(payload->'decision'->>'resourceId')::uuid
      AND digest=payload->'decision'->>'resourceDigest' AND state='draft' FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    approval_expiry:=(payload->'decision'->>'expiresAt')::timestamptz;
    IF approval_expiry IS NULL OR approval_expiry<=clock_timestamp() OR approval_expiry>clock_timestamp()+interval '10 minutes' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_approval_expiry');
    END IF;
    IF (payload->'decision'->>'requesterSubject') IS DISTINCT FROM v.created_by
      OR (payload->'decision'->>'resourceRevision')::integer IS DISTINCT FROM v.revision
      OR (payload->'decision'->>'decision') NOT IN ('approve','deny') THEN
      RETURN jsonb_build_object('status',409,'error','approval_stale');
    END IF;
    INSERT INTO composition_private.composition_publication_approvals(tenant_id,approval_id,version_id,composition_id,
      composition_digest,version_revision,requester_subject,requester_app_id,decision,approver_subject,management_client,
      expires_at,state)
      VALUES(tenant,(payload->'decision'->>'approvalId')::uuid,v.version_id,v.composition_id,v.digest,v.revision,
        v.created_by,v.owner_app_id,payload->'decision'->>'decision',who,client,approval_expiry,
        CASE WHEN payload->'decision'->>'decision'='approve' THEN 'approved' ELSE 'denied' END) RETURNING * INTO ap;
    PERFORM app_private.audit_append('approval.decided','approval',ap.approval_id,ap.revision,'success',ap.decision,NULL);
    RETURN jsonb_build_object('status',201,'value',app_private.composition_approval_view(ap));
  END IF;

  IF operation IN ('approval_get','approval_revoke') THEN
    IF coalesce(payload->>'approvalId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_approval');
    END IF;
    SELECT * INTO ap FROM composition_private.composition_publication_approvals WHERE tenant_id=tenant
      AND approval_id=(payload->>'approvalId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF operation='approval_get' THEN
      IF ap.approver_subject<>who AND ap.requester_subject<>who AND NOT publisher THEN
        RETURN jsonb_build_object('status',404,'error','not_found');
      END IF;
      RETURN jsonb_build_object('status',200,'value',app_private.composition_approval_view(ap));
    END IF;
    IF NOT approver OR ap.approver_subject<>who THEN RETURN jsonb_build_object('status',403,'error','approval_forbidden'); END IF;
    IF payload->>'etag'<>('"approval-'||ap.approval_id||'-'||ap.revision||'"') THEN
      RETURN jsonb_build_object('status',412,'error','revision_mismatch');
    END IF;
    UPDATE composition_private.composition_publication_approvals SET state='revoked',revision=revision+1
      WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
    PERFORM app_private.audit_append('approval.revoked','approval',ap.approval_id,ap.revision,'success','approval_revoked',NULL);
    RETURN jsonb_build_object('status',200,'value',app_private.composition_approval_view(ap));
  END IF;

  RETURN jsonb_build_object('status',400,'error','invalid_operation');
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('status',400,'error','invalid_composition_request');
END $$;

-- Execution authority. One row owns the whole bounded plan; one row per step
-- owns its exact capability, provider, grant and output. Flowable remains the
-- only scheduler; this table is correlation and authorization state only.
CREATE TABLE composition_private.executions (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  execution_id uuid NOT NULL DEFAULT gen_random_uuid(),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 2048),
  initiating_subject text NOT NULL CHECK (length(initiating_subject) BETWEEN 1 AND 255),
  initiating_client text NOT NULL CHECK (length(initiating_client) BETWEEN 1 AND 255),
  consumer_app_id uuid NOT NULL,
  composition_id uuid NOT NULL,
  version_id uuid NOT NULL,
  composition_digest text NOT NULL CHECK (composition_digest ~ '^sha256:[0-9a-f]{64}$'),
  input jsonb NOT NULL,
  input_digest text NOT NULL CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^sha256:[0-9a-f]{64}$'),
  idempotency_key uuid NOT NULL,
  deadline_at timestamptz NOT NULL,
  authority_expires_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'accepted' CHECK (state IN
    ('accepted','running','auth_required','succeeded','failed','cancelled','timed_out','outcome_unknown')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  step_count integer NOT NULL CHECK (step_count BETWEEN 1 AND 16),
  current_step integer NOT NULL DEFAULT 0 CHECK (current_step BETWEEN 0 AND 16),
  engine_definition_id text CHECK (length(engine_definition_id) BETWEEN 1 AND 128),
  engine_process_id text UNIQUE CHECK (length(engine_process_id) BETWEEN 1 AND 128),
  engine_business_key text NOT NULL UNIQUE,
  engine_start_attempted_at timestamptz,
  output jsonb,
  error_code text CHECK (error_code ~ '^[a-z][a-z0-9_]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  result_expires_at timestamptz NOT NULL,
  PRIMARY KEY (tenant_id,execution_id),
  UNIQUE (execution_id),
  UNIQUE (tenant_id,issuer,initiating_subject,initiating_client,consumer_app_id,idempotency_key),
  FOREIGN KEY (tenant_id,consumer_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,version_id) REFERENCES composition_private.composition_versions(tenant_id,version_id),
  CHECK (deadline_at<=authority_expires_at),
  CHECK (result_expires_at>=created_at+interval '24 hours'),
  CHECK (state<>'succeeded' OR (output IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE TABLE composition_private.execution_steps (
  tenant_id text NOT NULL,
  execution_id uuid NOT NULL,
  step_index integer NOT NULL CHECK (step_index BETWEEN 0 AND 15),
  step_id text NOT NULL CHECK (step_id ~ '^[a-z][a-z0-9-]{0,31}$'),
  capability_id text NOT NULL,
  version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
  provider_app_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  provider_origin text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','running','succeeded','failed','outcome_unknown')),
  input jsonb,
  output jsonb,
  error_code text,
  attempt integer NOT NULL DEFAULT 0 CHECK (attempt BETWEEN 0 AND 1),
  operation_id uuid NOT NULL DEFAULT gen_random_uuid(),
  ticket_hash text UNIQUE CHECK (ticket_hash ~ '^sha256:[0-9a-f]{64}$'),
  ticket_expires_at timestamptz,
  ticket_consumed_at timestamptz,
  job_id text,
  started_at timestamptz,
  finished_at timestamptz,
  PRIMARY KEY (tenant_id,execution_id,step_index),
  FOREIGN KEY (tenant_id,execution_id) REFERENCES composition_private.executions(tenant_id,execution_id),
  FOREIGN KEY (tenant_id,provider_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY (tenant_id,grant_id) REFERENCES trust_private.grants(tenant_id,grant_id),
  CHECK ((ticket_hash IS NULL)=(ticket_expires_at IS NULL))
);

DO $rls2$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['executions','execution_steps'] LOOP
    EXECUTE format('ALTER TABLE composition_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE composition_private.%I FORCE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE POLICY tenant_isolation ON composition_private.%I TO junctura_app_owner
      USING (tenant_id=current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')
      WITH CHECK (tenant_id=current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')',t);
  END LOOP;
END $rls2$;

CREATE FUNCTION composition_private.view(e composition_private.executions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('executionId',e.execution_id,'tenantId',e.tenant_id,
    'target',jsonb_build_object('kind','composition','compositionId',e.composition_id,
      'compositionDigest',e.composition_digest),
    'state',e.state,'revision',e.revision,'currentStep',e.current_step,'stepCount',e.step_count,
    'createdAt',to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deadlineAt',to_char(e.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
    || CASE WHEN e.state='succeeded' THEN jsonb_build_object('output',e.output) ELSE '{}'::jsonb END
    || CASE WHEN e.error_code IS NOT NULL THEN jsonb_build_object('error',e.error_code) ELSE '{}'::jsonb END
$$;

-- Shared resolver for a draft or published composition. Every step is resolved
-- through the existing C4A per-capability authority, so the plan can never
-- grant more than the caller already holds.
CREATE FUNCTION composition_private.resolve_steps(composition jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,execution_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  step jsonb; decision jsonb; actor uuid:=core.resource_actor();
  items jsonb:='[]'::jsonb; step_index integer:=0; authority timestamptz; first boolean:=true;
  seen text[]:='{}'; expected_source text;
BEGIN
  IF actor IS NULL OR c->'trust_writer' IS DISTINCT FROM 'true'::jsonb THEN
    RETURN jsonb_build_object('status',403,'error','consumer_binding_required');
  END IF;
  IF jsonb_typeof(composition) IS DISTINCT FROM 'object'
    OR jsonb_typeof(composition->'steps') IS DISTINCT FROM 'array'
    OR jsonb_array_length(composition->'steps') NOT BETWEEN 1 AND 16 THEN
    RETURN jsonb_build_object('status',422,'error','invalid_composition');
  END IF;
  FOR step IN SELECT value FROM jsonb_array_elements(composition->'steps') LOOP
    IF jsonb_typeof(step) IS DISTINCT FROM 'object' OR coalesce(step->>'stepId','') !~ '^[a-z][a-z0-9-]{0,31}$'
      OR step->>'stepId'=ANY(seen) THEN
      RETURN jsonb_build_object('status',422,'error','invalid_composition');
    END IF;
    seen:=seen||(step->>'stepId');
    expected_source:=CASE WHEN step_index=0 THEN 'composition-input' ELSE 'step-output' END;
    IF jsonb_typeof(step->'input') IS DISTINCT FROM 'object' OR step->'input'->>'source'<>expected_source
      OR (step_index>0 AND step->'input'->>'stepId'<>seen[step_index]) THEN
      RETURN jsonb_build_object('status',422,'error','invalid_composition_binding');
    END IF;
    decision:=execution_private.resolve_reference(step->'capability');
    IF decision->>'status'<>'200' THEN RETURN decision; END IF;
    IF first THEN authority:=(decision->'value'->>'authorityExpiresAt')::timestamptz; first:=false;
    ELSE authority:=least(authority,(decision->'value'->>'authorityExpiresAt')::timestamptz); END IF;
    items:=items||jsonb_build_array(jsonb_build_object('stepId',step->>'stepId','stepIndex',step_index,
      'capability',step->'capability','providerOrigin',decision->'value'->>'providerOrigin',
      'providerAppId',decision->'value'->>'providerAppId','grantId',decision->'value'->>'grantId',
      'authorityExpiresAt',decision->'value'->>'authorityExpiresAt',
      'inputSchema',decision->'value'->'manifest'->'inputSchema',
      'outputSchema',decision->'value'->'manifest'->'outputSchema',
      'timeoutMs',decision->'value'->'manifest'->'timeoutMs',
      'invocationPath',decision->'value'->'manifest'->'invocation'->>'path'));
    step_index:=step_index+1;
  END LOOP;
  IF (SELECT coalesce(sum((s->>'timeoutMs')::integer + 300),0) FROM jsonb_array_elements(items) s)
    > (composition->>'deadlineMs')::integer THEN
    RETURN jsonb_build_object('status',422,'error','composition_deadline_exceeded');
  END IF;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object('steps',items,'stepCount',step_index,
    'consumerAppId',actor,'authorityExpiresAt',authority));
EXCEPTION WHEN others THEN RAISE;
END $$;

-- Return pinned schemas for structural validation and C3 compatibility. This
-- reads registry metadata only; it never creates invocation authority.
CREATE FUNCTION composition_private.resolve_schemas(composition jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  step jsonb; v app_private.capability_versions; items jsonb:='[]'::jsonb; index integer:=0;
BEGIN
  IF jsonb_typeof(composition->'steps') IS DISTINCT FROM 'array'
    OR jsonb_array_length(composition->'steps') NOT BETWEEN 1 AND 16 THEN
    RETURN jsonb_build_object('status',422,'error','invalid_composition');
  END IF;
  FOR step IN SELECT value FROM jsonb_array_elements(composition->'steps') LOOP
    IF coalesce(step->'capability'->>'capabilityId','') !~ '^urn:junctura:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'
      OR coalesce(step->'capability'->>'version','') !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
      OR coalesce(step->'capability'->>'manifestDigest','') !~ '^sha256:[0-9a-f]{64}$' THEN
      RETURN jsonb_build_object('status',422,'error','invalid_capability_reference');
    END IF;
    SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=c->>'tenant_id'
      AND capability_id=step->'capability'->>'capabilityId' AND version=step->'capability'->>'version'
      AND digest=step->'capability'->>'manifestDigest' AND state='published';
    IF NOT FOUND THEN RETURN jsonb_build_object('status',422,'error','step_capability_unavailable'); END IF;
    items:=items||jsonb_build_array(jsonb_build_object('stepIndex',index,'stepId',step->>'stepId',
      'inputSchema',v.manifest->'inputSchema','outputSchema',v.manifest->'outputSchema',
      'timeoutMs',v.manifest->'timeoutMs'));
    index:=index+1;
  END LOOP;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object('steps',items));
END $$;

-- Resolve a published exact version into an executable plan.
CREATE FUNCTION composition_private.resolve_plan(reference jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,composition_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  v composition_private.composition_versions; resolved jsonb;
BEGIN
  IF jsonb_typeof(reference) IS DISTINCT FROM 'object'
    OR (SELECT count(*) FROM jsonb_object_keys(reference) k WHERE k IN ('compositionId','version','compositionDigest'))<>3 THEN
    RETURN jsonb_build_object('status',400,'error','invalid_composition_reference');
  END IF;
  SELECT * INTO v FROM composition_private.composition_versions WHERE tenant_id=c->>'tenant_id'
    AND composition_id=(reference->>'compositionId')::uuid AND version=reference->>'version'
    AND digest=reference->>'compositionDigest' AND state='published';
  IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
  resolved:=composition_private.resolve_steps(v.composition);
  IF resolved->>'status'<>'200' THEN RETURN resolved; END IF;
  RETURN jsonb_build_object('status',200,'value',(resolved->'value')||jsonb_build_object('composition',v.composition,
    'versionId',v.version_id,'ownerAppId',v.owner_app_id));
END $$;

-- Resolve an unpublished draft for validation. Same per-step authority, no
-- publication or execution right is created.
CREATE FUNCTION composition_private.resolve_draft(composition jsonb) RETURNS jsonb
LANGUAGE sql SET search_path=pg_catalog,composition_private AS $$
  SELECT composition_private.resolve_steps(composition)
$$;
CREATE FUNCTION composition_private.live(e composition_private.executions) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE original text:=current_setting('request.jwt.claims',true); decision jsonb;
BEGIN
  PERFORM set_config('request.jwt.claims',jsonb_build_object('tenant_id',e.tenant_id,'iss',e.issuer,
    'sub',e.initiating_subject,'client_id',e.initiating_client,'trust_writer',true)::text,true);
  decision:=composition_private.resolve_plan(jsonb_build_object('compositionId',e.composition_id,
    'version',(SELECT version FROM composition_private.composition_versions WHERE tenant_id=e.tenant_id AND version_id=e.version_id),
    'compositionDigest',e.composition_digest));
  PERFORM set_config('request.jwt.claims',original,true);
  RETURN decision->>'status'='200' AND (decision->'value'->>'consumerAppId')=e.consumer_app_id::text
    AND e.authority_expires_at>clock_timestamp();
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims',original,true);
  RAISE;
END $$;

CREATE FUNCTION composition_private.lease_valid(e composition_private.executions) RETURNS boolean
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

CREATE FUNCTION core.composition_execution_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,composition_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; actor uuid:=core.resource_actor(); e composition_private.executions;
  st composition_private.execution_steps; resolved jsonb; stamp timestamptz:=clock_timestamp();
  deadline timestamptz; next_state text; event_name text; step_json jsonb;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR coalesce(c->>'iss','')=''
    OR coalesce(c->>'sub','')='' OR coalesce(c->>'client_id','')='' OR actor IS NULL THEN
    RETURN jsonb_build_object('status',403,'error','verified_principal_required');
  END IF;
  IF operation='resolve' THEN RETURN composition_private.resolve_plan(payload); END IF;
  IF operation='schemas' THEN RETURN composition_private.resolve_schemas(payload->'composition'); END IF;
  IF operation='reserve' THEN
    resolved:=composition_private.resolve_plan(payload->'target');
    IF resolved->>'status'<>'200' THEN RETURN resolved; END IF;
    IF coalesce(payload->>'inputDigest','') !~ '^sha256:[0-9a-f]{64}$'
      OR coalesce(payload->>'requestDigest','') !~ '^sha256:[0-9a-f]{64}$' OR NOT payload ? 'input' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_execution_request');
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(tenant||'|'||(c->>'iss')||'|'||(c->>'sub')||'|'||actor::text||'|'||(payload->>'idempotencyKey'),0));
    SELECT * INTO e FROM composition_private.executions WHERE tenant_id=tenant AND issuer=c->>'iss'
      AND initiating_subject=c->>'sub' AND initiating_client=c->>'client_id' AND consumer_app_id=actor
      AND idempotency_key=(payload->>'idempotencyKey')::uuid FOR UPDATE;
    IF FOUND THEN
      IF e.request_digest<>payload->>'requestDigest' OR e.input_digest<>payload->>'inputDigest'
        OR e.composition_id IS DISTINCT FROM (resolved->'value'->>'versionId')::uuid
        OR e.composition_digest<>payload->'target'->>'compositionDigest'
        OR e.composition_id IS DISTINCT FROM (payload->'target'->>'compositionId')::uuid THEN
        RETURN jsonb_build_object('status',409,'error','idempotency_conflict');
      END IF;
      IF NOT composition_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
      IF e.result_expires_at<=stamp THEN RETURN jsonb_build_object('status',409,'error','result_expired'); END IF;
      RETURN jsonb_build_object('status',200,'value',composition_private.view(e));
    END IF;
    deadline:=least(stamp+((resolved->'value'->'composition'->>'deadlineMs')::integer)*interval '1 millisecond',
      (resolved->'value'->>'authorityExpiresAt')::timestamptz);
    IF deadline IS NULL OR deadline<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','execution_deadline_expired'); END IF;
    INSERT INTO composition_private.executions(tenant_id,execution_id,issuer,initiating_subject,initiating_client,
      consumer_app_id,composition_id,version_id,composition_digest,input,input_digest,request_digest,idempotency_key,
      deadline_at,authority_expires_at,step_count,engine_business_key,result_expires_at)
      VALUES(tenant,(payload->>'executionId')::uuid,c->>'iss',c->>'sub',c->>'client_id',actor,
        (payload->'target'->>'compositionId')::uuid,(resolved->'value'->>'versionId')::uuid,
        payload->'target'->>'compositionDigest',payload->'input',payload->>'inputDigest',payload->>'requestDigest',
        (payload->>'idempotencyKey')::uuid,deadline,(resolved->'value'->>'authorityExpiresAt')::timestamptz,
        (resolved->'value'->>'stepCount')::integer,'c4b:'||tenant||':'||(payload->>'executionId'),
        stamp+interval '24 hours') RETURNING * INTO e;
    FOR step_json IN SELECT value FROM jsonb_array_elements(resolved->'value'->'steps') LOOP
      INSERT INTO composition_private.execution_steps(tenant_id,execution_id,step_index,step_id,capability_id,version,
        manifest_digest,provider_app_id,grant_id,provider_origin,operation_id)
        VALUES(tenant,e.execution_id,(step_json->>'stepIndex')::integer,step_json->>'stepId',
          step_json->'capability'->>'capabilityId',step_json->'capability'->>'version',
          step_json->'capability'->>'manifestDigest',(step_json->>'providerAppId')::uuid,
          (step_json->>'grantId')::uuid,step_json->>'providerOrigin');
    END LOOP;
    PERFORM app_private.audit_append('execution.accepted','execution',e.execution_id,e.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',202,'value',composition_private.view(e));
  END IF;

  SELECT * INTO e FROM composition_private.executions WHERE tenant_id=tenant
    AND execution_id=(payload->>'executionId')::uuid FOR UPDATE;
  IF NOT FOUND THEN
    IF operation IN ('ticket_context','redeem') THEN RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false)); END IF;
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;

  IF operation IN ('ticket_context','redeem') THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND ticket_hash=payload->>'ticketHash' FOR UPDATE;
    IF NOT FOUND OR actor<>st.provider_app_id OR e.issuer<>c->>'iss'
      OR st.ticket_hash IS DISTINCT FROM payload->>'ticketHash' OR e.input_digest IS DISTINCT FROM payload->>'inputDigest'
      OR st.ticket_consumed_at IS NOT NULL OR st.ticket_expires_at IS NULL OR st.ticket_expires_at<=clock_timestamp()
      OR e.deadline_at<=clock_timestamp() OR e.state<>'running' OR st.state<>'running' OR e.current_step<>st.step_index THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false));
    END IF;
    IF operation='ticket_context' THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',true,'executionId',e.execution_id,
        'tenantId',e.tenant_id,'issuer',e.issuer,'subject',e.initiating_subject,'clientId',e.initiating_client,
        'target',jsonb_build_object('kind','composition','compositionId',e.composition_id,'compositionDigest',e.composition_digest),
        'stepId',st.step_id,'capability',jsonb_build_object('capabilityId',st.capability_id,'version',st.version,
          'manifestDigest',st.manifest_digest),'stepIndex',st.step_index));
    END IF;
    IF NOT composition_private.lease_valid(e) OR NOT composition_private.live(e) THEN
      RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',false));
    END IF;
    UPDATE composition_private.execution_steps SET ticket_consumed_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index RETURNING * INTO st;
    PERFORM app_private.audit_append('authorization.redeemed','authorization',e.execution_id,e.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('active',true,
      'expiresAt',to_char(st.ticket_expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'context',jsonb_build_object('tenantId',e.tenant_id,'issuer',e.issuer,'subject',e.initiating_subject,
        'principalType','service','initiatingSubject',e.initiating_subject,'initiatingAppId',e.consumer_app_id,
        'executorSubject','junctura-core:c4b','stepId',st.step_id,'grantIds',jsonb_build_array(st.grant_id),
        'approvalIds','[]'::jsonb,'permissions',(SELECT manifest->'requiredPermissions' FROM app_private.capability_versions
          WHERE tenant_id=e.tenant_id AND capability_id=st.capability_id AND version=st.version AND digest=st.manifest_digest),
        'actorAppId',e.consumer_app_id,'providerAppId',st.provider_app_id,'executionId',e.execution_id,
        'invocationId',e.execution_id,'compositionId',e.composition_id,
        'capability',jsonb_build_object('capabilityId',st.capability_id,'version',st.version,'manifestDigest',st.manifest_digest),
        'inputDigest',e.input_digest,'attempt',st.attempt,'operationId',st.operation_id,
        'deadlineAt',to_char(e.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  END IF;

  IF actor<>e.consumer_app_id OR e.issuer<>c->>'iss' OR e.initiating_subject<>c->>'sub' OR e.initiating_client<>c->>'client_id' THEN
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;
  IF operation='get' THEN
    IF c->'trust_writer' IS DISTINCT FROM 'true'::jsonb OR NOT composition_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
    IF e.result_expires_at<=stamp THEN RETURN jsonb_build_object('status',409,'error','result_expired'); END IF;
    RETURN jsonb_build_object('status',200,'value',composition_private.view(e));
  END IF;
  IF operation='internal_get' THEN
    IF c->'trust_writer' IS DISTINCT FROM 'true'::jsonb OR NOT composition_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
    RETURN jsonb_build_object('status',200,'value',to_jsonb(e));
  END IF;
  IF operation IN ('reauthorize','engine_reserve','engine_bind','prepare','dispatch','step_output','step_fail') THEN
    IF e.deadline_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','execution_deadline_expired'); END IF;
    IF NOT composition_private.lease_valid(e) THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    IF NOT composition_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
  END IF;
  IF operation='reauthorize' THEN
    IF e.state<>'auth_required' THEN RETURN jsonb_build_object('status',409,'error','dispatch_not_available'); END IF;
    UPDATE composition_private.executions SET state='accepted',error_code=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.reauthorized';
  ELSIF operation='engine_reserve' THEN
    IF e.engine_start_attempted_at IS NOT NULL OR e.state<>'accepted' THEN RETURN jsonb_build_object('status',409,'error','execution_pending_reconciliation'); END IF;
    UPDATE composition_private.executions SET engine_definition_id=payload->>'definitionId',
      engine_start_attempted_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.engine_reserved';
  ELSIF operation='engine_bind' THEN
    IF e.engine_start_attempted_at IS NULL OR e.engine_definition_id IS DISTINCT FROM payload->>'definitionId'
      OR (e.engine_process_id IS NOT NULL AND e.engine_process_id IS DISTINCT FROM payload->>'processId') THEN
      RETURN jsonb_build_object('status',409,'error','execution_pending_reconciliation');
    END IF;
    UPDATE composition_private.executions SET engine_process_id=payload->>'processId',revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.engine_bound';
  ELSIF operation='prepare' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND OR e.state NOT IN ('accepted','running') OR e.current_step<>st.step_index OR st.state<>'pending' OR st.attempt<>0
      OR e.engine_process_id IS DISTINCT FROM payload->>'processId' OR e.engine_definition_id IS DISTINCT FROM payload->>'definitionId'
      OR st.capability_id IS DISTINCT FROM payload->'capability'->>'capabilityId'
      OR st.version IS DISTINCT FROM payload->'capability'->>'version'
      OR st.manifest_digest IS DISTINCT FROM payload->'capability'->>'manifestDigest' THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    st.input:=CASE WHEN st.step_index=0 THEN e.input ELSE
      (SELECT output FROM composition_private.execution_steps WHERE tenant_id=tenant AND execution_id=e.execution_id
        AND step_index=st.step_index-1) END;
    IF st.input IS NULL THEN RETURN jsonb_build_object('status',409,'error','step_input_unavailable'); END IF;
    IF jsonb_typeof(st.input)='null' AND st.step_index=0 AND e.input IS NULL THEN RETURN jsonb_build_object('status',409,'error','step_input_unavailable'); END IF;
    UPDATE composition_private.execution_steps SET attempt=1,state='running',job_id=payload->>'jobId',
      ticket_hash=payload->>'ticketHash',
      ticket_expires_at=least((payload->>'ticketExpiresAt')::timestamptz,e.deadline_at,e.authority_expires_at,
        (c->'c4a_lease'->>'expiresAt')::timestamptz,clock_timestamp()+interval '30 seconds'),
      started_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id
      AND step_index=st.step_index RETURNING * INTO st;
    IF st.ticket_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    UPDATE composition_private.executions SET state='running',current_step=st.step_index,revision=revision+1,
      updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='invocation.prepared';
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('stepIndex',st.step_index,'stepId',st.step_id,
      'input',st.input,'capability',jsonb_build_object('capabilityId',st.capability_id,'version',st.version,
        'manifestDigest',st.manifest_digest),'providerOrigin',st.provider_origin));
  ELSIF operation='dispatch' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND OR e.state<>'running' OR e.current_step IS DISTINCT FROM st.step_index
      OR st.state<>'running' OR st.ticket_hash IS NULL THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    UPDATE composition_private.execution_steps SET state='running' WHERE tenant_id=tenant AND execution_id=e.execution_id
      AND step_index=(payload->>'stepIndex')::integer;
    event_name:='invocation.dispatched';
  ELSIF operation='step_output' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND OR st.state<>'running' OR st.ticket_consumed_at IS NULL OR e.current_step<>st.step_index THEN
      RETURN jsonb_build_object('status',409,'error','provider_authorization_required');
    END IF;
    UPDATE composition_private.execution_steps SET state='succeeded',output=payload->'output',finished_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index RETURNING * INTO st;
    IF st.step_index=e.step_count-1 THEN
      UPDATE composition_private.executions SET state='succeeded',output=payload->'output',revision=revision+1,
        current_step=st.step_index+1,finished_at=clock_timestamp(),updated_at=clock_timestamp()
        WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
      event_name:='execution.completed';
    ELSE
      UPDATE composition_private.executions SET current_step=st.step_index+1,revision=revision+1,updated_at=clock_timestamp()
        WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
      event_name:='execution.step_completed';
    END IF;
  ELSIF operation='step_fail' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    next_state:=payload->>'state';
    IF next_state NOT IN ('failed','outcome_unknown','auth_required','timed_out') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    IF e.state NOT IN ('accepted','running','auth_required') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    IF e.current_step>st.step_index THEN next_state:='outcome_unknown'; END IF;
    IF next_state='auth_required' AND st.ticket_consumed_at IS NULL THEN
      UPDATE composition_private.execution_steps SET state='pending',attempt=0,ticket_hash=NULL,ticket_expires_at=NULL,
        job_id=NULL,started_at=NULL,error_code='lease_lost'
        WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index RETURNING * INTO st;
      UPDATE composition_private.executions SET state='auth_required',error_code='lease_lost',revision=revision+1,
        updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    ELSE
      UPDATE composition_private.execution_steps SET state=CASE WHEN next_state='outcome_unknown' THEN 'outcome_unknown' ELSE 'failed' END,
        error_code=coalesce(payload->>'error','execution_failed'),finished_at=clock_timestamp()
        WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index RETURNING * INTO st;
      UPDATE composition_private.executions SET state=CASE WHEN next_state='outcome_unknown' THEN 'outcome_unknown'
        WHEN next_state='timed_out' THEN 'timed_out' ELSE 'failed' END,
        error_code=coalesce(payload->>'error','execution_failed'),revision=revision+1,finished_at=clock_timestamp(),
        updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    END IF;
    event_name:='execution.'||CASE WHEN e.state='succeeded' THEN 'completed' ELSE e.state END;
  ELSE
    RETURN jsonb_build_object('status',400,'error','invalid_operation');
  END IF;
  PERFORM app_private.audit_append(event_name,CASE WHEN event_name LIKE 'invocation.%' THEN 'invocation' ELSE 'execution' END,
    e.execution_id,e.revision,CASE WHEN e.state='outcome_unknown' THEN 'unknown' WHEN e.state IN ('failed','timed_out','auth_required') THEN 'failed' ELSE 'success' END,
    e.error_code,NULL);
  RETURN jsonb_build_object('status',200,'value',composition_private.view(e));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
  RETURN jsonb_build_object('status',400,'error','invalid_execution_request');
END $$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA composition_private FROM PUBLIC;
REVOKE ALL ON FUNCTION core.composition_command(text,jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.composition_execution_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.composition_command(text,jsonb) TO junctura_composition_api;
GRANT EXECUTE ON FUNCTION core.composition_execution_command(text,jsonb) TO junctura_composition_api;

RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM junctura_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(12);
NOTIFY pgrst,'reload schema';
COMMIT;
