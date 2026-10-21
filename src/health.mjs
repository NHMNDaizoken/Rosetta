// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createServer } from "node:http";

export function createHealthServer() {
  return createServer(
    { requestTimeout: 5000, headersTimeout: 5000, maxHeaderSize: 8192 },
    (request, response) => {
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

      const body = JSON.stringify(payload);
      response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Length": Buffer.byteLength(body),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      response.end(request.method === "HEAD" ? undefined : body);
    },
  );
}
