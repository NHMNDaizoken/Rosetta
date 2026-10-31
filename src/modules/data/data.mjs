// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { HttpError, json, readJson, requireWriter, uuidPattern } from "../../platform/http/http.mjs";
import { signInternalToken } from "../../platform/security/internal-token.mjs";
import { resourceRequest } from "../resources/resources.mjs";

export function dataToken(tenantId, secret) {
  return signInternalToken(secret, { role: "rosetta_api", tenant_id: tenantId,
    aud: "rosetta-data", exp: Math.floor(Date.now() / 1000) + 30 });
}

export async function dataRequest(config, tenantId, query, options = {}, resource = "records") {
  let response;
  try {
    response = await fetch(`${config.dataUrl}/${resource}?${query}`, {
      ...options,
      headers: { Authorization: `Bearer ${dataToken(tenantId, config.dataSecret)}`,
        "Content-Type": "application/json", Prefer: "return=representation" },
      signal: AbortSignal.timeout(5000), redirect: "error",
    });
  } catch { throw new HttpError(503, "data_unavailable"); }
  if (response.status === 409) throw new HttpError(409, "conflict");
  if (!response.ok) throw new HttpError(response.status === 400 ? 400 : 503, response.status === 400 ? "invalid_data" : "data_unavailable");
  return response.json();
}

export async function handleData(request, response, identity, config, url) {
  const match = url.pathname.match(/^\/v[12]\/data\/([a-z][a-z0-9_-]{0,62})(?:\/([0-9a-f-]+))?$/);
  if (!match || (match[2] && !uuidPattern.test(match[2]))) throw new HttpError(400, "invalid_record_path");
  const [, collection, id] = match;
  const send = (query, options) => identity.appId
    ? resourceRequest(config, identity, "app_records", query, options)
    : dataRequest(config, identity.tenantId, query, options);
  const query = new URLSearchParams({ collection: `eq.${collection}`, select: "id,collection,data,created_at", order: "created_at.asc,id.asc" });
  if (id) query.set("id", `eq.${id}`);
  if (request.method === "GET") {
    const limit = url.searchParams.get("limit") ?? "100";
    if (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 || [...url.searchParams.keys()].some((key) => key !== "limit")) {
      throw new HttpError(400, "invalid_query");
    }
    query.set("limit", id ? "1" : limit);
    const rows = await send(query);
    if (id && !rows.length) throw new HttpError(404, "not_found");
    return json(response, 200, id ? rows[0] : { items: rows });
  }
  if ((request.method === "POST" && !id) || (request.method === "PATCH" && id)) {
    requireWriter(identity);
    if (url.search) throw new HttpError(400, "invalid_query");
    const body = await readJson(request);
    if (Object.keys(body).length !== 1 || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) throw new HttpError(400, "data_object_required");
    const record = request.method === "POST" ? { id: randomUUID(), collection, data: body.data } : { data: body.data };
    const rows = await send(query, { method: request.method, body: JSON.stringify(record) });
    if (!rows.length) throw new HttpError(404, "not_found");
    return json(response, request.method === "POST" ? 201 : 200, rows[0]);
  }
  if (request.method === "DELETE" && id) {
    requireWriter(identity);
    if (url.search) throw new HttpError(400, "invalid_query");
    const rows = await send(query, { method: "DELETE" });
    if (!rows.length) throw new HttpError(404, "not_found");
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Allow", id ? "GET, PATCH, DELETE" : "GET, POST");
  throw new HttpError(405, "method_not_allowed");
}
