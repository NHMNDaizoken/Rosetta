// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { compositionBpmn, COMPOSITION_PROCESS_KEY, COMPOSITION_TOPIC } from "../src/modules/capability/composition/bpmn.mjs";
import { validateComposition } from "../src/modules/capability/composition/plan.mjs";

const echo = (suffix) => ({
  capabilityId: `urn:rosetta:capability:11111111-1111-4111-8111-11111111111${suffix}:echo`,
  version: "1.0.0", manifestDigest: `sha256:${"a".repeat(64)}`,
});
const schema = { type: "object", properties: { value: { type: "string", maxLength: 512 } }, required: ["value"], additionalProperties: false };
const valid = () => ({
  compositionFormat: "1.0", name: "two steps", version: "1.0.0", inputSchema: schema, outputSchema: schema, deadlineMs: 5000,
  steps: [
    { stepId: "first", capability: echo("1"), input: { source: "composition-input" } },
    { stepId: "second", capability: echo("2"), input: { source: "step-output", stepId: "first" } },
  ],
});

test("valid linear composition produces a stable digest", () => {
  const first = validateComposition(valid());
  const second = validateComposition(valid());
  assert.deepEqual(first.issues, []);
  assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal(first.digest, second.digest);
});

test("composition rejects non-linear bindings and duplicate step ids", () => {
  const branch = validateComposition({ ...valid(), steps: [
    { stepId: "first", capability: echo("1"), input: { source: "composition-input" } },
    { stepId: "second", capability: echo("2"), input: { source: "composition-input" } },
  ] });
  assert.ok(branch.issues.some(issue => issue.code === "invalid_binding"));

  const duplicate = validateComposition({ ...valid(), steps: [
    { stepId: "same", capability: echo("1"), input: { source: "composition-input" } },
    { stepId: "same", capability: echo("2"), input: { source: "step-output", stepId: "same" } },
  ] });
  assert.ok(duplicate.issues.some(issue => issue.code === "duplicate_step_id"));
});

test("composition enforces step and deadline bounds", () => {
  assert.ok(validateComposition({ ...valid(), deadlineMs: 60001 }).issues.some(issue => issue.code === "invalid_deadline"));
  const steps = Array.from({ length: 17 }, (_, index) => ({ stepId: `step-${index}`, capability: echo("1"),
    input: index === 0 ? { source: "composition-input" } : { source: "step-output", stepId: `step-${index - 1}` } }));
  assert.ok(validateComposition({ ...valid(), steps }).issues.some(issue => issue.code === "invalid_steps"));
});

test("BPMN is deterministic, rejects injected ids and keeps one fixed topic", () => {
  const xml = compositionBpmn(["first", "second"]);
  assert.equal(xml, compositionBpmn(["first", "second"]));
  assert.match(xml, new RegExp(`<process id="${COMPOSITION_PROCESS_KEY}"`));
  assert.equal(xml.match(new RegExp(`flowable:topic="${COMPOSITION_TOPIC}"`, "g")).length, 2);
  assert.throws(() => compositionBpmn(["first", "<script>"]), TypeError);
  assert.throws(() => compositionBpmn(["first", "first"]), TypeError);
  assert.throws(() => compositionBpmn([]), TypeError);
});
