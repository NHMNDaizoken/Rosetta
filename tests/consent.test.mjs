// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, before, test } from "node:test";
import { createApi } from "../src/api.mjs";
import { handleConsent, isConsentPath } from "../src/modules/consent/consent.mjs";
import { validateExecutionContext } from "../src/modules/capability/execution/execution.mjs";
import { HttpError, json } from "../src/platform/http/http.mjs";

const CONSENT = "dcf6b718-7d02-41cc-8a2b-bb4aa9026d71";
const EXECUTION = "aaaaaaaa-0000-4000-8000-000000000005";
let identity = { tenantId: "tenant-a", subject: "patient-1", issuer: "https://id.example", clientId: "portal", roles: ["core-reader"] };
let reply = () => ({ status: 200, value: { consents: [] } });
let seen = [];
let data, core, base;
const listen = server => new Promise(resolve => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${server.address().port}`)));
before(async () => {
  data = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    const claims = JSON.parse(Buffer.from(request.headers.authorization.split(".")[1], "base64url"));
    seen.push({ url: request.url, body, role: claims.role, sub: claims.sub });
    const value = reply(body);
    if (value === "down") { response.writeHead(503); return response.end(); }
    response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify(value));
  });
  const dataUrl = await listen(data);
  core = createServer(async (request, response) => {
    try { await handleConsent(request, response, identity, { dataUrl, dataSecret: "x".repeat(32) }, new URL(request.url, "http://core")); }
    catch (error) { json(response, error instanceof HttpError ? error.status : 500, { error: error.message }); }
  });
  base = await listen(core);
});
after(() => { data.close(); core.close(); });
const call = (path, method = "GET", body) => fetch(base + path, { method,
  headers: body === undefined ? {} : { "Content-Type": "application/json" }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });

test("consent routes are recognised exactly and the API module loads them", () => {
  for (const path of ["/v1/me/consents", `/v1/me/consents/${CONSENT}/revoke`, "/v1/emergency-accesses", `/v1/emergency-accesses/${EXECUTION}/review`]) assert.ok(isConsentPath(path), path);
  for (const path of ["/v1/me/data-access", "/v1/me", "/v1/emergency", undefined]) assert.equal(isConsentPath(path), false, String(path));
  assert.equal(typeof createApi, "function");
});

test("people list, create and revoke only their own consents through the subject role", async () => {
  seen = [];
  assert.equal((await call("/v1/me/consents")).status, 200);
  const proposal = { consumerAppId: "11111111-1111-4111-8111-111111111111", capabilityId: "urn:junctura:capability:22222222-2222-4222-8222-222222222222:vaccination", purposes: ["treatment"], expiresAt: "2026-12-01T00:00:00.000Z" };
  reply = () => ({ status: 201, value: { consentId: CONSENT, state: "active" } });
  const created = await call("/v1/me/consents", "POST", proposal);
  assert.equal(created.status, 201);
  assert.equal(created.headers.get("location"), `/v1/me/consents/${CONSENT}`);
  assert.equal(created.headers.get("cache-control"), "no-store");
  reply = () => ({ status: 200, value: { consentId: CONSENT, state: "revoked" } });
  assert.equal((await call(`/v1/me/consents/${CONSENT}/revoke`, "POST", {})).status, 200);
  assert.deepEqual(seen.map(item => [item.url, item.role, item.sub, item.body.operation]), [
    ["/rpc/subject_consent", "junctura_subject_api", "patient-1", "list"],
    ["/rpc/subject_consent", "junctura_subject_api", "patient-1", "create"],
    ["/rpc/subject_consent", "junctura_subject_api", "patient-1", "revoke"],
  ]);
  assert.deepEqual(seen[1].body.payload, proposal);
  assert.deepEqual(seen[2].body.payload, { consentId: CONSENT });
});

test("consent requests are strict and failures stay closed", async () => {
  assert.equal((await call("/v1/me/consents?subject=other")).status, 400);
  assert.equal((await call("/v1/me/consents", "POST", '{"purposes":["a"],"purposes":["b"]}')).status, 400, "duplicate keys");
  assert.equal((await call("/v1/me/consents", "POST", "[]")).status, 400);
  assert.equal((await fetch(base + "/v1/me/consents", { method: "POST", body: "{}" })).status, 415);
  assert.equal((await call("/v1/me/consents/not-a-uuid/revoke", "POST", {})).status, 400);
  assert.equal((await call(`/v1/me/consents/${CONSENT}/revoke`, "POST", { reason: "x" })).status, 400);
  assert.equal((await call("/v1/me/consents", "DELETE")).status, 405);
  reply = () => ({ status: 404, error: "not_found" });
  assert.equal((await call("/v1/me/consents", "POST", {})).status, 404);
  reply = () => "down";
  assert.equal((await call("/v1/me/consents")).status, 503);
});

test("emergency reviews use the trust role and need a writer to decide", async () => {
  seen = [];
  identity = { ...identity, subject: "admin", clientId: "management" };
  reply = () => ({ status: 200, value: { reviews: [] } });
  assert.equal((await call("/v1/emergency-accesses")).status, 200);
  assert.equal((await call(`/v1/emergency-accesses/${EXECUTION}/review`, "POST", { decision: "justified", note: "ok" })).status, 403, "readers cannot decide");
  identity = { ...identity, roles: ["core-reader", "core-writer"] };
  reply = () => ({ status: 200, value: { executionId: EXECUTION, state: "justified" } });
  assert.equal((await call(`/v1/emergency-accesses/${EXECUTION}/review`, "POST", { decision: "justified", note: "Đã xác minh" })).status, 200);
  assert.equal((await call(`/v1/emergency-accesses/${EXECUTION}/review`, "POST", { decision: "justified" })).status, 400);
  assert.deepEqual(seen.map(item => [item.role, item.body.operation]), [["junctura_trust_api", "list"], ["junctura_trust_api", "review"]]);
  assert.deepEqual(seen[1].body.payload, { executionId: EXECUTION, decision: "justified", note: "Đã xác minh" });
});

test("emergency context needs a subject and a justification", () => {
  assert.ok(validateExecutionContext({ purpose: "emergency_care", dataSubject: "p", emergency: true, justification: "Bệnh nhân bất tỉnh" }));
  for (const context of [{ purpose: "emergency_care", emergency: true, justification: "Bệnh nhân bất tỉnh" },
    { purpose: "emergency_care", dataSubject: "p", emergency: true }, { purpose: "emergency_care", dataSubject: "p", justification: "Bệnh nhân bất tỉnh" },
    { purpose: "emergency_care", dataSubject: "p", emergency: false, justification: "Bệnh nhân bất tỉnh" },
    { purpose: "emergency_care", dataSubject: "p", emergency: true, justification: "short" }]) {
    assert.throws(() => validateExecutionContext(context), error => error.status === 422, JSON.stringify(context));
  }
});
