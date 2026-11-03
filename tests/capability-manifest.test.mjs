// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  ManifestValidationError,
  canonicalize,
  manifestDigest,
  parseManifestText,
  validateManifest,
} from "../src/modules/capability/registry/manifest.mjs";

const fixture = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url)));
const negatives = JSON.parse(readFileSync(new URL("../docs/contracts/examples/negative-cases.json", import.meta.url)));
const manifestNegatives = negatives.filter(item => item.schema === "manifest");

test("manifest fixture validates and matches its documented JCS digest", () => {
  assert.deepEqual(validateManifest(fixture), []);
  assert.equal(manifestDigest(fixture), "sha256:fd2b4612971c8d4c2e4ab4eb2c49dcd3017260f16f0bd9e2a74b5746ba983bc3");
});

test("every manifest negative fixture is rejected", () => {
  assert.equal(manifestNegatives.length, 9);
  for (const item of manifestNegatives) {
    assert.ok(validateManifest(item.value).length > 0, item.id);
  }
});

test("key order does not change the digest", () => {
  const reordered = Object.fromEntries(Object.entries(fixture).reverse());
  assert.equal(canonicalize(reordered), canonicalize(fixture));
  assert.equal(manifestDigest(reordered), manifestDigest(fixture));
});

test("strict parsing rejects duplicate keys and invalid Unicode", () => {
  assert.throws(() => parseManifestText('{"manifestVersion":"1.0","manifestVersion":"1.0"}'), ManifestValidationError);
  assert.throws(() => parseManifestText('{"title":"\\ud800"}'), ManifestValidationError);
});

test("path expectations bind the manifest to its route", () => {
  const issues = validateManifest(fixture, {
    capabilityId: "urn:junctura:capability:11111111-1111-4111-8111-111111111111:other",
    providerAppId: "11111111-1111-4111-8111-111111111111",
  });
  assert.ok(issues.some(issue => issue.code === "path_mismatch"));
});
