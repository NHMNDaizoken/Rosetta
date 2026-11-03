// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
import { createJuncturaClient } from "../sdk/node/index.mjs";

const client = createJuncturaClient({
  baseUrl: process.env.PUBLIC_URL ?? "http://127.0.0.1:8080",
  clientId: process.env.JUNCTURA_APP_CLIENT_ID ?? "tenant-a",
  clientSecret: process.env.JUNCTURA_APP_CLIENT_SECRET ?? process.env.TENANT_A_SECRET,
});
try {
  const identity = await client.identity();
  console.log(JSON.stringify({ subject: identity.subject, tenantId: identity.tenantId, roles: identity.roles }));
  if (process.argv.includes("--enrolled")) {
    const record = await client.createRecord("sdk_example", { synthetic: true });
    const read = await client.getRecord("sdk_example", record.id);
    if (read.data.synthetic !== true) throw Error();
    await client.request(`/v2/data/sdk_example/${record.id}`, { method: "DELETE" });
    console.log("Application-private record created, read and deleted through the public Gateway.");
  }
} catch (error) {
  console.error(`SDK example failed: ${error.code ?? "configuration_or_response_error"}. See docs/GETTING_STARTED.md.`);
  process.exitCode = 1;
}
