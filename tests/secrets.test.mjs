// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { handleSecrets, readSecretValue } from "../src/modules/secrets/secrets.mjs";

function identity(overrides = {}) {
  return {
    tenantId: "tenant-a",
    appId: "11111111-1111-1111-1111-111111111111",
    roles: ["core-reader", "core-writer"],
    ...overrides,
  };
}

async function withBao(handler, run) {
  const server = createServer((req, res) => handler(req, res));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  try {
    await run({
      secretsUrl: `http://127.0.0.1:${port}`,
      secretsToken: "core-token",
      secretsMount: "secret",
    });
  } finally {
    server.close();
  }
}

function mockResponse() {
  const response = new EventEmitter();
  response.headers = {};
  response.body = Buffer.alloc(0);
  response.setHeader = (name, value) => { response.headers[name.toLowerCase()] = value; };
  response.writeHead = (status, headers = {}) => {
    response.statusCode = status;
    Object.assign(response.headers, Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])));
  };
  response.end = (chunk) => {
    if (chunk) response.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    response.emit("finish");
  };
  return response;
}

function jsonRequest(method, payload) {
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    method,
    headers: { "content-type": "application/json" },
    iterator() {
      return {
        async *[Symbol.asyncIterator]() { yield bytes; },
      };
    },
  };
}

test("PUT stores a secret and GET returns metadata without plaintext", async () => {
  const store = new Map();
  await withBao(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    assert.equal(req.headers["x-vault-token"], "core-token");
    assert.match(req.url, /\/v1\/secret\/data\/tenants\/tenant-a\/apps\/11111111-1111-1111-1111-111111111111\/db-password$/);
    if (req.method === "POST") {
      const parsed = JSON.parse(body);
      store.set("value", parsed.data.value);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: { version: 1 } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data: { data: { value: store.get("value") }, metadata: { version: 1 } } }));
  }, async (config) => {
    const putRes = mockResponse();
    await handleSecrets(jsonRequest("PUT", { value: "s3cr3t-value" }), putRes, identity(), config, new URL("http://core/v2/secrets/db-password"));
    assert.equal(putRes.statusCode, 201);
    assert.deepEqual(JSON.parse(putRes.body.toString()), { name: "db-password", version: 1, bytes: 12 });

    const getRes = mockResponse();
    await handleSecrets({ method: "GET", headers: {} }, getRes, identity(), config, new URL("http://core/v2/secrets/db-password"));
    assert.equal(getRes.statusCode, 200);
    const payload = JSON.parse(getRes.body.toString());
    assert.deepEqual(payload, { name: "db-password", version: 1, present: true });
    assert.equal(JSON.stringify(payload).includes("s3cr3t-value"), false);

    const value = await readSecretValue(config, identity(), "db-password");
    assert.equal(value, "s3cr3t-value");
  });
});

test("cross-tenant and cross-app paths are server-composed and rejected without app identity", async () => {
  await withBao(async (_req, res) => {
    res.writeHead(200); res.end("{}");
  }, async (config) => {
    const res = mockResponse();
    await assert.rejects(
      () => handleSecrets({ method: "GET", headers: {} }, res, identity({ appId: undefined }), config, new URL("http://core/v2/secrets/db-password")),
      (error) => error.status === 403,
    );
  });
});

test("invalid names and missing secrets manager fail closed", async () => {
  const res = mockResponse();
  await assert.rejects(
    () => handleSecrets({ method: "GET", headers: {} }, res, identity(), {}, new URL("http://core/v2/secrets/db-password")),
    (error) => error.status === 503,
  );
  await assert.rejects(
    () => handleSecrets({ method: "GET", headers: {} }, res, identity(), { secretsUrl: "http://127.0.0.1:9", secretsToken: "x" }, new URL("http://core/v2/secrets/INVALID")),
    (error) => error.status === 400,
  );
});
