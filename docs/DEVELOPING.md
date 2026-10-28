# Developer and extension guide

How to work on Rosetta without breaking its public contracts or security model.
Read [AGENTS.md](../AGENTS.md), [PRODUCT.md](PRODUCT.md) and
[ARCHITECTURE.md](ARCHITECTURE.md) first.

## Runtime shape

Rosetta Backend is one Node.js process (`src/server.mjs`) that exposes health,
readiness and the public API through a small adapter layer. Nginx is the only
published gateway. Providers stay private:

- Keycloak for identity
- PostgreSQL/PostgREST for structured data and authority tables
- SeaweedFS for object bytes
- Flowable for workflow execution

There is no dependency-injection framework, plugin loader, microservice split or
dynamic code execution. Extension conventions are explicit imports, explicit
routes and explicit contracts.

## Backend module map

| Module | Responsibility | Public or internal |
| --- | --- | --- |
| `src/server.mjs` | Validate configuration, build the API, bind the process, shut down. | Entrypoint only |
| `src/health.mjs` | Liveness HTTP server and fallback error rendering. | `GET/HEAD /health` |
| `src/api.mjs` | Route dispatch, readiness, request IDs, error mapping. | Public routing |
| `src/auth.mjs` | Bearer validation, live introspection, tenant/role checks. | Shared security |
| `src/http.mjs` | JSON/body helpers, strict flat-object reader, writer check, UUID pattern. | Shared transport |
| `src/readiness.mjs` | Dependency readiness aggregation. | `GET /ready` |
| `src/internal-token.mjs` | Internal short-lived JWT signing for provider adapters. | Shared security |
| `src/applications.mjs` | Application registration/approval models and command forwarding. | `/v1/applications*`, `/v1/approvals*` |
| `src/resources.mjs` | Application context, resource commands, share validation. | Shared authority |
| `src/data.mjs` | Structured-data adapter and record routes. | `/v1/data/*`, `/v2/data/*` |
| `src/objects.mjs` | Object readiness, storage adapter and object routes. | `/v1/objects*`, `/v2/objects*` |
| `src/workflow.mjs` | Workflow routes, canonical input and idempotency ledger. | `/v1/workflows/*` |
| `src/workflow-client.mjs` | Private Flowable HTTP client. | Internal provider adapter |

Rules:

- Keep authentication and tenant/application authority at the service boundary.
- Do not trust caller-supplied tenant, owner, app or role headers.
- Parse HTTP input in a transport helper; coordinate capability logic separately
  from provider calls where the existing module already allows it.
- Reuse `HttpError` and the existing error shape rather than inventing a new one.
- Never mint provider credentials in a browser or log tokens, secrets or bodies.

## Add a public API route

The Gateway is authoritative. Adding a route is a security change, not only a
handler change. Follow every step:

1. Re-read the relevant requirement, ADR and existing contract. If authorization
   semantics are unresolved, stop and document the blocker.
2. Decide the owning module and the exact versioned path (`/v2/...` or `/v1/...`).
   Legacy `/v1/data` and `/v1/objects` are deprecated and allowlisted; do not add
   new behavior there.
3. Add the route to `src/api.mjs` with an explicit method/path branch. Unknown
   routes must keep returning `404`.
4. Apply the existing authorizer. Use `resourceIdentity` for app-owned v2
   resources; never resolve ownership from headers.
5. Enforce writer permissions with `requireWriter` where mutation is intended.
6. Add the operation and schemas to
   `docs/contracts/foundation-api.openapi.json`. Every implemented public
   operation must be represented.
7. If the Console may call it, add an explicit `location` to
   `console/nginx/default.conf`. There is no generic `/api/` passthrough.
8. Regenerate the Console inventory: `npm run console:generate:endpoints`
   (or run `npm run generate:endpoints` inside `console/`), then commit the
   updated `console/src/constants/foundationEndpoints.json`.
9. Add positive and negative tests: unauthenticated, wrong tenant, wrong app,
   read-only writer, malformed/oversized input and unknown route.
10. Run the checks listed below. Do not ship with a stale endpoint inventory.
11. Update [PRODUCT.md](PRODUCT.md) or the implementation catalog only if the
    status or ownership actually changed.
12. If the route changes Gateway security behavior, split that change out for
    explicit approval instead of folding it into a feature commit.

The Gateway's `/v[12]/` location is intentionally broad because Core still
authorizes each request. Do not widen it to provider paths or add a generic
plugin/capability execution endpoint.

## Add or change a Foundation module

Use the status vocabulary from [PRODUCT.md](PRODUCT.md): IMPLEMENTED, PARTIAL,
PROPOSED, DESIGN ONLY, DEFERRED. A new runtime module needs all of:

- A single responsibility and a named owner file under `src/`.
- A documented public surface, or none if internal.
- Explicit authorization requirements and a data-ownership statement.
- Health/readiness behavior if it adds a dependency.
- Provider isolation: private credentials and ports must not reach the Gateway.
- A contract location when it exposes an API.
- Positive and negative tests, including failure and denial paths.
- A status entry that does not overclaim.

Do not create empty folders, placeholder services, unused tables, fake endpoints
or "future" controls. A documented convention is enough until a real consumer
exists.

## Console rules

- Preserve LIVE/PREVIEW separation. Preview data is synthetic; LIVE without a
  token must show an explicit missing/rejected state, never mock identity.
- Keep browser tokens memory-only. Do not use `localStorage` for credentials.
- The packaged Nginx allowlist is the Console's only proxy surface. A new screen
  does not grant a new backend route.
- Planned features must be visibly labelled and must not expose working-looking
  controls.
- Do not infer administrator rights from `core-reader` or `core-writer`.
- Keep the existing design system, language switching and theme behavior.

Console checks:

```sh
npm run console:check:endpoints
npm run console:test
npm run console:build
npm run test:console-container
```

## Local verification

Unit and fast checks (no Docker required):

```sh
npm run check
npm test
python -m pip install -r requirements-contracts.txt
npm run check:contracts
npm run test:contract-validator
npm run console:check:endpoints
npm run console:test
npm run console:build
```

Real-service checks (Docker Engine with Linux containers required; run on a
disposable test stack and never delete persistent volumes):

```sh
npm run setup
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 240
npm run healthcheck
npm run test:integration
npm run test:applications
npm run test:flowable-worker
npm run test:recovery
npm run test:audit
```

Do not claim a suite passed if it was not executed. Integration suites restart
services and alter local test state; they are not unit tests.

## Developer journey and cleanup

Prerequisites: a healthy local stack, an enrolled backend application and a
second enrolled application to act as the grantee. Enrollment is operator-run;
see [APPLICATION_REGISTRATION.md](APPLICATION_REGISTRATION.md) and
[RESOURCE_AUTHORIZATION.md](RESOURCE_AUTHORIZATION.md). The application backend
must use its own service-account credentials; never put them in a browser.

```sh
ROSETTA_APP_CLIENT_ID=<enrolled-backend-client> \
ROSETTA_APP_CLIENT_SECRET=<backend-secret> \
ROSETTA_GRANTEE_APP_ID=<second-enrolled-app-uuid> \
ROSETTA_GRANTEE_CLIENT_ID=<grantee-client> \
ROSETTA_GRANTEE_CLIENT_SECRET=<grantee-secret> \
node --env-file=.env examples/foundation-http.mjs
```

Expected behavior, in order:

1. OIDC client-credentials authentication succeeds.
2. `GET /v1/identity` returns the verified subject, tenant and roles.
3. A `/v2` record is created and read back by its owner.
4. A `/v2` object is uploaded and downloaded with identical bytes.
5. The `rosetta_checkpoint` workflow starts, is inspected and completes.
6. An expiring read share is created for the grantee.
7. If grantee credentials are supplied, the grantee is denied before the share
   and allowed after it. Without them, those two steps are skipped.

The CLI prints the created IDs. It intentionally does not delete them because a
failed POST may have an ambiguous outcome. To clean up, use the owner backend
with the same credentials and public routes:

```sh
# Replace values with the IDs printed by the example.
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$PUBLIC_URL/v2/resource-shares/$SHARE_ID"
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$PUBLIC_URL/v2/data/http_example/$RECORD_ID"
curl -X DELETE -H "Authorization: Bearer $TOKEN" "$PUBLIC_URL/v2/objects/$OBJECT_ID"
```

Do not use `docker compose down -v` or delete volumes to clean test data.

## Add tests

- Unit tests live in `tests/*.test.mjs` and use `node:test`.
- HTTP-level integration tests live in `integration/` and use real providers.
- Console tests live in `console/src/tests/` and use Vitest.
- Contract conformance lives in `scripts/check-contracts.py`; keep the OpenAPI
  and the observed operation coverage current.
- Prefer a small deterministic test over a broad snapshot. Always cover the
  denied path for a new authorization decision.

## Future module conventions

These are documented integration conventions, not implementations:

| Future module | Owning area | Required before implementation |
| --- | --- | --- |
| File quarantine | Objects | Separate scan-worker network, admission state machine, failure policy |
| Audit export/integrity | Platform security | Independent sink, public/admin contract if approved, retention and key recovery; the bounded PostgreSQL boundary is implemented in [AUDIT.md](AUDIT.md) |
| Messaging / notification | Platform services | Broker ownership, delivery semantics, tenant quotas |
| Search / data interoperability | Structured data | Index ownership, reindex/rebuild, tenant isolation |
| Project / environment metadata | Rosetta Cloud | P1 contract, ownership rules, Console trust slice |
| Application hosting / runtime | Rosetta Cloud | Admission, isolation, resource limits, operator controls |
| Capability runtime | Rosetta Connect | Registry/trust endpoints and approved execution model; bounded offline resolver exists |

Each requires its own approved slice and its own failure/denial tests. DX1 does
not authorize any of them.

## Documentation rules

- One authoritative document per subject. Link instead of copying tables.
- `docs/PRODUCT.md` owns product status; `docs/architecture/LAYER1_CORE_CATALOG.md`
  owns implementation evidence; `docs/contracts/foundation-api.openapi.json`
  owns the machine API contract.
- Update the README first screen only when the product model or status changes.
- Preserve audit evidence, licensing records and existing architecture decisions.
