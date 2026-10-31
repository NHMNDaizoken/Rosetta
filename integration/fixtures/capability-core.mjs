// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Private test bootstrap only. Never copied into the production Core image.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createApi } from "/app/src/api.mjs";
import { createHealthServer } from "/app/src/platform/health/health.mjs";
import { createCapabilityRuntime } from "/app/src/modules/capability/execution/runtime.mjs";

const bytes = []; for await (const chunk of process.stdin) bytes.push(chunk);
const options = JSON.parse(Buffer.concat(bytes).toString("utf8"));
if (!process.argv.includes("--child")) {
  // A private fixture supervisor restarts the actual Core process, keeping only
  // synthetic network settings in memory. No lease survives the child exit.
  let stopping = false, child;
  const launch = () => {
    child = spawn(process.execPath, [new URL(import.meta.url).pathname, "--child"], { stdio: ["pipe", "inherit", "inherit"] });
    child.stdin.end(JSON.stringify(options));
    child.once("exit", () => { if (!stopping) launch(); });
  };
  launch();
  for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { stopping = true; child.kill(signal); });
} else {
const config = { issuer: process.env.OIDC_ISSUER, identityUrl: process.env.IDENTITY_URL, clientSecret: process.env.CORE_CLIENT_SECRET,
  dataUrl: process.env.DATA_URL, dataSecret: process.env.DATA_JWT_SECRET, workflowUrl: process.env.WORKFLOW_URL,
  workflowPassword: process.env.WORKFLOW_ADMIN_PASSWORD, legacyResourceClients: [] };
const runtime = createCapabilityRuntime(config, { origins: [], testOrigins: [options.origin], testAddresses: [options.address],
  allowTestNetwork: true, ca: readFileSync("/tls/provider-ca.pem") }, { workerEnabled: false });
config.executionRuntime = runtime;
const server = createHealthServer(createApi(config));
const control = createServer(async (request, response) => {
  if (request.url === "/pause") runtime.setWorkerEnabled(false);
  if (request.url === "/resume") runtime.setWorkerEnabled(true);
  if (request.url === "/tick") await runtime.poll().catch(() => {});
  response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ ...runtime.stats(), pid: process.pid }));
  if (request.url === "/restart") setTimeout(() => process.exit(0), 10);
});
server.listen(8080, "0.0.0.0", () => control.listen(8081, "0.0.0.0", () => console.log("runtime-ready")));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { runtime.close(); server.closeAllConnections(); server.close(); control.closeAllConnections(); control.close(); });
}
