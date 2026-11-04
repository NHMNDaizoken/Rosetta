<!--
SPDX-FileCopyrightText: 2026 Junctura Contributors
SPDX-License-Identifier: Apache-2.0
-->
# Developer and extension guide

How to work on Junctura without breaking its public contracts or security model.
Read [PRODUCT.md](PRODUCT.md), [ARCHITECTURE.md](ARCHITECTURE.md),
[LICENSING.md](LICENSING.md) and [WORKFLOW.md](WORKFLOW.md) first.

For installation and independent app integration, start with [GETTING_STARTED](GETTING_STARTED.md).
This file covers extending Core itself. The SDK in `sdk/node` imports no Core module.

## Non-negotiable development rules

1. **Competition scope:** Keep the Layer 1 PaaS headless and reusable. Deliver the five required capabilities (Identity/SSO, API Gateway, structured data, unstructured data, workflow) and at least one Layer 2 GUI application using the Core. See [OLP_REQUIREMENTS.md](OLP_REQUIREMENTS.md).
2. **Open-source compliance:** Do not select or change the project's license. Check the root `LICENSE` before adding code. Use the approved SPDX/copyright convention, preserve third-party notices, and record dependencies. Stop and report a blocker if licensing is unresolved. See [LICENSING.md](LICENSING.md).
3. **Architecture:** Keep domain/business logic out of the reusable Core. Apps integrate through documented APIs/contracts. Do not add a service, framework, or breaking API without justification and approval. See [ARCHITECTURE.md](ARCHITECTURE.md).
4. **Security:** Never commit credentials or real private data. Enforce authorization server-side, validate untrusted input, and isolate tenants. Never bypass security checks to make a demo pass.
5. **Repository hygiene:** Inspect existing code before editing; reuse established patterns. Avoid duplicate files, speculative features, unrelated refactors, generated clutter, and unused dependencies. Keep AI-agent prompt and instruction files on the developer machine; do not publish them.
6. **Quality:** Add or update relevant tests and documentation; run available checks. Never claim a test, build, license audit, or deployment succeeded unless verified. See [WORKFLOW.md](WORKFLOW.md).
7. **Safe operations:** Do not force-push, rewrite Git history, delete data, run destructive migrations, or deploy to production without explicit approval.
8. **Honest handoff:** Report changed files, checks run, checks not run, remaining risks, and decisions requiring approval.

Official OLP rules take precedence over internal project conventions. Never invent competition requirements.

## Runtime shape

Junctura Backend is one Node.js process (`src/server.mjs`) that exposes health,
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
| `src/bootstrap/config.mjs`, `container.mjs` | Validate environment; construct optional workers once; expose one close hook. | Composition root |
| `src/platform/health/health.mjs` | Liveness HTTP server and fallback error rendering. | `GET/HEAD /health` |
| `src/api.mjs` | Route dispatch, readiness, request IDs, error mapping. | Public routing |
| `src/platform/auth/auth.mjs` | Bearer validation, live introspection, tenant/role checks. | Shared security |
| `src/platform/http/http.mjs` | JSON/body helpers, strict flat-object reader, writer check, UUID pattern. | Shared transport |
| `src/bootstrap/readiness.mjs` | Dependency readiness aggregation. | `GET /ready` |
| `src/platform/security/internal-token.mjs` | Internal short-lived JWT signing for provider adapters. | Shared security |
| `src/modules/applications/applications.mjs` | Application registration/approval models and command forwarding. | `/v1/applications*`, `/v1/approvals*` |
| `src/modules/capability/registry/capabilities.mjs` | Capability registry and publication approval command forwarding. | `/v1/capabilities*`, `/v1/approvals*` |
| `src/modules/capability/registry/manifest.mjs` | Closed manifest validation and JCS digest. | Shared capability contract |
| `src/modules/resources/resources.mjs` | Application context, resource commands, share validation. | Shared authority |
| `src/modules/data/data.mjs` | Structured-data adapter and record routes. | `/v1/data/*`, `/v2/data/*` |
| `src/modules/objects/objects.mjs`, `malware-scan.mjs` | Object readiness, ClamAV fail-closed scan, storage adapter and object routes. | `/v1/objects*`, `/v2/objects*` |
| `src/modules/secrets/secrets.mjs` | OpenBao-backed application secrets metadata API (no plaintext GET). | `/v2/secrets*` |
| `src/modules/workflow/workflow.mjs` | Workflow routes, canonical input and idempotency ledger. | `/v1/workflows/*` |
| `src/modules/workflow/client.mjs` | Private Flowable HTTP client. | Internal provider adapter |
| `src/modules/capability/compatibility/compatibility.mjs` | Restricted schema proof and strict JSON parsing. | Offline C3 helpers |
| `src/modules/capability/trust/trust.mjs` | Exact direct grants and private command boundary. | C2 interface |
| `src/modules/capability/execution/execution.mjs` | SQL reservation, memory authentication leases and ticket authority. | C4A authority |
| `src/modules/capability/execution/provider-network.mjs` | Approved-origin TLS transport, DNS pinning and dispatch guard. | Shared C4 transport |
| `src/modules/capability/execution/runtime.mjs` | Guarded single invocation and Flowable worker correlation. | Opt-in C4A runtime |
| `src/modules/capability/composition/plan.mjs`, `bpmn.mjs` | Linear plan validation and deterministic bounded BPMN. | Pure C4B helpers |
| `src/modules/capability/composition/registry.mjs` | Composition lifecycle and publication authority. | C4B Registry |
| `src/modules/capability/composition/execution.mjs`, `runtime.mjs` | Private SQL steps, leases, ordered Flowable dispatch and observation. | Opt-in C4B runtime |

Rules:

- Keep authentication and tenant/application authority at the service boundary.
- Do not trust caller-supplied tenant, owner, app or role headers.
- Parse HTTP input in a transport helper; coordinate capability logic separately
  from provider calls where the existing module already allows it.
- Reuse `HttpError` and the existing error shape rather than inventing a new one.
- Never mint provider credentials in a browser or log tokens, secrets or bodies.
- SQL files 001–019 are immutable. The migration runner owns checksum, applied-version,
  lock and fingerprint checks. Authority modules use restricted owner-controlled RPCs;
  generic records cannot administer private tables. See [MIGRATIONS](MIGRATIONS.md).
- The boundary checker enforces declared public entrypoints, downward dependencies and
  no cycles. Bootstrap wires optional workers; Flowable owns durable jobs and timers.

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
8. Regenerate the Console inventory: `npm --prefix console run generate:endpoints`
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
npm run test:capabilities
npm run test:flowable-worker
npm run test:recovery
npm run test:audit
npm run test:compositions
npm run test:migrations
npm run test:execution-ledger
npm run test:provider-network
npm run check:schema-drift
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
JUNCTURA_APP_CLIENT_ID=<enrolled-backend-client> \
JUNCTURA_APP_CLIENT_SECRET=<backend-secret> \
JUNCTURA_GRANTEE_APP_ID=<second-enrolled-app-uuid> \
JUNCTURA_GRANTEE_CLIENT_ID=<grantee-client> \
JUNCTURA_GRANTEE_CLIENT_SECRET=<grantee-secret> \
node --env-file=.env examples/foundation-http.mjs
```

Expected behavior, in order:

1. OIDC client-credentials authentication succeeds.
2. `GET /v1/identity` returns the verified subject, tenant and roles.
3. A `/v2` record is created and read back by its owner.
4. A `/v2` object is uploaded and downloaded with identical bytes.
5. The `junctura_checkpoint` workflow starts, is inspected and completes.
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
| Object lifecycle cleanup | Objects | Quarantine scanning is implemented; version reclamation/quota remain separate |
| Audit export/integrity | Platform security | Independent sink, public/admin contract if approved, retention and key recovery; the bounded PostgreSQL boundary is implemented in [AUDIT.md](AUDIT.md) |
| Messaging / notification | Platform services | Broker ownership, delivery semantics, tenant quotas |
| Search / data interoperability | Structured data | Index ownership, reindex/rebuild, tenant isolation |
| Project / environment metadata | Junctura Cloud | P1 contract, ownership rules, Console trust slice |
| Application hosting / runtime | Junctura Cloud | Admission, isolation, resource limits, operator controls |
| General capability plugins, HA and resume | Junctura Connect | Bounded C4A/C4B exist; broader execution/credential recovery needs a separately approved model |

Each requires its own approved slice and its own failure/denial tests. DX1 does
not authorize any of them.

## Documentation rules

- One authoritative document per subject. Link instead of copying tables.
- `docs/PRODUCT.md` owns product status; `docs/architecture/LAYER1_CORE_CATALOG.md`
  owns implementation evidence; `docs/contracts/foundation-api.openapi.json`
  owns the machine API contract.
- Update the README first screen only when the product model or status changes.
- Preserve audit evidence, licensing records and existing architecture decisions.
