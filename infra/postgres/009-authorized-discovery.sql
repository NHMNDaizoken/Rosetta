-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;

-- One live predicate for discovery and future invocation eligibility. Never
-- combine partial permissions from different grants or cache this decision.
CREATE OR REPLACE FUNCTION trust_private.granted(v app_private.capability_versions,operation text) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT v.state='published' AND operation IN ('discover','invoke') AND EXISTS(
    SELECT FROM trust_private.grants g
    JOIN trust_private.approvals ap ON ap.tenant_id=g.tenant_id AND ap.approval_id=g.activation_approval_id AND ap.grant_id=g.grant_id
    JOIN app_private.principals approver ON approver.tenant_id=g.tenant_id AND approver.issuer=g.issuer
      AND approver.subject=ap.approver_subject AND approver.management_client=ap.management_client
    WHERE g.tenant_id=v.tenant_id AND g.tenant_id=current_setting('request.jwt.claims',true)::jsonb->>'tenant_id'
      AND g.issuer=current_setting('request.jwt.claims',true)::jsonb->>'iss'
      AND g.consumer_app_id=core.resource_actor() AND g.provider_app_id=v.provider_app_id
      AND g.version_id=v.version_id AND g.capability_id=v.capability_id AND g.version=v.version AND g.manifest_digest=v.digest
      AND g.state='active' AND g.expires_at>statement_timestamp()
      AND g.proposal->'delegationAllowed'='false'::jsonb AND g.proposal->'acceptDelegation'='false'::jsonb
      AND g.proposal->'capabilities'=jsonb_build_array(jsonb_build_object('capabilityId',v.capability_id,'version',v.version,'manifestDigest',v.digest))
      AND (g.proposal->'operations') ? operation
      AND (g.proposal->'subjectIds') ? (current_setting('request.jwt.claims',true)::jsonb->>'sub')
      AND (g.proposal->'permissions') @> (v.manifest->'requiredPermissions')
      AND ap.state='consumed' AND ap.approver_subject<>g.created_by
      AND ap.decision->>'resourceType'='grant' AND ap.decision->>'resourceId'=g.grant_id::text
      AND ap.decision->>'resourceDigest'=g.digest AND ap.decision->>'resourceRevision'=(g.revision-1)::text
      AND ap.decision->>'requesterSubject'=g.created_by AND ap.decision->>'requesterAppId'=g.provider_app_id::text
      AND ap.decision->>'decision'='approve' AND approver.enabled AND 'trust.approve'=ANY(approver.permissions)
      AND (operation='discover' OR current_setting('request.jwt.claims',true)::jsonb->'trust_writer'='true'::jsonb)
      AND trust_private.target_available(g))
$$;

CREATE OR REPLACE FUNCTION core.trust_eligibility(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE c jsonb:=current_setting('request.jwt.claims',true)::jsonb; v app_private.capability_versions;
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' THEN RETURN jsonb_build_object('allowed',false,'reason','invalid_reference'); END IF;
  IF EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('capabilityId','version','manifestDigest','operation'))
    OR coalesce(payload->>'operation','') NOT IN ('discover','invoke')
    OR coalesce(payload->>'capabilityId','') !~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'
    OR coalesce(payload->>'version','') !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$'
    OR coalesce(payload->>'manifestDigest','') !~ '^sha256:[0-9a-f]{64}$' THEN RETURN jsonb_build_object('allowed',false,'reason','invalid_reference'); END IF;
  IF coalesce(c->>'iss','')='' OR coalesce(c->>'sub','')='' OR coalesce(c->>'client_id','')='' THEN
    RETURN jsonb_build_object('allowed',false,'reason','principal_required');
  END IF;
  IF core.resource_actor() IS NULL THEN RETURN jsonb_build_object('allowed',false,'reason','consumer_binding_required'); END IF;
  SELECT * INTO v FROM app_private.capability_versions WHERE tenant_id=c->>'tenant_id'
    AND capability_id=payload->>'capabilityId' AND version=payload->>'version' AND digest=payload->>'manifestDigest' AND state='published';
  IF NOT FOUND THEN RETURN jsonb_build_object('allowed',false,'reason','capability_unavailable'); END IF;
  IF trust_private.granted(v,payload->>'operation') THEN RETURN jsonb_build_object('allowed',true,'reason','eligible'); END IF;
  RETURN jsonb_build_object('allowed',false,'reason','grant_not_authorized');
END $$;
REVOKE ALL ON FUNCTION core.trust_eligibility(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.trust_eligibility(jsonb) TO rosetta_trust_api;

CREATE OR REPLACE FUNCTION trust_private.capability_view(v app_private.capability_versions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object('versionId',v.version_id,'capabilityId',v.capability_id,'providerAppId',v.provider_app_id,
    'version',v.version,'manifest',v.manifest,'digest',v.digest,'state',v.state,'revision',v.revision,
    'updatedAt',v.updated_at,'publishedAt',v.published_at)
$$;
DO $$ BEGIN
  IF to_regprocedure('app_private.capability_management_command(text,jsonb)') IS NULL THEN
    ALTER FUNCTION core.capability_command(text,jsonb) RENAME TO capability_management_command;
    ALTER FUNCTION core.capability_management_command(text,jsonb) SET SCHEMA app_private;
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_private.capability_management_command(text,jsonb) FROM PUBLIC,rosetta_capability_api;

CREATE OR REPLACE FUNCTION core.capability_command(operation text,payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c jsonb:=current_setting('request.jwt.claims',true)::jsonb; perms text[];
  publisher boolean; management boolean; actor uuid; v app_private.capability_versions; owner_subject text;
  v_limit integer:=100; cursor_parts text[]; cursor_time timestamptz; cursor_id uuid; items jsonb; next_cursor text;
BEGIN
  IF operation NOT IN ('get','list') THEN RETURN app_private.capability_management_command(operation,payload); END IF;
  SELECT permissions INTO perms FROM app_private.principals WHERE tenant_id=c->>'tenant_id' AND issuer=c->>'iss'
    AND subject=c->>'sub' AND management_client=c->>'client_id' AND enabled;
  publisher:=coalesce('capabilities.publish'=ANY(perms),false);
  management:=publisher OR coalesce('capabilities.write'=ANY(perms),false);
  actor:=core.resource_actor();
  IF NOT management AND actor IS NULL THEN RETURN jsonb_build_object('status',403,'error','capability_permission_required'); END IF;
  IF operation='get' THEN
    IF coalesce(payload->>'capabilityId','') !~ '^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$'
      OR coalesce(payload->>'version','') !~ '^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$' THEN RETURN jsonb_build_object('status',400,'error','invalid_capability_reference'); END IF;
    SELECT cv.* INTO v FROM app_private.capability_versions cv JOIN app_private.applications a
      ON a.tenant_id=cv.tenant_id AND a.app_id=cv.provider_app_id AND a.issuer=c->>'iss'
      WHERE cv.tenant_id=c->>'tenant_id' AND cv.capability_id=payload->>'capabilityId' AND cv.version=payload->>'version';
    IF NOT FOUND THEN RETURN jsonb_build_object('status',404,'error','not_found'); END IF;
    SELECT a.owner_subject INTO owner_subject FROM app_private.applications a WHERE a.tenant_id=v.tenant_id AND a.app_id=v.provider_app_id;
    IF publisher OR (management AND owner_subject=c->>'sub') THEN RETURN jsonb_build_object('status',200,'value',app_private.capability_version_view(v)); END IF;
    IF trust_private.granted(v,'discover') THEN RETURN jsonb_build_object('status',200,'value',trust_private.capability_view(v)); END IF;
    RETURN jsonb_build_object('status',404,'error','not_found');
  END IF;
  BEGIN
    IF EXISTS(SELECT FROM jsonb_object_keys(payload) k WHERE k NOT IN ('limit','cursor')) THEN RAISE EXCEPTION 'invalid query'; END IF;
    IF payload ? 'limit' THEN
      IF jsonb_typeof(payload->'limit')<>'number' OR payload->>'limit' !~ '^[0-9]{1,3}$' THEN RAISE EXCEPTION 'invalid limit'; END IF;
      v_limit:=(payload->>'limit')::integer;
      IF v_limit<1 OR v_limit>100 THEN RAISE EXCEPTION 'invalid limit'; END IF;
    END IF;
    IF payload ? 'cursor' THEN
      cursor_parts:=string_to_array(convert_from(decode(payload->>'cursor','hex'),'UTF8'),'|');
      IF management THEN
        IF cardinality(cursor_parts)<>2 THEN RAISE EXCEPTION 'invalid cursor'; END IF;
        cursor_time:=cursor_parts[1]::timestamptz; cursor_id:=cursor_parts[2]::uuid;
      ELSE
        IF cardinality(cursor_parts)<>4 OR cursor_parts[1] IS DISTINCT FROM c->>'tenant_id' OR cursor_parts[2] IS DISTINCT FROM actor::text THEN RAISE EXCEPTION 'invalid cursor'; END IF;
        cursor_time:=cursor_parts[3]::timestamptz; cursor_id:=cursor_parts[4]::uuid;
      END IF;
    END IF;
  EXCEPTION WHEN others THEN RETURN jsonb_build_object('status',400,'error','invalid_capability_cursor'); END;
  SELECT coalesce(jsonb_agg(CASE WHEN publisher OR (management AND a.owner_subject=c->>'sub') THEN app_private.capability_version_view(a.cv)
      ELSE trust_private.capability_view(a.cv) END ORDER BY (a.cv).updated_at DESC,(a.cv).version_id DESC),'[]'::jsonb)
    INTO items FROM (
      SELECT cv,app.owner_subject FROM app_private.capability_versions cv JOIN app_private.applications app
        ON app.tenant_id=cv.tenant_id AND app.app_id=cv.provider_app_id AND app.issuer=c->>'iss'
      WHERE cv.tenant_id=c->>'tenant_id' AND (publisher OR (management AND app.owner_subject=c->>'sub') OR trust_private.granted(cv,'discover'))
        AND (cursor_time IS NULL OR (cv.updated_at,cv.version_id)<(cursor_time,cursor_id))
      ORDER BY cv.updated_at DESC,cv.version_id DESC LIMIT v_limit+1
    ) a;
  IF jsonb_array_length(items)>v_limit THEN
    next_cursor:=encode(convert_to(CASE WHEN management THEN '' ELSE (c->>'tenant_id')||'|'||actor::text||'|' END ||
      (items->(v_limit-1)->>'updatedAt')||'|'||(items->(v_limit-1)->>'versionId'),'UTF8'),'hex');
    items:=items-v_limit;
  END IF;
  RETURN jsonb_build_object('status',200,'value',jsonb_build_object('items',items,'nextCursor',next_cursor));
END $$;
REVOKE ALL ON FUNCTION core.capability_command(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION core.capability_command(text,jsonb) TO rosetta_capability_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA trust_private FROM PUBLIC;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(9) ON CONFLICT DO NOTHING;
NOTIFY pgrst,'reload schema';
COMMIT;
