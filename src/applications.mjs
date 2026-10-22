// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { isIP } from "node:net";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { HttpError, json, readBody, uuidPattern } from "./http.mjs";

// Application proposals contain only objects and well-formed strings. This is
// the JCS subset needed here, not a general manifest/number canonicalizer.
export function applicationDigest(appId, tenantId, proposal) {
  function canonical(value) {
    if (typeof value === "string" && value.isWellFormed()) return JSON.stringify(value);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
    }
    throw new HttpError(400, "invalid_proposal");
  }
  return `sha256:${createHash("sha256").update(canonical({ resourceId: appId, tenantId, proposal })).digest("hex")}`;
}

export async function readApplicationBody(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 65536);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    // All registration/approval request models are flat objects of scalars.
    for (const value of Object.values(body)) {
      if ((typeof value !== "string" || !value.isWellFormed()) && (typeof value !== "number" || !Number.isSafeInteger(value))) throw Error();
    }
    const keys = new Set();
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (text.slice(match.index + match[0].length).trimStart().startsWith(":")) {
        const key = JSON.parse(match[0]);
        if (keys.has(key) || !key.isWellFormed()) throw Error();
        keys.add(key);
      }
    }
    return body;
  } catch { throw new HttpError(400, "invalid_json"); }
}

export function validateApplicationBody(body, operation) {
  const models = {
    create: [["displayName", "oauthClientId", "providerOrigin"], []],
    approve: [["approvalId"], []],
    state: [["action", "reason"], ["approvalId"]],
    approval_create: [["resourceType", "resourceId", "resourceDigest", "resourceRevision", "requesterSubject", "requesterAppId", "decision", "expiresAt"], []],
    approval_revoke: [["reason"], []],
  };
  const [required, optional] = models[operation];
  if (required.some(key => !Object.hasOwn(body, key)) || Object.keys(body).some(key => !required.includes(key) && !optional.includes(key))) throw new HttpError(400, "invalid_application_body");
  for (const [key, value] of Object.entries(body)) {
    const max = { displayName: 120, oauthClientId: 120, providerOrigin: 255, reason: 512, requesterSubject: 255 }[key] ?? 256;
    if (key === "resourceRevision") {
      if (!Number.isInteger(value) || value < 1 || value > 2147483647) throw new HttpError(400, "invalid_revision");
    } else if (typeof value !== "string" || !value.isWellFormed() || !value.trim() || [...value].length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new HttpError(400, "invalid_application_body");
    if (["approvalId", "resourceId", "requesterAppId"].includes(key) && !uuidPattern.test(value)) throw new HttpError(400, "invalid_identifier");
  }
  if (operation === "create") {
    let origin;
    try { origin = new URL(body.providerOrigin); } catch { throw new HttpError(400, "invalid_provider_origin"); }
    if (origin.protocol !== "https:" || origin.origin !== body.providerOrigin || origin.username || origin.password || isIP(origin.hostname.replace(/^\[|\]$/g, "")) || !origin.hostname.includes(".") || origin.hostname.endsWith(".")) throw new HttpError(400, "invalid_provider_origin");
  }
  if (operation === "state" && (!["suspend", "reactivate", "revoke"].includes(body.action) || (body.action === "reactivate") !== Object.hasOwn(body, "approvalId"))) throw new HttpError(400, "invalid_transition_body");
  if (operation === "approval_create" && (body.resourceType !== "application" || !["approve", "deny"].includes(body.decision) || !/^sha256:[0-9a-f]{64}$/.test(body.resourceDigest) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(body.expiresAt) || !Number.isFinite(Date.parse(body.expiresAt)))) throw new HttpError(400, "invalid_application_approval");
  if (operation === "approval_create") {
    const normalized = body.expiresAt.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
    if (new Date(body.expiresAt).toISOString() !== normalized) throw new HttpError(400, "invalid_approval_expiry");
  }
  return body;
}

export function applicationToken(identity, secret) {
  const encode = value => Buffer.from(JSON.stringify(value)).toString("base64url");
  const head = encode({ alg: "HS256", typ: "JWT" });
  const body = encode({ role: "rosetta_app_api", tenant_id: identity.tenantId, sub: identity.subject,
    iss: identity.issuer, client_id: identity.clientId, aud: "rosetta-data", exp: Math.floor(Date.now() / 1000) + 30 });
  return `${head}.${body}.${createHmac("sha256", secret).update(`${head}.${body}`).digest("base64url")}`;
}

export async function handleApplications(request, response, identity, config, url) {
  if (!config.dataUrl) throw new HttpError(503, "applications_unavailable");
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  if (url.search) throw new HttpError(400, "invalid_query");
  const match = url.pathname.match(/^\/v1\/(applications|approvals)(?:\/([^/]+)(?:\/(approve|state|revoke))?)?$/);
  if (!match || (match[2] && !uuidPattern.test(match[2]))) throw new HttpError(400, "invalid_application_path");
  const [, kind, id, action] = match;
  const operation = kind === "applications"
    ? !id && request.method === "POST" ? "create" : id && !action && request.method === "GET" ? "get" : id && ["approve", "state"].includes(action) && request.method === "POST" ? action : undefined
    : !id && request.method === "POST" ? "approval_create" : id && !action && request.method === "GET" ? "approval_get" : id && action === "revoke" && request.method === "POST" ? "approval_revoke" : undefined;
  if (!operation) throw new HttpError(405, "method_not_allowed");
  const body = request.method === "POST" ? validateApplicationBody(await readApplicationBody(request), operation) : {};
  let payload = { ...body };
  if (operation === "create") {
    const appId = randomUUID();
    payload = { ...body, appId, digest: applicationDigest(appId, identity.tenantId, { ...body, ownerSubject: identity.subject }) };
  } else if (operation === "approval_create") payload = { appId: body.resourceId, approvalId: randomUUID(), decision: body };
  else payload[kind === "applications" ? "appId" : "approvalId"] = id;
  if (request.headers["if-match"] !== undefined) payload.etag = request.headers["if-match"];
  let result;
  try {
    const db = await fetch(`${config.dataUrl}/rpc/application_command`, {
      method: "POST", headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ operation, payload }), signal: AbortSignal.timeout(5000), redirect: "error",
    });
    if (!db.ok) throw Error();
    result = await db.json();
  } catch { throw new HttpError(503, "applications_unavailable"); }
  if (result.error) throw new HttpError(result.status, result.error);
  const value = result.value;
  response.setHeader("ETag", `"${kind === "applications" ? "application" : "approval"}-${value.appId ?? value.approvalId}-${value.revision}"`);
  if (result.status === 201) response.setHeader("Location", `/v1/${kind}/${value.appId ?? value.approvalId}`);
  return json(response, result.status, value);
}
