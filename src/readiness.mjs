// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { dataRequest } from "./data.mjs";
import { checkObjectReadiness } from "./objects.mjs";
import { workflowRequest } from "./workflow-client.mjs";

// Readiness checks providers only; it never trusts caller headers and never
// exposes dependency details to the client.
export async function checkReadiness(config, request = fetch) {
  const identity = await request(`${config.identityUrl}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(3000) });
  if (!identity.ok || (await identity.json()).issuer !== config.issuer) throw new Error("Identity not ready");
  if (config.dataUrl) await dataRequest(config, "readiness", new URLSearchParams({ select: "id", limit: "0" }));
  if (config.objectsUrl) await checkObjectReadiness(config, request);
  if (config.workflowUrl) await workflowRequest(config, "management/engine");
}
