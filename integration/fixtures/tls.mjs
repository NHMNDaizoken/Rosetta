// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export function removeTlsDirectory(directory) {
  const target = resolve(directory);
  if (dirname(target) !== resolve(tmpdir()) || !/^rosetta-(?:provider|c4a)-/.test(basename(target))) throw new Error("Unexpected TLS fixture cleanup path");
  rmSync(target, { recursive: true, force: true });
}

// Synthetic one-day credentials only. The caller owns the temporary directory.
export function generateTls(directory, name, alternative) {
  const keyPath = join(directory, `${name}.key.pem`), certPath = join(directory, `${name}.cert.pem`), configPath = join(directory, `${name}.cnf`);
  writeFileSync(configPath, "[req]\ndistinguished_name=dn\nprompt=no\n[dn]\nCN=localhost\n");
  const environment = { ...process.env }; delete environment.OPENSSL_CONF;
  const result = spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-sha256", "-days", "1", "-nodes",
    "-config", configPath, "-keyout", keyPath, "-out", certPath, "-subj", `/CN=${alternative}`, "-addext", `subjectAltName=${alternative}`],
  { encoding: "utf8", env: environment });
  if (result.error || result.status !== 0) throw new Error("Host OpenSSL could not generate synthetic TLS credentials");
  return { key: readFileSync(keyPath, "utf8"), cert: readFileSync(certPath, "utf8"), keyPath, certPath };
}
