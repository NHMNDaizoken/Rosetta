// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Read-only installed-schema diagnostic. Never applies or modifies migrations.
import { execFileSync } from "node:child_process";

const service = process.env.DATABASE_SERVICE ?? "database";
const user = process.env.DATABASE_USER ?? "rosetta_admin";
const database = process.env.DATABASE_NAME ?? "rosetta_data";
const psql = (text) => execFileSync("docker", ["compose", "exec", "-T", service, "psql", "-X", "-q", "-At",
  "-v", "ON_ERROR_STOP=1", "-U", user, "-d", database, "-c", text], { encoding: "utf8" }).trim();

const fingerprint = () => psql(`
WITH objects AS (
  SELECT 'schema' AS kind, n.nspname AS name, NULL::text AS hash, pg_get_userbyid(n.nspowner) AS owner,
         coalesce(array_to_string(n.nspacl, ','), '') AS acl
  FROM pg_namespace n WHERE n.nspname IN ('core','app_private','trust_private','execution_private')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
         pg_get_userbyid(p.proowner), coalesce(array_to_string(p.proacl, ','), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('core','app_private','trust_private','execution_private') AND p.prokind = 'f'
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname, NULL::text, pg_get_userbyid(c.relowner),
         coalesce(array_to_string(c.relacl, ','), '') || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core','app_private','trust_private','execution_private') AND c.relkind IN ('r','p','v','m','S')
  UNION ALL
  SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname, NULL::text, NULL::text,
         array_to_string(a.attacl, ',')
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core','app_private','trust_private','execution_private')
    AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
         encode(sha256(convert_to(
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || '|' || p.polcmd::text || '|' ||
           p.polpermissive || '|' ||
           coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(p.polroles)), '')
         , 'UTF8')), 'hex'), NULL::text, ''
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core','app_private','trust_private','execution_private')
)
SELECT encode(sha256(convert_to(coalesce(string_agg(
  kind || ':' || name || ':' || coalesce(hash, '') || ':' || coalesce(owner, '') || ':' || coalesce(acl, ''),
  E'\n' ORDER BY kind, name), ''), 'UTF8')), 'hex')
FROM objects;`);

const state = psql("SELECT to_regclass('core.schema_migration_state') IS NOT NULL");
if (state !== "t") {
  console.log("No recorded schema fingerprint (pre-checksum database). Run the migration runner first.");
  process.exitCode = 2;
} else {
  const expected = psql("SELECT fingerprint FROM core.schema_migration_state WHERE id = 1");
  const actual = fingerprint();
  if (expected === actual) {
    console.log(`schema matches the recorded fingerprint (${actual.slice(0, 16)}...)`);
  } else {
    console.log(`installed schema drift\nrecorded: ${expected}\ninstalled: ${actual}`);
    process.exitCode = 1;
  }
}
