// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export class RosettaError extends Error {
  constructor(status, code, requestId) {
    super(`Rosetta request failed (${status}, ${code})`);
    this.name = "RosettaError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function boundedJson(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 65536) throw new RosettaError(response.status, "response_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new RosettaError(response.status, "invalid_response"); }
}

// Server-side only. Secrets and tokens stay in this closure; no Core imports,
// token persistence, credential forwarding, mutation retries or implicit approval.
export function createRosettaClient({ baseUrl, clientId, clientSecret, timeoutMs = 15000, fetcher = fetch }) {
  const base = new URL(baseUrl);
  if (base.username || base.password || base.search || base.hash || base.pathname !== "/" ||
    (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(base.hostname)))) {
    throw new TypeError("Use an HTTPS Gateway origin, or HTTP loopback for local development");
  }
  if (!clientId || !clientSecret || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new TypeError("Client credentials and a bounded timeout are required");
  let cached, pending;
  const signalFor = signal => signal ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) : AbortSignal.timeout(timeoutMs);
  async function token() {
    if (cached && cached.until > Date.now()) return cached.value;
    if (pending) return pending;
    pending = (async () => {
      let response;
      try {
        response = await fetcher(new URL("/identity/realms/rosetta/protocol/openid-connect/token", base), {
          method: "POST", redirect: "error", signal: signalFor(),
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
        });
      } catch { throw new RosettaError(0, "identity_unavailable"); }
      if (!response.ok) { await response.body?.cancel(); throw new RosettaError(response.status, "authentication_failed"); }
      const issued = await boundedJson(response);
      if (typeof issued.access_token !== "string" || !issued.access_token || issued.token_type?.toLowerCase() !== "bearer" ||
        !Number.isFinite(issued.expires_in) || issued.expires_in <= 0) throw new RosettaError(502, "invalid_token_response");
      cached = { value: issued.access_token, until: Date.now() + Math.max(0, issued.expires_in - 10) * 1000 };
      return cached.value;
    })();
    try { return await pending; } finally { pending = undefined; }
  }
  async function request(path, { method = "GET", json, body, contentType, ifMatch, idempotencyKey, signal } = {}) {
    if (typeof path !== "string" || !/^\/v[12]\//.test(path) || /[\\#\r\n]/.test(path)) throw new TypeError("Use a versioned public Gateway path");
    const url = new URL(path, base);
    if (url.origin !== base.origin || !/^\/v[12]\//.test(url.pathname)) throw new TypeError("Gateway path escapes the public API");
    if (json !== undefined && body !== undefined) throw new TypeError("Supply JSON or binary body, not both");
    const headers = new Headers({ Authorization: `Bearer ${await token()}` });
    if (json !== undefined) headers.set("Content-Type", "application/json");
    else if (contentType) headers.set("Content-Type", contentType);
    if (ifMatch) headers.set("If-Match", ifMatch);
    if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
    let response;
    try { response = await fetcher(url, { method, headers, body: json === undefined ? body : JSON.stringify(json), redirect: "error", signal: signalFor(signal) }); }
    catch { throw new RosettaError(0, "gateway_unavailable"); }
    if (!response.ok) {
      let detail;
      try { detail = await boundedJson(response); } catch { /* Never echo an untrusted error body. */ }
      if (response.status === 401) cached = undefined;
      const code = typeof detail?.error === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(detail.error) ? detail.error : "request_failed";
      const requestId = response.headers.get("x-request-id");
      throw new RosettaError(response.status, code, /^[A-Za-z0-9-]{1,80}$/.test(requestId ?? "") ? requestId : undefined);
    }
    return response;
  }
  const segment = value => encodeURIComponent(String(value));
  const client = {
    request,
    async identity() { return (await request("/v1/identity")).json(); },
    async createRecord(collection, data) { return (await request(`/v2/data/${segment(collection)}`, { method: "POST", json: { data } })).json(); },
    async getRecord(collection, id) { return (await request(`/v2/data/${segment(collection)}/${segment(id)}`)).json(); },
    async putObject(id, bytes) { return (await request(`/v2/objects/${segment(id)}`, { method: "PUT", body: bytes, contentType: "application/octet-stream" })).json(); },
    async getObject(id) { return (await request(`/v2/objects/${segment(id)}`)).arrayBuffer(); },
    async workflowDefinitions() { return (await request("/v1/workflows/definitions")).json(); },
    async startWorkflow(definitionId, input, idempotencyKey = randomUUID()) {
      return (await request("/v1/workflows/executions", { method: "POST", json: { definitionId, input }, idempotencyKey })).json();
    },
    async discover({ limit, cursor } = {}) {
      const query = new URLSearchParams();
      if (limit !== undefined) query.set("limit", String(limit));
      if (cursor !== undefined) query.set("cursor", cursor);
      return (await request(`/v1/capabilities${query.size ? `?${query}` : ""}`)).json();
    },
    async execute(target, input, idempotencyKey = randomUUID()) {
      return (await request("/v1/capability-executions", { method: "POST", json: { target, input }, idempotencyKey })).json();
    },
    async execution(id) { return (await request(`/v1/capability-executions/${segment(id)}`)).json(); },
    async waitForExecution(id, { timeoutMs: pollTimeout = 60000, intervalMs = 500, signal } = {}) {
      if (!Number.isInteger(pollTimeout) || pollTimeout < 1 || pollTimeout > 300000 || !Number.isInteger(intervalMs) || intervalMs < 100 || intervalMs > 10000) throw new TypeError("Polling bounds are invalid");
      const deadline = AbortSignal.timeout(pollTimeout);
      const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
      while (true) {
        combined.throwIfAborted();
        const value = await (await request(`/v1/capability-executions/${segment(id)}`, { signal: combined })).json();
        if (!["accepted", "running"].includes(value.state)) return value;
        await delay(intervalMs, undefined, { signal: combined });
      }
    },
  };
  return Object.freeze(client);
}
