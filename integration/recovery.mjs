// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { test } from "node:test";
import { promisify } from "node:util";

async function docker(args, options = {}) {
  try { return await promisify(execFile)("docker", args, { timeout: 60000, ...options }); }
  catch { throw new Error(`Docker ${args[0]} failed during isolated recovery verification`); }
}

function closeCode(child) {
  return new Promise((resolve, reject) => {
    child.once("error", () => reject(new Error("Could not start backup/restore process")));
    child.once("close", resolve);
  });
}

test("pg_dump/pg_restore preserves real data and tenant RLS in an isolated temporary PostgreSQL", { timeout: 120000 }, async () => {
  const model = JSON.parse((await docker(["compose", "config", "--format", "json"])).stdout);
  const image = model.services.database.image;
  assert.match(image, /^postgres:17-bookworm@sha256:/);
  const id = randomUUID();
  const sourceSql = (sql) => docker(["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
  const sourceClaim = "SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{\"tenant_id\":\"tenant-a\"}',false);";
  let target;
  let seeded = false;
  try {
    await sourceSql(`${sourceClaim} INSERT INTO core.records(id,collection,data) VALUES ('${id}','recovery_fixture','{"fixture":"backup"}');`);
    seeded = true;
    const started = await docker(["run", "--detach", "--rm", "--name", `rosetta-restore-${randomBytes(6).toString("hex")}`,
      "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--env", "POSTGRES_USER=rosetta_admin",
      "--env", "POSTGRES_PASSWORD", image], { env: { ...process.env, POSTGRES_PASSWORD: randomBytes(32).toString("hex") } });
    target = started.stdout.trim();
    assert.match(target, /^[0-9a-f]{64}$/);
    const deadline = Date.now() + 45000;
    let ready = false;
    while (Date.now() < deadline) {
      try {
        await docker(["exec", target, "sh", "-c", 'test "$(cat /proc/1/comm)" = postgres && pg_isready -U rosetta_admin -d postgres']);
        ready = true;
        break;
      } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
    assert.ok(ready, "Isolated PostgreSQL completed initialization");
    await docker(["exec", target, "createdb", "-U", "rosetta_admin", "recovered"]);
    await docker(["exec", target, "psql", "-U", "rosetta_admin", "-d", "recovered", "-v", "ON_ERROR_STOP=1", "-c", "CREATE ROLE rosetta_api NOLOGIN NOBYPASSRLS;"]);
    const dump = spawn("docker", ["compose", "exec", "-T", "database", "pg_dump", "-U", "rosetta_admin", "--format=custom", "rosetta_data"], { stdio: ["ignore", "pipe", "pipe"] });
    const restore = spawn("docker", ["exec", "-i", target, "pg_restore", "-U", "rosetta_admin", "--exit-on-error", "--dbname=recovered"], { stdio: ["pipe", "ignore", "pipe"] });
    const dumpCode = closeCode(dump);
    const restoreCode = closeCode(restore);
    dump.stderr.resume();
    restore.stderr.resume();
    await pipeline(dump.stdout, restore.stdin);
    assert.equal(await dumpCode, 0, "Source dump succeeds");
    assert.equal(await restoreCode, 0, "Restore with ownership/ACL/policies succeeds");
    for (const [tenant, expected] of [["tenant-a", "1"], ["tenant-b", "0"]]) {
      const sql = `SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{"tenant_id":"${tenant}"}',false); SELECT count(*) FROM core.records WHERE id='${id}';`;
      const result = await docker(["exec", target, "psql", "-U", "rosetta_admin", "-d", "recovered", "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), expected, `Restored RLS for ${tenant}`);
    }
  } finally {
    if (target && /^[0-9a-f]{64}$/.test(target)) await docker(["stop", target]);
    if (seeded) await sourceSql(`${sourceClaim} DELETE FROM core.records WHERE id='${id}' AND collection='recovery_fixture';`);
  }
});
