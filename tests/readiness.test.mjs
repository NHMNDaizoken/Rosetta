// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkReadiness } from "../src/bootstrap/readiness.mjs";

const issuer = "http://identity.test/realms/rosetta";
const config = { issuer, identityUrl: "http://identity.test" };

test("readiness accepts only a responding identity provider with the configured issuer", async () => {
  await checkReadiness(config, async () => Response.json({ issuer }));
  await assert.rejects(checkReadiness(config, async () => Response.json({ issuer: "http://other.test" })), /Identity not ready/);
  await assert.rejects(checkReadiness(config, async () => new Response("", { status: 503 })), /Identity not ready/);
  await assert.rejects(checkReadiness(config, async () => { throw new Error("offline"); }), /offline/);
});

test("readiness rejects a configured object store with no registered volume", async () => {
  const withObjects = { ...config, objectsUrl: "http://filer.test", objectsMasterUrl: "http://master.test" };
  await assert.rejects(checkReadiness(withObjects, async () => Response.json({ issuer })), /No object volume/);
});
