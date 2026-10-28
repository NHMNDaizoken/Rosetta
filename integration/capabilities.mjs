// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { before, after, test } from "node:test";
import { promisify } from "node:util";
import { verifyContracts } from "./contract.mjs";

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer = `${base}/identity/realms/rosetta`;
const prefix = `cap-test-${randomBytes(6).toString("hex")}`;
const fixture = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url)));
const clientIds = [];
const users = [];
const trustCases = [];
const run = (...args) => promisify(execFile)("docker", args, { timeout: 180000 });
const sql = text => run("compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", text);
const q = value => `'${String(value).replaceAll("'", "''")}'`;
let adminToken, owner, approver, publisher, stranger, foreign, foreignApprover, consumer, foreignConsumer, app, appEtag, capabilityId;
const visibility = {};

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
  const verified = await (await admin(`users/${id}`)).json();
  assert.equal(verified.enabled, true); assert.equal(verified.serviceAccountClientId, undefined);
  const group = (await (await admin(`groups?search=${tenant}&exact=true`)).json()).find(value => value.name === tenant); assert.ok(group);
  assert.equal((await admin(`users/${id}/groups/${group.id}`, undefined, "PUT")).status, 204);
  const roles = await Promise.all(["core-reader", "core-writer"].map(async name => (await admin(`roles/${name}`)).json()));
  assert.equal((await admin(`users/${id}/role-mappings/realm`, roles, "POST")).status, 204);
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions) VALUES(${q(tenant)},${q(issuer)},${q(id)},${q(clientId)},ARRAY[${permissions.map(q).join(",")}]::text[]);`);
  return { id, token: await login(username, password, clientId) };
}
async function api(path, who, body, headers = {}, method = body === undefined ? "GET" : "POST") {
  const response = await fetch(base + path, { method, headers: { ...(who ? { Authorization: `Bearer ${who.token ?? who}` } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  if (response.ok && (path.startsWith("/v1/trust/grants") || path.startsWith("/v1/approvals"))) {
    const value = await response.clone().json();
    if (value.grantId || value.decision?.resourceType === "grant") {
      trustCases.push({ schema: value.grantId ? "Grant" : "Approval", value });
      if (path === "/v1/trust/grants") trustCases.push({ schema: "DirectGrantCreate", value: body });
      if (path === "/v1/approvals") trustCases.push({ schema: "GrantApprovalCreate", value: body });
    }
  }
  return response;
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

async function backend(label, principal = owner, administrator = approver, tenant = "tenant-a", writer = true) {
  const clientId = `${prefix}-${label}`;
  const template = (await (await admin("clients?clientId=tenant-a")).json())[0];
  const source = await (await admin(`clients/${template.id}`)).json();
  const mappers = structuredClone(source.protocolMappers);
  for (const mapper of mappers) delete mapper.id;
  mappers.find(mapper => mapper.name === "tenant").config["claim.value"] = tenant;
  const createdClient = await admin("clients", { clientId, enabled: true, protocol: "openid-connect", publicClient: false,
    serviceAccountsEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false, protocolMappers: mappers }, "POST");
  assert.equal(createdClient.status, 201);
  const id = createdClient.headers.get("location").split("/").at(-1); clientIds.push(id);
  const subject = (await (await admin(`clients/${id}/service-account-user`)).json()).id;
  const group = (await (await admin(`groups?search=${tenant}&exact=true`)).json()).find(value => value.name === tenant);
  assert.equal((await admin(`users/${subject}/groups/${group.id}`, undefined, "PUT")).status, 204);
  const roles = await Promise.all(["core-reader", ...(writer ? ["core-writer"] : [])].map(async name => (await admin(`roles/${name}`)).json()));
  assert.equal((await admin(`users/${subject}/role-mappings/realm`, roles, "POST")).status, 204);
  const secret = (await (await admin(`clients/${id}/client-secret`)).json()).value;
  const issued = await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: secret }) });
  assert.equal(issued.status, 200); const token = (await issued.json()).access_token;
  assert.equal((await api("/v1/identity", token)).status, 200, "issuer verifies backend tenant membership");
  const body = { displayName: "Technical trust consumer", oauthClientId: clientId, providerOrigin: `https://${clientId}.example.invalid` };
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject)
    VALUES(${q(tenant)},${q(issuer)},${q(clientId)},${q(principal.id)},${q(body.providerOrigin)},${q(subject)});`);
  const created = await api("/v1/applications", principal, body); assert.equal(created.status, 201); const pending = await created.json();
  const decision = await api("/v1/approvals", administrator, { resourceType: "application", resourceId: pending.appId,
    resourceDigest: pending.digest, resourceRevision: pending.revision, requesterSubject: principal.id, requesterAppId: pending.appId,
    decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
  assert.equal(decision.status, 201);
  const active = await api(`/v1/applications/${pending.appId}/approve`, administrator, { approvalId: (await decision.json()).approvalId }, { "If-Match": created.headers.get("etag") });
  assert.equal(active.status, 200);
  return { app: await active.json(), token, subject, clientId, etag: active.headers.get("etag") };
}

async function published(version, permissions) {
  const created = permissions ? await api(`/v1/capabilities/${encodeURIComponent(capabilityId)}/versions`, owner, { ...manifest(version), requiredPermissions: permissions }) : await register(version);
  assert.equal(created.status, 201); const value = await created.json();
  assert.equal((await action(version, "validate", owner, {}, created.headers.get("etag"))).status, 200);
  const decision = await approvalFor(value); assert.equal(decision.status, 201);
  const result = await action(version, "publish", publisher, { approvalId: (await decision.json()).approvalId }, created.headers.get("etag"));
  assert.equal(result.status, 200); return { ...await result.json(), etag: result.headers.get("etag") };
}
function grantBody(value, operations = ["discover"], patch = {}) {
  return { providerAppId: app.appId, consumerAppId: consumer.app.appId,
    capabilities: [{ capabilityId, version: value.version, manifestDigest: value.digest }], operations,
    permissions: value.manifest.requiredPermissions, subjectIds: [consumer.subject],
    expiresAt: new Date(Date.now() + 600000).toISOString(), delegationAllowed: false, acceptDelegation: false, ...patch };
}
async function grantDecision(g, actor = approver, patch = {}) {
  return api("/v1/approvals", actor, { resourceType: "grant", resourceId: g.grantId, resourceDigest: g.digest,
    resourceRevision: g.revision, requesterSubject: owner.id, requesterAppId: app.appId, decision: "approve",
    expiresAt: new Date(Date.now() + 120000).toISOString(), ...patch });
}
async function proposed(value, operations = ["discover"], patch = {}) {
  const r = await api("/v1/trust/grants", owner, grantBody(value, operations, patch)); assert.equal(r.status, 201);
  return { ...await r.json(), etag: r.headers.get("etag") };
}

const versionPath = value => `/v1/capabilities/${encodeURIComponent(capabilityId)}/versions/${value.version}`;
async function eligible(value, operation = "invoke", actor = consumer, patch = {}) {
  const reference = { capabilityId, version: value.version, manifestDigest: value.digest, operation, ...patch };
  // Tokens/config stay in memory and stdin, never process arguments or files.
  return new Promise((resolve, reject) => {
    const child = spawn("docker", ["compose", "exec", "-T", "core", "node", "--input-type=module", "-"], { stdio: ["pipe", "pipe", "pipe"] });
    let output = ""; child.stdout.on("data", chunk => output += chunk); child.stderr.on("data", chunk => output += chunk);
    child.on("error", reject); child.on("close", code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error("Internal eligibility probe failed")));
    child.stdin.end(`import { evaluateCapabilityEligibility } from './src/trust.mjs';
      const config={issuer:process.env.OIDC_ISSUER,identityUrl:process.env.IDENTITY_URL,clientSecret:process.env.CORE_CLIENT_SECRET,dataUrl:process.env.DATA_URL,dataSecret:process.env.DATA_JWT_SECRET};
      console.log(JSON.stringify(await evaluateCapabilityEligibility({headers:{authorization:${JSON.stringify(`Bearer ${actor.token}`)}}},config,${JSON.stringify(reference)})));`);
  });
}
async function activeGrant(value, operations, patch = {}, administrator = approver) {
  const g = await proposed(value, operations, patch); const d = await grantDecision(g, administrator); assert.equal(d.status, 201);
  const r = await activate(g, (await d.json()).approvalId, administrator); assert.equal(r.status, 200);
  return { ...await r.json(), etag: r.headers.get("etag") };
}
async function revokeGrant(g) {
  const r = await api(`/v1/trust/grants/${g.grantId}/revoke`, owner, { reason: "technical discovery revocation" }, { "If-Match": g.etag });
  assert.equal(r.status, 200); return { ...await r.json(), etag: r.headers.get("etag") };
}
async function activate(g, approvalId, actor = approver) {
  return api(`/v1/trust/grants/${g.grantId}/activate`, actor, { approvalId }, { "If-Match": g.etag });
}

async function applicationState(target, actionName) {
  let approvalId;
  if (actionName === "reactivate") {
    const r = await api("/v1/approvals", approver, { resourceType: "application", resourceId: target.app.appId,
      resourceDigest: target.app.digest, resourceRevision: target.app.revision, requesterSubject: target.app.ownerSubject,
      requesterAppId: target.app.appId, decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
    assert.equal(r.status, 201); approvalId = (await r.json()).approvalId;
  }
  const r = await api(`/v1/applications/${target.app.appId}/state`, approver,
    { action: actionName, reason: "technical trust state test", ...(approvalId ? { approvalId } : {}) }, { "If-Match": target.etag });
  assert.equal(r.status, 200); target.app = await r.json(); target.etag = r.headers.get("etag");
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

  owner = await human("owner", "tenant-a", ["applications.register", "capabilities.write", "capabilities.approve", "trust.write", "trust.approve"]);
  approver = await human("approver", "tenant-a", ["applications.approve", "trust.approve", "capabilities.approve"]);
  publisher = await human("publisher", "tenant-a", ["capabilities.write", "capabilities.publish"]);
  stranger = await human("stranger", "tenant-a", ["capabilities.write", "trust.write"]);
  foreign = await human("foreign", "tenant-b", ["applications.register", "capabilities.write", "capabilities.approve", "trust.write"]);
  foreignApprover = await human("foreign-approver", "tenant-b", ["applications.approve", "trust.approve"]);

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
  consumer = await backend("consumer");
  foreignConsumer = await backend("foreign-consumer", foreign, foreignApprover, "tenant-b");
});

after(async () => {
  adminToken = await operatorToken();
  if (users.length) {
    const ids = users.map(q).join(",");
    const apps = `SELECT app_id FROM app_private.applications WHERE owner_subject IN (${ids})`;
    await sql(`UPDATE trust_private.grants SET activation_approval_id=NULL WHERE provider_app_id IN (${apps});
      DELETE FROM trust_private.approvals WHERE grant_id IN (SELECT grant_id FROM trust_private.grants WHERE provider_app_id IN (${apps}));
      DELETE FROM trust_private.grants WHERE provider_app_id IN (${apps});
      DELETE FROM app_private.capability_publication_approvals WHERE requester_app_id IN (${apps}) OR version_id IN (SELECT version_id FROM app_private.capability_versions WHERE provider_app_id IN (${apps}));
      DELETE FROM app_private.capability_versions WHERE provider_app_id IN (${apps});
      DELETE FROM app_private.audit WHERE subject IN (${ids});
      DELETE FROM app_private.approvals WHERE app_id IN (${apps}); DELETE FROM app_private.applications WHERE owner_subject IN (${ids});
      DELETE FROM app_private.enrollments WHERE owner_subject IN (${ids}); DELETE FROM app_private.principals WHERE subject IN (${ids});`);
  }
  for (const id of clientIds) assert.equal((await admin(`clients/${id}`, undefined, "DELETE")).status, 204);
  for (const id of users) assert.equal((await admin(`users/${id}`, undefined, "DELETE")).status, 204);
  await verifyContracts("capabilities", trustCases, "--capability-runtime");
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

test("direct proposals require provider ownership, explicit permission and verified exact subjects", async () => {
  const value = await published("2.0.0"); const body = grantBody(value);
  assert.equal((await api("/v1/trust/grants", stranger, body)).status, 403, "trust writer is not the provider owner");
  assert.equal((await api("/v1/trust/grants", publisher, body)).status, 403, "core writer/capability publisher has no trust.write");
  assert.equal((await api("/v1/trust/grants", consumer, body)).status, 403, "backend cannot acquire human management authority");
  for (const patch of [{ tenantId: "tenant-b" }, { subject: owner.id }, { actorAppId: app.appId }, { consumerAppId: "*" },
    { subjectIds: ["*"] }, { delegationAllowed: true }, { acceptDelegation: true }, { operations: ["admin"] },
    { capabilities: [{ ...body.capabilities[0], version: "^2.0.0" }] }]) {
    assert.equal((await api("/v1/trust/grants", owner, { ...body, ...patch })).status, 400, JSON.stringify(patch));
  }
  for (const subjectIds of [[owner.id], [foreign.id], ["unverified-subject"]]) {
    assert.equal((await api("/v1/trust/grants", owner, { ...body, subjectIds })).status, 404, "unverified consumer binding denied");
  }
  assert.equal((await api("/v1/trust/grants", owner, { ...body, consumerAppId: foreignConsumer.app.appId, subjectIds: [foreignConsumer.subject] })).status, 404);
  assert.equal((await api("/v1/trust/grants", owner, { ...body, capabilities: [{ ...body.capabilities[0], manifestDigest: `sha256:${"0".repeat(64)}` }] })).status, 409);
  assert.equal((await api("/v1/trust/grants", owner, { ...body, permissions: [`urn:rosetta:permission:${app.appId}:undeclared`] })).status, 400);
  const parts = owner.token.split("."); const claims = JSON.parse(Buffer.from(parts[1], "base64url")); claims.tenant_id = "tenant-b";
  const forged = `${parts[0]}.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${parts[2]}`;
  assert.equal((await api("/v1/trust/grants", forged, body)).status, 401, "forged signed-token claims denied by the real issuer");
  const g = await proposed(value); assert.equal(g.state, "pending");
  assert.equal((await api(`/v1/trust/grants/${g.grantId}`, foreign)).status, 404);
});

test("separate exact approval is consumed once under concurrent activation; revocation is terminal", async () => {
  const value = await published("2.0.1"); const g = await proposed(value, ["discover", "invoke"]);
  assert.equal((await grantDecision(g, owner)).status, 403, "creator with trust.approve cannot self-approve");
  assert.equal((await grantDecision(g, publisher)).status, 403, "capability publication does not imply trust.approve");
  assert.equal((await grantDecision(g, approver, { resourceRevision: 2 })).status, 409);
  assert.equal((await grantDecision(g, approver, { resourceDigest: `sha256:${"0".repeat(64)}` })).status, 409);
  assert.equal((await grantDecision(g, approver, { requesterSubject: stranger.id })).status, 409);
  const decisions = await Promise.all([grantDecision(g), grantDecision(g)]);
  assert.deepEqual(decisions.map(r => r.status), [201, 201], "independent decisions cannot activate implicitly");
  const approvalIds = await Promise.all(decisions.map(async r => (await r.json()).approvalId));
  assert.equal((await api(`/v1/trust/grants/${g.grantId}/activate`, approver, { approvalId: approvalIds[0] })).status, 428);
  const attempts = await Promise.all(approvalIds.map(id => activate(g, id)));
  assert.deepEqual(attempts.map(r => r.status).sort(), [200, 409]);
  const activeResponse = attempts.find(r => r.status === 200); const active = await activeResponse.json();
  const consumed = await sql(`SELECT count(*) FROM trust_private.approvals WHERE grant_id=${q(g.grantId)} AND state='consumed';`);
  assert.equal(consumed.stdout.trim(), "1");
  const consumedIndex = attempts.findIndex(r => r.status === 200);
  const readApproval = await api(`/v1/approvals/${approvalIds[consumedIndex]}`, approver);
  assert.equal(readApproval.status, 200); assert.equal((await readApproval.json()).state, "consumed");
  const other = await proposed(value);
  assert.equal((await activate(other, approvalIds[consumedIndex])).status, 409, "cannot reuse another grant's approval");
  const revoked = await api(`/v1/trust/grants/${g.grantId}/revoke`, owner, { reason: "technical terminal revocation" }, { "If-Match": activeResponse.headers.get("etag") });
  assert.equal(revoked.status, 200); assert.equal((await revoked.json()).state, "revoked");
  assert.equal((await activate({ ...g, etag: revoked.headers.get("etag") }, approvalIds[1 - consumedIndex])).status, 409);
  const history = await sql(`SELECT count(*) FROM app_private.audit WHERE resource_id=${q(g.grantId)} AND event IN ('grant.proposed','grant.activated','grant.revoked');`);
  assert.equal(history.stdout.trim(), "3"); assert.equal(active.revision, 2);
});

test("denied, revoked, expired and stale decisions never activate; expired grants need no job", async () => {
  const value = await published("2.0.2");
  for (const mode of ["denied", "revoked", "expired", "stale", "grant-expired"]) {
    const g = await proposed(value); const r = await grantDecision(g, approver, mode === "denied" ? { decision: "deny" } : {});
    assert.equal(r.status, 201); const decision = await r.json();
    if (mode === "revoked") assert.equal((await api(`/v1/approvals/${decision.approvalId}/revoke`, approver, { reason: "technical decision revocation" }, { "If-Match": r.headers.get("etag") })).status, 200);
    if (mode === "expired") await sql(`UPDATE trust_private.approvals SET expires_at=now()-interval '1 second' WHERE approval_id=${q(decision.approvalId)};`);
    if (mode === "stale") { await sql(`UPDATE trust_private.grants SET revision=revision+1 WHERE grant_id=${q(g.grantId)};`); g.etag = `"grant-${g.grantId}-2"`; }
    if (mode === "grant-expired") {
      await sql(`UPDATE trust_private.grants SET expires_at=now()-interval '1 second' WHERE grant_id=${q(g.grantId)};`);
      const read = await api(`/v1/trust/grants/${g.grantId}`, owner); assert.equal((await read.json()).state, "expired");
    }
    assert.equal((await activate(g, decision.approvalId)).status, 409, mode);
    if (mode === "denied" || mode === "grant-expired") {
      const revoked = await api(`/v1/trust/grants/${g.grantId}/revoke`, owner, { reason: "technical authority reduction" }, { "If-Match": g.etag });
      assert.equal(revoked.status, 200); assert.equal((await revoked.json()).state, "revoked");
    }
  }
});

test("live provider and consumer state and enrollment are rechecked at activation", async () => {
  const value = await published("2.0.3");
  const provider = { app, etag: appEtag };
  for (const target of [provider, consumer]) {
    const g = await proposed(value); const decision = await grantDecision(g); const approvalId = (await decision.json()).approvalId;
    await applicationState(target, "suspend");
    assert.equal((await activate(g, approvalId)).status, 409);
    await applicationState(target, "reactivate");
    assert.equal((await activate(g, approvalId)).status, 200);
  }
  app = provider.app; appEtag = provider.etag;
  const g = await proposed(value); const decision = await grantDecision(g); const approvalId = (await decision.json()).approvalId;
  await sql(`UPDATE app_private.enrollments SET enabled=false WHERE oauth_client_id=${q(consumer.clientId)};`);
  try { assert.equal((await activate(g, approvalId)).status, 409); }
  finally { await sql(`UPDATE app_private.enrollments SET enabled=true WHERE oauth_client_id=${q(consumer.clientId)};`); }
});

test("protected audit failure rolls back proposals, approval consumption, activation and revocation", async () => {
  const value = await published("2.0.4"); const g = await proposed(value);
  const decision = await grantDecision(g); const approvalId = (await decision.json()).approvalId;
  await sql(`CREATE FUNCTION public.${prefix.replaceAll("-", "_")}_audit_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit outage'; END $$;
    CREATE TRIGGER trust_fixture_audit_failure BEFORE INSERT ON app_private.audit FOR EACH ROW
      WHEN (NEW.event IN ('grant.proposed','grant.activated','grant.revoked') AND NEW.subject IN (${q(owner.id)},${q(approver.id)}))
      EXECUTE FUNCTION public.${prefix.replaceAll("-", "_")}_audit_fail();`);
  try {
    const before = (await sql(`SELECT count(*) FROM trust_private.grants WHERE created_by=${q(owner.id)};`)).stdout.trim();
    assert.equal((await api("/v1/trust/grants", owner, grantBody(value))).status, 503);
    assert.equal((await sql(`SELECT count(*) FROM trust_private.grants WHERE created_by=${q(owner.id)};`)).stdout.trim(), before);
    assert.equal((await activate(g, approvalId)).status, 503);
    assert.equal((await sql(`SELECT state,revision FROM trust_private.approvals WHERE approval_id=${q(approvalId)}; SELECT state,revision FROM trust_private.grants WHERE grant_id=${q(g.grantId)};`)).stdout.trim(), "approved|1\npending|1");
    assert.equal((await api(`/v1/trust/grants/${g.grantId}/revoke`, owner, { reason: "technical rollback" }, { "If-Match": g.etag })).status, 503);
  } finally { await sql(`DROP TRIGGER IF EXISTS trust_fixture_audit_failure ON app_private.audit; DROP FUNCTION public.${prefix.replaceAll("-", "_")}_audit_fail();`); }
  assert.equal((await activate(g, approvalId)).status, 200);
});

test("pending migrations and real restart preserve Trust authority, ACLs and terminal revocation", async () => {
  const value = await published("2.0.5"); const g = await proposed(value); const decision = await grantDecision(g);
  const approvalId = (await decision.json()).approvalId; const active = await activate(g, approvalId); assert.equal(active.status, 200);
  const revoked = await api(`/v1/trust/grants/${g.grantId}/revoke`, owner, { reason: "technical persistent revocation" }, { "If-Match": active.headers.get("etag") });
  assert.equal(revoked.status, 200); g.etag = revoked.headers.get("etag");
  await run("compose", "run", "--rm", "data-migrate");
  const acl = await sql("SELECT has_function_privilege('rosetta_trust_api','core.trust_command(text,jsonb)','EXECUTE'),has_function_privilege('rosetta_api','core.trust_command(text,jsonb)','EXECUTE'),has_schema_privilege('rosetta_trust_api','trust_private','USAGE'),has_table_privilege('rosetta_trust_api','trust_private.grants','INSERT');");
  assert.equal(acl.stdout.trim(), "t|f|f|f");
  await run("compose", "restart", "database");
  await run("compose", "up", "--detach", "--no-deps", "--force-recreate", "--wait", "data", "core");
  let read;
  const deadline = Date.now() + 30000;
  do {
    read = await api(`/v1/trust/grants/${g.grantId}`, owner);
    if (read.status === 200) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  } while (Date.now() < deadline);
  assert.equal(read.status, 200); assert.equal((await read.json()).state, "revoked");
  assert.equal((await activate(g, approvalId)).status, 409);
  const consumed = await api(`/v1/approvals/${approvalId}`, approver);
  assert.equal(consumed.status, 200); assert.equal((await consumed.json()).state, "consumed");
});

test("discover and invoke rights stay separate with exact versions, permissions and subject binding", async () => {
  const prior = JSON.parse((await sql(`SELECT coalesce(json_agg(grant_id),'[]') FROM trust_private.grants WHERE created_by=${q(owner.id)} AND state<>'revoked';`)).stdout);
  for (const grantId of prior) {
    const r = await api(`/v1/trust/grants/${grantId}`, owner); const g = await r.json();
    await revokeGrant({ ...g, etag: r.headers.get("etag") });
  }
  const before = await api("/v1/capabilities", consumer); assert.equal(before.status, 200); assert.deepEqual((await before.json()).items, []);
  for (const [label, version, operations] of [["discover", "3.0.0", ["discover"]], ["invoke", "3.0.1", ["invoke"]], ["both", "3.0.2", ["discover", "invoke"]]]) {
    const v = await published(version); const g = await activeGrant(v, operations); visibility[label] = { v, g };
    const read = await api(versionPath(v), consumer);
    assert.equal(read.status, label === "invoke" ? 404 : 200);
    if (read.ok) {
      const metadata = await read.json(); trustCases.push({ schema: "CapabilityVersion", value: metadata });
      assert.equal(metadata.digest, v.digest);
      for (const hidden of ["createdBy", "updatedBy", "validation", "approvals", "ownerSubject", "providerOrigin"]) assert.equal(Object.hasOwn(metadata, hidden), false, hidden);
    }
    for (const operation of ["discover", "invoke"]) {
      const result = await eligible(v, operation); assert.equal(result.allowed, operations.includes(operation), `${label}/${operation}`);
      assert.deepEqual(Object.keys(result).sort(), ["allowed", "reason"], "decision is not a transferable authorization artifact");
    }
  }
  const missingPermission = await published("3.0.3", [`urn:rosetta:permission:${app.appId}:invoke`, `urn:rosetta:permission:${app.appId}:extra`]);
  for (const permission of missingPermission.manifest.requiredPermissions) await activeGrant(missingPermission, ["discover", "invoke"], { permissions: [permission] });
  assert.equal((await eligible(missingPermission)).allowed, false, "partial grants cannot be unioned");
  assert.equal((await api(versionPath(missingPermission), consumer)).status, 404);
  const ungranted = await published("3.0.4");
  assert.equal((await api(versionPath(ungranted), consumer)).status, 404, "no automatic version inheritance");
  assert.equal((await eligible(ungranted)).allowed, false);
  assert.equal((await eligible(visibility.invoke.v, "invoke", consumer, { manifestDigest: `sha256:${"0".repeat(64)}` })).allowed, false);
  assert.equal((await eligible(visibility.invoke.v, "invoke", consumer, { tenantId: "tenant-b" })).reason, "invalid_reference");
  assert.equal((await eligible(visibility.invoke.v, "invoke", foreignConsumer)).allowed, false);
  assert.equal((await eligible(visibility.invoke.v, "invoke", owner)).allowed, false, "provider owner has no backend bypass");
  assert.equal((await eligible(visibility.invoke.v, "invoke", { token: "invalid-token" })).reason, "principal_required");
  assert.equal((await api(versionPath(visibility.discover.v), foreignConsumer)).status, 404);
  assert.deepEqual((await (await api("/v1/capabilities", foreignConsumer)).json()).items, []);
  const draft = await register("3.0.5"); assert.equal(draft.status, 201); const draftValue = await draft.json();
  assert.equal((await api(versionPath(draftValue), consumer, undefined, { "X-Tenant-Id": "tenant-a", "X-App-Id": app.appId, "X-Subject": owner.id })).status, 404);
  assert.equal((await api("/v1/trust/grants", owner, grantBody(draftValue))).status, 409, "unpublished version cannot gain authority");
  assert.equal((await api(`/v1/approvals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, consumer)).status, 403);
});

test("pagination filters before counting and cursors never retain revoked discovery authority", async () => {
  const first = await api("/v1/capabilities?limit=1", consumer); assert.equal(first.status, 200); const page = await first.json();
  assert.equal(page.items.length, 1); assert.equal(page.items[0].version, "3.0.2"); assert.ok(page.nextCursor);
  const second = await api(`/v1/capabilities?limit=1&cursor=${page.nextCursor}`, consumer); const end = await second.json();
  assert.equal(end.items.length, 1); assert.equal(end.items[0].version, "3.0.0"); assert.equal(end.nextCursor, null, "hidden versions do not create hidden counts");
  assert.equal((await api(`/v1/capabilities?cursor=${page.nextCursor}`, foreignConsumer)).status, 400, "cursor is tenant/app-bound");
  const owned = await api("/v1/capabilities?limit=1", owner); const ownerPage = await owned.json();
  assert.ok(ownerPage.nextCursor); assert.equal((await api(`/v1/capabilities?cursor=${ownerPage.nextCursor}`, owner)).status, 200, "C1 cursor compatibility");
  assert.equal((await api(`/v1/capabilities?cursor=${ownerPage.nextCursor}`, consumer)).status, 400);
  visibility.discover.g = await revokeGrant(visibility.discover.g);
  const after = await api(`/v1/capabilities?limit=1&cursor=${page.nextCursor}`, consumer); const remaining = await after.json();
  assert.deepEqual(remaining.items, []); assert.equal(remaining.nextCursor, null);
  assert.equal((await api(versionPath(visibility.discover.v), consumer)).status, 404);
  assert.equal((await eligible(visibility.discover.v, "discover")).allowed, false);
});

test("live capability, app, subject and administrator authority immediately bound new use", async () => {
  const deprecated = await action(visibility.both.v.version, "deprecate", owner, { reason: "technical discovery retirement" }, visibility.both.v.etag);
  assert.equal(deprecated.status, 200);
  assert.equal((await api(versionPath(visibility.both.v), consumer)).status, 404);
  assert.equal((await eligible(visibility.both.v)).allowed, false);
  const revoked = await action(visibility.both.v.version, "revoke", owner, { reason: "technical capability revocation" }, deprecated.headers.get("etag"));
  assert.equal(revoked.status, 200);
  assert.equal((await api("/v1/trust/grants", owner, grantBody(visibility.both.v))).status, 409);
  assert.equal((await eligible(visibility.both.v)).allowed, false);
  const trustAdmin = await human("trust-only-administrator", "tenant-a", ["trust.approve"]);
  const v = await published("3.1.0"); const g = await activeGrant(v, ["discover", "invoke"], {}, trustAdmin); visibility.live = { v, g };
  assert.equal((await eligible(v)).allowed, true, "trust.approve is independent of app/capability permissions");
  const reader = await backend("reader-consumer", owner, approver, "tenant-a", false);
  await activeGrant(v, ["discover", "invoke"], { consumerAppId: reader.app.appId, subjectIds: [reader.subject] });
  assert.equal((await eligible(v, "discover", reader)).allowed, true);
  assert.equal((await eligible(v, "invoke", reader)).allowed, false, "invoke eligibility still requires baseline writer authority");
  await applicationState(reader, "revoke");
  assert.equal((await eligible(v, "discover", reader)).allowed, false, "terminal consumer revocation removes existing authority");
  const provider = { app, etag: appEtag };
  for (const target of [provider, consumer]) {
    await applicationState(target, "suspend");
    assert.notEqual((await api(versionPath(v), consumer)).status, 200); assert.equal((await eligible(v)).allowed, false);
    await applicationState(target, "reactivate"); assert.equal((await eligible(v)).allowed, true);
  }
  app = provider.app; appEtag = provider.etag;
  for (const mutation of [
    [`UPDATE app_private.enrollments SET resource_subject=NULL WHERE oauth_client_id=${q(consumer.clientId)}`, `UPDATE app_private.enrollments SET resource_subject=${q(consumer.subject)} WHERE oauth_client_id=${q(consumer.clientId)}`],
    [`UPDATE app_private.principals SET enabled=false WHERE subject=${q(trustAdmin.id)}`, `UPDATE app_private.principals SET enabled=true WHERE subject=${q(trustAdmin.id)}`],
    [`UPDATE app_private.principals SET enabled=false WHERE subject=${q(owner.id)}`, `UPDATE app_private.principals SET enabled=true WHERE subject=${q(owner.id)}`],
  ]) {
    await sql(mutation[0]);
    try { assert.equal((await eligible(v)).allowed, false); assert.notEqual((await api(versionPath(v), consumer)).status, 200); }
    finally { await sql(mutation[1]); }
    assert.equal((await eligible(v)).allowed, true, "no positive authorization cache");
  }
  const expiring = await published("3.1.1"); const expiresAt = new Date(Date.now() + 10000).toISOString();
  const pending = await proposed(expiring, ["discover", "invoke"], { expiresAt });
  const decision = await grantDecision(pending, approver, { expiresAt }); assert.equal(decision.status, 201);
  const activated = await activate(pending, (await decision.json()).approvalId); assert.equal(activated.status, 200);
  const expiredGrant = { ...await activated.json(), etag: activated.headers.get("etag") };
  assert.equal((await eligible(expiring)).allowed, true);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(expiresAt) - Date.now() + 250)));
  const expired = await api(`/v1/trust/grants/${expiredGrant.grantId}`, owner); assert.equal((await expired.json()).state, "expired");
  assert.equal((await api(versionPath(expiring), consumer)).status, 404); assert.equal((await eligible(expiring)).allowed, false);
  visibility.expired = { v: expiring, g: expiredGrant };
});

test("internal eligibility fails closed during authority outage and rechecks after restart", async () => {
  const { v } = visibility.live;
  await run("compose", "stop", "data");
  try { assert.equal((await eligible(v)).reason, "authority_unavailable"); assert.equal((await api(versionPath(v), consumer)).status, 503); }
  finally { await run("compose", "up", "--detach", "--no-deps", "--wait", "data"); }
  await run("compose", "restart", "database");
  await run("compose", "up", "--detach", "--no-deps", "--force-recreate", "--wait", "data", "core");
  let decision; const deadline = Date.now() + 30000;
  do { decision = await eligible(v); if (decision.allowed) break; await new Promise(resolve => setTimeout(resolve, 500)); } while (Date.now() < deadline);
  assert.equal(decision.allowed, true); assert.equal((await eligible(visibility.invoke.v)).allowed, true);
  assert.equal((await eligible(visibility.expired.v)).allowed, false); assert.equal((await eligible(visibility.discover.v, "discover")).allowed, false);
  const acl = await sql("SELECT has_function_privilege('rosetta_trust_api','core.trust_eligibility(jsonb)','EXECUTE'),has_function_privilege('rosetta_capability_api','core.trust_eligibility(jsonb)','EXECUTE'),has_function_privilege('rosetta_api','core.trust_eligibility(jsonb)','EXECUTE');");
  assert.equal(acl.stdout.trim(), "t|f|f");
});

test("isolated backup/restore preserves real OIDC grant decisions and revocation/expiration evidence", { timeout: 120000 }, async () => {
  const fixture = { tenant: "tenant-a", issuer, subject: consumer.subject, clientId: consumer.clientId,
    cases: [[visibility.live, "active"], [visibility.discover, "revoked"], [visibility.expired, "expired"]].map(([item, state]) => ({
      grantId: item.g.grantId, state, reference: { capabilityId, version: item.v.version, manifestDigest: item.v.digest, operation: state === "revoked" ? "discover" : "invoke" },
    })) };
  const childEnv = { ...process.env, TRUST_RECOVERY_CASES: JSON.stringify(fixture) };
  // Launch an independent runner rather than inheriting Node's child IPC mode.
  delete childEnv.NODE_TEST_CONTEXT;
  const restored = await promisify(execFile)(process.execPath, ["--env-file=.env", "--test", "integration/recovery.mjs"], {
    timeout: 120000, env: childEnv,
  });
  assert.match(restored.stdout, /Trust restore: 3 live grants/);
  console.log("Live OIDC Trust backup/restore verified active, revoked and expired grants");
});

test("terminal app revocation cannot be bypassed by an already approved grant", async () => {
  const { v } = visibility.live; const g = await proposed(v); const d = await grantDecision(g); assert.equal(d.status, 201);
  const provider = { app, etag: appEtag }; await applicationState(provider, "revoke");
  assert.equal((await activate(g, (await d.json()).approvalId)).status, 409);
  assert.equal((await eligible(v)).allowed, false); assert.equal((await api(versionPath(v), consumer)).status, 404);
  assert.equal((await api(versionPath(v), owner)).status, 200, "C1 owner history remains visible");
  await applicationState(consumer, "revoke"); assert.equal((await eligible(v)).allowed, false);
});
