// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { LIMITS, validateValue } from "./capability-compatibility.mjs";
import { validatePayloadSchema } from "./capability-manifest.mjs";

export const MAX_PAYLOAD_BYTES = 65536;
export const MAX_PAYLOAD_NODES = LIMITS.maxSchemaNodes;

const issue = (path, code, message) => ({ path, code, message });
const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

// Bounded runtime validation for execution input and provider output. The
// schema itself must already satisfy the restricted manifest profile; the
// value is walked first so oversized or malformed documents cannot reach the
// recursive validator.
export function validatePayload(schema, value, { maxBytes = MAX_PAYLOAD_BYTES } = {}) {
  const schemaIssues = validatePayloadSchema(schema);
  if (schemaIssues.length) return schemaIssues;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_PAYLOAD_BYTES) throw new TypeError("maxBytes must be within 1..65536");

  // Walk before stringify so depth, node, prototype, Unicode and non-finite
  // checks happen without invoking toJSON or allocating a wire-sized copy.
  const bounds = inspect(value, "", 1, { nodes: 0 });
  if (bounds) return [bounds];
  let bytes;
  try {
    bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return [issue("/", "invalid_json_value", "Payload must be a JSON value.")];
  }
  if (bytes > maxBytes) return [issue("/", "payload_too_large", "Payload exceeds the byte limit.")];

  if (!validateValue(schema, value)) {
    return [issue("/", "invalid_payload", "Payload does not satisfy the declared schema.")];
  }
  return [];
}

function inspect(value, path, depth, budget) {
  if (depth > LIMITS.maxDepth) return issue(path || "/", "payload_too_deep", "Payload exceeds the maximum nesting depth.");
  if (++budget.nodes > MAX_PAYLOAD_NODES) return issue(path || "/", "payload_too_complex", "Payload exceeds the maximum node count.");
  if (typeof value === "string") {
    return value.isWellFormed() ? null : issue(path || "/", "invalid_unicode", "Payload contains unpaired surrogates.");
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? null : issue(path || "/", "nonfinite_number", "Payload contains a non-finite number.");
  }
  if (value === null || typeof value === "boolean") return null;
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.hasOwn(value, "toJSON")) {
      return issue(path || "/", "invalid_json_value", "Payload must contain only plain JSON arrays.");
    }
    for (let index = 0; index < value.length; index++) {
      const failure = inspect(value[index], `${path}/${index}`, depth + 1, budget);
      if (failure) return failure;
    }
    return null;
  }
  if (!isObject(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    return issue(path || "/", "invalid_json_value", "Payload must contain only plain JSON objects.");
  }
  for (const [key, item] of Object.entries(value)) {
    if (!key.isWellFormed()) return issue(path || "/", "invalid_unicode", "Payload contains an invalid object key.");
    const failure = inspect(item, `${path}/${escapePointer(key)}`, depth + 1, budget);
    if (failure) return failure;
  }
  return null;
}

function escapePointer(value) {
  return value.replaceAll("~", "~0").replaceAll("/", "~1");
}
