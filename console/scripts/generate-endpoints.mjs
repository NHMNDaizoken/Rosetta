// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const consoleDir = path.resolve(scriptDir, "..");
const repoDir = path.resolve(consoleDir, "..");
const specPath = path.join(repoDir, "docs", "contracts", "foundation-api.openapi.json");
const outputPath = path.join(consoleDir, "src", "constants", "foundationEndpoints.json");
const methods = new Set(["get", "head", "post", "put", "patch", "delete", "options"]);

const spec = JSON.parse(fs.readFileSync(specPath, "utf8"));

function resolveRef(value, seen = new Set()) {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((item) => resolveRef(item, seen));
  if (typeof value.$ref === "string") {
    if (!value.$ref.startsWith("#/")) throw new Error(`Unsupported reference: ${value.$ref}`);
    if (seen.has(value.$ref)) throw new Error(`Circular reference: ${value.$ref}`);
    const nextSeen = new Set(seen).add(value.$ref);
    const target = value.$ref
      .slice(2)
      .split("/")
      .reduce((node, key) => node?.[key], spec);
    if (target === undefined) throw new Error(`Unresolved reference: ${value.$ref}`);
    return resolveRef(target, nextSeen);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, resolveRef(item, seen)]),
  );
}

function operationParameters(pathItem, operation) {
  return [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])]
    .map((parameter) => resolveRef(parameter))
    .filter((parameter) => parameter && parameter.in && parameter.name);
}

function summarize(parameter) {
  return {
    name: parameter.name,
    required: parameter.required === true,
    schema: parameter.schema ?? {},
    description: parameter.description ?? "",
  };
}

const endpoints = [];
for (const [endpointPath, pathItem] of Object.entries(spec.paths)) {
  for (const [method, operation] of Object.entries(pathItem)) {
    if (!methods.has(method) || !operation.operationId) continue;
    const parameters = operationParameters(pathItem, operation);
    const requestContentTypes = Object.keys(operation.requestBody?.content ?? {});
    const responses = Object.keys(operation.responses ?? {});
    const successStatuses = responses
      .filter((status) => /^2\d\d$/.test(status))
      .sort((a, b) => Number(a) - Number(b));
    const successStatus = successStatuses[0] ?? null;
    const successContentTypes = successStatus
      ? Object.keys(operation.responses[successStatus]?.content ?? {})
      : [];

    endpoints.push({
      path: endpointPath,
      method: method.toUpperCase(),
      operationId: operation.operationId,
      summary: operation.summary ?? "",
      description: operation.description ?? "",
      tags: operation.tags ?? [],
      security: operation.security ?? spec.security ?? [],
      responses,
      hasRequestBody: Boolean(operation.requestBody),
      requestContentTypes,
      pathParameters: parameters.filter((parameter) => parameter.in === "path").map(summarize),
      queryParameters: parameters.filter((parameter) => parameter.in === "query").map(summarize),
      headerParameters: parameters.filter((parameter) => parameter.in === "header").map(summarize),
      successStatus,
      successContentType: successContentTypes[0] ?? null,
      successHasBody: successContentTypes.length > 0 || successStatus === "304",
    });
  }
}

const operationIds = new Set();
for (const endpoint of endpoints) {
  if (operationIds.has(endpoint.operationId)) {
    throw new Error(`Duplicate operationId: ${endpoint.operationId}`);
  }
  operationIds.add(endpoint.operationId);
}

const generated = `${JSON.stringify(endpoints, null, 2)}\n`;
if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== generated) {
    console.error("foundationEndpoints.json is stale; run npm run generate:endpoints");
    process.exitCode = 1;
  } else {
    console.log(`Foundation endpoint inventory is current (${endpoints.length} operations)`);
  }
} else {
  fs.writeFileSync(outputPath, generated);
  console.log(`Wrote ${endpoints.length} operations to ${path.relative(repoDir, outputPath)}`);
}
