// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
// Composition root: builds adapters and modules once, then exposes the router
// and a single close hook. No global mutable container and no constructor magic.
import { createApi } from "../api.mjs";
import { createCapabilityRuntime } from "../modules/capability/execution/runtime.mjs";
import { createCompositionRuntime } from "../modules/capability/composition/runtime.mjs";

export function createApplication(config, execution, composition) {
  let executionRuntime, compositionRuntime;
  if (execution) {
    executionRuntime = createCapabilityRuntime(config, { origins: execution.providerOrigins });
    config = { ...config, executionRuntime };
  }
  if (composition) {
    compositionRuntime = createCompositionRuntime(config, { origins: composition.providerOrigins });
    config = { ...config, compositionRuntime };
  }
  const route = createApi(config);
  return {
    route,
    close() { executionRuntime?.close(); compositionRuntime?.close(); },
  };
}
