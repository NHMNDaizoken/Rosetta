// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { backupName, DATABASES, OBJECTS_ARCHIVE, parseArgs, verifyManifest } from "../scripts/backup.mjs";

test("backup names are sortable local timestamps", () => {
  assert.equal(backupName(new Date(2026, 10, 3, 9, 5, 7)), "20261103-090507");
});

test("restore requires a source and only accepts known flags", () => {
  assert.deepEqual(parseArgs(["backup"]), { command: "backup", out: undefined, source: undefined, yes: false, safetyBackup: true });
  const restore = parseArgs(["restore", "backups/x", "--yes", "--no-safety-backup"]);
  assert.equal(restore.source, "backups/x"); assert.equal(restore.yes, true); assert.equal(restore.safetyBackup, false);
  for (const argv of [[], ["drop"], ["restore"], ["restore", "a", "b"], ["backup", "--yes"], ["restore", "a", "--out", "x"]]) assert.throws(() => parseArgs(argv));
});

test("manifest verification rejects foreign, incomplete or modified backups", () => {
  const files = [...DATABASES.map(db => `${db}.dump`), OBJECTS_ARCHIVE].map((name, i) => ({ name, sha256: String(i).repeat(64) }));
  const actual = Object.fromEntries(files.map(file => [file.name, file.sha256]));
  assert.equal(verifyManifest({ format: "junctura-backup/1", files }, actual), true);
  assert.throws(() => verifyManifest({ format: "other", files }, actual), /Not a Junctura/);
  assert.throws(() => verifyManifest({ format: "junctura-backup/1", files: files.slice(1) }, actual), /unexpected files/);
  assert.throws(() => verifyManifest({ format: "junctura-backup/1", files }, { ...actual, [OBJECTS_ARCHIVE]: null }), /Checksum mismatch/);
});
