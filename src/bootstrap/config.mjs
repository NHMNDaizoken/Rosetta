// SPDX-FileCopyrightText: 2026 Rosetta Contributors
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
  if (env.C4A_ENABLED === "true" && !env.OIDC_ISSUER) throw new Error("Capability identity configuration is incomplete");
  if (!env.OIDC_ISSUER) return { port: Number(rawPort), host: env.HOST ?? "127.0.0.1" };
  if (!env.CORE_CLIENT_SECRET || !env.IDENTITY_URL) throw new Error("Identity configuration is incomplete");
  if (env.DATA_URL && (!env.DATA_JWT_SECRET || env.DATA_JWT_SECRET.length < 32)) throw new Error("Data signing secret must contain at least 32 characters");
  if (env.OBJECTS_URL && !env.OBJECTS_MASTER_URL) throw new Error("Object readiness configuration is incomplete");
  if (env.WORKFLOW_URL && !env.WORKFLOW_ADMIN_PASSWORD) throw new Error("Workflow configuration is incomplete");
  const config = Object.freeze({
    issuer: env.OIDC_ISSUER,
    identityUrl: env.IDENTITY_URL,
    clientSecret: env.CORE_CLIENT_SECRET,
    legacyResourceClients: (env.LEGACY_RESOURCE_CLIENTS ?? "").split(",").filter(Boolean),
    dataUrl: env.DATA_URL,
    dataSecret: env.DATA_JWT_SECRET,
    objectsUrl: env.OBJECTS_URL,
    objectsMasterUrl: env.OBJECTS_MASTER_URL,
    workflowUrl: env.WORKFLOW_URL,
    workflowPassword: env.WORKFLOW_ADMIN_PASSWORD,
  });
  const providerOrigins = JSON.parse(env.C4A_PROVIDER_ORIGINS ?? "[]");
  if (!Array.isArray(providerOrigins) || providerOrigins.some(value => typeof value !== "string")) {
    throw new Error("C4A_PROVIDER_ORIGINS must be a JSON array of origins");
  }
  return { port: Number(rawPort), host: env.HOST ?? "127.0.0.1", config,
    execution: env.C4A_ENABLED === "true" ? { providerOrigins } : undefined };
}
