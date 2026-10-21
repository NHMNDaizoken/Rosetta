// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:http";
import { HttpError, json } from "./http.mjs";

export function createHealthServer(route) {
  return createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 },
    async (request, response) => {
      if (route && request.url?.split("?", 1)[0] !== "/health") {
        try { await route(request, response); }
        catch (error) {
          if (error instanceof HttpError && error.status === 413) response.setHeader("Connection", "close");
          if (!response.headersSent) json(response, error instanceof HttpError ? error.status : 503,
            { error: error instanceof HttpError ? error.message : "service_unavailable" }, request.method);
          else response.destroy();
        }
        return;
      }
      let status = 200;
      let payload = { service: "rosetta-core", status: "ok" };

      if (request.url?.split("?", 1)[0] !== "/health") {
        status = 404;
        payload = { error: "not_found" };
      } else if (!["GET", "HEAD"].includes(request.method)) {
        status = 405;
        payload = { error: "method_not_allowed" };
        response.setHeader("Allow", "GET, HEAD");
      }

      json(response, status, payload, request.method);
    },
  );
}
