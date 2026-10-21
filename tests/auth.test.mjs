// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { createAuthorizer, validateIdentity } from "../src/auth.mjs";

const issuer = "http://identity.test/realms/rosetta";
const claims = { active: true, iss: issuer, aud: "rosetta-core", exp: 2000, sub: "subject", tenant_id: "tenant-a", tenant_memberships: ["tenant-a"], realm_access: { roles: ["core-reader", "core-writer"] } };
test("verified identity uses tenant and roles from issuer claims", () => {
  assert.deepEqual(validateIdentity(claims, issuer, 1000), { subject: "subject", tenantId: "tenant-a", roles: ["core-reader", "core-writer"] });
});
test("inactive, expired, wrong issuer/audience and missing subject tokens fail closed", () => {
  for (const patch of [{ active: false }, { exp: 999 }, { exp: "2000" }, { iss: "wrong" }, { aud: "wrong" }, { sub: null }]) {
    assert.throws(() => validateIdentity({ ...claims, ...patch }, issuer, 1000), (error) => error.status === 401);
  }
});
test("tenant and read-role claims are mandatory", () => {
  for (const patch of [{ tenant_id: "../tenant-b" }, { tenant_id: "tenant-b" }, { tenant_memberships: [] }, { tenant_id: null }, { realm_access: { roles: [] } }]) {
    assert.throws(() => validateIdentity({ ...claims, ...patch }, issuer, 1000), (error) => error.status === 403);
  }
});
test("missing bearer credentials never reach the identity provider", async () => {
  const authorize = createAuthorizer({ issuer }, () => { throw new Error("Should not be called"); });
  await assert.rejects(authorize({ headers: {} }), (error) => error.status === 401);
});
test("identity outages fail closed, without trusting caller tenant headers", async () => {
  const authorize = createAuthorizer({ issuer }, async () => { throw new Error("offline"); });
  await assert.rejects(authorize({ headers: { authorization: "Bearer token", "x-tenant-id": "tenant-a" } }), (error) => error.status === 503);
});
