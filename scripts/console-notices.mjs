// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const root = fileURLToPath(new URL("../console/", import.meta.url));
const lock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const sections = ["Junctura Console: upstream runtime notices. Original Junctura: Apache-2.0; see LICENSE and NOTICE."];
for (const [path, entry] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (!path || entry.dev || entry.optional) continue;
  const dir = join(root, path);
  const notices = readdirSync(dir).filter(name => /^(licen[sc]e|notice)(\.|$)/i.test(name));
  if (!entry.license || !notices.length) throw new Error(`Missing upstream runtime notice: ${path}`);
  sections.push(`\n=== ${path.replace(/^node_modules\//, "")} ${entry.version} (${entry.license}) ===\n`);
  for (const name of notices) sections.push(readFileSync(join(dir, name), "utf8"));
}
mkdirSync(join(root, "public"), { recursive: true });
writeFileSync(join(root, "public/THIRD-PARTY-NOTICES.txt"), sections.join("\n") + "\n");
console.log("Preserved Console runtime package licenses in public/THIRD-PARTY-NOTICES.txt");
