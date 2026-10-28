// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { promisify } from "node:util";

const run = (...args) => promisify(execFile)("docker", args, { timeout: 180000 });
const sql = async text => (await run("compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin",
  "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", text)).stdout;
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const lastLine = output => output.trim().split(/\r?\n/).at(-1);

const suffix = randomBytes(6).toString("hex");
const tenantA = `audit-a-${suffix}`;
const tenantB = `audit-b-${suffix}`;
const issuer = "https://audit.example.invalid";
const readerA = { subject: `reader-a-${suffix}`, client: `audit-reader-a-${suffix}` };
const readerB = { subject: `reader-b-${suffix}`, client: `audit-reader-b-${suffix}` };
const stranger = { subject: `stranger-${suffix}`, client: `audit-stranger-${suffix}` };
const appAdmin = { subject: `app-admin-${suffix}`, client: `audit-app-admin-${suffix}` };
const appId = randomUUID();
const appClient = `audit-app-${suffix}`;
const failureTrigger = `audit_fail_${suffix.replaceAll("-", "_")}`;
const claims = (tenant, actor, actorIssuer = issuer) => ({
  tenant_id: tenant, iss: actorIssuer, sub: actor.subject, client_id: actor.client,
});
const asRole = (role, actorClaims, statement) =>
  `SET ROLE ${role}; SELECT set_config('request.jwt.claims',${q(JSON.stringify(actorClaims))},false); ${statement}`;
const asOwner = (actorClaims, statement) => asRole("rosetta_app_owner", actorClaims, statement);
const read = async (tenant, actor, payload) => {
  const output = await sql(asRole("rosetta_audit_api", claims(tenant, actor),
    `SELECT core.audit_query(${q(JSON.stringify(payload))}::jsonb);`));
  return JSON.parse(lastLine(output));
};
const append = (tenant, actor, event, resourceType, resourceId, revision = 1,
  outcome = "success", reasonCode = null, reason = null) => sql(asOwner(claims(tenant, actor),
  `SELECT app_private.audit_append(${q(event)},${resourceType === null ? "NULL::text" : q(resourceType)},` +
  `${q(resourceId)},${revision},${q(outcome)},${reasonCode === null ? "NULL::text" : q(reasonCode)},` +
  `${reason === null ? "NULL::text" : q(reason)});`));

async function waitForDatabase() {
  const deadline = Date.now() + 90000;
  while (Date.now() < deadline) {
    try {
      await run("compose", "exec", "-T", "database", "pg_isready", "-U", "rosetta_admin", "-d", "rosetta_data");
      return;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  assert.fail("Database did not recover within ninety seconds");
}

before(async () => {
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions) VALUES
    (${q(tenantA)},${q(issuer)},${q(readerA.subject)},${q(readerA.client)},ARRAY['audit.read']::text[]),
    (${q(tenantB)},${q(issuer)},${q(readerB.subject)},${q(readerB.client)},ARRAY['audit.read']::text[]),
    (${q(tenantA)},${q(issuer)},${q(stranger.subject)},${q(stranger.client)},ARRAY[]::text[]),
    (${q(tenantA)},${q(issuer)},${q(appAdmin.subject)},${q(appAdmin.client)},
      ARRAY['applications.register','applications.approve','trust.approve']::text[]);
    INSERT INTO app_private.applications(tenant_id,app_id,issuer,oauth_client_id,owner_subject,
      provider_origin,display_name,state,revision,digest)
      VALUES(${q(tenantA)},${q(appId)},${q(issuer)},${q(appClient)},${q(appAdmin.subject)},
        'https://audit-app.example.invalid','Audit fixture','active',3,${q(`sha256:${"0".repeat(64)}`)});`);
});

after(async () => {
  try {
    await sql(`DROP TRIGGER IF EXISTS ${failureTrigger} ON app_private.audit;
      DROP FUNCTION IF EXISTS app_private.${failureTrigger}();`);
  } catch { /* Keep the original failure visible. */ }
  await sql(`DELETE FROM app_private.audit WHERE tenant_id IN (${q(tenantA)},${q(tenantB)});
    DELETE FROM app_private.principals WHERE tenant_id IN (${q(tenantA)},${q(tenantB)});
    DELETE FROM app_private.applications WHERE tenant_id=${q(tenantA)} AND app_id=${q(appId)};`);
});

test("owner-controlled append derives actor and tenant, redacts secrets and keeps payloads out of the schema", async () => {
  const target = randomUUID();
  const output = await append(tenantA, readerA, "audit.fixture_recorded", "audit", target, 1,
    "success", "fixture_recorded",
    "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJmaXh0dXJlIn0.c2lnbmF0dXJl password=hunter2 token=abc123");
  const eventId = lastLine(output);
  assert.match(eventId, /^[0-9a-f-]{36}$/);
  const result = await read(tenantA, readerA, { limit: 100 });
  assert.equal(result.status, 200);
  const item = result.value.items.find(entry => entry.eventId === eventId);
  assert.ok(item, "appended event is readable by a tenant auditor");
  assert.equal(item.tenantId, tenantA);
  assert.equal(item.subject, readerA.subject);
  assert.equal(item.issuer, issuer);
  assert.equal(item.managementClient, readerA.client);
  assert.equal(item.resourceType, "audit");
  assert.equal(item.schemaVersion, 1);
  assert.equal(item.outcome, "success");
  assert.match(item.reason, /\[redacted/);
  assert.doesNotMatch(item.reason, /hunter2|abc123|eyJhbGci/);
  assert.deepEqual(Object.keys(item).sort(), ["actorAppId", "event", "eventId", "issuer",
    "managementClient", "occurredAt", "outcome", "reason", "reasonCode", "resourceId",
    "resourceType", "revision", "schemaVersion", "subject", "tenantId"]);

  const forged = await sql(asOwner(claims(tenantA, readerA),
    `WITH inserted AS (INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,
      resource_type,resource_id,revision) VALUES(${q(tenantA)},'https://forged.invalid',
      'forged-subject','forged-client','audit.forged_fixture','audit',${q(randomUUID())},1)
      RETURNING event_id) SELECT event_id FROM inserted;`));
  const forgedId = lastLine(forged);
  const afterForge = await read(tenantA, readerA, { limit: 100 });
  const derived = afterForge.value.items.find(entry => entry.eventId === forgedId);
  assert.ok(derived);
  assert.equal(derived.subject, readerA.subject);
  assert.equal(derived.issuer, issuer);
  assert.equal(derived.managementClient, readerA.client);
});

test("malformed events, forged tenants and missing claims fail before any durable write", async () => {
  const before = await read(tenantA, readerA, { limit: 100 });
  const count = before.value.items.length;
  await assert.rejects(append(tenantA, readerA, "bad event", "audit", randomUUID()));
  await assert.rejects(append(tenantA, readerA, "audit.", "audit", randomUUID()));
  await assert.rejects(append(tenantA, readerA, "audit.fixture", "application", randomUUID()));
  await assert.rejects(append(tenantA, readerA, "audit.fixture", "audit", randomUUID(), -1));
  await assert.rejects(append(tenantA, readerA, "audit.fixture", "audit", randomUUID(), 1, "maybe"));
  await assert.rejects(append(tenantA, readerA, "audit.fixture", "audit", randomUUID(), 1,
    "success", "Not-A-Code"));
  await assert.rejects(sql(asOwner(claims(tenantA, readerA),
    `INSERT INTO app_private.audit(tenant_id,issuer,subject,management_client,event,
      resource_type,resource_id,revision) VALUES(${q(tenantB)},${q(issuer)},${q(readerA.subject)},
      ${q(readerA.client)},'audit.cross_tenant_fixture','audit',${q(randomUUID())},1);`)));
  await assert.rejects(sql(asOwner(claims(tenantA, readerA),
    `INSERT INTO app_private.audit(tenant_id,event,resource_id,revision)
      VALUES(${q(tenantA)},'audit.missing_target',NULL,1);`)));
  await assert.rejects(sql(`SET ROLE rosetta_app_owner;
    INSERT INTO app_private.audit(tenant_id,event,resource_id,revision)
      VALUES(${q(tenantA)},'audit.no_claims',${q(randomUUID())},1);`));
  const after = await read(tenantA, readerA, { limit: 100 });
  assert.equal(after.value.items.length, count);
});

test("ordinary application roles cannot read, append, update or delete audit history", async () => {
  const acl = await sql(`SELECT has_table_privilege('rosetta_app_api','app_private.audit','SELECT'),
    has_table_privilege('rosetta_app_api','app_private.audit','INSERT'),
    has_table_privilege('rosetta_audit_api','app_private.audit','INSERT'),
    has_table_privilege('rosetta_audit_api','app_private.audit','UPDATE'),
    has_table_privilege('rosetta_audit_api','app_private.audit','DELETE'),
    has_function_privilege('rosetta_app_api','core.audit_query(jsonb)','EXECUTE'),
    has_function_privilege('rosetta_api','core.audit_query(jsonb)','EXECUTE'),
    has_function_privilege('rosetta_resource_api','core.audit_query(jsonb)','EXECUTE'),
    has_function_privilege('rosetta_audit_api','core.audit_query(jsonb)','EXECUTE');`);
  assert.equal(lastLine(acl), "f|f|f|f|f|f|f|f|t");
  await assert.rejects(sql(asRole("rosetta_app_api", claims(tenantA, readerA),
    `SELECT core.audit_query('{}'::jsonb);`)));
  await assert.rejects(sql(asRole("rosetta_app_api", claims(tenantA, readerA),
    `INSERT INTO app_private.audit(tenant_id,event,resource_id,revision)
      VALUES(${q(tenantA)},'audit.unauthorized',${q(randomUUID())},1);`)));
  await assert.rejects(sql(asRole("rosetta_audit_api", claims(tenantA, readerA),
    `INSERT INTO app_private.audit(tenant_id,event,resource_id,revision)
      VALUES(${q(tenantA)},'audit.unauthorized',${q(randomUUID())},1);`)));
  await assert.rejects(sql(asRole("rosetta_audit_api", claims(tenantA, readerA),
    `UPDATE app_private.audit SET reason='tampered';`)));
  await assert.rejects(sql(asRole("rosetta_audit_api", claims(tenantA, readerA),
    `DELETE FROM app_private.audit;`)));
  await assert.rejects(sql(asRole("rosetta_audit_api", claims(tenantA, readerA),
    `SELECT app_private.audit_append('audit.unauthorized','audit',${q(randomUUID())},1);`)));
});

test("tenant/time filtered pagination rejects foreign tenants, unknown filters and unauthorized readers", async () => {
  const expected = [];
  for (let index = 0; index < 5; index += 1) {
    const id = randomUUID();
    expected.push(id);
    await append(tenantA, readerA, "audit.page_fixture", "audit", id, index + 1);
  }
  await append(tenantB, readerB, "audit.page_fixture", "audit", randomUUID());
  const items = [];
  let cursor;
  do {
    const page = await read(tenantA, readerA, cursor ? { limit: 2, cursor } : { limit: 2 });
    assert.equal(page.status, 200);
    assert.ok(page.value.items.length <= 2);
    items.push(...page.value.items);
    cursor = page.value.nextCursor;
  } while (cursor);
  assert.equal(new Set(items.map(item => item.eventId)).size, items.length, "pages do not overlap");
  assert.ok(expected.every(id => items.some(item => item.resourceId === id)), "pages reach the end");
  assert.ok(items.every(item => item.tenantId === tenantA));
  for (const payload of [{ since: "not-a-date" }, { limit: 0 }, { limit: 101 },
    { cursor: "zz" }, { tenantId: tenantB }, { event: "audit.page_fixture" }]) {
    const result = await read(tenantA, readerA, payload);
    assert.ok([400].includes(result.status), JSON.stringify(payload));
  }
  const future = await read(tenantA, readerA, { since: new Date(Date.now() + 3600000).toISOString() });
  assert.equal(future.value.items.length, 0);
  const past = await read(tenantA, readerA, { until: new Date(Date.now() - 3600000).toISOString() });
  assert.equal(past.value.items.length, 0);
  const foreign = await read(tenantB, readerB, { limit: 100 });
  assert.equal(foreign.status, 200);
  assert.ok(foreign.value.items.length > 0);
  assert.ok(foreign.value.items.every(item => item.tenantId === tenantB));
  const unauthorized = await read(tenantA, stranger, { limit: 1 });
  assert.equal(unauthorized.status, 403);
  const unknown = await read(tenantA, { subject: `unknown-${suffix}`, client: "unknown" }, { limit: 1 });
  assert.equal(unknown.status, 403);
  await sql(`UPDATE app_private.principals SET enabled=false WHERE tenant_id=${q(tenantA)}
    AND subject=${q(readerA.subject)} AND management_client=${q(readerA.client)};`);
  try {
    assert.equal((await read(tenantA, readerA, { limit: 1 })).status, 403);
  } finally {
    await sql(`UPDATE app_private.principals SET enabled=true WHERE tenant_id=${q(tenantA)}
      AND subject=${q(readerA.subject)} AND management_client=${q(readerA.client)};`);
  }
});

test("concurrent appends create unique durable events", async () => {
  const ids = Array.from({ length: 8 }, () => randomUUID());
  await Promise.all(ids.map((id, index) =>
    append(tenantA, readerA, "audit.concurrent_fixture", "audit", id, index + 1)));
  const result = await read(tenantA, readerA, { limit: 100 });
  const created = result.value.items.filter(item => item.event === "audit.concurrent_fixture");
  assert.equal(created.length, ids.length);
  assert.equal(new Set(created.map(item => item.eventId)).size, ids.length);
  assert.deepEqual(created.map(item => item.resourceId).sort(), ids.sort());
});

test("a sensitive authority mutation and its audit roll back together when the append fails", async () => {
  const baseline = await read(tenantA, readerA, { limit: 100 });
  const auditBefore = baseline.value.items.filter(item => item.resourceId === appId).length;
  await sql(`CREATE FUNCTION app_private.${failureTrigger}() RETURNS trigger
    LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.resource_id=${q(appId)}::uuid AND NEW.event='application.suspended' THEN
        RAISE EXCEPTION 'technical audit unavailable';
      END IF;
      RETURN NEW;
    END $$;
    CREATE TRIGGER ${failureTrigger} BEFORE INSERT ON app_private.audit
      FOR EACH ROW EXECUTE FUNCTION app_private.${failureTrigger}();`);
  try {
    await assert.rejects(sql(asRole("rosetta_app_api", claims(tenantA, appAdmin),
      `SELECT core.application_command('state',${q(JSON.stringify({
        appId, action: "suspend", reason: "audit failure fixture",
        etag: `"application-${appId}-3"`,
      }))}::jsonb);`)));
    const state = JSON.parse(lastLine(await sql(`SELECT row_to_json(a) FROM (
      SELECT state,revision FROM app_private.applications WHERE tenant_id=${q(tenantA)}
        AND app_id=${q(appId)}) a;`)));
    assert.deepEqual(state, { state: "active", revision: 3 });
    const unchanged = await read(tenantA, readerA, { limit: 100 });
    assert.equal(unchanged.value.items.filter(item => item.resourceId === appId).length, auditBefore);
  } finally {
    await sql(`DROP TRIGGER ${failureTrigger} ON app_private.audit;
      DROP FUNCTION app_private.${failureTrigger}();`);
  }
  const output = await sql(asRole("rosetta_app_api", claims(tenantA, appAdmin),
    `SELECT core.application_command('state',${q(JSON.stringify({
      appId, action: "suspend", reason: "technical audit fixture",
      etag: `"application-${appId}-3"`,
    }))}::jsonb);`));
  const result = JSON.parse(lastLine(output));
  assert.equal(result.status, 200);
  assert.equal(result.value.state, "suspended");
  const audit = await read(tenantA, readerA, { limit: 100 });
  const events = audit.value.items.filter(item => item.resourceId === appId);
  assert.equal(events.length, auditBefore + 1);
  const event = events.find(item => item.event === "application.suspended");
  assert.ok(event, "existing Application Authority audit remains active");
  assert.equal(event.resourceType, "application");
  assert.equal(event.subject, appAdmin.subject);
  assert.equal(event.outcome, "success");
});

test("audit history and the read boundary survive a database restart", async () => {
  const before = await read(tenantA, readerA, { limit: 100 });
  const ids = before.value.items.map(item => item.eventId);
  assert.ok(ids.length > 0);
  await run("compose", "restart", "database");
  await waitForDatabase();
  const afterRestart = await read(tenantA, readerA, { limit: 100 });
  assert.equal(afterRestart.status, 200);
  assert.ok(ids.every(id => afterRestart.value.items.some(item => item.eventId === id)));
  const acl = await sql(`SELECT has_table_privilege('rosetta_app_api','app_private.audit','INSERT'),
    has_function_privilege('rosetta_audit_api','core.audit_query(jsonb)','EXECUTE');`);
  assert.equal(lastLine(acl), "f|t");
});
