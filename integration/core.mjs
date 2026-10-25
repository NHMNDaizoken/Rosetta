// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { contractFetch as fetch, verifyContracts } from './contract.mjs';

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer = `${base}/identity/realms/rosetta`;
let tokenA, tokenB, reader;

async function token(client, secret) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: client, client_secret: secret }),
  });
  assert.equal(response.status, 200, `${client}: token issuance`);
  return (await response.json()).access_token;
}

async function api(path, accessToken, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
}

const compose = (...args) => promisify(execFile)("docker", ["compose", ...args], { timeout: 180000 });

async function waitReady() {
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    try { if ((await api("/ready")).status === 200) return; } catch { /* Wait for actual dependency recovery. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert.fail("Core dependencies did not recover within 120 seconds");
}

before(async () => {
  tokenA = await token("tenant-a", process.env.TENANT_A_SECRET);
  tokenB = await token("tenant-b", process.env.TENANT_B_SECRET);
  reader = await token("reader", process.env.READER_SECRET);
});

after(async () => verifyContracts('core'));

test('public process and OIDC boundary methods conform without changing their wire representations', async () => {
  assert.equal((await api('/health', undefined, { method: 'HEAD' })).status, 200);
  assert.equal((await api('/health', undefined, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${issuer}/protocol/openid-connect/certs`)).status, 200);
  assert.equal((await fetch(`${issuer}/protocol/openid-connect/logout`, { redirect: 'manual' })).status, 200);
  const denied = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'tenant-a', client_secret: 'synthetic-invalid-secret' }),
  });
  assert.equal(denied.status, 401);
});

test("gateway preserves health and exposes real OIDC discovery/readiness", async () => {
  assert.deepEqual(await (await api("/health")).json(), { service: "rosetta-core", status: "ok" });
  assert.equal((await api("/ready")).status, 200);
  const discovery = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
  assert.equal(discovery.issuer, issuer);
  assert.ok(discovery.response_types_supported.includes("code"));
  assert.ok(discovery.code_challenge_methods_supported.includes("S256"));
});

test("gateway rejects missing/invalid credentials and trusts only verified tenant membership", async () => {
  assert.equal((await api("/v1/identity")).status, 401);
  assert.equal((await api("/v1/identity", "invalid.token.value")).status, 401);
  for (const [accessToken, tenantId] of [[tokenA, "tenant-a"], [tokenB, "tenant-b"]]) {
    const response = await api("/v1/identity", accessToken, { headers: { "X-Tenant-Id": "spoofed", "X-Rosetta-Tenant": "spoofed" } });
    assert.equal(response.status, 200);
    const identity = await response.json();
    assert.equal(identity.tenantId, tenantId);
    assert.ok(identity.roles.includes("core-reader"));
  }
  assert.equal((await api("/internal/auth", tokenA)).status, 404);
});

test("SSO completes a real authorization-code + PKCE flow and revokes the session", async () => {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: "rosetta-local", response_type: "code", scope: "openid",
    redirect_uri: "http://127.0.0.1:9876/callback", state,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const login = await fetch(`${issuer}/protocol/openid-connect/auth?${params}`, { redirect: "manual" });
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const html = await login.text();
  const action = html.match(/<form[^>]*action="([^"]+)"/);
  assert.ok(action, "Keycloak login form exists");
  const result = await fetch(action[1].replaceAll("&amp;", "&"), {
    method: "POST", redirect: "manual",
    headers: { Cookie: cookies },
    body: new URLSearchParams({ username: "local-user", password: process.env.SSO_USER_PASSWORD, credentialId: "" }),
  });
  assert.equal(result.status, 302, "Keycloak accepts the real fixture credentials");
  const callback = new URL(result.headers.get("location"));
  assert.equal(callback.origin, "http://127.0.0.1:9876");
  assert.equal(callback.searchParams.get("state"), state);
  assert.ok(callback.searchParams.get("code"));
  const exchange = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: "rosetta-local",
      redirect_uri: "http://127.0.0.1:9876/callback", code: callback.searchParams.get("code"), code_verifier: verifier }),
  });
  assert.equal(exchange.status, 200, "PKCE code exchange succeeds");
  const session = await exchange.json();
  for (const method of ['GET', 'POST']) {
    const userInfo = await fetch(`${issuer}/protocol/openid-connect/userinfo`, { method, headers: { Authorization: `Bearer ${session.access_token}` } });
    assert.equal(userInfo.status, 200);
  }
  const refreshed = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'rosetta-local', refresh_token: session.refresh_token }),
  });
  assert.equal(refreshed.status, 200);
  const renewed = await refreshed.json();
  const identity = await api("/v1/identity", session.access_token);
  assert.equal(identity.status, 200);
  assert.equal((await identity.json()).tenantId, "tenant-a");
  const logout = await fetch(`${issuer}/protocol/openid-connect/logout`, {
    method: "POST", body: new URLSearchParams({ client_id: "rosetta-local", refresh_token: renewed.refresh_token }),
  });
  assert.equal(logout.status, 204);
  assert.equal((await api("/v1/identity", session.access_token)).status, 401, "Revoked session is rejected");
});

test("structured data CRUD enforces roles, input limits and tenant isolation in API and SQL", async () => {
  const collection = `fixture_${randomBytes(6).toString("hex")}`;
  const path = `/v1/data/${collection}`;
  const post = (value) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
  assert.equal((await api(path, reader, post({ data: { fixture: true } }))).status, 403);
  assert.equal((await api(path, tokenA, post({ data: {}, tenant_id: "tenant-b" }))).status, 400);
  assert.equal((await api(path, tokenA, post({ data: { large: "x".repeat(70000) } }))).status, 413);
  const created = await api(path, tokenA, post({ data: { fixture: "created" } }));
  assert.equal(created.status, 201);
  const record = await created.json();
  const item = `${path}/${record.id}`;
  assert.equal((await api(item, reader)).status, 200);
  assert.equal((await api(item, tokenB)).status, 404);
  assert.deepEqual((await (await api(path, tokenB)).json()).items, []);
  assert.equal((await api(`${path}?limit=101`, tokenA)).status, 400);
  assert.equal((await api(`${path}?tenant_id=tenant-b`, tokenA)).status, 400);
  assert.equal((await api(item, tokenB, { ...post({ data: {} }), method: "PATCH" })).status, 404);
  assert.equal((await api(item, tokenB, { method: "DELETE" })).status, 404);
  const updated = await api(item, tokenA, { ...post({ data: { fixture: "updated" } }), method: "PATCH" });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.fixture, "updated");
  const sql = `SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{"tenant_id":"tenant-b"}',false); SELECT count(*) FROM core.records WHERE id='${record.id}';`;
  const result = await promisify(execFile)("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atc", sql]);
  assert.equal(result.stdout.trim().split(/\r?\n/).at(-1), "0", "SQL RLS hides tenant A's row from tenant B");
  const forbiddenSql = `SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{"tenant_id":"tenant-a"}',false); UPDATE core.records SET tenant_id='tenant-b' WHERE id='${record.id}';`;
  await assert.rejects(
    promisify(execFile)("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atc", forbiddenSql]),
    (error) => error.code === 1 && /row-level security/.test(error.stderr),
  );
  assert.equal((await api(item, tokenA, { method: "DELETE" })).status, 204);
  assert.equal((await api(item, tokenA)).status, 404);
});

test("object storage round trips opaque bytes and rejects cross-tenant access and unsafe uploads", async () => {
  const bytes = Buffer.from([0, 255, 1, 2, 60, 62, 128, 42]);
  const upload = { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: bytes };
  assert.equal((await api("/v1/objects", reader, upload)).status, 403);
  assert.equal((await api("/v1/objects", tokenA, { ...upload, headers: { "Content-Type": "text/html" } })).status, 415);
  assert.equal((await api("/v1/objects", tokenA, { ...upload, body: Buffer.alloc(5 * 1024 * 1024 + 1) })).status, 413);
  const created = await api("/v1/objects", tokenA, upload);
  assert.equal(created.status, 201);
  const object = await created.json();
  assert.equal(object.size, bytes.length);
  const path = `/v1/objects/${object.id}`;
  const download = await api(path, tokenA);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  assert.match(download.headers.get("content-disposition"), /^attachment;/);
  assert.equal((await api(path, tokenB)).status, 404);
  assert.equal((await api(path, tokenB, { method: "DELETE" })).status, 404);
  assert.equal((await api(`${path}?tenant_id=tenant-b`, tokenA)).status, 400);
  assert.equal((await api("/v1/objects/not-a-uuid", tokenA)).status, 400);
  assert.equal((await api(path, tokenA, { method: "DELETE" })).status, 204);
  assert.equal((await api(path, tokenA)).status, 404);
  const retryPath = `/v1/objects/${randomUUID()}`;
  assert.equal((await api(retryPath, tokenA, { ...upload, method: "PUT" })).status, 201);
  assert.equal((await api(retryPath, tokenA, { ...upload, method: "PUT" })).status, 200);
  assert.deepEqual(Buffer.from(await (await api(retryPath, tokenA)).arrayBuffer()), bytes);
  assert.equal((await api(retryPath, tokenA, { method: "DELETE" })).status, 204);
});

test("workflow engine enforces tenant ownership, durable idempotency, completion and cancellation", async () => {
  const definitions = await api("/v1/workflows/definitions", tokenA);
  assert.equal(definitions.status, 200);
  const [definition] = (await definitions.json()).items;
  assert.ok(definition.id);
  assert.equal(definition.key, "rosetta_checkpoint");
  const [otherDefinition] = (await (await api("/v1/workflows/definitions", tokenB)).json()).items;
  assert.notEqual(definition.id, otherDefinition.id);
  const key = randomUUID();
  const body = { definitionId: definition.id, input: { fixture: "checkpoint", nested: { b: 2, a: 1 } } };
  const start = (accessToken, input = body, requestKey = key) => api("/v1/workflows/executions", accessToken, {
    method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey }, body: JSON.stringify(input),
  });
  assert.equal((await start(reader)).status, 403);
  assert.equal((await start(tokenB)).status, 404);
  assert.equal((await start(tokenA, { ...body, tenantId: "tenant-b" })).status, 400);
  const created = await start(tokenA);
  assert.equal(created.status, 201);
  const instance = await created.json();
  assert.equal(instance.status, "running");
  assert.deepEqual(instance.input, body.input);
  const tenantB = await start(tokenB, { definitionId: otherDefinition.id, input: {} });
  assert.equal(tenantB.status, 201, "The same idempotency key is isolated between tenants");
  const otherInstance = await tenantB.json();
  assert.notEqual(instance.id, otherInstance.id);
  assert.equal((await api(`/v1/workflows/executions/${encodeURIComponent(otherInstance.id)}`, tokenA)).status, 404);
  assert.equal((await api(`/v1/workflows/executions/${encodeURIComponent(otherInstance.id)}`, tokenB, { method: "DELETE" })).status, 204);
  const path = `/v1/workflows/executions/${encodeURIComponent(instance.id)}`;
  assert.equal((await api(path, tokenB)).status, 404);
  assert.equal((await api(path, tokenB, { method: "DELETE" })).status, 404);
  const emptyPost = { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" };
  assert.equal((await api(`${path}/complete`, tokenB, emptyPost)).status, 404);
  assert.equal((await api(`${path}/complete`, reader, emptyPost)).status, 403);
  const replay = await start(tokenA, { definitionId: definition.id, input: { nested: { a: 1, b: 2 }, fixture: "checkpoint" } });
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).id, instance.id);
  assert.equal((await start(tokenA, { definitionId: definition.id, input: { changed: true } })).status, 409);
  const clearPointer = `SET ROLE rosetta_api; SELECT set_config('request.jwt.claims','{"tenant_id":"tenant-a"}',false); UPDATE core.workflow_requests SET engine_id=NULL WHERE key='${key}';`;
  await promisify(execFile)("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_data", "-Atc", clearPointer]);
  const recovered = await start(tokenA);
  assert.equal(recovered.status, 200, "An ambiguous engine outcome is reconciled from durable history");
  assert.equal((await recovered.json()).id, instance.id);
  assert.equal((await (await api(`${path}/complete`, tokenA, emptyPost)).json()).status, "completed");
  assert.equal((await (await api(`${path}/complete`, tokenA, emptyPost)).json()).status, "completed");
  const concurrentKey = randomUUID();
  const attempts = await Promise.all([start(tokenA, body, concurrentKey), start(tokenA, body, concurrentKey), start(tokenA, body, concurrentKey)]);
  assert.equal(attempts.filter((result) => result.status === 201).length, 1);
  assert.ok(attempts.every((result) => [200, 201, 409].includes(result.status)));
  const concurrent = await (await start(tokenA, body, concurrentKey)).json();
  const countSql = `SELECT count(*) FROM act_hi_procinst WHERE tenant_id_='tenant-a' AND business_key_='tenant-a:${concurrentKey}';`;
  const count = await promisify(execFile)("docker", ["compose", "exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "rosetta_workflow", "-Atc", countSql]);
  assert.equal(count.stdout.trim(), "1", "Concurrent retries create exactly one engine execution");
  const cancelledPath = `/v1/workflows/executions/${encodeURIComponent(concurrent.id)}`;
  assert.equal((await api(cancelledPath, tokenA, { method: "DELETE" })).status, 204);
  assert.equal((await api(cancelledPath, tokenA, { method: "DELETE" })).status, 204);
  assert.equal((await (await api(cancelledPath, tokenA)).json()).status, "cancelled");
});

test("all five Cores preserve a technical fixture through dependency failure and container recreation", { timeout: 240000 }, async () => {
  const objectId = randomUUID();
  const bytes = Buffer.from(`rosetta-cross-core-${randomUUID()}`);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const upload = await api(`/v1/objects/${objectId}`, tokenA, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: bytes });
  assert.equal(upload.status, 201);
  const collection = `cross_${randomBytes(6).toString("hex")}`;
  const saved = await api(`/v1/data/${collection}`, tokenA, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ data: { objectId, checksum } }) });
  assert.equal(saved.status, 201);
  const record = await saved.json();
  const [definition] = (await (await api("/v1/workflows/definitions", tokenA)).json()).items;
  const input = { recordId: record.id, objectId, checksum };
  const started = await api("/v1/workflows/executions", tokenA, { method: "POST",
    headers: { "Content-Type": "application/json", "Idempotency-Key": randomUUID() },
    body: JSON.stringify({ definitionId: definition.id, input }) });
  assert.equal(started.status, 201);
  const execution = await started.json();
  const executionPath = `/v1/workflows/executions/${encodeURIComponent(execution.id)}`;
  await compose("stop", "data", "objects", "workflow");
  try {
    assert.equal((await api("/health")).status, 200);
    assert.equal((await api("/ready")).status, 503);
    assert.equal((await api(`/v1/objects/${objectId}`, tokenA)).status, 503);
    assert.equal((await api(executionPath, tokenA)).status, 503);
  } finally {
    await compose("restart", "database");
    await compose("up", "--detach", "--no-deps", "--force-recreate", "data", "objects", "workflow");
    await waitReady();
  }
  const loaded = await api(`/v1/data/${collection}/${record.id}`, tokenA);
  assert.equal(loaded.status, 200);
  assert.deepEqual((await loaded.json()).data, { objectId, checksum });
  const download = await api(`/v1/objects/${objectId}`, tokenA);
  assert.equal(download.status, 200);
  assert.equal(createHash("sha256").update(Buffer.from(await download.arrayBuffer())).digest("hex"), checksum);
  const resumed = await api(executionPath, tokenA);
  assert.equal(resumed.status, 200);
  assert.deepEqual((await resumed.json()).input, input);
  const complete = await api(`${executionPath}/complete`, tokenA, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  assert.equal(complete.status, 200);
  assert.equal((await complete.json()).status, "completed");
  assert.equal((await api(`/v1/data/${collection}/${record.id}`, tokenA, { method: "DELETE" })).status, 204);
  assert.equal((await api(`/v1/objects/${objectId}`, tokenA, { method: "DELETE" })).status, 204);
  await compose("up", "--detach", "--no-deps", "--force-recreate", "core");
  await waitReady();
  assert.equal((await api("/v1/identity", tokenA)).status, 200, "Gateway resolves the recreated Core without manual reload");
});

test("identity outage fails closed while process health remains accurate, then recovers", { timeout: 180000 }, async () => {
  await compose("stop", "identity");
  try {
    assert.equal((await api("/health")).status, 200);
    assert.equal((await api("/ready")).status, 503);
    assert.equal((await api("/v1/identity", tokenA)).status, 503);
  } finally {
    await compose("start", "identity");
    await waitReady();
  }
  tokenA = await token("tenant-a", process.env.TENANT_A_SECRET);
  assert.equal((await api("/v1/identity", tokenA)).status, 200);
});
