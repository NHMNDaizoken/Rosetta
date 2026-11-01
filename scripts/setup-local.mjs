// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";

const names = [
  "POSTGRES_PASSWORD", "IDENTITY_DB_PASSWORD", "DATA_DB_PASSWORD",
  "WORKFLOW_DB_PASSWORD", "KEYCLOAK_ADMIN_PASSWORD", "CORE_CLIENT_SECRET",
  "TENANT_A_SECRET", "TENANT_B_SECRET", "READER_SECRET", "SSO_USER_PASSWORD",
  "DATA_JWT_SECRET", "WORKFLOW_ADMIN_PASSWORD",
];
try {
  const { values } = parseArgs({ options: {
    "output": { type: "string", default: ".env" },
    port: { type: "string", default: "8080" },
    "console-port": { type: "string", default: "3000" },
    project: { type: "string" },
  } });
  for (const port of [values.port, values["console-port"]]) {
    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error();
  }
  if (values.port === values["console-port"]) throw Error();
  if (values.project && !/^[a-z0-9][a-z0-9_-]*$/.test(values.project)) throw Error();
  let template = readFileSync(new URL("../.env.example", import.meta.url), "utf8").replace(/\r\n/g, "\n");
  for (const name of names) template = template.replace(new RegExp(`^${name}=.*$`, "m"), `${name}=${randomBytes(32).toString("hex")}`);
  template = template.replace(/^PORT=.*$/m, `PORT=${values.port}`)
    .replace(/^PUBLIC_URL=.*$/m, `PUBLIC_URL=http://127.0.0.1:${values.port}`)
    .replace(/^CONSOLE_PORT=.*$/m, `CONSOLE_PORT=${values["console-port"]}`);
  if (values.project) template += `\nCOMPOSE_PROJECT_NAME=${values.project}\n`;
  writeFileSync(values["output"], template, { flag: "wx", mode: 0o600 });
  console.log("Created local configuration with random credentials; existing files are never overwritten.");
  console.log("Next: npm run doctor, npm run local:up, npm run healthcheck. See docs/GETTING_STARTED.md.");
} catch (error) {
  if (error.code === "EEXIST") console.error(".env already exists; preserve it and add missing settings manually");
  else console.error("Could not create configuration. Check options, distinct ports (1-65535), and directory permissions.");
  process.exitCode = 1;
}
