-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='rosetta_resource_api') THEN
    CREATE ROLE rosetta_resource_api NOLOGIN NOBYPASSRLS;
  END IF;
END $$;
GRANT rosetta_resource_api TO rosetta_data;
GRANT USAGE ON SCHEMA core TO rosetta_resource_api;
GRANT USAGE ON SCHEMA core TO rosetta_app_owner;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;
ALTER TABLE app_private.enrollments ADD COLUMN IF NOT EXISTS resource_subject text
  CHECK (resource_subject IS NULL OR length(resource_subject) BETWEEN 1 AND 255);

CREATE OR REPLACE FUNCTION core.resource_actor() RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
  SELECT a.app_id FROM app_private.applications a JOIN app_private.enrollments e
    ON (e.tenant_id,e.issuer,e.oauth_client_id,e.owner_subject,e.provider_origin)=
       (a.tenant_id,a.issuer,a.oauth_client_id,a.owner_subject,a.provider_origin)
  WHERE a.tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
    AND a.issuer=current_setting('request.jwt.claims',true)::jsonb->>'iss'
    AND a.oauth_client_id=current_setting('request.jwt.claims',true)::jsonb->>'client_id'
    AND e.resource_subject=current_setting('request.jwt.claims',true)::jsonb->>'sub'
    AND a.state='active' AND e.enabled
$$;
CREATE OR REPLACE FUNCTION app_private.resource_app_active(app uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog,app_private AS $$
  SELECT EXISTS(SELECT FROM app_private.applications a JOIN app_private.enrollments e
    ON (e.tenant_id,e.issuer,e.oauth_client_id,e.owner_subject,e.provider_origin)=
       (a.tenant_id,a.issuer,a.oauth_client_id,a.owner_subject,a.provider_origin)
    WHERE a.app_id=app AND a.tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
      AND a.state='active' AND e.enabled AND e.resource_subject IS NOT NULL)
$$;
CREATE OR REPLACE FUNCTION core.resource_writer() RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT coalesce(current_setting('request.jwt.claims',true)::jsonb->'resource_writer'='true'::jsonb,false)
$$;

CREATE TABLE IF NOT EXISTS app_private.resource_shares (
  tenant_id text NOT NULL,
  share_id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_app_id uuid NOT NULL,
  grantee_app_id uuid NOT NULL,
  resource_type text NOT NULL CHECK(resource_type IN ('record','object')),
  resource_id uuid NOT NULL,
  action text NOT NULL CHECK(action='read'),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,share_id),
  FOREIGN KEY(tenant_id,owner_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  FOREIGN KEY(tenant_id,grantee_app_id) REFERENCES app_private.applications(tenant_id,app_id),
  CHECK(owner_app_id<>grantee_app_id)
);
CREATE INDEX IF NOT EXISTS resource_share_lookup ON app_private.resource_shares
  (tenant_id,resource_type,resource_id,grantee_app_id) WHERE NOT revoked;
CREATE TABLE IF NOT EXISTS app_private.resource_objects (
  tenant_id text NOT NULL,
  id uuid NOT NULL,
  owner_app_id uuid NOT NULL,
  version uuid,
  deleted boolean NOT NULL DEFAULT false,
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,owner_app_id) REFERENCES app_private.applications(tenant_id,app_id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['resource_shares','resource_objects'] LOOP
    EXECUTE format('ALTER TABLE app_private.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('ALTER TABLE app_private.%I FORCE ROW LEVEL SECURITY',t);
    IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='app_private' AND tablename=t AND policyname='tenant_isolation') THEN
      EXECUTE format('CREATE POLICY tenant_isolation ON app_private.%I TO rosetta_app_owner USING (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id'')) WITH CHECK (tenant_id=(current_setting(''request.jwt.claims'',true)::jsonb->>''tenant_id''))',t);
    END IF;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION core.resource_readable(owner_app uuid, kind text, resource uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
  SELECT core.resource_actor() IS NOT NULL AND app_private.resource_app_active(owner_app) AND
    (owner_app=core.resource_actor() OR EXISTS(SELECT FROM app_private.resource_shares
      WHERE tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
        AND owner_app_id=owner_app AND resource_type=kind AND resource_id=resource
        AND grantee_app_id=core.resource_actor() AND action='read' AND NOT revoked AND expires_at>now()))
$$;

CREATE TABLE IF NOT EXISTS core.app_records (
  tenant_id text NOT NULL DEFAULT(current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'),
  id uuid NOT NULL,
  owner_app_id uuid NOT NULL DEFAULT core.resource_actor(),
  collection text NOT NULL CHECK(collection ~ '^[a-z][a-z0-9_-]{0,62}$'),
  data jsonb NOT NULL CHECK(jsonb_typeof(data)='object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(tenant_id,id),
  FOREIGN KEY(tenant_id,owner_app_id) REFERENCES app_private.applications(tenant_id,app_id)
);
ALTER TABLE core.app_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.app_records FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS(SELECT FROM pg_policies WHERE schemaname='core' AND tablename='app_records' AND policyname='resource_read') THEN
    CREATE POLICY resource_read ON core.app_records FOR SELECT TO rosetta_resource_api
      USING(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id' AND core.resource_readable(owner_app_id,'record',id));
    CREATE POLICY resource_insert ON core.app_records FOR INSERT TO rosetta_resource_api
      WITH CHECK(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id' AND owner_app_id=core.resource_actor() AND core.resource_writer());
    CREATE POLICY resource_update ON core.app_records FOR UPDATE TO rosetta_resource_api
      USING(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id' AND owner_app_id=core.resource_actor() AND core.resource_writer())
      WITH CHECK(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id' AND owner_app_id=core.resource_actor() AND core.resource_writer());
    CREATE POLICY resource_delete ON core.app_records FOR DELETE TO rosetta_resource_api
      USING(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id' AND owner_app_id=core.resource_actor() AND core.resource_writer());
    CREATE POLICY tenant_operator ON core.app_records TO rosetta_app_owner
      USING(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id')
      WITH CHECK(tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id');
  END IF;
END $$;
GRANT SELECT, DELETE ON core.app_records TO rosetta_resource_api;
GRANT INSERT(id,collection,data), UPDATE(data) ON core.app_records TO rosetta_resource_api;

CREATE OR REPLACE FUNCTION core.resource_command(operation text, payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb;
  tenant text:=c->>'tenant_id'; actor uuid:=core.resource_actor();
  obj app_private.resource_objects; share app_private.resource_shares;
  resource uuid; target uuid; expiry timestamptz;
BEGIN
  IF actor IS NULL THEN RETURN jsonb_build_object('status',403,'error','application_access_required'); END IF;
  IF operation='context' THEN RETURN jsonb_build_object('status',200,'value',jsonb_build_object('appId',actor)); END IF;
  IF operation<>'object_get' AND NOT core.resource_writer() THEN RETURN jsonb_build_object('status',403,'error','write_forbidden'); END IF;
  IF operation LIKE 'object_%' THEN
    resource:=(payload->>'id')::uuid;
    IF operation='object_prepare' THEN
      INSERT INTO app_private.resource_objects(tenant_id,id,owner_app_id) VALUES(tenant,resource,actor) ON CONFLICT DO NOTHING;
    END IF;
    SELECT * INTO obj FROM app_private.resource_objects WHERE tenant_id=tenant AND id=resource FOR UPDATE;
    IF NOT FOUND OR obj.deleted OR
      (operation='object_get' AND (obj.version IS NULL OR NOT core.resource_readable(obj.owner_app_id,'object',resource))) OR
      (operation<>'object_get' AND obj.owner_app_id<>actor) THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF operation='object_commit' THEN
      UPDATE app_private.resource_objects SET version=(payload->>'version')::uuid WHERE tenant_id=tenant AND id=resource;
    ELSIF operation='object_delete' THEN
      UPDATE app_private.resource_objects SET deleted=true WHERE tenant_id=tenant AND id=resource;
    ELSIF operation NOT IN ('object_prepare','object_get') THEN RETURN jsonb_build_object('status',400,'error','invalid_operation'); END IF;
    RETURN jsonb_build_object('status',200,'value',jsonb_build_object('ownerAppId',obj.owner_app_id,'version',obj.version));
  ELSIF operation='share_create' THEN
    resource:=(payload->>'resourceId')::uuid; target:=(payload->>'granteeAppId')::uuid;
    IF payload->>'action'<>'read' OR target=actor OR NOT app_private.resource_app_active(target) THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF payload->>'resourceType'='record' THEN
      PERFORM 1 FROM core.app_records WHERE tenant_id=tenant AND id=resource AND owner_app_id=actor FOR UPDATE;
    ELSIF payload->>'resourceType'='object' THEN
      PERFORM 1 FROM app_private.resource_objects WHERE tenant_id=tenant AND id=resource AND owner_app_id=actor AND NOT deleted AND version IS NOT NULL FOR UPDATE;
    ELSE RETURN jsonb_build_object('status',400,'error','invalid_resource_type'); END IF;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    expiry:=(payload->>'expiresAt')::timestamptz;
    IF expiry<=now() OR expiry>now()+interval '24 hours' THEN RETURN jsonb_build_object('status',400,'error','invalid_share_expiry'); END IF;
    INSERT INTO app_private.resource_shares(tenant_id,owner_app_id,grantee_app_id,resource_type,resource_id,action,expires_at)
      VALUES(tenant,actor,target,payload->>'resourceType',resource,'read',expiry) RETURNING * INTO share;
  ELSIF operation='share_revoke' THEN
    SELECT * INTO share FROM app_private.resource_shares WHERE tenant_id=tenant AND share_id=(payload->>'shareId')::uuid AND owner_app_id=actor FOR UPDATE;
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    IF share.revoked THEN RETURN jsonb_build_object('status',204,'value',NULL); END IF;
    UPDATE app_private.resource_shares SET revoked=true WHERE tenant_id=tenant AND share_id=share.share_id;
  ELSE RETURN jsonb_build_object('status',400,'error','invalid_operation'); END IF;
  INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,resource_id,revision)
    VALUES(tenant,c->>'iss',c->>'sub',c->>'client_id',CASE operation WHEN 'share_create' THEN 'resource.share_created' ELSE 'resource.share_revoked' END,share.share_id,CASE operation WHEN 'share_create' THEN 1 ELSE 2 END);
  RETURN jsonb_build_object('status',CASE operation WHEN 'share_create' THEN 201 ELSE 204 END,
    'value',jsonb_build_object('shareId',share.share_id,'resourceType',share.resource_type,'resourceId',share.resource_id,'granteeAppId',share.grantee_app_id,'action',share.action,'expiresAt',share.expires_at));
END $$;
REVOKE ALL ON FUNCTION core.resource_actor(),core.resource_writer(),core.resource_readable(uuid,text,uuid),core.resource_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.resource_actor(),core.resource_writer(),core.resource_readable(uuid,text,uuid),core.resource_command(text,jsonb) TO rosetta_resource_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA app_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(4) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
