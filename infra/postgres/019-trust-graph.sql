-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
-- Read-only trust graph: which application may use which capability of which
-- other application, in what state and until when. Visibility follows the
-- existing grant lookup rule in core.trust_command: an administrator
-- (trust.approve) sees every grant of the tenant, a writer (trust.write) only
-- grants whose provider application it owns. Nothing here changes state.
GRANT CREATE ON SCHEMA core TO junctura_app_owner;
SET LOCAL ROLE junctura_app_owner;

CREATE OR REPLACE FUNCTION core.trust_graph(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  c jsonb; tenant text; who text; iss text; client text;
  perms text[]; administrator boolean; edges jsonb; nodes jsonb; total integer;
  max_edges constant integer := 500;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR payload<>'{}'::jsonb THEN
    RETURN jsonb_build_object('status',400,'error','invalid_trust_graph_request');
  END IF;
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN
    RETURN jsonb_build_object('status',403,'error','trust_permission_required');
  END IF;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss'; client:=c->>'client_id';
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR
     coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','trust_permission_required');
  END IF;
  SELECT p.permissions INTO perms FROM app_private.principals p
    WHERE p.tenant_id=tenant AND p.issuer=iss AND p.subject=who AND p.management_client=client AND p.enabled;
  IF perms IS NULL OR NOT (perms && ARRAY['trust.write','trust.approve']::text[]) THEN
    RETURN jsonb_build_object('status',403,'error','trust_permission_required');
  END IF;
  administrator:='trust.approve'=ANY(perms);

  WITH visible AS (
    SELECT g.* FROM trust_private.grants g
      JOIN app_private.applications p ON p.tenant_id=g.tenant_id AND p.app_id=g.provider_app_id AND p.issuer=g.issuer
      WHERE g.tenant_id=tenant AND g.issuer=iss AND (administrator OR p.owner_subject=who)
  ), limited AS (
    SELECT * FROM visible ORDER BY created_at DESC, grant_id LIMIT max_edges
  )
  SELECT (SELECT count(*) FROM visible),
    coalesce(jsonb_agg(jsonb_build_object(
      'grantId',l.grant_id,'providerAppId',l.provider_app_id,'consumerAppId',l.consumer_app_id,
      'capabilityId',l.capability_id,'version',l.version,
      'title',(SELECT v.manifest->>'title' FROM app_private.capability_versions v
                WHERE v.tenant_id=l.tenant_id AND v.version_id=l.version_id),
      'operations',l.proposal->'operations','revision',l.revision,
      'state',CASE WHEN l.state<>'revoked' AND l.expires_at<=statement_timestamp() THEN 'expired' ELSE l.state END,
      'createdAt',l.created_at,'activatedAt',l.activated_at,'revokedAt',l.revoked_at,'expiresAt',l.expires_at)
      ORDER BY l.created_at DESC, l.grant_id),'[]'::jsonb)
    INTO total, edges FROM limited l;

  -- Nodes: applications on a visible edge, plus every tenant application for an
  -- administrator (or the caller's own applications) so isolated apps still show.
  SELECT coalesce(jsonb_agg(jsonb_build_object('appId',a.app_id,'displayName',a.display_name,'state',a.state,
      'owned',a.owner_subject=who) ORDER BY a.display_name, a.app_id),'[]'::jsonb) INTO nodes
    FROM app_private.applications a
    WHERE a.tenant_id=tenant AND a.issuer=iss AND (
      administrator OR a.owner_subject=who OR
      a.app_id IN (SELECT (e->>'providerAppId')::uuid FROM jsonb_array_elements(edges) e
                   UNION SELECT (e->>'consumerAppId')::uuid FROM jsonb_array_elements(edges) e));

  RETURN jsonb_build_object('status',200,'value',jsonb_build_object(
    'scope',CASE WHEN administrator THEN 'tenant' ELSE 'owned' END,
    'nodes',nodes,'edges',edges,'truncated',total>max_edges,
    'generatedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
END $$;

RESET ROLE;
ALTER FUNCTION core.trust_graph(jsonb) OWNER TO junctura_app_owner;
REVOKE ALL ON FUNCTION core.trust_graph(jsonb) FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api,junctura_audit_api;
GRANT EXECUTE ON FUNCTION core.trust_graph(jsonb) TO junctura_trust_api;
REVOKE CREATE ON SCHEMA core FROM junctura_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(19);
NOTIFY pgrst,'reload schema';
COMMIT;
