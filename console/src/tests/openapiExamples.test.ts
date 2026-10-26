// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FOUNDATION_ENDPOINTS,
  generateCurlExample,
  generateFetchExample,
  getAuthLabel,
  type ApiEndpointDef,
} from "../constants/openapiData";

const spec = JSON.parse(
  fs.readFileSync(
    path.resolve(process.cwd(), "..", "docs", "contracts", "foundation-api.openapi.json"),
    "utf8",
  ),
);

function resolveRef(node: any, seen = new Set<string>()): any {
  if (!node || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map((item) => resolveRef(item, seen));
  if (typeof node.$ref === "string") {
    if (seen.has(node.$ref)) return node;
    const target = node.$ref
      .slice(2)
      .split("/")
      .reduce((value: any, key: string) => value?.[key], spec);
    return resolveRef(target, new Set(seen).add(node.$ref));
  }
  return Object.fromEntries(
    Object.entries(node).map(([key, value]: [string, any]) => [key, resolveRef(value, seen)]),
  );
}

function validate(value: any, inputSchema: any, at = "$"): void {
  const schema = resolveRef(inputSchema);
  if (!schema || typeof schema !== "object") return;
  if (schema.oneOf || schema.anyOf) {
    const alternatives = schema.oneOf ?? schema.anyOf;
    const errors: string[] = [];
    for (const alternative of alternatives) {
      try {
        validate(value, alternative, at);
        return;
      } catch (error) {
        errors.push(String(error));
      }
    }
    throw new Error(`${at}: no schema alternative matched: ${errors.join(" | ")}`);
  }
  if (schema.const !== undefined) expect(value).toEqual(schema.const);
  if (schema.enum) expect(schema.enum).toContain(value);
  if (schema.type === "object") {
    expect(value, `${at}: object`).toBeTypeOf("object");
    expect(Array.isArray(value), `${at}: not array`).toBe(false);
    expect(value).not.toBeNull();
    for (const key of schema.required ?? []) {
      expect(value, `${at}: required ${key}`).toHaveProperty(key);
    }
    for (const [key, item] of Object.entries(value)) {
      if (schema.properties?.[key]) validate(item, schema.properties[key], `${at}.${key}`);
      else if (schema.additionalProperties === false) {
        throw new Error(`${at}.${key}: additional property is not allowed`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        validate(item, schema.additionalProperties, `${at}.${key}`);
      }
    }
  } else if (schema.type === "string") {
    expect(value, `${at}: string`).toBeTypeOf("string");
    if (schema.minLength !== undefined) expect(value.length).toBeGreaterThanOrEqual(schema.minLength);
    if (schema.maxLength !== undefined) expect(value.length).toBeLessThanOrEqual(schema.maxLength);
    if (schema.pattern) expect(value).toMatch(new RegExp(schema.pattern));
    if (schema.format === "date-time") {
      expect(Number.isNaN(Date.parse(value)), `${at}: date-time`).toBe(false);
    }
  } else if (schema.type === "integer") {
    expect(Number.isInteger(value), `${at}: integer`).toBe(true);
    if (schema.minimum !== undefined) expect(value).toBeGreaterThanOrEqual(schema.minimum);
    if (schema.maximum !== undefined) expect(value).toBeLessThanOrEqual(schema.maximum);
  } else if (schema.type === "array") {
    expect(Array.isArray(value), `${at}: array`).toBe(true);
  }
}

function pathValue(name: string): string {
  if (name === "collection") return "widgets";
  if (name === "executionId") return "rosetta_checkpoint:1:example";
  if (name === "id" || name.endsWith("Id")) return "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
  return "example";
}

function resolvedPath(endpoint: ApiEndpointDef): string {
  return endpoint.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(pathValue(name)),
  );
}

function operationFor(endpoint: ApiEndpointDef): any {
  return spec.paths[endpoint.path][endpoint.method.toLowerCase()];
}

function parametersFor(endpoint: ApiEndpointDef): any[] {
  const pathItem = spec.paths[endpoint.path];
  return [...(pathItem.parameters ?? []), ...(operationFor(endpoint).parameters ?? [])]
    .map((parameter) => resolveRef(parameter))
    .filter((parameter) => parameter?.name);
}

function requestSchema(endpoint: ApiEndpointDef): any {
  const operation = operationFor(endpoint);
  const content = operation.requestBody?.content;
  if (!content) return null;
  const [contentType, media] = Object.entries(content)[0] as [string, any];
  return { contentType, schema: media.schema };
}

function curlJsonBody(code: string): any {
  const start = code.indexOf(" -d '") + 5;
  const end = code.lastIndexOf("'");
  return JSON.parse(code.slice(start, end));
}

function fetchJsonBody(code: string): any {
  const match = code.match(/body: JSON\.stringify\(([\s\S]*)\),\n\}\);/);
  if (!match) throw new Error("fetch JSON body not found");
  return JSON.parse(match[1]);
}

function usesBearer(endpoint: ApiEndpointDef): boolean {
  if (["issueOidcToken", "logoutOidc", "authorizeOidc", "browserLogoutOidc"].includes(endpoint.operationId)) {
    return false;
  }
  return endpoint.security.some((entry) => {
    const schemes = entry && typeof entry === "object" ? Object.keys(entry) : [];
    return schemes.includes("coreBearer") || schemes.includes("oidcUserToken");
  });
}

describe("Foundation API Explorer inventory", () => {
  it("covers every documented operation exactly once", () => {
    const documented: string[] = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(pathItem as Record<string, any>)) {
        if (operation.operationId) documented.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(FOUNDATION_ENDPOINTS).toHaveLength(documented.length);
    expect(new Set(FOUNDATION_ENDPOINTS.map((endpoint) => endpoint.operationId)).size).toBe(
      FOUNDATION_ENDPOINTS.length,
    );
    expect(
      FOUNDATION_ENDPOINTS.map((endpoint) => `${endpoint.method} ${endpoint.path}`).sort(),
    ).toEqual(documented.sort());
  });

  it("matches request, response, security and parameter metadata to the OpenAPI contract", () => {
    for (const endpoint of FOUNDATION_ENDPOINTS) {
      const operation = operationFor(endpoint);
      const parameters = parametersFor(endpoint);
      const responses = Object.keys(operation.responses);
      const successStatuses = responses
        .filter((status) => /^2\d\d$/.test(status))
        .sort((a, b) => Number(a) - Number(b));
      const successStatus = successStatuses[0] ?? null;
      const successContentTypes = successStatus
        ? Object.keys(operation.responses[successStatus]?.content ?? {})
        : [];

      expect(endpoint.operationId, endpoint.path).toBe(operation.operationId);
      expect(endpoint.responses, endpoint.operationId).toEqual(responses);
      expect(endpoint.security, endpoint.operationId).toEqual(
        operation.security ?? spec.security ?? [],
      );
      expect(endpoint.hasRequestBody, endpoint.operationId).toBe(Boolean(operation.requestBody));
      expect(endpoint.requestContentTypes, endpoint.operationId).toEqual(
        Object.keys(operation.requestBody?.content ?? {}),
      );
      expect(endpoint.pathParameters.map((parameter) => parameter.name)).toEqual(
        parameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name),
      );
      expect(endpoint.queryParameters.map((parameter) => parameter.name)).toEqual(
        parameters.filter((parameter) => parameter.in === "query").map((parameter) => parameter.name),
      );
      expect(endpoint.headerParameters.map((parameter) => parameter.name)).toEqual(
        parameters.filter((parameter) => parameter.in === "header").map((parameter) => parameter.name),
      );
      expect(endpoint.headerParameters.map((parameter) => parameter.required)).toEqual(
        parameters
          .filter((parameter) => parameter.in === "header")
          .map((parameter) => parameter.required === true),
      );
      expect(endpoint.successStatus, endpoint.operationId).toBe(successStatus);
      expect(endpoint.successContentType, endpoint.operationId).toBe(successContentTypes[0] ?? null);
      expect(endpoint.successHasBody, endpoint.operationId).toBe(
        successContentTypes.length > 0 || successStatus === "304",
      );
    }
  });
});

describe("Executable OpenAPI examples", () => {
  it("keeps request bodies structurally valid and aligned with content types", () => {
    for (const endpoint of FOUNDATION_ENDPOINTS) {
      const curl = generateCurlExample(endpoint);
      const fetch = generateFetchExample(endpoint);
      const request = requestSchema(endpoint);
      const urlPath = resolvedPath(endpoint);

      expect(curl, endpoint.operationId).toContain(urlPath);
      expect(fetch, endpoint.operationId).toContain(urlPath);
      expect(curl, endpoint.operationId).not.toContain("/* payload */");
      expect(fetch, endpoint.operationId).not.toContain("/* payload */");
      expect(curl, endpoint.operationId).not.toContain('"example": true');
      expect(fetch, endpoint.operationId).not.toContain('"example": true');
      expect(`${curl}\n${fetch}`, endpoint.operationId).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);

      if (request?.contentType === "application/json") {
        const curlBody = curlJsonBody(curl);
        const fetchBody = fetchJsonBody(fetch);
        validate(curlBody, request.schema);
        validate(fetchBody, request.schema);
        expect(curl, endpoint.operationId).toContain('-H "Content-Type: application/json"');
        expect(fetch, endpoint.operationId).toContain('"Content-Type": "application/json"');
      } else if (request?.contentType === "application/x-www-form-urlencoded") {
        expect(curl, endpoint.operationId).toContain(
          '-H "Content-Type: application/x-www-form-urlencoded"',
        );
        expect(fetch, endpoint.operationId).toContain(
          '"Content-Type": "application/x-www-form-urlencoded"',
        );
        expect(fetch, endpoint.operationId).toContain("URLSearchParams");
        expect(curl, endpoint.operationId).not.toContain("Content-Type: application/json");
      } else if (request?.contentType === "application/octet-stream") {
        expect(curl, endpoint.operationId).toContain('-H "Content-Type: application/octet-stream"');
        expect(curl, endpoint.operationId).toContain('--data-binary "@./example.bin"');
        expect(fetch, endpoint.operationId).toContain(
          '"Content-Type": "application/octet-stream"',
        );
        expect(fetch, endpoint.operationId).toContain("new Blob");
        expect(curl, endpoint.operationId).not.toContain("Content-Type: application/json");
      } else {
        expect(curl, endpoint.operationId).not.toContain("Content-Type:");
        expect(fetch, endpoint.operationId).not.toContain("Content-Type:");
      }
    }
  });

  it("handles required conditional and idempotency headers", () => {
    for (const endpoint of FOUNDATION_ENDPOINTS) {
      const curl = generateCurlExample(endpoint);
      const fetch = generateFetchExample(endpoint);
      for (const header of endpoint.headerParameters) {
        expect(curl, `${endpoint.operationId} ${header.name}`).toContain(
          `-H "${header.name}: $`,
        );
        expect(fetch, `${endpoint.operationId} ${header.name}`).toContain(`"${header.name}"`);
      }
      if (endpoint.headerParameters.some((header) => header.name === "If-Match")) {
        expect(curl).toContain('If-Match: $ETAG');
        expect(fetch).toContain('"If-Match": etag');
      }
      if (endpoint.headerParameters.some((header) => header.name === "Idempotency-Key")) {
        expect(curl).toContain('Idempotency-Key: $IDEMPOTENCY_KEY');
        expect(fetch).toContain('"Idempotency-Key": idempotencyKey');
        expect(curl).toContain("crypto.randomUUID()");
      }
    }
  });

  it("uses the contract's bearer and browser-navigation authentication model", () => {
    for (const endpoint of FOUNDATION_ENDPOINTS) {
      const curl = generateCurlExample(endpoint);
      const fetch = generateFetchExample(endpoint);
      if (usesBearer(endpoint)) {
        expect(curl, endpoint.operationId).toContain('Authorization: Bearer $TOKEN');
        expect(fetch, endpoint.operationId).toContain('"Authorization": "Bearer " + token');
      } else {
        expect(curl, endpoint.operationId).not.toContain("Authorization: Bearer");
        expect(fetch, endpoint.operationId).not.toContain('"Authorization": "Bearer');
      }
      if (getAuthLabel(endpoint) === "Browser navigation") {
        expect(fetch).toContain("window.location.assign");
        expect(fetch).not.toContain("await fetch(");
        expect(curl).toContain("--include");
      }
    }
  });

  it("models binary downloads, empty responses and provider query parameters", () => {
    for (const endpoint of FOUNDATION_ENDPOINTS) {
      const curl = generateCurlExample(endpoint);
      const fetch = generateFetchExample(endpoint);

      if (endpoint.successContentType === "application/octet-stream") {
        expect(curl, endpoint.operationId).toContain("--output example.bin");
        expect(fetch, endpoint.operationId).toContain("await response.blob()");
        expect(fetch, endpoint.operationId).not.toContain("await response.json()");
      }
      if (endpoint.successStatus === "204") {
        expect(curl, endpoint.operationId).toContain("--write-out");
        expect(fetch, endpoint.operationId).toContain("has no response body");
        expect(fetch, endpoint.operationId).not.toContain("await response.json()");
      }
      if (
        endpoint.successHasBody &&
        endpoint.method !== "HEAD" &&
        endpoint.successContentType !== "application/octet-stream" &&
        getAuthLabel(endpoint) !== "Browser navigation"
      ) {
        expect(fetch, endpoint.operationId).toContain("if (!response.ok)");
      }
      if (endpoint.operationId === "authorizeOidc") {
        for (const key of [
          "client_id=rosetta-local",
          "response_type=code",
          "redirect_uri=http%3A%2F%2F127.0.0.1%3A9876%2Fcallback",
          "code_challenge_method=S256",
        ]) {
          expect(curl, key).toContain(key);
          expect(fetch, key).toContain(key);
        }
      }
      if (endpoint.operationId === "browserLogoutOidc") {
        expect(curl).toContain("client_id=rosetta-local");
        expect(fetch).toContain("client_id=rosetta-local");
      }
    }
  });
});
