// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Bounded composition registry HTTP adapter. Structural validation and schema
// compatibility are local; authority, approvals and state remain in SQL.
import { applicationToken } from "../../applications/applications.mjs";
import { HttpError, json, readBody, readFlatJsonObject, uuidPattern } from "../../../platform/http/http.mjs";
import { parseStrictJson } from "../compatibility/compatibility.mjs";
import { validateComposition, compositionCompatibility } from "./plan.mjs";

const PATH = /^\/v1\/compositions(?:\/([^/]+)\/versions(?:\/([^/]+)(?:\/(validate|publish|deprecate|revoke))?)?)?$/;
const VERSION = /^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$/;

export async function compositionCommand(config, identity, operation, payload) {
  let result;
  try {
    const response = await fetch(`${config.dataUrl}/rpc/composition_command`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "junctura_composition_api")}`,
        "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw Error();
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.length; if (size > 2097152) throw Error(); chunks.push(chunk); }
    result = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)));
    if (!result || !Number.isInteger(result.status) || (result.error && !/^[a-z][a-z0-9_]{0,79}$/.test(result.error))) throw Error();
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof TypeError) throw new HttpError(503, "compositions_unavailable");
    throw new HttpError(503, "compositions_unavailable");
  }
  if (result.error) {
    const details = result.error === "invalid_composition" ? { issues: result.issues ?? [] } : undefined;
    throw new HttpError(result.status, result.error, details);
  }
  return result;
}

async function readComposition(request, expectedVersion) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 65536);
  let value;
  try { value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, "invalid_json"); }
  const { issues, digest } = validateComposition(value, { expectedVersion });
  if (issues.length) throw new HttpError(422, "invalid_composition", { issues });
  return { composition: value, digest };
}

// Fetches the pinned schemas from the registered capability versions and runs
// the C3 producer->consumer check. This is structural evidence, not authority.
async function schemaIssues(config, identity, composition) {
  const result = await compositionCommand(config, identity, "schemas", { composition });
  const steps = result.value?.steps ?? [];
  return compositionCompatibility(composition, steps);
}

export async function handleCompositions(request, response, identity, config, url) {
  if (!config.dataUrl) throw new HttpError(503, "compositions_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  const match = url.pathname.match(PATH);
  if (!match) throw new HttpError(404, "not_found");
  if (url.search) throw new HttpError(400, "invalid_query");
  const [, compositionId, version, action] = match;
  if (compositionId !== undefined && !uuidPattern.test(compositionId)) throw new HttpError(400, "invalid_composition_path");
  if (version !== undefined && !VERSION.test(version)) throw new HttpError(400, "invalid_composition_path");

  if (!compositionId) {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { composition, digest } = await readComposition(request);
    const result = await compositionCommand(config, identity, "register", { composition, digest });
    response.setHeader("ETag", `"composition-version-${result.value.versionId}-${result.value.revision}"`);
    response.setHeader("Location", `/v1/compositions/${result.value.compositionId}/versions/${encodeURIComponent(composition.version)}`);
    return json(response, 201, result.value);
  }

  if (version === undefined) {
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const { composition, digest } = await readComposition(request);
    const result = await compositionCommand(config, identity, "register", { compositionId, composition, digest });
    response.setHeader("ETag", `"composition-version-${result.value.versionId}-${result.value.revision}"`);
    response.setHeader("Location", `/v1/compositions/${compositionId}/versions/${encodeURIComponent(composition.version)}`);
    return json(response, 201, result.value);
  }

  if (!action) {
    if (request.method === "GET") {
      const result = await compositionCommand(config, identity, "get", { compositionId, version });
      return versioned(response, result.value);
    }
    if (request.method === "PUT") {
      const { composition, digest } = await readComposition(request, version);
      const result = await compositionCommand(config, identity, "update", { compositionId, version, composition, digest,
        etag: request.headers["if-match"] });
      return versioned(response, result.value);
    }
    throw new HttpError(405, "method_not_allowed");
  }
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");

  const body = await readFlatJsonObject(request);
  const payload = { compositionId, version, ...body };
  if (request.headers["if-match"] !== undefined) payload.etag = request.headers["if-match"];

  if (action === "validate") {
    if (Object.keys(body).length) throw new HttpError(400, "invalid_validation_body");
    if (request.headers["if-match"] === undefined) throw new HttpError(428, "if_match_required");
    const current = (await compositionCommand(config, identity, "get", { compositionId, version })).value;
    const { issues, digest } = validateComposition(current.composition, { expectedVersion: version });
    if (issues.length) throw new HttpError(409, "invalid_stored_composition", { issues });
    if (digest !== current.digest) throw new HttpError(409, "composition_digest_mismatch");
    if (request.headers["if-match"] !== undefined && request.headers["if-match"] !== `"composition-version-${current.versionId}-${current.revision}"`) {
      throw new HttpError(412, "revision_mismatch");
    }
    let schemaProblems = [];
    try { schemaProblems = await schemaIssues(config, identity, current.composition); }
    catch (error) {
      if (!(error instanceof HttpError) || error.status !== 422) throw error;
      schemaProblems = [{ path: "/", code: "step_capability_unavailable", message: "A pinned step capability is not published or visible." }];
    }
    const report = [...issues, ...schemaProblems];
    const result = await compositionCommand(config, identity, "validate", { compositionId, version,
      etag: `"composition-version-${current.versionId}-${current.revision}"`,
      validationStatus: report.length ? "invalid" : "valid",
      validationReport: { status: report.length ? "invalid" : "valid", digest: current.digest, revision: current.revision, issues: report } });
    return versioned(response, result.value);
  }
  if (action === "publish" && (Object.keys(body).length !== 1 || !uuidPattern.test(body.approvalId ?? ""))) {
    throw new HttpError(400, "invalid_approval");
  }
  if (["deprecate", "revoke"].includes(action)) validateReason(body);
  const result = await compositionCommand(config, identity, action, payload);
  return versioned(response, result.value);
}

function versioned(response, value) {
  response.setHeader("ETag", `"composition-version-${value.versionId}-${value.revision}"`);
  return json(response, 200, value);
}

function validateReason(body) {
  if (Object.keys(body).length !== 1 || typeof body.reason !== "string" || !body.reason.isWellFormed() ||
    !body.reason.trim() || [...body.reason].length > 512 || /[\u0000-\u001f\u007f]/u.test(body.reason)) {
    throw new HttpError(400, "invalid_reason");
  }
}
