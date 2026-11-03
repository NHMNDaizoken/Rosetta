// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Bounded Composition v1. Structural validation only; authority is resolved by
// the database at validation and execution time and is never cached here.
import { createHash } from "node:crypto";
import { resolveCompatibility } from "../compatibility/compatibility.mjs";
import { canonicalize, validatePayloadSchema } from "../registry/manifest.mjs";

const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const STEP_ID = /^[a-z][a-z0-9-]{0,31}$/;
const CAPABILITY = /^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$/;

export const COMPOSITION_LIMITS = Object.freeze({ maxSteps: 16, minDeadlineMs: 100, maxDeadlineMs: 60000, maxNameLength: 120 });

const issue = (path, code, message) => ({ path, code, message });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const exactly = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

// Returns { issues, digest } for a parsed composition document. No authority is
// involved; schema subset rules and the linear binding contract are pure here.
export function validateComposition(value, { expectedVersion } = {}) {
  const issues = [];
  if (!exactly(value, ["compositionFormat", "name", "version", "inputSchema", "outputSchema", "deadlineMs", "steps"])) {
    return { issues: [issue("/", "invalid_composition", "Composition must contain exactly the v1 fields.")] };
  }
  if (value.compositionFormat !== "1.0") issues.push(issue("/compositionFormat", "invalid_format", "compositionFormat must be 1.0."));
  if (typeof value.name !== "string" || !value.name.trim() || [...value.name].length > COMPOSITION_LIMITS.maxNameLength ||
    !value.name.isWellFormed() || /[\u0000-\u001f\u007f]/u.test(value.name)) {
    issues.push(issue("/name", "invalid_name", "Name must be 1..120 printable characters."));
  }
  if (typeof value.version !== "string" || !VERSION.test(value.version)) issues.push(issue("/version", "invalid_version", "Version must be exact major.minor.patch."));
  else if (expectedVersion && value.version !== expectedVersion) issues.push(issue("/version", "path_mismatch", "Version must match the request path."));
  for (const key of ["inputSchema", "outputSchema"]) {
    const found = validatePayloadSchema(value[key]);
    for (const item of found) issues.push(issue(`/${key}${item.path === "/" ? "" : item.path}`, item.code, item.message));
  }
  if (!Number.isInteger(value.deadlineMs) || value.deadlineMs < COMPOSITION_LIMITS.minDeadlineMs || value.deadlineMs > COMPOSITION_LIMITS.maxDeadlineMs) {
    issues.push(issue("/deadlineMs", "invalid_deadline", "deadlineMs must be an integer from 100 to 60000."));
  }
  if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > COMPOSITION_LIMITS.maxSteps) {
    issues.push(issue("/steps", "invalid_steps", "A composition must contain 1..16 steps."));
  } else {
    const seen = new Set();
    let expectedSource = "composition-input", previous;
    value.steps.forEach((step, index) => {
      const path = `/steps/${index}`;
      if (!exactly(step, ["stepId", "capability", "input"])) { issues.push(issue(path, "invalid_step", "Step must contain exactly stepId, capability and input.")); return; }
      if (typeof step.stepId !== "string" || !STEP_ID.test(step.stepId)) issues.push(issue(`${path}/stepId`, "invalid_step_id", "stepId must match ^[a-z][a-z0-9-]{0,31}$."));
      else if (seen.has(step.stepId)) issues.push(issue(`${path}/stepId`, "duplicate_step_id", "stepId must be unique."));
      else seen.add(step.stepId);
      if (!exactly(step.capability, ["capabilityId", "version", "manifestDigest"]) ||
        typeof step.capability.capabilityId !== "string" || !CAPABILITY.test(step.capability.capabilityId) ||
        typeof step.capability.version !== "string" || !VERSION.test(step.capability.version) ||
        typeof step.capability.manifestDigest !== "string" || !DIGEST.test(step.capability.manifestDigest)) {
        issues.push(issue(`${path}/capability`, "invalid_capability_reference", "Step must pin an exact capability version and manifest digest."));
      }
      const input = step.input;
      if (index === 0) {
        if (!exactly(input, ["source"]) || input.source !== "composition-input") issues.push(issue(`${path}/input`, "invalid_binding", "The first step must bind composition-input."));
      } else if (!exactly(input, ["source", "stepId"]) || input.source !== "step-output" || input.stepId !== previous) {
        issues.push(issue(`${path}/input`, "invalid_binding", "Each later step must bind exactly the immediately preceding step output."));
      }
      previous = step.stepId;
    });
  }
  return { issues, digest: issues.length ? undefined : `sha256:${createDigest(value)}` };
}

// C3 compatibility across each adjacent edge. Whole-value binding means the
// producer output schema is the consumer input schema for that edge.
export function compositionCompatibility(value, schemas) {
  if (!Array.isArray(value?.steps)) return [issue("/steps", "invalid_steps", "No steps to compare.")];
  const issues = [];
  const last = value.steps.length - 1;
  const first = schemas[0]?.inputSchema;
  const source = schemas[0]?.outputSchema;
  if (first) {
    const result = resolveCompatibility(value.inputSchema, first);
    if (result.status !== "compatible") issues.push(issue("/inputSchema", `input_${result.status}`, "Composition input cannot satisfy the first step input."));
  }
  for (let index = 0; index < last; index++) {
    const producer = schemas[index]?.outputSchema, consumer = schemas[index + 1]?.inputSchema;
    const result = resolveCompatibility(producer, consumer);
    if (result.status !== "compatible") {
      issues.push(issue(`/steps/${index + 1}/input`, `edge_${result.status}`, `Step ${index + 1} output cannot satisfy step ${index + 2} input.`));
    }
  }
  if (source !== undefined) {
    const result = resolveCompatibility(schemas[last]?.outputSchema, value.outputSchema);
    if (result.status !== "compatible") issues.push(issue("/outputSchema", `output_${result.status}`, "Final step output cannot satisfy the composition output."));
  }
  return issues;
}

function createDigest(value) {
  return createHash("sha256").update(canonicalize(value)).digest("hex");
}
