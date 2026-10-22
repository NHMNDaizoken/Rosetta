// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createAuthorizer } from "./auth.mjs";
import { HttpError, json } from "./http.mjs";
import { dataRequest, handleData } from "./data.mjs";
import { checkObjectReadiness, handleObjects } from "./objects.mjs";
import { handleWorkflow } from "./workflow.mjs";
import { workflowRequest } from "./workflow-client.mjs";

export function createApi(config) {
  const authorize = createAuthorizer(config);
  return async (request, response) => {
    const path = request.url?.split("?", 1)[0];
    if (path === "/ready" && request.method === "GET") {
      try {
        const result = await fetch(`${config.identityUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
        if (!result.ok || (await result.json()).issuer !== config.issuer) throw new Error("Identity not ready");
        if (config.dataUrl) await dataRequest(config, "readiness", new URLSearchParams({ select: "id", limit: "0" }));
        if (config.objectsUrl) await checkObjectReadiness(config);
        if (config.workflowUrl) await workflowRequest(config, "management/engine");
        return json(response, 200, { status: "ready" });
      } catch { throw new HttpError(503, "not_ready"); }
    }
    if (path?.startsWith("/v1/data/")) {
      const identity = await authorize(request);
      return handleData(request, response, identity, config, new URL(request.url, "http://core"));
    }
    if (path === "/v1/objects" || path?.startsWith("/v1/objects/")) {
      const identity = await authorize(request);
      return handleObjects(request, response, identity, config, new URL(request.url, "http://core"));
    }
    if (path?.startsWith("/v1/workflows/")) {
      const identity = await authorize(request);
      return handleWorkflow(request, response, identity, config, new URL(request.url, "http://core"));
    }
    if (path === "/internal/auth" || path === "/v1/identity") {
      const identity = await authorize(request);
      if (path === "/internal/auth") {
        response.writeHead(204);
        return response.end();
      }
      if (request.method !== "GET") {
        response.setHeader("Allow", "GET");
        throw new HttpError(405, "method_not_allowed");
      }
      return json(response, 200, identity);
    }
    throw new HttpError(404, "not_found");
  };
}
