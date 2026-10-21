// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { workflowRequest } from "../src/workflow-client.mjs";

const config = { workflowUrl: process.env.WORKFLOW_URL, workflowPassword: process.env.WORKFLOW_ADMIN_PASSWORD };
try {
  const template = await readFile("/definitions/checkpoint.bpmn20.xml");
  for (const tenant of ["tenant-a", "tenant-b"]) {
    const query = new URLSearchParams({ key: "rosetta_checkpoint", tenantId: tenant, latest: "true" });
    const existing = await workflowRequest(config, `repository/process-definitions?${query}`);
    if (!existing.data.length) {
      const form = new FormData();
      form.append("tenantId", tenant);
      form.append("file", new Blob([template], { type: "application/xml" }), "checkpoint.bpmn20.xml");
      await workflowRequest(config, "repository/deployments", { method: "POST", body: form });
    }
  }
  console.log("Technical workflow definitions are available for the two local fixture tenants");
} catch {
  console.error("Workflow initialization failed; inspect engine readiness and private configuration");
  process.exitCode = 1;
}
