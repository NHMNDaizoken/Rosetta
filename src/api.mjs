// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createAuthorizer } from "./auth.mjs";
import { HttpError, json } from "./http.mjs";

export function createApi(config) {
  const authorize = createAuthorizer(config);
  return async (request, response) => {
    const path = request.url?.split("?", 1)[0];
    if (path === "/ready" && request.method === "GET") {
      try {
        const result = await fetch(`${config.identityUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
        if (!result.ok || (await result.json()).issuer !== config.issuer) throw new Error("Identity not ready");
        return json(response, 200, { status: "ready" });
      } catch { throw new HttpError(503, "not_ready"); }
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
