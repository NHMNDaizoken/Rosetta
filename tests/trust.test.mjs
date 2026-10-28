// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { grantDigest, validateGrant } from "../src/trust.mjs";

const providerAppId = "11111111-1111-4111-8111-111111111111";
const consumerAppId = "22222222-2222-4222-8222-222222222222";
const fixture = { providerAppId, consumerAppId, capabilities: [{ capabilityId: `urn:rosetta:capability:${providerAppId}:echo`, version: "1.0.0", manifestDigest: `sha256:${"0".repeat(64)}` }],
  operations: ["discover"], permissions: [`urn:rosetta:permission:${providerAppId}:invoke`], subjectIds: ["verified-fixture-subject"],
  expiresAt: "2026-12-01T12:00:00Z", delegationAllowed: false, acceptDelegation: false };

test("direct grant validation rejects authority overrides, ranges, wildcards and delegation", () => {
  assert.deepEqual(validateGrant(fixture), fixture);
  for (const patch of [{ tenantId: "tenant-b" }, { createdBy: "attacker" }, { delegationAllowed: true }, { acceptDelegation: true },
    { consumerAppId: "*" }, { consumerAppId: [consumerAppId] }, { consumerAppId: providerAppId }, { subjectIds: [] }, { subjectIds: ["*"] },
    { subjectIds: ["a", "a"] }, { subjectIds: ["\ud800"] }, { operations: ["admin"] }, { operations: ["discover", "discover"] },
    { permissions: [`urn:rosetta:permission:${consumerAppId}:invoke`] }, { expiresAt: "2026-02-31T00:00:00Z" },
    { capabilities: [{ ...fixture.capabilities[0], version: "^1.0.0" }] }, { capabilities: [fixture.capabilities[0], fixture.capabilities[0]] },
    { capabilities: [{ ...fixture.capabilities[0], manifestDigest: "sha256:*" }] }]) {
    assert.throws(() => validateGrant({ ...fixture, ...patch }), error => error.status === 400, JSON.stringify(patch));
  }
});

test("grant digest binds tenant, issuer, creator, grant ID and complete proposal", () => {
  const identity = { tenantId: "tenant-a", issuer: "https://identity.example.invalid", subject: "owner" };
  const value = grantDigest(consumerAppId, identity, fixture);
  assert.equal(value, grantDigest(consumerAppId, identity, Object.fromEntries(Object.entries(fixture).reverse())));
  for (const patch of [{ tenantId: "tenant-b" }, { issuer: "https://other.example.invalid" }, { subject: "someone-else" }]) assert.notEqual(value, grantDigest(consumerAppId, { ...identity, ...patch }, fixture));
  assert.notEqual(value, grantDigest(providerAppId, identity, fixture));
  assert.notEqual(value, grantDigest(consumerAppId, identity, { ...fixture, operations: ["invoke"] }));
});
