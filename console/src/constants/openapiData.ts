// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import rawEndpoints from "./foundationEndpoints.json";

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

export function generateCurlExample(endpoint: ApiEndpointDef, baseUrl: string = "http://127.0.0.1:8080"): string {
  let curl = `curl -X ${endpoint.method} "${baseUrl}${endpoint.path}" \\\n`;
  if (endpoint.security && endpoint.security.length > 0) {
    curl += `  -H "Authorization: Bearer <token>" \\\n`;
  }
  if (endpoint.hasRequestBody) {
    curl += `  -H "Content-Type: application/json" \\\n`;
    if (endpoint.path.includes("/applications")) {
      curl += `  -d '{\n    "displayName": "My Application",\n    "oauthClientId": "app-client-01",\n    "providerOrigin": "https://app.provider.local"\n  }'`;
    } else if (endpoint.path.includes("/approvals")) {
      curl += `  -d '{\n    "resourceType": "application",\n    "resourceId": "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",\n    "decision": "approve",\n    "expiresAt": "2026-10-26T00:00:00.000Z"\n  }'`;
    } else if (endpoint.path.includes("/workflows/executions")) {
      curl += `  -H "Idempotency-Key: c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f" \\\n`;
      curl += `  -d '{\n    "definitionId": "rosetta_checkpoint:1:7f4a2b10",\n    "input": { "test": true }\n  }'`;
    } else if (endpoint.path.includes("/data/")) {
      curl += `  -d '{\n    "data": { "item": "example", "status": "active" }\n  }'`;
    } else {
      curl += `  -d '{\n    "example": true\n  }'`;
    }
  } else {
    curl = curl.trimEnd().replace(/\\$/, "");
  }
  return curl;
}

export function generateFetchExample(endpoint: ApiEndpointDef, baseUrl: string = "http://127.0.0.1:8080"): string {
  let ts = `const response = await fetch("${baseUrl}${endpoint.path}", {\n`;
  ts += `  method: "${endpoint.method}",\n`;
  ts += `  headers: {\n`;
  if (endpoint.security && endpoint.security.length > 0) {
    ts += `    "Authorization": "Bearer " + token,\n`;
  }
  if (endpoint.hasRequestBody) {
    ts += `    "Content-Type": "application/json",\n`;
  }
  ts += `  },\n`;
  if (endpoint.hasRequestBody) {
    ts += `  body: JSON.stringify({ /* payload */ }),\n`;
  }
  ts += `});\nconst result = await response.json();`;
  return ts;
}
