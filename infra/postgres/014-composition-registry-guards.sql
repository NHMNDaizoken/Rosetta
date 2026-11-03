-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
-- Follow-up corrections discovered by real HTTP execution; 012/013 stay immutable.
BEGIN;
GRANT CREATE ON SCHEMA core TO junctura_app_owner;
SET LOCAL ROLE junctura_app_owner;
DO $fix$
DECLARE source text:=pg_get_functiondef('core.composition_command(text,jsonb)'::regprocedure);
BEGIN
  IF position('AND digest=payload' IN source)=0 THEN RAISE EXCEPTION 'Unexpected composition authority'; END IF;
  source:=replace(source,'AND digest=payload','AND composition_versions.digest=payload');
  source:=replace(source,
    'IF actor IS NULL AND app.owner_subject<>who AND NOT publisher THEN RETURN jsonb_build_object(''status'',404,''error'',''not_found''); END IF;',
    'IF NOT publisher AND ((actor IS NULL AND app.owner_subject<>who) OR (actor IS NOT NULL AND actor<>v.owner_app_id)) THEN RETURN jsonb_build_object(''status'',404,''error'',''not_found''); END IF;');
  EXECUTE source;
END $fix$;
RESET ROLE;
REVOKE CREATE ON SCHEMA core FROM junctura_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(14);
NOTIFY pgrst,'reload schema';
COMMIT;
