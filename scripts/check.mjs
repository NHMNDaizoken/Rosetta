// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function check(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(mjs|py|sql|sh|ps1|ya?ml|conf|toml|xml)$/.test(file)) checkFile(file);
  }
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  // REUSE-IgnoreStart
  assert.ok(source.slice(0, 200).includes("SPDX-License-Identifier: Apache-2.0"), `${file}: license header`);
  assert.ok(source.slice(0, 200).includes("SPDX-FileCopyrightText: 2026 Junctura Contributors"), `${file}: attribution`);
  // REUSE-IgnoreEnd
  if (file.endsWith(".mjs")) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    assert.equal(result.status, 0, `${file}: syntax`);
  }
}

for (const root of ["src", "scripts", "tests", "integration", "examples", "sdk", "infra", ".github", "console/scripts", "console/nginx"]) {
  if (existsSync(root)) check(root);
}
// Every tracked file that can hold a comment carries its own notice (contest rule:
// the license is stated in each source file). Comment-hostile files are in REUSE.toml.
const tracked = spawnSync("git", ["ls-files", "-z"], { encoding: "utf8" });
if (tracked.status === 0) {
  for (const file of tracked.stdout.split("\0").filter(Boolean)) {
    if (/\.(ts|tsx|css|js|md|html|svg)$/.test(file) || ["console/tsconfig.json", "console/tsconfig.node.json", ".gitignore", ".gitattributes", ".dockerignore"].includes(file)) checkFile(file);
  }
}
checkFile("Dockerfile");
checkFile("console/Dockerfile");
checkFile("compose.yaml");
checkFile("compose.providers.yaml");
assert.equal(JSON.parse(readFileSync("package.json", "utf8")).license, "Apache-2.0");
assert.equal(JSON.parse(readFileSync("console/package.json", "utf8")).license, "Apache-2.0");
assert.equal(JSON.parse(readFileSync("sdk/node/package.json", "utf8")).license, "Apache-2.0");
const license = readFileSync("LICENSE", "utf8");
assert.ok(license.includes("Version 2.0, January 2004") && license.includes("APPENDIX"));
assert.ok(readFileSync("NOTICE", "utf8").includes("Copyright 2026 Junctura Contributors"));
assert.ok(existsSync("THIRD-PARTY.md"));
assert.ok(existsSync("REUSE.toml"), "REUSE.toml annotations required for comment-hostile files");
assert.ok(existsSync("LICENSES/Apache-2.0.txt"), "REUSE license text required");
await import("./check-boundaries.mjs");
console.log("Source syntax, SPDX headers and project license files verified");
