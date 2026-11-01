// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { releaseFiles } from "../scripts/package-release.mjs";

test("source release allowlist excludes local/private roots and rejects secrets inside public roots", () => {
  assert.deepEqual(releaseFiles(["LICENSE", ".env", ".env.rc-test", ".codex/private.md", "local-data/data", "docs/GETTING_STARTED.md", ".env.example"]), [".env.example", "LICENSE", "docs/GETTING_STARTED.md"]);
  for (const path of ["console/.env.local", "infra/fixture.key", "console/node_modules/pkg/index.js", "console/dist/app.js", "docs/../private", "docs/private.dump", "integration/server.pem"]) assert.throws(() => releaseFiles([path]));
});
