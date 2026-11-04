-- SPDX-FileCopyrightText: 2026 Junctura Contributors
-- SPDX-License-Identifier: Apache-2.0
BEGIN;
-- Tamper-evident audit: every tenant's audit events are sealed into a SHA-256
-- hash chain. Sealing happens on verification, so the existing transactional
-- append path, its locks and its failure semantics are unchanged. Each sealed
-- entry commits to its content and to the previous entry's hash; a per-tenant
-- head records the latest seal so removing the newest entries is also visible.
-- The database administrator remains trusted (see docs/AUDIT.md): the chain
-- makes later modification, deletion or reordering of sealed events evident.
GRANT CREATE ON SCHEMA core TO junctura_app_owner;
SET LOCAL ROLE junctura_app_owner;

ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS chain_seq bigint;
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS prev_hash text;
ALTER TABLE app_private.audit ADD COLUMN IF NOT EXISTS entry_hash text;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_constraint WHERE conname='audit_chain_shape_check') THEN
    ALTER TABLE app_private.audit ADD CONSTRAINT audit_chain_shape_check CHECK (
      (chain_seq IS NULL AND prev_hash IS NULL AND entry_hash IS NULL) OR
      (chain_seq>=1 AND prev_hash ~ '^[0-9a-f]{64}$' AND entry_hash ~ '^[0-9a-f]{64}$'));
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS audit_chain_seq_idx
  ON app_private.audit (tenant_id,chain_seq) WHERE chain_seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS audit_unsealed_idx
  ON app_private.audit (tenant_id,occurred_at,event_id) WHERE chain_seq IS NULL;

CREATE TABLE IF NOT EXISTS app_private.audit_chain_heads (
  tenant_id text PRIMARY KEY CHECK (tenant_id ~ '^[a-z][a-z0-9-]{0,62}$'),
  last_seq bigint NOT NULL CHECK (last_seq>=1),
  last_hash text NOT NULL CHECK (last_hash ~ '^[0-9a-f]{64}$'),
  sealed_at timestamptz NOT NULL
);
ALTER TABLE app_private.audit_chain_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_private.audit_chain_heads FORCE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_policies WHERE schemaname='app_private' AND tablename='audit_chain_heads' AND policyname='tenant_isolation') THEN
    CREATE POLICY tenant_isolation ON app_private.audit_chain_heads TO junctura_app_owner
      USING (tenant_id = (current_setting('request.jwt.claims',true)::jsonb ->> 'tenant_id'))
      WITH CHECK (tenant_id = (current_setting('request.jwt.claims',true)::jsonb ->> 'tenant_id'));
  END IF;
END $$;

-- Canonical entry hash. Every stored field except the hash itself is covered;
-- the timestamp is encoded as integer microseconds so the session time zone and
-- output format cannot change the digest.
CREATE OR REPLACE FUNCTION app_private.audit_entry_hash(a app_private.audit, p_seq bigint, p_prev text)
RETURNS text LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    'junctura-audit/1', p_seq, p_prev, a.tenant_id, a.event_id::text,
    (extract(epoch FROM a.occurred_at)*1000000)::bigint, a.issuer, a.subject,
    a.management_client, a.event, a.resource_type, a.resource_id::text, a.revision,
    a.outcome, a.reason_code, a.reason, a.actor_app_id::text, a.schema_version)::text, 'UTF8')), 'hex')
$$;

-- Seals pending events, then recomputes the whole tenant chain. Same caller
-- contract as core.audit_query: trusted Core asserts junctura_audit_api, and the
-- verified management principal must hold audit.read in its own tenant.
CREATE OR REPLACE FUNCTION core.audit_verify(payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,app_private AS $$
DECLARE
  c jsonb; tenant text; who text; iss text; client text;
  genesis constant text := repeat('0',64);
  r record; head record; prev text; seq bigint; sealed integer:=0;
  broken jsonb; recorded_hash text;
BEGIN
  IF payload IS NULL OR jsonb_typeof(payload)<>'object' OR payload<>'{}'::jsonb THEN
    RETURN jsonb_build_object('status',400,'error','invalid_audit_verification');
  END IF;
  BEGIN c:=current_setting('request.jwt.claims',true)::jsonb;
  EXCEPTION WHEN others THEN c:=NULL; END;
  IF c IS NULL OR jsonb_typeof(c)<>'object' THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;
  tenant:=c->>'tenant_id'; who:=c->>'sub'; iss:=c->>'iss'; client:=c->>'client_id';
  IF tenant IS NULL OR tenant !~ '^[a-z][a-z0-9-]{0,62}$' OR coalesce(who,'')='' OR
     coalesce(iss,'')='' OR coalesce(client,'')='' THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;
  PERFORM 1 FROM app_private.principals p
    WHERE p.tenant_id=tenant AND p.issuer=iss AND p.subject=who
      AND p.management_client=client AND p.enabled
      AND p.permissions @> ARRAY['audit.read']::text[];
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status',403,'error','audit_permission_required');
  END IF;

  -- One sealer per tenant at a time; ordinary audit appends never take this lock.
  PERFORM pg_advisory_xact_lock(hashtextextended('junctura.audit_chain:' || tenant, 0));

  -- 1. Verify everything already sealed, in chain order.
  prev:=genesis; seq:=0;
  FOR r IN SELECT a AS entry, a.chain_seq, a.prev_hash, a.entry_hash AS stored, a.event_id
      FROM app_private.audit a
      WHERE a.tenant_id=tenant AND a.chain_seq IS NOT NULL ORDER BY a.chain_seq LOOP
    IF r.chain_seq<>seq+1 THEN
      broken:=jsonb_build_object('chainSeq',seq+1,'eventId',NULL,'reason','missing_entry'); EXIT;
    END IF;
    IF r.prev_hash<>prev THEN
      broken:=jsonb_build_object('chainSeq',r.chain_seq,'eventId',r.event_id,'reason','chain_link_mismatch'); EXIT;
    END IF;
    IF app_private.audit_entry_hash(r.entry, r.chain_seq, r.prev_hash)<>r.stored THEN
      broken:=jsonb_build_object('chainSeq',r.chain_seq,'eventId',r.event_id,'reason','content_modified'); EXIT;
    END IF;
    seq:=r.chain_seq; prev:=r.stored;
  END LOOP;
  SELECT * INTO head FROM app_private.audit_chain_heads h WHERE h.tenant_id=tenant;
  IF broken IS NULL AND head.tenant_id IS NOT NULL AND (head.last_seq<>seq OR head.last_hash<>prev) THEN
    broken:=jsonb_build_object('chainSeq',head.last_seq,'eventId',NULL,
      'reason',CASE WHEN head.last_seq>seq THEN 'missing_entry' ELSE 'head_mismatch' END);
  END IF;
  IF broken IS NULL AND head.tenant_id IS NULL AND seq>0 THEN
    broken:=jsonb_build_object('chainSeq',seq,'eventId',NULL,'reason','head_mismatch');
  END IF;

  -- 2. Seal pending events only on an intact chain, so a break is never hidden
  --    behind newer seals.
  IF broken IS NULL THEN
    FOR r IN SELECT a.tenant_id, a.event_id FROM app_private.audit a
        WHERE a.tenant_id=tenant AND a.chain_seq IS NULL ORDER BY a.occurred_at, a.event_id LOOP
      seq:=seq+1;
      UPDATE app_private.audit a SET chain_seq=seq, prev_hash=prev,
          entry_hash=app_private.audit_entry_hash(a, seq, prev)
        WHERE a.tenant_id=r.tenant_id AND a.event_id=r.event_id
        RETURNING a.entry_hash INTO recorded_hash;
      prev:=recorded_hash; sealed:=sealed+1;
    END LOOP;
    IF sealed>0 THEN
      INSERT INTO app_private.audit_chain_heads(tenant_id,last_seq,last_hash,sealed_at)
        VALUES(tenant,seq,prev,clock_timestamp())
        ON CONFLICT (tenant_id) DO UPDATE SET last_seq=EXCLUDED.last_seq,
          last_hash=EXCLUDED.last_hash, sealed_at=EXCLUDED.sealed_at;
    END IF;
  END IF;

  RETURN jsonb_build_object('status',200,'value',jsonb_build_object(
    'verified', broken IS NULL,
    'entries', seq,
    'newlySealed', sealed,
    'headHash', CASE WHEN broken IS NULL AND seq>0 THEN 'sha256:' || prev ELSE NULL END,
    'firstBreak', broken,
    'verifiedAt', to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
END $$;

RESET ROLE;
ALTER FUNCTION app_private.audit_entry_hash(app_private.audit,bigint,text) OWNER TO junctura_app_owner;
ALTER FUNCTION core.audit_verify(jsonb) OWNER TO junctura_app_owner;
REVOKE ALL ON app_private.audit_chain_heads FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api,junctura_audit_api;
REVOKE ALL ON FUNCTION app_private.audit_entry_hash(app_private.audit,bigint,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION core.audit_verify(jsonb) FROM PUBLIC,junctura_api,junctura_app_api,junctura_resource_api;
GRANT EXECUTE ON FUNCTION core.audit_verify(jsonb) TO junctura_audit_api;
REVOKE CREATE ON SCHEMA core FROM junctura_app_owner;
INSERT INTO core.schema_migrations(version) VALUES(18);
NOTIFY pgrst,'reload schema';
COMMIT;
