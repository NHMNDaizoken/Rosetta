// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
  }
}

export function json(response, status, payload, method = "GET") {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(method === "HEAD" ? undefined : body);
}

export async function readBody(request, limit) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    length += chunk.length;
    if (length > limit) {
      request.resume();
      throw new HttpError(413, "body_too_large");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export async function readJson(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 65536);
  let value;
  try { value = JSON.parse(bytes.toString("utf8")); }
  catch { throw new HttpError(400, "invalid_json"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "object_required");
  return value;
}

// Strict reader for flat registration/share bodies. It rejects duplicate keys,
// malformed Unicode and nested values; it is not a general schema validator.
export async function readFlatJsonObject(request) {
  if (request.headers["content-type"]?.split(";", 1)[0].trim() !== "application/json") throw new HttpError(415, "json_required");
  const bytes = await readBody(request, 65536);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const body = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw Error();
    for (const value of Object.values(body)) {
      if ((typeof value !== "string" || !value.isWellFormed()) && (typeof value !== "number" || !Number.isSafeInteger(value))) throw Error();
    }
    const keys = new Set();
    for (const match of text.matchAll(/"(?:[^"\\]|\\.)*"/g)) {
      if (text.slice(match.index + match[0].length).trimStart().startsWith(":")) {
        const key = JSON.parse(match[0]);
        if (keys.has(key) || !key.isWellFormed()) throw Error();
        keys.add(key);
      }
    }
    return body;
  } catch { throw new HttpError(400, "invalid_json"); }
}

export function requireWriter(identity) {
  if (!identity.roles.includes("core-writer")) throw new HttpError(403, "write_forbidden");
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
