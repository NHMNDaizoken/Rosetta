// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Static module-boundary check: dependency direction, public entrypoints, cycles.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const src = join(root, "src");
const FOUNDATION = new Set(["applications", "resources", "data", "objects", "workflow"]);
const capabilityLayer = (path) => {
  const id = relative(src, path).split("\\").join("/");
  if (id === "modules/capability/compatibility/compatibility.mjs") return 0;
  if (id === "modules/capability/registry/manifest.mjs" || id === "modules/capability/registry/payload.mjs") return 0;
  if (id.startsWith("modules/capability/trust/")) return 1;
  if (id.startsWith("modules/capability/execution/")) return 2;
  if (id === "modules/capability/registry/capabilities.mjs") return 3;
  if (id.startsWith("modules/capability/composition/")) return 4;
  return 0;
};
const PUBLIC = new Set([
  "modules/applications/applications.mjs",
  "modules/resources/resources.mjs",
  "modules/data/data.mjs",
  "modules/objects/objects.mjs",
  "modules/workflow/workflow.mjs",
  "modules/workflow/client.mjs",
  "modules/capability/compatibility/compatibility.mjs",
  "modules/capability/registry/capabilities.mjs",
  "modules/capability/registry/manifest.mjs",
  "modules/capability/registry/payload.mjs",
  "modules/capability/trust/trust.mjs",
  "modules/capability/execution/execution.mjs",
  "modules/capability/execution/runtime.mjs",
  "modules/capability/execution/provider-network.mjs",
]);

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : name.endsWith(".mjs") ? [path] : [];
  });
}
const id = (path) => relative(src, path).split("\\").join("/");
const domain = (path) => {
  const parts = id(path).split("/");
  if (parts[0] !== "modules" || !parts[1]) return parts[0];
  return parts[1] === "capability" ? `capability.${parts[2]}` : parts[1];
};
const graph = new Map(files(src).map((path) => [path, []]));
const problems = [];
for (const path of graph.keys()) {
  const source = readFileSync(path, "utf8");
  for (const match of source.matchAll(/(?:from\s+|import\s*\()["'](\.[^"']+)["']/g)) {
    const target = join(path, "..", match[1]);
    if (!graph.has(target)) continue;
    graph.get(path).push(target);
    const from = id(path); const to = id(target);
    const a = domain(path); const b = domain(target);
    if (a === b) continue;
    if (from.startsWith("platform/") && to.startsWith("modules/")) problems.push(`${from} imports ${to}: platform must not depend on modules`);
    if (from === "server.mjs" && to.startsWith("modules/")) problems.push(`${from} imports ${to}: entrypoint must compose through bootstrap`);
    if (from !== "server.mjs" && from !== "api.mjs" && !from.startsWith("bootstrap/") && (to === "api.mjs" || to === "server.mjs" || to.startsWith("bootstrap/"))) problems.push(`${from} imports ${to}: only the router/entrypoint may import composition roots`);
    if (FOUNDATION.has(a) && to.startsWith("modules/capability/")) problems.push(`${from} imports ${to}: foundation modules must not depend on capability modules`);
    if (a.startsWith("capability.") && b.startsWith("capability.") && capabilityLayer(target) > capabilityLayer(path)) {
      problems.push(`${from} imports ${to}: capability layers may only depend downward`);
    }
    if (to.startsWith("modules/") && !PUBLIC.has(to)) problems.push(`${from} imports ${to}: not a public module entrypoint`);
  }
}
const state = new Map();
function visit(path, trail) {
  if (state.get(path) === "done") return;
  if (state.get(path) === "open") { problems.push(`import cycle: ${[...trail, path].map(id).join(" -> ")}`); return; }
  state.set(path, "open");
  for (const next of graph.get(path)) visit(next, [...trail, path]);
  state.set(path, "done");
}
for (const path of graph.keys()) visit(path, []);
assert.deepEqual([...new Set(problems)], [], `Module boundary violations:\n${[...new Set(problems)].join("\n")}`);
console.log(`Module boundaries verified: ${graph.size} sources, no cycles, declared entrypoints only`);
