// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Host-only transport proof for the guarded provider client. Keys are generated
// per run with the host OpenSSL CLI and never committed; the Core image does not
// need OpenSSL and these tests are not part of the in-container unit suite.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:https";
import { createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createProviderNetwork, ProviderNetworkError } from "../src/provider-network.mjs";

const TICKET = "a".repeat(43);
const OPERATION = "11111111-1111-4111-8111-111111111111";
const failure = (code) => (error) => error instanceof ProviderNetworkError && error.code === code;

function generateTls(directory, name, alternative) {
  const keyPath = join(directory, `${name}.key.pem`);
  const certPath = join(directory, `${name}.cert.pem`);
  const configPath = join(directory, `${name}.cnf`);
  writeFileSync(configPath, "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n");
  const environment = { ...process.env };
  delete environment.OPENSSL_CONF;
  const result = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "1", "-nodes",
    "-config", configPath, "-keyout", keyPath, "-out", certPath,
    "-subj", `/CN=${alternative}`, "-addext", `subjectAltName=${alternative}`], { encoding: "utf8", env: environment });
  if (result.error) throw new Error(`host OpenSSL is required for transport tests: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr}`);
  return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8") };
}

async function startTlsServer(tlsOptions) {
  const sockets = new Set();
  const requests = [];
  const pending = [];
  const timers = new Set();
  const server = createHttpServer(tlsOptions, async (request, response) => {
    request.on("error", () => {});
    response.on("error", () => {});
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    requests.push({ method: request.method, url: request.url, headers: request.headers, body });
    if (request.url === "/echo") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return response.end(JSON.stringify({ ok: true, received: JSON.parse(body) }));
    }
    if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/echo" });
      return response.end();
    }
    if (request.url === "/large") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(JSON.stringify({ value: "x".repeat(70000) }));
    }
    if (request.url === "/text") {
      response.writeHead(200, { "Content-Type": "text/plain" });
      return response.end("not json");
    }
    if (request.url === "/invalid-utf8") {
      response.writeHead(200, { "Content-Type": "application/json" });
      return response.end(Buffer.from([0x7b, 0xff, 0x7d]));
    }
    if (request.url === "/abort") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{\"value\":");
      return setTimeout(() => response.socket?.destroy(), 10);
    }
    if (request.url === "/trickle") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.write("{");
      const timer = setInterval(() => response.write(" "), 40);
      timers.add(timer);
      response.on("close", () => { clearInterval(timer); timers.delete(timer); });
      return;
    }
    if (request.url === "/slow") {
      pending.push(response);
      return;
    }
    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });
  server.on("connection", (socket) => sockets.add(socket));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    requests,
    origin: `https://localhost:${server.address().port}`,
    close: async () => {
      for (const timer of timers) clearInterval(timer);
      for (const response of pending) response.destroy();
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

async function withTls(run) {
  const directory = mkdtempSync(join(tmpdir(), "rosetta-provider-"));
  try {
    await run({
      tls: generateTls(directory, "localhost", "DNS:localhost,IP:127.0.0.1"),
      wrong: generateTls(directory, "wrong", "DNS:wrong.local"),
      loopback: async () => [{ address: "127.0.0.1", family: 4 }],
    });
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

test("real TLS transport uses the provider protocol headers and pins the first address", async () => {
  await withTls(async ({ tls, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    let resolutions = 0;
    const network = createProviderNetwork({
      origins: [], testOrigins: [service.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: tls.cert,
      resolve: async () => { resolutions++; return resolutions === 1 ? loopback() : [{ address: "127.0.0.2", family: 4 }]; },
    });
    const proxyEnvironment = Object.fromEntries(["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY", "NO_PROXY"].map(key => [key, process.env[key]]));
    for (const key of ["HTTPS_PROXY", "HTTP_PROXY", "ALL_PROXY"]) process.env[key] = "http://127.0.0.1:1";
    process.env.NO_PROXY = "";
    try {
      const result = await network.postJson(service.origin, "/echo", { hello: "world" },
        { ticket: TICKET, operationId: OPERATION, headers: { authorization: "Bearer caller-oidc" }, timeoutMs: 5000 });
      assert.equal(result.status, 200);
      assert.deepEqual(JSON.parse(result.body), { ok: true, received: { hello: "world" } });
      assert.equal(resolutions, 1);
      assert.equal(service.requests.length, 1);
      const seen = service.requests[0];
      assert.equal(seen.method, "POST");
      assert.equal(seen.url, "/echo");
      assert.equal(seen.headers.authorization, `Bearer ${TICKET}`);
      assert.equal(seen.headers["idempotency-key"], OPERATION);
      assert.equal(seen.headers["proxy-authorization"], undefined);
      assert.equal(seen.headers.cookie, undefined);
      assert.equal(seen.headers["content-type"], "application/json");
      assert.match(seen.headers.host, /^localhost:\d+$/);
    } finally {
      for (const [key, value] of Object.entries(proxyEnvironment)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await service.close();
    }
  });
});

test("redirects are rejected without forwarding credentials or following", async () => {
  await withTls(async ({ tls, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    const network = createProviderNetwork({
      origins: [], testOrigins: [service.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: tls.cert, resolve: loopback,
    });
    try {
      await assert.rejects(network.postJson(service.origin, "/redirect", {}, { ticket: TICKET, operationId: OPERATION }),
        failure("redirect"));
      assert.deepEqual(service.requests.map((entry) => entry.url), ["/redirect"]);
    } finally { await service.close(); }
  });
});

test("unapproved origins fail before any connection", async () => {
  await withTls(async ({ tls, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    const network = createProviderNetwork({ origins: ["https://provider.example"], resolve: loopback });
    try {
      await assert.rejects(network.postJson(service.origin, "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
        failure("origin_not_allowed"));
      assert.equal(service.requests.length, 0);
    } finally { await service.close(); }
  });
});

test("TLS hostname verification and unknown authorities are enforced", async () => {
  await withTls(async ({ tls, wrong, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    const mismatched = await startTlsServer({ key: wrong.key, cert: wrong.cert });
    try {
      const untrusted = createProviderNetwork({
        origins: [], testOrigins: [service.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: wrong.cert, resolve: loopback,
      });
      const hostnameMismatch = createProviderNetwork({
        origins: [], testOrigins: [mismatched.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: wrong.cert, resolve: loopback,
      });
      await assert.rejects(untrusted.postJson(service.origin, "/echo", {}, { ticket: TICKET, operationId: OPERATION }), failure("tls_error"));
      await assert.rejects(hostnameMismatch.postJson(mismatched.origin, "/echo", {}, { ticket: TICKET, operationId: OPERATION }), failure("tls_error"));
      assert.equal(service.requests.length, 0);
      assert.equal(mismatched.requests.length, 0);
    } finally {
      await service.close();
      await mismatched.close();
    }
  });
});

test("response size, content type, encoding and aborts fail closed", async () => {
  await withTls(async ({ tls, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    const network = createProviderNetwork({
      origins: [], testOrigins: [service.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: tls.cert, resolve: loopback,
    });
    try {
      await assert.rejects(network.postJson(service.origin, "/large", {}, { ticket: TICKET, operationId: OPERATION }), failure("response_too_large"));
      await assert.rejects(network.postJson(service.origin, "/text", {}, { ticket: TICKET, operationId: OPERATION }), failure("invalid_content_type"));
      await assert.rejects(network.postJson(service.origin, "/invalid-utf8", {}, { ticket: TICKET, operationId: OPERATION }), failure("invalid_response_encoding"));
      await assert.rejects(network.postJson(service.origin, "/abort", {}, { ticket: TICKET, operationId: OPERATION }), (error) => {
        assert.ok(error instanceof ProviderNetworkError);
        assert.ok(["response_failed", "transport_error"].includes(error.code), error.code);
        return true;
      });
    } finally { await service.close(); }
  });
});

test("trickled responses and stalled TLS handshakes hit their deadlines", async () => {
  await withTls(async ({ tls, loopback }) => {
    const service = await startTlsServer({ key: tls.key, cert: tls.cert });
    const network = createProviderNetwork({
      origins: [], testOrigins: [service.origin], testAddresses: ["127.0.0.1"], allowTestNetwork: true, ca: tls.cert,
      connectTimeoutMs: 150, requestTimeoutMs: 1000, resolve: loopback,
    });
    try {
      await assert.rejects(network.postJson(service.origin, "/trickle", {}, { ticket: TICKET, operationId: OPERATION, timeoutMs: 250 }),
        failure("timeout"));
    } finally { await service.close(); }

    const sockets = new Set();
    const stalled = createTcpServer((socket) => { sockets.add(socket); socket.on("error", () => {}); });
    await new Promise((resolve) => stalled.listen(0, "127.0.0.1", resolve));
    const stallOrigin = `https://localhost:${stalled.address().port}`;
    const stalledNetwork = createProviderNetwork({
      origins: [], testOrigins: [stallOrigin], testAddresses: ["127.0.0.1"], allowTestNetwork: true,
      connectTimeoutMs: 150, requestTimeoutMs: 1000, resolve: loopback,
    });
    try {
      await assert.rejects(stalledNetwork.postJson(stallOrigin, "/echo", {}, { ticket: TICKET, operationId: OPERATION }),
        failure("connect_timeout"));
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => stalled.close(resolve));
    }
  });
});
