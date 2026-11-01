// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("boundary checker rejects side-effect imports and re-exports across Foundation/runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "rosetta-boundaries-"));
  try {
    mkdirSync(join(dir, "modules/data"), { recursive: true });
    mkdirSync(join(dir, "modules/capability/execution"), { recursive: true });
    writeFileSync(join(dir, "modules/capability/execution/runtime.mjs"), "export const runtime = true;\n");
    for (const source of [
      'import "../capability/execution/runtime.mjs";',
      'export { runtime } from "../capability/execution/runtime.mjs";',
      'await import( "../capability/execution/runtime.mjs");',
    ]) {
      writeFileSync(join(dir, "modules/data/data.mjs"), source);
      const result = spawnSync(process.execPath, ["scripts/check-boundaries.mjs", dir], { encoding: "utf8" });
      assert.equal(result.status, 1);
      assert.match(result.stderr, /foundation modules must not depend on capability modules/);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
