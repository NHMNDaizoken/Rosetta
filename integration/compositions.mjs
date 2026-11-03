// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";
import { before, after, test } from "node:test";
import { createAuthorityFixture } from "./fixtures/authority.mjs";
import { createRuntimeFixture } from "./capability-runtime-fixture.mjs";
import { verifyContracts } from "./contract.mjs";
import { createRosettaClient } from "../sdk/node/index.mjs";

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const prefix = `composition-${randomBytes(5).toString("hex")}`;
const issuer = `${base}/identity/realms/rosetta`;
const clientIds = [], users = [];
const run = promisify(execFile);
const sql = text => run("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", text], { timeout: 30000 });
const q = value => `'${String(value).replaceAll("'", "''")}'`;
async function publicApi(path, who, body, headers = {}, method = body === undefined ? "GET" : "POST") {
  return fetch(base + path, { method, headers: { Authorization: `Bearer ${who.token ?? who}`, "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}
const authority = createAuthorityFixture({ base, prefix, sql, q, api: publicApi, clientIds, users });
let owner, approver, publisher, consumer, other, foreign, providers, runtime, published;
let version = 0;
const manifestFixture = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url)));
const observations = [];
const api = async (path, who = consumer, body, headers, method) => {
  const result = await runtime.api(path, who, body, headers, method);
  if (result.status < 300) {
    const schema = path.startsWith("/v1/compositions") ? "CompositionVersion" : path.startsWith("/v1/capability-executions") ? "Execution"
      : path.startsWith("/v1/approvals") ? "Approval" : path.endsWith("/introspect") ? "TicketResult" : null;
    if (schema) observations.push({ schema, value: result.body });
    if (body?.target?.kind === "composition") observations.push({ schema: "CompositionExecutionCreate", value: body });
  }
  return result;
};
const expect = (r, status) => { assert.equal(r.status, status, JSON.stringify(r.body)); return r; };
const versionPath = value => `/v1/compositions/${value.body.compositionId}/versions/${value.body.version}`;
const etag = value => ({ "If-Match": value.headers.etag });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(action, predicate, label, timeout = 20000) {
  let value; const deadline = Date.now() + timeout;
  do { value = await action(); if (predicate(value)) return value; await delay(100); } while (Date.now() < deadline);
  assert.fail(`${label}: ${JSON.stringify(value)}`);
}
async function stored(id) {
  return JSON.parse((await sql(`SELECT row_to_json(e) FROM composition_private.executions e WHERE execution_id=${q(id)};`)).stdout.trim());
}
const states = () => Promise.all([0, 1].map(index => runtime.providerState(index).then(r => r.body)));
async function noDispatch(action) {
  const before = (await states()).map(s => s.received);
  await action();
  assert.deepEqual((await states()).map(s => s.received), before, "authorization denial must precede provider contact");
}
function plan(patch = {}) {
  return { compositionFormat: "1.0", name: "Two independent technical providers", version: `1.0.${version++}`,
    inputSchema: structuredClone(manifestFixture.inputSchema), outputSchema: structuredClone(manifestFixture.outputSchema), deadlineMs: 30000,
    steps: providers.map((provider, index) => ({ stepId: index ? "validate" : "normalize", capability: structuredClone(provider.reference),
      input: index ? { source: "step-output", stepId: "normalize" } : { source: "composition-input" } })), ...patch };
}
async function createPlan(document = plan()) { return expect(await api("/v1/compositions", consumer, document), 201); }
async function validate(draft) { return expect(await api(`${versionPath(draft)}/validate`, consumer, {}, etag(draft)), 200); }
async function approval(value, patch = {}, actor = approver) {
  return api("/v1/approvals", actor, { resourceType: "composition-version", resourceId: value.body.compositionId,
    resourceDigest: value.body.digest, resourceRevision: value.body.revision, requesterSubject: consumer.subject,
    requesterAppId: consumer.app.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString(), ...patch });
}
async function publish(document = plan()) {
  const checked = await validate(await createPlan(document));
  assert.equal(checked.body.validation.status, "valid", JSON.stringify(checked.body));
  const decision = expect(await approval(checked), 201);
  return expect(await api(`${versionPath(checked)}/publish`, publisher, { approvalId: decision.body.approvalId }, etag(checked)), 200);
}
function execution(value = published, input = { value: "  NORMALIZED  " }) {
  return { target: { kind: "composition", compositionId: value.body.compositionId, version: value.body.version, compositionDigest: value.body.digest }, input };
}
const start = (body = execution(), key = randomUUID(), who = consumer) => api("/v1/capability-executions", who, body, { "Idempotency-Key": key });
async function terminal(id, state) {
  const result = await until(() => api(`/v1/capability-executions/${id}`), r => r.status === 200 && r.body.state === state, state);
  assert.equal((await stored(id)).state, state); return result;
}
async function grant(provider, operations = ["invoke"], target = consumer, expiry = 600000) {
  const body = { providerAppId: provider.app.appId, consumerAppId: target.app.appId, capabilities: [provider.reference], operations,
    permissions: provider.manifest.requiredPermissions, subjectIds: [target.subject], expiresAt: new Date(Date.now() + expiry).toISOString(), delegationAllowed: false, acceptDelegation: false };
  const created = await publicApi("/v1/trust/grants", owner, body); assert.equal(created.status, 201);
  const g = await created.json();
  const decision = await publicApi("/v1/approvals", approver, { resourceType: "grant", resourceId: g.grantId, resourceDigest: g.digest,
    resourceRevision: g.revision, requesterSubject: owner.id, requesterAppId: provider.app.appId, decision: "approve", expiresAt: new Date(Math.min(Date.now() + 120000, Date.parse(body.expiresAt))).toISOString() });
  assert.equal(decision.status, 201);
  const active = await publicApi(`/v1/trust/grants/${g.grantId}/activate`, approver, { approvalId: (await decision.json()).approvalId }, { "If-Match": created.headers.get("etag") });
  assert.equal(active.status, 200); return { body: await active.json(), headers: { etag: active.headers.get("etag") } };
}
async function revoke(provider) {
  const g = provider.grant;
  const r = await publicApi(`/v1/trust/grants/${g.body.grantId}/revoke`, owner, { reason: "synthetic C4B revocation" }, etag(g));
  assert.equal(r.status, 200);
}

async function capabilityVersion(provider, manifest, publish = true) {
  const path = `/v1/capabilities/${encodeURIComponent(manifest.capabilityId)}/versions`;
  const created = await publicApi(path, owner, manifest); assert.equal(created.status, 201);
  const value = await created.json();
  if (publish) {
    assert.equal((await publicApi(`${path}/${manifest.version}/validate`, owner, {}, { "If-Match": created.headers.get("etag") })).status, 200);
    const decision = await publicApi("/v1/approvals", approver, { resourceType: "capability-version", resourceId: `${manifest.capabilityId}@${manifest.version}`,
      resourceDigest: value.digest, resourceRevision: value.revision, requesterSubject: owner.id, requesterAppId: provider.app.appId,
      decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
    assert.equal(decision.status, 201);
    const active = await publicApi(`${path}/${manifest.version}/publish`, publisher, { approvalId: (await decision.json()).approvalId }, { "If-Match": created.headers.get("etag") });
    assert.equal(active.status, 200); value.etag = active.headers.get("etag");
  }
  return { capabilityId: manifest.capabilityId, version: manifest.version, manifestDigest: value.digest, etag: value.etag };
}

before(async () => {
  await authority.operatorToken();
  const template = (await (await authority.admin("clients?clientId=tenant-a")).json())[0];
  const source = await (await authority.admin(`clients/${template.id}`)).json();
  for (const tenant of ["tenant-a", "tenant-b"]) {
    const protocolMappers = structuredClone(source.protocolMappers);
    for (const mapper of protocolMappers) delete mapper.id;
    protocolMappers.find(m => m.name === "tenant").config["claim.value"] = tenant;
    const r = await authority.admin("clients", { clientId: `${prefix}-management-${tenant}`, enabled: true, protocol: "openid-connect", publicClient: true,
      standardFlowEnabled: true, directAccessGrantsEnabled: false, redirectUris: ["http://127.0.0.1:9876/callback"], attributes: { "pkce.code.challenge.method": "S256" }, protocolMappers }, "POST");
    assert.equal(r.status, 201); clientIds.push(r.headers.get("location").split("/").at(-1));
  }
  owner = await authority.human("owner", "tenant-a", ["applications.register", "capabilities.write", "trust.write"]);
  approver = await authority.human("approver", "tenant-a", ["applications.approve", "capabilities.approve", "trust.approve", "compositions.approve"]);
  publisher = await authority.human("publisher", "tenant-a", ["capabilities.write", "capabilities.publish", "compositions.publish"]);
  consumer = await authority.backend("consumer", owner, approver);
  other = await authority.backend("other", owner, approver);
  const foreignOwner = await authority.human("foreign-owner", "tenant-b", ["applications.register"]);
  const foreignAdmin = await authority.human("foreign-admin", "tenant-b", ["applications.approve", "trust.approve"]);
  foreign = await authority.backend("foreign-consumer", foreignOwner, foreignAdmin, "tenant-b");
  // Explicit operator assignment; application tokens alone grant no management permissions.
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions)
    VALUES('tenant-a',${q(issuer)},${q(consumer.subject)},${q(consumer.clientId)},ARRAY['compositions.write']);`);
  providers = [];
  for (const [index, label] of ["document-normalize", "document-validate"].entries()) {
    const origin = `https://${prefix}-${label}.test:8443`;
    const provider = await authority.backend(label, owner, approver, "tenant-a", true, origin);
    const capabilityId = `urn:rosetta:capability:${provider.app.appId}:${label}`;
    const manifest = { ...structuredClone(manifestFixture), capabilityId, providerAppId: provider.app.appId,
      title: index ? "document.validate" : "document.normalize", timeoutMs: 5000,
      requiredPermissions: [`urn:rosetta:permission:${provider.app.appId}:invoke`] };
    const path = `/v1/capabilities/${encodeURIComponent(capabilityId)}/versions`;
    const created = await publicApi(path, owner, manifest); assert.equal(created.status, 201);
    const value = await created.json();
    assert.equal((await publicApi(`${path}/1.0.0/validate`, owner, {}, { "If-Match": created.headers.get("etag") })).status, 200);
    const decision = await publicApi("/v1/approvals", approver, { resourceType: "capability-version", resourceId: `${capabilityId}@1.0.0`,
      resourceDigest: value.digest, resourceRevision: value.revision, requesterSubject: owner.id, requesterAppId: provider.app.appId,
      decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
    assert.equal(decision.status, 201);
    const active = await publicApi(`${path}/1.0.0/publish`, publisher, { approvalId: (await decision.json()).approvalId }, { "If-Match": created.headers.get("etag") });
    assert.equal(active.status, 200);
    Object.assign(provider, { origin, manifest, reference: { capabilityId, version: "1.0.0", manifestDigest: value.digest } });
    provider.grant = await grant(provider); providers.push(provider);
  }
  runtime = await createRuntimeFixture({ composition: true, providers: providers.map(p => ({ origin: p.origin, token: p.token,
    providerAppId: p.app.appId, capability: p.reference, tenantId: "tenant-a" })) });
  published = await publish();
});

after(async () => {
  if (runtime) {
    const rows = await sql(`SELECT coalesce(jsonb_agg(engine_process_id) FILTER(WHERE engine_process_id IS NOT NULL),'[]') FROM composition_private.executions WHERE consumer_app_id=${q(consumer.app.appId)};`);
    for (const id of JSON.parse(rows.stdout.trim())) await runtime.engine(`/service/runtime/process-instances/${id}`, undefined, "DELETE").catch(() => {});
    await runtime.close();
  }
  await authority.operatorToken();
  for (const id of users) await authority.admin(`users/${id}`, undefined, "DELETE");
  for (const id of clientIds) await authority.admin(`clients/${id}`, undefined, "DELETE");
});

test("C4B: real two-provider execution agrees with durable SQL and completed Flowable history", { timeout: 60000 }, async () => {
  const before = await states();
  await runtime.mode("normalize", 0);
  const key = randomUUID(), body = execution();
  // SDK uses the real fixture HTTP transport because the public Gateway remains
  // execution-disabled. Authentication still uses the real public OIDC endpoint.
  const sdk = createRosettaClient({ baseUrl: base, clientId: consumer.clientId, clientSecret: consumer.clientSecret,
    fetcher: async (url, init) => {
      if (url.pathname.includes("/protocol/openid-connect/token")) return fetch(url, init);
      const headers = Object.fromEntries(init.headers);
      const bearer = headers.authorization.slice(7);
      delete headers.authorization; delete headers["content-type"];
      const result = await api(url.pathname + url.search, bearer,
        init.body ? JSON.parse(init.body) : undefined, headers, init.method);
      assert.equal(result.status, init.method === "POST" ? 202 : 200);
      return new Response(JSON.stringify(result.body), { status: result.status, headers: result.headers });
    } });
  const accepted = { body: await sdk.execute(body.target, body.input, key) };
  assert.equal((await stored(accepted.body.executionId)).engine_process_id !== null, true);
  await runtime.control("resume");
  const done = await terminal(accepted.body.executionId, "succeeded");
  assert.deepEqual((await sdk.waitForExecution(done.body.executionId)).output, { value: "normalized" });
  assert.deepEqual(done.body.output, { value: "normalized" });
  const row = await stored(done.body.executionId);
  const history = expect(await runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`), 200).body;
  assert.ok(history.endTime); assert.equal(history.deleteReason, null);
  assert.equal(history.businessKey, row.engine_business_key); assert.equal(history.processDefinitionId, row.engine_definition_id);
  const after = await states();
  for (let i = 0; i < 2; i++) { assert.equal(after[i].count, before[i].count + 1); assert.equal(after[i].received, before[i].received + 1); }
  assert.deepEqual(after[1].last.input, { value: "normalized" }, "whole step output bound to next input");
  const steps = JSON.parse((await sql(`SELECT jsonb_agg(to_jsonb(s) ORDER BY step_index) FROM composition_private.execution_steps s WHERE execution_id=${q(row.execution_id)};`)).stdout.trim());
  assert.ok(steps.every(s => s.attempt === 1 && s.ticket_consumed_at && s.state === "succeeded"));
  assert.deepEqual(steps[0].output, steps[1].input); assert.notEqual(steps[0].input_digest, steps[1].input_digest);
  for (let i = 0; i < 2; i++) {
    const last = after[i].last;
    const redeemed = await api("/v1/capability-authorizations/introspect", providers[i], { ticket: last.ticket, invocationId: last.invocationId, inputDigest: last.inputDigest });
    expect(redeemed, 200); assert.equal(redeemed.body.active, false);
  }
  expect(await api(`/v1/capability-executions/${row.execution_id}`, other), 404);
  expect(await api(`/v1/capability-executions/${row.execution_id}`, foreign), 404);
  expect(await start(body, key), 200);
  expect(await start(execution(published, { value: "conflict" }), key), 409);
  assert.deepEqual((await states()).map(s => s.count), after.map(s => s.count));
});

test("C4B: plan schema, pinning and C3 compatibility deny malformed or unavailable edges", async () => {
  await noDispatch(async () => {
    for (const change of [p => p.arbitrary = true, p => p.steps[0].capability.version = "latest",
      p => p.steps[0].capability.manifestDigest = "forged", p => p.steps[0].capability.capabilityId = "document.normalize",
      p => p.steps[1].input.stepId = "future", p => p.inputSchema.$ref = "https://example.invalid/schema"]) {
      const doc = plan(); change(doc); expect(await api("/v1/compositions", consumer, doc), 422);
    }
    const unknown = plan(); unknown.steps[0].capability.capabilityId = `urn:rosetta:capability:${randomUUID()}:unknown`;
    assert.equal((await validate(await createPlan(unknown))).body.validation.status, "invalid");
    for (const field of ["version", "manifestDigest"]) {
      const stale = plan(); stale.steps[0].capability[field] = field === "version" ? "99.0.0" : `sha256:${"f".repeat(64)}`;
      assert.equal((await validate(await createPlan(stale))).body.validation.status, "invalid");
    }
    const mismatch = plan(); mismatch.outputSchema = { type: "integer", minimum: 0, maximum: 10 };
    const checked = await validate(await createPlan(mismatch)); assert.equal(checked.body.validation.status, "invalid");
    const d = expect(await approval(checked), 201);
    expect(await api(`${versionPath(checked)}/publish`, publisher, { approvalId: d.body.approvalId }, etag(checked)), 409);
    expect(await start(execution(published, { unexpected: true })), 422);
  });
});

test("C4B: publication requires an independent exact approval and published versions are immutable", async () => {
  await noDispatch(async () => {
    const draft = await createPlan();
    expect(await api(`${versionPath(draft)}/publish`, publisher, { approvalId: randomUUID() }, etag(draft)), 409);
    const checked = await validate(draft);
    await sql(`UPDATE app_private.principals SET permissions=array_append(permissions,'compositions.approve') WHERE subject=${q(owner.id)};`);
    try { expect(await approval(checked, {}, owner), 403); }
    finally { await sql(`UPDATE app_private.principals SET permissions=array_remove(permissions,'compositions.approve') WHERE subject=${q(owner.id)};`); }
    expect(await approval(checked, { resourceRevision: 999 }), 409);
    expect(await approval(checked, { requesterAppId: other.app.appId }), 409);
    expect(await api(`${versionPath(checked)}/publish`, consumer, { approvalId: randomUUID() }, etag(checked)), 403);
    expect(await api(`${versionPath(checked)}/publish`, publisher, { approvalId: randomUUID() }, etag(checked)), 409);
    const decision = expect(await approval(checked), 201);
    const updated = expect(await api(versionPath(checked), consumer, { ...checked.body.composition, name: "changed" }, etag(checked), "PUT"), 200);
    expect(await api(`${versionPath(updated)}/publish`, publisher, { approvalId: decision.body.approvalId }, etag(updated)), 409);
    expect(await api(versionPath(published), consumer, published.body.composition, etag(published), "PUT"), 409);
    expect(await api(versionPath(published), foreign), 403);
  });
});

test("C4B: adjacent incompatible and indeterminate C3 proofs and unpublished/revoked pins cannot publish", async () => {
  await noDispatch(async () => {
    const number = { type: "number", minimum: 0, maximum: 0 }, integer = { type: "integer", minimum: 0, maximum: 0 };
    const a = await capabilityVersion(providers[0], { ...providers[0].manifest, version: "10.0.0", inputSchema: number, outputSchema: number });
    const c = await capabilityVersion(providers[1], { ...providers[1].manifest, version: "10.0.0", inputSchema: integer, outputSchema: integer });
    const document = plan({ inputSchema: number, outputSchema: integer });
    document.steps[0].capability = { capabilityId: a.capabilityId, version: a.version, manifestDigest: a.manifestDigest };
    document.steps[1].capability = { capabilityId: c.capabilityId, version: c.version, manifestDigest: c.manifestDigest };
    const checked = await validate(await createPlan(document));
    assert.ok(checked.body.validation.report.issues.some(i => i.code === "edge_indeterminate"));
    const decision = expect(await approval(checked), 201);
    expect(await api(`${versionPath(checked)}/publish`, publisher, { approvalId: decision.body.approvalId }, etag(checked)), 409);
    const mismatch = plan(); mismatch.steps[1].capability = document.steps[1].capability;
    assert.ok((await validate(await createPlan(mismatch))).body.validation.report.issues.some(i => i.code === "edge_incompatible"));
    for (const [ver, published] of [["11.0.0", false], ["12.0.0", true]]) {
      const reference = await capabilityVersion(providers[0], { ...providers[0].manifest, version: ver }, published);
      if (published) {
        const revoked = await publicApi(`/v1/capabilities/${encodeURIComponent(reference.capabilityId)}/versions/${ver}/revoke`, owner, { reason: "technical revoked pin" }, { "If-Match": reference.etag });
        assert.equal(revoked.status, 200);
      }
      const doc = plan(); doc.steps[0].capability = { capabilityId: reference.capabilityId, version: reference.version, manifestDigest: reference.manifestDigest };
      assert.equal((await validate(await createPlan(doc))).body.validation.status, "invalid");
    }
  });
});

test("C4B: all registry lifecycle routes and approval lookup/revocation use exact ETags", async () => {
  const root = await createPlan();
  expect(await api(`/v1/compositions/${root.body.compositionId}`, consumer, plan()), 404);
  const next = expect(await api(`/v1/compositions/${root.body.compositionId}/versions`, consumer, plan()), 201);
  expect(await api(versionPath(next)), 200);
  expect(await api(`${versionPath(next)}/validate`, consumer, {}), 428);
  const checked = await validate(next), decision = expect(await approval(checked), 201);
  expect(await api(`/v1/approvals/${decision.body.approvalId}`, approver), 200);
  expect(await api(`/v1/approvals/${decision.body.approvalId}/revoke`, approver, { reason: "technical revoke" }, etag(decision)), 200);
  expect(await api(`${versionPath(checked)}/publish`, publisher, { approvalId: decision.body.approvalId }, etag(checked)), 409);
  const active = await publish();
  const deprecated = expect(await api(`${versionPath(active)}/deprecate`, consumer, { reason: "technical deprecation" }, etag(active)), 200);
  const revoked = expect(await api(`${versionPath(deprecated)}/revoke`, consumer, { reason: "technical revocation" }, etag(deprecated)), 200);
  assert.equal(revoked.body.state, "revoked"); expect(await start(execution(revoked)), 404);
});

test("C4B: missing, discover-only, expired and revoked authority cannot dispatch", async () => {
  await noDispatch(async () => {
    expect(await start(execution(), randomUUID(), other), 404);
    for (const provider of providers) await grant(provider, ["discover"], other);
    expect(await start(execution(), randomUUID(), other), 404);
    expect(await start(execution(), randomUUID(), foreign), 404);
    expect(await start({ ...execution(), subject: consumer.subject }), 400);
    expect(await start({ ...execution(), appId: consumer.app.appId }), 400);
    const forged = { token: consumer.token.slice(0, -12) + "invalidtoken" };
    expect(await start(execution(), randomUUID(), forged), 401);
    await revoke(providers[1]);
    expect(await start(), 403);
    providers[1].grant = await grant(providers[1]);
  });
});

test("C4B: current consumer grants, expiration and suspended apps block dispatch", async () => {
  await noDispatch(async () => {
    await revoke(providers[1]);
    const discover = await grant(providers[1], ["discover"]);
    expect(await start(), 403);
    const revoked = await publicApi(`/v1/trust/grants/${discover.body.grantId}/revoke`, owner, { reason: "technical discover grant" }, etag(discover));
    assert.equal(revoked.status, 200);
    const expired = await grant(providers[1], ["invoke"], consumer, 4000);
    await delay(Math.max(0, Date.parse(expired.body.proposal.expiresAt) - Date.now() + 100));
    expect(await start(), 403);
    providers[1].grant = await grant(providers[1]);
    for (const target of [providers[0], consumer]) {
      const suspended = await publicApi(`/v1/applications/${target.app.appId}/state`, approver, { action: "suspend", reason: "technical C4B suspension" }, { "If-Match": target.etag });
      assert.equal(suspended.status, 200); const value = await suspended.json();
      assert.ok([403, 404].includes((await start()).status));
      const approval = await publicApi("/v1/approvals", approver, { resourceType: "application", resourceId: value.appId, resourceDigest: value.digest,
        resourceRevision: value.revision, requesterSubject: value.ownerSubject, requesterAppId: value.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
      assert.equal(approval.status, 201);
      const active = await publicApi(`/v1/applications/${value.appId}/state`, approver, { action: "reactivate", reason: "technical restore", approvalId: (await approval.json()).approvalId }, { "If-Match": suspended.headers.get("etag") });
      assert.equal(active.status, 200); target.etag = active.headers.get("etag"); target.app = await active.json();
    }
  });
});

test("C4B: concurrent duplicate submissions reserve and dispatch one process", async () => {
  await runtime.control("pause");
  const before = await states(), key = randomUUID(), body = execution();
  const results = await Promise.all([start(body, key), start(body, key)]);
  assert.deepEqual(results.map(r => r.status).sort(), [200, 202]);
  assert.equal(results[0].body.executionId, results[1].body.executionId);
  await runtime.control("resume"); await terminal(results[0].body.executionId, "succeeded");
  const row = await stored(results[0].body.executionId);
  const history = await runtime.engine(`/service/history/historic-process-instances?businessKey=${row.engine_business_key}&tenantId=tenant-a`);
  assert.equal(history.body.total, 1);
  assert.deepEqual((await states()).map(s => s.count), before.map(s => s.count + 1));
});

test("C4B: a replacement grant cannot revive an execution bound to a revoked grant", async () => {
  await runtime.control("pause"); const before = await states(), body = execution(), key = randomUUID();
  const accepted = expect(await start(body, key), 202);
  await revoke(providers[1]); providers[1].grant = await grant(providers[1]);
  expect(await start(body, key), 403);
  await runtime.control("once"); assert.equal((await stored(accepted.body.executionId)).state, "failed");
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
  await runtime.control("resume");
  const fresh = expect(await start(body), 202); await terminal(fresh.body.executionId, "succeeded");
});

test("C4B: wrong provider, step, input binding and expired tickets fail closed", async () => {
  await runtime.mode("hold-redemption", 0);
  const before = await states(), accepted = expect(await start(), 202);
  await until(() => runtime.providerState(0), r => r.body.pending === 1, "unredeemed ticket");
  const last = (await runtime.providerState(0)).body.last;
  const body = { ticket: last.ticket, invocationId: last.invocationId, inputDigest: last.inputDigest };
  for (const [who, changed] of [[providers[1], body], [providers[0], { ...body, inputDigest: `sha256:${"f".repeat(64)}` }],
    [providers[0], { ...body, stepId: "validate" }], [providers[0], { ...body, manifestDigest: providers[1].reference.manifestDigest }],
    [providers[0], { ...body, invocationId: randomUUID() }]]) {
    const denied = expect(await api("/v1/capability-authorizations/introspect", who, changed), 200); assert.equal(denied.body.active, false);
  }
  await sql(`UPDATE composition_private.execution_steps SET ticket_expires_at=clock_timestamp()-interval '1 second' WHERE execution_id=${q(accepted.body.executionId)} AND step_index=0;`);
  assert.equal(expect(await api("/v1/capability-authorizations/introspect", providers[0], body), 200).body.active, false);
  await runtime.mode("normal", 0); await terminal(accepted.body.executionId, "failed");
  const after = await states(); assert.equal(after[0].count, before[0].count); assert.equal(after[1].received, before[1].received);
});

test("C4B: real forged Flowable jobs and unknown reservations are quarantined before dispatch", async () => {
  await noDispatch(async () => {
    await runtime.control("resume");
    for (const tenant of ["tenant-a", "tenant-b"]) {
      await runtime.forgeJob(tenant, { businessKey: `c4b:${tenant}:${randomUUID()}`, elementId: "step_0" }); await runtime.control("tick");
    }
    assert.ok((await runtime.control("pause")).body.quarantined >= 2);
    await runtime.control("resume");
  });
});

test("C4B: wrong process, definition and tenant correlation cannot dispatch an existing reservation", async () => {
  await runtime.control("pause");
  await noDispatch(async () => {
    const accepted = expect(await start(), 202), row = await stored(accepted.body.executionId);
    expect(await runtime.engine(`/service/runtime/process-instances/${row.engine_process_id}`, undefined, "DELETE"), 204);
    for (const tenant of ["tenant-a", "tenant-b"]) {
      await runtime.forgeJob(tenant, { businessKey: row.engine_business_key, elementId: "step_0" });
      await runtime.control("once");
    }
    assert.equal((await stored(row.execution_id)).current_step, 0);
  });
  await runtime.control("resume");
});

test("C4B: provider failures and uncertain receipts never advance or retry", { timeout: 120000 }, async () => {
  for (const [mode, state] of [["unavailable", "failed"], ["offline", "failed"], ["invalid-output", "failed"], ["invalid-json", "failed"],
    ["oversized", "outcome_unknown"], ["redirect", "outcome_unknown"], ["lost-response", "outcome_unknown"], ["slow-response", "outcome_unknown"]]) {
    await runtime.mode(mode, 0); const before = await states();
    const key = randomUUID(), body = execution();
    const accepted = expect(await start(body, key), 202);
    await terminal(accepted.body.executionId, state);
    expect(await start(body, key), 200); await runtime.control("tick");
    const after = await states();
    assert.equal(after[1].received, before[1].received, mode);
    assert.ok(after[0].received <= before[0].received + 1, mode);
    await runtime.mode("normal", 0);
  }
});

test("C4B: restart loses authority, preserves reservation and never supplies administrative credentials", async () => {
  await runtime.control("pause"); const before = await states();
  const body = execution(), key = randomUUID();
  const accepted = expect(await start(body, key), 202), row = await stored(accepted.body.executionId);
  await runtime.restart(); await terminal(row.execution_id, "auth_required");
  const replay = expect(await start(body, key), 200); assert.equal(replay.body.state, "auth_required");
  await runtime.control("resume"); await runtime.control("tick");
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
  assert.equal((await stored(row.execution_id)).engine_process_id, row.engine_process_id);
  assert.ok((await runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`)).body.endTime);
});

test("C4B: a lost engine-start response reconciles one authoritative process", async () => {
  await runtime.control("fault/start-response-lost");
  const accepted = expect(await start(), 202);
  await terminal(accepted.body.executionId, "succeeded");
  const row = await stored(accepted.body.executionId);
  const history = expect(await runtime.engine(`/service/history/historic-process-instances?businessKey=${row.engine_business_key}&tenantId=tenant-a`), 200);
  assert.equal(history.body.total, 1);
});

test("C4B: ambiguous reservation without an engine match is never started blindly", async () => {
  await runtime.control("fault/start-before-send");
  const before = await states(), body = execution(), key = randomUUID();
  expect(await start(body, key), 409);
  const replay = expect(await start(body, key), 200), row = await stored(replay.body.executionId);
  assert.ok(row.engine_start_attempted_at); assert.equal(row.engine_process_id, null);
  const matches = expect(await runtime.engine(`/service/history/historic-process-instances?businessKey=${row.engine_business_key}&tenantId=tenant-a`), 200);
  assert.equal(matches.body.total, 0);
  await runtime.restart();
  expect(await api(`/v1/capability-executions/${row.execution_id}`), 503);
  assert.equal((await stored(row.execution_id)).state, "auth_required");
  expect(await start(body, key), 200);
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
  await runtime.control("resume");
});

test("C4B: crash after durable reservation before engine reservation fails closed", async () => {
  await runtime.control("pause"); await runtime.control("fault/definition-outage");
  const before = await states(), body = execution(), key = randomUUID();
  expect(await start(body, key), 503);
  const replay = expect(await start(body, key), 200), row = await stored(replay.body.executionId);
  assert.equal(row.engine_start_attempted_at, null); assert.equal(row.engine_process_id, null);
  await runtime.restart(); await terminal(row.execution_id, "auth_required");
  expect(await start(body, key), 200); await runtime.control("resume"); await runtime.control("tick");
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
});

test("C4B: missing authoritative engine history leaves a start unbound and never dispatches", async () => {
  await runtime.control("pause"); await runtime.control("fault/start-history-unavailable");
  await noDispatch(async () => {
    const body = execution(), key = randomUUID(); expect(await start(body, key), 503);
    const replay = expect(await start(body, key), 200), row = await stored(replay.body.executionId);
    assert.ok(row.engine_start_attempted_at); assert.equal(row.engine_process_id, null);
    await runtime.restart(); await terminal(row.execution_id, "auth_required");
    expect(await start(body, key), 200);
  });
  await runtime.control("resume");
});

test("C4B: multiple matching engine processes require reconciliation and never dispatch", async () => {
  await runtime.control("pause"); await runtime.control("fault/start-multiple");
  await noDispatch(async () => {
    const body = execution(), key = randomUUID(); expect(await start(body, key), 409);
    const replay = expect(await start(body, key), 200), row = await stored(replay.body.executionId);
    assert.equal(row.engine_process_id, null);
    const matches = expect(await runtime.engine(`/service/runtime/process-instances?businessKey=${row.engine_business_key}&tenantId=tenant-a`), 200);
    assert.equal(matches.body.total, 2);
    await runtime.restart(); expect(await api(`/v1/capability-executions/${row.execution_id}`), 503);
    expect(await start(body, key), 200);
    for (const process of matches.body.data) expect(await runtime.engine(`/service/runtime/process-instances/${process.id}`, undefined, "DELETE"), 204);
  });
  await runtime.control("resume");
});

test("C4B: uncertain worker completion cannot claim success or dispatch downstream", async () => {
  await runtime.control("fault/completion-response-lost"); const before = await states();
  const accepted = expect(await start(), 202);
  await terminal(accepted.body.executionId, "outcome_unknown");
  assert.equal((await runtime.providerState(1)).body.received, before[1].received);
  const row = await stored(accepted.body.executionId);
  assert.ok((await runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`)).body.endTime);
});

test("C4B: deadline blocks new steps, termination failures remain visible and recoverable", async () => {
  await runtime.control("pause"); const before = await states();
  const accepted = expect(await start(), 202), id = accepted.body.executionId;
  // Operator fault injection advances only this synthetic reservation's deadline.
  await sql(`UPDATE composition_private.executions SET deadline_at=clock_timestamp()-interval '1 second' WHERE execution_id=${q(id)};`);
  await runtime.control("fault/termination-outage");
  const failed = expect(await api(`/v1/capability-executions/${id}`), 503);
  assert.equal(failed.body.error, "workflow_termination_unconfirmed"); assert.equal((await stored(id)).state, "timed_out");
  await runtime.control("fault/clear"); await terminal(id, "timed_out");
  const row = await stored(id);
  assert.ok((await runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`)).body.endTime);
  await runtime.control("resume"); await runtime.control("tick");
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
});

test("C4B: actual BPMN deadline timer terminates queued work without a Core scheduler", async () => {
  await runtime.control("pause"); const before = await states();
  const active = await publish(plan({ deadlineMs: 11000 }));
  const accepted = expect(await start(execution(active)), 202), row = await stored(accepted.body.executionId);
  await delay(Math.max(0, Date.parse(row.deadline_at) - Date.now() + 100));
  await until(() => runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`), r => r.body.endTime,
    "engine-owned BPMN timer must complete before any Core status cleanup");
  await terminal(row.execution_id, "timed_out");
  assert.ok((await runtime.engine(`/service/history/historic-process-instances/${row.engine_process_id}`)).body.endTime);
  await runtime.control("resume"); await runtime.control("tick");
  assert.deepEqual((await states()).map(s => s.received), before.map(s => s.received));
});

test("C4B: late provider completion cannot overwrite an uncertain terminal outcome", async () => {
  await runtime.mode("hold-response", 0); const before = await states();
  const accepted = expect(await start(), 202), id = accepted.body.executionId;
  await until(() => runtime.providerState(0), r => r.body.pendingResponses === 1, "held provider result");
  await sql(`UPDATE composition_private.executions SET deadline_at=clock_timestamp()-interval '1 second' WHERE execution_id=${q(id)};`);
  await terminal(id, "outcome_unknown");
  const revision = (await stored(id)).revision;
  await runtime.mode("normal", 0);
  await until(() => runtime.control("pause"), r => !r.body.busy, "late completion persistence guard");
  const row = await stored(id); assert.equal(row.state, "outcome_unknown"); assert.equal(row.output, null); assert.equal(row.revision, revision);
  assert.equal((await runtime.providerState(1)).body.received, before[1].received);
  await runtime.control("resume");
});

test("C4B: crash after provider receipt preserves operation and becomes outcome_unknown", async () => {
  await runtime.mode("slow-response", 0); const before = await states();
  const accepted = expect(await start(), 202);
  await until(() => runtime.providerState(0), r => r.body.count === before[0].count + 1, "provider receipt");
  const operation = (await runtime.providerState(0)).body.last.operationId;
  await runtime.restart(); await terminal(accepted.body.executionId, "outcome_unknown");
  await runtime.mode("normal", 0); await runtime.control("resume"); await runtime.control("tick");
  const after = await states(); assert.equal(after[0].count, before[0].count + 1); assert.equal(after[1].received, before[1].received);
  const storedOperation = (await sql(`SELECT operation_id FROM composition_private.execution_steps WHERE execution_id=${q(accepted.body.executionId)} AND step_index=0;`)).stdout.trim();
  assert.equal(storedOperation, operation);
});

test("C4B: revoking Step 2 during Step 1 independently blocks Step 2 dispatch", async () => {
  await runtime.mode("hold-redemption", 0); const before = await states();
  const accepted = expect(await start(), 202);
  await until(() => runtime.providerState(0), r => r.body.pending === 1, "held first provider");
  await revoke(providers[1]); await runtime.mode("normal", 0);
  await until(() => stored(accepted.body.executionId), r => ["failed", "outcome_unknown"].includes(r.state), "revocation fail closed");
  assert.equal((await runtime.providerState(1)).body.received, before[1].received);
  providers[1].grant = await grant(providers[1]);
});

test("C4B: revocation after persisted Step 1 output blocks Step 2 independently", async () => {
  await runtime.control("pause"); const before = await states();
  const accepted = expect(await start(), 202);
  await runtime.control("once"); assert.equal((await stored(accepted.body.executionId)).current_step, 1);
  await revoke(providers[1]); await runtime.control("once");
  assert.equal((await stored(accepted.body.executionId)).state, "failed");
  const after = await states(); assert.equal(after[0].count, before[0].count + 1); assert.equal(after[1].received, before[1].received);
  providers[1].grant = await grant(providers[1]); await runtime.control("resume");
});

test("C4B: backup/restore preserves real composition outcomes, step identity, RLS and audit", { timeout: 120000 }, async () => {
  const snapshot = JSON.parse((await sql(`SELECT jsonb_agg(jsonb_build_object('execution',to_jsonb(e),'steps',
    (SELECT jsonb_agg(to_jsonb(s) ORDER BY step_index) FROM composition_private.execution_steps s WHERE s.execution_id=e.execution_id),
    'auditCount',(SELECT count(*) FROM app_private.audit WHERE resource_id=e.execution_id))) FROM
    (SELECT DISTINCT ON(state) * FROM composition_private.executions WHERE consumer_app_id=${q(consumer.app.appId)}
    AND state IN ('succeeded','failed','timed_out','auth_required','outcome_unknown') ORDER BY state,created_at DESC) e;`)).stdout.trim());
  assert.deepEqual(snapshot.map(s => s.execution.state).sort(), ["auth_required", "failed", "outcome_unknown", "succeeded", "timed_out"]);
  const env = { ...process.env, COMPOSITION_RECOVERY_CASES: JSON.stringify(snapshot) }; delete env.NODE_TEST_CONTEXT;
  const result = await run(process.execPath, ["--env-file=.env", "--test", "integration/recovery.mjs"], { env, timeout: 120000, maxBuffer: 2097152 });
  assert.match(result.stdout, /Composition restore: 5 durable outcomes/);
});

test("C4B: protected audit failure rolls back reservation/dispatch and preserves unknown provider outcome", async () => {
  for (const [event, expected] of [["execution.accepted", null], ["invocation.dispatched", "failed"], ["execution.step_completed", "outcome_unknown"]]) {
    const trigger = `composition_fault_${randomBytes(5).toString("hex")}`;
    await sql(`CREATE FUNCTION app_private.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
      IF NEW.event=${q(event)} AND EXISTS(SELECT FROM composition_private.executions WHERE execution_id=NEW.resource_id AND consumer_app_id=${q(consumer.app.appId)})
      THEN RAISE EXCEPTION 'synthetic audit outage'; END IF; RETURN NEW; END $f$;
      CREATE TRIGGER ${trigger} BEFORE INSERT ON app_private.audit FOR EACH ROW EXECUTE FUNCTION app_private.${trigger}();`);
    const before = await states();
    try {
      const accepted = await start();
      if (!expected) expect(accepted, 503);
      else { expect(accepted, 202); await terminal(accepted.body.executionId, expected); }
      const after = await states();
      assert.equal(after[1].received, before[1].received);
      assert.equal(after[0].count, before[0].count + (event === "execution.step_completed" ? 1 : 0));
      if (event !== "execution.step_completed") assert.equal(after[0].received, before[0].received);
    } finally { await sql(`DROP TRIGGER ${trigger} ON app_private.audit; DROP FUNCTION app_private.${trigger}();`); }
  }
});

test("C4B: successful HTTP representations conform to the implemented OpenAPI schemas", async () => {
  await verifyContracts("compositions", observations, "--capability-runtime");
});
