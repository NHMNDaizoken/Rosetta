// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local operator helper: enroll one Layer-2 backend application in a single command.
// It performs the reviewed operator flow from docs/GETTING_STARTED.md against the
// local Compose stack and writes the app's own credentials to an ignored env file.
// Development/demo stacks only: it creates local demo owner/approver identities.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const OWNER_PERMISSIONS = ["applications.register", "trust.write", "capabilities.write", "capabilities.publish",
  "compositions.write", "compositions.publish", "audit.read"];
const APPROVER_PERMISSIONS = ["applications.approve", "trust.approve", "capabilities.approve", "compositions.approve", "audit.read"];
const CALLBACK = "http://127.0.0.1:9876/callback";

export function parseArgs(argv) {
  const options = { tenant: "tenant-a", origin: undefined, displayName: undefined, name: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--tenant") options.tenant = argv[++i];
    else if (arg === "--origin") options.origin = argv[++i];
    else if (arg === "--display-name") options.displayName = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else if (options.name === undefined) options.name = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (options.help) return options;
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(options.name ?? "")) throw new Error("App name must be 2-40 lowercase letters, digits or '-', starting with a letter");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(options.tenant ?? "")) throw new Error("Invalid --tenant");
  options.clientId = `app-${options.name}`;
  options.origin ??= `https://${options.clientId}.rosetta.local`;
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.origin !== options.origin || !origin.hostname.includes(".") ||
    isIP(origin.hostname.replace(/^\[|\]$/g, ""))) throw new Error("--origin must be an exact https origin such as https://daotao.example.org");
  options.displayName ??= options.name;
  return options;
}

export function renderEnv({ baseUrl, tenant, appId, clientId, clientSecret }) {
  return [
    "# Junctura application credentials - private, never commit or embed in a browser.",
    `ROSETTA_URL=${baseUrl}`,
    `ROSETTA_TENANT=${tenant}`,
    `ROSETTA_APP_ID=${appId}`,
    `ROSETTA_APP_CLIENT_ID=${clientId}`,
    `ROSETTA_APP_CLIENT_SECRET=${clientSecret}`,
    "",
  ].join("\n");
}

const usage = `Usage: npm run app:enroll -- <name> [--tenant tenant-a] [--origin https://name.example.org] [--display-name "Name"]

Creates Keycloak client "app-<name>", enrolls and approves it in Junctura, and writes
its credentials to .env.app.<name>.local (ignored by Git). Requires a running local stack
(npm run local:up) and the .env created by npm run setup.`;

const q = value => `'${String(value).replaceAll("'", "''")}'`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
  const issuer = `${base}/identity/realms/rosetta`;
  const output = resolve(`.env.app.${options.name}.local`);
  if (!process.env.KEYCLOAK_ADMIN_PASSWORD) throw new Error("KEYCLOAK_ADMIN_PASSWORD missing: run from the repository root after npm run setup");
  if (existsSync(output)) throw new Error(`${output} already exists; this app is probably enrolled already`);

  const run = promisify(execFile);
  const sql = text => run("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-v", "ON_ERROR_STOP=1", "-Atc", text], { timeout: 60000 });
  const step = message => console.log(`• ${message}`);

  step("Operator sign-in to Keycloak");
  const issued = await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "rosetta-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (issued.status !== 200) throw new Error(`Keycloak operator login failed (${issued.status}); is the stack running?`);
  const adminToken = (await issued.json()).access_token;
  const admin = async (path, body, method = body === undefined ? "GET" : "POST") => fetch(`${base}/identity/admin/realms/rosetta/${path}`,
    { method, headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const must = async (response, expected, what) => {
    if (!expected.includes(response.status)) throw new Error(`${what} failed (${response.status}): ${(await response.text()).slice(0, 300)}`);
    return response;
  };
  const idFrom = response => response.headers.get("location").split("/").at(-1);

  const group = (await (await admin(`groups?search=${encodeURIComponent(options.tenant)}&exact=true`)).json()).find(g => g.name === options.tenant);
  if (!group) throw new Error(`Tenant group ${options.tenant} does not exist in Keycloak`);
  const template = (await (await admin("clients?clientId=tenant-a")).json())[0];
  const mappersFor = async () => {
    const source = await (await admin(`clients/${template.id}`)).json();
    const mappers = structuredClone(source.protocolMappers);
    for (const mapper of mappers) delete mapper.id;
    mappers.find(mapper => mapper.name === "tenant").config["claim.value"] = options.tenant;
    return mappers;
  };
  const roles = await Promise.all(["core-reader", "core-writer"].map(async name => (await admin(`roles/${name}`)).json()));

  if ((await (await admin(`clients?clientId=${options.clientId}`)).json()).length) throw new Error(`Keycloak client ${options.clientId} already exists`);

  step(`Demo management client for ${options.tenant}`);
  const managementClient = `rosetta-demo-management-${options.tenant}`;
  if (!(await (await admin(`clients?clientId=${managementClient}`)).json()).length) {
    await must(await admin("clients", { clientId: managementClient, enabled: true, protocol: "openid-connect", publicClient: true,
      standardFlowEnabled: true, directAccessGrantsEnabled: false, redirectUris: [CALLBACK],
      attributes: { "pkce.code.challenge.method": "S256" }, protocolMappers: await mappersFor() }), [201], "Create management client");
  }

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

  // Separate owner and approver humans keep the reviewed separation of duties.
  const human = async (label, permissions) => {
    const username = `rosetta-demo-${label}-${options.tenant}`;
    const password = randomBytes(24).toString("hex");
    let id = (await (await admin(`users?username=${username}&exact=true`)).json())[0]?.id;
    if (!id) {
      id = idFrom(await must(await admin("users", { username, enabled: true, firstName: "Demo", lastName: label, email: `${username}@example.invalid`,
        emailVerified: true, attributes: { tenant_id: [options.tenant] }, credentials: [{ type: "password", value: password, temporary: false }] }), [201], `Create ${label}`));
      await must(await admin(`users/${id}/groups/${group.id}`, undefined, "PUT"), [204], `Add ${label} to tenant`);
      await must(await admin(`users/${id}/role-mappings/realm`, roles), [204], `Assign ${label} roles`);
    } else {
      await must(await admin(`users/${id}/reset-password`, { type: "password", value: password, temporary: false }, "PUT"), [204], `Reset ${label} password`);
    }
    await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions)
      VALUES(${q(options.tenant)},${q(issuer)},${q(id)},${q(managementClient)},ARRAY[${permissions.map(q).join(",")}]::text[])
      ON CONFLICT (tenant_id,issuer,subject,management_client) DO UPDATE SET permissions=EXCLUDED.permissions, enabled=true;`);
    return { id, token: await login(username, password) };
  };
  step("Demo owner and independent approver");
  const owner = await human("owner", OWNER_PERMISSIONS);
  const approver = await human("approver", APPROVER_PERMISSIONS);

  step(`Backend client ${options.clientId}`);
  const clientUuid = idFrom(await must(await admin("clients", { clientId: options.clientId, enabled: true, protocol: "openid-connect",
    publicClient: false, serviceAccountsEnabled: true, standardFlowEnabled: false, directAccessGrantsEnabled: false,
    protocolMappers: await mappersFor() }), [201], "Create backend client"));
  const subject = (await (await admin(`clients/${clientUuid}/service-account-user`)).json()).id;
  await must(await admin(`users/${subject}/groups/${group.id}`, undefined, "PUT"), [204], "Add service account to tenant");
  await must(await admin(`users/${subject}/role-mappings/realm`, roles), [204], "Assign service account roles");
  const clientSecret = (await (await admin(`clients/${clientUuid}/client-secret`)).json()).value;
  const service = await must(await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: options.clientId, client_secret: clientSecret }) }), [200], "Backend token");
  const serviceToken = (await service.json()).access_token;

  const api = (path, token, body, headers = {}) => fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body) });
  await must(await api("/v1/identity", serviceToken), [200], "Verify backend identity");

  step("Enroll and register the application");
  await sql(`INSERT INTO app_private.enrollments(tenant_id,issuer,oauth_client_id,owner_subject,provider_origin,resource_subject)
    VALUES(${q(options.tenant)},${q(issuer)},${q(options.clientId)},${q(owner.id)},${q(options.origin)},${q(subject)});`);
  const created = await must(await api("/v1/applications", owner.token, { displayName: options.displayName, oauthClientId: options.clientId, providerOrigin: options.origin }), [201], "Register application");
  const pending = await created.json();

  step("Independent approval and activation");
  const decision = await must(await api("/v1/approvals", approver.token, { resourceType: "application", resourceId: pending.appId,
    resourceDigest: pending.digest, resourceRevision: pending.revision, requesterSubject: owner.id, requesterAppId: pending.appId,
    decision: "approve", expiresAt: new Date(Date.now() + 120000).toISOString() }), [201], "Approve application");
  const activated = await must(await api(`/v1/applications/${pending.appId}/approve`, approver.token, { approvalId: (await decision.json()).approvalId },
    { "If-Match": created.headers.get("etag") }), [200], "Activate application");
  const app = await activated.json();

  writeFileSync(output, renderEnv({ baseUrl: base, tenant: options.tenant, appId: app.appId, clientId: options.clientId, clientSecret }), { flag: "wx", mode: 0o600 });
  console.log(`\n✔ ${options.displayName} is active (appId ${app.appId}, client ${options.clientId}).`);
  console.log(`  Credentials: ${output}`);
  console.log(`  Try: node --env-file=.env --env-file=.env.app.${options.name}.local examples/sdk-foundation.mjs --enrolled`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`✖ ${error.message}`); process.exitCode = 1; });
}
