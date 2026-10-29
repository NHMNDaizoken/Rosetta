// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Internal C4A authority only. HTTP routes and engine dispatch are separate gates.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAuthorizer } from "./auth.mjs";
import { assertManifest, canonicalize, manifestDigest } from "./capability-manifest.mjs";
import { validatePayload } from "./capability-payload.mjs";
import { HttpError, requireWriter, uuidPattern } from "./http.mjs";
import { signInternalToken } from "./internal-token.mjs";
import { evaluateCapabilityEligibility } from "./trust.mjs";

const digestPattern = /^sha256:[0-9a-f]{64}$/;
const capabilityPattern = /^urn:rosetta:capability:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[a-z][a-z0-9-]{0,62}$/;
const versionPattern = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const sameIdentity = (a, b) => ["tenantId", "issuer", "subject", "clientId"].every(key => a[key] === b[key]);
export const jsonDigest = value => `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
export const ticketDigest = ticket => `sha256:${createHash("sha256").update(ticket).digest("hex")}`;

export function validateExecutionCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "input,target") {
    throw new HttpError(400, "invalid_execution_request");
  }
  const target = body.target;
  if (!target || typeof target !== "object" || Array.isArray(target) || Object.keys(target).sort().join(",") !== "capability,kind" || target.kind !== "capability") {
    throw new HttpError(422, "single_capability_required");
  }
  const ref = target.capability;
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).sort().join(",") !== "capabilityId,manifestDigest,version" ||
    typeof ref.capabilityId !== "string" || ref.capabilityId.length > 160 || !capabilityPattern.test(ref.capabilityId) ||
    typeof ref.version !== "string" || ref.version.length > 29 || !versionPattern.test(ref.version) ||
    typeof ref.manifestDigest !== "string" || !digestPattern.test(ref.manifestDigest)) throw new HttpError(422, "invalid_capability_reference");
  return body;
}

// Credentials never leave this closure except while invoking a trusted internal
// callback. Restart discards the map. Expiry never extends the original deadline.
export function createAuthenticationLeases({ capacity = 1000, now = Date.now } = {}) {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000) throw new TypeError("invalid lease capacity");
  const leases = new Map();
  function prune() { for (const [key, value] of leases) if (value.expiresAt <= now()) leases.delete(key); }
  return Object.freeze({
    put(execution, identity, authorization) {
      prune();
      if (!uuidPattern.test(execution.executionId) || !identity.clientId || !Number.isFinite(identity.credentialExpiresAt) ||
        typeof authorization !== "string" || authorization.length > 8192 || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) throw new HttpError(401, "invalid_authentication_lease");
      const expiry = Math.min(identity.credentialExpiresAt, Date.parse(execution.deadlineAt));
      if (!Number.isFinite(expiry) || expiry <= now()) throw new HttpError(409, "auth_required");
      const previous = leases.get(execution.executionId);
      if (previous && !sameIdentity(previous.identity, identity)) throw new HttpError(403, "initiator_mismatch");
      if (!previous && leases.size >= capacity) throw new HttpError(429, "execution_capacity_exceeded");
      const boundIdentity = { tenantId: identity.tenantId, issuer: identity.issuer, subject: identity.subject, clientId: identity.clientId };
      leases.set(execution.executionId, { identity: boundIdentity, authorization, expiresAt: expiry });
    },
    async use(executionId, identity, callback) {
      prune();
      const lease = leases.get(executionId);
      if (!lease) throw new HttpError(409, "auth_required");
      if (identity && !sameIdentity(lease.identity, identity)) throw new HttpError(403, "initiator_mismatch");
      return callback({ ...lease.identity }, lease.authorization, lease.expiresAt);
    },
    has(executionId) { prune(); return leases.has(executionId); },
    delete(executionId) { leases.delete(executionId); },
    clear() { leases.clear(); },
  });
}

export function leaseProof(executionId, identity, expiresAt) {
  return { executionId, tenantId: identity.tenantId, issuer: identity.issuer, subject: identity.subject,
    clientId: identity.clientId, writer: identity.roles.includes("core-writer"), expiresAt: new Date(expiresAt).toISOString() };
}

export async function executionCommand(config, identity, operation, payload, proof) {
  if (!identity.clientId || !config.dataUrl || !Number.isFinite(identity.credentialExpiresAt)) throw new HttpError(503, "executions_unavailable");
  const assertion = signInternalToken(config.dataSecret, { role: "rosetta_execution_api", aud: "rosetta-data",
    tenant_id: identity.tenantId, iss: identity.issuer, sub: identity.subject, client_id: identity.clientId,
    trust_writer: identity.roles.includes("core-writer"),
    exp: Math.min(Math.floor(Date.now() / 1000) + 30, Math.floor(identity.credentialExpiresAt / 1000)),
    ...(proof ? { c4a_lease: proof } : {}) });
  let result;
  try {
    const response = await fetch(`${config.dataUrl}/rpc/execution_command`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${assertion}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2097152) throw Error(); chunks.push(chunk); }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
    result = JSON.parse(text);
    if (!result || !Number.isInteger(result.status) || (result.error && !/^[a-z][a-z0-9_]{0,79}$/.test(result.error))) throw Error();
  } catch { throw new HttpError(503, "executions_unavailable"); }
  if (result.error) throw new HttpError(result.status, result.error);
  return result;
}

export async function resolveExecution(config, identity, body) {
  requireWriter(identity);
  validateExecutionCreate(body);
  const { value } = await executionCommand(config, identity, "resolve", body.target.capability);
  assertManifest(value.manifest, body.target.capability);
  if (manifestDigest(value.manifest) !== body.target.capability.manifestDigest || value.manifest.sideEffects.kind !== "none" || value.manifest.preconditions.approval !== "none") {
    throw new HttpError(422, "unsupported_execution_precondition");
  }
  const issues = validatePayload(value.manifest.inputSchema, body.input);
  if (issues.length) throw new HttpError(422, "invalid_execution_input");
  return value;
}

export async function reserveExecution(config, identity, request, body, leases, resolved) {
  requireWriter(identity);
  validateExecutionCreate(body);
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !uuidPattern.test(key)) throw new HttpError(400, "uuid_idempotency_key_required");
  resolved ??= await resolveExecution(config, identity, body);
  const executionId = randomUUID();
  const inputDigest = jsonDigest(body.input);
  const requestDigest = jsonDigest({ target: body.target, inputDigest });
  const deadline = Math.min(Date.now() + resolved.manifest.timeoutMs, Date.parse(resolved.authorityExpiresAt));
  let result = await executionCommand(config, identity, "reserve", { executionId, idempotencyKey: key,
    target: body.target.capability, input: body.input, inputDigest, requestDigest, deadlineAt: new Date(deadline).toISOString() });
  if (["accepted", "auth_required"].includes(result.value.state)) leases.put(result.value, identity, request.headers.authorization);
  if (result.value.state === "auth_required") {
    result = await recheckLease(config, leases, result.value.executionId, identity, body.target.capability,
      (current, proof) => executionCommand(config, current, "reauthorize", { executionId: result.value.executionId }, proof));
  }
  return result;
}

export async function recheckLease(config, leases, executionId, identity, reference, callback) {
  return leases.use(executionId, identity, async (original, authorization, expiresAt) => {
    const request = { headers: { authorization } };
    const current = await createAuthorizer(config)(request, true);
    requireWriter(current);
    if (!sameIdentity(original, current)) throw new HttpError(403, "initiator_mismatch");
    const decision = await evaluateCapabilityEligibility(request, config, { ...reference, operation: "invoke" });
    if (!decision.allowed) throw new HttpError(decision.reason.endsWith("unavailable") ? 503 : 403, "invoke_not_authorized");
    if (Date.now() >= Math.min(expiresAt, current.credentialExpiresAt)) throw new HttpError(409, "auth_required");
    return callback(current, leaseProof(executionId, current, Math.min(expiresAt, current.credentialExpiresAt)));
  });
}

export async function prepareProviderTicket(config, leases, execution, correlation) {
  const reference = { capabilityId: execution.capability_id, version: execution.version, manifestDigest: execution.manifest_digest };
  return recheckLease(config, leases, execution.execution_id, null, reference, async (identity, proof) => {
    const ticket = randomBytes(32).toString("base64url");
    const expires = Math.min(Date.now() + 30000, Date.parse(execution.deadline_at), Date.parse(proof.expiresAt));
    await executionCommand(config, identity, "prepare", { executionId: execution.execution_id, ...correlation,
      ticketHash: ticketDigest(ticket), ticketExpiresAt: new Date(expires).toISOString() }, proof);
    return { ticket, proof, identity };
  });
}

export async function redeemProviderTicket(config, provider, body, leases) {
  requireWriter(provider);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "inputDigest,invocationId,ticket" ||
    typeof body.ticket !== "string" || !/^[A-Za-z0-9_-]{43,256}$/.test(body.ticket) ||
    typeof body.invocationId !== "string" || !uuidPattern.test(body.invocationId) ||
    typeof body.inputDigest !== "string" || !digestPattern.test(body.inputDigest)) return { active: false };
  const payload = { executionId: body.invocationId, ticketHash: ticketDigest(body.ticket), inputDigest: body.inputDigest };
  let context;
  try { ({ value: context } = await executionCommand(config, provider, "ticket_context", payload)); }
  catch (error) {
    if (error instanceof HttpError && [403, 404].includes(error.status)) return { active: false };
    throw error;
  }
  if (!context.active) return { active: false };
  try {
    return await recheckLease(config, leases, body.invocationId, context, context.target, async (_identity, proof) => {
      const { value } = await executionCommand(config, provider, "redeem", payload, proof);
      return value.active === true ? value : { active: false };
    });
  } catch (error) {
    if (error instanceof HttpError && error.status !== 503) return { active: false };
    throw error;
  }
}
