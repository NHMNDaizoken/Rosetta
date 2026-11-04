// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const roots = new Set(["src", "console", "sdk", "infra", "scripts", "docs", "examples", "tests", "integration", ".github", "LICENSES"]);
const rootFiles = new Set([".env.example", ".node-version", ".dockerignore", ".gitattributes", ".gitignore",
  "README.md", "LICENSE", "NOTICE", "THIRD-PARTY.md", "CHANGELOG.md", "REUSE.toml", "compose.yaml", "Dockerfile", "package.json", "requirements-contracts.txt", "requirements-reuse.txt"]);

export function releaseFiles(paths) {
  return paths.filter(path => {
    const parts = path.split("/");
    assert.ok(!parts.includes("..") && !path.startsWith("/") && !path.includes("\\"), "Unsafe archive path");
    if (!roots.has(parts[0]) && !rootFiles.has(path)) return false;
    assert.ok(!parts.some(p => ["node_modules", "dist", "build", ".cache", ".git", ".codex", ".agents"].includes(p)), `Generated/private path: ${path}`);
    assert.ok(path === ".env.example" || !parts.some(p => p === ".env" || p.startsWith(".env.")), `Secret configuration: ${path}`);
    assert.ok(!/\.(pem|key|p12|pfx|jks|dump|sql\.gz|log|db|sqlite3?)$/i.test(path), `Sensitive artifact: ${path}`);
    return true;
  }).sort();
}

export function packageRelease(directory = "dist/releases") {
  execFileSync("git", ["diff", "--quiet", "HEAD", "--"], { stdio: "pipe" });
  const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const version = JSON.parse(execFileSync("git", ["show", "HEAD:package.json"], { encoding: "utf8" })).version;
  assert.match(version, /^\d+\.\d+\.\d+(-rc\.\d+)?$/, "Set an explicit MAJOR.MINOR.PATCH or release-candidate version before packaging");
  const tree = execFileSync("git", ["ls-tree", "-rz", "HEAD"], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }).split("\0").filter(Boolean);
  assert.ok(tree.every(entry => !entry.startsWith("120000 ") && !entry.startsWith("160000 ")), "Review symlinks/submodules before release");
  const files = releaseFiles(tree.map(entry => entry.slice(entry.indexOf("\t") + 1)));
  for (const required of ["LICENSE", "NOTICE", "THIRD-PARTY.md", "CHANGELOG.md", "REUSE.toml", "LICENSES/Apache-2.0.txt", "compose.yaml", ".env.example", "docs/GETTING_STARTED.md", "docs/RELEASE.md", "docs/DEVELOPING.md", "infra/postgres/017-composition-exact-grants.sql", "infra/postgres/018-audit-chain.sql"]) assert.ok(files.includes(required), `Missing release file ${required}`);
  const name = `junctura-${version}`;
  const archive = execFileSync("git", ["archive", "--format=tar", `--prefix=${name}/`, sha, "--", ...files], { maxBuffer: 64 * 1024 * 1024 });
  const hash = createHash("sha256").update(archive).digest("hex");
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, `${name}.tar`), archive);
  writeFileSync(resolve(directory, `${name}.tar.sha256`), `${hash}  ${name}.tar\n`);
  writeFileSync(resolve(directory, `${name}.manifest.json`), JSON.stringify({ version, sourceCommit: sha, sha256: hash, files }, null, 2) + "\n");
  console.log(`Prepared ${name}.tar from ${sha}; SHA-256 ${hash}. Source only; no release published.`);
  return { name, sha, hash, files };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { packageRelease(); }
  catch { console.error("Packaging refused. Commit reviewed changes, use a semantic version, and exclude generated/private files. See docs/RELEASE.md."); process.exitCode = 1; }
}
