// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { releaseFiles } from "../scripts/package-release.mjs";

test("source release allowlist excludes local/private roots and rejects secrets inside public roots", () => {
  assert.deepEqual(releaseFiles(["LICENSE", ".env", ".env.rc-test", ".codex/private.md", "local-data/data", "docs/GETTING_STARTED.md", ".env.example"]), [".env.example", "LICENSE", "docs/GETTING_STARTED.md"]);
  for (const path of ["console/.env.local", "infra/fixture.key", "console/node_modules/pkg/index.js", "console/dist/app.js", "docs/../private", "docs/private.dump", "integration/server.pem"]) assert.throws(() => releaseFiles([path]));
});

// The Core image runs unit tests without the Console and SDK sources; the version
// check runs wherever the whole repository is present (host checks and CI).
const versioned = ["package.json", "console/package.json", "console/package-lock.json", "sdk/node/package.json", "console/src/constants/brand.ts"];
const wholeRepository = versioned.every(path => existsSync(new URL(`../${path}`, import.meta.url)));

test("Console, SDK and Console lockfile carry the platform version", { skip: !wholeRepository && "repository sources not present" }, () => {
  const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
  const version = JSON.parse(read("package.json")).version;
  assert.equal(JSON.parse(read("console/package.json")).version, version);
  assert.equal(JSON.parse(read("sdk/node/package.json")).version, version);
  const lock = JSON.parse(read("console/package-lock.json"));
  assert.deepEqual([lock.version, lock.packages[""].version], [version, version]);
  assert.match(read("console/src/constants/brand.ts"), new RegExp(`version: "${version.replaceAll(".", "\\.")}"`));
});
