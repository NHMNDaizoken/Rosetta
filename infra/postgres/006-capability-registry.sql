-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_capability_api') THEN
    CREATE ROLE rosetta_capability_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_capability_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_capability_api;
GRANT USAGE ON SCHEMA core TO rosetta_app_owner;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;

ALTER TABLE app_private.principals DROP CONSTRAINT IF EXISTS principals_permissions_check;
ALTER TABLE app_private.principals ADD CONSTRAINT principals_permissions_check
  CHECK (permissions <@ ARRAY['applications.register','applications.approve','trust.approve','audit.read',
    'capabilities.write','capabilities.publish','capabilities.approve']::text[]);

CREATE TABLE IF NOT EXISTS app_private.capability_versions (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  version_id uuid NOT NULL DEFAULT gen_random_uuid(),
  capability_id text NOT NULL CHECK (capability_id ~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'),
  provider_app_id uuid NOT NULL,
  version text NOT NULL CHECK (version ~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='object'),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','deprecated','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  validation_status text CHECK (validation_status IS NULL OR validation_status IN ('valid','invalid','indeterminate')),
  validation_digest text CHECK (validation_digest IS NULL OR validation_digest ~ '^sha256:[0-9a-f]{64}$'),
  validation_revision integer CHECK (validation_revision IS NULL OR validation_revision > 0),
  validation_report jsonb,
  validation_policy_revision integer CHECK (validation_policy_revision IS NULL OR validation_policy_revision > 0),
  validated_at timestamptz,
  created_by text NOT NULL CHECK (length(created_by) BETWEEN 1 AND 255),
  updated_by text NOT NULL CHECK (length(updated_by) BETWEEN 1 AND 255),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  deprecated_at timestamptz,
  revoked_at timestamptz,
  reason text,
  PRIMARY KEY (tenant_id,version_id),
  UNIQUE (tenant_id,capability_id,version),
  FOREIGN KEY (tenant_id,provider_app_id) REFERENCES app_private.applications(tenant_id,app_id)
);
CREATE INDEX IF NOT EXISTS capability_versions_owner_idx
  ON app_private.capability_versions (tenant_id,provider_app_id,state,updated_at DESC);
CREATE INDEX IF NOT EXISTS capability_versions_page_idx
  ON app_private.capability_versions (tenant_id,updated_at DESC,version_id DESC);

CREATE TABLE IF NOT EXISTS app_private.capability_publication_approvals (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  approval_id uuid NOT NULL,
  version_id uuid NOT NULL,
  capability_id text NOT NULL,
  version text NOT NULL,
  manifest_digest text NOT NULL CHECK (manifest_digest ~ '^sha256:[0-9a-f]{64}$'),
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
  FOREIGN KEY (tenant_id,version_id) REFERENCES app_private.capability_versions(tenant_id,version_id),
  FOREIGN KEY (tenant_id,requester_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  CHECK (requester_subject <> approver_subject)
);
CREATE INDEX IF NOT EXISTS capability_approvals_target_idx
  ON app_private.capability_publication_approvals (tenant_id,version_id,state,expires_at);

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['capability_versions','capability_publication_approvals'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='app_private' AND tablename=t AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON app_private.%I TO rosetta_app_owner USING (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')) WITH CHECK (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id''))',t);
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION app_private.capability_version_view(v app_private.capability_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'versionId',v.version_id,'capabilityId',v.capability_id,'providerAppId',v.provider_app_id,
    'version',v.version,'manifest',v.manifest,'state',v.state,'revision',v.revision,'digest',v.digest,
    'validation',CASE WHEN v.validation_status IS NULL THEN NULL ELSE jsonb_build_object(
      'status',v.validation_status,'digest',v.validation_digest,'revision',v.validation_revision,
      'policyRevision',v.validation_policy_revision,'report',v.validation_report,
      'validatedAt',v.validated_at) END,
    'createdBy',v.created_by,'updatedBy',v.updated_by,'createdAt',v.created_at,'updatedAt',v.updated_at,
    'publishedAt',v.published_at,'deprecatedAt',v.deprecated_at,'revokedAt',v.revoked_at)
$$;

CREATE OR REPLACE FUNCTION app_private.capability_approval_view(a app_private.capability_publication_approvals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'approvalId',a.approval_id,'tenantId',a.tenant_id,
    'decision',jsonb_build_object(
      'resourceType','capability-version','resourceId',a.capability_id,
      'resourceDigest',a.manifest_digest,'resourceRevision',a.version_revision,
      'requesterSubject',a.requester_subject,'requesterAppId',a.requester_app_id,
      'decision',a.decision,'expiresAt',a.expires_at),
    'versionId',a.version_id,'capabilityId',a.capability_id,'version',a.version,
    'state',CASE WHEN a.state IN ('approved','denied') AND a.expires_at<=now() THEN 'expired' ELSE a.state END,
    'approverSubject',a.approver_subject,'revision',a.revision)
$$;

CREATE OR REPLACE FUNCTION core.capability_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; who text:=c->>'sub'; iss text:=c->>'iss'; client text:=c->>'client_id';
  perms text[]; writer boolean; publisher boolean; approver boolean;
  v app_private.capability_versions; ap app_private.capability_publication_approvals;
  app app_private.applications; report jsonb; issues jsonb;
  cap_id text; ver text; v_digest text; v_id uuid; resource_id text;
  next_state text; v_limit integer:=100; v_cursor_time timestamptz; v_cursor_id uuid; v_cursor_text text;
  v_next text; items jsonb; event_name text; report_status text; approval_expiry timestamptz;
BEGIN
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR
     coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','capability_permission_required');
  END IF;
  SELECT permissions INTO perms FROM app_private.principals
    WHERE tenant_id=tenant AND issuer=iss AND subject=who AND management_client=client AND enabled FOR SHARE;
  IF perms IS NULL THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
  writer:='capabilities.write'=ANY(perms);
  publisher:='capabilities.publish'=ANY(perms);
  approver:='capabilities.approve'=ANY(perms);

  IF operation='list' THEN
    IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
    IF payload ? 'limit' THEN
      IF jsonb_typeof(payload->'limit')<>'number' OR (payload->>'limit') !~ '^[0-9]{1,3}$' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_capability_query');
      END IF;
      v_limit:=(payload->>'limit')::integer;
      IF v_limit<1 OR v_limit>100 THEN RETURN jsonb_build_object('status',400,'error','invalid_capability_query'); END IF;
    END IF;
    IF payload ? 'cursor' THEN
      IF jsonb_typeof(payload->'cursor')<>'string' THEN RETURN jsonb_build_object('status',400,'error','invalid_capability_cursor'); END IF;
      BEGIN
        v_cursor_text:=convert_from(decode(payload->>'cursor','hex'),'UTF8');
        IF position('|' IN v_cursor_text)=0 OR position('|' IN v_cursor_text)=length(v_cursor_text) THEN
          RETURN jsonb_build_object('status',400,'error','invalid_capability_cursor');
        END IF;
        v_cursor_time:=split_part(v_cursor_text,'|',1)::timestamptz;
        v_cursor_id:=split_part(v_cursor_text,'|',2)::uuid;
      EXCEPTION WHEN others THEN RETURN jsonb_build_object('status',400,'error','invalid_capability_cursor'); END;
    END IF;
    SELECT coalesce(jsonb_agg(app_private.capability_version_view(a) ORDER BY a.updated_at DESC,a.version_id DESC),'[]'::jsonb)
      INTO items FROM (
        SELECT cv.* FROM app_private.capability_versions cv
        JOIN app_private.applications a ON a.tenant_id=cv.tenant_id AND a.app_id=cv.provider_app_id
        WHERE cv.tenant_id=tenant AND (publisher OR a.owner_subject=who) AND
          (v_cursor_time IS NULL OR (cv.updated_at,cv.version_id)<(v_cursor_time,v_cursor_id))
        ORDER BY cv.updated_at DESC,cv.version_id DESC LIMIT v_limit+1
      ) a;
    IF jsonb_array_length(items)>v_limit THEN
      v_next:=encode(convert_to((items->(v_limit-1)->>'updatedAt')||'|'||(items->(v_limit-1)->>'versionId'),'UTF8'),'hex');
      items:=items-v_limit;
    END IF;
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('items',items,'nextCursor',v_next));
  END IF;

  IF operation IN ('get','register','update','validate','publish','deprecate','revoke') THEN
    cap_id:=payload->>'capabilityId'; ver:=payload->>'version';
    IF cap_id IS NULL OR cap_id !~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'
      OR ver IS NULL OR ver !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_capability_reference');
    END IF;
    IF operation='register' THEN
      IF NOT writer THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
      IF payload->>'manifest' IS NULL OR jsonb_typeof(payload->'manifest')<>'object' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_manifest');
      END IF;
      v_digest:=payload->>'digest';
      IF v_digest IS NULL OR v_digest !~ '^sha256:[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status',400,'error','invalid_manifest'); END IF;
      IF payload->'manifest'->>'capabilityId'<>cap_id OR payload->'manifest'->>'version'<>ver
        OR payload->'manifest'->>'manifestVersion'<>'1.0' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_manifest');
      END IF;
      IF payload->>'providerAppId' IS NULL OR payload->>'providerAppId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        RETURN jsonb_build_object('status',400,'error','invalid_capability_reference');
      END IF;
      SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant
        AND app_id=(payload->>'providerAppId')::uuid FOR SHARE;
      IF NOT FOUND OR app.state<>'active' THEN
        RETURN jsonb_build_object('status',403,'error','provider_not_available');
      END IF;
      IF cap_id NOT LIKE 'urn:rosetta:capability:'||app.app_id::text||':%'
        OR payload->'manifest'->>'providerAppId'<>app.app_id::text THEN
        RETURN jsonb_build_object('status',403,'error','provider_mismatch');
      END IF;
      IF app.owner_subject<>who AND NOT publisher THEN
        RETURN jsonb_build_object('status',403,'error','capability_permission_required');
      END IF;
      PERFORM 1 FROM app_private.principals p WHERE p.tenant_id=tenant AND p.issuer=iss
        AND p.subject=app.owner_subject AND p.enabled AND 'capabilities.write'=ANY(p.permissions) FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','owner_not_enrolled'); END IF;
      PERFORM 1 FROM app_private.enrollments e WHERE e.tenant_id=tenant AND e.issuer=iss
        AND e.oauth_client_id=app.oauth_client_id AND e.owner_subject=app.owner_subject
        AND e.provider_origin=app.provider_origin AND e.enabled FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','provider_not_enrolled'); END IF;
      INSERT INTO app_private.capability_versions(tenant_id,capability_id,provider_app_id,version,manifest,digest,created_by,updated_by)
        VALUES(tenant,cap_id,app.app_id,ver,payload->'manifest',v_digest,who,who) RETURNING * INTO v;
      event_name:='capability.registered';
    ELSE
      SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=tenant
        AND capability_id=cap_id AND version=ver FOR UPDATE;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=v.provider_app_id FOR SHARE;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
      IF app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      IF operation='get' THEN
        RETURN jsonb_build_object('status',200,'value',app_private.capability_version_view(v));
      END IF;
      IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
      IF payload->>'etag'<>('"capability-version-'||v.version_id||'-'||v.revision||'"') THEN
        RETURN jsonb_build_object('status',412,'error','revision_mismatch');
      END IF;
      IF operation='update' THEN
        IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
        IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','immutable_version'); END IF;
        IF payload->>'manifest' IS NULL OR jsonb_typeof(payload->'manifest')<>'object'
          OR payload->'manifest'->>'capabilityId'<>v.capability_id OR payload->'manifest'->>'version'<>v.version
          OR payload->'manifest'->>'manifestVersion'<>'1.0'
          OR payload->'manifest'->>'providerAppId'<>v.provider_app_id::text THEN
          RETURN jsonb_build_object('status',400,'error','invalid_manifest');
        END IF;
        v_digest:=payload->>'digest';
        IF v_digest IS NULL OR v_digest !~ '^sha256:[0-9a-f]{64}$' THEN RETURN jsonb_build_object('status',400,'error','invalid_manifest'); END IF;
        UPDATE app_private.capability_versions SET manifest=payload->'manifest',digest=v_digest,
          revision=revision+1,updated_by=who,updated_at=now(),validation_status=NULL,validation_digest=NULL,
          validation_revision=NULL,validation_report=NULL,validation_policy_revision=NULL,validated_at=NULL
          WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
        event_name:='capability.updated';
      ELSIF operation='validate' THEN
        IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
        IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
        report_status:=payload->>'validationStatus';
        IF report_status IS NULL OR report_status NOT IN ('valid','invalid','indeterminate')
          OR (payload ? 'validationReport' AND jsonb_typeof(payload->'validationReport')<>'object') THEN
          RETURN jsonb_build_object('status',400,'error','invalid_validation_report');
        END IF;
        IF v.provider_app_id IS NULL OR app.state<>'active' THEN
          report_status:='invalid';
          issues:=jsonb_build_array(jsonb_build_object('path','/providerAppId','code','provider_not_active','message','Provider application is not active.'));
        ELSE
          PERFORM 1 FROM app_private.principals p WHERE p.tenant_id=tenant AND p.issuer=iss
            AND p.subject=app.owner_subject AND p.enabled AND 'capabilities.write'=ANY(p.permissions) FOR SHARE;
          IF NOT FOUND THEN
            report_status:='invalid';
            issues:=jsonb_build_array(jsonb_build_object('path','/providerAppId','code','owner_not_enrolled','message','Provider owner is not enrolled.'));
          ELSE
            PERFORM 1 FROM app_private.enrollments e WHERE e.tenant_id=tenant AND e.issuer=iss
              AND e.oauth_client_id=app.oauth_client_id AND e.owner_subject=app.owner_subject
              AND e.provider_origin=app.provider_origin AND e.enabled FOR SHARE;
            IF NOT FOUND THEN
              report_status:='invalid';
              issues:=jsonb_build_array(jsonb_build_object('path','/providerAppId','code','provider_not_enrolled','message','Provider enrollment is not active.'));
            ELSE
              issues:=coalesce(payload->'validationIssues','[]'::jsonb);
            END IF;
          END IF;
        END IF;
        report:=jsonb_build_object('status',report_status,'digest',v.digest,'revision',v.revision,
          'policyRevision',1,'issues',issues,'edges','[]'::jsonb);
        UPDATE app_private.capability_versions SET validation_status=report_status,validation_digest=v.digest,
          validation_revision=v.revision,validation_report=report,validation_policy_revision=1,validated_at=now(),
          updated_by=who,updated_at=now()
          WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
        event_name:='capability.validated';
        RETURN jsonb_build_object('status',200,'value',report||jsonb_build_object('versionId',v.version_id));
      ELSIF operation='publish' THEN
        IF NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
        IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
        IF app.state<>'active' THEN RETURN jsonb_build_object('status',403,'error','provider_not_available'); END IF;
        PERFORM 1 FROM app_private.principals p WHERE p.tenant_id=tenant AND p.issuer=iss
          AND p.subject=app.owner_subject AND p.enabled AND 'capabilities.write'=ANY(p.permissions) FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','owner_not_enrolled'); END IF;
        PERFORM 1 FROM app_private.enrollments e WHERE e.tenant_id=tenant AND e.issuer=iss
          AND e.oauth_client_id=app.oauth_client_id AND e.owner_subject=app.owner_subject
          AND e.provider_origin=app.provider_origin AND e.enabled FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','provider_not_enrolled'); END IF;
        IF v.validation_status<>'valid' OR v.validation_digest<>v.digest OR v.validation_revision<>v.revision THEN
          RETURN jsonb_build_object('status',409,'error','validation_required');
        END IF;
        SELECT * INTO ap FROM app_private.capability_publication_approvals
          WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid AND version_id=v.version_id FOR UPDATE;
        IF NOT FOUND OR ap.state<>'approved' OR ap.expires_at<=now() OR ap.decision<>'approve'
          OR ap.manifest_digest<>v.digest OR ap.version_revision<>v.revision
          OR ap.requester_subject<>v.created_by OR ap.requester_app_id<>v.provider_app_id
          OR ap.approver_subject=who OR ap.approver_subject=app.owner_subject THEN
          RETURN jsonb_build_object('status',409,'error','approval_stale');
        END IF;
        PERFORM 1 FROM app_private.principals p WHERE p.tenant_id=tenant AND p.subject=ap.approver_subject
          AND p.management_client=ap.management_client AND p.enabled AND 'capabilities.approve'=ANY(p.permissions) FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','approver_not_enrolled'); END IF;
        UPDATE app_private.capability_publication_approvals SET state='consumed',revision=revision+1
          WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
        PERFORM app_private.audit_append('approval.consumed','approval',ap.approval_id,ap.revision,'success','approval_consumed',NULL);
        UPDATE app_private.capability_versions SET state='published',revision=revision+1,updated_by=who,
          updated_at=now(),published_at=now(),reason=NULL
          WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
        event_name:='capability.published';
      ELSIF operation='deprecate' THEN
        IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
        IF v.state<>'published' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
        UPDATE app_private.capability_versions SET state='deprecated',revision=revision+1,updated_by=who,
          updated_at=now(),deprecated_at=now(),reason=nullif(payload->>'reason','')
          WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
        event_name:='capability.deprecated';
      ELSIF operation='revoke' THEN
        IF NOT writer AND NOT publisher THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
        IF v.state='revoked' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
        UPDATE app_private.capability_versions SET state='revoked',revision=revision+1,updated_by=who,
          updated_at=now(),revoked_at=now(),reason=nullif(payload->>'reason','')
          WHERE tenant_id=tenant AND version_id=v.version_id RETURNING * INTO v;
        event_name:='capability.revoked';
      ELSE
        RETURN jsonb_build_object('status',400,'error','invalid_operation');
      END IF;
    END IF;
    PERFORM app_private.audit_append(event_name,'capability',v.version_id,v.revision,
      CASE WHEN event_name='capability.validated' AND v.validation_status<>'valid' THEN 'failed' ELSE 'success' END,
      CASE WHEN event_name='capability.validated' THEN v.validation_status ELSE NULL END,NULL);
    RETURN jsonb_build_object('status',CASE WHEN operation='register' THEN 201 ELSE 200 END,'value',app_private.capability_version_view(v));
  END IF;

  IF operation='approval_create' THEN
    IF NOT approver THEN RETURN jsonb_build_object('status',403,'error','capability_approval_required'); END IF;
    resource_id:=payload->'decision'->>'resourceId';
    IF resource_id IS NULL OR payload->'decision'->>'resourceType'<>'capability-version'
      OR coalesce(payload->'decision'->>'decision','') NOT IN ('approve','deny')
      OR coalesce(payload->'decision'->>'resourceRevision','') !~ '^[1-9][0-9]{0,8}$'
      OR jsonb_typeof(payload->'decision'->'expiresAt')<>'string' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_capability_approval');
    END IF;
    IF resource_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      v_id:=resource_id::uuid;
    ELSIF resource_id ~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}@(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' THEN
      SELECT version_id INTO v_id FROM app_private.capability_versions WHERE tenant_id=tenant
        AND capability_id=split_part(resource_id,'@',1) AND version=split_part(resource_id,'@',2);
    ELSE
      SELECT count(*)::integer,min(version_id) INTO v_limit,v_id FROM app_private.capability_versions
        WHERE tenant_id=tenant AND capability_id=resource_id
          AND digest=payload->'decision'->>'resourceDigest'
          AND revision=(payload->'decision'->>'resourceRevision')::integer;
      IF v_limit<>1 THEN RETURN jsonb_build_object('status',409,'error','version_reference_required'); END IF;
    END IF;
    IF v_id IS NULL THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=tenant AND version_id=v_id FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF v.state<>'draft' THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=v.provider_app_id FOR SHARE;
    IF NOT FOUND OR app.state<>'active' THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF payload->'decision'->>'requesterSubject'<>v.created_by OR payload->'decision'->>'requesterAppId'<>v.provider_app_id::text
      OR payload->'decision'->>'resourceDigest'<>v.digest OR (payload->'decision'->>'resourceRevision')::integer<>v.revision THEN
      RETURN jsonb_build_object('status',409,'error','approval_stale');
    END IF;
    IF who=v.created_by OR who=app.owner_subject THEN RETURN jsonb_build_object('status',403,'error','independent_approver_required'); END IF;
    BEGIN
      approval_expiry:=(payload->'decision'->>'expiresAt')::timestamptz;
    EXCEPTION WHEN others THEN
      RETURN jsonb_build_object('status',400,'error','invalid_approval_expiry');
    END;
    IF approval_expiry<=now() OR approval_expiry>now()+interval '10 minutes' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_approval_expiry');
    END IF;
    IF payload->>'approvalId' IS NULL OR payload->>'approvalId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_capability_approval');
    END IF;
    INSERT INTO app_private.capability_publication_approvals(tenant_id,approval_id,version_id,capability_id,version,
      manifest_digest,version_revision,requester_subject,requester_app_id,decision,approver_subject,management_client,
      expires_at,state)
      VALUES(tenant,(payload->>'approvalId')::uuid,v.version_id,v.capability_id,v.version,v.digest,v.revision,
        v.created_by,v.provider_app_id,payload->'decision'->>'decision',who,client,approval_expiry,
        CASE WHEN payload->'decision'->>'decision'='approve' THEN 'approved' ELSE 'denied' END) RETURNING * INTO ap;
    PERFORM app_private.audit_append('approval.decided','approval',ap.approval_id,ap.revision,'success',ap.decision,NULL);
    RETURN jsonb_build_object('status',201,'value',app_private.capability_approval_view(ap));
  ELSIF operation IN ('approval_get','approval_revoke') THEN
    IF payload->>'approvalId' IS NULL OR payload->>'approvalId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('status',400,'error','invalid_approval');
    END IF;
    IF operation='approval_get' THEN
      SELECT * INTO ap FROM app_private.capability_publication_approvals WHERE tenant_id=tenant
        AND approval_id=(payload->>'approvalId')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      SELECT * INTO app FROM app_private.applications WHERE tenant_id=tenant AND app_id=ap.requester_app_id FOR SHARE;
      IF ap.approver_subject<>who AND ap.requester_subject<>who AND app.owner_subject<>who AND NOT publisher THEN
        RETURN jsonb_build_object('status',404,'error','not_found');
      END IF;
      RETURN jsonb_build_object('status',200,'value',app_private.capability_approval_view(ap));
    END IF;
    SELECT * INTO ap FROM app_private.capability_publication_approvals WHERE tenant_id=tenant
      AND approval_id=(payload->>'approvalId')::uuid FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF NOT approver OR ap.approver_subject<>who THEN RETURN jsonb_build_object('status',403,'error','approval_forbidden'); END IF;
    IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
    IF payload->>'etag'<>('"approval-'||ap.approval_id||'-'||ap.revision||'"') THEN
      RETURN jsonb_build_object('status',412,'error','revision_mismatch');
    END IF;
    IF ap.state NOT IN ('approved','denied') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
    UPDATE app_private.capability_publication_approvals SET state='revoked',revision=revision+1
      WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
    PERFORM app_private.audit_append('approval.revoked','approval',ap.approval_id,ap.revision,'success','approval_revoked',NULL);
    RETURN jsonb_build_object('status',200,'value',app_private.capability_approval_view(ap));
  END IF;

  RETURN jsonb_build_object('status',400,'error','invalid_operation');
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('status',409,'error','capability_conflict');
END $$;

ALTER FUNCTION core.capability_command(text,jsonb) OWNER TO rosetta_app_owner;
REVOKE ALL ON FUNCTION core.capability_command(text,jsonb) FROM PUBLIC,rosetta_api,rosetta_app_api,rosetta_resource_api,rosetta_audit_api;
GRANT EXECUTE ON FUNCTION core.capability_command(text,jsonb) TO rosetta_capability_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(6) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
