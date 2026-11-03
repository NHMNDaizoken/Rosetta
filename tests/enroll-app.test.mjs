// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArgs, renderEnv } from "../scripts/enroll-app.mjs";

test("app:enroll derives a client id and default https origin", () => {
  const options = parseArgs(["daotao"]);
  assert.equal(options.clientId, "app-daotao");
  assert.equal(options.tenant, "tenant-a");
  assert.equal(options.origin, "https://app-daotao.rosetta.local");
  assert.equal(options.displayName, "daotao");
});

test("app:enroll accepts explicit tenant, origin and display name", () => {
  const options = parseArgs(["tai-chinh", "--tenant", "tenant-b", "--origin", "https://finance.example.org", "--display-name", "Tài chính"]);
  assert.deepEqual([options.tenant, options.origin, options.displayName], ["tenant-b", "https://finance.example.org", "Tài chính"]);
});

test("app:enroll rejects unsafe names, origins and options", () => {
  for (const argv of [[], ["Bad"], ["x"], ["a b"], ["ok", "--origin", "http://plain.example.org"], ["ok", "--origin", "https://10.0.0.1"],
    ["ok", "--origin", "https://x.example.org/path"], ["ok", "--bogus"], ["ok", "extra"], ["ok", "--tenant", "Bad_Tenant"]]) {
    assert.throws(() => parseArgs(argv), undefined, JSON.stringify(argv));
  }
  assert.equal(parseArgs(["--help"]).help, true);
});

test("app:enroll writes only the app's own settings", () => {
  const text = renderEnv({ baseUrl: "http://127.0.0.1:8080", tenant: "tenant-a", appId: "00000000-0000-4000-8000-000000000000", clientId: "app-x", clientSecret: "s" });
  assert.match(text, /^ROSETTA_APP_CLIENT_ID=app-x$/m);
  assert.match(text, /^ROSETTA_APP_CLIENT_SECRET=s$/m);
  assert.doesNotMatch(text, /KEYCLOAK|POSTGRES|ADMIN/);
});
