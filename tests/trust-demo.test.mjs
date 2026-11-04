// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEMO_APPS, DEMO_CAPABILITIES, DEMO_GRANTS, existingGrant, manifestFor, parseArgs } from "../scripts/trust-demo.mjs";
import { validateManifest } from "../src/modules/capability/registry/manifest.mjs";

const template = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url), "utf8"));
const appId = "22222222-2222-4222-8222-222222222222";

test("trust:demo parses only seed, token and a valid tenant", () => {
  assert.deepEqual(parseArgs([]), { command: "seed", tenant: "tenant-a" });
  assert.deepEqual(parseArgs(["token", "--tenant", "tenant-b"]), { command: "token", tenant: "tenant-b" });
  for (const argv of [["bogus"], ["--tenant", "Bad_Tenant"], ["--tenant"]]) assert.throws(() => parseArgs(argv), undefined, JSON.stringify(argv));
});

test("every demo manifest passes the real registry validator", () => {
  for (const capability of DEMO_CAPABILITIES) {
    const manifest = manifestFor(template, appId, capability);
    assert.equal(manifest.capabilityId, `urn:junctura:capability:${appId}:${capability.name}`);
    assert.deepEqual(manifest.requiredPermissions, [`urn:junctura:permission:${appId}:invoke`]);
    assert.deepEqual(validateManifest(manifest, { capabilityId: manifest.capabilityId, version: "1.0.0" }), [], capability.name);
  }
  assert.equal(template.title, "Technical echo", "the shared template is not mutated");
});

test("demo grants reference demo apps and capabilities and cover every graph state", () => {
  const apps = new Set(DEMO_APPS.map(app => app.name));
  const capabilities = new Set(DEMO_CAPABILITIES.map(c => `${c.provider}/${c.name}`));
  for (const grant of DEMO_GRANTS) {
    assert.ok(apps.has(grant.provider) && apps.has(grant.consumer) && grant.provider !== grant.consumer);
    assert.ok(capabilities.has(`${grant.provider}/${grant.capability}`));
    assert.ok(grant.days > 0 && grant.operations.length > 0);
  }
  assert.deepEqual([...new Set(DEMO_GRANTS.map(g => g.target))].sort(), ["active", "pending", "revoked"]);
  assert.ok(DEMO_GRANTS.some(g => g.target === "active" && g.days < 7), "one grant shows as expiring soon");
});

test("re-running reuses live grants but recreates expired or revoked ones", () => {
  const ids = { daotao: "a", thuvien: "b" };
  const grant = { provider: "daotao", consumer: "thuvien", target: "active" };
  const edge = state => ({ providerAppId: "a", consumerAppId: "b", capabilityId: "cap", version: "1.0.0", state });
  assert.ok(existingGrant([edge("active")], grant, ids, "cap"));
  assert.ok(existingGrant([edge("pending")], grant, ids, "cap"));
  assert.equal(existingGrant([edge("expired"), edge("revoked")], grant, ids, "cap"), undefined);
  assert.equal(existingGrant([edge("active")], grant, ids, "other"), undefined);
  assert.ok(existingGrant([edge("revoked")], { ...grant, target: "revoked" }, ids, "cap"));
});
