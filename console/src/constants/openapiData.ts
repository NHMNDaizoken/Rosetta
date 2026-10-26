// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import rawEndpoints from "./foundationEndpoints.json";

export interface ApiParameterDef {
  name: string;
  required: boolean;
  schema: Record<string, unknown>;
  description: string;
}

export interface ApiEndpointDef {
  path: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  operationId: string;
  summary: string;
  description: string;
  tags: string[];
  security: unknown[];
  responses: string[];
  hasRequestBody: boolean;
  requestContentTypes: string[];
  pathParameters: ApiParameterDef[];
  queryParameters: ApiParameterDef[];
  headerParameters: ApiParameterDef[];
  successStatus: string | null;
  successContentType: string | null;
  successHasBody: boolean;
}

export const FOUNDATION_ENDPOINTS: ApiEndpointDef[] = rawEndpoints as ApiEndpointDef[];

export const OPENAPI_TAGS = [
  { id: "all", label: "Tất cả nhóm", enLabel: "All Tags" },
  { id: "process", label: "Tiến trình Core (Process)", enLabel: "Core Process" },
  { id: "tenant", label: "Định danh & Tenant (Tenant)", enLabel: "Tenant Identity" },
  { id: "app-resource", label: "Tài nguyên cấp App v2 (App Resources)", enLabel: "v2 App Resources" },
  { id: "application-admin", label: "Quản trị ứng dụng (Application Admin)", enLabel: "Application Admin" },
  { id: "legacy-tenant", label: "Tài nguyên cũ v1 (Legacy Tenant)", enLabel: "Legacy v1 Resources" },
  { id: "oidc-upstream", label: "Keycloak OIDC Upstream", enLabel: "Keycloak Upstream OIDC" },
];

const DEFAULT_BASE_URL = "http://127.0.0.1:8080";
const UUID = "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f";
const EXECUTION_ID = "rosetta_checkpoint:1:example";
const BEARER_TOKEN = "<paste-bearer-token>";
const ETAG = "<etag-from-last-response>";
const DIGEST = `sha256:${"0".repeat(64)}`;

interface RequestExample {
  contentType?: string;
  json?: unknown;
  form?: Record<string, string>;
  binary?: boolean;
  query?: Record<string, string>;
}

function futureIso(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

function pathValue(name: string): string {
  if (name === "collection") return "widgets";
  if (name === "executionId") return EXECUTION_ID;
  if (name === "id" || name.endsWith("Id")) return UUID;
  return "example";
}

function resolvedPath(endpoint: ApiEndpointDef): string {
  return endpoint.path.replace(/\{([^}]+)\}/g, (_, name: string) =>
    encodeURIComponent(pathValue(name)),
  );
}

function queryString(query: Record<string, string> | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams(query);
  const value = params.toString();
  return value ? `?${value}` : "";
}

function requestExample(endpoint: ApiEndpointDef): RequestExample {
  const contentType = endpoint.requestContentTypes[0];

  if (contentType === "application/octet-stream") {
    return { contentType, binary: true };
  }

  if (contentType === "application/x-www-form-urlencoded") {
    if (endpoint.operationId === "issueOidcToken") {
      return {
        contentType,
        form: {
          grant_type: "authorization_code",
          client_id: "rosetta-local",
          code: "<authorization-code>",
          redirect_uri: "http://127.0.0.1:9876/callback",
          code_verifier: "<pkce-code-verifier>",
        },
      };
    }
    if (endpoint.operationId === "logoutOidc") {
      return {
        contentType,
        form: {
          client_id: "rosetta-local",
          refresh_token: "<refresh-token>",
        },
      };
    }
    return { contentType, form: { grant_type: "client_credentials" } };
  }

  if (contentType === "application/json") {
    switch (endpoint.operationId) {
      case "v1CreateRecord":
      case "v2CreateRecord":
      case "v1ReplaceRecordData":
      case "v2ReplaceRecordData":
        return { contentType, json: { data: { name: "example", status: "active" } } };
      case "createReadShare":
        return {
          contentType,
          json: {
            resourceType: "record",
            resourceId: UUID,
            granteeAppId: UUID,
            action: "read",
            expiresAt: futureIso(60),
          },
        };
      case "createApplication":
        return {
          contentType,
          json: {
            displayName: "Example Application",
            oauthClientId: "example-client",
            providerOrigin: "https://app.example.test",
          },
        };
      case "approveApplication":
        return { contentType, json: { approvalId: UUID } };
      case "setApplicationState":
        return { contentType, json: { action: "suspend", reason: "Operator review" } };
      case "createApplicationApproval":
        return {
          contentType,
          json: {
            resourceType: "application",
            resourceId: UUID,
            resourceDigest: DIGEST,
            resourceRevision: 1,
            requesterSubject: "operator@example.test",
            requesterAppId: UUID,
            decision: "approve",
            expiresAt: futureIso(5),
          },
        };
      case "revokeApplicationApproval":
        return { contentType, json: { reason: "Operator revoked approval" } };
      case "startWorkflow":
        return {
          contentType,
          json: {
            definitionId: EXECUTION_ID,
            input: { requestId: "example-request" },
          },
        };
      case "completeWorkflow":
        return { contentType, json: {} };
      default:
        return { contentType, json: {} };
    }
  }

  if (endpoint.operationId === "authorizeOidc") {
    return {
      query: {
        client_id: "rosetta-local",
        response_type: "code",
        redirect_uri: "http://127.0.0.1:9876/callback",
        scope: "openid",
        state: "example-state",
        code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
        code_challenge_method: "S256",
      },
    };
  }

  if (endpoint.operationId === "browserLogoutOidc") {
    return { query: { client_id: "rosetta-local", state: "example-state" } };
  }

  return {};
}

function authSchemes(endpoint: ApiEndpointDef): Set<string> {
  return new Set(
    endpoint.security.flatMap((entry) =>
      entry && typeof entry === "object" ? Object.keys(entry) : [],
    ),
  );
}

function usesBearer(endpoint: ApiEndpointDef): boolean {
  if (["issueOidcToken", "logoutOidc", "authorizeOidc", "browserLogoutOidc"].includes(endpoint.operationId)) {
    return false;
  }
  const schemes = authSchemes(endpoint);
  return schemes.has("coreBearer") || schemes.has("oidcUserToken");
}

export function getAuthLabel(endpoint: ApiEndpointDef): string | null {
  if (endpoint.operationId === "issueOidcToken") return "OIDC public PKCE / client auth";
  if (endpoint.operationId === "logoutOidc") return "OIDC logout";
  if (endpoint.operationId === "authorizeOidc" || endpoint.operationId === "browserLogoutOidc") {
    return "Browser navigation";
  }
  const schemes = authSchemes(endpoint);
  if (schemes.has("coreBearer") || schemes.has("oidcUserToken")) return "Bearer token";
  if (schemes.has("clientSecretBasic")) return "OIDC client auth";
  return null;
}

function isBrowserNavigation(endpoint: ApiEndpointDef): boolean {
  return endpoint.operationId === "authorizeOidc" || endpoint.operationId === "browserLogoutOidc";
}

function headerVariable(header: ApiParameterDef): string {
  if (header.name === "If-Match") return "ETAG";
  if (header.name === "Idempotency-Key") return "IDEMPOTENCY_KEY";
  return header.name.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
}

function fetchHeaderVariable(header: ApiParameterDef): string {
  if (header.name === "If-Match") return "etag";
  if (header.name === "Idempotency-Key") return "idempotencyKey";
  return header.name.replace(/[^A-Za-z0-9]+/g, "").replace(/^./, (value) => value.toLowerCase());
}

export function generateCurlExample(
  endpoint: ApiEndpointDef,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  const request = requestExample(endpoint);
  const url = `${baseUrl.replace(/\/$/, "")}${resolvedPath(endpoint)}${queryString(request.query)}`;
  const lines: string[] = [];
  const variables: string[] = [];

  if (usesBearer(endpoint)) {
    variables.push(`TOKEN="${BEARER_TOKEN}"`);
  }
  for (const header of endpoint.headerParameters) {
    if (header.name === "If-Match") variables.push(`ETAG="${ETAG}"`);
    else if (header.name === "Idempotency-Key") {
      variables.push(`IDEMPOTENCY_KEY="$(node -e 'console.log(crypto.randomUUID())')"`);
    } else variables.push(`${headerVariable(header)}="<value>"`);
  }
  if (variables.length > 0) lines.push(...variables, "");

  const command: string[] = [];
  if (endpoint.method === "HEAD") command.push(`curl -I "${url}"`);
  else command.push(`curl -X ${endpoint.method} "${url}"`);

  command.push("--fail-with-body", "--silent", "--show-error");
  if (isBrowserNavigation(endpoint)) command.push("--include");
  if (endpoint.successStatus === "204" && endpoint.method !== "HEAD") {
    command.push('--output /dev/null', '--write-out "%{http_code}\\n"');
  }
  if (endpoint.successContentType === "application/octet-stream" && endpoint.method === "GET") {
    command.push("--output example.bin");
  }

  if (usesBearer(endpoint)) command.push('-H "Authorization: Bearer $TOKEN"');
  for (const header of endpoint.headerParameters) {
    command.push(`-H "${header.name}: $${headerVariable(header)}"`);
  }

  if (request.contentType === "application/json") {
    command.push('-H "Content-Type: application/json"');
    command.push(`-d '${JSON.stringify(request.json, null, 2)}'`);
  } else if (request.contentType === "application/x-www-form-urlencoded") {
    command.push('-H "Content-Type: application/x-www-form-urlencoded"');
    for (const [key, value] of Object.entries(request.form ?? {})) {
      command.push(`--data-urlencode "${key}=${value}"`);
    }
  } else if (request.contentType === "application/octet-stream") {
    command.push('-H "Content-Type: application/octet-stream"');
    command.push('--data-binary "@./example.bin"');
  }

  lines.push(command.join(" \\\n  "));
  return lines.join("\n");
}

export function generateFetchExample(
  endpoint: ApiEndpointDef,
  baseUrl: string = DEFAULT_BASE_URL,
): string {
  const request = requestExample(endpoint);
  const url = `${baseUrl.replace(/\/$/, "")}${resolvedPath(endpoint)}${queryString(request.query)}`;
  const lines: string[] = [];

  if (isBrowserNavigation(endpoint)) {
    return [
      "// Browser navigation: the provider owns the login/consent or logout page.",
      `window.location.assign(${JSON.stringify(url)});`,
    ].join("\n");
  }

  if (usesBearer(endpoint)) lines.push(`const token = "${BEARER_TOKEN}";`);
  for (const header of endpoint.headerParameters) {
    if (header.name === "If-Match") lines.push(`const etag = "${ETAG}";`);
    else if (header.name === "Idempotency-Key") {
      lines.push("const idempotencyKey = crypto.randomUUID();");
    } else {
      lines.push(`const ${fetchHeaderVariable(header)} = "<value>";`);
    }
  }
  if (request.contentType === "application/octet-stream" && endpoint.method !== "GET") {
    lines.push('const file = new Blob(["example"], { type: "application/octet-stream" });');
  }
  if (lines.length > 0) lines.push("");

  const headers: string[] = [];
  if (usesBearer(endpoint)) headers.push('    "Authorization": "Bearer " + token,');
  if (request.contentType) headers.push(`    "Content-Type": "${request.contentType}",`);
  for (const header of endpoint.headerParameters) {
    headers.push(`    "${header.name}": ${fetchHeaderVariable(header)},`);
  }

  const fetchLines: string[] = [
    `const response = await fetch(${JSON.stringify(url)}, {`,
    `  method: "${endpoint.method}",`,
  ];
  if (headers.length > 0) {
    fetchLines.push("  headers: {", ...headers, "  },");
  }
  if (request.contentType === "application/json") {
    fetchLines.push(`  body: JSON.stringify(${JSON.stringify(request.json, null, 2)}),`);
  } else if (request.contentType === "application/x-www-form-urlencoded") {
    fetchLines.push(`  body: new URLSearchParams(${JSON.stringify(request.form ?? {}, null, 2)}),`);
  } else if (request.contentType === "application/octet-stream" && endpoint.method !== "GET") {
    fetchLines.push("  body: file,");
  }
  fetchLines.push("});");
  lines.push(...fetchLines);

  if (!endpoint.successHasBody) {
    lines.push(
      "if (!response.ok) {",
      "  throw new Error(`HTTP ${response.status}: ${await response.text()}`);",
      "}",
      `// ${endpoint.successStatus ?? "Success"} has no response body.`,
    );
  } else if (endpoint.successContentType === "application/octet-stream") {
    lines.push(
      "if (!response.ok) {",
      "  throw new Error(`HTTP ${response.status}: ${await response.text()}`);",
      "}",
      "const blob = await response.blob();",
    );
  } else {
    lines.push(
      "if (!response.ok) {",
      "  throw new Error(`HTTP ${response.status}: ${await response.text()}`);",
      "}",
      "const result = await response.json();",
    );
  }

  return lines.filter((line) => line !== "").join("\n");
}
