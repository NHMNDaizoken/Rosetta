// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHealthServer } from "./health.mjs";
import { createApi } from "./api.mjs";
import { createCapabilityRuntime } from "./capability-runtime.mjs";

const rawPort = process.env.PORT ?? "8080";
if (!/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

let route, executionRuntime;
if (process.env.C4A_ENABLED && !["true", "false"].includes(process.env.C4A_ENABLED)) throw new Error("C4A_ENABLED must be true or false");
if (process.env.C4A_ENABLED === "true" && !process.env.OIDC_ISSUER) throw new Error("Capability identity configuration is incomplete");
if (process.env.OIDC_ISSUER) {
  if (!process.env.CORE_CLIENT_SECRET || !process.env.IDENTITY_URL) throw new Error("Identity configuration is incomplete");
  if (process.env.DATA_URL && (!process.env.DATA_JWT_SECRET || process.env.DATA_JWT_SECRET.length < 32)) throw new Error("Data signing secret must contain at least 32 characters");
  if (process.env.OBJECTS_URL && !process.env.OBJECTS_MASTER_URL) throw new Error("Object readiness configuration is incomplete");
  if (process.env.WORKFLOW_URL && !process.env.WORKFLOW_ADMIN_PASSWORD) throw new Error("Workflow configuration is incomplete");
  const config = { issuer: process.env.OIDC_ISSUER, identityUrl: process.env.IDENTITY_URL, clientSecret: process.env.CORE_CLIENT_SECRET,
    legacyResourceClients: (process.env.LEGACY_RESOURCE_CLIENTS ?? "").split(",").filter(Boolean),
    dataUrl: process.env.DATA_URL, dataSecret: process.env.DATA_JWT_SECRET, objectsUrl: process.env.OBJECTS_URL, objectsMasterUrl: process.env.OBJECTS_MASTER_URL,
    workflowUrl: process.env.WORKFLOW_URL, workflowPassword: process.env.WORKFLOW_ADMIN_PASSWORD };
  if (process.env.C4A_ENABLED === "true") {
    executionRuntime = createCapabilityRuntime(config, { origins: JSON.parse(process.env.C4A_PROVIDER_ORIGINS ?? "[]") });
    config.executionRuntime = executionRuntime;
  }
  route = createApi(config);
}
const server = createHealthServer(route);
server.on("error", (error) => {
  console.error(`Platform health API failed: ${error.code ?? "startup_error"}`);
  process.exitCode = 1;
});
server.listen(Number(rawPort), process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Platform health API listening on port ${server.address().port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    executionRuntime?.close();
    server.close();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  });
}
