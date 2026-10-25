// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Executable server-side HTTP example, not an SDK. Never run with browser secrets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function foundationExample({ base, clientId, clientSecret, granteeAppId, fetcher = fetch }) {
  assert.ok(base && clientId && clientSecret && granteeAppId, 'An active enrolled backend and grantee are required');
  const issued = await fetcher(`${base}/identity/realms/rosetta/protocol/openid-connect/token`, {
    method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
    redirect: 'error', signal: AbortSignal.timeout(15000),
  });
  assert.equal(issued.status, 200, 'Backend authentication failed');
  const token = (await issued.json()).access_token; // private process memory only
  async function request(path, method = 'GET', body, headers = {}) {
    return fetcher(base + path, { method, body, headers: { Authorization: `Bearer ${token}`, ...headers },
      redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  async function json(path, body, headers = {}) {
    return request(path, 'POST', JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
  }
  const created = await json('/v2/data/http_example', { data: { technicalFixture: true } });
  assert.equal(created.status, 201);
  const record = await created.json();
  const bytes = Buffer.from('Rosetta technical HTTP example');
  const uploaded = await request('/v2/objects', 'POST', bytes, { 'Content-Type': 'application/octet-stream' });
  assert.equal(uploaded.status, 201);
  const object = await uploaded.json();
  const download = await request(`/v2/objects/${object.id}`);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
  const granted = await json('/v2/resource-shares', { resourceType: 'record', resourceId: record.id,
    granteeAppId, action: 'read', expiresAt: new Date(Date.now() + 600000).toISOString() });
  assert.equal(granted.status, 201);
  const share = await granted.json();
  const definitions = await request('/v1/workflows/definitions');
  assert.equal(definitions.status, 200);
  const definition = (await definitions.json()).items.find(item => item.key === 'rosetta_checkpoint');
  assert.ok(definition, 'Operator-installed technical checkpoint required');
  // Workflow variables remain tenant-visible: no private record/object content here.
  const started = await json('/v1/workflows/executions', { definitionId: definition.id, input: { technicalFixture: true } },
    { 'Idempotency-Key': randomUUID() });
  assert.equal(started.status, 201);
  const execution = await started.json();
  const inspected = await request(`/v1/workflows/executions/${encodeURIComponent(execution.id)}`);
  assert.equal(inspected.status, 200);
  assert.equal((await inspected.json()).status, 'running');
  const completed = await json(`/v1/workflows/executions/${encodeURIComponent(execution.id)}/complete`, {});
  assert.equal(completed.status, 200);
  assert.equal((await completed.json()).status, 'completed');
  return { recordId: record.id, objectId: object.id, shareId: share.shareId, executionId: execution.id };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await foundationExample({ base: process.env.PUBLIC_URL ?? 'http://127.0.0.1:8080',
      clientId: process.env.ROSETTA_APP_CLIENT_ID, clientSecret: process.env.ROSETTA_APP_CLIENT_SECRET,
      granteeAppId: process.env.ROSETTA_GRANTEE_APP_ID });
    console.log('HTTP example succeeded. Created resources and expiring share remain owned by the backend; credentials and tokens withheld.');
  } catch {
    console.error('HTTP example failed. Check enrollment, active app state and the local stack. POST outcomes may be ambiguous; do not blindly rerun.');
    process.exitCode = 1;
  }
}
