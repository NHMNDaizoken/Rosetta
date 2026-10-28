// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { applicationDigest, validateApplicationBody } from "../src/applications.mjs";
import { createAuthorizer } from "../src/auth.mjs";
import { readFlatJsonObject } from "../src/http.mjs";

const proposal = { displayName: "Technical provider A", oauthClientId: "provider-a", providerOrigin: "https://provider-a.example.invalid", ownerSubject: "synthetic-owner" };
test("application digest matches the documented JCS string/object fixture", () => {
  assert.equal(applicationDigest("11111111-1111-4111-8111-111111111111", "tenant-a", proposal), "sha256:73d1512ef505518ea2341f2351e4c2f49faf63f43dbb7d343b74c1bdba4f59e4");
  assert.equal(applicationDigest("id", "tenant", proposal), applicationDigest("id", "tenant", Object.fromEntries(Object.entries(proposal).reverse())));
  assert.throws(() => applicationDigest("id", "tenant", { invalid: "\ud800" }));
});
test("registration accepts only canonical HTTPS origins and closed request fields", () => {
  const { ownerSubject, ...body } = proposal;
  assert.deepEqual(validateApplicationBody(body, "create"), body);
  for (const patch of [{ tenantId: "tenant-b" }, { ownerSubject }, { providerOrigin: "https://x.example.invalid/" }, { providerOrigin: "http://x.example.invalid" }, { providerOrigin: "https://u:p@x.example.invalid" }, { providerOrigin: "https://x.example.invalid/%2e" }, { providerOrigin: "https://X.example.invalid" }, { providerOrigin: "https://127.0.0.1" }, { providerOrigin: "https://[::1]" }, { displayName: "" }]) assert.throws(() => validateApplicationBody({ ...body, ...patch }, "create"));
  assert.throws(() => validateApplicationBody({ action: "reactivate", reason: "technical" }, "state"));
  assert.throws(() => validateApplicationBody({ action: "revoke", reason: "technical", approvalId: "11111111-1111-4111-8111-111111111111" }, "state"));
});
test("application wire reader rejects duplicate/escaped duplicate keys, malformed Unicode and nested authority", async () => {
  for (const text of ['{"displayName":"a","displayName":"b"}', '{"name":"a","na\\u006de":"b"}', '{"name":"\\ud800"}', '{"permissions":{}}', '{"x":1e400}', '[]']) {
    const request = Readable.from([Buffer.from(text)]); request.headers = { "content-type": "application/json" };
    await assert.rejects(readFlatJsonObject(request), error => error.status === 400);
  }
  const request = Readable.from([Buffer.from([123,34,120,34,58,34,255,34,125])]); request.headers = { "content-type": "application/json" };
  await assert.rejects(readFlatJsonObject(request), error => error.status === 400);
});
test("application context uses introspected client_id without changing the existing identity contract", async () => {
  const issuer = "https://identity.example.invalid";
  const claims = { active: true, iss: issuer, aud: "rosetta-core", sub: "human", exp: Date.now()/1000+30, client_id: "management", tenant_id: "tenant-a", tenant_memberships: ["tenant-a"], realm_access: { roles: ["core-reader"] } };
  const authorize = createAuthorizer({ issuer }, async () => ({ ok: true, json: async () => claims }));
  const request = { headers: { authorization: "Bearer fixture" } };
  assert.deepEqual(Object.keys(await authorize(request)), ["subject", "tenantId", "roles"]);
  assert.equal((await authorize(request, true)).clientId, "management");
  delete claims.client_id; claims.azp = "untrusted-fallback";
  assert.equal((await authorize(request, true)).clientId, undefined);
});

test("application approval timestamps reject normalized invalid calendar dates", () => {
  const body = { resourceType: "application", resourceId: "11111111-1111-4111-8111-111111111111", requesterAppId: "11111111-1111-4111-8111-111111111111", requesterSubject: "human", resourceDigest: `sha256:${"0".repeat(64)}`, resourceRevision: 1, decision: "approve", expiresAt: "2026-02-31T12:00:00Z" };
  assert.throws(() => validateApplicationBody(body, "approval_create"));
  body.expiresAt = "2026-12-01T12:00:00Z";
  assert.deepEqual(validateApplicationBody(body, "approval_create"), body);
});
