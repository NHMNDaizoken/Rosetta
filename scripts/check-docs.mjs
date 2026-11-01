// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

function markdown(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? markdown(join(dir, entry.name)) : entry.name.endsWith(".md") ? [join(dir, entry.name)] : []);
}
const files = [...markdown("docs"), ...readdirSync(".").filter(name => name.endsWith(".md"))];
const problems = [];
for (const file of files) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(/\[[^\]\n]*\]\(([^)\s]+)\)/g)) {
    const target = match[1].replace(/^<|>$/g, "");
    if (/^(https?:|mailto:|#)/.test(target)) continue;
    const path = decodeURIComponent(target.split("#")[0]);
    if (!existsSync(resolve(dirname(file), path))) problems.push(`${file}: ${target}`);
  }
}
assert.deepEqual(problems, [], `Broken local documentation links:\n${problems.join("\n")}`);
console.log(`Public documentation inventory: ${files.length} Markdown files, local file links resolve. External URLs and heading anchors are not verified.`);
