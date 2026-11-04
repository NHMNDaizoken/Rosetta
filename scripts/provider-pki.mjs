// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Local provider PKI for internal capability providers (development stacks only).
//   npm run provider:pki -- tramyte benhvien      -> tramyte.provider.internal, ...
// Creates (once) a private provider CA and one TLS server certificate per
// provider under .junctura/pki/ (Git-ignored). Core trusts internal providers
// only through this CA; private keys never leave that directory.
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DNS_NAME, issueCertificate } from "./lib/x509.mjs";

export const PKI_DIR = ".junctura/pki";
export const SUFFIX = ".provider.internal";
const CA_SUBJECT = { commonName: "Junctura Local Provider CA", organization: "Junctura DX-OS (local)" };

export function hostFor(name) {
  const host = name.includes(".") ? name : `${name}${SUFFIX}`;
  if (!DNS_NAME.test(host) || !host.endsWith(".internal")) {
    throw new Error(`Invalid provider name ${name}: use lowercase letters, digits and '-', e.g. tramyte (-> tramyte${SUFFIX})`);
  }
  return host;
}

export function parseArgs(argv) {
  const options = { names: [], port: 8443, force: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--port") options.port = Number(argv[++i]);
    else if (arg === "--force") options.force = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option ${arg}`);
    else options.names.push(arg);
  }
  if (!options.names.length) throw new Error("Usage: npm run provider:pki -- <name> [<name>...] [--port 8443] [--force]");
  if (!Number.isSafeInteger(options.port) || options.port < 1 || options.port > 65535) throw new Error("--port must be 1-65535");
  options.hosts = [...new Set(options.names.map(hostFor))];
  return options;
}

const write = (path, text, secret) => {
  writeFileSync(path, text, { mode: secret ? 0o600 : 0o644 });
  if (secret) chmodSync(path, 0o600);
};

export function ensurePki({ hosts, force = false, directory = PKI_DIR, now = new Date() }) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const caCert = join(directory, "ca.crt"), caKey = join(directory, "ca.key");
  let ca;
  if (existsSync(caCert) && existsSync(caKey)) {
    ca = { cert: readFileSync(caCert, "utf8"), key: readFileSync(caKey, "utf8"), subject: CA_SUBJECT };
  } else {
    ca = issueCertificate({ subject: CA_SUBJECT, days: 3650, now });
    write(caKey, ca.key, true);
    write(caCert, ca.cert, false);
  }
  const issued = [];
  for (const host of hosts) {
    const cert = join(directory, `${host}.crt`), key = join(directory, `${host}.key`);
    if (!force && existsSync(cert) && existsSync(key)) continue;
    const leaf = issueCertificate({ subject: { commonName: host }, dnsNames: [host], issuer: ca, days: 825, now });
    write(key, leaf.key, true);
    write(cert, leaf.cert, false);
    issued.push(host);
  }
  return { caCert, issued };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const { caCert, issued } = ensurePki(options);
    console.log(`✔ Provider CA: ${caCert}`);
    for (const host of options.hosts) console.log(`  ${issued.includes(host) ? "issued " : "kept   "} ${host} (${PKI_DIR}/${host}.crt, .key)`);
    const origins = JSON.stringify(options.hosts.map(host => `https://${host}:${options.port}`));
    console.log("\nAdd to .env, then restart with the providers override:");
    console.log(`  C4A_ENABLED=true\n  C4A_INTERNAL_PROVIDER_ORIGINS=${origins}`);
    console.log("  docker compose -f compose.yaml -f compose.providers.yaml up -d core");
    console.log("Keep .junctura/pki private: it holds the CA and provider keys.");
  } catch (error) {
    console.error(`✖ ${error.message}`);
    process.exitCode = 1;
  }
}
