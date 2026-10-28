// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Executable server-side HTTP example, not an SDK. Never run with browser secrets.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export async function foundationExample({ base, clientId, clientSecret, granteeAppId,
  granteeClientId, granteeClientSecret, fetcher = fetch }) {
  assert.ok(base && clientId && clientSecret && granteeAppId, 'An active enrolled backend and grantee are required');
  assert.ok(Boolean(granteeClientId) === Boolean(granteeClientSecret), 'Grantee client ID and secret must be supplied together');

  async function authenticate(enrolledClientId, enrolledSecret) {
    const issued = await fetcher(`${base}/identity/realms/rosetta/protocol/openid-connect/token`, {
      method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: enrolledClientId, client_secret: enrolledSecret }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    assert.equal(issued.status, 200, 'Backend authentication failed');
    return (await issued.json()).access_token; // private process memory only
  }

  const token = await authenticate(clientId, clientSecret);
  async function request(path, requestToken = token, method = 'GET', body, headers = {}) {
    return fetcher(base + path, { method, body, headers: { Authorization: `Bearer ${requestToken}`, ...headers },
      redirect: 'error', signal: AbortSignal.timeout(15000) });
  }
  async function json(path, body, headers = {}, requestToken = token) {
    return request(path, requestToken, 'POST', JSON.stringify(body), { 'Content-Type': 'application/json', ...headers });
  }

  const verified = await request('/v1/identity');
  assert.equal(verified.status, 200);
  const identity = await verified.json();
  assert.equal(typeof identity.subject, 'string');
  assert.equal(typeof identity.tenantId, 'string');
  assert.ok(Array.isArray(identity.roles));

  const created = await json('/v2/data/http_example', { data: { technicalFixture: true } });
  assert.equal(created.status, 201);
  const record = await created.json();
  const fetched = await request(`/v2/data/http_example/${record.id}`);
  assert.equal(fetched.status, 200);
  assert.deepEqual((await fetched.json()).data, { technicalFixture: true });

  const granteeToken = granteeClientId ? await authenticate(granteeClientId, granteeClientSecret) : undefined;
  let deniedBeforeShare = false;
  if (granteeToken) {
    const denied = await request(`/v2/data/http_example/${record.id}`, granteeToken);
    assert.equal(denied.status, 404, 'Another application must not read a private record before a share');
    deniedBeforeShare = true;
  }

  const bytes = Buffer.from('Rosetta technical HTTP example');
  const uploaded = await request('/v2/objects', token, 'POST', bytes, { 'Content-Type': 'application/octet-stream' });
  assert.equal(uploaded.status, 201);
  const object = await uploaded.json();
  const download = await request(`/v2/objects/${object.id}`);
  assert.equal(download.status, 200);
  assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);

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

  const granted = await json('/v2/resource-shares', { resourceType: 'record', resourceId: record.id,
    granteeAppId, action: 'read', expiresAt: new Date(Date.now() + 600000).toISOString() });
  assert.equal(granted.status, 201);
  const share = await granted.json();

  let sharedReadAllowed = false;
  if (granteeToken) {
    const shared = await request(`/v2/data/http_example/${record.id}`, granteeToken);
    assert.equal(shared.status, 200, 'The explicit read share must allow the grantee');
    assert.deepEqual((await shared.json()).data, { technicalFixture: true });
    sharedReadAllowed = true;
  }

  return { recordId: record.id, objectId: object.id, shareId: share.shareId, executionId: execution.id,
    deniedBeforeShare, sharedReadAllowed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = await foundationExample({ base: process.env.PUBLIC_URL ?? 'http://127.0.0.1:8080',
      clientId: process.env.ROSETTA_APP_CLIENT_ID, clientSecret: process.env.ROSETTA_APP_CLIENT_SECRET,
      granteeAppId: process.env.ROSETTA_GRANTEE_APP_ID,
      granteeClientId: process.env.ROSETTA_GRANTEE_CLIENT_ID,
      granteeClientSecret: process.env.ROSETTA_GRANTEE_CLIENT_SECRET });
    console.log(`recordId=${result.recordId} objectId=${result.objectId} shareId=${result.shareId} executionId=${result.executionId}`);
    console.log('HTTP example succeeded. Created resources and expiring share remain owned by the backend; credentials and tokens withheld.');
  } catch {
    console.error('HTTP example failed. Check enrollment, active app state and the local stack. POST outcomes may be ambiguous; do not blindly rerun.');
    process.exitCode = 1;
  }
}
