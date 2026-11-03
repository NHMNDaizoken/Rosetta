// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
const port = process.env.PORT ?? "8080";
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2000),
  });
  const body = await response.json();
  if (response.status !== 200 || body.service !== "rosetta-core" || body.status !== "ok") {
    throw new Error("Unexpected health response");
  }
  if (process.argv.includes("--ready")) {
    const ready = await fetch(`http://127.0.0.1:${port}/ready`, { signal: AbortSignal.timeout(15000) });
    if (!ready.ok || (await ready.json()).status !== "ready") throw Error();
    console.log("Gateway liveness and configured Foundation readiness passed");
  }
} catch {
  console.error("Platform health check failed. Run npm run doctor; inspect npm run local:status.");
  process.exitCode = 1;
}
