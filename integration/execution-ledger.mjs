// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Isolated real PostgreSQL authority tests. OIDC/engine/provider integration is
// a separate gate; these claims deliberately simulate trusted Core assertions.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { before, after, test } from "node:test";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { jsonDigest, ticketDigest } from "../src/modules/capability/execution/execution.mjs";
import { verifyContracts } from "./contract.mjs";

const image = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8").match(/image: (postgres:[^\s]+)/)[1];
const name = `rosetta-ledger-test-${randomUUID()}`;
const run = promisify(execFile);
const docker = (...args) => run("docker", args, { timeout: 120000, maxBuffer: 2097152 });
const q = value => `'${String(value).replaceAll("'", "''")}'`;
const observations = [];
const sql = async text => (await docker("exec", name, "psql", "-X", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atq", "-v", "ON_ERROR_STOP=1", "-c", text)).stdout.trim();
const tenant = "tenant-a", issuer = "https://issuer.example.invalid";
const providerId = randomUUID(), consumerId = randomUUID(), otherId = randomUUID(), foreignId = randomUUID(), grantId = randomUUID(), approvalId = randomUUID();
const capabilityId = `urn:rosetta:capability:${providerId}:echo`;
const manifest = { ...JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url))),
  providerAppId: providerId, capabilityId, timeoutMs: 10000, requiredPermissions: [`urn:rosetta:permission:${providerId}:invoke`] };
const digest = jsonDigest(manifest), ref = { capabilityId, version: "1.0.0", manifestDigest: digest };
const claims = (subject = "consumer-service", client = "consumer", tenantId = tenant) => ({ tenant_id: tenantId, iss: issuer, sub: subject, client_id: client,
  trust_writer: true, exp: Math.floor(Date.now() / 1000) + 60 });
const consumer = () => claims(), provider = () => claims("provider-service", "provider");
const management = subject => claims(subject, "management");
async function command(operation, payload, context = consumer(), role = "rosetta_execution_api", rpc = "execution_command") {
  const result = JSON.parse(await sql(`BEGIN; SET LOCAL "request.jwt.claims"=${q(JSON.stringify(context))}; SET LOCAL ROLE ${role};
    SELECT core.${rpc}(${q(operation)},${q(JSON.stringify(payload))}::jsonb); COMMIT;`));
  if (result.value?.state && result.value.target?.kind === "capability") observations.push({ schema: "Execution", value: result.value });
  if (operation === "redeem" && result.value) observations.push({ schema: "TicketResult", value: result.value });
  return result;
}
const capCommand = (operation, payload, subject) => command(operation, payload, management(subject), "rosetta_capability_api", "capability_command");
const proof = e => ({ executionId: e.executionId, tenantId: tenant, issuer, subject: "consumer-service", clientId: "consumer", writer: true, expiresAt: e.deadlineAt });
const withProof = e => ({ ...consumer(), c4a_lease: proof(e) });
async function reserve(key = randomUUID(), input = { value: "technical fixture" }, patch = {}) {
  return command("reserve", { executionId: randomUUID(), idempotencyKey: key, target: ref, input,
    inputDigest: jsonDigest(input), requestDigest: jsonDigest({ target: { kind: "capability", capability: ref }, inputDigest: jsonDigest(input) }),
    deadlineAt: new Date(Date.now() + 10000).toISOString(), ...patch });
}
async function prepared() {
  const result = await reserve(); assert.equal(result.status, 202); const e = result.value;
  const correlation = { definitionId: `fixed:${randomUUID()}`, processId: randomUUID(), jobId: randomUUID() };
  assert.equal((await command("engine_reserve", { executionId: e.executionId, definitionId: correlation.definitionId }, withProof(e))).status, 200);
  assert.equal((await command("engine_bind", { executionId: e.executionId, ...correlation }, withProof(e))).status, 200);
  const ticket = randomUUID().replaceAll("-", "") + "synthetic-ticket";
  const redemption = { executionId: e.executionId, ticketHash: ticketDigest(ticket), inputDigest: jsonDigest({ value: "technical fixture" }) };
  assert.equal((await command("prepare", { ...redemption, ...correlation, ticketExpiresAt: e.deadlineAt }, withProof(e))).status, 200);
  return { e, correlation, redemption };
}
async function dispatched() {
  const item = await prepared();
  assert.equal((await command("dispatch", { executionId: item.e.executionId, jobId: item.correlation.jobId }, withProof(item.e))).status, 200);
  return item;
}
async function auditFailure(event) {
  await sql(`CREATE OR REPLACE FUNCTION public.c4a_test_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $f$
    BEGIN IF NEW.event=${q(event)} THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $f$;
    CREATE TRIGGER c4a_test_failure BEFORE INSERT ON app_private.audit FOR EACH ROW EXECUTE FUNCTION public.c4a_test_audit_failure();`);
}
const clearAuditFailure = () => sql("DROP TRIGGER IF EXISTS c4a_test_failure ON app_private.audit; DROP FUNCTION IF EXISTS public.c4a_test_audit_failure();");

before(async () => {
  await docker("run", "--detach", "--name", name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data:rw",
    "-e", "POSTGRES_USER=rosetta_admin", "-e", "POSTGRES_DB=rosetta_data", "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
    "--mount", `type=bind,source=${resolve("infra/postgres")},target=/migrations,readonly`, image);
  let ready = false;
  for (let n = 0; n < 40; n++) {
    // The image's bootstrap-only Unix socket can report ready before creating
    // the requested DB. TCP opens only for the final server after initialization.
    try { await docker("exec", name, "psql", "-X", "-h", "127.0.0.1", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atqc", "SELECT 1"); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  assert.ok(ready, "fresh disposable database ready");
  await sql("CREATE ROLE rosetta_data NOLOGIN NOINHERIT; ALTER DATABASE rosetta_data OWNER TO rosetta_data;");
  await docker("exec", name, "sh", "/migrations/migrate.sh", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1");
  assert.equal(await sql("SELECT max(version) FROM core.schema_migrations;"), "11");
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions) VALUES
    (${q(tenant)},${q(issuer)},'owner','management',ARRAY['applications.register','capabilities.write','trust.write']),
    (${q(tenant)},${q(issuer)},'approver','management',ARRAY['applications.approve','capabilities.approve','trust.approve']),
    (${q(tenant)},${q(issuer)},'publisher','management',ARRAY['capabilities.publish']);
    INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject) VALUES
    (${q(tenant)},${q(issuer)},'provider','owner','https://provider.example.invalid','provider-service'),
    (${q(tenant)},${q(issuer)},'consumer','owner','https://consumer.example.invalid','consumer-service'),
    (${q(tenant)},${q(issuer)},'other','owner','https://other.example.invalid','other-service'),
    ('tenant-b',${q(issuer)},'foreign','foreign-owner','https://foreign.example.invalid','foreign-service');
    INSERT INTO app_private.applications(tenant_id,app_id,issuer,oauth_client_id,owner_subject,provider_origin,display_name,state,digest) VALUES
    (${q(tenant)},${q(providerId)},${q(issuer)},'provider','owner','https://provider.example.invalid','Technical provider','active',${q(digest)}),
    (${q(tenant)},${q(consumerId)},${q(issuer)},'consumer','owner','https://consumer.example.invalid','Technical consumer','active',${q(digest)}),
    (${q(tenant)},${q(otherId)},${q(issuer)},'other','owner','https://other.example.invalid','Unapproved consumer','active',${q(digest)}),
    ('tenant-b',${q(foreignId)},${q(issuer)},'foreign','foreign-owner','https://foreign.example.invalid','Foreign consumer','active',${q(digest)});`);
  const registered = await capCommand("register", { capabilityId, version: "1.0.0", manifest, providerAppId: providerId, digest }, "owner");
  assert.equal(registered.status, 201);
});
after(async () => {
  try { if (observations.length) await verifyContracts("execution-ledger", observations, "--capability-runtime"); }
  finally { await docker("rm", "--force", name).catch(() => {}); }
});

test("C1 absent validation is denied; valid report and protected audit commit together", async () => {
  const row = JSON.parse(await sql(`SELECT to_jsonb(v) FROM app_private.capability_versions v WHERE capability_id=${q(capabilityId)};`));
  const decision = { resourceType: "capability-version", resourceId: `${capabilityId}@1.0.0`, resourceDigest: digest,
    resourceRevision: 1, requesterSubject: "owner", requesterAppId: providerId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() };
  const approval = await capCommand("approval_create", { approvalId, decision }, "approver"); assert.equal(approval.status, 201);
  const publish = { capabilityId, version: "1.0.0", etag: `"capability-version-${row.version_id}-1"`, approvalId };
  assert.equal((await capCommand("publish", publish, "publisher")).error, "validation_required");
  const validated = await capCommand("validate", { capabilityId, version: "1.0.0", etag: publish.etag, validationStatus: "valid", validationIssues: [] }, "owner");
  assert.equal(validated.value.status, "valid");
  assert.equal(await sql(`SELECT count(*) FROM app_private.audit WHERE event='capability.validated' AND resource_id=${q(row.version_id)};`), "1");
  for (const status of ["invalid", "indeterminate"]) {
    const report = await capCommand("validate", { capabilityId, version: "1.0.0", etag: publish.etag, validationStatus: status, validationIssues: [] }, "owner");
    assert.equal(report.value.status, status);
    assert.equal((await capCommand("publish", publish, "publisher")).error, "validation_required");
  }
  await capCommand("validate", { capabilityId, version: "1.0.0", etag: publish.etag, validationStatus: "valid", validationIssues: [] }, "owner");
  for (const broken of ["validation_digest=NULL", "validation_revision=NULL", "validation_policy_revision=NULL", "validation_report=NULL"]) {
    await sql(`UPDATE app_private.capability_versions SET ${broken} WHERE version_id=${q(row.version_id)};`);
    assert.equal((await capCommand("publish", publish, "publisher")).error, "validation_required");
    await capCommand("validate", { capabilityId, version: "1.0.0", etag: publish.etag, validationStatus: "valid", validationIssues: [] }, "owner");
  }
  await auditFailure("capability.validated");
  try { await assert.rejects(capCommand("validate", { capabilityId, version: "1.0.0", etag: publish.etag, validationStatus: "invalid", validationIssues: [] }, "owner")); }
  finally { await clearAuditFailure(); }
  assert.equal(await sql(`SELECT validation_status FROM app_private.capability_versions WHERE version_id=${q(row.version_id)};`), "valid", "audit failure rolled report back");
  await auditFailure("capability.published");
  try { await assert.rejects(capCommand("publish", publish, "publisher")); } finally { await clearAuditFailure(); }
  assert.equal(await sql(`SELECT state FROM app_private.capability_publication_approvals WHERE approval_id=${q(approvalId)};`), "approved");
  assert.equal((await capCommand("publish", publish, "publisher")).value.state, "published");
  const proposal = { providerAppId: providerId, consumerAppId: consumerId, capabilities: [ref], operations: ["invoke"],
    permissions: manifest.requiredPermissions, subjectIds: ["consumer-service"], expiresAt: new Date(Date.now() + 3600000).toISOString(), delegationAllowed: false, acceptDelegation: false };
  const grantDigest = `sha256:${"b".repeat(64)}`, grantApproval = randomUUID();
  const grantDecision = { resourceType: "grant", resourceId: grantId, resourceDigest: grantDigest, resourceRevision: 1,
    requesterSubject: "owner", requesterAppId: providerId, decision: "approve" };
  await sql(`INSERT INTO trust_private.grants(tenant_id,grant_id,issuer,provider_app_id,consumer_app_id,version_id,capability_id,version,manifest_digest,
      proposal,digest,revision,state,expires_at,created_by,management_client,activated_at)
    VALUES(${q(tenant)},${q(grantId)},${q(issuer)},${q(providerId)},${q(consumerId)},${q(row.version_id)},${q(capabilityId)},'1.0.0',${q(digest)},
      ${q(JSON.stringify(proposal))}::jsonb,${q(grantDigest)},2,'active',now()+interval '1 hour','owner','management',now());
    INSERT INTO trust_private.approvals(tenant_id,approval_id,grant_id,decision,approver_subject,management_client,expires_at,state)
      VALUES(${q(tenant)},${q(grantApproval)},${q(grantId)},${q(JSON.stringify(grantDecision))}::jsonb,'approver','management',now()+interval '10 minutes','consumed');
    UPDATE trust_private.grants SET activation_approval_id=${q(grantApproval)} WHERE grant_id=${q(grantId)};`);
});

test("reservations recheck exact authority, serialize identical keys and reject conflicts", async () => {
  assert.equal((await command("resolve", ref)).status, 200, "invoke-only grant does not need discover");
  assert.equal((await command("resolve", ref, claims("other-service", "other"))).status, 403);
  assert.equal((await command("resolve", ref, { ...consumer(), trust_writer: false })).status, 403);
  const key = randomUUID(), results = await Promise.all(Array.from({ length: 8 }, () => reserve(key)));
  assert.equal(results.filter(result => result.status === 202).length, 1);
  assert.equal(new Set(results.map(result => result.value.executionId)).size, 1);
  assert.equal((await reserve(key, { value: "changed" })).error, "idempotency_conflict");
  const retainedKey = randomUUID(), retained = (await reserve(retainedKey)).value;
  await sql(`UPDATE execution_private.executions SET created_at=clock_timestamp()-interval '25 hours',
    result_expires_at=clock_timestamp()-interval '1 hour' WHERE execution_id=${q(retained.executionId)};`);
  assert.equal((await reserve(retainedKey)).error, "result_expired", "expired result keeps its idempotency tombstone");
  assert.equal(await sql(`SELECT count(*) FROM execution_private.executions WHERE execution_id=${q(retained.executionId)};`), "1");
  const e = results[0].value;
  assert.equal((await command("get", { executionId: e.executionId }, claims("other-service", "other"))).status, 404);
  assert.equal((await command("get", { executionId: e.executionId }, claims("foreign-service", "foreign", "tenant-b"))).status, 404);
  assert.equal(await sql(`SELECT count(*) FROM app_private.audit WHERE event='execution.accepted' AND resource_id=${q(e.executionId)};`), "1");
  await auditFailure("execution.accepted");
  const count = await sql("SELECT count(*) FROM execution_private.executions;");
  try { await assert.rejects(reserve()); } finally { await clearAuditFailure(); }
  assert.equal(await sql("SELECT count(*) FROM execution_private.executions;"), count);
});

test("tickets require exact provider, original memory proof, input and single atomic consumption", async () => {
  const { e, redemption } = await dispatched();
  assert.equal((await command("finish", { executionId: e.executionId, state: "succeeded", output: null })).error, "provider_authorization_required");
  assert.equal((await command("redeem", redemption, { ...claims("other-service", "other"), c4a_lease: proof(e) })).value.active, false);
  assert.equal((await command("redeem", redemption, provider())).value.active, false, "no memory proof");
  const context = { ...provider(), c4a_lease: proof(e) };
  assert.equal((await command("redeem", { ...redemption, inputDigest: `sha256:${"0".repeat(64)}` }, context)).value.active, false);
  assert.equal((await command("redeem", redemption, { ...context, c4a_lease: { ...proof(e), subject: "forged" } })).value.active, false);
  await auditFailure("authorization.redeemed");
  try { await assert.rejects(command("redeem", redemption, context)); } finally { await clearAuditFailure(); }
  assert.equal(await sql(`SELECT ticket_consumed_at IS NULL FROM execution_private.executions WHERE execution_id=${q(e.executionId)};`), "t");
  const results = await Promise.all(Array.from({ length: 6 }, () => command("redeem", redemption, context)));
  assert.equal(results.filter(result => result.value.active).length, 1);
  const finished = await command("finish", { executionId: e.executionId, state: "succeeded", output: { value: "technical fixture" } });
  assert.equal(finished.value.state, "succeeded");
  assert.deepEqual(finished.value.output, { value: "technical fixture" });
  assert.equal((await command("redeem", redemption, context)).value.active, false);
});

test("revocation, expiry, forged correlation, audit outage and restart stop future dispatch", async () => {
  for (const state of ["failed", "timed_out"]) {
    const untouched = (await reserve()).value;
    assert.equal((await command("finish", { executionId: untouched.executionId, state, error: "synthetic_stop" })).value.state, state);
    assert.equal(await sql(`SELECT ticket_hash IS NULL AND ticket_expires_at IS NULL FROM execution_private.executions WHERE execution_id=${q(untouched.executionId)};`), "t");
  }
  const first = await prepared();
  assert.equal((await command("dispatch", { executionId: first.e.executionId, jobId: "forged" }, withProof(first.e))).error, "dispatch_not_available");
  assert.equal((await command("dispatch", { executionId: first.e.executionId, jobId: first.correlation.jobId })).error, "auth_required");
  await auditFailure("invocation.dispatched");
  try { await assert.rejects(command("dispatch", { executionId: first.e.executionId, jobId: first.correlation.jobId }, withProof(first.e))); }
  finally { await clearAuditFailure(); }
  assert.equal(await sql(`SELECT dispatch_phase FROM execution_private.executions WHERE execution_id=${q(first.e.executionId)};`), "prepared");
  await sql(`UPDATE trust_private.grants SET expires_at=clock_timestamp()-interval '1 second' WHERE grant_id=${q(grantId)};`);
  const alternateGrant = randomUUID(), alternateApproval = randomUUID();
  await sql(`INSERT INTO trust_private.grants SELECT (jsonb_populate_record(NULL::trust_private.grants,
      to_jsonb(g)||jsonb_build_object('grant_id',${q(alternateGrant)},'activation_approval_id',NULL,'expires_at',g.proposal->>'expiresAt'))).* FROM trust_private.grants g WHERE g.grant_id=${q(grantId)};
    INSERT INTO trust_private.approvals SELECT (jsonb_populate_record(NULL::trust_private.approvals,
      to_jsonb(a)||jsonb_build_object('approval_id',${q(alternateApproval)},'grant_id',${q(alternateGrant)},
        'decision',jsonb_set(a.decision,'{resourceId}',to_jsonb(${q(alternateGrant)}::text))))).* FROM trust_private.approvals a WHERE a.grant_id=${q(grantId)};
    UPDATE trust_private.grants SET activation_approval_id=${q(alternateApproval)} WHERE grant_id=${q(alternateGrant)};`);
  assert.equal((await command("resolve", ref)).status, 200, "another grant can authorize a new logical request");
  assert.equal((await command("dispatch", { executionId: first.e.executionId, jobId: first.correlation.jobId }, withProof(first.e))).status, 403);
  await sql(`UPDATE trust_private.grants SET activation_approval_id=NULL WHERE grant_id=${q(alternateGrant)};
    DELETE FROM trust_private.approvals WHERE approval_id=${q(alternateApproval)}; DELETE FROM trust_private.grants WHERE grant_id=${q(alternateGrant)};`);
  await sql(`UPDATE trust_private.grants SET expires_at=clock_timestamp()+interval '1 hour' WHERE grant_id=${q(grantId)};`);
  const second = await dispatched();
  await sql(`UPDATE execution_private.executions SET ticket_expires_at=clock_timestamp()-interval '1 second' WHERE execution_id=${q(second.e.executionId)};`);
  assert.equal((await command("redeem", second.redemption, { ...provider(), c4a_lease: proof(second.e) })).value.active, false);
  const ambiguous = await command("finish", { executionId: second.e.executionId, state: "auth_required", error: "lease_lost" });
  assert.equal(ambiguous.value.state, "outcome_unknown", "possible dispatch takes precedence over lost lease");
  assert.equal((await command("prepare", { executionId: second.e.executionId, ...second.correlation, ticketHash: ticketDigest("another"), ticketExpiresAt: second.e.deadlineAt }, withProof(second.e))).error, "dispatch_not_available");
  const waiting = (await reserve()).value;
  const waitingState = await command("finish", { executionId: waiting.executionId, state: "auth_required", error: "lease_lost" });
  assert.equal(waitingState.value.state, "auth_required");
  assert.equal((await command("reauthorize", { executionId: waiting.executionId })).error, "auth_required");
  const renewed = await command("reauthorize", { executionId: waiting.executionId }, withProof(waiting));
  assert.equal(renewed.value.state, "accepted");
  assert.equal(renewed.value.deadlineAt, waiting.deadlineAt, "reauthentication cannot extend the deadline");
  for (const role of ["rosetta_api", "rosetta_resource_api", "rosetta_app_api", "rosetta_capability_api", "rosetta_trust_api"]) {
    assert.equal(await sql(`SELECT has_function_privilege(${q(role)},'core.execution_command(text,jsonb)','execute');`), "f", role);
    assert.equal(await sql(`SELECT has_schema_privilege(${q(role)},'execution_private','usage');`), "f", role);
  }
  assert.equal(await sql("SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid='execution_private.executions'::regclass;"), "t");
  assert.equal(await sql("SELECT count(*) FROM information_schema.columns WHERE table_schema='execution_private' AND column_name IN ('token','credential','authorization','ticket');"), "0");
  const repeat = await docker("exec", name, "sh", "/migrations/migrate.sh", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1");
  assert.match(repeat.stdout, /Migration 11 verified/);
});
