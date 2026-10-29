// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

// Exact manifest invocation grammar. Percent-encoding, queries, fragments,
// absolute URLs and empty segments never match.
const PATH = /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/;
const MAX_PATH = 256;
const TICKET = /^[A-Za-z0-9_-]{43,256}$/;
const OPERATION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const METADATA = new Set(["169.254.169.254", "fd00:ec2::254", "100.100.100.200"]);

export class ProviderNetworkError extends Error {
  constructor(code, message = code) {
    super(message);
    this.name = "ProviderNetworkError";
    this.code = code;
  }
}

export function createProviderNetwork(options) {
  if (!options || typeof options !== "object") throw new TypeError("provider network options are required");
  const {
    origins, testOrigins = [], testAddresses = [], allowTestNetwork = false, ca,
    connectTimeoutMs = 2000, requestTimeoutMs = 10000,
    maxRequestBytes = 65536, maxResponseBytes = 65536,
    resolve = dnsLookup,
  } = options;
  const approved = normalizeOrigins(origins, false);
  const test = normalizeOrigins(testOrigins, true);
  if (test.size && !allowTestNetwork) throw new TypeError("test origins require allowTestNetwork");
  if (allowTestNetwork && !test.size) throw new TypeError("allowTestNetwork requires exact test origins");
  if (test.size === 0 && testAddresses.length) throw new TypeError("test addresses require exact test origins");
  const allowedTestAddresses = new Set(testAddresses.map(normalizeAddress));
  if (test.size && allowedTestAddresses.size === 0) throw new TypeError("test origins require exact test addresses");
  if (ca !== undefined && !test.size) throw new TypeError("a custom CA is only accepted for test origins");
  for (const [name, value] of Object.entries({ connectTimeoutMs, requestTimeoutMs, maxRequestBytes, maxResponseBytes })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`${name} must be a positive integer`);
  }
  if (maxRequestBytes > 65536 || maxResponseBytes > 65536) throw new TypeError("provider bodies must not exceed 65536 bytes");
  if (typeof resolve !== "function") throw new TypeError("resolve must be a function");

  function assertOrigin(origin) {
    if (typeof origin !== "string") throw new ProviderNetworkError("origin_not_allowed");
    if (!approved.has(origin) && !test.has(origin)) throw new ProviderNetworkError("origin_not_allowed");
    return test.has(origin);
  }

  // Only the provider protocol headers are emitted. Caller credentials, OIDC
  // tokens and arbitrary headers cannot be forwarded. The socket connects to a
  // pre-validated address while Host and TLS SNI retain the approved hostname.
  async function postJson(origin, path, value, { ticket, operationId, timeoutMs, beforeConnect } = {}) {
    const isTest = assertOrigin(origin);
    if (typeof path !== "string" || path.length > MAX_PATH || !PATH.test(path)) {
      throw new ProviderNetworkError("path_not_allowed");
    }
    if (typeof ticket !== "string" || !TICKET.test(ticket)) throw new ProviderNetworkError("invalid_ticket");
    if (typeof operationId !== "string" || !OPERATION.test(operationId)) throw new ProviderNetworkError("invalid_operation_id");
    const budget = timeoutMs === undefined ? requestTimeoutMs : timeoutMs;
    if (!Number.isSafeInteger(budget) || budget < 100 || budget > requestTimeoutMs) {
      throw new ProviderNetworkError("invalid_timeout");
    }
    let body;
    try { body = Buffer.from(JSON.stringify(value), "utf8"); }
    catch { throw new ProviderNetworkError("invalid_request_body"); }
    if (body.length > maxRequestBytes) throw new ProviderNetworkError("request_too_large");

    const url = new URL(origin);
    const hostname = url.hostname;
    const deadline = Date.now() + budget;
    const remaining = () => deadline - Date.now();
    if (remaining() <= 0) throw new ProviderNetworkError("timeout");

    let answers;
    try {
      answers = await withTimeout(
        Promise.resolve().then(() => resolve(hostname, { all: true, verbatim: true })),
        remaining(), "timeout");
    } catch (error) {
      throw error instanceof ProviderNetworkError ? error : new ProviderNetworkError("resolution_failed");
    }
    if (remaining() <= 0) throw new ProviderNetworkError("timeout");
    const resolved = Array.isArray(answers) ? answers : [answers];
    if (!resolved.length || resolved.length > 64 || resolved.some(entry => !entry || typeof entry.address !== "string")) {
      throw new ProviderNetworkError("resolution_failed");
    }
    for (const entry of resolved) {
      const family = isIP(entry.address.replace(/^\[|\]$/g, ""));
      if (!family) throw new ProviderNetworkError("resolution_failed");
      if (isMetadataAddress(entry.address, family)) throw new ProviderNetworkError("private_address_forbidden");
      if (isTest) {
        if (!allowedTestAddresses.has(normalizeAddress(entry.address))) throw new ProviderNetworkError("address_not_allowed");
      } else if (isForbiddenAddress(entry.address, family)) {
        throw new ProviderNetworkError("private_address_forbidden");
      }
    }
    // Trusted Core callback, never a request-body field. Authority and durable
    // audit commit after DNS validation and immediately before the pinned socket.
    if (beforeConnect !== undefined) {
      if (typeof beforeConnect !== "function") throw new ProviderNetworkError("invalid_dispatch_guard");
      if (remaining() <= 0) throw new ProviderNetworkError("timeout");
      await withTimeout(Promise.resolve().then(beforeConnect), remaining(), "timeout");
    }
    const remainingBudget = remaining();
    if (remainingBudget <= 0) throw new ProviderNetworkError("timeout");
    const pinned = resolved[0].address;
    return await send({
      url, path, address: pinned, body,
      headers: {
        Authorization: `Bearer ${ticket}`,
        "Idempotency-Key": operationId,
        "Content-Type": "application/json",
        Accept: "application/json",
        "Content-Length": String(body.length),
        Host: url.port ? `${hostname}:${url.port}` : hostname,
      },
      connectTimeoutMs: Math.min(connectTimeoutMs, remainingBudget),
      totalTimeoutMs: remainingBudget,
      ca: isTest ? ca : undefined,
      maxResponseBytes,
    });
  }

  return Object.freeze({ postJson });
}

function send({ url, path, address, headers, body, connectTimeoutMs, totalTimeoutMs, ca, maxResponseBytes }) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let connectTimer;
    let totalTimer;
    let mayHaveBeenSent = false;
    const clearTimers = () => {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimers();
      if (value instanceof ProviderNetworkError) value.mayHaveBeenSent = mayHaveBeenSent;
      callback(value);
    };
    const request = httpsRequest({
      method: "POST",
      host: address,
      port: url.port ? Number(url.port) : 443,
      path,
      servername: url.hostname,
      headers,
      agent: false,
      rejectUnauthorized: true,
      ...(ca === undefined ? {} : { ca }),
    }, (response) => {
      clearTimeout(connectTimer);
      if (response.statusCode >= 300 && response.statusCode < 400) {
        response.resume();
        request.destroy();
        return finish(reject, new ProviderNetworkError("redirect"));
      }
      const contentType = response.headers["content-type"] ?? "";
      if (!/^application\/json(?:;|$)/i.test(contentType)) {
        response.resume();
        request.destroy();
        return finish(reject, new ProviderNetworkError("invalid_content_type"));
      }
      const chunks = [];
      let size = 0;
      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxResponseBytes) {
          response.destroy();
          request.destroy();
          return finish(reject, new ProviderNetworkError("response_too_large"));
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        let text;
        try { text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)); }
        catch { return finish(reject, new ProviderNetworkError("invalid_response_encoding")); }
        finish(resolve, { status: response.statusCode,
          contentType: contentType.split(";", 1)[0].trim().toLowerCase(), body: text });
      });
      response.on("error", () => finish(reject, new ProviderNetworkError("response_failed")));
    });
    request.on("socket", (socket) => socket.once("secureConnect", () => { mayHaveBeenSent = true; clearTimeout(connectTimer); }));
    request.on("close", () => clearTimeout(totalTimer));
    request.on("error", (error) => {
      finish(reject, error instanceof ProviderNetworkError ? error : new ProviderNetworkError(transportCode(error)));
    });
    connectTimer = setTimeout(() => {
      request.destroy();
      finish(reject, new ProviderNetworkError("connect_timeout"));
    }, connectTimeoutMs);
    totalTimer = setTimeout(() => {
      request.destroy();
      finish(reject, new ProviderNetworkError("timeout"));
    }, totalTimeoutMs);
    request.end(body);
  });
}

function withTimeout(promise, milliseconds, code) {
  if (!(milliseconds > 0)) return Promise.reject(new ProviderNetworkError(code));
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new ProviderNetworkError(code)), milliseconds);
    }),
  ]);
}

function transportCode(error) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (/CERT|TLS|SSL/.test(code)) return "tls_error";
  if (code === "ECONNREFUSED") return "connection_refused";
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") return "resolution_failed";
  return "transport_error";
}

function normalizeOrigins(list, test) {
  if (!Array.isArray(list)) throw new TypeError("origins must be an array");
  const set = new Set();
  for (const raw of list) {
    let url;
    try { url = new URL(raw); } catch { throw new TypeError(`invalid origin: ${raw}`); }
    if (url.protocol !== "https:" || url.origin !== raw || url.username || url.password ||
        url.pathname !== "/" || url.search || url.hash) throw new TypeError(`invalid origin: ${raw}`);
    const hostname = url.hostname.replace(/^\[|\]$/g, "");
    if (isIP(hostname) || (!test && (!hostname.includes(".") || hostname.endsWith(".")))) {
      throw new TypeError(`invalid origin: ${raw}`);
    }
    set.add(raw);
  }
  return set;
}

function normalizeAddress(raw) {
  if (typeof raw !== "string") throw new TypeError(`invalid test address: ${raw}`);
  const address = raw.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (!isIP(address)) throw new TypeError(`invalid test address: ${raw}`);
  return address;
}

// Conservative policy: only global unicast (2000::/3) is reachable, minus
// special-use/translation/documentation ranges. IPv4-mapped, IPv4-compatible
// and IPv4-translated forms are checked against the embedded IPv4 address.
export function isForbiddenAddress(raw, family = isIP(raw)) {
  if (family === 4) return forbiddenIPv4(raw);
  if (family === 6) return forbiddenIPv6(raw);
  return true;
}

export function isMetadataAddress(raw, family = isIP(raw)) {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];
  if (METADATA.has(address)) return true;
  const groups = expandIPv6(address);
  if (!groups) return false;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  if (g0 === 0xfd00 && g1 === 0x0ec2 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0 && g6 === 0 && g7 === 0x0254) return true;
  if (g0 !== 0 || g1 !== 0 || g2 !== 0 || g3 !== 0) return false;
  if (g4 === 0xffff) {
    if (g5 !== 0) return false;
  } else if (g4 !== 0) return false;
  if (g4 === 0 && g5 !== 0 && g5 !== 0xffff) return false;
  return METADATA.has(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
}

function forbiddenIPv4(raw) {
  const parts = raw.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && (b === 18 || b === 19)) || (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) || a >= 224;
}

function forbiddenIPv6(raw) {
  const address = raw.toLowerCase().replace(/^\[|\]$/g, "").split("%", 1)[0];
  if (!address.includes(":")) return true;
  const groups = expandIPv6(address);
  if (!groups) return true;
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;
  const embedded = () => forbiddenIPv4(`${g6 >> 8}.${g6 & 255}.${g7 >> 8}.${g7 & 255}`);
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && (g5 === 0 || g5 === 0xffff)) {
    if (g5 === 0 && g6 === 0 && (g7 === 0 || g7 === 1)) return true;
    return embedded();
  }
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0xffff && g5 === 0) return embedded();
  if ((g0 & 0xe000) !== 0x2000) return true;
  if (g0 === 0x2001 && g1 === 0x0db8) return true;
  if (g0 === 0x2001 && g1 === 0x0000) return true;
  if (g0 === 0x2001 && g1 === 0x0002) return true;
  if (g0 === 0x2001 && ((g1 & 0xfff0) === 0x0010 || (g1 & 0xfff0) === 0x0020)) return true;
  if (g0 === 0x2002) return true;
  if ((g0 & 0xfff0) === 0x3ff0) return true;
  return false;
}

function expandIPv6(address) {
  const dotted = /^(.*:)(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(address);
  if (dotted) {
    const octets = dotted.slice(2).map(Number);
    if (octets.some((octet) => octet > 255)) return null;
    address = `${dotted[1]}${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
  }
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (head.some((part) => !/^[0-9a-f]{1,4}$/.test(part)) || tail.some((part) => !/^[0-9a-f]{1,4}$/.test(part))) return null;
  if (halves.length === 1 && head.length !== 8) return null;
  if (head.length + tail.length > 8) return null;
  const fill = new Array(8 - head.length - tail.length).fill("0");
  const parts = [...head, ...fill, ...tail];
  if (parts.length !== 8) return null;
  return parts.map((part) => parseInt(part, 16));
}
