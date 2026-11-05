// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

export class JuncturaError extends Error {
  constructor(status, code, requestId) {
    super(`Junctura request failed (${status}, ${code})`);
    this.name = "JuncturaError";
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

async function boundedJson(response) {
  const chunks = []; let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > 65536) throw new JuncturaError(response.status, "response_too_large");
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new JuncturaError(response.status, "invalid_response"); }
}

// Canonical JSON (sorted keys, no whitespace), the form Junctura digests.
function canonical(value) {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (!value.isWellFormed()) throw new TypeError("invalid_unicode");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("nonfinite_number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new TypeError("invalid_json");
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

/** The input digest a provider presents when it redeems an invocation ticket. */
export const inputDigest = input => `sha256:${createHash("sha256").update(canonical(input)).digest("hex")}`;

// Server-side only. Secrets and tokens stay in this closure; no Core imports,
// token persistence, credential forwarding, mutation retries or implicit approval.
export function createJuncturaClient({ baseUrl, clientId, clientSecret, timeoutMs = 15000, fetcher = fetch }) {
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
        response = await fetcher(new URL("/identity/realms/junctura/protocol/openid-connect/token", base), {
          method: "POST", redirect: "error", signal: signalFor(),
          body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
        });
      } catch { throw new JuncturaError(0, "identity_unavailable"); }
      if (!response.ok) { await response.body?.cancel(); throw new JuncturaError(response.status, "authentication_failed"); }
      const issued = await boundedJson(response);
      if (typeof issued.access_token !== "string" || !issued.access_token || issued.token_type?.toLowerCase() !== "bearer" ||
        !Number.isFinite(issued.expires_in) || issued.expires_in <= 0) throw new JuncturaError(502, "invalid_token_response");
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
    catch { throw new JuncturaError(0, "gateway_unavailable"); }
    if (!response.ok) {
      let detail;
      try { detail = await boundedJson(response); } catch { /* Never echo an untrusted error body. */ }
      if (response.status === 401) cached = undefined;
      const code = typeof detail?.error === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(detail.error) ? detail.error : "request_failed";
      const requestId = response.headers.get("x-request-id");
      throw new JuncturaError(response.status, code, /^[A-Za-z0-9-]{1,80}$/.test(requestId ?? "") ? requestId : undefined);
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
    // context: optional { purpose, dataSubject, emergency?, justification? } — why the call is made and whose data it concerns.
    async execute(target, input, idempotencyKey = randomUUID(), context) {
      return (await request("/v1/capability-executions", { method: "POST",
        json: context === undefined ? { target, input } : { target, input, context }, idempotencyKey })).json();
    },
    // Provider side: redeem the single-use ticket Junctura sent with an invocation
    // (the request's Authorization header) before doing any work. Returns
    // { active: false } for anything malformed, replayed or not addressed to this app.
    async redeemTicket({ authorization, invocationId, input }) {
      const ticket = typeof authorization === "string" ? /^Bearer ([A-Za-z0-9_-]{43,256})$/.exec(authorization)?.[1] : undefined;
      if (!ticket || typeof invocationId !== "string") return { active: false };
      return (await request("/v1/capability-authorizations/introspect", { method: "POST",
        json: { ticket, invocationId, inputDigest: inputDigest(input) } })).json();
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
