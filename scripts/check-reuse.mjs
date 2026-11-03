// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";

assert.ok(existsSync("REUSE.toml"), "REUSE.toml missing");
assert.ok(existsSync("LICENSES/Apache-2.0.txt"), "LICENSES/Apache-2.0.txt missing");

const result = spawnSync("python", ["-m", "reuse", "lint"], {
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (result.error?.code === "ENOENT") {
  console.error("Python is required to run reuse lint");
  process.exitCode = 1;
} else if (result.status !== 0) {
  process.stdout.write(result.stdout ?? "");
  process.stderr.write(result.stderr ?? "");
  console.error("REUSE/SPDX validation failed (read-only; no files were modified)");
  process.exitCode = 1;
} else {
  process.stdout.write(result.stdout ?? "");
  console.log("REUSE/SPDX license metadata verified");
}
