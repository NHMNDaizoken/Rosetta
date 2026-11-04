// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { handleTrustGraph } from "../src/modules/capability/trust/trust.mjs";
import { HttpError, json } from "../src/platform/http/http.mjs";

const identity = { tenantId: "tenant-a", subject: "approver", issuer: "https://identity.example.invalid", clientId: "management", roles: ["core-reader"] };
const provider = "11111111-1111-4111-8111-111111111111";
const consumer = "22222222-2222-4222-8222-222222222222";
const graph = {
  scope: "tenant",
  nodes: [{ appId: provider, displayName: "Đào tạo", state: "active", owned: false }, { appId: consumer, displayName: "Thư viện", state: "active", owned: false }],
  edges: [{ grantId: "33333333-3333-4333-8333-333333333333", providerAppId: provider, consumerAppId: consumer,
    capabilityId: `urn:junctura:capability:${provider}:student-lookup`, version: "1.0.0", title: "Tra cứu sinh viên",
    operations: ["discover", "invoke"], revision: 2, state: "active", createdAt: "2026-11-04T00:00:00+00:00",
    activatedAt: "2026-11-04T00:01:00+00:00", revokedAt: null, expiresAt: "2026-12-04T00:00:00+00:00" }],
  truncated: false, generatedAt: "2026-11-04T00:02:00.000Z",
};
let reply = { status: 200, value: graph };
let seen = [];
let data, core, base;
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));

before(async () => {
  data = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    seen.push({ url: request.url, authorization: request.headers.authorization, body: Buffer.concat(chunks).toString() });
    if (reply === "down") { response.writeHead(503); return response.end(); }
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(reply));
  });
  const dataUrl = await listen(data);
  core = createServer(async (request, response) => {
    try { await handleTrustGraph(request, response, identity, { dataUrl, dataSecret: "x".repeat(32) }, new URL(request.url, "http://core")); }
    catch (error) { json(response, error instanceof HttpError ? error.status : 500, { error: error.message }); }
  });
  base = await listen(core);
});
after(() => { data.close(); core.close(); });

const get = (options = {}) => fetch(`${base}${options.path ?? "/v1/trust/graph"}`, { method: options.method ?? "GET" });

test("the graph asserts only the private trust role and is never cached", async () => {
  seen = [];
  const response = await get();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), graph);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, "/rpc/trust_graph");
  assert.deepEqual(JSON.parse(seen[0].body), { payload: {} });
  const claims = JSON.parse(Buffer.from(seen[0].authorization.split(".")[1], "base64url"));
  assert.equal(claims.role, "junctura_trust_api");
  assert.deepEqual([claims.tenant_id, claims.sub, claims.client_id], ["tenant-a", "approver", "management"]);
});

test("permission errors, bad requests and outages fail closed", async () => {
  reply = { status: 403, error: "trust_permission_required" };
  assert.equal((await get()).status, 403);
  reply = { status: 200, value: graph };
  assert.equal((await get({ path: "/v1/trust/graph?tenant=tenant-b" })).status, 400, "no caller-chosen scope");
  assert.equal((await get({ method: "POST" })).status, 405);
  reply = "down";
  assert.equal((await get()).status, 503);
  reply = { status: 200, value: { nodes: "x" } };
  assert.equal((await get()).status, 503, "malformed database answer is rejected");
  reply = { status: 200, value: graph };
});
