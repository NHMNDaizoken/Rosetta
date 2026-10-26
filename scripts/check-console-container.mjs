// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const root = process.cwd();
const image = "rosetta-console:contract-test";
const nodeImage =
  "node:24.21.0-bookworm-slim@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20";
const suffix = `${process.pid}-${Date.now()}`;
const network = `rosetta-console-test-${suffix}`;
const fixtureName = `rosetta-console-fixture-${suffix}`;
const consoleName = `rosetta-console-${suffix}`;
const fixturePath = path.join(root, "tests", "console-proxy-fixture.mjs");
const uuid = "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
const executionId = "rosetta_checkpoint:1:test";
const idempotencyKey = "11111111-2222-4333-8444-555555555555";

function dockerOutput(args) {
  const result = spawnSync("docker", args, { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`docker ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.trim();
}

function dockerInherit(args) {
  const result = spawnSync("docker", args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) throw new Error(`docker ${args.join(" ")} failed`);
}

function cleanup() {
  for (const name of [consoleName, fixtureName]) {
    spawnSync("docker", ["rm", "-f", name], { stdio: "ignore" });
  }
  spawnSync("docker", ["network", "rm", network], { stdio: "ignore" });
}

function dumpDiagnostics() {
  for (const name of [consoleName, fixtureName]) {
    const result = spawnSync("docker", ["logs", name], { encoding: "utf8" });
    if (result.stdout || result.stderr) {
      console.error(`\n--- ${name} logs ---\n${result.stdout}\n${result.stderr}`);
    }
  }
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function request(port, requestPath, options = {}) {
  const { method = "GET", headers = {}, body, timeout = 25_000 } = options;
  return new Promise((resolve, reject) => {
    const requestHandle = http.request(
      {
        host: "127.0.0.1",
        port,
        path: requestPath,
        method,
        headers,
        timeout,
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          resolve({
            status: response.statusCode,
            headers: response.headers,
            text: Buffer.concat(chunks).toString("utf8"),
          });
        });
      },
    );
    requestHandle.on("timeout", () => requestHandle.destroy(new Error("request timeout")));
    requestHandle.on("error", reject);
    if (body !== undefined) requestHandle.write(body);
    requestHandle.end();
  });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function waitFor(port, requestPath, expectedStatus, label) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await request(port, requestPath);
      if (response.status === expectedStatus) return;
    } catch {
      // The container may still be starting.
    }
    await sleep(250);
  }
  throw new Error(`${label} did not become ready`);
}

function expectStatus(response, status, label) {
  assert.equal(
    response.status,
    status,
    `${label}: expected ${status}, got ${response.status}: ${response.text.slice(0, 200)}`,
  );
}

const nonHtml = (response) => assert.doesNotMatch(response.text, /<div id="root"><\/div>/);

async function main() {
  dockerInherit(["network", "create", network]);
  dockerInherit(["build", "--no-cache", "--tag", image, "--file", "console/Dockerfile", "."]);

  const fixturePort = await freePort();
  dockerOutput([
    "run",
    "-d",
    "--name",
    fixtureName,
    "--network",
    network,
    "--network-alias",
    "gateway",
    "-p",
    `127.0.0.1:${fixturePort}:8080`,
    "-v",
    `${fixturePath}:/fixture.mjs:ro`,
    nodeImage,
    "node",
    "/fixture.mjs",
  ]);
  await waitFor(fixturePort, "/__log", 200, "proxy fixture");

  const consolePort = await freePort();
  dockerOutput([
    "run",
    "-d",
    "--name",
    consoleName,
    "--network",
    network,
    "--read-only",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,nodev,size=16m,mode=1777",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges:true",
    "-p",
    `127.0.0.1:${consolePort}:3000`,
    image,
  ]);
  await waitFor(consolePort, "/healthz", 200, "packaged Console");

  assert.equal(dockerOutput(["inspect", "-f", "{{.Config.User}}", consoleName]), "nginx");
  assert.equal(
    dockerOutput(["inspect", "-f", "{{.HostConfig.ReadonlyRootfs}}", consoleName]),
    "true",
  );
  assert.equal(
    dockerOutput(["inspect", "-f", '{{json .HostConfig.CapDrop}}', consoleName]),
    '["ALL"]',
  );
  assert.equal(
    dockerOutput(["inspect", "-f", '{{json .HostConfig.SecurityOpt}}', consoleName]),
    '["no-new-privileges:true"]',
  );
  assert.match(
    dockerOutput(["inspect", "-f", '{{json .HostConfig.Tmpfs}}', consoleName]),
    /"\/tmp"/,
  );

  const imageCheck = spawnSync(
    "docker",
    [
      "run",
      "--rm",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "test -f /usr/share/nginx/html/index.html && test -s /usr/share/licenses/rosetta/LICENSE && test ! -e /console && test ! -e /app && ! command -v vite",
    ],
    { encoding: "utf8" },
  );
  assert.equal(imageCheck.status, 0, `runtime image content check: ${imageCheck.stderr}`);

  const health = await request(consolePort, "/healthz");
  expectStatus(health, 200, "healthz");
  assert.equal(health.text, "ok\n");

  const index = await request(consolePort, "/", { headers: { Accept: "text/html" } });
  expectStatus(index, 200, "index");
  assert.match(index.headers["content-type"], /text\/html/);
  assert.match(index.text, /<div id="root"><\/div>/);
  assert.match(index.headers["content-security-policy"], /frame-ancestors 'none'/);
  assert.equal(index.headers["x-content-type-options"], "nosniff");
  assert.equal(index.headers["x-frame-options"], "DENY");
  assert.equal(index.headers["referrer-policy"], "no-referrer");
  assert.doesNotMatch(index.headers.server ?? "", /\d/);
  assert.match(index.headers["cache-control"], /no-cache/);

  const deepLink = await request(consolePort, "/overview", {
    headers: { Accept: "text/html,application/xhtml+xml" },
  });
  expectStatus(deepLink, 200, "SPA deep link");
  assert.match(deepLink.text, /<div id="root"><\/div>/);

  const nonNavigation = await request(consolePort, "/overview");
  expectStatus(nonNavigation, 404, "non-navigation deep link");
  nonHtml(nonNavigation);

  const assetPath = index.text.match(/src="([^"]+\.js)"/)?.[1];
  assert.ok(assetPath, "built JavaScript asset");
  const asset = await request(consolePort, assetPath);
  expectStatus(asset, 200, "static asset");
  assert.match(asset.headers["content-type"], /javascript/);
  assert.match(asset.headers["cache-control"], /max-age=31536000/);
  assert.equal((await request(consolePort, "/assets/missing.js")).status, 404);
  assert.equal((await request(consolePort, `${assetPath}.map`)).status, 404);

  const identity = await request(consolePort, "/api/v1/identity", {
    headers: {
      Authorization: "Bearer synthetic-token",
      "X-Forwarded-For": "203.0.113.9",
    },
  });
  expectStatus(identity, 200, "proxied identity");
  const identityRecord = JSON.parse(identity.text);
  assert.equal(identityRecord.authorization, "Bearer synthetic-token");
  assert.equal(identityRecord.host, "gateway:8080");

  const ready = await request(consolePort, "/api/ready");
  expectStatus(ready, 200, "proxied readiness");
  const healthEndpoint = await request(consolePort, "/api/health");
  expectStatus(healthEndpoint, 200, "proxied health");

  const application = await request(consolePort, `/api/v1/applications/${uuid}`);
  expectStatus(application, 200, "application lookup");
  const createApplication = await request(consolePort, "/api/v1/applications", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer synthetic-token" },
    body: JSON.stringify({
      displayName: "Synthetic",
      oauthClientId: "synthetic-client",
      providerOrigin: "https://synthetic.example.test",
    }),
  });
  expectStatus(createApplication, 200, "application creation");
  const approval = await request(consolePort, "/api/v1/approvals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resourceType: "application" }),
  });
  expectStatus(approval, 200, "approval creation");
  const approve = await request(consolePort, `/api/v1/applications/${uuid}/approve`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "If-Match": '"synthetic-etag"',
      Authorization: "Bearer synthetic-token",
    },
    body: JSON.stringify({ approvalId: uuid }),
  });
  expectStatus(approve, 200, "application approval");
  assert.equal(JSON.parse(approve.text).ifMatch, '"synthetic-etag"');
  const state = await request(consolePort, `/api/v1/applications/${uuid}/state`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "If-Match": '"synthetic-etag"' },
    body: JSON.stringify({ action: "suspend", reason: "Synthetic reason" }),
  });
  expectStatus(state, 200, "application state");

  const definitions = await request(consolePort, "/api/v1/workflows/definitions");
  expectStatus(definitions, 200, "workflow definitions");
  const start = await request(consolePort, "/api/v1/workflows/executions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify({ definitionId: executionId }),
  });
  expectStatus(start, 200, "workflow start");
  assert.equal(JSON.parse(start.text).idempotencyKey, idempotencyKey);
  const execution = await request(
    consolePort,
    `/api/v1/workflows/executions/${executionId}`,
  );
  expectStatus(execution, 200, "workflow execution");
  const encodedExecution = await request(
    consolePort,
    `/api/v1/workflows/executions/${encodeURIComponent(executionId)}`,
  );
  expectStatus(encodedExecution, 200, "encoded workflow execution");
  const complete = await request(
    consolePort,
    `/api/v1/workflows/executions/${executionId}/complete`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
  );
  expectStatus(complete, 200, "workflow complete");
  const cancel = await request(consolePort, `/api/v1/workflows/executions/${executionId}`, {
    method: "DELETE",
  });
  expectStatus(cancel, 204, "workflow cancel");

  for (const [label, requestPath, status] of [
    ["unproxied v2 data", "/api/v2/data/widgets", 404],
    ["unproxied v1 data", "/api/v1/data/widgets", 404],
    ["unproxied approval lookup", `/api/v1/approvals/${uuid}`, 404],
    ["unproxied OIDC", "/api/identity/realms/rosetta/protocol/openid-connect/token", 404],
    ["trailing slash bypass", "/api/v1/identity/", 404],
    ["invalid application id", "/api/v1/applications/not-a-uuid", 404],
    ["application suffix bypass", `/api/v1/applications/${uuid}/approve/`, 404],
    ["api root", "/api", 404],
    ["api directory", "/api/", 404],
    ["encoded slash", "/api/v1%2Fidentity", 400],
    ["double-encoded slash", "/api/v1%252Fidentity", 400],
    ["encoded traversal", "/api/v1/%2e%2e/v1/identity", 400],
    ["literal traversal", "/api/v1/../v1/identity", 400],
    ["double slash", "/api//v1/identity", 400],
    ["leading double slash", "//api/v1/identity", 400],
  ]) {
    const response = await request(consolePort, requestPath);
    expectStatus(response, status, label);
    nonHtml(response);
  }

  expectStatus(
    await request(consolePort, "/api/health", { method: "POST" }),
    405,
    "health method",
  );
  expectStatus(
    await request(consolePort, "/api/health", { method: "HEAD" }),
    405,
    "health HEAD method",
  );
  expectStatus(
    await request(consolePort, `/api/v1/applications/${uuid}/approve`),
    405,
    "approve method",
  );
  expectStatus(
    await request(consolePort, `/api/v1/workflows/executions/${executionId}/complete`, {
      method: "GET",
    }),
    405,
    "complete method",
  );
  expectStatus(
    await request(consolePort, `/api/v1/workflows/executions/${executionId}`, {
      method: "POST",
    }),
    405,
    "execution method",
  );

  const upstreamError = await request(consolePort, "/api/v1/identity?status=503", {
    headers: { Authorization: "Bearer synthetic-token" },
  });
  expectStatus(upstreamError, 503, "upstream error");
  assert.match(upstreamError.headers["content-type"], /application\/json/);
  nonHtml(upstreamError);

  const timeoutStarted = Date.now();
  const timeout = await request(consolePort, "/api/health?slow=1");
  const timeoutElapsed = Date.now() - timeoutStarted;
  expectStatus(timeout, 504, "upstream timeout");
  assert.ok(timeoutElapsed >= 14_000, `timeout returned too early: ${timeoutElapsed}ms`);
  nonHtml(timeout);

  const blockedCredential = await request(consolePort, "/api/v2/data/widgets", {
    headers: { Authorization: "Bearer blocked-secret" },
  });
  expectStatus(blockedCredential, 404, "blocked credential path");

  const fixtureLog = JSON.parse((await request(fixturePort, "/__log")).text);
  assert.ok(fixtureLog.length > 0, "fixture received proxy requests");
  assert.ok(
    fixtureLog.some(
      (entry) => entry.url === "/v1/identity" && entry.authorization === "Bearer synthetic-token",
    ),
    "bearer token reached the approved upstream",
  );
  assert.ok(
    !fixtureLog.some((entry) => entry.authorization === "Bearer blocked-secret"),
    "blocked path did not forward its credential",
  );
  assert.ok(
    !fixtureLog.some(
      (entry) =>
        entry.url.startsWith("/v1/data") ||
        entry.url.startsWith("/v2/") ||
        entry.url.startsWith("/identity/") ||
        entry.url.startsWith(`/v1/approvals/`),
    ),
    "unapproved paths never reached the upstream",
  );
  assert.ok(
    fixtureLog.every((entry) => entry.host === "gateway:8080"),
    "proxy rewrote the upstream Host header",
  );
  assert.ok(
    fixtureLog.every((entry) => !entry.xForwardedFor?.includes("203.0.113.9")),
    "proxy did not trust caller-supplied X-Forwarded-For",
  );
  assert.ok(
    fixtureLog.some((entry) => entry.ifMatch === '"synthetic-etag"'),
    "If-Match reached the upstream",
  );
  assert.ok(
    fixtureLog.some((entry) => entry.idempotencyKey === idempotencyKey),
    "Idempotency-Key reached the upstream",
  );

  dockerOutput(["rm", "-f", fixtureName]);
  const unavailable = await request(consolePort, "/api/health", { timeout: 10_000 });
  assert.ok(unavailable.status >= 500, `unavailable upstream status: ${unavailable.status}`);
  assert.notEqual(unavailable.status, 200);
  nonHtml(unavailable);

  console.log("Packaged Console contract checks passed");
}

try {
  await main();
} catch (error) {
  dumpDiagnostics();
  throw error;
} finally {
  cleanup();
}
