// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { test } from "node:test";
import { createApi } from "../src/api.mjs";
import { readExecutionJson } from "../src/modules/capability/execution/runtime.mjs";

test("execution routes remain absent when the guarded runtime is not configured", async () => {
  const route = createApi({});
  for (const path of ["/v1/capability-executions", "/v1/capability-executions/11111111-1111-4111-8111-111111111111", "/v1/capability-authorizations/introspect"]) {
    await assert.rejects(route({ url: path, method: "POST", headers: {} }, {}), error => error.status === 404);
  }
});

test("execution wire parsing rejects duplicate keys, malformed encoding and oversized bodies before reservation", async () => {
  for (const bytes of [Buffer.from('{"input":1,"input":2}'), Buffer.from('{"a":"\\ud800"}'), Buffer.from([123, 34, 97, 34, 58, 34, 255, 34, 125]), Buffer.from("[]")]) {
    const request = Readable.from([bytes]); request.headers = { "content-type": "application/json" };
    await assert.rejects(readExecutionJson(request), error => error.status === 400);
  }
  const large = Readable.from([Buffer.from(`{"a":"${"x".repeat(65536)}"}`)]); large.headers = { "content-type": "application/json" };
  await assert.rejects(readExecutionJson(large), error => error.status === 413);
  const good = Readable.from([Buffer.from('{"input":{"value":"🙂"}}')]); good.headers = { "content-type": "application/json" };
  assert.deepEqual(await readExecutionJson(good), { input: { value: "🙂" } });
});
