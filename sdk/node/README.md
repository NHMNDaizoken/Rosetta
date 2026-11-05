<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# @junctura/server-client

Server-side Node.js client for [Junctura DX-OS](https://github.com/vku2-open-source-2026/junctura-dxos),
the headless platform that lets independent applications share data and capabilities
under consent and audit.

- No runtime dependencies; Node.js 24.
- OIDC client credentials kept in memory only; tokens are never persisted or logged.
- Mutations are never retried automatically; errors never echo response bodies or secrets.

## Install

```sh
npm install @junctura/server-client
```

## Use as a consumer

```js
import { createJuncturaClient } from "@junctura/server-client";

const junctura = createJuncturaClient({
  baseUrl: process.env.JUNCTURA_URL,
  clientId: process.env.JUNCTURA_APP_CLIENT_ID,
  clientSecret: process.env.JUNCTURA_APP_CLIENT_SECRET,
});

// Call a capability another application shares, stating why and for whom.
const execution = await junctura.execute(target, { referralId: "R-001" }, undefined, {
  purpose: "treatment",
  dataSubject: patientSubject,
});
const result = await junctura.waitForExecution(execution.executionId);
```

`dataSubject` is the person's identity-provider subject. Junctura checks that person's
consent, seals the call into the audit chain and shows it to them later. Emergency
access adds `emergency: true` and a `justification` and is reviewed afterwards.

## Use as a provider

Junctura invokes a provider with a single-use ticket. Redeem it before doing any work:

```js
const redeemed = await junctura.redeemTicket({
  authorization: request.headers.authorization,
  invocationId: body.invocationId,
  input: body.input,
});
if (!redeemed.active) return reply(403);
const { purpose, dataSubject, emergency } = redeemed.context;
```

## API

| Method | Purpose |
| --- | --- |
| `identity()` | The application's verified identity |
| `createRecord(collection, data)`, `getRecord(collection, id)` | Tenant records |
| `putObject(id, bytes)`, `getObject(id)` | Malware-scanned object storage |
| `workflowDefinitions()`, `startWorkflow(id, input, key?)` | BPMN workflows |
| `discover({ limit, cursor })` | Capabilities this application may call |
| `execute(target, input, key?, context?)`, `execution(id)`, `waitForExecution(id)` | Capability calls |
| `redeemTicket({ authorization, invocationId, input })` | Provider ticket redemption |
| `inputDigest(input)` | Canonical SHA-256 of a JSON input |
| `request(path, options)` | Any other versioned public API path |

Full contract: [OpenAPI](https://github.com/vku2-open-source-2026/junctura-dxos/tree/main/docs/contracts).

## License

Apache-2.0. See `LICENSE` and `NOTICE`.
