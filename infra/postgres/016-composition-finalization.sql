-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Add exact result version and tighten registry lifecycle authority. Version 16
-- also opts the migration runner into fingerprinting composition_private.
BEGIN;
GRANT CREATE ON SCHEMA core TO rosetta_app_owner;
SET LOCAL ROLE rosetta_app_owner;
DO $fix$
DECLARE source text;
BEGIN
  source:=pg_get_functiondef('composition_private.view(composition_private.executions)'::regprocedure);
  IF position('''compositionDigest'',e.composition_digest)' IN source)=0 THEN RAISE EXCEPTION 'Unexpected execution view'; END IF;
  source:=replace(source,'''compositionDigest'',e.composition_digest)',
    '''compositionDigest'',e.composition_digest,''version'',(SELECT version FROM composition_private.composition_versions WHERE tenant_id=e.tenant_id AND version_id=e.version_id))');
  EXECUTE source;
  source:=pg_get_functiondef('core.composition_command(text,jsonb)'::regprocedure);
  source:=replace(source,'IF owner.owner_app_id<>app.app_id AND NOT publisher THEN','IF owner.owner_app_id<>app.app_id THEN');
  source:=replace(source,'    IF operation=''get'' THEN RETURN',
    '    IF operation IN (''update'',''validate'',''deprecate'',''revoke'') AND NOT writer THEN RETURN jsonb_build_object(''status'',403,''error'',''composition_permission_required''); END IF;
    IF operation=''get'' THEN RETURN');
  source:=replace(source,'      SELECT * INTO ap FROM composition_private.composition_publication_approvals',
    '      IF composition_private.resolve_schemas(v.composition)->>''status''<>''200'' THEN RETURN jsonb_build_object(''status'',409,''error'',''step_capability_unavailable''); END IF;
      SELECT * INTO ap FROM composition_private.composition_publication_approvals');
  EXECUTE source;
END $fix$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM rosetta_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(16);
NOTIFY pgrst,'reload schema';
COMMIT;
