// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function check(path) {
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const file = join(path, entry.name);
    if (entry.isDirectory()) check(file);
    else if (/\.(mjs|sql|sh|ps1|ya?ml|conf|toml)$/.test(file)) checkFile(file);
  }
}

function checkFile(file) {
  const source = readFileSync(file, "utf8");
  assert.ok(source.slice(0, 200).includes("SPDX-License-Identifier: Apache-2.0"), `${file}: license header`);
  assert.ok(source.slice(0, 200).includes("SPDX-FileCopyrightText: 2026 Rosetta Contributors"), `${file}: attribution`);
  if (file.endsWith(".mjs")) {
    const result = spawnSync(process.execPath, ["--check", file], { stdio: "inherit" });
    assert.equal(result.status, 0, `${file}: syntax`);
  }
}

for (const root of ["src", "scripts", "tests", "integration", "infra", ".github"]) {
  if (existsSync(root)) check(root);
}
checkFile("Dockerfile");
checkFile("compose.yaml");
assert.equal(JSON.parse(readFileSync("package.json", "utf8")).license, "Apache-2.0");
const license = readFileSync("LICENSE", "utf8");
assert.ok(license.includes("Version 2.0, January 2004") && license.includes("APPENDIX"));
assert.ok(readFileSync("NOTICE", "utf8").includes("Copyright 2026 Rosetta Contributors"));
assert.ok(existsSync("THIRD-PARTY.md"));
console.log("Source syntax, SPDX headers and project license files verified");
