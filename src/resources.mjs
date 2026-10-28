// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { applicationToken } from "./applications.mjs";
import { HttpError, json, readFlatJsonObject, requireWriter, uuidPattern } from "./http.mjs";

export function requireLegacyClient(identity, config) {
  if (!identity.clientId || !(config.legacyResourceClients ?? []).includes(identity.clientId)) {
    throw new HttpError(403, "legacy_resources_disabled");
  }
}

export async function resourceRequest(config, identity, resource, query = new URLSearchParams(), options = {}) {
  let result;
  try {
    result = await fetch(`${config.dataUrl}/${resource}?${query}`, {
      ...options,
      headers: { Authorization: `Bearer ${applicationToken(identity, config.dataSecret, "rosetta_resource_api")}`,
        "Content-Type": "application/json", Prefer: "return=representation" },
      signal: AbortSignal.timeout(5000), redirect: "error",
    });
  } catch { throw new HttpError(503, "resources_unavailable"); }
  if (!result.ok) throw new HttpError([403, 409].includes(result.status) ? result.status : 503,
    result.status === 409 ? "conflict" : result.status === 403 ? "resource_forbidden" : "resources_unavailable");
  return result.json();
}

export async function resourceCommand(config, identity, operation, payload = {}) {
  const result = await resourceRequest(config, identity, "rpc/resource_command", new URLSearchParams(),
    { method: "POST", body: JSON.stringify({ operation, payload }) });
  if (result.error) throw new HttpError(result.status, result.error);
  return result;
}

export async function resourceIdentity(config, identity) {
  if (!identity.clientId) throw new HttpError(403, "verified_client_required");
  const { value } = await resourceCommand(config, identity, "context");
  return { ...identity, appId: value.appId };
}

export function validateShare(body) {
  const keys = ["resourceType", "resourceId", "granteeAppId", "action", "expiresAt"];
  if (Object.keys(body).length !== keys.length || keys.some(key => !Object.hasOwn(body, key)) ||
      !["record", "object"].includes(body.resourceType) || body.action !== "read" ||
      !uuidPattern.test(body.resourceId) || !uuidPattern.test(body.granteeAppId) ||
      typeof body.expiresAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(body.expiresAt) ||
      !Number.isFinite(Date.parse(body.expiresAt)) ||
      ![new Date(body.expiresAt).toISOString(), new Date(body.expiresAt).toISOString().replace(".000Z", "Z")].includes(body.expiresAt)) {
    throw new HttpError(400, "invalid_share");
  }
  return body;
}

export async function handleShares(request, response, identity, config, url) {
  requireWriter(identity);
  if (url.search) throw new HttpError(400, "invalid_query");
  if (url.pathname === "/v2/resource-shares" && request.method === "POST") {
    const result = await resourceCommand(config, identity, "share_create", validateShare(await readFlatJsonObject(request)));
    return json(response, result.status, result.value);
  }
  const match = url.pathname.match(/^\/v2\/resource-shares\/([0-9a-f-]+)$/);
  if (match && uuidPattern.test(match[1]) && request.method === "DELETE") {
    await resourceCommand(config, identity, "share_revoke", { shareId: match[1] });
    response.writeHead(204);
    return response.end();
  }
  throw new HttpError(404, "not_found");
}
