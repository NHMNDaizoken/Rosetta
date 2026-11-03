-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Correct timestamp binding and enforce current publication/owner authority.
BEGIN;
GRANT CREATE ON SCHEMA core TO junctura_app_owner;
SET LOCAL ROLE junctura_app_owner;
DO $fix$
DECLARE source text;
BEGIN
  source:=pg_get_functiondef('core.composition_execution_command(text,jsonb)'::regprocedure);
  IF position('engine_business_key,result_expires_at)' IN source)=0 THEN RAISE EXCEPTION 'Unexpected composition reservation'; END IF;
  source:=replace(source,'engine_business_key,result_expires_at)','engine_business_key,created_at,result_expires_at)');
  source:=replace(source,'stamp+interval ''24 hours'') RETURNING * INTO e','stamp,stamp+interval ''24 hours'') RETURNING * INTO e');
  EXECUTE source;
  source:=pg_get_functiondef('composition_private.resolve_plan(jsonb)'::regprocedure);
  source:=replace(source,'IF NOT FOUND THEN RETURN', 'IF NOT FOUND OR v.owner_app_id IS DISTINCT FROM core.resource_actor() THEN RETURN');
  EXECUTE source;
  source:=pg_get_functiondef('core.composition_command(text,jsonb)'::regprocedure);
  source:=replace(source,'OR ap.version_revision<>v.revision THEN',
    'OR ap.version_revision<>v.revision OR NOT EXISTS(SELECT FROM app_private.principals WHERE tenant_id=tenant AND issuer=iss AND subject=ap.approver_subject AND management_client=ap.management_client AND enabled AND ''compositions.approve''=ANY(permissions)) THEN');
  EXECUTE source;
END $fix$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM junctura_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(15);
NOTIFY pgrst,'reload schema';
COMMIT;
