<!--
SPDX-FileCopyrightText: 2026 Junctura Contributors
SPDX-License-Identifier: Apache-2.0
-->
# Secrets management

Junctura uses [OpenBao](https://github.com/openbao/openbao) (MPL-2.0) as the
self-hosted secrets manager for **runtime/application** secrets.

## Bootstrap versus runtime

| Class | Examples | Handling |
| --- | --- | --- |
| Bootstrap | Postgres/Keycloak/Flowable init passwords, OpenBao unseal key and root token | Generated locally by `npm run setup` / `secrets-init`; stored outside Git (`.env`, `openbao-operator` volume) |
| Runtime | Application integration credentials managed through Core | OpenBao KV v2 under server-composed tenant/app paths |

OpenBao is started with Raft storage under `/openbao/file` and TLS disabled for
the **internal Compose network only**. That is a local/self-hosted development
posture, not a production hardening claim. Production TLS, auto-unseal/KMS and
HA remain future work.

## Local lifecycle

1. `npm run setup` creates `.env` bootstrap credentials (never committed).
2. `docker compose up` starts `secrets`, then `secrets-init`:
   - initializes OpenBao once (1 share / threshold 1 for local use)
   - unseals after every restart using material on `openbao-operator`
   - enables KV v2 at `secret/`
   - writes a least-privilege Core token to `openbao-init` (`core-token`)
3. Core mounts **only** `core-token` at `SECRETS_TOKEN_FILE`. Root/unseal
   material is not mounted into Core.

## API boundary

- Route: `/v2/secrets/{name}` (application identity required)
- `PUT` writes a value (write-only from the client's perspective after storage)
- `GET` returns `{ name, version, present }` — **never plaintext**
- `DELETE` removes metadata/versions for that name
- Paths are composed server-side as
  `secret/data/tenants/{tenant}/apps/{app}/{name}`
- Clients cannot supply arbitrary OpenBao paths
- Unauthorized, cross-tenant, cross-app or unavailable-store cases fail closed

Internal Core adapters may call `readSecretValue` in-process. That helper is not
exposed as a public HTTP route and must not be proxied to browsers.

## Rotation and recovery

- Rotate an application secret by `PUT`ing a new value (KV version increments).
- Revoke by `DELETE`ing the secret name.
- Rotate the Core token by removing `core-token` from the init volume and
  re-running `secrets-init`, then recreating Core.
- Preserve `openbao-operator/init.json` offline for disaster recovery of the
  local volume. Losing both data and init material loses ciphertext forever.

## Security boundaries

- No public OpenBao port
- No plaintext secrets in ordinary API responses, Console payloads or audit
  event bodies
- Deny when authorization or OpenBao health cannot be verified
- Root token is for operator recovery only; normal Core traffic uses the
  `rosetta-core` policy token
