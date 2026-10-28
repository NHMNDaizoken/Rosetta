// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Test-only HTTP observer. No runtime files, credentials or payload logs are produced.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const spec = JSON.parse(readFileSync(new URL('../docs/contracts/foundation-api.openapi.json', import.meta.url)));
const routes = Object.keys(spec.paths).map(path => ({ path, names: [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]),
  regex: new RegExp('^' + path.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{[^}]+\}/g, '([^/]+)') + '$') }));
const observations = [];
const secretNames = new Set(['client_secret', 'access_token', 'refresh_token', 'id_token', 'id_token_hint', 'code', 'code_verifier']);
function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, v]) => [key, secretNames.has(key) && typeof v === 'string' ? '[redacted]' : redact(v)]));
}

export async function contractFetch(input, options = {}) {
  const response = await globalThis.fetch(input, options);
  const url = new URL(input);
  const route = routes.find(r => r.regex.test(url.pathname));
  // Dynamic Keycloak login/admin URLs and private provider interfaces are outside this contract.
  if (!route) return response;
  const match = url.pathname.match(route.regex);
  const query = {};
  for (const [key, value] of url.searchParams) if (!Object.hasOwn(query, key)) query[key] = value;
  const headers = new Headers(options.headers);
  if (options.body instanceof URLSearchParams && !headers.has('content-type')) headers.set('content-type', 'application/x-www-form-urlencoded;charset=UTF-8');
  const requestBytes = options.body === undefined ? 0 : Buffer.byteLength(options.body instanceof URLSearchParams ? options.body.toString() : options.body);
  const safeHeaders = ['content-type', 'if-match', 'idempotency-key'];
  const item = { path: route.path, method: options.method ?? 'GET', status: response.status, authorized: headers.has('authorization'),
    pathParams: Object.fromEntries(route.names.map((name, i) => [name, decodeURIComponent(match[i + 1])])), query: redact(query),
    requestHeaders: Object.fromEntries(safeHeaders.filter(name => headers.has(name)).map(name => [name, headers.get(name)])), requestBytes,
    responseHeaders: Object.fromEntries(['content-type', 'content-length', 'cache-control', 'x-content-type-options', 'etag', 'location', 'content-disposition', 'allow']
      .filter(name => response.headers.has(name)).map(name => [name, response.headers.get(name)])) };
  if (item.responseHeaders.location) item.responseHeaders.location = item.responseHeaders.location.replace(/([?&](?:code|id_token|access_token)=)[^&]*/g, '$1[redacted]');
  if (options.body instanceof URLSearchParams) item.requestBody = redact(Object.fromEntries(options.body));
  else if (headers.get('content-type')?.startsWith('application/json')) {
    try { item.requestBody = redact(JSON.parse(options.body)); } catch { item.requestInvalidJson = true; }
  }
  const bytes = Buffer.from(await response.clone().arrayBuffer());
  item.responseBytes = bytes.length;
  if (response.headers.get('content-type')?.startsWith('application/json') && bytes.length) {
    try { item.responseBody = redact(JSON.parse(bytes.toString('utf8'))); } catch { item.responseInvalidJson = true; }
  }
  observations.push(item);
  return response;
}

export async function verifyContracts(suite, batch = observations.splice(0), mode = '--runtime') {
  return new Promise((resolve, reject) => {
    const child = spawn(process.env.PYTHON ?? 'python', ['-B', 'scripts/check-contracts.py', mode], { stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? (console.log(output.trim()), resolve()) : reject(new Error(output.trim())));
    child.stdin.on('error', reject);
    child.stdin.end(JSON.stringify({ suite, observations: batch }));
  });
}
