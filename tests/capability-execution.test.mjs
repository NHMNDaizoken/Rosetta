// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createAuthenticationLeases, jsonDigest, leaseProof, reserveExecution, ticketDigest, validateExecutionCreate } from "../src/modules/capability/execution/execution.mjs";

const identity = { tenantId: "tenant-a", issuer: "https://issuer.example", subject: "consumer-service", clientId: "consumer", roles: ["core-reader", "core-writer"], credentialExpiresAt: 2000 };
const execution = { executionId: randomUUID(), deadlineAt: new Date(1500).toISOString() };

test("authentication leases are memory-only, identity-bound, capacity-bounded and deadline-limited", async () => {
  let now = 1000;
  const leases = createAuthenticationLeases({ capacity: 1, now: () => now });
  leases.put(execution, identity, "Bearer synthetic-original");
  assert.equal(JSON.stringify(leases), "{}");
  await leases.use(execution.executionId, identity, (bound, authorization, expiry) => {
    assert.equal(authorization, "Bearer synthetic-original");
    assert.equal(expiry, 1500);
    assert.equal(bound.subject, identity.subject);
    assert.equal(bound.authorization, undefined);
  });
  await assert.rejects(leases.use(execution.executionId, { ...identity, clientId: "different" }, () => {}), /initiator_mismatch/);
  assert.throws(() => leases.put({ ...execution, executionId: randomUUID() }, identity, "Bearer synthetic-other"), /execution_capacity_exceeded/);
  now = 1500;
  await assert.rejects(leases.use(execution.executionId, identity, () => assert.fail("expired lease used")), /auth_required/);
  assert.equal(leases.has(execution.executionId), false);
});

test("restart and original credential expiry cannot be replaced by executor credentials", async () => {
  let now = 1000;
  const leases = createAuthenticationLeases({ now: () => now });
  leases.put(execution, { ...identity, credentialExpiresAt: 1100 }, "Bearer synthetic-original");
  now = 1101;
  await assert.rejects(leases.use(execution.executionId, null, () => {}), /auth_required/);
  leases.put(execution, identity, "Bearer fresh-original");
  await leases.use(execution.executionId, identity, (_bound, authorization, expiry) => {
    assert.equal(authorization, "Bearer fresh-original");
    assert.equal(expiry, 1500, "fresh authentication cannot extend the immutable deadline");
  });
  now = 1000;
  leases.put(execution, identity, "Bearer synthetic-original");
  leases.clear();
  await assert.rejects(leases.use(execution.executionId, { ...identity, subject: "engine-admin" }, () => {}), /auth_required/);
  await assert.rejects(createAuthenticationLeases({ now: () => now }).use(execution.executionId, identity, () => {}), /auth_required/);
});

test("execution bodies accept only one exact capability and canonical digests bind values", () => {
  const reference = { capabilityId: "urn:rosetta:capability:11111111-1111-4111-8111-111111111111:echo", version: "1.0.0", manifestDigest: `sha256:${"a".repeat(64)}` };
  const body = { target: { kind: "capability", capability: reference }, input: { a: 1, b: "🙂" } };
  assert.equal(validateExecutionCreate(body), body);
  for (const invalid of [{ ...body, tenantId: "tenant-b" }, { ...body, delegationId: randomUUID() }, { ...body, approvalId: randomUUID() },
    { ...body, target: { kind: "composition" } }, { ...body, target: { ...body.target, url: "https://evil.example" } },
    { ...body, target: { kind: "capability", capability: { ...reference, version: "latest" } } }]) assert.throws(() => validateExecutionCreate(invalid));
  assert.equal(jsonDigest(body.input), jsonDigest({ b: "🙂", a: 1 }));
  assert.notEqual(jsonDigest(body.input), jsonDigest({ b: "🙂", a: 2 }));
  assert.match(ticketDigest("opaque-synthetic-ticket"), /^sha256:[0-9a-f]{64}$/);
  const proof = leaseProof(execution.executionId, identity, 1500);
  assert.equal(proof.subject, identity.subject);
  assert.equal(proof.writer, true);
  assert.equal(JSON.stringify(proof).includes("Bearer"), false);
});

test("idempotent replays preserve a live initiating credential and cannot recreate a prepared lease", async t => {
  const now = Date.now(), id = randomUUID();
  const current = { ...identity, credentialExpiresAt: now + 8000 };
  const e = { executionId: id, state: "accepted", deadlineAt: new Date(now + 9000).toISOString() };
  const body = { target: { kind: "capability", capability: { capabilityId: "urn:rosetta:capability:11111111-1111-4111-8111-111111111111:echo",
    version: "1.0.0", manifestDigest: `sha256:${"a".repeat(64)}` } }, input: {} };
  const config = { dataUrl: "https://data.example.invalid", dataSecret: "synthetic-test-signing-secret-with-no-authority" };
  const request = { headers: { "idempotency-key": randomUUID(), authorization: "Bearer synthetic-fresh" } };
  const resolved = { manifest: { timeoutMs: 10000 }, authorityExpiresAt: new Date(now + 9000).toISOString() };
  let attempt = 1;
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    const { operation } = JSON.parse(options.body);
    return Response.json({ status: 200, value: operation === "reserve" ? e : { attempt, dispatch_phase: attempt ? "prepared" : "reserved" } });
  });
  const live = createAuthenticationLeases();
  live.put(e, { ...current, credentialExpiresAt: now + 2000 }, "Bearer synthetic-original");
  await reserveExecution(config, current, request, body, live, resolved);
  await live.use(id, current, (_bound, authorization, expiry) => {
    assert.equal(authorization, "Bearer synthetic-original");
    assert.equal(expiry, now + 2000, "a replay cannot extend the original credential lifetime");
  });
  const lost = createAuthenticationLeases();
  await assert.rejects(reserveExecution(config, current, request, body, lost, resolved), /dispatch_not_available/);
  assert.equal(lost.has(id), false, "prepared work cannot receive a replacement lease");
  attempt = 0;
  await reserveExecution(config, current, request, body, lost, resolved);
  assert.equal(lost.has(id), true, "untouched work can be reauthenticated within its original deadline");
});
