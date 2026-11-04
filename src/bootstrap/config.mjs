// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Environment validation and the immutable configuration passed to modules.
// Side-effect free so tests and embedded runtimes can construct the same view.

const TRUE_OR_FALSE = new Set(["true", "false"]);

export function loadConfig(env = process.env) {
  const rawPort = env.PORT ?? "8080";
  if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }
  if (env.C4A_ENABLED && !TRUE_OR_FALSE.has(env.C4A_ENABLED)) throw new Error("C4A_ENABLED must be true or false");
  if (env.C4B_ENABLED && !TRUE_OR_FALSE.has(env.C4B_ENABLED)) throw new Error("C4B_ENABLED must be true or false");
  if ((env.C4A_ENABLED === "true" || env.C4B_ENABLED === "true") && !env.OIDC_ISSUER) throw new Error("Capability identity configuration is incomplete");
  if (!env.OIDC_ISSUER) return { port: Number(rawPort), host: env.HOST ?? "127.0.0.1" };
  if (!env.CORE_CLIENT_SECRET || !env.IDENTITY_URL) throw new Error("Identity configuration is incomplete");
  if (env.DATA_URL && (!env.DATA_JWT_SECRET || env.DATA_JWT_SECRET.length < 32)) throw new Error("Data signing secret must contain at least 32 characters");
  if (env.OBJECTS_URL && !env.OBJECTS_MASTER_URL) throw new Error("Object readiness configuration is incomplete");
  if (env.OBJECTS_URL && (!env.CLAMAV_HOST || !env.CLAMAV_PORT)) {
    throw new Error("Object malware scanner configuration is incomplete");
  }
  if (env.CLAMAV_PORT && (!/^\d+$/.test(env.CLAMAV_PORT) || Number(env.CLAMAV_PORT) < 1 || Number(env.CLAMAV_PORT) > 65535)) {
    throw new Error("CLAMAV_PORT must be an integer between 1 and 65535");
  }
  if (env.CLAMAV_TIMEOUT_MS && (!/^\d+$/.test(env.CLAMAV_TIMEOUT_MS) || Number(env.CLAMAV_TIMEOUT_MS) < 1000)) {
    throw new Error("CLAMAV_TIMEOUT_MS must be an integer >= 1000");
  }
  if (env.WORKFLOW_URL && !env.WORKFLOW_ADMIN_PASSWORD) throw new Error("Workflow configuration is incomplete");
  if (env.SECRETS_URL && !env.SECRETS_TOKEN && !env.SECRETS_TOKEN_FILE) {
    throw new Error("Secrets manager configuration is incomplete");
  }
  const config = Object.freeze({
    issuer: env.OIDC_ISSUER,
    identityUrl: env.IDENTITY_URL,
    clientSecret: env.CORE_CLIENT_SECRET,
    legacyResourceClients: (env.LEGACY_RESOURCE_CLIENTS ?? "").split(",").filter(Boolean),
    dataUrl: env.DATA_URL,
    dataSecret: env.DATA_JWT_SECRET,
    objectsUrl: env.OBJECTS_URL,
    objectsMasterUrl: env.OBJECTS_MASTER_URL,
    clamavHost: env.CLAMAV_HOST,
    clamavPort: env.CLAMAV_PORT ? Number(env.CLAMAV_PORT) : undefined,
    clamavTimeoutMs: env.CLAMAV_TIMEOUT_MS ? Number(env.CLAMAV_TIMEOUT_MS) : 30_000,
    secretsUrl: env.SECRETS_URL,
    secretsToken: env.SECRETS_TOKEN,
    secretsTokenFile: env.SECRETS_TOKEN_FILE,
    secretsMount: env.SECRETS_MOUNT || "secret",
    workflowUrl: env.WORKFLOW_URL,
    workflowPassword: env.WORKFLOW_ADMIN_PASSWORD,
  });
  const origins = name => {
    let value;
    try { value = JSON.parse(env[name] ?? "[]"); } catch { value = undefined; }
    if (!Array.isArray(value) || value.some(origin => typeof origin !== "string")) throw new Error(`${name} must be a JSON array of origins`);
    return value;
  };
  const providerOrigins = origins("C4A_PROVIDER_ORIGINS");
  const compositionOrigins = origins("C4B_PROVIDER_ORIGINS");
  // Internal providers (private network, operator provider CA). The CA path is
  // read by the composition root; internal origins without it are refused there.
  const internalOrigins = origins("C4A_INTERNAL_PROVIDER_ORIGINS");
  const compositionInternalOrigins = origins("C4B_INTERNAL_PROVIDER_ORIGINS");
  const providerCaFile = env.PROVIDER_CA_FILE || undefined;
  if ((internalOrigins.length || compositionInternalOrigins.length) && !providerCaFile) {
    throw new Error("Internal provider origins require PROVIDER_CA_FILE");
  }
  return { port: Number(rawPort), host: env.HOST ?? "127.0.0.1", config,
    execution: env.C4A_ENABLED === "true" ? { providerOrigins, internalOrigins, providerCaFile } : undefined,
    composition: env.C4B_ENABLED === "true" ? { providerOrigins: compositionOrigins, internalOrigins: compositionInternalOrigins, providerCaFile } : undefined };
}
