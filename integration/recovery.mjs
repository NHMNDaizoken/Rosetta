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
  const otherApp = randomUUID();
  const sourceSql = (sql) => docker(["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
  const sourceClaim = "SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{\"tenant_id\":\"tenant-a\"}',false);";
  let target;
  let seeded = false;
  let applicationSeeded = false;
  try {
    await sourceSql(`${sourceClaim} INSERT INTO core.records(id,collection,data) VALUES ('${id}','recovery_fixture','{"fixture":"backup"}');`);
    seeded = true;
    await sourceSql(`INSERT INTO app_private.applications(tenant_id,app_id,issuer,oauth_client_id,owner_subject,provider_origin,display_name,digest)
      VALUES('tenant-a','${id}','https://recovery.example.invalid','restore-${id}','restore-${id}','https://recovery.example.invalid','Isolated restore fixture','sha256:${"0".repeat(64)}');`);
    applicationSeeded = true;
    await sourceSql(`UPDATE app_private.applications SET state='active' WHERE app_id='${id}';
      INSERT INTO app_private.applications(tenant_id,app_id,issuer,oauth_client_id,owner_subject,provider_origin,display_name,digest,state)
        VALUES('tenant-a','${otherApp}','https://recovery.example.invalid','restore-${otherApp}','restore-${id}','https://recovery.example.invalid','Restore app B','sha256:${"0".repeat(64)}','active');
      INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject)
        VALUES('tenant-a','https://recovery.example.invalid','restore-${id}','restore-${id}','https://recovery.example.invalid','subject-${id}'),
        ('tenant-a','https://recovery.example.invalid','restore-${otherApp}','restore-${id}','https://recovery.example.invalid','subject-${otherApp}');
      INSERT INTO core.app_records(tenant_id,id,owner_app_id,collection,data) VALUES('tenant-a','${id}','${id}','recovery_fixture','{"private":true}');
      INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions)
        VALUES('tenant-a','https://recovery.example.invalid','recovery-${id}','restore-${id}',ARRAY['audit.read']::text[]);
      SET ROLE rosetta_app_owner;
      SELECT set_config('request.jwt.claims','{"tenant_id":"tenant-a","iss":"https://recovery.example.invalid","sub":"recovery-${id}","client_id":"restore-${id}"}',false);
      INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,resource_id,revision)
        VALUES('tenant-a','https://recovery.example.invalid','recovery-${id}','restore-${id}','application.recovery_fixture','${id}',1);
      RESET ROLE;`);
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
    await docker(["exec", target, "psql", "-U", "rosetta_admin", "-d", "recovered", "-v", "ON_ERROR_STOP=1", "-c", "CREATE ROLE rosetta_api NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_app_api NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_app_owner NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_resource_api NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_audit_api NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_capability_api NOLOGIN NOBYPASSRLS; CREATE ROLE rosetta_trust_api NOLOGIN NOBYPASSRLS;"]);
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
    for (const [tenant, expected] of [["tenant-a", "1"], ["tenant-b", "0"]]) {
      const claims = `SET ROLE rosetta_app_owner; SELECT set_config('request.jwt.claims','{"tenant_id":"${tenant}"}',false);`;
      const result = await docker(["exec", target, "psql", "-U", "rosetta_admin", "-d", "recovered", "-v", "ON_ERROR_STOP=1", "-Atc",
        `${claims} SELECT count(*) FROM app_private.applications WHERE app_id='${id}';`]);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), expected, `Restored authority RLS for ${tenant}`);
    }
    const acl = await docker(["exec", target, "psql", "-U", "rosetta_admin", "-d", "recovered", "-Atc",
      "SELECT has_schema_privilege('rosetta_api','app_private','USAGE'),has_function_privilege('rosetta_api','core.application_command(text,jsonb)','EXECUTE'),has_function_privilege('rosetta_app_api','core.application_command(text,jsonb)','EXECUTE');"]);
    assert.equal(acl.stdout.trim(), "f|f|t", "Restore preserves isolated authority RPC grants");
    for(const [tenant,appId,expected] of [['tenant-a',id,'1'],['tenant-a',otherApp,'0'],['tenant-b',id,'0']]) {
      const claims=JSON.stringify({tenant_id:tenant,iss:'https://recovery.example.invalid',client_id:`restore-${appId}`,sub:`subject-${appId}`,app_id:id,resource_writer:true});
      const result=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-v','ON_ERROR_STOP=1','-Atc',
        `SET ROLE rosetta_resource_api; SELECT set_config('request.jwt.claims','${claims}',false); SELECT count(*) FROM core.app_records WHERE id='${id}';`]);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1),expected,`Restored app RLS: ${tenant}/${appId}`);
    }
    const resourceAcl=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-Atc',
      "SELECT has_table_privilege('rosetta_api','core.app_records','SELECT'),has_schema_privilege('rosetta_resource_api','app_private','USAGE');"]);
    assert.equal(resourceAcl.stdout.trim(),'f|f','Restore preserves resource role separation');
    const auditAcl=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-Atc',
      "SELECT has_function_privilege('rosetta_audit_api','core.audit_query(jsonb)','EXECUTE'),has_table_privilege('rosetta_audit_api','app_private.audit','INSERT'),has_table_privilege('rosetta_app_api','app_private.audit','INSERT');"]);
    assert.equal(auditAcl.stdout.trim(),'t|f|f','Restore preserves audit role separation');
    const capabilityAcl=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-Atc',
      "SELECT has_function_privilege('rosetta_capability_api','core.capability_command(text,jsonb)','EXECUTE'),has_function_privilege('rosetta_capability_api','core.application_command(text,jsonb)','EXECUTE'),has_table_privilege('rosetta_capability_api','app_private.capability_versions','SELECT');"]);
    assert.equal(capabilityAcl.stdout.trim(),'t|f|f','Restore preserves capability registry role separation');
    const trustAcl=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-Atc',
      "SELECT n.nspowner::regrole, bool_and(c.relrowsecurity AND c.relforcerowsecurity) FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid WHERE n.nspname='trust_private' AND c.relkind='r' GROUP BY n.nspowner; SELECT has_schema_privilege('rosetta_api','trust_private','USAGE'),has_table_privilege('rosetta_app_api','trust_private.grants','INSERT');"]);
    assert.equal(trustAcl.stdout.trim(),'rosetta_app_owner|t\nf|f','Restore preserves Trust ownership, forced RLS and private ACLs');
    for(const [tenant,expected] of [['tenant-a','1'],['tenant-b','0']]) {
      const claims=JSON.stringify({tenant_id:tenant,iss:'https://recovery.example.invalid',sub:`recovery-${id}`,client_id:`restore-${id}`});
      const result=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-v','ON_ERROR_STOP=1','-Atc',
        `SET ROLE rosetta_app_owner; SELECT set_config('request.jwt.claims','${claims}',false); SELECT count(*) FROM app_private.audit WHERE resource_id='${id}';`]);
      assert.equal(result.stdout.trim().split(/\r?\n/).at(-1),expected,`Restored audit RLS for ${tenant}`);
    }
    const auditClaims=JSON.stringify({tenant_id:'tenant-a',iss:'https://recovery.example.invalid',sub:`recovery-${id}`,client_id:`restore-${id}`});
    const auditQuery=await docker(['exec',target,'psql','-U','rosetta_admin','-d','recovered','-v','ON_ERROR_STOP=1','-Atc',
      `SET ROLE rosetta_audit_api; SELECT set_config('request.jwt.claims','${auditClaims}',false); SELECT EXISTS(SELECT 1 FROM jsonb_array_elements(core.audit_query('{"limit":100}'::jsonb)->'value'->'items') item WHERE item->>'resourceId'='${id}');`]);
    assert.equal(auditQuery.stdout.trim().split(/\r?\n/).at(-1),'t','Restored protected audit query returns the event');
  } finally {
    if (target && /^[0-9a-f]{64}$/.test(target)) await docker(["stop", target]);
    if (applicationSeeded) await sourceSql(`DELETE FROM core.app_records WHERE owner_app_id='${id}' AND collection='recovery_fixture';
      DELETE FROM app_private.audit WHERE tenant_id='tenant-a' AND resource_id='${id}';
      DELETE FROM app_private.principals WHERE tenant_id='tenant-a' AND subject='recovery-${id}' AND management_client='restore-${id}';
      DELETE FROM app_private.enrollments WHERE oauth_client_id IN ('restore-${id}','restore-${otherApp}');
      DELETE FROM app_private.applications WHERE app_id IN ('${id}','${otherApp}') AND owner_subject='restore-${id}';`);
    if (seeded) await sourceSql(`${sourceClaim} DELETE FROM core.records WHERE id='${id}' AND collection='recovery_fixture';`);
  }
});
