// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { applicationToken } from "../src/applications.mjs";
import { requireLegacyClient, validateShare } from "../src/resources.mjs";

const id = "11111111-1111-4111-8111-111111111111";
const share = { resourceType: "record", resourceId: id, granteeAppId: id, action: "read", expiresAt: "2026-12-01T00:00:00Z" };
test("resource assertions carry verified binding context and a separate SQL role, never an asserted app owner", () => {
  const identity = { issuer: "https://issuer.example.invalid", subject: "backend-subject", tenantId: "tenant-a", clientId: "backend", roles: ["core-reader"], appId: id };
  const decode = token => JSON.parse(Buffer.from(token.split(".")[1], "base64url"));
  const claims = decode(applicationToken(identity, "synthetic-test-key", "rosetta_resource_api"));
  assert.equal(claims.role, "rosetta_resource_api");
  assert.equal(claims.sub, identity.subject); assert.equal(claims.client_id, identity.clientId);
  assert.equal(claims.tenant_id, identity.tenantId); assert.equal(claims.resource_writer, false);
  assert.equal(claims.app_id, undefined);
  identity.roles.push("core-writer");
  assert.equal(decode(applicationToken(identity, "synthetic-test-key", "rosetta_resource_api")).resource_writer, true);
  assert.equal(decode(applicationToken(identity, "synthetic-test-key")).role, "rosetta_app_api");
});

test("legacy resources require an explicit verified client allowlist, including for writer tokens", () => {
  assert.throws(() => requireLegacyClient({ clientId: "browser", roles: ["core-writer"] }, {}), error => error.status === 403);
  assert.throws(() => requireLegacyClient({}, { legacyResourceClients: ["backend"] }), error => error.status === 403);
  requireLegacyClient({ clientId: "backend" }, { legacyResourceClients: ["backend"] });
});

test("resource sharing rejects broader actions, authority overrides and malformed timestamps", () => {
  assert.deepEqual(validateShare(share), share);
  assert.deepEqual(validateShare({ ...share, expiresAt: "2026-12-01T00:00:00.123Z" }).action, "read");
  for (const patch of [{ action: "update" }, { action: ["read"] }, { resourceType: "collection" }, { resourceId: "*" },
    { tenant_id: "tenant-b" }, { owner_app_id: id }, { client_id: "owner" }, { expiresAt: "2026-02-31T00:00:00Z" },
    { expiresAt: "2026-12-01T00:00:00+00:00" }, { expiresAt: "tomorrow" }]) {
    assert.throws(() => validateShare({ ...share, ...patch }), error => error.status === 400);
  }
});
