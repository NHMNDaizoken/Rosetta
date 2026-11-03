// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import assert from "node:assert/strict";
import { spawnSync, execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { test } from "node:test";
import { createServer } from "node:http";
import { promisify } from "node:util";

test("setup uses template, unique secrets and exclusive creation; rejects invalid options", () => {
  const dir = mkdtempSync(join(tmpdir(), "junctura-setup-"));
  try {
    const file = join(dir, ".env");
    const run = (...args) => spawnSync(process.execPath, ["scripts/setup-local.mjs", "--output", file, ...args], { encoding: "utf8" });
    assert.equal(run("--port", "18080", "--console-port", "13000", "--project", "junctura-test").status, 0);
    const bytes = readFileSync(file, "utf8"), env = parseEnv(bytes);
    const secrets = Object.entries(env).filter(([key]) => /PASSWORD|SECRET/.test(key)).map(([, value]) => value);
    assert.equal(secrets.length, 12);
    assert.equal(new Set(secrets).size, secrets.length);
    assert.ok(secrets.every(value => /^[a-f0-9]{64}$/.test(value)));
    assert.equal(env.C4A_ENABLED, "false"); assert.equal(env.C4B_ENABLED, "false");
    assert.equal(env.PUBLIC_URL, "http://127.0.0.1:18080");
    assert.equal(env.COMPOSE_PROJECT_NAME, "junctura-test");
    const again = run();
    assert.equal(again.status, 1); assert.equal(readFileSync(file, "utf8"), bytes);
    assert.ok(!again.stderr.includes(secrets[0]));
    assert.equal(run("--port", "invalid").status, 1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("readiness probe fails when liveness succeeds but dependencies are unavailable", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.url === "/health") res.end(JSON.stringify({ service: "junctura-core", status: "ok" }));
    else { res.statusCode = 503; res.end('{"error":"not_ready"}'); }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ["scripts/check-health.mjs", "--ready"],
      { env: { ...process.env, PORT: String(server.address().port) } }), error => error.code === 1 && /health check failed/.test(error.stderr));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
