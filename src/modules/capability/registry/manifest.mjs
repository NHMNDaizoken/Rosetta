// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { LIMITS, parseStrictJson } from "../compatibility/compatibility.mjs";
import { HttpError } from "../../../platform/http/http.mjs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const UUID_RE = new RegExp(`^${UUID}$`);
const CAPABILITY_ID_RE = new RegExp(`^urn:rosetta:capability:(${UUID}):([a-z][a-z0-9-]{0,62})$`);
const PERMISSION_ID_RE = new RegExp(`^urn:rosetta:permission:(${UUID}):([a-z][a-z0-9-]{0,62})$`);
const VERSION_RE = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const PROPERTY_RE = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const INVOCATION_PATH_RE = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const PLATFORM_PREDICATES = ["caller-active", "provider-active", "grant-active", "same-tenant"];
const ROOT_KEYS = new Set(["manifestVersion", "capabilityId", "providerAppId", "version", "title", "description", "inputSchema", "outputSchema", "invocation", "requiredPermissions", "sideEffects", "timeoutMs", "preconditions"]);
const SCHEMA_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);
const SCHEMA_KEYS = {
  object: new Set(["type", "description", "properties", "required", "additionalProperties"]),
  array: new Set(["type", "description", "items", "minItems", "maxItems"]),
  string: new Set(["type", "description", "minLength", "maxLength"]),
  integer: new Set(["type", "description", "minimum", "maximum"]),
  number: new Set(["type", "description", "minimum", "maximum"]),
  boolean: new Set(["type", "description"]),
  null: new Set(["type", "description"]),
};

export class ManifestValidationError extends HttpError {
  constructor(issues) {
    super(422, "invalid_manifest");
    this.issues = issues;
  }
}

export function parseManifestText(text) {
  try {
    return parseStrictJson(text);
  } catch (error) {
    const code = error instanceof SyntaxError ? error.message : "invalid_json";
    throw new ManifestValidationError([{ path: "/", code, message: "Manifest is not strict I-JSON." }]);
  }
}

export function validateManifest(manifest, expected = {}) {
  const issues = [];
  const add = (path, code, message) => {
    if (issues.length < 256) issues.push({ path, code, message });
  };
  if (!isObject(manifest)) {
    add("/", "object_required", "Manifest must be a JSON object.");
    return issues;
  }
  for (const key of Object.keys(manifest)) {
    if (!ROOT_KEYS.has(key)) add(`/${escapePointer(key)}`, "unknown_field", "Unknown manifest field.");
  }
  if (manifest.manifestVersion !== "1.0") add("/manifestVersion", "unsupported_version", "Only manifestVersion 1.0 is accepted.");
  const capability = typeof manifest.capabilityId === "string" ? CAPABILITY_ID_RE.exec(manifest.capabilityId) : null;
  if (!capability) add("/capabilityId", "invalid_capability_id", "Capability ID must be an exact Rosetta URN.");
  if (typeof manifest.providerAppId !== "string" || !UUID_RE.test(manifest.providerAppId)) {
    add("/providerAppId", "invalid_provider_app_id", "Provider app ID must be an exact lowercase UUID.");
  } else if (capability && capability[1] !== manifest.providerAppId) {
    add("/capabilityId", "provider_mismatch", "Capability ID and provider app ID must agree.");
  }
  if (typeof manifest.version !== "string" || !VERSION_RE.test(manifest.version)) {
    add("/version", "invalid_version", "Version must be exact major.minor.patch.");
  }
  if (expected.capabilityId && manifest.capabilityId !== expected.capabilityId) {
    add("/capabilityId", "path_mismatch", "Manifest capability ID must match the request path.");
  }
  if (expected.version && manifest.version !== expected.version) {
    add("/version", "path_mismatch", "Manifest version must match the request path.");
  }
  if (expected.providerAppId && manifest.providerAppId !== expected.providerAppId) {
    add("/providerAppId", "provider_mismatch", "Provider app ID must match the authorized application.");
  }
  validateText(manifest, "title", 1, 120, add);
  validateText(manifest, "description", 1, 2048, add);
  validateSchema(manifest.inputSchema, "/inputSchema", 1, { nodes: 0 }, add);
  validateSchema(manifest.outputSchema, "/outputSchema", 1, { nodes: 0 }, add);
  validateInvocation(manifest.invocation, add);
  validatePermissions(manifest.requiredPermissions, manifest.providerAppId, add);
  validateSideEffects(manifest.sideEffects, add);
  if (!Number.isInteger(manifest.timeoutMs) || manifest.timeoutMs < 100 || manifest.timeoutMs > 10000) {
    add("/timeoutMs", "invalid_timeout", "Timeout must be an integer from 100 to 10000 milliseconds.");
  }
  validatePreconditions(manifest.preconditions, add);
  return issues;
}

// Reuses the manifest profile so runtime payload validation never accepts
// schema keywords that registration would have rejected.
export function validatePayloadSchema(schema) {
  const issues = [];
  validateSchema(schema, "/", 1, { nodes: 0 }, (path, code, message) => {
    if (issues.length < 256) issues.push({ path, code, message });
  });
  return issues;
}

export function assertManifest(manifest, expected = {}) {
  const issues = validateManifest(manifest, expected);
  if (issues.length) throw new ManifestValidationError(issues);
  return manifest;
}

export function manifestDigest(manifest) {
  return `sha256:${createHash("sha256").update(canonicalize(manifest)).digest("hex")}`;
}

export function canonicalize(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new TypeError("invalid_unicode");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("nonfinite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (!isObject(value)) throw new TypeError("invalid_json");
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

export function capabilityParts(capabilityId) {
  const match = typeof capabilityId === "string" ? CAPABILITY_ID_RE.exec(capabilityId) : null;
  if (!match) throw new HttpError(400, "invalid_capability_path");
  return { providerAppId: match[1], slug: match[2] };
}

function validateText(value, key, minimum, maximum, add) {
  const text = value[key];
  if (typeof text !== "string" || !text.isWellFormed()) {
    add(`/${key}`, "invalid_text", `${key} must be a well-formed string.`);
    return;
  }
  const length = codePointLength(text);
  if (length < minimum || length > maximum || /[\u0000-\u001f\u007f]/u.test(text)) {
    add(`/${key}`, "invalid_text", `${key} length or characters are outside the accepted range.`);
  }
}

function validateSchema(schema, pointer, depth, budget, add) {
  if (depth > LIMITS.maxDepth) {
    add(pointer, "schema_depth_exceeded", "Payload schema exceeds the maximum nesting depth.");
    return;
  }
  if (++budget.nodes > LIMITS.maxSchemaNodes) {
    add(pointer, "schema_node_limit", "Payload schema exceeds the maximum node count.");
    return;
  }
  if (!isObject(schema)) {
    add(pointer, "invalid_schema", "Payload schema node must be an object.");
    return;
  }
  if (typeof schema.type !== "string" || !SCHEMA_TYPES.has(schema.type)) {
    add(`${pointer}/type`, "invalid_schema", "Unsupported payload schema type.");
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!SCHEMA_KEYS[schema.type].has(key)) add(`${pointer}/${escapePointer(key)}`, "unsupported_keyword", "Unsupported payload schema keyword.");
  }
  if ("description" in schema) validateSchemaDescription(schema.description, `${pointer}/description`, add);

  if (schema.type === "object") {
    if (!isObject(schema.properties) || schema.additionalProperties !== false) {
      add(pointer, "invalid_schema", "Object schemas require properties and additionalProperties=false.");
      return;
    }
    const names = Object.keys(schema.properties);
    if (names.length > LIMITS.maxObjectProperties) add(`${pointer}/properties`, "schema_property_limit", "Object schema exceeds the property limit.");
    for (const name of names) {
      if (!PROPERTY_RE.test(name)) add(`${pointer}/properties/${escapePointer(name)}`, "invalid_property_name", "Object property name is outside the accepted profile.");
      validateSchema(schema.properties[name], `${pointer}/properties/${escapePointer(name)}`, depth + 1, budget, add);
    }
    if (!Array.isArray(schema.required) || schema.required.length > LIMITS.maxObjectProperties) {
      add(`${pointer}/required`, "invalid_schema", "Object schemas require a bounded required array.");
    } else {
      const required = new Set();
      for (const name of schema.required) {
        if (typeof name !== "string" || !PROPERTY_RE.test(name) || required.has(name) || !Object.hasOwn(schema.properties, name)) {
          add(`${pointer}/required`, "invalid_schema", "Required names must be unique declared properties.");
        }
        required.add(name);
      }
    }
  } else if (schema.type === "array") {
    if (!isObject(schema.items) || !Number.isInteger(schema.maxItems) || schema.maxItems < 0 || schema.maxItems > 1000) {
      add(pointer, "invalid_schema", "Array schemas require items and a bounded maxItems.");
      return;
    }
    if ("minItems" in schema && (!Number.isInteger(schema.minItems) || schema.minItems < 0 || schema.minItems > schema.maxItems)) {
      add(`${pointer}/minItems`, "invalid_schema", "Array minItems must not exceed maxItems.");
    }
    validateSchema(schema.items, `${pointer}/items`, depth + 1, budget, add);
  } else if (schema.type === "string") {
    if (!Number.isInteger(schema.maxLength) || schema.maxLength < 0 || schema.maxLength > 65536) {
      add(`${pointer}/maxLength`, "invalid_schema", "String schemas require a bounded maxLength.");
    } else if ("minLength" in schema && (!Number.isInteger(schema.minLength) || schema.minLength < 0 || schema.minLength > schema.maxLength)) {
      add(`${pointer}/minLength`, "invalid_schema", "String minLength must not exceed maxLength.");
    }
  } else if (schema.type === "integer") {
    if (!Number.isSafeInteger(schema.minimum) || !Number.isSafeInteger(schema.maximum) || schema.minimum > schema.maximum) {
      add(`${pointer}/minimum`, "invalid_schema", "Integer schemas require safe, ordered minimum and maximum.");
    }
  } else if (schema.type === "number") {
    if (typeof schema.minimum !== "number" || typeof schema.maximum !== "number" || !Number.isFinite(schema.minimum) ||
        !Number.isFinite(schema.maximum) || Math.abs(schema.minimum) > 1e100 || Math.abs(schema.maximum) > 1e100 ||
        schema.minimum > schema.maximum) {
      add(`${pointer}/minimum`, "invalid_schema", "Number schemas require finite, ordered bounds within the profile.");
    }
  }
}

function validateSchemaDescription(value, pointer, add) {
  if (typeof value !== "string" || !value.isWellFormed() || codePointLength(value) < 1 || codePointLength(value) > 1024) {
    add(pointer, "invalid_schema", "Schema description is outside the accepted range.");
  }
}

function validateInvocation(invocation, add) {
  if (!isObject(invocation)) {
    add("/invocation", "invalid_invocation", "Invocation must be an object.");
    return;
  }
  const keys = new Set(["protocol", "method", "path", "mediaType"]);
  for (const key of Object.keys(invocation)) {
    if (!keys.has(key)) add(`/invocation/${escapePointer(key)}`, "unknown_field", "Unknown invocation field.");
  }
  for (const key of keys) {
    if (!Object.hasOwn(invocation, key)) add(`/invocation/${key}`, "invalid_invocation", "Invocation field is required.");
  }
  if (invocation.protocol !== "http-json") add("/invocation/protocol", "invalid_invocation", "Only http-json is accepted.");
  if (invocation.method !== "POST") add("/invocation/method", "invalid_invocation", "Only POST is accepted.");
  if (invocation.mediaType !== "application/json") add("/invocation/mediaType", "invalid_invocation", "Only application/json is accepted.");
  if (typeof invocation.path !== "string" || invocation.path.length > 256 || !INVOCATION_PATH_RE.test(invocation.path)) {
    add("/invocation/path", "invalid_invocation", "Invocation path is outside the accepted relative profile.");
  }
}

function validatePermissions(permissions, providerAppId, add) {
  if (!Array.isArray(permissions) || permissions.length < 1 || permissions.length > 32) {
    add("/requiredPermissions", "invalid_permissions", "requiredPermissions must contain 1 to 32 entries.");
    return;
  }
  const seen = new Set();
  for (const permission of permissions) {
    const match = typeof permission === "string" ? PERMISSION_ID_RE.exec(permission) : null;
    if (!match || seen.has(permission)) {
      add("/requiredPermissions", "invalid_permissions", "Permissions must be unique exact Rosetta URNs.");
      continue;
    }
    if (typeof providerAppId === "string" && match[1] !== providerAppId) {
      add("/requiredPermissions", "permission_provider_mismatch", "Permissions must belong to the provider app namespace.");
    }
    seen.add(permission);
  }
}

function validateSideEffects(sideEffects, add) {
  if (!isObject(sideEffects)) {
    add("/sideEffects", "invalid_side_effects", "sideEffects must be an object.");
    return;
  }
  const keys = new Set(["kind", "description", "idempotency"]);
  for (const key of Object.keys(sideEffects)) {
    if (!keys.has(key)) add(`/sideEffects/${escapePointer(key)}`, "unknown_field", "Unknown sideEffects field.");
  }
  if (!["none", "non-idempotent", "idempotent"].includes(sideEffects.kind)) {
    add("/sideEffects/kind", "invalid_side_effects", "Unsupported side-effect kind.");
  }
  if (typeof sideEffects.description !== "string" || !sideEffects.description.isWellFormed() ||
      codePointLength(sideEffects.description) < 1 || codePointLength(sideEffects.description) > 1024) {
    add("/sideEffects/description", "invalid_side_effects", "sideEffects description is outside the accepted range.");
  }
  const expected = sideEffects.kind === "idempotent" ? "provider-key" : "none";
  if (!["none", "non-idempotent", "idempotent"].includes(sideEffects.kind) || sideEffects.idempotency !== expected) {
    add("/sideEffects/idempotency", "invalid_side_effects", "sideEffects idempotency must match its kind.");
  }
}

function validatePreconditions(preconditions, add) {
  if (!isObject(preconditions)) {
    add("/preconditions", "invalid_preconditions", "preconditions must be an object.");
    return;
  }
  for (const key of Object.keys(preconditions)) {
    if (!["approval", "platform"].includes(key)) add(`/preconditions/${escapePointer(key)}`, "unknown_field", "Unknown precondition field.");
  }
  if (!["none", "tenant-admin"].includes(preconditions.approval)) {
    add("/preconditions/approval", "invalid_preconditions", "approval must be none or tenant-admin.");
  }
  if (!Array.isArray(preconditions.platform) || preconditions.platform.length !== PLATFORM_PREDICATES.length ||
      new Set(preconditions.platform).size !== PLATFORM_PREDICATES.length ||
      !PLATFORM_PREDICATES.every(predicate => preconditions.platform.includes(predicate))) {
    add("/preconditions/platform", "invalid_preconditions", "v1 requires exactly all four platform predicates.");
  }
}

function codePointLength(value) {
  let length = 0;
  for (const _ of value) length++;
  return length;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function escapePointer(value) {
  return String(value).replaceAll("~", "~0").replaceAll("/", "~1");
}
