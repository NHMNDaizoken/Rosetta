// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import http from "node:http";

const requests = [];

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(body),
  });
  response.end(body);
}

const server = http.createServer((request, response) => {
  const body = [];
  request.on("data", (chunk) => body.push(chunk));
  request.on("end", () => {
    const url = new URL(request.url, "http://fixture");
    if (url.pathname === "/__log") {
      sendJson(response, 200, requests);
      return;
    }

    const record = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization ?? null,
      host: request.headers.host ?? null,
      ifMatch: request.headers["if-match"] ?? null,
      idempotencyKey: request.headers["idempotency-key"] ?? null,
      xForwardedFor: request.headers["x-forwarded-for"] ?? null,
      body: Buffer.concat(body).toString("utf8"),
    };
    requests.push(record);

    if (url.searchParams.get("status") === "503") {
      sendJson(response, 503, { error: "fixture_unavailable", record });
      return;
    }

    if (url.searchParams.get("slow") === "1") {
      setTimeout(() => sendJson(response, 200, record), 16_000);
      return;
    }

    if (request.method === "DELETE") {
      response.writeHead(204);
      response.end();
      return;
    }

    sendJson(response, 200, record);
  });
});

server.listen(8080, "0.0.0.0", () => {
  console.log("console proxy fixture listening on 8080");
});
