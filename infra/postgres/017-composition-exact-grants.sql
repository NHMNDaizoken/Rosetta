-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
-- A replacement grant must never substitute for an execution's reserved grant.
BEGIN;
SET LOCAL ROLE rosetta_app_owner;
CREATE OR REPLACE FUNCTION composition_private.live(e composition_private.executions) RETURNS boolean
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE
  original text:=current_setting('request.jwt.claims',true);
  claims jsonb:=jsonb_build_object('tenant_id',e.tenant_id,'iss',e.issuer,
    'sub',e.initiating_subject,'client_id',e.initiating_client,'trust_writer',true);
  decision jsonb; step composition_private.execution_steps;
BEGIN
  PERFORM set_config('request.jwt.claims',claims::text,true);
  decision:=composition_private.resolve_plan(jsonb_build_object('compositionId',e.composition_id,
    'version',(SELECT version FROM composition_private.composition_versions WHERE tenant_id=e.tenant_id AND version_id=e.version_id),
    'compositionDigest',e.composition_digest));
  IF decision->>'status'<>'200' OR decision->'value'->>'consumerAppId' IS DISTINCT FROM e.consumer_app_id::text
    OR e.authority_expires_at<=clock_timestamp() THEN
    PERFORM set_config('request.jwt.claims',original,true);
    RETURN false;
  END IF;
  FOR step IN SELECT * FROM composition_private.execution_steps
    WHERE tenant_id=e.tenant_id AND execution_id=e.execution_id ORDER BY step_index FOR SHARE LOOP
    PERFORM set_config('request.jwt.claims',(claims||jsonb_build_object('c4a_grant_id',step.grant_id))::text,true);
    decision:=execution_private.resolve_reference(jsonb_build_object('capabilityId',step.capability_id,
      'version',step.version,'manifestDigest',step.manifest_digest));
    IF decision->>'status'<>'200' OR decision->'value'->>'grantId' IS DISTINCT FROM step.grant_id::text
      OR decision->'value'->>'providerAppId' IS DISTINCT FROM step.provider_app_id::text THEN
      PERFORM set_config('request.jwt.claims',original,true);
      RETURN false;
    END IF;
  END LOOP;
  PERFORM set_config('request.jwt.claims',original,true);
  RETURN true;
EXCEPTION WHEN others THEN
  PERFORM set_config('request.jwt.claims',original,true);
  RAISE;
END $$;
RESET ROLE;
INSERT INTO core.schema_migrations(version) VALUES(17);
NOTIFY pgrst,'reload schema';
COMMIT;
