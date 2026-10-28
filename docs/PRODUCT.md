# Product definition and status

Rosetta DX-OS is a **self-hostable backend platform for independent applications**:
shared Foundation services with authoritative application ownership and explicitly
controlled resource sharing. The long-term direction adds application hosting and
verifiable cross-application capability composition.

This document is the product-level status catalog. Technical ownership, routes
and evidence remain in the [implementation catalog](architecture/LAYER1_CORE_CATALOG.md),
the [Foundation OpenAPI](contracts/foundation-api.openapi.json) and the
[architecture index](index.md). When they disagree, the runtime and its tests win.

## Status vocabulary

| Status | Meaning |
| --- | --- |
| **IMPLEMENTED** | Source, configuration and runnable verification exist. |
| **PARTIAL** | A bounded feature works, with documented gaps or an operator prerequisite. |
| **PROPOSED** | An approved direction or contract sketch; no runtime. |
| **DESIGN ONLY** | Design documents and schemas exist; no runtime and no API. |
| **DEFERRED** | Deliberately postponed behind a separate approval gate. |

## Four product areas

These are explanatory groupings, not new services, endpoints or brands.

### Rosetta Backend — IMPLEMENTED

The headless Core. It must remain usable without the Console.

| Capability | Implementation | Public surface |
| --- | --- | --- |
| Identity / SSO | Keycloak OIDC with live token introspection | OIDC discovery/authorization/token/logout; `GET /v1/identity` |
| API Gateway | Nginx OSS, auth-request, rate limits, bounded bodies | Single loopback entry point on port 8080 |
| Structured Data | PostgreSQL + private PostgREST, connection-scoped RLS | `/v1/data/*` (legacy allowlist) and `/v2/data/*` (app-private) |
| Object Storage | SeaweedFS OSS behind the Core adapter | `/v1/objects*` (legacy) and `/v2/objects*` (app-private) |
| Workflow | Private Flowable REST + RLS-protected idempotency ledger | `/v1/workflows/*` |
| Application Authority | Tenant-scoped registration, independent approval, lifecycle | `/v1/applications*`, `/v1/approvals*` |
| Resource sharing | Owner-approved, expiring, read-only shares | `/v2/resource-shares*` |

The exact operation inventory is generated from the Foundation OpenAPI and checked
in CI (44 operations at this revision). See [CORE_API.md](CORE_API.md) and
[RESOURCE_AUTHORIZATION.md](RESOURCE_AUTHORIZATION.md).

### Rosetta Developer Experience — PARTIAL

Working today:

- Foundation OpenAPI with structural and real-HTTP conformance checks.
- Optional React Console with LIVE/PREVIEW separation and a packaged Nginx proxy.
- API Explorer generated from the committed OpenAPI inventory.
- Executable server-side HTTP example (`examples/foundation-http.mjs`).
- Application registration and approval workflow, with mandatory operator enrollment.

Known gaps: there is no self-service operator enrollment, no browser login/session
management beyond the documented local fixtures, no SDK, and several Console views
are operational/read-only rather than full administration surfaces.

### Rosetta Cloud — PROPOSED

Projects and environments, application hosting, deployment management, runtime
workers, domains/TLS, service bindings and developer operations are **not
implemented**. Do not expect routes, tables, containers or Console controls for
them. The design is bounded by
[DEPLOYMENT_MODEL.md](architecture/DEPLOYMENT_MODEL.md) and the
[implementation handoff](architecture/OPENCODE_IMPLEMENTATION_HANDOFF.md).

### Rosetta Connect — PARTIAL

C1 Registry and bounded C2 direct grants/authorized discovery are implemented
inside the headless Core, with private Registry/Trust persistence, independent
human approval and protected Audit. Direct subjects use operator-verified backend
enrollment. C3 is an offline pure resolver (`src/capability-compatibility.mjs`).
Human delegation and C4 invocation/composition remain unimplemented; there is no
resolver endpoint or provider execution. See [direct Trust](CAPABILITY_DIRECT_TRUST.md).
See [CAPABILITY_EXTENSIONS_V1.md](CAPABILITY_EXTENSIONS_V1.md) and
[CAPABILITY_TRUST_EXECUTION_V1.md](CAPABILITY_TRUST_EXECUTION_V1.md).

## Feature catalog

| Area | Status | Evidence or next gate |
| --- | --- | --- |
| Five Foundation capabilities | IMPLEMENTED | Real-service integration suites in CI; see [README](../README.md#implementation-status). |
| Tenant and application isolation | IMPLEMENTED | Negative tests for forged context, foreign IDs and direct SQL/RLS access. |
| Application registration and approvals | IMPLEMENTED | Operator enrollment required; see [APPLICATION_REGISTRATION.md](APPLICATION_REGISTRATION.md). |
| Private v2 records/objects and read shares | IMPLEMENTED | Owner-only writes, expiry/revocation and denied cross-app tests. |
| Legacy v1 data/objects | PARTIAL | Explicit client allowlist only; intentionally deprecated. |
| Workflow idempotency and lifecycle | IMPLEMENTED | Reservation/history reconciliation; no exactly-once claim for business effects. |
| Foundation OpenAPI and API Explorer | IMPLEMENTED | Contract checks plus generated endpoint inventory freshness check. |
| Console management UI | PARTIAL | Read/management flows, preview-only mutations in some screens; no admin session. |
| Server-side HTTP developer example | IMPLEMENTED | `npm run example:foundation`; exercised by the application integration suite. |
| Getting Started / onboarding | PARTIAL | Console quickstart, commands, expected proofs and cleanup guidance; enrollment is operator-run rather than self-service. |
| SDKs | DEFERRED | Generate only after client/auth requirements are reviewed. |
| Projects and environments | PROPOSED | P1 gate; no tables or routes. |
| Application bindings | PROPOSED | P2 gate; no credential lifecycle. |
| Hosting, deployments, runtime workers | PROPOSED | Separate approval; no controller or runtime. |
| File quarantine | DEFERRED | Requires an owning subsystem and scan-worker contract. |
| Protected audit boundary | PARTIAL | Internal tenant query, derived actor metadata, redaction, role separation and fail-closed append are implemented; no public audit endpoint, export/sink, cryptographic sealing or DBA tamper resistance. See [AUDIT.md](AUDIT.md). |
| Messaging, notification, search | DEFERRED | No broker, queue or index is deployed. |
| C1 Registry | IMPLEMENTED, bounded | [Registry](CAPABILITY_REGISTRY.md): exact manifests, independent publication approval and terminal revocation. |
| C2 Direct Trust / Discovery | IMPLEMENTED, bounded | [Direct Trust](CAPABILITY_DIRECT_TRUST.md): exact grants, separate rights, live eligibility, audit atomicity and real OIDC restore/denial evidence. Human delegation is deferred. |
| C3 Resolver | IMPLEMENTED, offline | Restricted schema compatibility proof; no public resolver endpoint. |
| C4 Invocation / Composition | DEFERRED | No provider call, ticket, queue or composition worker is implemented. |
| Layer-2 GUI application | DEFERRED | Required by OLP and tracked separately; the Console is not a substitute. |

## What a developer can do today

1. Start the local Compose stack and obtain a verified identity.
2. Register an application after operator enrollment, then approve it through an
   independent administrator.
3. Create, read, update and delete private records and objects through the v2 API.
4. Share an individual record or object for read-only access until an expiry time.
5. Start, inspect, complete and cancel the installed technical workflow.
6. Prove a denied cross-application request and the same request succeeding after
   an explicit share.
7. Explore implemented Foundation operations in the Console. Capability extensions
   use their HTTP contract and are not new Console controls.
8. Run the offline bounded compatibility resolver against the committed manifest,
   composition and compatibility vectors; no resolver endpoint exists.
9. Publish an exact capability through C1 and independently approve a direct
   consumer grant. Discover metadata only with `discover` authority; `invoke`
   establishes future eligibility and does not execute the provider.

See the [developer guide](DEVELOPING.md) for commands and the
[HTTP example](../examples/foundation-http.mjs) for the executable journey.

## Boundaries

- Rosetta Backend remains headless; the Console is optional.
- A project owner, deployment operator or Console reader is not automatically a
  platform administrator or an application resource reader.
- Preview data in the Console is synthetic and never server truth.
- Proposed and design-only items must not be presented as available controls.
- Hosting, bindings, independent audit export/integrity, quarantine, messaging,
  search, human delegation and C4 execution require separate approved slices.
