// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";

const names = [
  "POSTGRES_PASSWORD", "IDENTITY_DB_PASSWORD", "DATA_DB_PASSWORD",
  "WORKFLOW_DB_PASSWORD", "KEYCLOAK_ADMIN_PASSWORD", "CORE_CLIENT_SECRET",
  "TENANT_A_SECRET", "TENANT_B_SECRET", "READER_SECRET", "SSO_USER_PASSWORD",
  "DATA_JWT_SECRET", "WORKFLOW_ADMIN_PASSWORD",
];
const values = ["# Generated local credentials; never commit this file", "PORT=8080", "PUBLIC_URL=http://127.0.0.1:8080"];
for (const name of names) values.push(`${name}=${randomBytes(32).toString("hex")}`);
try {
  writeFileSync(".env", `${values.join("\n")}\n`, { flag: "wx", mode: 0o600 });
  console.log("Created .env with random local-only credentials; existing files are never overwritten");
} catch (error) {
  if (error.code === "EEXIST") console.error(".env already exists; preserve it and add missing settings manually");
  else console.error("Could not create .env");
  process.exitCode = 1;
}
