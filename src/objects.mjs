// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { HttpError, json, readBody, requireWriter, uuidPattern } from "./http.mjs";

const maxBytes = 5 * 1024 * 1024;

async function storage(config, tenantId, id, options = {}) {
  let response;
  try {
    response = await fetch(`${config.objectsUrl}/rosetta/${tenantId}/${id}`, {
      ...options, signal: AbortSignal.timeout(10000), redirect: "error",
    });
  } catch { throw new HttpError(503, "objects_unavailable"); }
  if (response.status === 404) throw new HttpError(404, "not_found");
  if (!response.ok) throw new HttpError(503, "objects_unavailable");
  return response;
}

export async function handleObjects(request, response, identity, config, url) {
  const match = url.pathname.match(/^\/v1\/objects(?:\/([0-9a-f-]+))?$/);
  if (!match || (match[1] && !uuidPattern.test(match[1])) || url.search) throw new HttpError(400, "invalid_object_path");
  const id = match[1];
  if ((request.method === "POST" && !id) || (request.method === "PUT" && id)) {
    requireWriter(identity);
    if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/octet-stream") throw new HttpError(415, "binary_required");
    const bytes = await readBody(request, maxBytes);
    if (!bytes.length) throw new HttpError(400, "empty_object");
    const objectId = id ?? randomUUID();
    let status = 201;
    if (id) {
      try { await (await storage(config, identity.tenantId, id, { method: "HEAD" })).arrayBuffer(); status = 200; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), objectId);
    const result = await storage(config, identity.tenantId, objectId, { method: "POST", body: form });
    await result.arrayBuffer();
    return json(response, status, { id: objectId, size: bytes.length });
  }
  if (request.method === "GET" && id) {
    const result = await storage(config, identity.tenantId, id);
    const bytes = Buffer.from(await result.arrayBuffer());
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length,
      "Content-Disposition": `attachment; filename="${id}.bin"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    return response.end(bytes);
  }
  if (request.method === "DELETE" && id) {
    requireWriter(identity);
    await (await storage(config, identity.tenantId, id, { method: "HEAD" })).arrayBuffer();
    await (await storage(config, identity.tenantId, id, { method: "DELETE" })).arrayBuffer();
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Allow", id ? "GET, PUT, DELETE" : "POST");
  throw new HttpError(405, "method_not_allowed");
}
