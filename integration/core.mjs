// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { before, test } from "node:test";

const base = process.env.PUBLIC_URL ?? "http://127.0.0.1:8080";
const issuer = `${base}/identity/realms/rosetta`;
let tokenA, tokenB, reader;

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

before(async () => {
  tokenA = await token("tenant-a", process.env.TENANT_A_SECRET);
  tokenB = await token("tenant-b", process.env.TENANT_B_SECRET);
  reader = await token("reader", process.env.READER_SECRET);
});

test("gateway preserves health and exposes real OIDC discovery/readiness", async () => {
  assert.deepEqual(await (await api("/health")).json(), { service: "rosetta-core", status: "ok" });
  assert.equal((await api("/ready")).status, 200);
  const discovery = await (await fetch(`${issuer}/.well-known/openid-configuration`)).json();
  assert.equal(discovery.issuer, issuer);
  assert.ok(discovery.response_types_supported.includes("code"));
  assert.ok(discovery.code_challenge_methods_supported.includes("S256"));
});

test("gateway rejects missing/invalid credentials and trusts only verified tenant membership", async () => {
  assert.equal((await api("/v1/identity")).status, 401);
  assert.equal((await api("/v1/identity", "invalid.token.value")).status, 401);
  for (const [accessToken, tenantId] of [[tokenA, "tenant-a"], [tokenB, "tenant-b"]]) {
    const response = await api("/v1/identity", accessToken, { headers: { "X-Tenant-Id": "spoofed", "X-Rosetta-Tenant": "spoofed" } });
    assert.equal(response.status, 200);
    const identity = await response.json();
    assert.equal(identity.tenantId, tenantId);
    assert.ok(identity.roles.includes("core-reader"));
  }
  assert.equal((await api("/internal/auth", tokenA)).status, 404);
});

test("SSO completes a real authorization-code + PKCE flow and revokes the session", async () => {
  const verifier = randomBytes(32).toString("base64url");
  const state = randomBytes(16).toString("hex");
  const params = new URLSearchParams({
    client_id: "rosetta-local", response_type: "code", scope: "openid",
    redirect_uri: "http://127.0.0.1:9876/callback", state,
    code_challenge_method: "S256", code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  });
  const login = await fetch(`${issuer}/protocol/openid-connect/auth?${params}`, { redirect: "manual" });
  assert.equal(login.status, 200);
  const cookies = login.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  const html = await login.text();
  const action = html.match(/<form[^>]*action="([^"]+)"/);
  assert.ok(action, "Keycloak login form exists");
  const result = await fetch(action[1].replaceAll("&amp;", "&"), {
    method: "POST", redirect: "manual",
    headers: { Cookie: cookies },
    body: new URLSearchParams({ username: "local-user", password: process.env.SSO_USER_PASSWORD, credentialId: "" }),
  });
  assert.equal(result.status, 302, "Keycloak accepts the real fixture credentials");
  const callback = new URL(result.headers.get("location"));
  assert.equal(callback.origin, "http://127.0.0.1:9876");
  assert.equal(callback.searchParams.get("state"), state);
  assert.ok(callback.searchParams.get("code"));
  const exchange = await fetch(`${issuer}/protocol/openid-connect/token`, {
    method: "POST",
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: "rosetta-local",
      redirect_uri: "http://127.0.0.1:9876/callback", code: callback.searchParams.get("code"), code_verifier: verifier }),
  });
  assert.equal(exchange.status, 200, "PKCE code exchange succeeds");
  const session = await exchange.json();
  const identity = await api("/v1/identity", session.access_token);
  assert.equal(identity.status, 200);
  assert.equal((await identity.json()).tenantId, "tenant-a");
  const logout = await fetch(`${issuer}/protocol/openid-connect/logout`, {
    method: "POST", body: new URLSearchParams({ client_id: "rosetta-local", refresh_token: session.refresh_token }),
  });
  assert.equal(logout.status, 204);
  assert.equal((await api("/v1/identity", session.access_token)).status, 401, "Revoked session is rejected");
});
