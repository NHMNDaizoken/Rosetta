-- SPDX-FileCopyrightText: 2026 Rosetta Contributors
-- SPDX-License-Identifier: Apache-2.0
-- PostgreSQL LEAST ignores NULL. A failed reservation with no ticket must keep
-- both ticket columns NULL; do not modify the already applied migration 010.
BEGIN;
DO $migration$
DECLARE definition text:=pg_get_functiondef('core.execution_command(text,jsonb)'::regprocedure);
  anchor text:='ticket_expires_at=CASE WHEN next_state=''auth_required'' THEN ticket_expires_at ELSE least(ticket_expires_at,clock_timestamp()) END,';
BEGIN
  IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN
    RAISE EXCEPTION 'Unexpected execution authority; inspect installed definition before migration 011';
  END IF;
  definition:=replace(definition,anchor,
    'ticket_expires_at=CASE WHEN ticket_expires_at IS NULL OR next_state=''auth_required'' THEN ticket_expires_at ELSE least(ticket_expires_at,clock_timestamp()) END,');
  EXECUTE definition;
END $migration$;
INSERT INTO core.schema_migrations(version) VALUES(11);
NOTIFY pgrst,'reload schema';
COMMIT;
