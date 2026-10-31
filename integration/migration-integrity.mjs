// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Disposable PostgreSQL proof for the migration runner: checksums, drift,
// version-only adoption, interrupted transactions and concurrent runners.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const image = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8").match(/image: (postgres:[^\s]+)/)[1];
const name = `rosetta-migration-test-${randomUUID()}`;
const directory = mkdtempSync(join(tmpdir(), "rosetta-migrations-"));
const run = promisify(execFile);
const docker = (...args) => run("docker", args, { timeout: 120000, maxBuffer: 2097152 });
const sql = async (text) => (await docker("exec", name, "psql", "-X", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", text)).stdout.trim();
async function migrate(env = {}) {
  const args = ["exec"];
  for (const [key, value] of Object.entries(env)) args.push("-e", `${key}=${value}`);
  args.push(name, "sh", "/migrations/migrate.sh", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1");
  return run("docker", args, { timeout: 120000, maxBuffer: 2097152 });
}
async function refused(env = {}) {
  try { await migrate(env); } catch (error) { return String(error.stderr ?? error.message); }
  assert.fail("migration runner should have refused");
}

before(async () => {
  cpSync(resolve("infra/postgres"), directory, { recursive: true });
  await docker("run", "--detach", "--name", name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw",
    "-e", "POSTGRES_USER=rosetta_admin", "-e", "POSTGRES_DB=rosetta_data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--mount", `type=bind,source=${directory},target=/migrations,readonly`, image);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    try { await docker("exec", name, "psql", "-X", "-h", "127.0.0.1", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atqc", "SELECT 1"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "fresh disposable database ready");
  await sql("CREATE ROLE rosetta_data NOLOGIN NOINHERIT; ALTER DATABASE rosetta_data OWNER TO rosetta_data;");
});

after(async () => {
  await docker("rm", "--force", name).catch(() => {});
  rmSync(directory, { recursive: true, force: true });
});

test("fresh install records every checksum atomically", async () => {
  await migrate();
  assert.equal(await sql("SELECT max(version) FROM core.schema_migrations"), "11");
  assert.equal(await sql("SELECT count(*) FROM core.schema_migration_checksums WHERE length(sha256) = 64 AND NOT adopted"), "11");
  assert.equal(await sql("SELECT count(*) FROM core.schema_migration_checksums c JOIN core.schema_migrations m USING (version)"), "11");
  assert.equal(await sql("SELECT last_version FROM core.schema_migration_state WHERE id = 1"), "11");
});

test("repeat execution verifies without replaying", async () => {
  const { stdout } = await migrate();
  assert.match(stdout, /Migration 9 verified/);
  assert.doesNotMatch(stdout, /Applying migration/);
});

test("edited applied content fails closed", async () => {
  const file = join(directory, "001-data.sql");
  const original = readFileSync(file, "utf8");
  writeFileSync(file, `${original}\n-- edited history\n`);
  try {
    assert.match(await refused(), /content differs from its recorded checksum/);
  } finally { writeFileSync(file, original); }
  await migrate();
});

test("interrupted migration leaves neither its objects nor its checksum", async () => {
  const file = join(directory, "098-interrupted.sql");
  writeFileSync(file, "BEGIN;\nCREATE TABLE core.interrupted_probe(id int);\nDO $$ BEGIN RAISE EXCEPTION 'synthetic interruption'; END $$;\nINSERT INTO core.schema_migrations(version) VALUES (98);\nCOMMIT;\n");
  try {
    assert.match(await refused(), /synthetic interruption/);
  } finally { rmSync(file); }
  assert.equal(await sql("SELECT to_regclass('core.interrupted_probe') IS NULL"), "t");
  assert.equal(await sql("SELECT count(*) FROM core.schema_migration_checksums WHERE version = 98"), "0");
  assert.equal(await sql("SELECT count(*) FROM core.schema_migrations WHERE version = 98"), "0");
});

test("concurrent runners serialize and converge", async () => {
  const results = await Promise.all([migrate(), migrate()]);
  assert.equal(results.length, 2);
  assert.equal(await sql("SELECT count(*) FROM core.schema_migration_checksums"), "11");
  assert.equal(await sql("SELECT count(*) FROM core.schema_migrations"), "11");
});

test("version-only history requires explicit operator adoption", async () => {
  await sql("TRUNCATE core.schema_migration_checksums");
  assert.match(await refused(), /version-only history/);
  await migrate({ MIGRATION_ADOPT_EXISTING: 1 });
  assert.equal(await sql("SELECT count(*) FROM core.schema_migration_checksums WHERE adopted"), "11");
});

test("installed schema drift is detected and only adopted after review", async () => {
  await sql("ALTER POLICY tenant_isolation ON core.records USING (true)");
  assert.match(await refused(), /installed schema drift detected/);
  await migrate({ MIGRATION_ADOPT_SCHEMA_DRIFT: 1 });
  await migrate();
  assert.equal(await sql("SELECT last_version FROM core.schema_migration_state WHERE id = 1"), "11");
});

test("a database newer than the runner is refused", async () => {
  const subset = join(directory, "subset");
  mkdirSync(subset);
  try {
    for (const entry of readdirSync(directory).filter(entry => /^0(0[1-9]|10)-.*\.sql$/.test(entry))) {
      writeFileSync(join(subset, entry), readFileSync(join(directory, entry)));
    }
    assert.match(await refused({ MIGRATION_DIR: "/migrations/subset" }), /newer than this migration set/);
  } finally { rmSync(subset, { recursive: true, force: true }); }
});
