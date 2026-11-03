// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Real Keycloak identities and operator-enrolled technical apps; credentials stay in memory.
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
export function createAuthorityFixture({ base, prefix, sql, q, api, clientIds, users }) {
const issuer = `${base}/identity/realms/junctura`;
let adminToken;
async function operatorToken() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`, { method: "POST", body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "junctura-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD }), signal: AbortSignal.timeout(5000) });
      if (response.status === 200) return adminToken = (await response.json()).access_token;
    } catch { /* The real database/Core recreation can leave stale IdP connections. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail("Operator authentication did not recover within thirty seconds");
}
async function admin(path, body, method = "GET") {
  return fetch(`${base}/identity/admin/realms/junctura/${path}`, { method, headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
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
async function backend(label, principal, administrator, tenant = "tenant-a", writer = true, providerOrigin) {
  adminToken = await operatorToken();
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
  const body = { displayName: "Technical trust consumer", oauthClientId: clientId, providerOrigin: providerOrigin ?? `https://${clientId}.example.invalid` };
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject)
    VALUES(${q(tenant)},${q(issuer)},${q(clientId)},${q(principal.id)},${q(body.providerOrigin)},${q(subject)});`);
  const created = await api("/v1/applications", principal, body); assert.equal(created.status, 201); const pending = await created.json();
  const decision = await api("/v1/approvals", administrator, { resourceType: "application", resourceId: pending.appId,
    resourceDigest: pending.digest, resourceRevision: pending.revision, requesterSubject: principal.id, requesterAppId: pending.appId,
    decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() });
  assert.equal(decision.status, 201, await decision.clone().text());
  const active = await api(`/v1/applications/${pending.appId}/approve`, administrator, { approvalId: (await decision.json()).approvalId }, { "If-Match": created.headers.get("etag") });
  assert.equal(active.status, 200);
  return { app: await active.json(), token, subject, clientId, clientSecret: secret, etag: active.headers.get("etag") };
}


return { operatorToken, admin, login, human, backend };
}
