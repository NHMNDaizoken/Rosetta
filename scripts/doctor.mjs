// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
import { spawnSync } from "node:child_process";
import { createServer } from "node:net";

// Never print configuration values or subprocess output: both may contain secrets.
const { values } = parseArgs({ options: { "config": { type: "string", default: ".env" } } });
let failed = false;
function report(ok, message, remedy) {
  console.log(`${ok ? "OK" : "FAIL"} ${message}${ok ? "" : ` — ${remedy}`}`);
  if (!ok) failed = true;
}
const command = (args) => spawnSync("docker", args, { encoding: "utf8", timeout: 15000, windowsHide: true });
report(Number(process.versions.node.split(".")[0]) === 24, "Node 24", "Install the version in .node-version.");
const engine = command(["info", "--format", "{{.OSType}}"]);
report(engine.status === 0 && engine.stdout?.trim() === "linux", "Docker Linux engine", "Start Docker Desktop in Linux container mode.");
report(command(["compose", "version"]).status === 0, "Docker Compose", "Install Docker Compose v2.20+.");
let env;
try { env = { ...parseEnv(readFileSync(values["config"], "utf8")), ...process.env }; }
catch { report(false, "Local configuration", "Run npm run setup; preserve existing configuration."); }
if (env) {
  const required = [...readFileSync(new URL("../.env.example", import.meta.url), "utf8").matchAll(/^([A-Z_]+)=$/gm)].map(m => m[1]);
  const missing = required.filter(key => !env[key]);
  report(!missing.length, "Required configuration keys", `Set missing keys: ${missing.join(", ")}. Do not regenerate existing database passwords.`);
  for (const flag of ["C4A", "C4B"]) {
    report([undefined, "true", "false"].includes(env[`${flag}_ENABLED`]), `${flag} flag syntax`, "Use true or false.");
    if (env[`${flag}_ENABLED`] === "true") {
      let valid = false;
      try {
        const origins = JSON.parse(env[`${flag}_PROVIDER_ORIGINS`] ?? "[]");
        valid = Array.isArray(origins) && origins.length > 0 && origins.every(origin => {
          const url = new URL(origin); return url.protocol === "https:" && url.origin === origin;
        });
      } catch { /* Report key names only. */ }
      report(valid, `${flag} execution ENABLED: approved origins required`, "Review exact HTTPS origins and operator enrollment; keep execution disabled unless intended.");
    } else console.log(`OK ${flag} execution disabled`);
  }
  const configured = spawnSync("docker", ["compose", "--env-file", values["config"], "--profile", "console", "config", "--quiet"],
    { env, timeout: 15000, windowsHide: true, encoding: "utf8" });
  report(configured.status === 0, "Compose configuration", "Compare key names with .env.example; run docker compose config --quiet privately.");
  for (const [name, raw, path] of [["Gateway", env.PORT ?? "8080", "/ready"], ["Console", env.CONSOLE_PORT ?? "3000", "/healthz"]]) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 65535) {
      report(false, `${name} port`, "Use a port between 1 and 65535."); continue;
    }
    const port = Number(raw);
    let ready = false;
    try {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(15000) });
      ready = response.ok && (name === "Console" || (await response.json()).status === "ready");
    } catch { /* Check port availability below. */ }
    if (ready) console.log(`OK ${name} ready`);
    else {
      const available = await new Promise(resolve => {
        const server = createServer();
        server.once("error", () => resolve(false));
        server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
      });
      // Before installation, free ports are useful success, not failed readiness.
      if (available) console.log(`OK ${name} port available; service stopped. Start npm run local:up.`);
      else report(false, `${name} port occupied but not ready`, "Run npm run local:status; check for another Compose project or port conflict.");
    }
  }
  let issuerMatches = false;
  try { issuerMatches = env.PUBLIC_URL === `http://127.0.0.1:${Number(env.PORT ?? 8080)}`; } catch { /* Local defaults only. */ }
  report(issuerMatches, "Local PUBLIC_URL matches Gateway", "For this local workflow use http://127.0.0.1:<PORT>. Review PKCE callback settings for custom ports.");
}
for (const [tool, args] of [["python", ["-c", "import jsonschema, referencing"]], ["openssl", ["version"]]]) {
  const result = spawnSync(tool, args, { timeout: 10000, windowsHide: true, encoding: "utf8" });
  console.log(`${result.status === 0 ? "OK" : "OPTIONAL"} ${tool} integration-test tooling${result.status === 0 ? "" : ": see docs/DEVELOPING.md"}`);
}
process.exitCode = failed ? 1 : 0;
