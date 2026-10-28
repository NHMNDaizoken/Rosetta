// SPDX-FileCopyrightText: 2026 Rosetta Contributors
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
} from "../src/capability-manifest.mjs";

const fixture = JSON.parse(readFileSync(new URL("../docs/contracts/examples/capability-manifest.json", import.meta.url)));
const negatives = JSON.parse(readFileSync(new URL("../docs/contracts/examples/negative-cases.json", import.meta.url)));
const manifestNegatives = negatives.filter(item => item.schema === "manifest");

test("manifest fixture validates and matches its documented JCS digest", () => {
  assert.deepEqual(validateManifest(fixture), []);
  assert.equal(manifestDigest(fixture), "sha256:5d7446acb4c0ff8a329d1cd90f23d306065d0b5e2de5a2717a5a1d1ab1c826bd");
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
    capabilityId: "urn:rosetta:capability:11111111-1111-4111-8111-111111111111:other",
    providerAppId: "11111111-1111-4111-8111-111111111111",
  });
  assert.ok(issues.some(issue => issue.code === "path_mismatch"));
});
