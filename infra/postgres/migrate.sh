#!/bin/sh
# SPDX-FileCopyrightText: 2026 Rosetta Contributors
# SPDX-License-Identifier: Apache-2.0
set -eu
# Applied migrations are immutable. This runner records the SHA-256 of every
# migration in the same PostgreSQL transaction that applies it, refuses content
# changes and version-only history, and detects drift in installed definitions,
# owners, ACLs, row-level security and policies before applying anything new.
MIGRATION_DIR=${MIGRATION_DIR:-/migrations}
LOCK_FILE=${MIGRATION_LOCK_FILE:-/tmp/rosetta-migrations.lock}

fail() { printf 'Migration refused: %s\n' "$1" >&2; exit 1; }

command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v flock >/dev/null 2>&1 || fail "flock is required to serialize migration runners"
exec 9>"$LOCK_FILE"
flock -x 9

# Cross-container serialization: flock only covers one filesystem namespace, so
# hold a PostgreSQL advisory lock for the whole run. A short-lived psql session
# owns the lock and exits when the FIFO below is closed.
lock_dir=$(mktemp -d)
lock_fifo="$lock_dir/fifo"
mkfifo "$lock_fifo"
(
  printf 'SELECT pg_advisory_lock(918273645798);\n\\echo lock-acquired\n'
  cat "$lock_fifo"
) | psql -X -q -At -v ON_ERROR_STOP=1 "$@" >"$lock_dir/ready" 2>/dev/null &
lock_pid=$!
attempts=0
until grep -q lock-acquired "$lock_dir/ready" 2>/dev/null; do
  attempts=$((attempts + 1))
  if ! kill -0 "$lock_pid" 2>/dev/null; then
    fail "database migration lock session exited before acquiring the lock"
  fi
  [ "$attempts" -lt 1200 ] || fail "could not acquire the database migration lock within 120 seconds"
  sleep 0.1
done
release_lock() {
  { exec 8>"$lock_fifo"; } 2>/dev/null || true
  exec 8>&- 2>/dev/null || true
  wait "$lock_pid" 2>/dev/null || true
  rm -rf "$lock_dir"
}
trap release_lock EXIT

sql() { psql -X -q -At -v ON_ERROR_STOP=1 "$@"; }

sql "$@" <<'SQL'
CREATE SCHEMA IF NOT EXISTS core;
CREATE TABLE IF NOT EXISTS core.schema_migration_checksums (
  version integer PRIMARY KEY,
  filename text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  adopted boolean NOT NULL DEFAULT false,
  applied_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS core.schema_migration_state (
  id smallint PRIMARY KEY CHECK (id = 1),
  fingerprint text NOT NULL,
  last_version integer NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
SQL

schema_fingerprint() {
  psql -X -q -At -v ON_ERROR_STOP=1 "$@" <<'SQL'
WITH objects AS (
  SELECT 'schema' AS kind, n.nspname AS name, NULL::text AS hash,
         pg_get_userbyid(n.nspowner) AS owner,
         coalesce(array_to_string(n.nspacl, ','), '') AS acl
  FROM pg_namespace n
  WHERE n.nspname IN ('core', 'app_private', 'trust_private', 'execution_private')
  UNION ALL
  SELECT 'function', n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         encode(sha256(convert_to(pg_get_functiondef(p.oid), 'UTF8')), 'hex'),
         pg_get_userbyid(p.proowner),
         coalesce(array_to_string(p.proacl, ','), '')
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('core', 'app_private', 'trust_private', 'execution_private') AND p.prokind = 'f'
  UNION ALL
  SELECT 'relation', n.nspname || '.' || c.relname, NULL::text,
         pg_get_userbyid(c.relowner),
         coalesce(array_to_string(c.relacl, ','), '') || '|rls=' || c.relrowsecurity || '|force=' || c.relforcerowsecurity
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core', 'app_private', 'trust_private', 'execution_private')
    AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
  UNION ALL
  SELECT 'column', n.nspname || '.' || c.relname || '.' || a.attname, NULL::text, NULL::text,
         array_to_string(a.attacl, ',')
  FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core', 'app_private', 'trust_private', 'execution_private')
    AND a.attacl IS NOT NULL AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'policy', n.nspname || '.' || c.relname || '.' || p.polname,
         encode(sha256(convert_to(
           coalesce(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
           coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || '|' || p.polcmd::text || '|' ||
           p.polpermissive || '|' ||
           coalesce((SELECT string_agg(r.rolname, ',' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY(p.polroles)), '')
         , 'UTF8')), 'hex'),
         NULL::text, ''
  FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname IN ('core', 'app_private', 'trust_private', 'execution_private')
)
SELECT encode(sha256(convert_to(coalesce(string_agg(
  kind || ':' || name || ':' || coalesce(hash, '') || ':' || coalesce(owner, '') || ':' || coalesce(acl, ''),
  E'\n' ORDER BY kind, name), '') , 'UTF8')), 'hex')
FROM objects;
SQL
}

table_exists() {
  target=$1
  shift
  [ "$(sql "$@" -c "SELECT to_regclass('$target') IS NOT NULL" | tr -d '[:space:]')" = t ]
}

latest_local=0
for migration in "$MIGRATION_DIR"/[0-9][0-9][0-9]-*.sql; do
  [ -f "$migration" ] || continue
  latest_local=${migration##*/}
done
latest_local=${latest_local%%-*}
latest_local=$(printf '%s' "$latest_local" | sed 's/^0*//')
[ -n "$latest_local" ] || latest_local=0

stored_fingerprint=
if table_exists core.schema_migration_state "$@"; then
  stored_fingerprint=$(sql "$@" -c "SELECT fingerprint FROM core.schema_migration_state WHERE id = 1")
fi
current_fingerprint=$(schema_fingerprint "$@")
if [ -n "$stored_fingerprint" ] && [ "$stored_fingerprint" != "$current_fingerprint" ]; then
  if [ "${MIGRATION_ADOPT_SCHEMA_DRIFT:-0}" = 1 ]; then
    printf 'Adopting reviewed installed-schema drift as the new baseline\n' >&2
  else
    fail "installed schema drift detected (definitions, owners, ACLs, RLS or policies changed). Review the difference, restore the expected schema, or set MIGRATION_ADOPT_SCHEMA_DRIFT=1 after operator review. See docs/MIGRATIONS.md."
  fi
fi

installed_version=0
if table_exists core.schema_migrations "$@"; then
  installed_version=$(sql "$@" -c "SELECT coalesce(max(version), 0) FROM core.schema_migrations" | tr -d '[:space:]')
  installed_version=${installed_version:-0}
fi
if [ "$installed_version" -gt "$latest_local" ]; then
  fail "database schema is newer than this migration set; use a matching runner instead of replaying older authority SQL"
fi

for migration in "$MIGRATION_DIR"/[0-9][0-9][0-9]-*.sql; do
  [ -f "$migration" ] || continue
  name=${migration##*/}
  version=${name%%-*}
  version=$(printf '%s' "$version" | sed 's/^0*//')
  [ -n "$version" ] || version=0
  checksum=$(sha256sum "$migration" | cut -d' ' -f1)
  recorded=
  if table_exists core.schema_migration_checksums "$@"; then
    recorded=$(sql "$@" -c "SELECT sha256 FROM core.schema_migration_checksums WHERE version = $version")
  fi
  applied=f
  if table_exists core.schema_migrations "$@"; then
    applied=$(sql "$@" -c "SELECT EXISTS(SELECT FROM core.schema_migrations WHERE version = $version)")
  fi
  if [ -n "$recorded" ] && [ "$recorded" != "$checksum" ]; then
    fail "applied migration $name content differs from its recorded checksum ($recorded). Applied migrations are immutable; restore the original file instead of editing history."
  fi
  if [ "$applied" = t ]; then
    if [ -n "$recorded" ]; then
      printf 'Migration %s verified\n' "$version"
    elif [ "${MIGRATION_ADOPT_EXISTING:-0}" = 1 ]; then
      sql "$@" -c "INSERT INTO core.schema_migration_checksums(version, filename, sha256, adopted) VALUES ($version, '$name', '$checksum', true)"
      printf 'Migration %s adopted after operator review\n' "$version"
    else
      fail "migration $version is recorded as applied without a checksum. This is version-only history; verify the installed schema, then rerun with MIGRATION_ADOPT_EXISTING=1. See docs/MIGRATIONS.md."
    fi
  else
    if [ -n "$recorded" ]; then
      fail "checksum for migration $version exists but the version is not applied; refusing to guess which side is authoritative"
    fi
    printf 'Applying migration %s\n' "$version"
    {
      sed -e '/^BEGIN;$/d' -e '/^COMMIT;$/d' "$migration"
      printf "\nINSERT INTO core.schema_migration_checksums(version, filename, sha256) VALUES (%s, '%s', '%s');\n" "$version" "$name" "$checksum"
    } | psql -X -q -v ON_ERROR_STOP=1 --single-transaction "$@" -f -
  fi
done

final_fingerprint=$(schema_fingerprint "$@")
sql "$@" -c "INSERT INTO core.schema_migration_state(id, fingerprint, last_version, recorded_at)
  VALUES (1, '$final_fingerprint', $latest_local, now())
  ON CONFLICT (id) DO UPDATE SET fingerprint = EXCLUDED.fingerprint, last_version = EXCLUDED.last_version, recorded_at = now()"
printf 'Migrations current at version %s\n' "$latest_local"
release_lock
trap - EXIT
