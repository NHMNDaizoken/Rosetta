// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local demo helper for the tamper-evident audit chain (development stacks only).
//   npm run audit:demo                 verify through the real Gateway -> Core -> database path
//   npm run audit:demo -- tamper       secretly alter sealed event #2 directly in PostgreSQL
//   npm run audit:demo -- restore      undo that alteration exactly
//   npm run audit:demo -- token        print a short-lived auditor token for the Console
// The auditor is a local demo identity with only audit.read; operator credentials
// are read from .env and never printed.
import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const CALLBACK = "http://127.0.0.1:9876/callback";
const TAMPER_OFFSET = 1000000;
const COMMANDS = new Set(["verify", "tamper", "restore", "token"]);

export function parseArgs(argv) {
  const options = { command: "verify", tenant: "tenant-a", seq: 2 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--tenant") options.tenant = argv[++i];
    else if (arg === "--seq") options.seq = Number(argv[++i]);
    else if (COMMANDS.has(arg)) options.command = arg;
    else throw new Error(`Unknown argument ${arg}. Use verify, tamper, restore or token.`);
  }
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(options.tenant ?? "")) throw new Error("Invalid --tenant");
  if (!Number.isSafeInteger(options.seq) || options.seq < 1) throw new Error("--seq must be a positive integer");
  return options;
}

export function describe(result) {
  if (result.verified) {
    return [`✔ Chuỗi băm TOÀN VẸN — ${result.entries} sự kiện đã niêm phong` +
      (result.newlySealed ? ` (${result.newlySealed} vừa niêm phong)` : ""), `  head: ${result.headHash ?? "(trống)"}`].join("\n");
  }
  const broken = result.firstBreak;
  return [`✖ PHÁT HIỆN CAN THIỆP tại sự kiện #${broken.chainSeq}: ${broken.reason}`,
    `  ${result.entries} sự kiện đầu vẫn nguyên vẹn` + (broken.eventId ? `; eventId ${broken.eventId}` : "")].join("\n");
}

const q = value => `'${String(value).replaceAll("'", "''")}'`;
const run = promisify(execFile);
const sql = async text => (await run("docker", ["compose", "exec", "-T", "database", "psql", "-U", "junctura_admin",
  "-d", "junctura_data", "-v", "ON_ERROR_STOP=1", "-Atc", text], { timeout: 60000 })).stdout.trim().split(/\r?\n/).at(-1);

async function auditorToken(base, tenant) {
  const issuer = `${base}/identity/realms/junctura`;
  if (!process.env.KEYCLOAK_ADMIN_PASSWORD) throw new Error("KEYCLOAK_ADMIN_PASSWORD missing: run from the repository root after npm run setup");
  const issued = await fetch(`${base}/identity/realms/master/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "password", client_id: "admin-cli", username: "junctura-admin", password: process.env.KEYCLOAK_ADMIN_PASSWORD }) });
  if (issued.status !== 200) throw new Error(`Keycloak operator login failed (${issued.status}); is the stack running?`);
  const adminToken = (await issued.json()).access_token;
  const admin = (path, body, method = body === undefined ? "GET" : "POST") => fetch(`${base}/identity/admin/realms/junctura/${path}`,
    { method, headers: { Authorization: `Bearer ${adminToken}`, "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const managementClient = `junctura-demo-management-${tenant}`;
  if (!(await (await admin(`clients?clientId=${managementClient}`)).json()).length) {
    throw new Error(`Demo management client missing: run npm run app:enroll -- <name> --tenant ${tenant} first`);
  }
  const group = (await (await admin(`groups?search=${encodeURIComponent(tenant)}&exact=true`)).json()).find(g => g.name === tenant);
  if (!group) throw new Error(`Tenant group ${tenant} does not exist`);
  const username = `junctura-demo-auditor-${tenant}`;
  const password = randomBytes(24).toString("hex");
  let id = (await (await admin(`users?username=${username}&exact=true`)).json())[0]?.id;
  if (!id) {
    const created = await admin("users", { username, enabled: true, firstName: "Demo", lastName: "auditor", email: `${username}@example.invalid`,
      emailVerified: true, attributes: { tenant_id: [tenant] }, credentials: [{ type: "password", value: password, temporary: false }] });
    if (created.status !== 201) throw new Error(`Could not create demo auditor (${created.status})`);
    id = created.headers.get("location").split("/").at(-1);
    await admin(`users/${id}/groups/${group.id}`, undefined, "PUT");
    const reader = await (await admin("roles/core-reader")).json();
    await admin(`users/${id}/role-mappings/realm`, [reader]);
  } else {
    await admin(`users/${id}/reset-password`, { type: "password", value: password, temporary: false }, "PUT");
  }
  await sql(`INSERT INTO app_private.principals(tenant_id,issuer,subject,management_client,permissions)
    VALUES(${q(tenant)},${q(issuer)},${q(id)},${q(managementClient)},ARRAY['audit.read']::text[])
    ON CONFLICT (tenant_id,issuer,subject,management_client) DO UPDATE SET permissions=EXCLUDED.permissions, enabled=true;`);
  const verifier = randomBytes(32).toString("base64url");
  const params = new URLSearchParams({ client_id: managementClient, response_type: "code", scope: "openid", redirect_uri: CALLBACK,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url") });
  const page = await fetch(`${issuer}/protocol/openid-connect/auth?${params}`, { redirect: "manual" });
  const cookies = page.headers.getSetCookie().map(value => value.split(";", 1)[0]).join("; ");
  const action = (await page.text()).match(/<form[^>]*action="([^"]+)"/);
  if (!action) throw new Error("Keycloak login form not found");
  const login = await fetch(action[1].replaceAll("&amp;", "&"), { method: "POST", redirect: "manual", headers: { Cookie: cookies },
    body: new URLSearchParams({ username, password, credentialId: "" }) });
  if (login.status !== 302) throw new Error(`Demo auditor could not sign in (${login.status})`);
  const code = new URL(login.headers.get("location")).searchParams.get("code");
  const tokens = await fetch(`${issuer}/protocol/openid-connect/token`, { method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: managementClient, redirect_uri: CALLBACK, code, code_verifier: verifier }) });
  if (tokens.status !== 200) throw new Error(`Token exchange failed (${tokens.status})`);
  return (await tokens.json()).access_token;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
  const where = `tenant_id=${q(options.tenant)} AND chain_seq=${options.seq}`;
  if (options.command === "tamper") {
    const changed = await sql(`WITH t AS (UPDATE app_private.audit SET revision=revision+${TAMPER_OFFSET} WHERE ${where} AND revision<${TAMPER_OFFSET} RETURNING 1) SELECT count(*) FROM t;`);
    if (changed !== "1") throw new Error(`No sealed, untampered event #${options.seq} in ${options.tenant}. Run npm run audit:demo first to seal events.`);
    console.log(`⚠ Đã sửa lén sự kiện #${options.seq} trực tiếp trong PostgreSQL (bỏ qua mọi API). Chạy lại: npm run audit:demo`);
    return;
  }
  if (options.command === "restore") {
    const changed = await sql(`WITH t AS (UPDATE app_private.audit SET revision=revision-${TAMPER_OFFSET} WHERE ${where} AND revision>=${TAMPER_OFFSET} RETURNING 1) SELECT count(*) FROM t;`);
    if (changed !== "1") throw new Error(`Event #${options.seq} in ${options.tenant} was not altered by this demo`);
    console.log(`↺ Đã trả sự kiện #${options.seq} về đúng nội dung gốc. Chạy lại: npm run audit:demo`);
    return;
  }
  const token = await auditorToken(base, options.tenant);
  if (options.command === "token") {
    console.log("Token kiểm toán (hết hạn sau vài phút, chỉ dùng cho demo local). Dán vào Console → Cài đặt → Token:\n");
    console.log(token);
    return;
  }
  const response = await fetch(`${base}/v1/audit-events/verify`, { method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
  const body = await response.json().catch(() => ({}));
  if (response.status !== 200) throw new Error(`Verification failed (${response.status} ${body.error ?? ""})`);
  console.log(describe(body));
  if (!body.verified) process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`✖ ${error.message}`); process.exitCode = 1; });
}
