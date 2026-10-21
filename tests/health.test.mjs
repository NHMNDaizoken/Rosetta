// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { promisify } from "node:util";
import { createHealthServer } from "../src/health.mjs";

let server;
let baseUrl;

before(async () => {
  server = createHealthServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  });
});

test("GET /health reports process liveness without infrastructure details", async () => {
  const response = await fetch(`${baseUrl}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: "rosetta-core", status: "ok" });
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("HEAD /health has GET metadata and no response body", async () => {
  const response = await fetch(`${baseUrl}/health`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.ok(Number(response.headers.get("content-length")) > 0);
  assert.equal(await response.text(), "");
});

test("health allows query parameters but unknown routes return JSON 404", async () => {
  assert.equal((await fetch(`${baseUrl}/health?probe=1`)).status, 200);
  for (const path of ["/", "/health/", "/health/ready", "/unknown"]) {
    const response = await fetch(`${baseUrl}${path}`);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "not_found" });
  }
});

test("unsupported health methods are rejected with the allowed methods", async () => {
  for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
    const response = await fetch(`${baseUrl}/health`, { method });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.deepEqual(await response.json(), { error: "method_not_allowed" });
  }
});

test("startup rejects invalid ports before listening", () => {
  for (const port of ["", "0", "65536", "-1", "abc", "8080junk", "1.5"]) {
    const child = spawnSync(process.execPath, ["src/server.mjs"], {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, PORT: port },
      encoding: "utf8",
      timeout: 5000,
    });
    assert.ifError(child.error);
    assert.equal(child.status, 1, `PORT=${port}`);
    assert.match(child.stderr, /PORT must be an integer between 1 and 65535/);
  }
});

test("the command-line probe succeeds for this server and fails on invalid targets", async () => {
  const run = promisify(execFile);
  const options = {
    cwd: new URL("..", import.meta.url),
    env: { ...process.env, PORT: String(server.address().port) },
    timeout: 5000,
  };
  await run(process.execPath, ["scripts/check-health.mjs"], options);
  await assert.rejects(
    run(process.execPath, ["scripts/check-health.mjs"], {
      ...options,
      env: { ...process.env, PORT: "invalid" },
    }),
    (error) => error.code === 1 && /Platform health check failed/.test(error.stderr),
  );
});
