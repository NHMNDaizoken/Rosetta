// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { describe, parseArgs } from "../scripts/audit-demo.mjs";

test("audit demo accepts only its four commands and safe options", () => {
  assert.deepEqual(parseArgs([]), { command: "verify", tenant: "tenant-a", seq: 2 });
  assert.deepEqual(parseArgs(["tamper", "--seq", "3", "--tenant", "tenant-b"]), { command: "tamper", tenant: "tenant-b", seq: 3 });
  for (const argv of [["drop"], ["--seq", "0"], ["--seq", "x"], ["--tenant", "Bad;Tenant"], ["--tenant", "a'b"]]) assert.throws(() => parseArgs(argv));
});

test("audit demo output names the broken event", () => {
  assert.match(describe({ verified: true, entries: 4, newlySealed: 1, headHash: "sha256:ab" }), /TOÀN VẸN — 4 sự kiện/);
  assert.match(describe({ verified: false, entries: 1, firstBreak: { chainSeq: 2, eventId: "e", reason: "content_modified" } }), /#2: content_modified/);
});
