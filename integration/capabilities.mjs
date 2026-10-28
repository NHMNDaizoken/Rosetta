// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { promisify } from "node:util";

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer = `${base}/identity/realms/rosetta`;
const prefix = `cap-test-${randomBytes(6).toString("hex")}`;
const fixture = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url)));
const clientIds = [];
const users = [];
const run = (...args) => promisify(execFile)("docker", args, { timeout: 180000 });
const sql = text => run("compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", text);
const q = value => `'${String(value).replaceAll("'", "''")}'`;
let adminToken, owner, approver, publisher, stranger, foreign, app, appEtag, capabilityId;

async function operatorToken() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "rosetta-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD }), signal: AbortSignal.timeout(5000) });
      if (response.status === 200) return (await response.json()).access_token;
    } catch { /* The real database/Core recreation can leave stale IdP connections. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail("Operator authentication did not recover within thirty seconds");
}
async function admin(path, body, method = "GET") {
  return fetch(`${base}/identity/admin/realms/rosetta/${path}`, { method, headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
}
async function login(username, password, clientId) {
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: clientId, response_type: "code", scope: "openid", redirect_uri: "http://127.0.0.1:9876/callback", code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const page = await fetch(`${issuer}/protocol/openid-connect/auth?${params}`, { redirect: "manual" });
  const cookies = page.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const action = (await page.text()).match(/<form[^>]*action="([^"]+)"/); assert.ok(action);
  const response = await fetch(action[1].replaceAll("&amp;", "&"), { method: "POST", redirect: "manual", headers: { Cookie: cookies }, body: new URLSearchParams({ username, password, credentialId: "" }) });
  assert.equal(response.status, 302, "real human PKCE authentication");
  const code = new URL(response.headers.get("location")).searchParams.get("code"); assert.ok(code);
  const tokens = await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, redirect_uri: "http://127.0.0.1:9876/callback", code, code_verifier: verifier }) });
  assert.equal(tokens.status, 200); return (await tokens.json()).access_token;
}
async function human(label, tenant, permissions) {
  const clientId = `${prefix}-management-${tenant}`;
  const username = `${prefix}-${label}`, password = randomBytes(32).toString("hex");
  const result = await admin("users", { username, enabled: true, firstName: "Technical", lastName: "Fixture", email: `${username}@example.invalid`, emailVerified: true, attributes: { tenant_id: [tenant] }, credentials: [{ type: "password", value: password, temporary: false }] }, "POST");
  assert.equal(result.status, 201); const id = result.headers.get("location").split("/").at(-1); users.push(id);
  const group = (await (await admin(`groups?search=${tenant}&exact=true`)).json()).find(value => value.name === tenant); assert.ok(group);
  assert.equal((await admin(`users/${id}/groups/${group.id}`, undefined, "PUT")).status, 204);
  const role = await (await admin("roles/core-reader")).json();
  assert.equal((await admin(`users/${id}/role-mappings/realm`, [role], "POST")).status, 204);
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions) VALUES(${q(tenant)},${q(issuer)},${q(id)},${q(clientId)},ARRAY[${permissions.map(q).join(",")}]::text[]);`);
  return { id, token: await login(username, password, clientId) };
}
async function api(path, who, body, headers = {}, method = body === undefined ? "GET" : "POST") {
  return fetch(base + path, { method, headers: { ...(who ? { Authorization: `Bearer ${who.token ?? who}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
}
function manifest(version = "1.0.0", title = "Technical echo") {
  return {
    ...structuredClone(fixture),
    capabilityId,
    providerAppId: app.appId,
    version,
    title,
    requiredPermissions: [`urn:rosetta:permission:${app.appId}:invoke`],
  };
}
async function register(version = "1.0.0", title = "Technical echo") {
  return api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions`, owner, manifest(version, title));
}
async function action(version, name, who, body, etag) {
  return api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/${version}/${name}`, who, body, etag ? { "If-Match": etag } : {});
}
async function approvalFor(value, decision = "approve", patch = {}) {
  return api("/v1/approvals", approver, {
    resourceType: "capability-version", resourceId: `${capabilityId}@${value.version}`,
    resourceDigest: value.digest, resourceRevision: value.revision,
    requesterSubject: owner.id, requesterAppId: app.appId, decision,
    expiresAt: new Date(Date.now() + 120000).toISOString(), ...patch,
  });
}

before(async () => {
  adminToken = await operatorToken();
  const template = (await (await admin("clients?clientId=tenant-a")).json())[0];
  const source = await (await admin(`clients/${template.id}`)).json();
  for (const tenant of ["tenant-a", "tenant-b"]) {
    const protocolMappers = structuredClone(source.protocolMappers);
    for (const mapper of protocolMappers) delete mapper.id;
    protocolMappers.find(mapper => mapper.name === "tenant").config["claim.value"] = tenant;
    const management = await admin("clients", { clientId: `${prefix}-management-${tenant}`, enabled: true, protocol: "openid-connect", publicClient: true, standardFlowEnabled: true, directAccessGrantsEnabled: false, redirectUris: ["http://127.0.0.1:9876/callback"], attributes: { "pkce.code.challenge.method": "S256" }, protocolMappers }, "POST");
    assert.equal(management.status, 201); clientIds.push(management.headers.get("location").split("/").at(-1));
  }

  owner = await human("owner", "tenant-a", ["applications.register", "capabilities.write", "capabilities.approve"]);
  approver = await human("approver", "tenant-a", ["applications.approve", "trust.approve", "capabilities.approve"]);
  publisher = await human("publisher", "tenant-a", ["capabilities.write", "capabilities.publish"]);
  stranger = await human("stranger", "tenant-a", ["capabilities.write"]);
  foreign = await human("foreign", "tenant-b", ["capabilities.write", "capabilities.approve"]);

  const providerClient = await admin("clients", { clientId: `${prefix}-provider`, enabled: true, protocol: "openid-connect", publicClient: false, serviceAccountsEnabled: true, standardFlowEnabled: false }, "POST");
  assert.equal(providerClient.status, 201); clientIds.push(providerClient.headers.get("location").split("/").at(-1));
  const body = { displayName: "Technical capability provider", oauthClientId: `${prefix}-provider`, providerOrigin: `https://${prefix}-provider.example.invalid` };
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin) VALUES('tenant-a',${q(issuer)},${q(body.oauthClientId)},${q(owner.id)},${q(body.providerOrigin)});`);
  const created = await api("/v1/applications", owner, body); assert.equal(created.status, 201);
  const pending = await created.json(); appEtag = created.headers.get("etag");
  const decision = await api("/v1/approvals", approver, { resourceType: "application", resourceId: pending.appId, resourceDigest: pending.digest, resourceRevision: pending.revision, requesterSubject: pending.ownerSubject, requesterAppId: pending.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
  assert.equal(decision.status, 201); const approvalId = (await decision.json()).approvalId;
  const activated = await api(`/v1/applications/${pending.appId}/approve`, approver, { approvalId }, { "If-Match": appEtag });
  assert.equal(activated.status, 200); app = await activated.json(); appEtag = activated.headers.get("etag");
  capabilityId = `urn:rosetta:capability:${app.appId}:echo`;
});

after(async () => {
  adminToken = await operatorToken();
  if (users.length) {
    const ids = users.map(q).join(",");
    const apps = `SELECT app_id FROM app_private.applications WHERE owner_subject IN (${ids})`;
    await sql(`DELETE FROM app_private.capability_publication_approvals WHERE requester_app_id IN (${apps}) OR version_id IN (SELECT version_id FROM app_private.capability_versions WHERE provider_app_id IN (${apps}));
      DELETE FROM app_private.capability_versions WHERE provider_app_id IN (${apps});
      DELETE FROM app_private.audit WHERE subject IN (${ids});
      DELETE FROM app_private.approvals WHERE app_id IN (${apps}); DELETE FROM app_private.applications WHERE owner_subject IN (${ids});
      DELETE FROM app_private.enrollments WHERE owner_subject IN (${ids}); DELETE FROM app_private.principals WHERE subject IN (${ids});`);
  }
  for (const id of clientIds) assert.equal((await admin(`clients/${id}`, undefined, "DELETE")).status, 204);
  for (const id of users) assert.equal((await admin(`users/${id}`, undefined, "DELETE")).status, 204);
});

test("owned draft lifecycle, independent approval and immutable publication", async () => {
  const created = await register(); assert.equal(created.status, 201);
  const original = await created.json(); const originalEtag = created.headers.get("etag");
  assert.equal(original.state, "draft");
  assert.match(original.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await register()).status, 409, "duplicate version");

  const fetched = await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.0`, owner);
  assert.equal(fetched.status, 200); assert.equal(fetched.headers.get("etag"), originalEtag);

  const stale = await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.0`, owner, manifest("1.0.0", "Changed"), { "If-Match": '"capability-version-stale-1"' }, "PUT");
  assert.equal(stale.status, 412);

  const updated = await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.0`, owner, manifest("1.0.0", "Changed"), { "If-Match": originalEtag }, "PUT");
  assert.equal(updated.status, 200); const draft = await updated.json(); const draftEtag = updated.headers.get("etag");
  assert.equal(draft.revision, 2); assert.notEqual(draft.digest, original.digest);

  const invalid = await action("1.0.0", "validate", owner, { ignored: true }, draftEtag);
  assert.equal(invalid.status, 400);

  const validation = await action("1.0.0", "validate", owner, {}, draftEtag);
  assert.equal(validation.status, 200); const report = await validation.json(); const validatedEtag = validation.headers.get("etag");
  assert.equal(report.status, "valid"); assert.equal(report.digest, draft.digest); assert.equal(report.revision, draft.revision);
  assert.equal(validatedEtag, draftEtag, "validation does not change content revision");

  const self = await api("/v1/approvals", owner, { resourceType: "capability-version", resourceId: `${capabilityId}@1.0.0`, resourceDigest: draft.digest, resourceRevision: draft.revision, requesterSubject: owner.id, requesterAppId: app.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
  assert.equal(self.status, 403, "owner cannot approve");

  const denied = await approvalFor(draft, "deny");
  assert.equal(denied.status, 201); const deniedValue = await denied.json(); assert.equal(deniedValue.state, "denied");
  assert.equal((await action("1.0.0", "publish", publisher, { approvalId: deniedValue.approvalId }, validatedEtag)).status, 409);

  const decision = await approvalFor(draft); assert.equal(decision.status, 201);
  const approval = await decision.json(); assert.equal(approval.state, "approved");
  assert.equal((await action("1.0.0", "publish", owner, { approvalId: approval.approvalId }, validatedEtag)).status, 403, "owner cannot publish without permission");

  const published = await action("1.0.0", "publish", publisher, { approvalId: approval.approvalId }, validatedEtag);
  assert.equal(published.status, 200); const publishedValue = await published.json(); const publishedEtag = published.headers.get("etag");
  assert.equal(publishedValue.state, "published");
  assert.equal((await action("1.0.0", "publish", publisher, { approvalId: approval.approvalId }, publishedEtag)).status, 409);
  assert.equal((await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.0`, owner, manifest(), { "If-Match": publishedEtag }, "PUT")).status, 409, "published content is immutable");

  const deprecated = await action("1.0.0", "deprecate", owner, { reason: "technical lifecycle test" }, publishedEtag);
  assert.equal(deprecated.status, 200); const deprecatedValue = await deprecated.json(); const deprecatedEtag = deprecated.headers.get("etag");
  assert.equal(deprecatedValue.state, "deprecated");
  const revoked = await action("1.0.0", "revoke", owner, { reason: "technical terminal test" }, deprecatedEtag);
  assert.equal(revoked.status, 200); assert.equal((await revoked.json()).state, "revoked");
  assert.equal((await action("1.0.0", "revoke", owner, { reason: "again" }, revoked.headers.get("etag"))).status, 409);
});

test("stale approval after draft change, foreign tenant and non-owner isolation", async () => {
  const created = await register("1.0.1", "Second version"); assert.equal(created.status, 201);
  const draft = await created.json(); const etag = created.headers.get("etag");
  const validation = await action("1.0.1", "validate", owner, {}, etag); assert.equal(validation.status, 200);
  const validated = await validation.json(); const validatedEtag = validation.headers.get("etag");
  const decision = await approvalFor({ ...draft, digest: validated.digest, revision: validated.revision }); assert.equal(decision.status, 201);
  const approvalId = (await decision.json()).approvalId;

  const changed = await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.1`, owner, manifest("1.0.1", "Changed after approval"), { "If-Match": validatedEtag }, "PUT");
  assert.equal(changed.status, 200); const changedEtag = changed.headers.get("etag");
  assert.equal((await action("1.0.1", "publish", publisher, { approvalId }, changedEtag)).status, 409, "stale approval");

  const fetched = await api(`/v1/approvals/${approvalId}`, approver); assert.equal(fetched.status, 200);
  const approvalEtag = fetched.headers.get("etag");
  assert.equal((await api(`/v1/approvals/${approvalId}`, foreign)).status, 404, "foreign approval hidden");
  assert.equal((await api(`/v1/approvals/${approvalId}/revoke`, approver, { reason: "stale technical approval" }, { "If-Match": approvalEtag })).status, 200);
  assert.equal((await action("1.0.1", "publish", publisher, { approvalId }, changedEtag)).status, 409, "revoked approval");

  const list = await api("/v1/capabilities", owner); assert.equal(list.status, 200);
  const items = (await list.json()).items; assert.ok(items.some(item => item.capabilityId === capabilityId));
  const strangerList = await api("/v1/capabilities", stranger); assert.equal(strangerList.status, 200); assert.equal((await strangerList.json()).items.length, 0);
  assert.equal((await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.1`, stranger)).status, 404);
  assert.equal((await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/1.0.1`, foreign)).status, 404, "foreign version hidden");
  assert.equal((await api("/v1/capabilities", foreign)).status, 200);
  assert.equal((await (await api("/v1/capabilities", foreign)).json()).items.length, 0);
  assert.equal((await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions`, foreign, manifest("9.9.9"))).status, 403, "foreign app reference hidden");
});

test("private registry roles cannot read tables or invoke other command functions", async () => {
  const acl = await sql("SELECT has_schema_privilege('rosetta_capability_api','app_private','USAGE'),has_table_privilege('rosetta_capability_api','app_private.capability_versions','SELECT'),has_function_privilege('rosetta_capability_api','core.capability_command(text,jsonb)','EXECUTE'),has_function_privilege('rosetta_capability_api','core.application_command(text,jsonb)','EXECUTE');");
  assert.equal(acl.stdout.trim(), "f|f|t|f");
});

test("approval resource syntax is rejected before lookup and foreign versions stay concealed", async () => {
  const proposal = { version: "1.0.0", digest: `sha256:${"0".repeat(64)}`, revision: 1 };
  for (const resourceId of [`${capabilityId}@latest`, `${capabilityId}@01.0.0`, `${capabilityId}@1.0`, `${capabilityId}@1.0.0@2.0.0`, `${capabilityId}@1.0.0\n`, "not-a-capability"]) {
    const response = await approvalFor(proposal, "approve", { resourceId });
    assert.equal(response.status, 400, `malformed reference: ${resourceId}`);
  }
  const missing = await approvalFor(proposal, "approve", { resourceId: `${capabilityId}@99.0.0` });
  assert.equal(missing.status, 404, "well-formed missing version");
  assert.equal((await approvalFor(proposal, "approve", { resourceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).status, 404);
  const hidden = await api("/v1/approvals", foreign, {
    resourceType: "capability-version", resourceId: `${capabilityId}@1.0.0`,
    resourceDigest: proposal.digest, resourceRevision: 1, requesterSubject: owner.id,
    requesterAppId: app.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString(),
  });
  assert.equal(hidden.status, 404, "authorized foreign approver cannot detect version existence");
  const claims = JSON.stringify({ tenant_id: "tenant-a", iss: issuer, sub: approver.id, client_id: `${prefix}-management-tenant-a` });
  const invalid = await sql(`SET ROLE rosetta_capability_api; SELECT set_config('request.jwt.claims',${q(claims)},false);
    SELECT core.capability_command('approval_create','{"decision":{"resourceId":"malformed@latest"}}'::jsonb)->>'status';`);
  assert.equal(invalid.stdout.trim().split(/\r?\n/).at(-1), "400", "private RPC rejects malformed IDs too");
});

test("private Trust persistence is owner-controlled and tenant RLS is forced", async () => {
  const acl = await sql(`SELECT n.nspowner::regrole, bool_and(c.relrowsecurity AND c.relforcerowsecurity)
    FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid WHERE n.nspname='trust_private' AND c.relkind='r' GROUP BY n.nspowner;
    SELECT has_schema_privilege('rosetta_api','trust_private','USAGE'),
      has_table_privilege('rosetta_app_api','trust_private.grants','INSERT'),
      has_table_privilege('rosetta_capability_api','trust_private.approvals','UPDATE'),
      has_function_privilege('rosetta_capability_api','app_private.capability_command_c1(text,jsonb)','EXECUTE');`);
  assert.equal(acl.stdout.trim(), "rosetta_app_owner|t\nf|f|f|f");
});
