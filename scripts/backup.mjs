// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local operator backup and restore for the Docker Compose stack.
//   npm run backup                          -> backups/<timestamp>/
//   npm run restore -- backups/<timestamp> --yes
// A backup holds the three PostgreSQL databases (identity, data, workflow) as
// pg_dump custom archives and the SeaweedFS object volume as a tar.gz, plus a
// manifest with SHA-256 checksums. Backups contain private data: they are
// Git-ignored and must be stored like credentials.
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

export const DATABASES = ["rosetta_identity", "rosetta_data", "rosetta_workflow"];
export const OBJECTS_ARCHIVE = "objects.tar.gz";
const APP_SERVICES = ["console", "gateway", "core", "data", "workflow", "identity", "objects"];

export function backupName(date = new Date()) {
  const pad = value => String(value).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!["backup", "restore"].includes(command)) throw new Error("Usage: backup.mjs backup [--out dir] | restore <dir> --yes [--no-safety-backup]");
  const options = { command, out: undefined, source: undefined, yes: false, safetyBackup: true };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--out" && command === "backup") options.out = rest[++i];
    else if (arg === "--yes" && command === "restore") options.yes = true;
    else if (arg === "--no-safety-backup" && command === "restore") options.safetyBackup = false;
    else if (!arg.startsWith("--") && command === "restore" && options.source === undefined) options.source = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (command === "restore" && !options.source) throw new Error("Restore needs a backup directory, e.g. npm run restore -- backups/20261103-220000 --yes");
  return options;
}

export function verifyManifest(manifest, actual) {
  if (manifest?.format !== "junctura-backup/1") throw new Error("Not a Junctura backup manifest");
  const expected = [...DATABASES.map(db => `${db}.dump`), OBJECTS_ARCHIVE];
  const names = manifest.files.map(file => file.name).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expected].sort())) throw new Error("Backup manifest lists unexpected files");
  for (const file of manifest.files) {
    if (actual[file.name] !== file.sha256) throw new Error(`Checksum mismatch for ${file.name}; the backup is incomplete or modified`);
  }
  return true;
}

const sha256 = path => new Promise((done, fail) => {
  const hash = createHash("sha256");
  createReadStream(path).on("data", chunk => hash.update(chunk)).on("error", fail).on("end", () => done(hash.digest("hex")));
});

function compose(args, { input, output } = {}) {
  return new Promise((done, fail) => {
    const child = spawn("docker", ["compose", ...args], { stdio: [input ? "pipe" : "ignore", output ? "pipe" : "inherit", "pipe"] });
    let stderr = "";
    child.stderr.on("data", chunk => { stderr += chunk; });
    const transfers = [];
    if (output) transfers.push(pipeline(child.stdout, createWriteStream(output)));
    if (input) transfers.push(pipeline(createReadStream(input), child.stdin));
    child.once("error", () => fail(new Error("Docker is not available; start Docker Desktop first")));
    child.once("close", async code => {
      try { await Promise.all(transfers); } catch (error) { return fail(error); }
      if (code === 0) done(); else fail(new Error(`docker compose ${args.slice(0, 3).join(" ")} failed: ${stderr.trim().split("\n").slice(-3).join(" ")}`));
    });
  });
}

const psql = sql => compose(["exec", "-T", "database", "psql", "-U", "rosetta_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-Atc", sql]);
const step = message => console.log(`• ${message}`);

export async function backup(out) {
  const directory = resolve(out ?? join("backups", backupName()));
  if (existsSync(directory)) throw new Error(`${directory} already exists`);
  await compose(["exec", "-T", "database", "pg_isready", "-U", "rosetta_admin"]);
  mkdirSync(directory, { recursive: true });
  for (const db of DATABASES) {
    step(`Dumping ${db}`);
    await compose(["exec", "-T", "database", "pg_dump", "-U", "rosetta_admin", "--format=custom", db], { output: join(directory, `${db}.dump`) });
  }
  step("Archiving object storage (object service paused briefly for a consistent copy)");
  await compose(["stop", "objects"]);
  try {
    await compose(["run", "--rm", "--no-deps", "-T", "--entrypoint", "tar", "objects", "-czf", "-", "-C", "/data", "."], { output: join(directory, OBJECTS_ARCHIVE) });
  } finally {
    await compose(["start", "objects"]);
  }
  const files = [];
  for (const name of [...DATABASES.map(db => `${db}.dump`), OBJECTS_ARCHIVE]) {
    files.push({ name, bytes: statSync(join(directory, name)).size, sha256: await sha256(join(directory, name)) });
  }
  let commit = null;
  try { commit = (await promisify(execFile)("git", ["rev-parse", "HEAD"])).stdout.trim(); } catch { /* not a Git checkout */ }
  writeFileSync(join(directory, "manifest.json"), JSON.stringify({ format: "junctura-backup/1", createdAt: new Date().toISOString(), sourceCommit: commit, files }, null, 2) + "\n");
  console.log(`\n✔ Backup written to ${directory}`);
  console.log("  It contains private data and identities: keep it outside Git and as safe as your .env.");
  return directory;
}

export async function restore({ source, yes, safetyBackup }) {
  const directory = resolve(source);
  const manifest = JSON.parse(readFileSync(join(directory, "manifest.json"), "utf8"));
  const actual = {};
  for (const file of manifest.files) actual[file.name] = existsSync(join(directory, file.name)) ? await sha256(join(directory, file.name)) : null;
  verifyManifest(manifest, actual);
  step(`Backup ${basename(directory)} verified (${manifest.files.length} files, created ${manifest.createdAt})`);
  if (!yes) throw new Error("Restore replaces ALL current identities, data, workflows and objects. Re-run with --yes to confirm.");
  if (safetyBackup) {
    step("Taking a safety backup of the current state first");
    await backup(join("backups", `pre-restore-${backupName()}`));
  }
  step("Stopping application services (database stays up)");
  await compose(["--profile", "console", "stop", ...APP_SERVICES]);
  for (const db of DATABASES) {
    step(`Restoring ${db}`);
    await psql(`DROP DATABASE IF EXISTS ${db} WITH (FORCE);`);
    // --create recreates the database with its original owner, ACLs and settings.
    await compose(["exec", "-T", "database", "pg_restore", "-U", "rosetta_admin", "--create", "--exit-on-error", "-d", "postgres"], { input: join(directory, `${db}.dump`) });
  }
  step("Restoring object storage");
  await compose(["run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "objects", "-c",
    "find /data -mindepth 1 -maxdepth 1 -exec rm -rf {} + && tar -xzf - -C /data"], { input: join(directory, OBJECTS_ARCHIVE) });
  step("Starting the platform");
  await compose(["--profile", "console", "up", "--detach", "--wait", "--wait-timeout", "900"]);
  console.log(`\n✔ Restored from ${directory}. Run npm run healthcheck to confirm readiness.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    await (options.command === "backup" ? backup(options.out) : restore(options));
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
