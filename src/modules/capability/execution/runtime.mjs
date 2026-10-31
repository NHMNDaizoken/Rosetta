// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAuthorizer } from "../../../platform/auth/auth.mjs";
import { parseStrictJson } from "../compatibility/compatibility.mjs";
import { validatePayload } from "../registry/payload.mjs";
import { createProviderNetwork, ProviderNetworkError } from "./provider-network.mjs";
import { HttpError, json, readBody, requireWriter, uuidPattern } from "../../../platform/http/http.mjs";
import { createAuthenticationLeases, executionCommand, jsonDigest, prepareProviderTicket, recheckLease,
  redeemProviderTicket, reserveExecution, resolveExecution } from "./execution.mjs";

export const CAPABILITY_PROCESS_KEY = "rosetta_c4a_single";
export const CAPABILITY_TOPIC = "rosetta-c4a-invoke";
const engineId = /^[A-Za-z0-9:_-]{1,128}$/;
const activeStates = new Set(["accepted", "running", "auth_required"]);
const reference = e => ({ capabilityId: e.capability_id, version: e.version, manifestDigest: e.manifest_digest });
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export async function readExecutionJson(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 65536);
  try {
    const value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new HttpError(400, "invalid_json"); }
}

// One process owns its memory leases. Flowable is the only work queue/timer;
// these maps hold correlation and in-flight start promises, not a second queue.
export function createCapabilityRuntime(config, networkOptions, { workerEnabled = true } = {}) {
  const network = createProviderNetwork(networkOptions);
  const origins = new Set([...(networkOptions.origins ?? []), ...(networkOptions.testOrigins ?? [])]);
  if (!origins.size) throw new Error("Capability execution requires approved provider origins");
  const template = readFileSync(new URL("../../../../infra/flowable/capability-single.bpmn20.xml", import.meta.url));
  const templateDigest = sha(template);
  if (!config.dataUrl || !config.dataSecret || !config.identityUrl || !config.issuer || !config.clientSecret) throw new Error("Capability authority configuration is incomplete");
  const root = config.workflowUrl?.replace(/\/service\/?$/, "");
  if (!root || root === config.workflowUrl || !config.workflowPassword) throw new Error("Capability workflow configuration is incomplete");
  const workerId = `c4a-${randomUUID()}`;
  const leases = createAuthenticationLeases();
  const entries = new Map(), starts = new Map();
  const counters = { dispatched: 0, quarantined: 0 };
  let busy = false, closed = false, enabled = workerEnabled;

  async function engine(path, options = {}, deadlineAt) {
    if (!path.startsWith("/service/") && !path.startsWith("/external-job-api/")) throw new HttpError(503, "workflow_unavailable");
    const timeout = Math.min(5000, deadlineAt ? Date.parse(deadlineAt) - Date.now() : 5000);
    if (timeout <= 0) throw new HttpError(409, "execution_deadline_expired");
    try {
      const response = await fetch(root + path, { method: options.method ?? "GET", redirect: "error",
        headers: { Authorization: `Basic ${Buffer.from(`rosetta-engine:${config.workflowPassword}`).toString("base64")}`,
          ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
        body: options.body === undefined ? undefined : options.body instanceof FormData ? options.body : JSON.stringify(options.body),
        signal: AbortSignal.timeout(Math.max(1, timeout)) });
      if (!response.ok) throw new HttpError(response.status === 404 ? 404 : 503, "workflow_unavailable");
      const chunks = []; let size = 0;
      for await (const chunk of response.body) { size += chunk.length; if (size > 2097152) throw Error(); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      return options.raw ? bytes : bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "workflow_unavailable");
    }
  }

  async function checkDefinition(id, tenantId, deadlineAt) {
    if (!engineId.test(id)) throw new HttpError(503, "unapproved_workflow_definition");
    const definition = await engine(`/service/repository/process-definitions/${encodeURIComponent(id)}`, {}, deadlineAt);
    if (definition.id !== id || definition.key !== CAPABILITY_PROCESS_KEY || definition.tenantId !== tenantId || definition.suspended) throw new HttpError(503, "unapproved_workflow_definition");
    const bytes = await engine(`/service/repository/process-definitions/${encodeURIComponent(id)}/resourcedata`, { raw: true }, deadlineAt);
    if (sha(bytes) !== templateDigest) throw new HttpError(503, "unapproved_workflow_definition");
    return definition;
  }

  async function definitionFor(tenantId, deadlineAt) {
    const query = new URLSearchParams({ key: CAPABILITY_PROCESS_KEY, tenantId, latest: "true", size: "2" });
    let result = await engine(`/service/repository/process-definitions?${query}`, {}, deadlineAt);
    if (result.data.length > 1) throw new HttpError(503, "unapproved_workflow_definition");
    if (!result.data.length) {
      const form = new FormData(); form.append("file", new Blob([template], { type: "application/xml" }), "capability-single.bpmn20.xml");
      const deployment = await engine(`/service/repository/deployments?${new URLSearchParams({ tenantId })}`, { method: "POST", body: form }, deadlineAt);
      result = await engine(`/service/repository/process-definitions?${new URLSearchParams({ deploymentId: deployment.id, tenantId, size: "2" })}`, {}, deadlineAt);
    }
    if (result.data.length !== 1) throw new HttpError(503, "unapproved_workflow_definition");
    return checkDefinition(result.data[0].id, tenantId, deadlineAt);
  }

  async function owned(entry, callback) {
    return recheckLease(config, leases, entry.id, null, entry.reference, async (identity, proof) => {
      const { value: row } = await executionCommand(config, identity, "internal_get", { executionId: entry.id });
      return callback(row, identity, proof);
    });
  }

  async function reconcileBinding(row, identity, proof) {
    if (!row.engine_start_attempted_at || !row.engine_definition_id) throw new HttpError(409, "execution_pending_reconciliation");
    const query = new URLSearchParams({ businessKey: row.engine_business_key, tenantId: row.tenant_id, size: "2", includeProcessVariables: "true" });
    const runtime = await engine(`/service/runtime/process-instances?${query}`, {}, row.deadline_at);
    const history = await engine(`/service/history/historic-process-instances?${query}`, {}, row.deadline_at);
    const matches = new Map([...runtime.data, ...history.data].map(item => [item.id, item]));
    if (matches.size !== 1) throw new HttpError(409, "execution_pending_reconciliation");
    const process = [...matches.values()][0];
    if (process.tenantId !== row.tenant_id || process.businessKey !== row.engine_business_key || process.processDefinitionId !== row.engine_definition_id ||
      (row.engine_process_id && row.engine_process_id !== process.id)) throw new HttpError(409, "execution_pending_reconciliation");
    await checkDefinition(row.engine_definition_id, row.tenant_id, row.deadline_at);
    await executionCommand(config, identity, "engine_bind", { executionId: row.execution_id, definitionId: row.engine_definition_id, processId: process.id }, proof);
    return process;
  }

  async function ensureEngine(entry) {
    if (starts.has(entry.id)) return starts.get(entry.id);
    const pending = owned(entry, async (row, identity, proof) => {
      if (!activeStates.has(row.state)) return;
      if (row.engine_process_id) { await checkDefinition(row.engine_definition_id, row.tenant_id, row.deadline_at); return; }
      if (row.engine_start_attempted_at) { await reconcileBinding(row, identity, proof); return; }
      const definition = await definitionFor(row.tenant_id, row.deadline_at);
      await executionCommand(config, identity, "engine_reserve", { executionId: row.execution_id, definitionId: definition.id }, proof);
      const start = { processDefinitionId: definition.id, businessKey: row.engine_business_key, variables: [
        { name: "executionId", type: "string", value: row.execution_id },
        { name: "inputDigest", type: "string", value: row.input_digest },
        { name: "deadlineAt", type: "string", value: new Date(row.deadline_at).toISOString() },
      ] };
      try {
        const process = await engine("/service/runtime/process-instances", { method: "POST", body: start }, row.deadline_at);
        if (process.tenantId !== row.tenant_id || process.processDefinitionId !== definition.id || process.businessKey !== row.engine_business_key || !engineId.test(process.id)) throw Error();
        await executionCommand(config, identity, "engine_bind", { executionId: row.execution_id, definitionId: definition.id, processId: process.id }, proof);
      } catch {
        const { value: latest } = await executionCommand(config, identity, "internal_get", { executionId: row.execution_id });
        await reconcileBinding(latest, identity, proof);
      }
    });
    starts.set(entry.id, pending);
    try { return await pending; } finally { starts.delete(entry.id); }
  }

  async function finish(entry, state, error, output) {
    return leases.use(entry.id, null, async (original, authorization) => {
      const identity = await createAuthorizer(config)({ headers: { authorization } }, true);
      if (["tenantId", "issuer", "subject", "clientId"].some(key => identity[key] !== original[key])) throw new HttpError(403, "initiator_mismatch");
      return executionCommand(config, identity, "finish", { executionId: entry.id, state, ...(error ? { error } : {}), ...(state === "succeeded" ? { output } : {}) });
    });
  }

  async function quarantine(job) {
    counters.quarantined++;
    if (typeof job.id === "string" && engineId.test(job.id)) {
      await engine(`/external-job-api/acquire/jobs/${encodeURIComponent(job.id)}/fail`, { method: "POST",
        body: { workerId, retries: 0, errorMessage: "unrecognized_reservation" } }).catch(() => {});
    }
  }

  async function consume(job) {
    if (typeof job.id !== "string" || !engineId.test(job.id) || typeof job.processInstanceId !== "string" || !engineId.test(job.processInstanceId)) return quarantine(job);
    let process;
    try { process = await engine(`/service/runtime/process-instances/${encodeURIComponent(job.processInstanceId)}`); }
    catch { return quarantine(job); }
    const match = /^c4a:([a-z][a-z0-9-]{0,62}):([0-9a-f-]{36})$/.exec(process.businessKey ?? "");
    const entry = match && entries.get(match[2]);
    if (!entry || !uuidPattern.test(match[2]) || job.tenantId !== match[1] || process.tenantId !== match[1]) return quarantine(job);
    let possibleReceipt = false;
    try {
      await owned(entry, async (row, identity, proof) => {
        if (row.tenant_id !== process.tenantId || row.engine_business_key !== process.businessKey || row.engine_definition_id !== process.processDefinitionId ||
          (row.engine_process_id && row.engine_process_id !== job.processInstanceId) ||
          (job.processDefinitionId && job.processDefinitionId !== row.engine_definition_id) ||
          (job.topic && job.topic !== CAPABILITY_TOPIC) || (job.elementId && job.elementId !== "invoke")) throw new HttpError(403, "job_correlation_failed");
        if (!row.engine_process_id) process = await reconcileBinding(row, identity, proof);
        if (row.state !== "accepted" || row.attempt !== 0) throw new HttpError(409, "dispatch_not_available");
        await checkDefinition(row.engine_definition_id, row.tenant_id, row.deadline_at);
        const variables = await engine(`/service/runtime/process-instances/${encodeURIComponent(process.id)}/variables`, {}, row.deadline_at);
        if (!Array.isArray(variables) || variables.find(v => v.name === "executionId")?.value !== row.execution_id ||
          variables.find(v => v.name === "inputDigest")?.value !== row.input_digest ||
          Date.parse(variables.find(v => v.name === "deadlineAt")?.value) !== Date.parse(row.deadline_at)) throw new HttpError(403, "job_correlation_failed");
        const { value: resolved } = await executionCommand(config, identity, "resolve", entry.reference);
        if (!origins.has(resolved.providerOrigin) || jsonDigest(row.input) !== row.input_digest || validatePayload(resolved.manifest.inputSchema, row.input).length) throw new HttpError(422, "invalid_execution_input");
        const { ticket } = await prepareProviderTicket(config, leases, row, { definitionId: row.engine_definition_id, processId: process.id, jobId: job.id });
        const timeoutMs = Math.floor(Date.parse(row.deadline_at) - Date.now());
        if (timeoutMs < 100) throw new HttpError(409, "execution_deadline_expired");
        let result;
        try {
          result = await network.postJson(resolved.providerOrigin, resolved.manifest.invocation.path,
            { invocationId: row.execution_id, capability: entry.reference, input: row.input },
            { ticket, operationId: row.operation_id, timeoutMs, beforeConnect: async () => {
              if (closed) throw new HttpError(409, "auth_required");
              await recheckLease(config, leases, entry.id, null, entry.reference, async (current, currentProof) => {
                if (closed || !leases.has(entry.id)) throw new HttpError(409, "auth_required");
                await executionCommand(config, current, "dispatch", { executionId: entry.id, jobId: job.id }, currentProof);
              });
              if (closed || !leases.has(entry.id)) throw new HttpError(409, "auth_required");
              counters.dispatched++;
            } });
          possibleReceipt = true;
        } catch (error) {
          possibleReceipt = error instanceof ProviderNetworkError && error.mayHaveBeenSent === true;
          throw error;
        }
        if (result.status !== 200) throw new HttpError(502, "provider_failed");
        let response;
        try { response = parseStrictJson(result.body); } catch { throw new HttpError(502, "invalid_execution_output"); }
        if (!response || typeof response !== "object" || Array.isArray(response) || Object.keys(response).join(",") !== "output" ||
          validatePayload(resolved.manifest.outputSchema, response.output).length) throw new HttpError(502, "invalid_execution_output");
        await finish(entry, "succeeded", null, response.output);
      });
    } catch (error) {
      if (error instanceof HttpError && error.message === "job_correlation_failed") return quarantine(job);
      const code = error instanceof HttpError ? error.message : error instanceof ProviderNetworkError ? `provider_${error.code}` : "execution_failed";
      const knownFailure = ["invalid_execution_output", "provider_authorization_required", "provider_failed"].includes(code);
      const state = possibleReceipt && !knownFailure ? "outcome_unknown" : code === "auth_required" ? "auth_required"
        : code === "execution_deadline_expired" ? "timed_out" : "failed";
      await finish(entry, state, /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "execution_failed").catch(() => {});
    }
    await engine(`/external-job-api/acquire/jobs/${encodeURIComponent(job.id)}/complete`, { method: "POST", body: { workerId, variables: [] } }).catch(() => {});
    entries.delete(entry.id); leases.delete(entry.id);
  }

  async function poll() {
    if (busy || closed || !enabled) return;
    busy = true;
    try {
      const jobs = await engine("/external-job-api/acquire/jobs", { method: "POST", body: {
        topic: CAPABILITY_TOPIC, workerId, lockDuration: "PT30S", numberOfTasks: 1, scopeType: "bpmn",
      } });
      if (!Array.isArray(jobs) || jobs.length > 1) throw new HttpError(503, "workflow_unavailable");
      if (jobs.length) await consume(jobs[0]);
    } finally { busy = false; }
  }
  const timer = setInterval(() => {
    for (const id of entries.keys()) if (!leases.has(id)) entries.delete(id);
    if (entries.size) void poll().catch(() => {});
  }, 100);
  timer.unref();

  async function status(identity, executionId) {
    const { value: row } = await executionCommand(config, identity, "internal_get", { executionId });
    if (activeStates.has(row.state) && (Date.parse(row.deadline_at) <= Date.now() || !leases.has(executionId))) {
      const next = Date.parse(row.deadline_at) <= Date.now() ? "timed_out" : "auth_required";
      await executionCommand(config, identity, "finish", { executionId, state: next, error: next === "auth_required" ? "lease_lost" : "execution_deadline_expired" });
      entries.delete(executionId); leases.delete(executionId);
    }
    return (await executionCommand(config, identity, "get", { executionId })).value;
  }

  return Object.freeze({
    async handle(request, response, identity, url) {
      if (closed) throw new HttpError(503, "executions_unavailable");
      if (url.search) throw new HttpError(400, "invalid_query");
      if (url.pathname === "/v1/capability-authorizations/introspect") {
        if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
        const body = await readExecutionJson(request);
        if (Object.keys(body).sort().join(",") !== "inputDigest,invocationId,ticket") throw new HttpError(400, "invalid_authorization_request");
        return json(response, 200, await redeemProviderTicket(config, identity, body, leases));
      }
      if (url.pathname === "/v1/capability-executions") {
        if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
        requireWriter(identity);
        const body = await readExecutionJson(request);
        const resolved = await resolveExecution(config, identity, body);
        if (!origins.has(resolved.providerOrigin)) throw new HttpError(503, "provider_origin_not_approved");
        const result = await reserveExecution(config, identity, request, body, leases, resolved);
        if (closed) { leases.delete(result.value.executionId); throw new HttpError(503, "executions_unavailable"); }
        response.setHeader("Location", `/v1/capability-executions/${result.value.executionId}`);
        if (result.value.state === "accepted") {
          const entry = { id: result.value.executionId, reference: body.target.capability };
          entries.set(entry.id, entry);
          await ensureEngine(entry);
        }
        return json(response, result.status, result.value);
      }
      const match = /^\/v1\/capability-executions\/([0-9a-f-]{36})$/.exec(url.pathname);
      if (!match || !uuidPattern.test(match[1])) throw new HttpError(404, "not_found");
      if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
      const value = await status(identity, match[1]);
      response.setHeader("ETag", `"capability-execution-${value.executionId}-${value.revision}"`);
      return json(response, 200, value);
    },
    poll,
    setWorkerEnabled(value) { enabled = value === true; },
    stats() { return { ...counters, active: entries.size, busy }; },
    close() { closed = true; enabled = false; clearInterval(timer); entries.clear(); starts.clear(); leases.clear(); },
  });
}
