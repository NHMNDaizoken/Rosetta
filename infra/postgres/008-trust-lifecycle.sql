-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_trust_api') THEN
    CREATE ROLE rosetta_trust_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_trust_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_trust_api;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;
ALTER TABLE trust_private.grants ADD COLUMN IF NOT EXISTS activation_approval_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conrelid='trust_private.grants'::regclass AND conname='grant_activation_approval_fk') THEN
    ALTER TABLE trust_private.grants ADD CONSTRAINT grant_activation_approval_fk
      FOREIGN KEY (tenant_id,activation_approval_id) REFERENCES trust_private.approvals(tenant_id,approval_id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS grant_single_consumption_idx ON trust_private.approvals(tenant_id,grant_id) WHERE state='consumed';

CREATE OR REPLACE FUNCTION trust_private.grant_view(g trust_private.grants) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('grantId',g.grant_id,'tenantId',g.tenant_id,'proposal',g.proposal,
    'digest',g.digest,'revision',g.revision,'createdBy',g.created_by,'createdAt',g.created_at,
    'activatedAt',g.activated_at,'revokedAt',g.revoked_at,
    'state',CASE WHEN g.state<>'revoked' AND g.expires_at<=statement_timestamp() THEN 'expired' ELSE g.state END)
$$;
CREATE OR REPLACE FUNCTION trust_private.approval_view(a trust_private.approvals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('approvalId',a.approval_id,'tenantId',a.tenant_id,'decision',a.decision,
    'approverSubject',a.approver_subject,'revision',a.revision,
    'state',CASE WHEN a.state IN ('approved','denied') AND a.expires_at<=statement_timestamp() THEN 'expired' ELSE a.state END)
$$;

-- Existing operator enrollment is the subject attestation. No username lookup,
-- caller claim, resource share or human forwarding can establish this binding.
CREATE OR REPLACE FUNCTION trust_private.target_available(g trust_private.grants) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT EXISTS(SELECT FROM app_private.applications p
    JOIN app_private.enrollments pe ON (pe.tenant_id,pe.issuer,pe.oauth_client_id,pe.owner_subject,pe.provider_origin)=
      (p.tenant_id,p.issuer,p.oauth_client_id,p.owner_subject,p.provider_origin)
    JOIN app_private.applications c ON c.tenant_id=p.tenant_id AND c.app_id=g.consumer_app_id AND c.issuer=p.issuer
    JOIN app_private.enrollments ce ON (ce.tenant_id,ce.issuer,ce.oauth_client_id,ce.owner_subject,ce.provider_origin)=
      (c.tenant_id,c.issuer,c.oauth_client_id,c.owner_subject,c.provider_origin)
    JOIN app_private.capability_versions v ON v.tenant_id=p.tenant_id AND v.version_id=g.version_id AND v.provider_app_id=p.app_id
    WHERE p.tenant_id=g.tenant_id AND p.app_id=g.provider_app_id AND p.issuer=g.issuer
      AND p.state='active' AND c.state='active' AND pe.enabled AND ce.enabled AND ce.resource_subject IS NOT NULL
      AND g.proposal->'subjectIds'=jsonb_build_array(ce.resource_subject)
      AND v.state='published' AND v.capability_id=g.capability_id AND v.version=g.version AND v.digest=g.manifest_digest
      AND (v.manifest->'requiredPermissions') @> (g.proposal->'permissions')
      AND EXISTS(SELECT FROM app_private.principals pr WHERE pr.tenant_id=g.tenant_id AND pr.issuer=g.issuer
        AND pr.subject=g.created_by AND pr.subject=p.owner_subject AND pr.management_client=g.management_client
        AND pr.enabled AND 'trust.write'=ANY(pr.permissions)))
$$;

CREATE OR REPLACE FUNCTION trust_private.lock_target(g trust_private.grants) RETURNS void
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  PERFORM 1 FROM app_private.capability_versions WHERE tenant_id=g.tenant_id AND version_id=g.version_id FOR SHARE;
  PERFORM 1 FROM app_private.applications WHERE tenant_id=g.tenant_id AND app_id IN (g.provider_app_id,g.consumer_app_id) ORDER BY app_id FOR SHARE;
  PERFORM 1 FROM app_private.enrollments e WHERE e.tenant_id=g.tenant_id AND e.issuer=g.issuer
    AND e.oauth_client_id IN (SELECT a.oauth_client_id FROM app_private.applications a WHERE a.tenant_id=g.tenant_id AND a.app_id IN (g.provider_app_id,g.consumer_app_id)) FOR SHARE;
  PERFORM 1 FROM app_private.principals WHERE tenant_id=g.tenant_id AND issuer=g.issuer
    AND subject=g.created_by AND management_client=g.management_client FOR SHARE;
END $$;

CREATE OR REPLACE FUNCTION core.trust_command(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  claims jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=claims->>'tenant_id'; who text:=claims->>'sub'; iss text:=claims->>'iss'; client text:=claims->>'client_id';
  perms text[]; writer boolean; administrator boolean; provider app_private.applications;
  g trust_private.grants; ap trust_private.approvals; v app_private.capability_versions;
  proposal jsonb; decision jsonb; expiry timestamptz; event_name text;
BEGIN
  IF coalesce(tenant,'')='' OR coalesce(who,'')='' OR coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','trust_permission_required');
  END IF;
  SELECT permissions INTO perms FROM app_private.principals WHERE tenant_id=tenant AND issuer=iss
    AND subject=who AND management_client=client AND enabled FOR SHARE;
  IF perms IS NULL THEN RETURN jsonb_build_object('status',403,'error','trust_permission_required'); END IF;
  writer:='trust.write'=ANY(perms); administrator:='trust.approve'=ANY(perms);
  IF NOT writer AND NOT administrator THEN RETURN jsonb_build_object('status',403,'error','trust_permission_required'); END IF;
  IF operation NOT IN ('get','approval_get') AND coalesce((claims->>'trust_writer')::boolean,false) IS NOT TRUE THEN
    RETURN jsonb_build_object('status',403,'error','write_forbidden');
  END IF;
  IF operation='create' THEN
    IF NOT writer THEN RETURN jsonb_build_object('status',403,'error','trust_permission_required'); END IF;
    proposal:=payload->'proposal';
    IF proposal->'delegationAllowed' IS DISTINCT FROM 'false'::jsonb OR proposal->'acceptDelegation' IS DISTINCT FROM 'false'::jsonb
      OR jsonb_array_length(proposal->'capabilities')<>1 THEN RETURN jsonb_build_object('status',400,'error','invalid_direct_grant'); END IF;
    SELECT * INTO provider FROM app_private.applications WHERE tenant_id=tenant AND issuer=iss AND app_id=(proposal->>'providerAppId')::uuid FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF provider.owner_subject<>who THEN RETURN jsonb_build_object('status',403,'error','provider_owner_required'); END IF;
    SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=tenant
      AND capability_id=proposal->'capabilities'->0->>'capabilityId' AND version=proposal->'capabilities'->0->>'version'
      AND provider_app_id=provider.app_id FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF v.state<>'published' OR v.digest<>proposal->'capabilities'->0->>'manifestDigest' THEN
      RETURN jsonb_build_object('status',409,'error','capability_not_available');
    END IF;
    IF NOT ((v.manifest->'requiredPermissions') @> (proposal->'permissions')) THEN RETURN jsonb_build_object('status',400,'error','invalid_grant_permissions'); END IF;
    g.tenant_id:=tenant; g.grant_id:=(payload->>'grantId')::uuid; g.issuer:=iss;
    g.provider_app_id:=provider.app_id; g.consumer_app_id:=(proposal->>'consumerAppId')::uuid;
    g.version_id:=v.version_id; g.capability_id:=v.capability_id; g.version:=v.version; g.manifest_digest:=v.digest;
    g.proposal:=proposal; g.digest:=payload->>'digest'; g.created_by:=who; g.management_client:=client;
    g.expires_at:=(proposal->>'expiresAt')::timestamptz;
    IF g.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',400,'error','invalid_grant_expiry'); END IF;
    PERFORM trust_private.lock_target(g);
    IF NOT trust_private.target_available(g) THEN RETURN jsonb_build_object('status',404,'error','grant_target_not_available'); END IF;
    IF g.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',400,'error','invalid_grant_expiry'); END IF;
    INSERT INTO trust_private.grants(tenant_id,grant_id,issuer,provider_app_id,consumer_app_id,version_id,capability_id,version,
      manifest_digest,proposal,digest,expires_at,created_by,management_client)
      VALUES(tenant,g.grant_id,iss,g.provider_app_id,g.consumer_app_id,g.version_id,g.capability_id,g.version,g.manifest_digest,
        proposal,g.digest,g.expires_at,who,client) RETURNING * INTO g;
    event_name:='grant.proposed';
  ELSE
    IF operation IN ('approval_get','approval_revoke') THEN
      SELECT * INTO ap FROM trust_private.approvals WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      SELECT * INTO g FROM trust_private.grants WHERE tenant_id=tenant AND grant_id=ap.grant_id AND issuer=iss FOR UPDATE;
    ELSE
      SELECT * INTO g FROM trust_private.grants WHERE tenant_id=tenant AND grant_id=(payload->>'grantId')::uuid AND issuer=iss FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    SELECT * INTO provider FROM app_private.applications WHERE tenant_id=tenant AND app_id=g.provider_app_id AND issuer=iss;
    IF NOT administrator AND (NOT writer OR provider.owner_subject<>who) THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF operation='get' THEN RETURN jsonb_build_object('status',200,'value',trust_private.grant_view(g)); END IF;
    IF operation='approval_get' THEN RETURN jsonb_build_object('status',200,'value',trust_private.approval_view(ap)); END IF;
    IF operation IN ('approval_create','activate') THEN
      IF NOT administrator THEN RETURN jsonb_build_object('status',403,'error','trust_approval_required'); END IF;
      IF who=g.created_by OR who=provider.owner_subject THEN
        PERFORM app_private.audit_append('authorization.denied','authorization',g.grant_id,g.revision,'denied','independent_approver_required',NULL);
        RETURN jsonb_build_object('status',403,'error','independent_approver_required');
      END IF;
      IF g.state<>'pending' OR g.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','grant_not_pending'); END IF;
      PERFORM trust_private.lock_target(g);
      IF NOT trust_private.target_available(g) THEN RETURN jsonb_build_object('status',409,'error','grant_target_not_available'); END IF;
      IF g.expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('status',409,'error','grant_expired'); END IF;
    END IF;
    IF operation='approval_create' THEN
      decision:=payload->'decision';
      IF decision->>'resourceType'<>'grant' OR decision->>'resourceId'<>g.grant_id::text
        OR decision->>'requesterSubject'<>g.created_by OR decision->>'requesterAppId'<>g.provider_app_id::text
        OR decision->>'resourceDigest'<>g.digest OR decision->>'resourceRevision'<>g.revision::text THEN
        RETURN jsonb_build_object('status',409,'error','approval_stale');
      END IF;
      expiry:=(decision->>'expiresAt')::timestamptz;
      IF expiry<=clock_timestamp() OR expiry>clock_timestamp()+interval '10 minutes' OR expiry>g.expires_at THEN RETURN jsonb_build_object('status',400,'error','invalid_approval_expiry'); END IF;
      INSERT INTO trust_private.approvals(tenant_id,approval_id,grant_id,decision,approver_subject,management_client,expires_at,state)
        VALUES(tenant,(payload->>'approvalId')::uuid,g.grant_id,decision,who,client,expiry,
          CASE WHEN decision->>'decision'='approve' THEN 'approved' ELSE 'denied' END) RETURNING * INTO ap;
      PERFORM app_private.audit_append('approval.decided','approval',ap.approval_id,ap.revision,'success',decision->>'decision',NULL);
      RETURN jsonb_build_object('status',201,'value',trust_private.approval_view(ap));
    ELSIF operation='approval_revoke' THEN
      IF NOT administrator OR ap.approver_subject<>who OR ap.management_client<>client THEN RETURN jsonb_build_object('status',403,'error','approval_forbidden'); END IF;
      SELECT * INTO ap FROM trust_private.approvals WHERE tenant_id=tenant AND approval_id=ap.approval_id FOR UPDATE;
      IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
      IF payload->>'etag'<>('"approval-'||ap.approval_id||'-'||ap.revision||'"') THEN RETURN jsonb_build_object('status',412,'error','revision_mismatch'); END IF;
      IF ap.state NOT IN ('approved','denied') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      UPDATE trust_private.approvals SET state='revoked',revision=revision+1 WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
      PERFORM app_private.audit_append('approval.revoked','approval',ap.approval_id,ap.revision,'success',NULL,payload->>'reason');
      RETURN jsonb_build_object('status',200,'value',trust_private.approval_view(ap));
    END IF;
    IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
    IF payload->>'etag'<>('"grant-'||g.grant_id||'-'||g.revision||'"') THEN RETURN jsonb_build_object('status',412,'error','revision_mismatch'); END IF;
    IF operation='activate' THEN
      SELECT * INTO ap FROM trust_private.approvals WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid AND grant_id=g.grant_id FOR UPDATE;
      IF NOT FOUND OR ap.state<>'approved' OR ap.expires_at<=clock_timestamp() OR ap.approver_subject<>who OR ap.management_client<>client
        OR ap.decision->>'decision' IS DISTINCT FROM 'approve' OR ap.decision->>'resourceType' IS DISTINCT FROM 'grant'
        OR ap.decision->>'resourceId' IS DISTINCT FROM g.grant_id::text
        OR ap.decision->>'resourceDigest'<>g.digest OR ap.decision->>'resourceRevision'<>g.revision::text
        OR ap.decision->>'requesterSubject'<>g.created_by OR ap.decision->>'requesterAppId'<>g.provider_app_id::text THEN
        RETURN jsonb_build_object('status',409,'error','approval_stale');
      END IF;
      UPDATE trust_private.approvals SET state='consumed',revision=revision+1 WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
      PERFORM app_private.audit_append('approval.consumed','approval',ap.approval_id,ap.revision,'success','approval_consumed',NULL);
      UPDATE trust_private.grants SET state='active',revision=revision+1,activated_at=clock_timestamp(),activation_approval_id=ap.approval_id
        WHERE tenant_id=tenant AND grant_id=g.grant_id RETURNING * INTO g;
      event_name:='grant.activated';
    ELSIF operation='revoke' THEN
      IF g.state='revoked' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      UPDATE trust_private.grants SET state='revoked',revision=revision+1,revoked_at=clock_timestamp(),revoked_by=who,
        reason=app_private.audit_redact_text(payload->>'reason') WHERE tenant_id=tenant AND grant_id=g.grant_id RETURNING * INTO g;
      event_name:='grant.revoked';
    ELSE RETURN jsonb_build_object('status',400,'error','invalid_operation'); END IF;
  END IF;
  PERFORM app_private.audit_append(event_name,'grant',g.grant_id,g.revision,'success',NULL,payload->>'reason');
  RETURN jsonb_build_object('status',CASE WHEN operation='create' THEN 201 ELSE 200 END,'value',trust_private.grant_view(g));
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RETURN jsonb_build_object('status',400,'error','invalid_expiry');
END $$;
REVOKE ALL ON FUNCTION core.trust_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trust_command(text,jsonb) TO rosetta_trust_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trust_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(8) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
