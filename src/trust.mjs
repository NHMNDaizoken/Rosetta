// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { canonicalize, parseManifestText } from "./capability-manifest.mjs";
import { applicationToken, validateApplicationBody } from "./applications.mjs";
import { createAuthorizer } from "./auth.mjs";
import { HttpError, json, readBody, readFlatJsonObject, requireWriter, uuidPattern } from "./http.mjs";

const capabilityId = /^urn:rosetta:capability:([0-9a-f-]{36}):[a-z][a-z0-9-]{0,62}$/;
const exactVersion = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const digest = /^sha256:[0-9a-f]{64}$/;
const cleanString = value => typeof value === "string" && value.isWellFormed() &&
  value.trim().length > 0 && [...value].length <= 255 && !/[\u0000-\u001f\u007f*]/u.test(value);

export function validateGrant(body) {
  const keys = ["providerAppId", "consumerAppId", "capabilities", "operations", "permissions", "subjectIds", "expiresAt", "delegationAllowed", "acceptDelegation"];
  const invalid = () => { throw new HttpError(400, "invalid_direct_grant"); };
  if (!body || typeof body !== "object" || Array.isArray(body) || keys.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !keys.includes(key))) invalid();
  if (typeof body.providerAppId !== "string" || typeof body.consumerAppId !== "string" ||
    body.providerAppId.length !== 36 || body.consumerAppId.length !== 36 ||
    !uuidPattern.test(body.providerAppId) || !uuidPattern.test(body.consumerAppId) ||
    body.providerAppId === body.consumerAppId || body.delegationAllowed !== false || body.acceptDelegation !== false) invalid();
  for (const [key, max] of [["capabilities", 1], ["operations", 2], ["permissions", 32], ["subjectIds", 100]]) {
    if (!Array.isArray(body[key]) || body[key].length < 1 || body[key].length > max || new Set(body[key].map(value => JSON.stringify(value))).size !== body[key].length) invalid();
  }
  const ref = body.capabilities[0];
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).sort().join(",") !== "capabilityId,manifestDigest,version" ||
    ["capabilityId", "version", "manifestDigest"].some(key => !cleanString(ref[key])) ||
    !capabilityId.test(ref.capabilityId) || !ref.capabilityId.startsWith(`urn:rosetta:capability:${body.providerAppId}:`) ||
    !exactVersion.test(ref.version) || !digest.test(ref.manifestDigest)) invalid();
  if (body.operations.some(value => !["discover", "invoke"].includes(value)) ||
    body.permissions.some(value => !cleanString(value) || !new RegExp(`^urn:rosetta:permission:${body.providerAppId}:[a-z][a-z0-9-]{0,62}$`).test(value)) ||
    body.subjectIds.some(value => !cleanString(value))) invalid();
  if (typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt))) invalid();
  const normalized = body.expiresAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
  if (new Date(body.expiresAt).toISOString() !== normalized) invalid();
  return body;
}

export function grantDigest(grantId, identity, proposal) {
  return `sha256:${createHash("sha256").update(canonicalize({ grantId, tenantId: identity.tenantId,
    issuer: identity.issuer, createdBy: identity.subject, proposal })).digest("hex")}`;
}

export async function trustCommand(config, identity, operation, payload) {
  if (!config.dataUrl) throw new HttpError(503, "trust_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  let result;
  try {
    const response = await fetch(`${config.dataUrl}/rpc/trust_command`, { method: "POST",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "rosetta_trust_api")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) throw Error();
    result = await response.json();
  } catch { throw new HttpError(503, "trust_unavailable"); }
  if (result.error) throw new HttpError(result.status, result.error);
  return result.value;
}

export function validateGrantApproval(body, identity) {
  requireWriter(identity);
  // Grant approvals use the existing closed UUID approval body and UTC rules.
  validateApplicationBody({ ...body, resourceType: "application" }, "approval_create");
}

export async function handleTrust(request, response, identity, config, url) {
  if (url.search) throw new HttpError(400, "invalid_query");
  const match = url.pathname.match(/^\/v1\/trust\/grants(?:\/([^/]+)(?:\/(activate|revoke))?)?$/);
  if (!match || (match[1] && (match[1].length !== 36 || !uuidPattern.test(match[1])))) throw new HttpError(400, "invalid_grant_path");
  const [, grantId, action] = match;
  const operation = !grantId && request.method === "POST" ? "create" : grantId && !action && request.method === "GET" ? "get"
    : grantId && action && request.method === "POST" ? action : undefined;
  if (!operation) throw new HttpError(405, "method_not_allowed");
  if (request.method !== "GET") requireWriter(identity);
  let payload = { grantId };
  if (operation === "create") {
    if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
    const bytes = await readBody(request, 65536);
    let body;
    try { body = parseManifestText(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new HttpError(400, "invalid_json"); }
    const proposal = validateGrant(body);
    const id = randomUUID();
    payload = { grantId: id, proposal, digest: grantDigest(id, identity, proposal) };
  } else if (operation !== "get") {
    const body = await readFlatJsonObject(request);
    validateApplicationBody(body, operation === "activate" ? "approve" : "approval_revoke");
    payload = { ...payload, ...body };
  }
  if (request.headers["if-match"] !== undefined) payload.etag = request.headers["if-match"];
  const value = await trustCommand(config, identity, operation, payload);
  response.setHeader("ETag", `"grant-${value.grantId}-${value.revision}"`);
  if (operation === "create") response.setHeader("Location", `/v1/trust/grants/${value.grantId}`);
  return json(response, operation === "create" ? 201 : 200, value);
}

// INTERNAL only. Authenticate anew for every check; C4 must call this immediately
// before dispatch and still enforce invocation approvals/preconditions itself.
export async function evaluateCapabilityEligibility(request, config, reference) {
  const deny = reason => ({ allowed: false, reason });
  if (!reference || typeof reference !== "object" || Array.isArray(reference) ||
    Object.keys(reference).sort().join(",") !== "capabilityId,manifestDigest,operation,version" ||
    !["capabilityId", "version", "manifestDigest"].every(key => cleanString(reference[key])) ||
    !capabilityId.test(reference.capabilityId) || !exactVersion.test(reference.version) || !digest.test(reference.manifestDigest) ||
    !["discover", "invoke"].includes(reference.operation)) return deny("invalid_reference");
  let identity;
  try { identity = await createAuthorizer(config)(request, true); }
  catch (error) { return deny(error.status === 503 ? "identity_unavailable" : "principal_required"); }
  if (!identity.clientId) return deny("consumer_binding_required");
  try {
    const response = await fetch(`${config.dataUrl}/rpc/trust_eligibility`, { method: "POST",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "rosetta_trust_api")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: reference }), signal: AbortSignal.timeout(5000), redirect: "error" });
    if (!response.ok) return deny("authority_unavailable");
    const decision = await response.json();
    if (decision.allowed === true && decision.reason === "eligible") return { allowed: true, reason: "eligible" };
    return deny(["invalid_reference", "principal_required", "consumer_binding_required", "capability_unavailable", "grant_not_authorized"].includes(decision.reason) ? decision.reason : "authority_unavailable");
  } catch { return deny("authority_unavailable"); }
}
