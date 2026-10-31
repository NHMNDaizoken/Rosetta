// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { HttpError, json, readBody, requireWriter, uuidPattern } from "../../platform/http/http.mjs";
import { resourceCommand } from "../resources/resources.mjs";

const maxBytes = 5 * 1024 * 1024;

export async function checkObjectReadiness(config, request = fetch) {
  const filer = await request(`${config.objectsUrl}/?limit=0`, { signal: AbortSignal.timeout(3000), redirect: "error" });
  if (!filer.ok) throw new Error("Filer not ready");
  await filer.arrayBuffer();
  const master = await request(`${config.objectsMasterUrl}/dir/status`, { signal: AbortSignal.timeout(3000), redirect: "error" });
  if (!master.ok) throw new Error("Object master not ready");
  const topology = (await master.json()).Topology;
  // Filer metadata can respond before a restarted volume has registered.
  if (!topology?.DataCenters?.some((center) => center.Racks?.some((rack) => rack.DataNodes?.some((node) => node.Max > 0)))) {
    throw new Error("No object volume registered");
  }
}

async function storage(config, tenantId, id, options = {}, scope) {
  let response;
  try {
    const path = scope ? `rosetta-app/${tenantId}/${scope.ownerAppId}/${id}/${scope.version}` : `rosetta/${tenantId}/${id}`;
    response = await fetch(`${config.objectsUrl}/${path}`, {
      ...options, signal: AbortSignal.timeout(10000), redirect: "error",
    });
  } catch { throw new HttpError(503, "objects_unavailable"); }
  if (response.status === 404) throw new HttpError(404, "not_found");
  if (!response.ok) throw new HttpError(503, "objects_unavailable");
  return response;
}

export async function handleObjects(request, response, identity, config, url) {
  const match = url.pathname.match(/^\/v[12]\/objects(?:\/([0-9a-f-]+))?$/);
  if (!match || (match[1] && !uuidPattern.test(match[1])) || url.search) throw new HttpError(400, "invalid_object_path");
  const id = match[1];
  const scoped = Boolean(identity.appId);
  const command = (operation, payload) => resourceCommand(config, identity, operation, payload).then(result => result.value);
  if ((request.method === "POST" && !id) || (request.method === "PUT" && id)) {
    requireWriter(identity);
    if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/octet-stream") throw new HttpError(415, "binary_required");
    const bytes = await readBody(request, maxBytes);
    if (!bytes.length) throw new HttpError(400, "empty_object");
    const objectId = id ?? randomUUID();
    let scope;
    let status = 201;
    if (scoped) {
      const current = await command("object_prepare", { id: objectId });
      status = current.version ? 200 : 201;
      scope = { ownerAppId: current.ownerAppId, version: randomUUID() };
    } else if (id) {
      try { await (await storage(config, identity.tenantId, id, { method: "HEAD" })).arrayBuffer(); status = 200; }
      catch (error) { if (error.status !== 404) throw error; }
    }
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "application/octet-stream" }), objectId);
    const result = await storage(config, identity.tenantId, objectId, { method: "POST", body: form }, scope);
    await result.arrayBuffer();
    if (scoped) await command("object_commit", { id: objectId, version: scope.version });
    return json(response, status, { id: objectId, size: bytes.length });
  }
  if (request.method === "GET" && id) {
    const scope = scoped ? await command("object_get", { id }) : undefined;
    const result = await storage(config, identity.tenantId, id, {}, scope);
    const bytes = Buffer.from(await result.arrayBuffer());
    if (scoped) await command("object_get", { id });
    response.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes.length,
      "Content-Disposition": `attachment; filename="${id}.bin"`, "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    return response.end(bytes);
  }
  if (request.method === "DELETE" && id) {
    requireWriter(identity);
    if (scoped) await command("object_delete", { id });
    else {
      await (await storage(config, identity.tenantId, id, { method: "HEAD" })).arrayBuffer();
      await (await storage(config, identity.tenantId, id, { method: "DELETE" })).arrayBuffer();
    }
    response.writeHead(204);
    return response.end();
  }
  response.setHeader("Allow", id ? "GET, PUT, DELETE" : "POST");
  throw new HttpError(405, "method_not_allowed");
}
