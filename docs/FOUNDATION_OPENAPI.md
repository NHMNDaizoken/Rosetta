# Implemented Foundation OpenAPI

[foundation-api.openapi.json](contracts/foundation-api.openapi.json) is the
implemented OpenAPI 3.1.1 contract: 44 operations on 30 paths. It covers process
health/readiness, identity, registration/approvals, legacy and private resources,
read shares and tenant-scoped workflow lifecycle. Existing URLs, methods,
payloads, authorization, migrations and provider configuration are unchanged.

The [Capability design](contracts/capability-api-v1.openapi.json) stays separate.
Its registry, resolver, composition, delegation and provider-dispatch operations
are not Foundation endpoints. Do not generate a production client from that
design draft and assume those services exist.

## Boundaries preserved by the contract

- Core uses live OIDC introspection and verified issuer, audience, expiry, roles
  and tenant membership. Caller app/tenant/client/owner headers are not authority.
- V2 additionally resolves active registration and exact operator-enrolled
  backend subject. Only an owner writes; an explicit owner-approved share permits
  reading one resource until expiry/revocation. No write or delegation grant.
- Suspended/revoked owners block shared reads; inactive consumers lose v2 entry.
  Existing in-flight work may finish. Keycloak clients are managed separately.
- Browsers use an application backend, which owns human/domain authorization.
  Neither a forwarded human header nor an app descriptor grants impersonation.
- V1 data/objects remain separate deprecated tenant storage under an explicit
  legacy client allowlist. Ownership is not guessed or silently migrated. See
  [the migration contract](RESOURCE_AUTHORIZATION.md) before changing clients.
- Workflows remain tenant-scoped. Do not place app-private content in variables.
- Operator database, filer and engine interfaces and `/internal/auth` are not
  public Foundation endpoints.

The `/identity/` prefix delegates to Keycloak. The Foundation describes discovery,
authorization, token/refresh, userinfo, keys and logout integration. Vendor admin,
dynamic login-action and other vendor-specific APIs remain upstream-owned; this
specification does not attempt to replace Keycloak's entire REST/protocol contract.

## Wire behavior and validation limits

Schemas describe actual methods, JSON envelopes, empty responses, binary media,
limits, revision headers and retry semantics. `limit` 1–100 is the only record
pagination option; no cursor/offset or app listing API exists. Workflow definition
listing is capped at 100 without a public pagination contract. JSON writes are
64 KiB; binary uploads are 1 byte–5 MiB; Gateway has its separate 10 MiB bound.

Core JSON errors and existing Nginx HTML errors are both represented where they
can occur. Gateway failures need not contain a JSON requestId. HEAD sends no body.
The Gateway can append a second nosniff value; the schema accepts the observed
header instead of changing HTTP behavior. Revision tags are opaque. Registration
administration uses explicit enrolled permissions, not a blanket writer role.

OpenAPI/JSON Schema cannot prove live ownership, independent human approval,
canonical origin control, relative expiry, workflow depth or exactly-once effects.
Those semantic controls are documented and exercised by real-service tests.
Validation checks wire byte limits separately from decoded JSON schemas.

## Automated checks

Node 24 runs the existing tests. Python 3.10+ and the pinned, development-only
validators are required for contract checks and host integration conformance:

```sh
python -m pip install -r requirements-contracts.txt
npm run check
npm run check:contracts
npm run test:contract-validator
npm test
```

The structural check downloads the official OpenAPI 3.1 metaschema into memory
from its standards publisher and verifies a pinned SHA-256 before using it.
Network unavailability or a changed digest fails the check; no silent fallback or
vendored schema is used. Local component references, individual schema validity,
unique operation IDs, parameters, roles and legacy/app boundaries are checked.

An independent reviewed route/method inventory in `scripts/check-contracts.py`
must match the specification. It is an audit inventory, not automatic JavaScript
route discovery: future handler changes require inventory/spec/test review.

Run existing suites sequentially on an isolated development stack:

```sh
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 240
npm run test:integration
npm run test:applications
npm run test:flowable-worker
npm run test:recovery
```

The first two suites observe actual HTTP requests/responses and validate them in
memory after fixture cleanup. Every documented operation must have positive
runtime coverage in its assigned suite. Failed requests validate their response
contract without pretending malformed/unauthorized requests satisfy a success
schema. Cases include same-tenant foreign-app denials, revoked/expired shares,
inactive owners/consumers, unknown query/body fields and dependency failures.
The validator also rejects deliberately corrupted schemas, refs, IDs, routes,
security declarations, legacy annotations, statuses, media and required headers.

Credentials, tokens, authorization codes and cookies are never written as capture
artifacts. The observer omits credential headers, redacts known OAuth fields,
retains only binary lengths and reports operation/schema keywords without payload
values. Existing tests still check exact byte round trips and authorization.

CI installs these development tools and runs both structural and live checks.
Production images still need only Node and the existing providers; no runtime
dependency or Python service is introduced. Not every possible proxy timeout,
rate-limit burst or upstream UI branch is forced by the suite; positive operation
coverage is not a claim of exhaustive fault/state coverage or vendor conformance.

## Tested backend HTTP example

[foundation-http.mjs](../examples/foundation-http.mjs) contains ordinary HTTP
calls for confidential client authentication, private record creation, binary
upload/download, one expiring read share, and workflow start/inspect/completion.
It uses an installed technical checkpoint and puts no private content in workflow
variables. It performs no automatic POST retries.

`npm run test:applications` executes this exact example using the existing local
Keycloak administrator credential to provision uniquely named, independently
approved backend fixtures. Their actual credentials are obtained in memory,
never printed or persisted; the suite verifies the recipient can read the shared
record and cannot update it, and also executes the standalone CLI in a child
process with private environment variables. It cleans up its own resource
fixtures. This is the verified reproducible example path on a normal local
Compose setup.

For an already operator-enrolled active backend, set these process environment
variables privately, then run `npm run example:foundation`:

```text
PUBLIC_URL=http://127.0.0.1:8080
ROSETTA_APP_CLIENT_ID=<registered confidential backend client>
ROSETTA_APP_CLIENT_SECRET=<privately provisioned credential>
ROSETTA_GRANTEE_APP_ID=<different active same-tenant registered app UUID>
```

These are placeholders, not working credentials. Default tenant-a/tenant-b
service fixtures alone do not grant v2 access. The standalone example leaves its
created records, object and ten-minute share in the application's ownership; it
prints no credentials/tokens. On a failed POST, reconcile outcomes before rerun.
Never put backend secrets in a frontend, source repository or shell transcript.

## Local verification evidence

Verified on 2026-10-25 against the implementation at baseline
`7db68cfdcc0d3762d2d393deadbe2e83ca708169`, with the contract/test changes in
this milestone. No production handlers, provider configuration or migrations
changed. These are local results; GitHub Actions reports CI results separately.

| Command | Observed result |
| --- | --- |
| `npm run check` | Source syntax, SPDX headers and project license files passed. |
| `npm run check:contracts` | Official OpenAPI structure, local refs, schemas, IDs and 44 reviewed operations passed. |
| `npm run test:contract-validator` | Deliberate schema, status, media, header, auth and inventory regressions rejected. |
| `npm test` | 22 tests passed with local Node 24.13.1. |
| `docker compose config --quiet` | Passed. |
| `docker compose up --build --detach --wait --wait-timeout 240` | Build and local dependency startup passed. |
| `docker compose run --rm --no-deps --volume "${PWD}/tests:/app/tests:ro" core node --test` | 22 tests passed in pinned Node 24.21.0. |
| `npm run test:integration` | 9 tests passed; 130 observed responses validated, 26 successful operations. |
| `npm run test:applications` | 13 tests passed, including the imported example and standalone CLI; 246 responses validated, 31 successful operations. |
| `npm run test:flowable-worker` | 1 private worker contract test passed. |
| `npm run test:recovery` | 1 isolated PostgreSQL backup/restore and tenant RLS test passed. |

The Core and application suites together exercised all 44 documented operations
successfully, as well as negative requests. Counts overlap across suites.
The route inventory is a reviewed handler matrix, not automatic discovery of
future handlers. Provider-specific APIs outside the documented OIDC boundary
and unforced proxy/provider fault branches retain the coverage limits above.
