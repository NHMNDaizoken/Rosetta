// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Composition root: builds adapters and modules once, then exposes the router
// and a single close hook. No global mutable container and no constructor magic.
import { createApi } from "../api.mjs";
import { createCapabilityRuntime } from "../modules/capability/execution/runtime.mjs";

export function createApplication(config, execution) {
  let executionRuntime;
  if (execution) {
    executionRuntime = createCapabilityRuntime(config, { origins: execution.providerOrigins });
    config = { ...config, executionRuntime };
  }
  const route = createApi(config);
  return {
    route,
    close() { executionRuntime?.close(); },
  };
}
