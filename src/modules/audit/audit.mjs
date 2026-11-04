// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Tamper-evidence check for the protected audit log. The database seals new
// events into a per-tenant SHA-256 chain and recomputes every sealed entry; Core
// only asserts the private audit role for a verified management principal.
import { applicationToken } from "../applications/applications.mjs";
import { HttpError, json, readFlatJsonObject } from "../../platform/http/http.mjs";

export const AUDIT_VERIFY_PATH = "/v1/audit-events/verify";

export async function handleAudit(request, response, identity, config, url) {
  if (!config.dataUrl) throw new HttpError(503, "audit_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  if (url.pathname !== AUDIT_VERIFY_PATH) throw new HttpError(404, "not_found");
  if (request.method !== "POST") throw new HttpError(405, "method_not_allowed");
  if (url.search) throw new HttpError(400, "invalid_query");
  const body = await readFlatJsonObject(request);
  if (Object.keys(body).length) throw new HttpError(400, "invalid_audit_verification");
  let result;
  try {
    const db = await fetch(`${config.dataUrl}/rpc/audit_verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "junctura_audit_api")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {} }),
      signal: AbortSignal.timeout(15000),
      redirect: "error",
    });
    if (!db.ok) throw Error();
    result = await db.json();
  } catch { throw new HttpError(503, "audit_unavailable"); }
  if (result?.error) throw new HttpError(result.status, result.error);
  if (result?.status !== 200 || typeof result.value?.verified !== "boolean") throw new HttpError(503, "audit_unavailable");
  return json(response, 200, result.value);
}

// The data subject's own access log: every capability call whose consumer named
// the caller as data subject, with purpose, consumer, provider and capability.
// Any verified principal may ask, and only about itself.
export const SUBJECT_ACCESS_PATH = "/v1/me/data-access";

export async function handleSubjectAccess(request, response, identity, config, url) {
  if (url.pathname !== SUBJECT_ACCESS_PATH) throw new HttpError(404, "not_found");
  if (request.method !== "GET") throw new HttpError(405, "method_not_allowed");
  if (url.search) throw new HttpError(400, "invalid_query");
  if (!config.dataUrl) throw new HttpError(503, "audit_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  let result;
  try {
    const db = await fetch(`${config.dataUrl}/rpc/subject_access`, {
      method: "POST",
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "junctura_subject_api")}`, "Content-Type": "application/json" },
      body: JSON.stringify({ payload: {} }),
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
    if (!db.ok) throw Error();
    result = await db.json();
  } catch { throw new HttpError(503, "audit_unavailable"); }
  if (result?.error) throw new HttpError(result.status, result.error);
  if (result?.status !== 200 || !Array.isArray(result.value?.entries)) throw new HttpError(503, "audit_unavailable");
  response.setHeader("Cache-Control", "no-store");
  return json(response, 200, result.value);
}
