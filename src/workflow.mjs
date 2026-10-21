// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash } from "node:crypto";
import { dataRequest } from "./data.mjs";
import { HttpError, json, readJson, requireWriter, uuidPattern } from "./http.mjs";
import { workflowRequest } from "./workflow-client.mjs";

const engineId = /^[A-Za-z0-9:_-]{1,128}$/;

export function canonicalInput(value, depth = 0) {
  if (depth > 32) throw new HttpError(400, "input_too_deep");
  if (Array.isArray(value)) return value.map((item) => canonicalInput(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalInput(value[key], depth + 1)]));
  return value;
}

async function history(config, tenantId, query) {
  return workflowRequest(config, `history/historic-process-instances?${new URLSearchParams({ ...query, tenantId, includeProcessVariables: "true", size: "2" })}`);
}

async function execution(config, tenantId, id) {
  const result = await history(config, tenantId, { processInstanceId: id });
  const item = result.data[0];
  if (!item || item.tenantId !== tenantId || item.id !== id) throw new HttpError(404, "not_found");
  const input = item.variables?.find((variable) => variable.name === "input")?.value;
  return { id: item.id, definitionId: item.processDefinitionId,
    status: item.endTime ? (item.deleteReason ? "cancelled" : "completed") : "running",
    input: input ? JSON.parse(input) : {} };
}

async function start(request, identity, config) {
  requireWriter(identity);
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || !uuidPattern.test(key)) throw new HttpError(400, "uuid_idempotency_key_required");
  const body = await readJson(request);
  if (Object.keys(body).some((name) => !["definitionId", "input"].includes(name)) ||
      typeof body.definitionId !== "string" || !engineId.test(body.definitionId) ||
      (body.input !== undefined && (!body.input || typeof body.input !== "object" || Array.isArray(body.input)))) {
    throw new HttpError(400, "invalid_workflow_request");
  }
  const input = canonicalInput(body.input ?? {});
  const definition = await workflowRequest(config, `repository/process-definitions/${encodeURIComponent(body.definitionId)}`);
  if (definition.tenantId !== identity.tenantId) throw new HttpError(404, "not_found");
  const hash = createHash("sha256").update(JSON.stringify({ definitionId: body.definitionId, input })).digest("hex");
  const query = new URLSearchParams({ key: `eq.${key}` });
  const ledger = (options) => dataRequest(config, identity.tenantId, query, options, "workflow_requests");
  let reserved = false;
  let row;
  try {
    [row] = await ledger({ method: "POST", body: JSON.stringify({ key, definition_id: body.definitionId, input_hash: hash }) });
    reserved = true;
  } catch (error) {
    if (error.status !== 409) throw error;
    [row] = await ledger();
  }
  if (!row || row.definition_id !== body.definitionId || row.input_hash !== hash) throw new HttpError(409, "idempotency_conflict");
  if (row.engine_id) return { created: false, value: await execution(config, identity.tenantId, row.engine_id) };
  const businessKey = `${identity.tenantId}:${key}`;
  let id;
  if (reserved) {
    const result = await workflowRequest(config, "runtime/process-instances", { method: "POST", body: JSON.stringify({
      // Flowable derives the tenant from this already-authorized definition ID.
      processDefinitionId: body.definitionId, businessKey,
      variables: [{ name: "input", type: "string", value: JSON.stringify(input) }],
    }) });
    id = result.id;
  } else {
    const prior = await history(config, identity.tenantId, { businessKey });
    if (prior.data.length !== 1) throw new HttpError(409, "execution_pending_reconciliation");
    id = prior.data[0].id;
  }
  await ledger({ method: "PATCH", body: JSON.stringify({ engine_id: id }) });
  return { created: reserved, value: await execution(config, identity.tenantId, id) };
}

export async function handleWorkflow(request, response, identity, config, url) {
  if (url.search) throw new HttpError(400, "invalid_query");
  if (url.pathname === "/v1/workflows/definitions" && request.method === "GET") {
    const result = await workflowRequest(config, `repository/process-definitions?${new URLSearchParams({ tenantId: identity.tenantId, latest: "true", size: "100" })}`);
    return json(response, 200, { items: result.data.map(({ id, key, version, name }) => ({ id, key, version, name })) });
  }
  if (url.pathname === "/v1/workflows/executions" && request.method === "POST") {
    const result = await start(request, identity, config);
    return json(response, result.created ? 201 : 200, result.value);
  }
  const match = url.pathname.match(/^\/v1\/workflows\/executions\/([^/]+)(\/complete)?$/);
  if (!match) throw new HttpError(404, "not_found");
  let id;
  try { id = decodeURIComponent(match[1]); } catch { throw new HttpError(400, "invalid_execution_id"); }
  if (!engineId.test(id)) throw new HttpError(400, "invalid_execution_id");
  const current = await execution(config, identity.tenantId, id);
  if (request.method === "GET" && !match[2]) return json(response, 200, current);
  requireWriter(identity);
  if (request.method === "POST" && match[2]) {
    if (Object.keys(await readJson(request)).length) throw new HttpError(400, "empty_object_required");
    if (current.status === "cancelled") throw new HttpError(409, "already_cancelled");
    if (current.status === "running") {
      const tasks = await workflowRequest(config, `runtime/tasks?${new URLSearchParams({ processInstanceId: id, tenantId: identity.tenantId, size: "2" })}`);
      if (tasks.data.length !== 1) throw new HttpError(409, "workflow_conflict");
      await workflowRequest(config, `runtime/tasks/${encodeURIComponent(tasks.data[0].id)}`, { method: "POST", body: JSON.stringify({ action: "complete" }) });
    }
    return json(response, 200, await execution(config, identity.tenantId, id));
  }
  if (request.method === "DELETE" && !match[2]) {
    if (current.status === "completed") throw new HttpError(409, "already_completed");
    if (current.status === "running") await workflowRequest(config, `runtime/process-instances/${encodeURIComponent(id)}?deleteReason=cancelled`, { method: "DELETE" });
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Allow", match[2] ? "POST" : "GET, DELETE");
  throw new HttpError(405, "method_not_allowed");
}
