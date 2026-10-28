// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { applicationToken, validateApplicationBody } from "./applications.mjs";
import {
  ManifestValidationError,
  manifestDigest,
  parseManifestText,
  validateManifest,
} from "./capability-manifest.mjs";
import { HttpError, json, readBody, readFlatJsonObject, uuidPattern } from "./http.mjs";
import { trustCommand, validateGrantApproval } from "./trust.mjs";

const CAPABILITY_PATH = /^\/v1\/capabilities\/([^/]+)\/versions(?:\/([^/]+))?(?:\/(validate|publish|deprecate|revoke))?$/;
const CAPABILITY_ID = /^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$/;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

export async function handleCapabilities(request, response, identity, config, url) {
  if (!config.dataUrl) throw new HttpError(503, "capabilities_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  if (url.pathname === "/v1/capabilities") {
    if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
    return listCapabilities(request, response, identity, config, url);
  }
  const match = url.pathname.match(CAPABILITY_PATH);
  if (!match) throw new HttpError(400, "invalid_capability_path");
  if (url.search) throw new HttpError(400, "invalid_query");
  let capabilityId, version;
  try {
    capabilityId = decodeURIComponent(match[1]);
    version = match[2] ? decodeURIComponent(match[2]) : undefined;
  } catch { throw new HttpError(400, "invalid_capability_path"); }
  const action = match[3];
  if (!CAPABILITY_ID.test(capabilityId) || (version !== undefined && !VERSION.test(version))) {
    throw new HttpError(400, "invalid_capability_path");
  }
  const operation = capabilityOperation(request.method, version, action);
  if (!operation) throw new HttpError(405, "method_not_allowed");

  let payload;
  if (operation === "register" || operation === "update") {
    if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
    const bytes = await readBody(request, 65536);
    let manifest;
    try { manifest = parseManifestText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch (error) {
      if (error instanceof ManifestValidationError) throw error;
      throw new HttpError(400, "invalid_json");
    }
    const issues = validateManifest(manifest, { capabilityId, ...(version ? { version } : {}) });
    if (issues.length) throw new ManifestValidationError(issues);
    payload = { capabilityId, version: manifest.version, manifest, providerAppId: manifest.providerAppId, digest: manifestDigest(manifest) };
  } else {
    const body = operation === "get" ? {} : await readFlatJsonObject(request);
    payload = { capabilityId, ...(version ? { version } : {}), ...body };
    if (operation === "validate" && Object.keys(body).length) throw new HttpError(400, "invalid_validation_body");
    if (operation === "validate") {
      payload.validationStatus = "valid";
      payload.validationIssues = [];
      payload.validationPolicyRevision = 1;
    }
    if (operation === "publish" && (Object.keys(body).length !== 1 || !uuidPattern.test(body.approvalId ?? ""))) {
      throw new HttpError(400, "invalid_approval");
    }
    if (["deprecate", "revoke"].includes(operation)) validateReason(body);
  }
  if (request.headers["if-match"] !== undefined) payload.etag = request.headers["if-match"];
  const value = await command(config, identity, "rosetta_capability_api", "capability_command", operation, payload);
  if (value.versionId) response.setHeader("ETag", `"capability-version-${value.versionId}-${value.revision}"`);
  if (operation === "register") {
    response.setHeader("Location", `/v1/capabilities/${encodeURIComponent(value.capabilityId)}/versions/${value.version}`);
  }
  return json(response, operation === "register" ? 201 : 200, value);
}

export async function handleApprovals(request, response, identity, config, url) {
  if (!config.dataUrl) throw new HttpError(503, "approvals_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  if (url.search) throw new HttpError(400, "invalid_query");
  const match = url.pathname.match(/^\/v1\/approvals(?:\/([^/]+)(?:\/(revoke))?)?$/);
  if (!match || (match[1] && !uuidPattern.test(match[1]))) throw new HttpError(400, "invalid_approval_path");
  const [, approvalId, action] = match;
  const operation = !approvalId && request.method === "POST" ? "approval_create"
    : approvalId && !action && request.method === "GET" ? "approval_get"
      : approvalId && action === "revoke" && request.method === "POST" ? "approval_revoke" : undefined;
  if (!operation) throw new HttpError(405, "method_not_allowed");

  if (operation === "approval_create") {
    const body = await readFlatJsonObject(request);
    if (body.resourceType === "grant") {
      validateGrantApproval(body, identity);
      return approvalCommand(response, 201, await trustCommand(config, identity, operation,
        { grantId: body.resourceId, approvalId: randomUUID(), decision: body }));
    }
    if (body.resourceType === "application") {
      validateApplicationBody(body, "approval_create");
      return approvalCommand(response, 201, await command(config, identity, "rosetta_app_api", "application_command", operation,
        { appId: body.resourceId, approvalId: randomUUID(), decision: body }));
    }
    if (body.resourceType === "capability-version") {
      validateCapabilityApproval(body);
      return approvalCommand(response, 201, await command(config, identity, "rosetta_capability_api", "capability_command", operation,
        { approvalId: randomUUID(), decision: body }));
    }
    throw new HttpError(400, "invalid_approval_resource");
  }

  const body = operation === "approval_revoke" ? await readFlatJsonObject(request) : {};
  if (operation === "approval_revoke") validateReason(body);
  const payload = { approvalId, ...body };
  if (request.headers["if-match"] !== undefined) payload.etag = request.headers["if-match"];
  let result;
  try {
    result = await command(config, identity, "rosetta_app_api", "application_command", operation, payload);
  } catch (error) {
    if (!(error instanceof HttpError) || error.status !== 404) throw error;
  }
  if (!result) {
    try { result = await command(config, identity, "rosetta_capability_api", "capability_command", operation, payload); }
    catch (error) { if (!(error instanceof HttpError) || error.status !== 404) throw error; }
  }
  if (!result) {
    try { result = await trustCommand(config, identity, operation, payload); }
    catch (error) {
      if (error instanceof HttpError && error.message === "trust_permission_required") throw new HttpError(404, "not_found");
      throw error;
    }
  }
  return approvalCommand(response, 200, result);
}

async function listCapabilities(request, response, identity, config, url) {
  const payload = {};
  for (const key of url.searchParams.keys()) {
    if (key !== "limit" && key !== "cursor") throw new HttpError(400, "invalid_capability_query");
  }
  const limits = url.searchParams.getAll("limit");
  const cursors = url.searchParams.getAll("cursor");
  if (limits.length > 1 || cursors.length > 1) throw new HttpError(400, "invalid_capability_query");
  if (limits.length) {
    if (!/^[0-9]{1,3}$/.test(limits[0])) throw new HttpError(400, "invalid_capability_query");
    const limit = Number(limits[0]);
    if (limit < 1 || limit > 100) throw new HttpError(400, "invalid_capability_query");
    payload.limit = limit;
  }
  if (cursors.length) {
    if (!/^[0-9a-f]{1,512}$/i.test(cursors[0])) throw new HttpError(400, "invalid_capability_cursor");
    payload.cursor = cursors[0].toLowerCase();
  }
  const value = await command(config, identity, "rosetta_capability_api", "capability_command", "list", payload);
  return json(response, 200, value);
}

function capabilityOperation(method, version, action) {
  if (!version && method === "POST") return "register";
  if (version && !action) return method === "GET" ? "get" : method === "PUT" ? "update" : undefined;
  if (version && action && method === "POST") return action;
  return undefined;
}

async function command(config, identity, role, rpc, operation, payload) {
  let result;
  try {
    const db = await fetch(`${config.dataUrl}/rpc/${rpc}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, role)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!db.ok) throw Error();
    result = await db.json();
  } catch { throw new HttpError(503, role === "rosetta_capability_api" ? "capabilities_unavailable" : "approvals_unavailable"); }
  if (result.error) throw new HttpError(result.status, result.error);
  return result.value;
}

function approvalCommand(response, status, value) {
  response.setHeader("ETag", `"approval-${value.approvalId}-${value.revision}"`);
  if (status === 201) response.setHeader("Location", `/v1/approvals/${value.approvalId}`);
  return json(response, status, value);
}

function validateCapabilityApproval(body) {
  const required = ["resourceType", "resourceId", "resourceDigest", "resourceRevision", "requesterSubject", "requesterAppId", "decision", "expiresAt"];
  if (required.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key))) {
    throw new HttpError(400, "invalid_capability_approval");
  }
  if (body.resourceType !== "capability-version" || !["approve", "deny"].includes(body.decision) ||
    !/^sha256:[0-9a-f]{64}$/.test(body.resourceDigest) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.expiresAt) ||
    !Number.isFinite(Date.parse(body.expiresAt))) {
    throw new HttpError(400, "invalid_capability_approval");
  }
  const normalized = body.expiresAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  if (new Date(body.expiresAt).toISOString() !== normalized) throw new HttpError(400, "invalid_approval_expiry");
  if (!Number.isInteger(body.resourceRevision) || body.resourceRevision < 1 || body.resourceRevision > 2147483647) {
    throw new HttpError(400, "invalid_revision");
  }
  if (!uuidPattern.test(body.requesterAppId) || typeof body.resourceId !== "string" || !body.resourceId ||
    [...body.resourceId].length > 256 || typeof body.requesterSubject !== "string" || !body.requesterSubject ||
    [...body.requesterSubject].length > 255) {
    throw new HttpError(400, "invalid_capability_approval");
  }
  const reference = body.resourceId.split("@");
  if (/[\s\u0000-\u001f\u007f]/u.test(body.resourceId) || (!uuidPattern.test(body.resourceId) && !(CAPABILITY_ID.test(reference[0]) &&
    (reference.length === 1 || (reference.length === 2 && VERSION.test(reference[1])))))) {
    throw new HttpError(400, "invalid_capability_approval");
  }
}

function validateReason(body) {
  if (Object.keys(body).length !== 1 || typeof body.reason !== "string" || !body.reason.isWellFormed() ||
    !body.reason.trim() || [...body.reason].length > 512 || /[\u0000-\u001f\u007f]/u.test(body.reason)) {
    throw new HttpError(400, "invalid_reason");
  }
}
