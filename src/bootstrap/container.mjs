// SPDX-FileCopyrightText: 2026 Junctura Contributors
// SPDX-License-Identifier: Apache-2.0
// Composition root: builds adapters and modules once, then exposes the router
// and a single close hook. No global mutable container and no constructor magic.
import { readFileSync } from "node:fs";
import { createApi } from "../api.mjs";
import { createCapabilityRuntime } from "../modules/capability/execution/runtime.mjs";
import { createCompositionRuntime } from "../modules/capability/composition/runtime.mjs";

// Approved public origins plus, when configured, internal origins trusted only
// through the operator's provider CA.
export function providerNetworkOptions({ providerOrigins = [], internalOrigins = [], providerCaFile } = {}, readFile = readFileSync) {
  const options = { origins: providerOrigins };
  if (internalOrigins.length) Object.assign(options, { internalOrigins, internalCa: readFile(providerCaFile, "utf8") });
  return options;
}

export function createApplication(config, execution, composition) {
  let executionRuntime, compositionRuntime;
  if (execution) {
    executionRuntime = createCapabilityRuntime(config, providerNetworkOptions(execution));
    config = { ...config, executionRuntime };
  }
  if (composition) {
    compositionRuntime = createCompositionRuntime(config, providerNetworkOptions(composition));
    config = { ...config, compositionRuntime };
  }
  const route = createApi(config);
  return {
    route,
    close() { executionRuntime?.close(); compositionRuntime?.close(); },
  };
}
