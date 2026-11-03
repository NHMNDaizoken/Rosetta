-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_app_api') THEN
    CREATE ROLE rosetta_app_api NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_app_owner') THEN
    CREATE ROLE rosetta_app_owner NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_app_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_app_api;
CREATE SCHEMA IF NOT EXISTS app_private AUTHORIZATION rosetta_app_owner;
REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
SET LOCAL ROLE rosetta_app_owner;
CREATE TABLE IF NOT EXISTS app_private.principals (
  tenant_id text NOT NULL CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  issuer text NOT NULL, subject text NOT NULL, management_client text NOT NULL,
  permissions text[] NOT NULL CHECK (permissions <@ ARRAY['applications.register','applications.approve','trust.approve']::text[]),
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,issuer,subject,management_client)
);
CREATE TABLE IF NOT EXISTS app_private.enrollments (
  tenant_id text NOT NULL, issuer text NOT NULL, oauth_client_id text NOT NULL,
  owner_subject text NOT NULL, provider_origin text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  PRIMARY KEY(tenant_id,issuer,oauth_client_id)
);
CREATE TABLE IF NOT EXISTS app_private.applications (
  tenant_id text NOT NULL, app_id uuid NOT NULL, issuer text NOT NULL,
  oauth_client_id text NOT NULL, owner_subject text NOT NULL,
  provider_origin text NOT NULL, display_name text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','active','suspended','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  digest text NOT NULL CHECK (digest ~ '^sha256:[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,app_id), UNIQUE(tenant_id,issuer,oauth_client_id)
);
CREATE TABLE IF NOT EXISTS app_private.approvals (
  tenant_id text NOT NULL, approval_id uuid NOT NULL, app_id uuid NOT NULL,
  decision jsonb NOT NULL, approver_subject text NOT NULL, management_client text NOT NULL,
  expires_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('approved','denied','consumed','revoked')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  PRIMARY KEY(tenant_id,approval_id),
  FOREIGN KEY(tenant_id,app_id) REFERENCES app_private.applications(tenant_id,app_id)
);
CREATE TABLE IF NOT EXISTS app_private.audit (
  tenant_id text NOT NULL, event_id uuid NOT NULL DEFAULT gen_random_uuid(),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issuer text NOT NULL, subject text NOT NULL, management_client text NOT NULL,
  event text NOT NULL, resource_id uuid NOT NULL, revision integer NOT NULL,
  reason text,
  PRIMARY KEY(tenant_id,event_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['principals','enrollments','applications','approvals','audit'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='app_private' AND tablename=t AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON app_private.%I TO rosetta_app_owner USING (tenant_id = (current_setting(''request.jwt.claims'',true)::jsonb ->> ''tenant_id'')) WITH CHECK (tenant_id = (current_setting(''request.jwt.claims'',true)::jsonb ->> ''tenant_id''))',t);
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION app_private.application_view(a app_private.applications) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('appId',a.app_id,'tenantId',a.tenant_id,'displayName',a.display_name,
    'oauthClientId',a.oauth_client_id,'providerOrigin',a.provider_origin,'state',a.state,
    'ownerSubject',a.owner_subject,'revision',a.revision,'digest',a.digest)
$$;
CREATE OR REPLACE FUNCTION app_private.approval_view(a app_private.approvals) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('approvalId',a.approval_id,'tenantId',a.tenant_id,'decision',a.decision,
    'state',CASE WHEN a.state IN ('approved','denied') AND a.expires_at<=now() THEN 'expired' ELSE a.state END,
    'approverSubject',a.approver_subject,'revision',a.revision)
$$;
RESET ROLE;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
CREATE OR REPLACE FUNCTION core.application_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb := current_setting('request.jwt.claims',true)::jsonb;
  tenant text := c->>'tenant_id'; who text := c->>'sub'; iss text := c->>'iss'; client text := c->>'client_id';
  perms text[]; a app_private.applications; ap app_private.approvals;
  decision jsonb; result jsonb; event_name text; next_state text; decision_expiry timestamptz;
  admin boolean; enrollment app_private.enrollments;
BEGIN
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','application_permission_required');
  END IF;
  SELECT permissions INTO perms FROM app_private.principals
    WHERE tenant_id=tenant AND issuer=iss AND subject=who AND management_client=client AND enabled FOR SHARE;
  IF perms IS NULL THEN RETURN jsonb_build_object('status',403,'error','application_permission_required'); END IF;
  admin := 'applications.approve'=ANY(perms);
  IF operation='create' THEN
    IF NOT ('applications.register'=ANY(perms)) THEN RETURN jsonb_build_object('status',403,'error','application_permission_required'); END IF;
    SELECT * INTO enrollment FROM app_private.enrollments WHERE tenant_id=tenant AND issuer=iss
      AND oauth_client_id=payload->>'oauthClientId' AND owner_subject=who
      AND provider_origin=payload->>'providerOrigin' AND enabled FOR SHARE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','provider_not_enrolled'); END IF;
    INSERT INTO app_private.applications(tenant_id,app_id,issuer,oauth_client_id,owner_subject,provider_origin,display_name,digest)
      VALUES(tenant,(payload->>'appId')::uuid,iss,enrollment.oauth_client_id,who,enrollment.provider_origin,payload->>'displayName',payload->>'digest') RETURNING * INTO a;
    event_name := 'application.registered'; result := app_private.application_view(a);
  ELSE
    IF operation IN ('approval_get','approval_revoke') THEN
      SELECT * INTO ap FROM app_private.approvals WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid;
      IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
      SELECT * INTO a FROM app_private.applications WHERE tenant_id=tenant AND app_id=ap.app_id AND issuer=iss FOR UPDATE;
    ELSE
      SELECT * INTO a FROM app_private.applications WHERE tenant_id=tenant AND app_id=(payload->>'appId')::uuid AND issuer=iss FOR UPDATE;
    END IF;
    IF NOT FOUND OR (a.owner_subject<>who AND NOT admin) THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF operation='get' THEN RETURN jsonb_build_object('status',200,'value',app_private.application_view(a)); END IF;
    IF operation='approval_get' THEN RETURN jsonb_build_object('status',200,'value',app_private.approval_view(ap)); END IF;
    IF NOT admin THEN RETURN jsonb_build_object('status',403,'error','application_permission_required'); END IF;
    IF operation='approval_create' THEN
      IF NOT ('trust.approve'=ANY(perms)) OR a.owner_subject=who THEN RETURN jsonb_build_object('status',403,'error','independent_approver_required'); END IF;
      IF a.state NOT IN ('pending','suspended') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      decision := payload->'decision';
      IF decision->>'resourceType'<>'application' OR decision->>'resourceId'<>a.app_id::text
        OR decision->>'requesterAppId'<>a.app_id::text OR decision->>'requesterSubject'<>a.owner_subject
        OR decision->>'resourceDigest'<>a.digest OR (decision->>'resourceRevision')::integer<>a.revision THEN
        RETURN jsonb_build_object('status',409,'error','approval_stale');
      END IF;
      decision_expiry := (decision->>'expiresAt')::timestamptz;
      IF decision_expiry<=now() OR decision_expiry>now()+interval '10 minutes' THEN RETURN jsonb_build_object('status',400,'error','invalid_approval_expiry'); END IF;
      INSERT INTO app_private.approvals(tenant_id,approval_id,app_id,decision,approver_subject,management_client,expires_at,state)
        VALUES(tenant,(payload->>'approvalId')::uuid,a.app_id,decision,who,client,decision_expiry,
          CASE WHEN decision->>'decision'='approve' THEN 'approved' ELSE 'denied' END) RETURNING * INTO ap;
      event_name:='approval.decided'; result:=app_private.approval_view(ap);
    ELSIF operation='approval_revoke' THEN
      IF NOT ('trust.approve'=ANY(perms)) OR ap.approver_subject<>who THEN RETURN jsonb_build_object('status',403,'error','approval_forbidden'); END IF;
      SELECT * INTO ap FROM app_private.approvals WHERE tenant_id=tenant AND approval_id=ap.approval_id FOR UPDATE;
      IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
      IF payload->>'etag'<>('"approval-'||ap.approval_id||'-'||ap.revision||'"') THEN RETURN jsonb_build_object('status',412,'error','revision_mismatch'); END IF;
      IF ap.state NOT IN ('approved','denied') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      UPDATE app_private.approvals SET state='revoked',revision=revision+1 WHERE tenant_id=tenant AND approval_id=ap.approval_id RETURNING * INTO ap;
      event_name:='approval.revoked'; result:=app_private.approval_view(ap);
    ELSIF operation IN ('approve','state') THEN
      IF payload->>'etag' IS NULL THEN RETURN jsonb_build_object('status',428,'error','if_match_required'); END IF;
      IF payload->>'etag'<>('"application-'||a.app_id||'-'||a.revision||'"') THEN RETURN jsonb_build_object('status',412,'error','revision_mismatch'); END IF;
      next_state := CASE WHEN operation='approve' THEN 'active' ELSE CASE payload->>'action' WHEN 'suspend' THEN 'suspended' WHEN 'reactivate' THEN 'active' WHEN 'revoke' THEN 'revoked' END END;
      IF next_state IS NULL OR a.state='revoked' OR (operation='approve' AND a.state<>'pending')
        OR (operation='state' AND payload->>'action'='reactivate' AND a.state<>'suspended')
        OR (next_state='suspended' AND a.state<>'active') THEN RETURN jsonb_build_object('status',409,'error','invalid_transition'); END IF;
      IF next_state='active' THEN
        PERFORM 1 FROM app_private.principals WHERE tenant_id=tenant AND issuer=iss AND subject=a.owner_subject AND enabled AND 'applications.register'=ANY(permissions) FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','owner_not_enrolled'); END IF;
        SELECT * INTO enrollment FROM app_private.enrollments WHERE tenant_id=tenant AND issuer=iss AND oauth_client_id=a.oauth_client_id
          AND owner_subject=a.owner_subject AND provider_origin=a.provider_origin AND enabled FOR SHARE;
        IF NOT FOUND THEN RETURN jsonb_build_object('status',403,'error','provider_not_enrolled'); END IF;
        IF NOT ('trust.approve'=ANY(perms)) OR who=a.owner_subject THEN RETURN jsonb_build_object('status',403,'error','independent_approver_required'); END IF;
        SELECT * INTO ap FROM app_private.approvals WHERE tenant_id=tenant AND approval_id=(payload->>'approvalId')::uuid AND app_id=a.app_id FOR UPDATE;
        IF NOT FOUND OR ap.state<>'approved' OR ap.expires_at<=now() OR ap.approver_subject<>who OR ap.management_client<>client
          OR ap.decision->>'resourceDigest'<>a.digest OR (ap.decision->>'resourceRevision')::integer<>a.revision THEN
          RETURN jsonb_build_object('status',409,'error','approval_stale');
        END IF;
        UPDATE app_private.approvals SET state='consumed',revision=revision+1 WHERE tenant_id=tenant AND approval_id=ap.approval_id;
        INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,resource_id,revision)
          VALUES(tenant,iss,who,client,'approval.consumed',ap.approval_id,ap.revision+1);
      END IF;
      UPDATE app_private.applications SET state=next_state,revision=revision+1 WHERE tenant_id=tenant AND app_id=a.app_id RETURNING * INTO a;
      event_name:='application.'||CASE next_state WHEN 'active' THEN 'approved' WHEN 'suspended' THEN 'suspended' ELSE 'revoked' END;
      result:=app_private.application_view(a);
    ELSE RETURN jsonb_build_object('status',400,'error','invalid_operation'); END IF;
  END IF;
  INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,resource_id,revision,reason)
    VALUES(tenant,iss,who,client,event_name,CASE WHEN event_name LIKE 'approval.%' THEN ap.approval_id ELSE a.app_id END,
      CASE WHEN event_name LIKE 'approval.%' THEN ap.revision ELSE a.revision END,payload->>'reason');
  RETURN jsonb_build_object('status',CASE WHEN operation IN ('create','approval_create') THEN 201 ELSE 200 END,'value',result);
EXCEPTION WHEN unique_violation THEN RETURN jsonb_build_object('status',409,'error','application_conflict');
END $$;
ALTER FUNCTION core.application_command(text,jsonb) OWNER TO rosetta_app_owner;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
REVOKE ALL ON FUNCTION core.application_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.application_command(text,jsonb) TO rosetta_app_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
INSERT INTO core.schema_migrations(version) VALUES(3) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
