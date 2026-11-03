// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Private test bootstrap only. Never copied into the production Core image.
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { createApi } from "/app/src/api.mjs";
import { createHealthServer } from "/app/src/platform/health/health.mjs";
import { createCapabilityRuntime } from "/app/src/modules/capability/execution/runtime.mjs";

import { createCompositionRuntime } from "/app/src/modules/capability/composition/runtime.mjs";

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
// Faults intercept only actual HTTP boundaries in this private test bootstrap.
// A lost response still sends the real request; no successful state is fabricated.
let fault;
const actualFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const path = new URL(url).pathname;
  const start = path.endsWith("/runtime/process-instances") && init?.method === "POST";
  const complete = path.includes("/acquire/jobs/") && path.endsWith("/complete");
  const terminate = path.includes("/runtime/process-instances/") && init?.method === "DELETE";
  if (fault === "definition-outage" && path.endsWith("/repository/process-definitions")) { fault = null; throw Error("synthetic definition outage"); }
  if (fault === "history-outage" && path.includes("/history/historic-process-instances")) throw Error("synthetic history outage");
  if (fault === "start-before-send" && start) { fault = null; throw Error("synthetic start outage"); }
  if (fault === "termination-outage" && terminate) throw Error("synthetic termination outage");
  const result = await actualFetch(url, init);
  if (fault === "start-history-unavailable" && start) { fault = "history-outage"; throw Error("synthetic start response loss"); }
  if (fault === "start-multiple" && start) {
    await actualFetch(url, init); fault = null; throw Error("synthetic duplicate engine start");
  }
  if ((fault === "start-response-lost" && start) || (fault === "completion-response-lost" && complete)) {
    fault = null; throw Error("synthetic response loss");
  }
  return result;
};
const config = { issuer: process.env.OIDC_ISSUER, identityUrl: process.env.IDENTITY_URL, clientSecret: process.env.CORE_CLIENT_SECRET,
  dataUrl: process.env.DATA_URL, dataSecret: process.env.DATA_JWT_SECRET, workflowUrl: process.env.WORKFLOW_URL,
  workflowPassword: process.env.WORKFLOW_ADMIN_PASSWORD, legacyResourceClients: [] };
const runtime = (options.composition ? createCompositionRuntime : createCapabilityRuntime)(config, { origins: [], testOrigins: options.origins ?? [options.origin], testAddresses: options.addresses ?? [options.address],
  allowTestNetwork: true, ca: readFileSync("/tls/provider-ca.pem") }, { workerEnabled: false });
if (options.composition) config.compositionRuntime = runtime; else config.executionRuntime = runtime;
const server = createHealthServer(createApi(config));
const control = createServer(async (request, response) => {
  if (request.url.startsWith("/fault/")) fault = request.url.slice(7) === "clear" ? null : request.url.slice(7);
  if (request.url === "/pause") runtime.setWorkerEnabled(false);
  if (request.url === "/resume") runtime.setWorkerEnabled(true);
  if (request.url === "/tick") await runtime.poll().catch(() => {});
  if (request.url === "/once") {
    runtime.setWorkerEnabled(true);
    try { await runtime.poll(); } finally { runtime.setWorkerEnabled(false); }
  }
  response.writeHead(200, { "Content-Type": "application/json" }); response.end(JSON.stringify({ ...runtime.stats(), pid: process.pid }));
  if (request.url === "/restart") setTimeout(() => process.exit(0), 10);
});
server.listen(8080, "0.0.0.0", () => control.listen(8081, "0.0.0.0", () => console.log("runtime-ready")));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { runtime.close(); server.closeAllConnections(); server.close(); control.closeAllConnections(); control.close(); });
}
