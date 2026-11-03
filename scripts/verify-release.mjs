// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { releaseFiles } from "./package-release.mjs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const name = `rosetta-${version}`;
const directory = resolve(process.argv[2] ?? "dist/releases");
const bytes = readFileSync(resolve(directory, `${name}.tar`));
const manifest = JSON.parse(readFileSync(resolve(directory, `${name}.manifest.json`), "utf8"));
const hash = createHash("sha256").update(bytes).digest("hex");
assert.equal(manifest.sha256, hash);
assert.equal(readFileSync(resolve(directory, `${name}.tar.sha256`), "utf8"), `${hash}  ${name}.tar\n`);
const archive = execFileSync("tar", ["-tf", resolve(directory, `${name}.tar`)], { encoding: "utf8" }).split(/\r?\n/).filter(Boolean);
assert.ok(archive.every(path => path.startsWith(`${name}/`)));
const files = archive.filter(path => !path.endsWith("/")).map(path => path.slice(name.length + 1)).sort();
assert.deepEqual(files, manifest.files);
assert.deepEqual(releaseFiles(files), files);
console.log(`Verified archive checksum and ${files.length} allowlisted source files; no local credentials, volumes or generated outputs.`);
