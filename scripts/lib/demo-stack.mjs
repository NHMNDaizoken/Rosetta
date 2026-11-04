// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Shared helpers for local demo scripts (development stacks only). They sign in as
// the Keycloak operator from .env, create local demo identities and talk to the
// Gateway exactly like a real client would. Nothing here is used by the platform.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { promisify } from "node:util";

export const OWNER_PERMISSIONS = ["applications.register", "trust.write", "capabilities.write", "capabilities.publish",
  "compositions.write", "compositions.publish", "audit.read"];
export const APPROVER_PERMISSIONS = ["applications.approve", "trust.approve", "capabilities.approve", "compositions.approve", "audit.read"];
const CALLBACK = "http://127.0.0.1:9876/callback";

export const q = value => `'${String(value).replaceAll("'", "''")}'`;
export const step = message => console.log(`• ${message}`);

export async function connectDemoStack({ tenant, base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080" }) {
  const issuer = `${base}/identity/realms/junctura`;
  if (!process.env.KEYCLOAK_ADMIN_PASSWORD) throw new Error("KEYCLOAK_ADMIN_PASSWORD missing: run from the repository root after npm run setup");
  const run = promisify(execFile);
  const sql = async text => (await run("docker", ["compose", "exec", "-T", "database", "psql", "-U", "junctura_admin", "-d", "junctura_data",
    "-v", "ON_ERROR_STOP=1", "-Atc", text], { timeout: 60000 })).stdout.trim();

  const issued = await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "junctura-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (issued.status !== 200) throw new Error(`Keycloak operator login failed (${issued.status}); is the stack running?`);
  const adminToken = (await issued.json()).access_token;
  const admin = async (path, body, method = body === undefined ? "GET" : "POST") => fetch(`${base}/identity/admin/realms/junctura/${path}`,
    { method, headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const must = async (response, expected, what) => {
    if (!expected.includes(response.status)) throw new Error(`${what} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response;
  };
  const idFrom = response => response.headers.get("location").split("/").at(-1);

  const group = (await (await admin(`groups?search=${encodeURIComponent(tenant)}&exact=true`)).json()).find(g => g.name === tenant);
  if (!group) throw new Error(`Tenant group ${tenant} does not exist in Keycloak`);
  const template = (await (await admin("clients?clientId=tenant-a")).json())[0];
  const mappersFor = async () => {
    const source = await (await admin(`clients/${template.id}`)).json();
    const mappers = structuredClone(source.protocolMappers);
    for (const mapper of mappers) delete mapper.id;
    mappers.find(mapper => mapper.name === "tenant").config["claim.value"] = tenant;
    return mappers;
  };
  const roles = await Promise.all(["core-reader", "core-writer"].map(async name => (await admin(`roles/${name}`)).json()));

  const managementClient = `junctura-demo-management-${tenant}`;
  const ensureManagementClient = async () => {
    if ((await (await admin(`clients?clientId=${managementClient}`)).json()).length) return;
    await must(await admin("clients", { clientId: managementClient, enabled: true, protocol: "openid-connect", publicClient: true,
      standardFlowEnabled: true, directAccessGrantsEnabled: false, redirectUris: [CALLBACK],
      attributes: { "pkce.code.challenge.method": "S256" }, protocolMappers: await mappersFor() }), [201], "Create management client");
  };

  const login = async (username, password) => {
    const verifier = randomBytes(32).toString("base64url");
    const params = new URLSearchParams({ client_id: managementClient, response_type: "code", scope: "openid", redirect_uri: CALLBACK,
      code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
    const page = await fetch(`${issuer}/protocol/openid-connect/auth?${params}`, { redirect: "manual" });
    const cookies = page.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
    const action = (await page.text()).match(/<form[^>]*action="([^"]+)"/);
    if (!action) throw new Error("Keycloak login form not found");
    const response = await fetch(action[1].replaceAll("&amp;", "&"), { method: "POST", redirect: "manual", headers: { Cookie: cookies },
      body: new URLSearchParams({ username, password, credentialId: "" }) });
    if (response.status !== 302) throw new Error(`Demo user ${username} could not sign in (${response.status})`);
    const code = new URL(response.headers.get("location")).searchParams.get("code");
    const tokens = await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST",
      body: new URLSearchParams({ grant_type: "authorization_code", client_id: managementClient, redirect_uri: CALLBACK, code, code_verifier: verifier }) });
    await must(tokens, [200], "Exchange authorization code");
    return (await tokens.json()).access_token;
  };

  // Demo humans keep the reviewed separation of duties (owner vs independent approver).
  // Each run sets a fresh random password that is never printed or stored.
  const human = async (label, permissions) => {
    const username = `junctura-demo-${label}-${tenant}`;
    const password = randomBytes(24).toString("hex");
    let id = (await (await admin(`users?username=${username}&exact=true`)).json())[0]?.id;
    if (!id) {
      id = idFrom(await must(await admin("users", { username, enabled: true, firstName: "Demo", lastName: label, email: `${username}@example.invalid`,
        emailVerified: true, attributes: { tenant_id: [tenant] }, credentials: [{ type: "password", value: password, temporary: false }] }), [201], `Create ${label}`));
      await must(await admin(`users/${id}/groups/${group.id}`, undefined, "PUT"), [204], `Add ${label} to tenant`);
      await must(await admin(`users/${id}/role-mappings/realm`, roles), [204], `Assign ${label} roles`);
    } else {
      await must(await admin(`users/${id}/reset-password`, { type: "password", value: password, temporary: false }, "PUT"), [204], `Reset ${label} password`);
    }
    await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions)
      VALUES(${q(tenant)},${q(issuer)},${q(id)},${q(managementClient)},ARRAY[${permissions.map(q).join(",")}]::text[])
      ON CONFLICT (tenant_id,issuer,subject,management_client) DO UPDATE SET permissions=EXCLUDED.permissions, enabled=true;`);
    return { id, token: await login(username, password) };
  };

  const api = (path, token, body, headers = {}, method = body === undefined ? "GET" : "POST") => fetch(base + path, { method,
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });

  return { base, issuer, tenant, sql, admin, must, idFrom, group, mappersFor, roles, managementClient, ensureManagementClient, login, human, api };
}

// Enrolls one backend application end to end: Keycloak client, operator enrollment,
// registration by the owner and independent approval/activation by the approver.
export async function enrollApplication(stack, { clientId, origin, displayName }, owner, approver) {
  const { admin, must, idFrom, group, mappersFor, roles, issuer, sql, api, tenant } = stack;
  if ((await (await admin(`clients?clientId=${clientId}`)).json()).length) throw new Error(`Keycloak client ${clientId} already exists`);
  step(`Backend client ${clientId}`);
  const clientUuid = idFrom(await must(await admin("clients", { clientId, enabled: true, protocol: "openid-connect",
    publicClient: false, serviceAccountsEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false,
    protocolMappers: await mappersFor() }), [201], "Create backend client"));
  const subject = (await (await admin(`clients/${clientUuid}/service-account-user`)).json()).id;
  await must(await admin(`users/${subject}/groups/${group.id}`, undefined, "PUT"), [204], "Add service account to tenant");
  await must(await admin(`users/${subject}/role-mappings/realm`, roles), [204], "Assign service account roles");
  const clientSecret = (await (await admin(`clients/${clientUuid}/client-secret`)).json()).value;
  const service = await must(await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }) }), [200], "Backend token");
  await must(await api("/v1/identity", (await service.json()).access_token), [200], "Verify backend identity");

  step(`Enroll and register ${displayName}`);
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject)
    VALUES(${q(tenant)},${q(issuer)},${q(clientId)},${q(owner.id)},${q(origin)},${q(subject)});`);
  const created = await must(await api("/v1/applications", owner.token, { displayName, oauthClientId: clientId, providerOrigin: origin }), [201], "Register application");
  const pending = await created.json();
  const decision = await must(await api("/v1/approvals", approver.token, { resourceType: "application", resourceId: pending.appId,
    resourceDigest: pending.digest, resourceRevision: pending.revision, requesterSubject: owner.id, requesterAppId: pending.appId,
    decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() }), [201], "Approve application");
  const activated = await must(await api(`/v1/applications/${pending.appId}/approve`, approver.token, { approvalId: (await decision.json()).approvalId },
    { "If-Match": created.headers.get("etag") }), [200], "Activate application");
  return { app: await activated.json(), clientSecret, subject };
}
