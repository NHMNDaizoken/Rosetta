// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { test } from "node:test";
import { checkObjectReadiness } from "../src/modules/objects/objects.mjs";

test("object readiness requires registered storage as well as responding metadata", async () => {
  const config = { objectsUrl: "http://filer.test", objectsMasterUrl: "http://master.test" };
  let nodes = [];
  const request = async (url) => url.startsWith(config.objectsUrl)
    ? new Response("{}")
    : Response.json({ Topology: { DataCenters: [{ Racks: [{ DataNodes: nodes }] }] } });
  await assert.rejects(checkObjectReadiness(config, request), /No object volume/);
  nodes = [{ Max: 4 }];
  await checkObjectReadiness(config, request);
  await assert.rejects(checkObjectReadiness(config, async () => new Response("", { status: 503 })), /Filer not ready/);
});
