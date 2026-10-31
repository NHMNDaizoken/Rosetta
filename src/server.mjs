// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { createApplication } from "./bootstrap/container.mjs";
import { loadConfig } from "./bootstrap/config.mjs";
import { createHealthServer } from "./platform/health/health.mjs";

const { port, host, config, execution } = loadConfig();
const application = config ? createApplication(config, execution) : { route: undefined, close() {} };
const server = createHealthServer(application.route);
server.on("error", (error) => {
  console.error(`Platform health API failed: ${error.code ?? "startup_error"}`);
  process.exitCode = 1;
});
server.listen(port, host, () => {
  console.log(`Platform health API listening on port ${server.address().port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    application.close();
    server.close();
    setTimeout(() => server.closeAllConnections(), 5000).unref();
  });
}
