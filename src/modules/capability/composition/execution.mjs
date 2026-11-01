// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// C4B composition execution adapter. Authority lives in SQL; this module only
// validates wire shape, carries the memory lease and correlates steps.
import { randomBytes, randomUUID } from "node:crypto";
import { applicationToken } from "../../applications/applications.mjs";
import { HttpError, requireWriter, uuidPattern } from "../../../platform/http/http.mjs";
import { validatePayload } from "../registry/payload.mjs";
import { createAuthorizer } from "../../../platform/auth/auth.mjs";
import { createAuthenticationLeases, jsonDigest, leaseProof, ticketDigest } from "../execution/execution.mjs";

const DIGEST = /^sha256:[0-9a-f]{64}$/;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;
const sameIdentity = (a, b) => ["tenantId", "issuer", "subject", "clientId"].every(key => a[key] === b[key]);

export function validateCompositionExecutionCreate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).sort().join(",") !== "input,target") {
    throw new HttpError(400, "invalid_execution_request");
  }
  const target = body.target;
  if (!target || typeof target !== "object" || Array.isArray(target) ||
    Object.keys(target).sort().join(",") !== "compositionDigest,compositionId,kind,version" || target.kind !== "composition") {
    throw new HttpError(422, "composition_target_required");
  }
  if (!uuidPattern.test(target.compositionId) || typeof target.version !== "string" || !VERSION.test(target.version) ||
    typeof target.compositionDigest !== "string" || !DIGEST.test(target.compositionDigest)) {
    throw new HttpError(422, "invalid_composition_reference");
  }
  return body;
}

export async function compositionExecutionCommand(config, identity, operation, payload, proof) {
  if (!identity.clientId || !config.dataUrl || !Number.isFinite(identity.credentialExpiresAt)) throw new HttpError(503, "executions_unavailable");
  const assertion = applicationToken(identity, config.dataSecret, "rosetta_composition_api");
  let result;
  try {
    const response = await fetch(`${config.dataUrl}/rpc/composition_execution_command`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${assertion}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2097152) throw Error(); chunks.push(chunk); }
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!result || !Number.isInteger(result.status) || (result.error && !/^[a-z][a-z0-9_]{0,79}$/.test(result.error))) throw Error();
  } catch { throw new HttpError(503, "executions_unavailable"); }
  if (result.error) throw new HttpError(result.status, result.error);
  return result;
}

// Revalidates the caller's live token and returns a lease proof. Per-step
// capability authority is checked by SQL in resolve/prepare, not cached here.
export async function recheckCompositionLease(config, leases, executionId, identity, callback) {
  return leases.use(executionId, identity, async (original, authorization, expiresAt) => {
    const current = await createAuthorizer(config)({ headers: { authorization } }, true);
    requireWriter(current);
    if (!sameIdentity(original, current)) throw new HttpError(403, "initiator_mismatch");
    if (Date.now() >= Math.min(expiresAt, current.credentialExpiresAt)) throw new HttpError(409, "auth_required");
    return callback(current, leaseProof(executionId, current, Math.min(expiresAt, current.credentialExpiresAt)));
  });
}

export async function resolveCompositionExecution(config, identity, body) {
  requireWriter(identity);
  validateCompositionExecutionCreate(body);
  const { value } = await compositionExecutionCommand(config, identity, "resolve", body.target);
  const steps = value?.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > 16) throw new HttpError(422, "invalid_composition");
  const issues = validatePayload(value.composition.inputSchema, body.input);
  if (issues.length) throw new HttpError(422, "invalid_execution_input");
  return value;
}

export async function reserveCompositionExecution(config, identity, request, body, leases, resolved) {
  requireWriter(identity);
  validateCompositionExecutionCreate(body);
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !uuidPattern.test(key)) throw new HttpError(400, "uuid_idempotency_key_required");
  resolved ??= await resolveCompositionExecution(config, identity, body);
  const executionId = randomUUID();
  const inputDigest = jsonDigest(body.input);
  const requestDigest = jsonDigest({ target: body.target, inputDigest });
  const deadline = Math.min(Date.now() + resolved.composition.deadlineMs, Date.parse(resolved.authorityExpiresAt));
  const result = await compositionExecutionCommand(config, identity, "reserve", { executionId, idempotencyKey: key,
    target: body.target, input: body.input, inputDigest, requestDigest, deadlineAt: new Date(deadline).toISOString() });
  if (["accepted", "auth_required"].includes(result.value.state) && !leases.has(result.value.executionId)) {
    leases.put(result.value, identity, request.headers.authorization);
  }
  return result;
}

export async function prepareCompositionStep(config, leases, execution, stepIndex, correlation) {
  return recheckCompositionLease(config, leases, execution.execution_id, null, async (identity, proof) => {
    const ticket = randomBytes(32).toString("base64url");
    const expires = Math.min(Date.now() + 30000, Date.parse(execution.deadline_at), Date.parse(proof.expiresAt),
      Date.parse(execution.authority_expires_at));
    const { value } = await compositionExecutionCommand(config, identity, "prepare", { executionId: execution.execution_id,
      stepIndex, processId: correlation.processId, definitionId: correlation.definitionId,
      jobId: correlation.jobId, ticketHash: ticketDigest(ticket), ticketExpiresAt: new Date(expires).toISOString() }, proof);
    return { ...value, ticket, identity };
  });
}

export async function redeemCompositionTicket(config, provider, body, leases) {
  requireWriter(provider);
  if (!body || typeof body !== "object" || Array.isArray(body) ||
    Object.keys(body).sort().join(",") !== "inputDigest,invocationId,ticket" ||
    typeof body.ticket !== "string" || !/^[A-Za-z0-9_-]{43,256}$/.test(body.ticket) ||
    !uuidPattern.test(body.invocationId) || typeof body.inputDigest !== "string" || !DIGEST.test(body.inputDigest)) return { active: false };
  const payload = { executionId: body.invocationId, ticketHash: ticketDigest(body.ticket), inputDigest: body.inputDigest };
  let context;
  try { ({ value: context } = await compositionExecutionCommand(config, provider, "ticket_context", payload)); }
  catch (error) {
    if (error instanceof HttpError && [403, 404].includes(error.status)) return { active: false };
    throw error;
  }
  if (!context.active) return { active: false };
  try {
    return await recheckCompositionLease(config, leases, body.invocationId, context, async () => {
      const { value } = await compositionExecutionCommand(config, provider, "redeem", payload);
      return value.active === true ? value : { active: false };
    });
  } catch (error) {
    if (error instanceof HttpError && error.status !== 503) return { active: false };
    throw error;
  }
}
