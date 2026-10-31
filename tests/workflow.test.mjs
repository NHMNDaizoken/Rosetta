// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { canonicalInput } from "../src/modules/workflow/workflow.mjs";

test("workflow retries compare JSON input independently of object-key order", () => {
  assert.equal(JSON.stringify(canonicalInput({ b: [1, { z: 2, a: null }], a: true })),
    JSON.stringify(canonicalInput({ a: true, b: [1, { a: null, z: 2 }] })));
  assert.notEqual(JSON.stringify(canonicalInput({ a: [1, 2] })), JSON.stringify(canonicalInput({ a: [2, 1] })));
});
test("workflow inputs reject excessive nesting before reservation or engine side effects", () => {
  let input = {};
  for (let index = 0; index < 40; index++) input = { child: input };
  assert.throws(() => canonicalInput(input), (error) => error.status === 400);
});
