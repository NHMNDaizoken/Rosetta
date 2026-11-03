// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// C4B worker. Flowable owns scheduling, locks, timers and history. This module
// acquires one job, authorizes exactly one step, calls one provider and records
// the result. It does not implement a queue, timer or retry loop of its own.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { HttpError, json, requireWriter, uuidPattern } from "../../../platform/http/http.mjs";
import { parseStrictJson } from "../compatibility/compatibility.mjs";
import { createAuthenticationLeases, jsonDigest, ticketDigest } from "../execution/execution.mjs";
import { createProviderNetwork, ProviderNetworkError } from "../execution/provider-network.mjs";
import { validatePayload } from "../registry/payload.mjs";
import { COMPOSITION_PROCESS_KEY, COMPOSITION_TOPIC, compositionBpmn } from "./bpmn.mjs";
import { compositionExecutionCommand, recheckCompositionLease, redeemCompositionTicket, reserveCompositionExecution,
  resolveCompositionExecution } from "./execution.mjs";

const engineId = /^[A-Za-z0-9:_-]{1,128}$/;
const activeStates = new Set(["accepted", "running", "auth_required"]);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");

export function createCompositionRuntime(config, networkOptions, { workerEnabled = true } = {}) {
  if (!config.dataUrl || !config.dataSecret || !config.identityUrl || !config.issuer || !config.clientSecret) {
    throw new Error("Composition authority configuration is incomplete");
  }
  const root = config.workflowUrl?.replace(/\/service\/?$/, "");
  if (!root || root === config.workflowUrl || !config.workflowPassword) throw new Error("Composition workflow configuration is incomplete");
  const network = createProviderNetwork(networkOptions);
  const origins = new Set([...(networkOptions.origins ?? []), ...(networkOptions.testOrigins ?? [])]);
  if (!origins.size) throw new Error("Composition execution requires approved provider origins");
  const workerId = `c4b-${randomUUID()}`;
  const leases = createAuthenticationLeases();
  const entries = new Map(), starts = new Map(), templates = new Map();
  const counters = { dispatched: 0, quarantined: 0, engineErrors: 0, persistenceErrors: 0 };
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
      for await (const chunk of response.body ?? []) { size += chunk.length; if (size > 2097152) throw Error(); chunks.push(chunk); }
      const bytes = Buffer.concat(chunks);
      return options.raw ? bytes : bytes.length ? JSON.parse(bytes.toString("utf8")) : null;
    } catch (error) {
      if (error instanceof HttpError) throw error;
      throw new HttpError(503, "workflow_unavailable");
    }
  }

  function templateFor(stepIds) {
    const key = stepIds.join("|");
    if (!templates.has(key)) templates.set(key, { bytes: Buffer.from(compositionBpmn(stepIds)) });
    const template = templates.get(key);
    template.digest ??= sha(template.bytes);
    return template;
  }

  async function definitionFor(tenantId, stepIds, deadlineAt) {
    const template = templateFor(stepIds);
    const query = new URLSearchParams({ key: COMPOSITION_PROCESS_KEY, tenantId, size: "8", sort: "version", order: "desc" });
    const result = await engine(`/service/repository/process-definitions?${query}`, {}, deadlineAt);
    for (const candidate of result.data ?? []) {
      if (candidate.key !== COMPOSITION_PROCESS_KEY || candidate.tenantId !== tenantId || candidate.suspended) continue;
      const bytes = await engine(`/service/repository/process-definitions/${encodeURIComponent(candidate.id)}/resourcedata`, { raw: true }, deadlineAt);
      if (sha(bytes) === template.digest) return candidate;
    }
    const form = new FormData();
    form.append("file", new Blob([template.bytes], { type: "application/xml" }), `${COMPOSITION_PROCESS_KEY}.bpmn20.xml`);
    const deployment = await engine(`/service/repository/deployments?${new URLSearchParams({ tenantId })}`, { method: "POST", body: form }, deadlineAt);
    const deployed = await engine(`/service/repository/process-definitions?${new URLSearchParams({ deploymentId: deployment.id, tenantId, size: "8" })}`, {}, deadlineAt);
    const created = (deployed.data ?? []).filter(item => item.key === COMPOSITION_PROCESS_KEY && !item.suspended);
    if (created.length !== 1) throw new HttpError(503, "unapproved_workflow_definition");
    return created[0];
  }

  const command = (entry, operation, payload) => compositionExecutionCommand(config, entry.identity, operation, payload);
  const proofCommand = (entry, operation, payload) => recheckCompositionLease(config, leases, entry.id, null,
    (identity, proof) => compositionExecutionCommand(config, identity, operation, payload, proof));

  async function ensureEngine(entry) {
    if (starts.has(entry.id)) return starts.get(entry.id);
    const pending = (async () => {
      let { value: row } = await command(entry, "internal_get", { executionId: entry.id });
      if (row.state !== "accepted" || row.engine_process_id) return;
      if (row.engine_start_attempted_at) {
        const process = await reconcile(row);
        return proofCommand(entry, "engine_bind", { executionId: row.execution_id, definitionId: row.engine_definition_id, processId: process.id });
      }
      const definition = await definitionFor(row.tenant_id, entry.steps.map(step => step.stepId), row.deadline_at);
      await proofCommand(entry, "engine_reserve", { executionId: row.execution_id, definitionId: definition.id });
      const start = { processDefinitionId: definition.id, businessKey: row.engine_business_key, variables: [
        { name: "executionId", type: "string", value: row.execution_id },
        { name: "inputDigest", type: "string", value: row.input_digest },
        { name: "deadlineAt", type: "string", value: new Date(row.deadline_at).toISOString() },
      ] };
      try {
        const process = await engine("/service/runtime/process-instances", { method: "POST", body: start }, row.deadline_at);
        if (process.tenantId !== row.tenant_id || process.processDefinitionId !== definition.id ||
          process.businessKey !== row.engine_business_key || !engineId.test(process.id)) throw Error();
        await proofCommand(entry, "engine_bind", { executionId: row.execution_id, definitionId: definition.id, processId: process.id });
      } catch {
        ({ value: row } = await command(entry, "internal_get", { executionId: entry.id }));
        const process = await reconcile(row);
        await proofCommand(entry, "engine_bind", { executionId: row.execution_id, definitionId: definition.id, processId: process.id });
      }
    })();
    starts.set(entry.id, pending);
    try { return await pending; } finally { starts.delete(entry.id); }
  }

  async function reconcile(row) {
    if (!row.engine_start_attempted_at || !row.engine_definition_id) throw new HttpError(409, "execution_pending_reconciliation");
    const query = new URLSearchParams({ businessKey: row.engine_business_key, tenantId: row.tenant_id, size: "2" });
    const runtime = await engine(`/service/runtime/process-instances?${query}`);
    const history = await engine(`/service/history/historic-process-instances?${query}`);
    if (!Array.isArray(runtime.data) || !Array.isArray(history.data) || runtime.total > 1 || history.total > 1) {
      throw new HttpError(409, "execution_pending_reconciliation");
    }
    const matches = new Map([...runtime.data, ...history.data].map(item => [item.id, item]));
    if (matches.size !== 1) throw new HttpError(409, "execution_pending_reconciliation");
    const process = [...matches.values()][0];
    if (process.tenantId !== row.tenant_id || process.businessKey !== row.engine_business_key ||
      process.processDefinitionId !== row.engine_definition_id) throw new HttpError(409, "execution_pending_reconciliation");
    return process;
  }

  async function stopProcess(row) {
    if (row.engine_start_attempted_at && !row.engine_process_id) {
      const process = await reconcile(row);
      row = { ...row, engine_process_id: process.id };
    }
    if (!row.engine_process_id) return;
    try {
      await engine(`/service/runtime/process-instances/${encodeURIComponent(row.engine_process_id)}`, { method: "DELETE" });
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 404) throw error;
      const history = await engine(`/service/history/historic-process-instances/${encodeURIComponent(row.engine_process_id)}`);
      if (!history.endTime) throw new HttpError(503, "workflow_termination_unconfirmed");
    }
  }

  async function observe(identity, executionId) {
    const { value: row } = await compositionExecutionCommand(config, identity, "observe", {
      executionId, leasePresent: leases.has(executionId) });
    if (row.state !== "accepted" && row.state !== "running") {
      entries.delete(executionId); leases.delete(executionId);
      if (row.state !== "succeeded") {
        try { await stopProcess(row); }
        catch { counters.engineErrors++; throw new HttpError(503, "workflow_termination_unconfirmed"); }
      }
    }
    return row;
  }

  async function quarantine(job) {
    counters.quarantined++;
    if (typeof job.id === "string" && engineId.test(job.id)) {
      await engine(`/external-job-api/acquire/jobs/${encodeURIComponent(job.id)}/fail`, { method: "POST",
        body: { workerId, retries: 0, errorMessage: "unrecognized_reservation" } }).catch(() => { counters.engineErrors++; });
    }
  }

  async function consume(job) {
    const element = /^step_(\d{1,2})$/.exec(job.elementId ?? "");
    if (typeof job.id !== "string" || !engineId.test(job.id) || !engineId.test(job.processInstanceId ?? "") ||
      !element || (job.topic && job.topic !== COMPOSITION_TOPIC)) return quarantine(job);
    const stepIndex = Number(element[1]);
    let process;
    try { process = await engine(`/service/runtime/process-instances/${encodeURIComponent(job.processInstanceId)}`); }
    catch { return quarantine(job); }
    const match = /^c4b:([a-z][a-z0-9-]{0,62}):([0-9a-f-]{36})$/.exec(process.businessKey ?? "");
    const entry = match && entries.get(match[2]);
    if (!entry || !uuidPattern.test(match[2]) || job.tenantId !== match[1] || process.tenantId !== match[1]) return quarantine(job);
    const step = entry.steps[stepIndex];
    let possibleReceipt = false;
    try {
      if (starts.has(entry.id)) await starts.get(entry.id);
      const row = await observe(entry.identity, entry.id);
      if (!step || row.tenant_id !== process.tenantId || row.engine_business_key !== process.businessKey ||
        row.engine_definition_id !== process.processDefinitionId ||
        (row.engine_process_id && row.engine_process_id !== process.id) ||
        (job.processDefinitionId && job.processDefinitionId !== row.engine_definition_id) || row.current_step !== stepIndex) {
        throw new HttpError(403, "job_correlation_failed");
      }
      const definitionBytes = await engine(`/service/repository/process-definitions/${encodeURIComponent(row.engine_definition_id)}/resourcedata`, { raw: true });
      if (sha(definitionBytes) !== templateFor(entry.steps.map(item => item.stepId)).digest) throw new HttpError(403, "job_correlation_failed");
      const variables = await engine(`/service/runtime/process-instances/${encodeURIComponent(process.id)}/variables`);
      if (variables.find(item => item.name === "executionId")?.value !== row.execution_id ||
        variables.find(item => item.name === "inputDigest")?.value !== row.input_digest ||
        Date.parse(variables.find(item => item.name === "deadlineAt")?.value) !== Date.parse(row.deadline_at)) {
        throw new HttpError(403, "job_correlation_failed");
      }
      const ticket = randomBytes(32).toString("base64url");
      const expires = new Date(Math.min(Date.now() + 30000, Date.parse(row.deadline_at), Date.parse(entry.expiresAt))).toISOString();
      const prepared = (await proofCommand(entry, "prepare", { executionId: entry.id, stepIndex,
        definitionId: row.engine_definition_id, processId: process.id, jobId: job.id,
        ticketHash: ticketDigest(ticket), ticketExpiresAt: expires, capability: step.capability })).value;
      if (!prepared || prepared.stepIndex !== stepIndex) throw new HttpError(409, "dispatch_not_available");
      if (!origins.has(step.providerOrigin)) throw new HttpError(503, "provider_origin_not_approved");
      if (validatePayload(step.inputSchema, prepared.input).length) throw new HttpError(422, "invalid_execution_input");
      const timeoutMs = Math.floor(Math.min(step.timeoutMs, Date.parse(row.deadline_at) - Date.now(), Date.parse(entry.expiresAt) - Date.now()));
      if (timeoutMs < 100) throw new HttpError(409, "execution_deadline_expired");
      let result;
      try {
        result = await network.postJson(step.providerOrigin, step.invocationPath,
          { invocationId: row.execution_id, capability: step.capability, input: prepared.input },
          { ticket, operationId: prepared.operationId, timeoutMs, beforeConnect: async () => {
            if (closed || !leases.has(entry.id)) throw new HttpError(409, "auth_required");
            await proofCommand(entry, "dispatch", { executionId: entry.id, stepIndex });
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
        validatePayload(step.outputSchema, response.output).length) throw new HttpError(502, "invalid_execution_output");
      if (stepIndex === entry.steps.length - 1 && validatePayload(entry.outputSchema, response.output).length) throw new HttpError(502, "invalid_execution_output");
      await proofCommand(entry, "step_output", { executionId: entry.id, stepIndex, output: response.output, outputDigest: jsonDigest(response.output) });
      await engine(`/external-job-api/acquire/jobs/${encodeURIComponent(job.id)}/complete`, { method: "POST", body: { workerId, variables: [] } });
      if (stepIndex === entry.steps.length - 1) {
        let history;
        const confirmationDeadline = Math.min(Date.now() + 5000, Date.parse(row.deadline_at));
        do {
          history = await engine(`/service/history/historic-process-instances/${encodeURIComponent(process.id)}`);
          if (history.endTime) break;
          await new Promise(resolve => setTimeout(resolve, 100));
        } while (Date.now() < confirmationDeadline);
        if (!history.endTime || history.deleteReason || history.tenantId !== row.tenant_id || history.processDefinitionId !== row.engine_definition_id ||
          history.businessKey !== row.engine_business_key) throw new HttpError(503, "workflow_completion_unconfirmed");
        await proofCommand(entry, "engine_completed", { executionId: entry.id, processId: process.id });
      }
      const { value: latest } = await command(entry, "internal_get", { executionId: entry.id });
      if (!activeStates.has(latest.state)) { entries.delete(entry.id); leases.delete(entry.id); }
    } catch (error) {
      if (error instanceof HttpError && error.message === "job_correlation_failed") return quarantine(job);
      const code = error instanceof HttpError ? error.message : error instanceof ProviderNetworkError ? `provider_${error.code}` : "execution_failed";
      const knownFailure = ["invalid_execution_output", "provider_authorization_required", "provider_failed"].includes(code);
      const state = possibleReceipt && !knownFailure ? "outcome_unknown" : code === "auth_required" ? "auth_required"
        : code === "execution_deadline_expired" ? "timed_out" : "failed";
      try {
        await command(entry, "step_fail", { executionId: entry.id, stepIndex, state,
          error: /^[a-z][a-z0-9_]{0,63}$/.test(code) ? code : "execution_failed" });
      } catch { counters.persistenceErrors++; }
      await engine(`/external-job-api/acquire/jobs/${encodeURIComponent(job.id)}/fail`, { method: "POST",
        body: { workerId, retries: 0, errorMessage: code.slice(0, 80) } }).catch(() => { counters.engineErrors++; });
      leases.delete(entry.id);
      await observe(entry.identity, entry.id).catch(() => { counters.persistenceErrors++; });
    }
  }

  async function poll() {
    if (busy || closed || !enabled) return;
    busy = true;
    try {
      for (const entry of entries.values()) await observe(entry.identity, entry.id);
      const jobs = await engine("/external-job-api/acquire/jobs", { method: "POST", body: {
        topic: COMPOSITION_TOPIC, workerId, lockDuration: "PT30S", numberOfTasks: 1, scopeType: "bpmn",
      } });
      if (!Array.isArray(jobs) || jobs.length > 1) throw new HttpError(503, "workflow_unavailable");
      if (jobs.length) await consume(jobs[0]);
    } finally { busy = false; }
  }
  const timer = setInterval(() => {
    if (entries.size) void poll().catch(() => { counters.engineErrors++; });
  }, 100);
  timer.unref();

  return Object.freeze({
    async submit(request, response, identity, body) {
      if (closed) throw new HttpError(503, "executions_unavailable");
      if (!body || body.target?.kind !== "composition") return false;
      requireWriter(identity);
      if (new URL(request.url, "http://core").search) throw new HttpError(400, "invalid_query");
      const resolved = await resolveCompositionExecution(config, identity, body);
      if (resolved.steps.some(step => !origins.has(step.providerOrigin))) throw new HttpError(503, "provider_origin_not_approved");
      const result = await reserveCompositionExecution(config, identity, request, body, leases, resolved);
      response.setHeader("Location", `/v1/capability-executions/${result.value.executionId}`);
      if (result.status === 202 && result.value.state === "accepted") {
        const entry = { id: result.value.executionId, identity: { ...identity },
          expiresAt: new Date(Math.min(identity.credentialExpiresAt, Date.parse(resolved.authorityExpiresAt))).toISOString(),
          outputSchema: resolved.composition.outputSchema,
          steps: resolved.steps.map((step, index) => ({ stepId: step.stepId, stepIndex: index, timeoutMs: step.timeoutMs,
            capability: step.capability, providerOrigin: step.providerOrigin, invocationPath: step.invocationPath,
            inputSchema: step.inputSchema, outputSchema: step.outputSchema })) };
        entries.set(entry.id, entry);
        await ensureEngine(entry);
      }
      return { status: result.status, value: result.value };
    },
    async get(request, response, identity, executionId) {
      await observe(identity, executionId);
      const { value } = await compositionExecutionCommand(config, identity, "get", { executionId });
      response.setHeader("ETag", `"composition-execution-${value.executionId}-${value.revision}"`);
      return json(response, 200, value);
    },
    async introspect(identity, body) {
      return redeemCompositionTicket(config, identity, body, leases);
    },
    poll,
    setWorkerEnabled(value) { enabled = value === true; },
    stats() { return { ...counters, active: entries.size, busy }; },
    close() { closed = true; enabled = false; clearInterval(timer); entries.clear(); starts.clear(); leases.clear(); },
  });
}
