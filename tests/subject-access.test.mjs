// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { handleSubjectAccess } from "../src/modules/audit/audit.mjs";
import { jsonDigest, reserveExecution, validateExecutionContext, validateExecutionCreate } from "../src/modules/capability/execution/execution.mjs";
import { HttpError, json } from "../src/platform/http/http.mjs";

const capability = { capabilityId: "urn:junctura:capability:22222222-2222-4222-8222-222222222222:vaccination", version: "1.0.0", manifestDigest: `sha256:${"b".repeat(64)}` };
const body = context => ({ target: { kind: "capability", capability }, input: { patient: "p1" }, ...(context ? { context } : {}) });

test("execution context is optional, closed and strictly shaped", () => {
  assert.ok(validateExecutionCreate(body()));
  assert.ok(validateExecutionCreate(body({ purpose: "treatment" })));
  assert.ok(validateExecutionCreate(body({ purpose: "insurance_claim", dataSubject: "8f14e45f-ceea-4672-9a2b-1f3c5d7e9a01" })));
  for (const context of [{}, { purpose: "Treatment" }, { purpose: "kham-benh" }, { purpose: "t" }, { purpose: "treatment", extra: 1 },
    { purpose: "treatment", dataSubject: "" }, { purpose: "treatment", dataSubject: "a\nb" }, { purpose: "treatment", dataSubject: 7 },
    { purpose: "treatment", dataSubject: "x".repeat(256) }, [], "treatment", null]) {
    assert.throws(() => validateExecutionContext(context), error => error instanceof HttpError && error.status === 422, JSON.stringify(context));
  }
  assert.throws(() => validateExecutionCreate({ ...body(), extra: 1 }), error => error.status === 400);
  assert.throws(() => validateExecutionCreate(body({ purpose: "Bad" })), error => error.status === 422);
});

test("a context is bound into the idempotent request digest and sent with the reservation", async t => {
  const sent = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    sent.push(JSON.parse(options.body));
    return Response.json({ status: 202, value: { executionId: "aaaaaaaa-0000-4000-8000-000000000001", state: "running" } });
  });
  const identity = { tenantId: "tenant-a", issuer: "https://id.example", subject: "svc", clientId: "app-bv", roles: ["core-reader", "core-writer"], credentialExpiresAt: Date.now() + 60000 };
  const config = { dataUrl: "https://data.example.invalid", dataSecret: "synthetic-test-signing-secret-with-no-authority" };
  const request = key => ({ headers: { "idempotency-key": key } });
  const resolved = { manifest: { timeoutMs: 5000 }, authorityExpiresAt: new Date(Date.now() + 60000).toISOString() };
  const leases = { has: () => true };
  await reserveExecution(config, identity, request("11111111-1111-4111-8111-111111111111"), body(), leases, resolved);
  const context = { purpose: "treatment", dataSubject: "patient-1" };
  await reserveExecution(config, identity, request("22222222-2222-4222-8222-222222222222"), body(context), leases, resolved);
  const [plain, withContext] = sent.map(item => item.payload);
  const inputDigest = jsonDigest({ patient: "p1" });
  assert.equal(plain.requestDigest, jsonDigest({ target: body().target, inputDigest }), "requests without context keep their digest");
  assert.equal(plain.context, undefined);
  assert.deepEqual(withContext.context, context);
  assert.equal(withContext.requestDigest, jsonDigest({ target: body().target, inputDigest, context }));
  assert.notEqual(withContext.requestDigest, plain.requestDigest);
});

const identity = { tenantId: "tenant-a", subject: "patient-1", issuer: "https://identity.example.invalid", clientId: "portal", roles: ["core-reader"] };
const log = { entries: [], truncated: false, generatedAt: "2026-11-04T00:00:00.000Z" };
let reply = { status: 200, value: log };
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
    try { await handleSubjectAccess(request, response, identity, { dataUrl, dataSecret: "x".repeat(32) }, new URL(request.url, "http://core")); }
    catch (error) { json(response, error instanceof HttpError ? error.status : 500, { error: error.message }); }
  });
  base = await listen(core);
});
after(() => { data.close(); core.close(); });

test("the subject access log asserts only the subject role for the caller itself", async () => {
  seen = [];
  const response = await fetch(`${base}/v1/me/data-access`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), log);
  assert.equal(seen[0].url, "/rpc/subject_access");
  assert.deepEqual(JSON.parse(seen[0].body), { payload: {} });
  const claims = JSON.parse(Buffer.from(seen[0].authorization.split(".")[1], "base64url"));
  assert.equal(claims.role, "junctura_subject_api");
  assert.deepEqual([claims.tenant_id, claims.sub], ["tenant-a", "patient-1"]);
  assert.equal((await fetch(`${base}/v1/me/data-access?subject=someone-else`)).status, 400, "no caller-chosen subject");
  assert.equal((await fetch(`${base}/v1/me/data-access`, { method: "POST" })).status, 405);
  reply = { status: 403, error: "verified_subject_required" };
  assert.equal((await fetch(`${base}/v1/me/data-access`)).status, 403);
  reply = "down";
  assert.equal((await fetch(`${base}/v1/me/data-access`)).status, 503);
  reply = { status: 200, value: {} };
  assert.equal((await fetch(`${base}/v1/me/data-access`)).status, 503);
  reply = { status: 200, value: log };
});
