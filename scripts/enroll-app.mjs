// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local operator helper: enroll one Layer-2 backend application in a single command.
// It performs the reviewed operator flow from docs/GETTING_STARTED.md against the
// local Compose stack and writes the app's own credentials to an ignored env file.
// Development/demo stacks only: it creates local demo owner/approver identities.
import { existsSync, writeFileSync } from "node:fs";
import { isIP } from "node:net";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { APPROVER_PERMISSIONS, OWNER_PERMISSIONS, connectDemoStack, enrollApplication, step } from "./lib/demo-stack.mjs";

export function parseArgs(argv) {
  const options = { tenant: "tenant-a", origin: undefined, displayName: undefined, name: undefined, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--tenant") options.tenant = argv[++i];
    else if (arg === "--origin") options.origin = argv[++i];
    else if (arg === "--display-name") options.displayName = argv[++i];
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else if (options.name === undefined) options.name = arg;
    else throw new Error(`Unexpected argument ${arg}`);
  }
  if (options.help) return options;
  if (!/^[a-z][a-z0-9-]{1,39}$/.test(options.name ?? "")) throw new Error("App name must be 2-40 lowercase letters, digits or '-', starting with a letter");
  if (!/^[a-z][a-z0-9-]{0,62}$/.test(options.tenant ?? "")) throw new Error("Invalid --tenant");
  options.clientId = `app-${options.name}`;
  options.origin ??= `https://${options.clientId}.junctura.local`;
  const origin = new URL(options.origin);
  if (origin.protocol !== "https:" || origin.origin !== options.origin || !origin.hostname.includes(".") ||
    isIP(origin.hostname.replace(/^\[|\]$/g, ""))) throw new Error("--origin must be an exact https origin such as https://daotao.example.org");
  options.displayName ??= options.name;
  return options;
}

export function renderEnv({ baseUrl, tenant, appId, clientId, clientSecret }) {
  return [
    "# Junctura application credentials - private, never commit or embed in a browser.",
    `JUNCTURA_URL=${baseUrl}`,
    `JUNCTURA_TENANT=${tenant}`,
    `JUNCTURA_APP_ID=${appId}`,
    `JUNCTURA_APP_CLIENT_ID=${clientId}`,
    `JUNCTURA_APP_CLIENT_SECRET=${clientSecret}`,
    "",
  ].join("\n");
}

const usage = `Usage: npm run app:enroll -- <name> [--tenant tenant-a] [--origin https://name.example.org] [--display-name "Name"]

Creates Keycloak client "app-<name>", enrolls and approves it in Junctura, and writes
its credentials to .env.app.<name>.local (ignored by Git). Requires a running local stack
(npm run local:up) and the .env created by npm run setup.`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) { console.log(usage); return; }
  const output = resolve(`.env.app.${options.name}.local`);
  if (existsSync(output)) throw new Error(`${output} already exists; this app is probably enrolled already`);

  step("Operator sign-in to Keycloak");
  const stack = await connectDemoStack({ tenant: options.tenant });
  if ((await (await stack.admin(`clients?clientId=${options.clientId}`)).json()).length) throw new Error(`Keycloak client ${options.clientId} already exists`);

  step(`Demo management client for ${options.tenant}`);
  await stack.ensureManagementClient();
  step("Demo owner and independent approver");
  const owner = await stack.human("owner", OWNER_PERMISSIONS);
  const approver = await stack.human("approver", APPROVER_PERMISSIONS);

  const { app, clientSecret } = await enrollApplication(stack, options, owner, approver);
  writeFileSync(output, renderEnv({ baseUrl: stack.base, tenant: options.tenant, appId: app.appId, clientId: options.clientId, clientSecret }), { flag: "wx", mode: 0o600 });
  console.log(`\n✔ ${options.displayName} is active (appId ${app.appId}, client ${options.clientId}).`);
  console.log(`  Credentials: ${output}`);
  console.log(`  Try: node --env-file=.env --env-file=.env.app.${options.name}.local examples/sdk-foundation.mjs --enrolled`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`✖ ${error.message}`); process.exitCode = 1; });
}
