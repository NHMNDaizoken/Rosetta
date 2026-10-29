// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Technical test application, outside Core. Counters observe attempts only;
// they do not certify general side-effecting or exactly-once capabilities.
import { createServer as httpsServer } from "node:https";
import { createServer as httpServer } from "node:http";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { canonicalize } from "/app/src/capability-manifest.mjs";

const chunks = []; for await (const chunk of process.stdin) chunks.push(chunk);
const config = JSON.parse(Buffer.concat(chunks).toString("utf8"));
let mode = "normal", count = 0, received = 0, last = null;
const pendingRedemptions = new Set();
const digest = value => `sha256:${createHash("sha256").update(canonicalize(value)).digest("hex")}`;
const respond = (response, status, value) => { response.writeHead(status, { "Content-Type": "application/json" }); response.end(JSON.stringify(value)); };
const provider = httpsServer({ key: readFileSync("/tls/provider.key.pem"), cert: readFileSync("/tls/provider.cert.pem") }, async (request, response) => {
  try {
    if (request.method !== "POST" || request.url !== "/capabilities/echo") return respond(response, 404, { error: "not_found" });
    const bytes = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 65536) return respond(response, 413, { error: "too_large" }); bytes.push(chunk); }
    const envelope = JSON.parse(Buffer.concat(bytes).toString("utf8"));
    received++;
    const ticket = request.headers.authorization?.replace(/^Bearer /, "");
    last = { ticket, invocationId: envelope.invocationId, inputDigest: digest(envelope.input), operationId: request.headers["idempotency-key"] };
    if (mode === "unavailable") return respond(response, 503, { error: "synthetic_unavailable", effect: "none" });
    if (mode === "no-redemption") return respond(response, 200, { output: envelope.input });
    if (mode === "hold-redemption") await new Promise(resolve => pendingRedemptions.add(resolve));
    const redemption = await fetch(`${config.coreUrl}/v1/capability-authorizations/introspect`, { method: "POST", redirect: "error",
      headers: { Authorization: `Bearer ${config.oidcToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ticket, invocationId: envelope.invocationId, inputDigest: last.inputDigest }), signal: AbortSignal.timeout(3000) });
    const result = await redemption.json();
    last.authorization = result;
    const context = result.context;
    if (redemption.status !== 200 || !result.active || context.providerAppId !== config.providerAppId || context.principalType !== "service" ||
      context.tenantId !== config.tenantId || context.invocationId !== envelope.invocationId || context.operationId !== last.operationId ||
      context.inputDigest !== last.inputDigest || canonicalize(context.capability) !== canonicalize(config.capability) ||
      canonicalize(envelope.capability) !== canonicalize(config.capability) || Date.parse(context.deadlineAt) <= Date.now()) return respond(response, 403, { error: "authorization_denied", effect: "none" });
    count++;
    if (mode === "lost-response") return response.destroy();
    if (mode === "slow-response") return; // test termination cleans the open socket
    if (mode === "invalid-output") return respond(response, 200, { output: { unexpected: true, diagnostic: "synthetic-private-provider-detail" } });
    if (mode === "invalid-json") { response.writeHead(200, { "Content-Type": "application/json" }); return response.end('{"output":'+JSON.stringify(envelope.input)+',"output":'+JSON.stringify(envelope.input)+'}'); }
    respond(response, 200, { output: envelope.input });
  } catch { if (!response.destroyed) respond(response, 503, { error: "provider_fixture_failed", effect: "none" }); }
});
const control = httpServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/mode") {
    const bytes = []; for await (const chunk of request) bytes.push(chunk);
    const value = JSON.parse(Buffer.concat(bytes).toString("utf8"));
    if (!["normal", "unavailable", "offline", "no-redemption", "lost-response", "slow-response", "invalid-output", "invalid-json", "hold-redemption"].includes(value.mode)) return respond(response, 400, {});
    mode = value.mode;
    if (mode === "offline" && provider.listening) { provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve)); }
    if (mode !== "offline" && !provider.listening) await new Promise(resolve => provider.listen(8443, "0.0.0.0", resolve));
    if (mode === "normal") { for (const release of pendingRedemptions) release(); pendingRedemptions.clear(); }
  }
  respond(response, 200, { mode, count, received, last, pending: pendingRedemptions.size });
});
provider.listen(8443, "0.0.0.0", () => control.listen(8081, "0.0.0.0", () => console.log("provider-ready")));
for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, () => { provider.closeAllConnections(); provider.close(); control.closeAllConnections(); control.close(); });
