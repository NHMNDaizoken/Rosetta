// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("doctor fails actionably on missing configuration without printing subprocess output or credentials", () => {
  const secret = "synthetic-do-not-print-this-secret";
  const result = spawnSync(process.execPath, ["scripts/doctor.mjs", "--config", "/missing-junctura-config/.env"], {
    encoding: "utf8", timeout: 55000, env: { ...process.env, CORE_CLIENT_SECRET: secret },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /FAIL Local configuration.*npm run setup/);
  assert.ok(!(result.stdout + result.stderr).includes(secret));
});
