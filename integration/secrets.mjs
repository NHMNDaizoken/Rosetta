// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { before, test } from "node:test";
import { promisify } from "node:util";
import { contractFetch as fetch } from "./contract.mjs";

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer = `${base}/identity/realms/junctura`;
let tokenA;

async function token(client, secret) {
  const response = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "client_credentials", client_id: client, client_secret: secret }),
  });
  assert.equal(response.status, 200, `${client}: token issuance`);
  return (await response.json()).access_token;
}

async function api(path, accessToken, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: { ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}), ...options.headers },
    signal: AbortSignal.timeout(15000),
  });
}

const compose = (...args) => promisify(execFile)("docker", ["compose", ...args], { timeout: 180000 });

before(async () => {
  tokenA = await token("tenant-a", process.env.TENANT_A_SECRET);
});

test("secrets routes require enrolled application identity", async () => {
  const response = await api("/v2/secrets/demo-secret", tokenA, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: "must-not-store-without-app" }),
  });
  // Legacy fixture clients are not enrolled apps; resourceIdentity must deny.
  assert.ok([401, 403, 404].includes(response.status));
  const body = await response.json();
  assert.equal(JSON.stringify(body).includes("must-not-store-without-app"), false);
});

test("secrets manager outage fails closed on readiness", { timeout: 180000 }, async () => {
  await compose("stop", "secrets");
  try {
    assert.equal((await api("/ready")).status, 503);
  } finally {
    await compose("up", "--detach", "--no-deps", "secrets");
    await compose("up", "--detach", "--no-deps", "secrets-init");
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      try {
        if ((await api("/ready")).status === 200) break;
      } catch { /* wait for unseal */ }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    assert.equal((await api("/ready")).status, 200);
  }
});
