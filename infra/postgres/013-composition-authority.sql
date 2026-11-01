-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Correct C4B authority and preserve immutable migration 012 and existing evidence.
BEGIN;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;
ALTER TABLE composition_private.execution_steps
  ADD COLUMN input_digest text CHECK (input_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN output_digest text CHECK (output_digest ~ '^sha256:[0-9a-f]{64}$'),
  ADD COLUMN dispatch_started_at timestamptz;
CREATE OR REPLACE FUNCTION app_private.composition_version_view(v composition_private.composition_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'versionId',v.version_id,'compositionId',v.composition_id,'ownerAppId',v.owner_app_id,'composition',v.composition,
    'version',v.version,'state',v.state,'revision',v.revision,'digest',v.digest,
    'validation',CASE WHEN v.validation_status IS NULL THEN NULL ELSE jsonb_build_object(
      'status',v.validation_status,'digest',v.validation_digest,'revision',v.validation_revision,
      'report',v.validation_report,'validatedAt',v.validated_at) END,
    'createdBy',v.created_by,'updatedBy',v.updated_by,'createdAt',v.created_at,'updatedAt',v.updated_at,
    'publishedAt',v.published_at,'deprecatedAt',v.deprecated_at,'revokedAt',v.revoked_at)
$$;


CREATE OR REPLACE FUNCTION core.composition_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private,composition_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; who text:=c->>'sub'; iss text:=c->>'iss'; client text:=c->>'client_id';
  actor uuid:=core.resource_actor();
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

  IF operation='schemas' THEN
    IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
    RETURN composition_private.resolve_schemas(payload->'composition');
  END IF;
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
    IF actor IS NULL AND app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','composition_permission_required'); END IF;
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
      app.app_id:=owner.owner_app_id;
      cid:=owner.composition_id;
    ELSE
      INSERT INTO composition_private.compositions(tenant_id,owner_app_id,created_by)
        VALUES(tenant,app.app_id,who) RETURNING * INTO owner;
      app.app_id:=owner.owner_app_id;
      cid:=owner.composition_id;
    END IF;
    ver:=payload->'composition'->>'version'; digest:=payload->>'digest';
    INSERT INTO composition_private.composition_versions(tenant_id,composition_id,owner_app_id,version,composition,digest,created_by,updated_by)
      VALUES(tenant,cid,app.app_id,ver,payload->'composition',digest,who,who) RETURNING * INTO v;
    PERFORM app_private.audit_append('composition.registered','composition',v.version_id,v.revision,'success',NULL,NULL);
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
    IF actor IS NULL AND app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
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
        validation_revision=v.revision+1,validation_report=report,validated_at=clock_timestamp(),
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
        OR ap.version_revision<>v.revision THEN
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
      OR coalesce(payload->>'approvalId','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
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
    SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=v.owner_app_id FOR SHARE;
    IF who=v.created_by OR who=app.owner_subject THEN RETURN jsonb_build_object('status',403,'error','independent_approval_required'); END IF;
    IF payload->'decision'->>'requesterAppId' IS DISTINCT FROM v.owner_app_id::text THEN RETURN jsonb_build_object('status',409,'error','approval_stale'); END IF;
    INSERT INTO composition_private.composition_publication_approvals(tenant_id,approval_id,version_id,composition_id,
      composition_digest,version_revision,requester_subject,requester_app_id,decision,approver_subject,management_client,
      expires_at,state)
      VALUES(tenant,(payload->>'approvalId')::uuid,v.version_id,v.composition_id,v.digest,v.revision,
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
    IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
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
CREATE OR REPLACE FUNCTION core.composition_execution_command(operation text, payload jsonb) RETURNS jsonb
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
        OR e.version_id IS DISTINCT FROM (resolved->'value'->>'versionId')::uuid
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
        manifest_digest,provider_app_id,grant_id,provider_origin)
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
      OR st.ticket_hash IS DISTINCT FROM payload->>'ticketHash' OR st.input_digest IS DISTINCT FROM payload->>'inputDigest'
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
        'executorSubject','rosetta-core:c4b','stepId',st.step_id,'grantIds',jsonb_build_array(st.grant_id),
        'approvalIds','[]'::jsonb,'permissions',(SELECT manifest->'requiredPermissions' FROM app_private.capability_versions
          WHERE tenant_id=e.tenant_id AND capability_id=st.capability_id AND version=st.version AND digest=st.manifest_digest),
        'actorAppId',e.consumer_app_id,'providerAppId',st.provider_app_id,'executionId',e.execution_id,
        'invocationId',e.execution_id,'compositionId',e.composition_id,
        'capability',jsonb_build_object('capabilityId',st.capability_id,'version',st.version,'manifestDigest',st.manifest_digest),
        'inputDigest',st.input_digest,'attempt',st.attempt,'operationId',st.operation_id,
        'deadlineAt',to_char(e.deadline_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))));
  END IF;

  IF actor<>e.consumer_app_id OR e.issuer<>c->>'iss' OR e.initiating_subject<>c->>'sub' OR e.initiating_client<>c->>'client_id' THEN
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;
  IF operation='observe' THEN
    IF e.state IN ('accepted','running','auth_required') THEN
      IF EXISTS(SELECT FROM composition_private.execution_steps WHERE tenant_id=tenant AND execution_id=e.execution_id
        AND dispatch_started_at IS NOT NULL AND state='running') AND (payload->'leasePresent' IS DISTINCT FROM 'true'::jsonb OR e.deadline_at<=stamp) THEN
        next_state:='outcome_unknown';
      ELSIF e.deadline_at<=stamp THEN next_state:='timed_out';
      ELSIF payload->'leasePresent' IS DISTINCT FROM 'true'::jsonb THEN next_state:='auth_required';
      ELSIF NOT composition_private.live(e) THEN next_state:='failed';
      END IF;
      IF next_state IS NOT NULL AND next_state IS DISTINCT FROM e.state THEN
        UPDATE composition_private.executions SET state=next_state,error_code=CASE WHEN next_state='auth_required' THEN 'lease_lost'
          WHEN next_state='failed' THEN 'invoke_not_authorized' WHEN next_state='outcome_unknown' THEN 'provider_outcome_unknown' ELSE 'execution_deadline_expired' END,
          revision=revision+1,updated_at=stamp,finished_at=CASE WHEN next_state='auth_required' THEN NULL ELSE stamp END
          WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
        IF next_state IN ('outcome_unknown','timed_out','failed') THEN
          UPDATE composition_private.execution_steps SET state=CASE WHEN dispatch_started_at IS NOT NULL THEN 'outcome_unknown' ELSE 'failed' END,
            error_code=e.error_code,finished_at=stamp WHERE tenant_id=tenant AND execution_id=e.execution_id AND state='running';
        END IF;
        PERFORM app_private.audit_append('execution.'||next_state,'execution',e.execution_id,e.revision,
          CASE WHEN next_state='outcome_unknown' THEN 'unknown' ELSE 'failed' END,e.error_code,NULL);
      END IF;
    END IF;
    RETURN jsonb_build_object('status',200,'value',to_jsonb(e));
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
  IF e.state NOT IN ('accepted','running','auth_required') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
  IF operation IN ('reauthorize','engine_reserve','engine_bind','prepare','dispatch','step_output','engine_completed') THEN
    IF e.deadline_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','execution_deadline_expired'); END IF;
    IF NOT composition_private.lease_valid(e) THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    IF NOT composition_private.live(e) THEN RETURN jsonb_build_object('status',403,'error','invoke_not_authorized'); END IF;
  END IF;
  IF operation='reauthorize' THEN RETURN jsonb_build_object('status',409,'error','resume_unsupported'); END IF;
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
      input=st.input,input_digest=CASE WHEN st.step_index=0 THEN e.input_digest ELSE
        (SELECT output_digest FROM composition_private.execution_steps WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index-1 AND state='succeeded') END,
      ticket_hash=payload->>'ticketHash',
      ticket_expires_at=least((payload->>'ticketExpiresAt')::timestamptz,e.deadline_at,e.authority_expires_at,
        (c->'c4a_lease'->>'expiresAt')::timestamptz,clock_timestamp()+interval '30 seconds'),
      started_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id
      AND step_index=st.step_index RETURNING * INTO st;
    IF st.ticket_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','auth_required'); END IF;
    UPDATE composition_private.executions SET state='running',current_step=st.step_index,revision=revision+1,
      updated_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    PERFORM app_private.audit_append('invocation.prepared','invocation',e.execution_id,e.revision,'success',NULL,NULL);
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('stepIndex',st.step_index,'stepId',st.step_id,
      'input',st.input,'operationId',st.operation_id,'capability',jsonb_build_object('capabilityId',st.capability_id,'version',st.version,
        'manifestDigest',st.manifest_digest),'providerOrigin',st.provider_origin));
  ELSIF operation='dispatch' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND OR e.state<>'running' OR e.current_step IS DISTINCT FROM st.step_index
      OR st.state<>'running' OR st.ticket_hash IS NULL OR st.dispatch_started_at IS NOT NULL THEN
      RETURN jsonb_build_object('status',409,'error','dispatch_not_available');
    END IF;
    UPDATE composition_private.execution_steps SET dispatch_started_at=clock_timestamp() WHERE tenant_id=tenant AND execution_id=e.execution_id
      AND step_index=(payload->>'stepIndex')::integer;
    event_name:='invocation.dispatched';
  ELSIF operation='step_output' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND OR e.state<>'running' OR st.state<>'running' OR st.ticket_consumed_at IS NULL OR e.current_step<>st.step_index THEN
      RETURN jsonb_build_object('status',409,'error','provider_authorization_required');
    END IF;
    IF coalesce(payload->>'outputDigest','') !~ '^sha256:[0-9a-f]{64}$' OR NOT payload ? 'output' THEN RETURN jsonb_build_object('status',400,'error','invalid_execution_output'); END IF;
    UPDATE composition_private.execution_steps SET state='succeeded',output=payload->'output',output_digest=payload->>'outputDigest',finished_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index RETURNING * INTO st;
    UPDATE composition_private.executions SET current_step=st.step_index+1,revision=revision+1,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.step_completed';
  ELSIF operation='engine_completed' THEN
    IF e.state<>'running' OR e.current_step<>e.step_count OR e.engine_process_id IS DISTINCT FROM payload->>'processId'
      OR EXISTS(SELECT FROM composition_private.execution_steps WHERE tenant_id=tenant AND execution_id=e.execution_id AND state<>'succeeded') THEN
      RETURN jsonb_build_object('status',409,'error','invalid_transition');
    END IF;
    UPDATE composition_private.executions SET state='succeeded',output=(SELECT output FROM composition_private.execution_steps
      WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=e.step_count-1),
      revision=revision+1,finished_at=clock_timestamp(),updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
    event_name:='execution.completed';
  ELSIF operation='step_fail' THEN
    SELECT * INTO st FROM composition_private.execution_steps WHERE tenant_id=tenant
      AND execution_id=e.execution_id AND step_index=(payload->>'stepIndex')::integer FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    next_state:=payload->>'state';
    IF next_state NOT IN ('failed','outcome_unknown','auth_required','timed_out') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    IF e.state NOT IN ('accepted','running','auth_required') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    IF e.current_step>st.step_index THEN next_state:='outcome_unknown'; END IF;
    IF st.dispatch_started_at IS NOT NULL AND next_state IN ('auth_required','timed_out') THEN next_state:='outcome_unknown'; END IF;
    IF next_state<>'auth_required' THEN
      UPDATE composition_private.execution_steps SET state=CASE WHEN next_state='outcome_unknown' THEN 'outcome_unknown' ELSE 'failed' END,
        error_code=coalesce(payload->>'error','execution_failed'),finished_at=clock_timestamp()
        WHERE tenant_id=tenant AND execution_id=e.execution_id AND step_index=st.step_index AND state IN ('pending','running');
    END IF;
    UPDATE composition_private.executions SET state=next_state,error_code=coalesce(payload->>'error','execution_failed'),revision=revision+1,
      finished_at=CASE WHEN next_state='auth_required' THEN NULL ELSE clock_timestamp() END,updated_at=clock_timestamp()
      WHERE tenant_id=tenant AND execution_id=e.execution_id RETURNING * INTO e;
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
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(13);
NOTIFY pgrst,'reload schema';
COMMIT;
