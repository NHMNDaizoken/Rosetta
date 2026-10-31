// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { HttpError } from "../../platform/http/http.mjs";

export async function workflowRequest(config, path, options = {}) {
  let response;
  try {
    response = await fetch(`${config.workflowUrl}/${path}`, {
      ...options,
      headers: { Authorization: `Basic ${Buffer.from(`rosetta-engine:${config.workflowPassword}`).toString("base64")}`,
        ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }) },
      signal: AbortSignal.timeout(10000), redirect: "error",
    });
  } catch { throw new HttpError(503, "workflow_unavailable"); }
  if (!response.ok) {
    if (response.status === 404) throw new HttpError(404, "not_found");
    if (response.status === 409) throw new HttpError(409, "workflow_conflict");
    throw new HttpError(503, "workflow_unavailable");
  }
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}
