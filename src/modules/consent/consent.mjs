// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Data subject consent and emergency-access review. A person grants a consumer
// application the right to call one capability about them for named purposes,
// until an expiry, and can revoke it. Tenant administrators (trust.approve) review
// every emergency call made without consent. The database owns every decision;
// Core only asserts the private role for the verified caller.
import { applicationToken } from "../applications/applications.mjs";
import { parseStrictJson } from "../capability/compatibility/compatibility.mjs";
import { HttpError, json, readBody, requireWriter, uuidPattern } from "../../platform/http/http.mjs";

export const CONSENTS_PATH = "/v1/me/consents";
export const EMERGENCY_PATH = "/v1/emergency-accesses";

async function readObject(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 16384);
  let value;
  try { value = parseStrictJson(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new HttpError(400, "invalid_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "invalid_json");
  return value;
}

async function command(config, identity, role, rpc, operation, payload) {
  if (!config.dataUrl) throw new HttpError(503, "consent_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  let result;
  try {
    const db = await fetch(`${config.dataUrl}/rpc/${rpc}`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, role)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000) });
    if (!db.ok) throw Error();
    result = await db.json();
  } catch { throw new HttpError(503, "consent_unavailable"); }
  if (result?.error) throw new HttpError(result.status, result.error);
  if (![200, 201].includes(result?.status) || !result.value || typeof result.value !== "object") throw new HttpError(503, "consent_unavailable");
  return result;
}

export function isConsentPath(path) {
  if (typeof path !== "string") return false;
  return path === CONSENTS_PATH || path.startsWith(`${CONSENTS_PATH}/`) || path === EMERGENCY_PATH || path.startsWith(`${EMERGENCY_PATH}/`);
}

export async function handleConsent(request, response, identity, config, url) {
  if (url.search) throw new HttpError(400, "invalid_query");
  response.setHeader("Cache-Control", "no-store");
  const path = url.pathname;
  if (path === CONSENTS_PATH) {
    if (request.method === "GET") {
      return json(response, 200, (await command(config, identity, "junctura_subject_api", "subject_consent", "list", {})).value);
    }
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const body = await readObject(request);
    const result = await command(config, identity, "junctura_subject_api", "subject_consent", "create", body);
    response.setHeader("Location", `${CONSENTS_PATH}/${result.value.consentId}`);
    return json(response, 201, result.value);
  }
  const revoke = path.match(/^\/v1\/me\/consents\/([^/]+)\/revoke$/);
  if (revoke) {
    if (revoke[1].length !== 36 || !uuidPattern.test(revoke[1])) throw new HttpError(400, "invalid_consent_path");
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    const body = await readObject(request);
    if (Object.keys(body).length) throw new HttpError(400, "invalid_consent");
    return json(response, 200, (await command(config, identity, "junctura_subject_api", "subject_consent", "revoke", { consentId: revoke[1] })).value);
  }
  if (path === EMERGENCY_PATH) {
    if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
    return json(response, 200, (await command(config, identity, "junctura_trust_api", "emergency_review", "list", {})).value);
  }
  const review = path.match(/^\/v1\/emergency-accesses\/([^/]+)\/review$/);
  if (review) {
    if (review[1].length !== 36 || !uuidPattern.test(review[1])) throw new HttpError(400, "invalid_emergency_path");
    if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
    requireWriter(identity);
    const body = await readObject(request);
    if (Object.keys(body).sort().join(",") !== "decision,note") throw new HttpError(400, "invalid_emergency_review");
    return json(response, 200, (await command(config, identity, "junctura_trust_api", "emergency_review", "review", { executionId: review[1], ...body })).value);
  }
  throw new HttpError(404, "not_found");
}
