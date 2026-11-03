// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { HttpError, json, readJson, requireWriter, uuidPattern } from "../../platform/http/http.mjs";

const namePattern = /^[a-z][a-z0-9_-]{0,62}$/;
const maxValueBytes = 8 * 1024;

function secretsToken(config) {
  if (config.secretsToken) return config.secretsToken;
  if (config.secretsTokenFile) {
    try {
      return readFileSync(config.secretsTokenFile, "utf8").trim();
    } catch {
      throw new HttpError(503, "secrets_unavailable");
    }
  }
  throw new HttpError(503, "secrets_unavailable");
}

function assertSafeName(name) {
  if (!namePattern.test(name)) throw new HttpError(400, "invalid_secret_name");
}

function secretPath(config, identity, name) {
  assertSafeName(name);
  if (!identity?.tenantId || !identity?.appId) throw new HttpError(403, "application_required");
  if (!uuidPattern.test(identity.appId) && !/^[0-9a-f-]{36}$/i.test(identity.appId)) {
    throw new HttpError(403, "application_required");
  }
  // Server-composed path only. Callers never supply OpenBao paths.
  const mount = config.secretsMount || "secret";
  return `${mount}/data/tenants/${encodeURIComponent(identity.tenantId)}/apps/${encodeURIComponent(identity.appId)}/${encodeURIComponent(name)}`;
}

async function bao(config, method, path, body) {
  const token = secretsToken(config);
  let response;
  try {
    response = await fetch(`${config.secretsUrl}/v1/${path}`, {
      method,
      headers: {
        "X-Vault-Token": token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
      redirect: "error",
    });
  } catch {
    throw new HttpError(503, "secrets_unavailable");
  }
  if (response.status === 404) throw new HttpError(404, "not_found");
  if (response.status === 403) throw new HttpError(403, "secrets_forbidden");
  if (!response.ok) throw new HttpError(503, "secrets_unavailable");
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

export async function checkSecretsReadiness(config, request = fetch) {
  if (!config.secretsUrl) throw new Error("Secrets manager not configured");
  const token = secretsToken(config);
  const response = await request(`${config.secretsUrl}/v1/sys/health?standbyok=true`, {
    headers: { "X-Vault-Token": token },
    signal: AbortSignal.timeout(3000),
    redirect: "error",
  });
  if (![200, 429, 472, 473].includes(response.status)) throw new Error("Secrets manager not ready");
}

/**
 * Public metadata-only views. Plaintext values are never returned on GET.
 * Write accepts a value once; subsequent GET returns name/version metadata only.
 */
export async function handleSecrets(request, response, identity, config, url) {
  if (!config.secretsUrl) throw new HttpError(503, "secrets_unavailable");
  const match = url.pathname.match(/^\/v2\/secrets(?:\/([a-z][a-z0-9_-]{0,62}))?$/);
  if (!match || url.search) throw new HttpError(400, "invalid_secret_path");
  const name = match[1];

  if (request.method === "PUT" && name) {
    requireWriter(identity);
    const body = await readJson(request);
    if (typeof body.value !== "string" || !body.value || Buffer.byteLength(body.value, "utf8") > maxValueBytes) {
      throw new HttpError(400, "invalid_secret_value");
    }
    if (Object.keys(body).some((key) => key !== "value")) throw new HttpError(400, "invalid_secret_body");
    const path = secretPath(config, identity, name);
    const result = await bao(config, "POST", path, { data: { value: body.value } });
    const version = result?.data?.version;
    return json(response, 201, { name, version, bytes: Buffer.byteLength(body.value, "utf8") });
  }

  if (request.method === "GET" && name) {
    const path = secretPath(config, identity, name);
    const result = await bao(config, "GET", path);
    const version = result?.data?.metadata?.version ?? result?.data?.version;
    // Never return plaintext secret values to API clients.
    return json(response, 200, { name, version, present: true });
  }

  if (request.method === "DELETE" && name) {
    requireWriter(identity);
    const mount = config.secretsMount || "secret";
    const meta = `${mount}/metadata/tenants/${encodeURIComponent(identity.tenantId)}/apps/${encodeURIComponent(identity.appId)}/${encodeURIComponent(name)}`;
    assertSafeName(name);
    await bao(config, "DELETE", meta);
    response.writeHead(204);
    return response.end();
  }

  response.setHeader("Allow", name ? "GET, PUT, DELETE" : "");
  throw new HttpError(405, "method_not_allowed");
}

/** Internal server-side read for Core adapters only. Never exposed as a public route. */
export async function readSecretValue(config, identity, name) {
  const path = secretPath(config, identity, name);
  const result = await bao(config, "GET", path);
  const value = result?.data?.data?.value;
  if (typeof value !== "string") throw new HttpError(404, "not_found");
  return value;
}
