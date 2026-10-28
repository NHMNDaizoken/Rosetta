# Rosetta platform architecture

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`
> Status: accepted implementation baseline plus PROPOSED target; publication is not implementation approval.

## Product and boundaries

The proposed position is a Self-Hosted Open-Source Developer Cloud Platform:
reusable BaaS, application/project management, operator-controlled hosting and
optional secure capability reuse. Two application models use the same Foundation
contracts. External applications run on infrastructure outside Rosetta. Hosted
applications would run on approved operator infrastructure, with identical
application registration and resource authorization. Hosting location supplies
no extra data privileges.

Verifiable Capability Composition remains the long-term differentiator: exact
versioned manifests, deterministic compatibility checks, explicit cross-app trust
and authorized execution through Flowable. Hosting does not replace that design,
and neither BaaS nor hosting should require it. The existing
[project vision](../PROJECT_VISION.md) retains the detailed capability rationale.

Layer 1 owns generic infrastructure and platform mechanisms. Layer 2 owns end-user
products, business entities, business authorization, business workflows and their
GUI. A project here means a deployment/management workspace, not a project-planning
or timesheet product. Hosting a payroll image does not move payroll rules into Core.
The Console is a management client; it does not make the Core UI-dependent or
replace the separate Layer-2 demonstration. [Official mapping](OLP_REQUIREMENT_TRACEABILITY.md)
is the sole consolidated competition interpretation.

## Status vocabulary

| Label | Meaning in these documents |
| --- | --- |
| IMPLEMENTED | Actual source/configuration exists; functionality alone is not inferred. |
| VERIFIED | Named local execution or exact-commit CI evidence exists for the stated scope. |
| PARTIALLY VERIFIED | Some exercised paths exist; named important gaps remain. |
| DESIGN ONLY | Contract/design artifacts exist without runtime implementation. |
| PROPOSED | New architectural recommendation awaiting review. |
| DEFERRED | Deliberately outside the next bounded implementation. |
| UNVERIFIED | Evidence is absent, unavailable or insufficient. |

VERIFIED is never shorthand for production readiness. The catalog distinguishes
historical CI, checks executed during this audit and unexecuted acceptance plans.
Future state transitions and API sketches are all PROPOSED unless explicitly
identified as current contracts.

## AS-IS baseline

Nginx routes public loopback HTTP to Keycloak or the existing Node Core. Core
introspects tokens and calls private PostgREST, SeaweedFS and Flowable. PostgreSQL
hosts distinct identity/data/workflow databases and roles in one container.
Application authority and resource metadata use private tables in the data
database; they are logical modules, not additional services.

Migrations 001–005 implement legacy records, the workflow idempotency ledger,
application authority, v2 resources/shares and the bounded protected audit
boundary. Named volumes persist PostgreSQL
and SeaweedFS state. Gateway/Core repeat authentication at their own boundaries.
Only Gateway normally publishes loopback port 8080; the optional Console profile
also publishes loopback 3000. No hosting runtime controller or project namespace
is present. See [MAP 02](ARCHITECTURE_MAPS.md#map-02-current-implemented-architecture).

Console source exists, but its identity fallback, simulated resource methods and
browser token persistence limit its status to PARTIALLY VERIFIED. There is no
server hosting management API behind its screens. The
[catalog findings](LAYER1_CORE_CATALOG.md#console-evidence-and-contradictions)
qualify older Console claims.

## Logical taxonomy

| Group | Scope | Current versus target |
| --- | --- | --- |
| A — Foundational Cores | Identity, Gateway, structured data, object storage, workflow | IMPLEMENTED; bounded verification evidence |
| A+ — Platform control | Registration/authority, ownership, shares, static API contract governance | IMPLEMENTED; no separate sixth required Core |
| B — Foundation extensions | Quarantine, cleanup, data history, automation workers, OAuth credential lifecycle | PROPOSED; extend A, do not duplicate providers |
| C — Shared services | Protected audit, events, notification, search, secrets, PII processing | Audit boundary is IMPLEMENTED in PostgreSQL; independent export/integrity and other candidates are PROPOSED; reuse must be demonstrated |
| D — Capability platform | Registry, Resolver, Cross-App Trust, Composition & Execution | DESIGN ONLY; application registration subset already in A+ |
| E — Operations | Telemetry, CI/CD, GitOps, backups, supply chain, host operations | Existing CI/health/partial restore; production controls PROPOSED |
| F — Developer cloud | F1 projects; F2 deployments; F3 runtime; F4 routes/domains; F5 bindings; F6 diagnostics | PROPOSED logical modules, not six services |

A technical worker may be a separate process when its privileges, failure domain
or workload justify it. Group letters do not prescribe containers. Retain one
reviewable management module for ordinary metadata initially. The privileged
deployment controller needs a separate trust boundary even if placed on the same
operator-owned machine. Existing Core must never acquire a Docker socket.

## Target direction and ownership of specifications

The [planes](CONTROL_DATA_RUNTIME_PLANES.md), [entity model](RESOURCE_OWNERSHIP.md)
and [deployment model](DEPLOYMENT_MODEL.md) define the target. The target assumes
trusted, prebuilt digest-pinned OCI artifacts on a constrained single host first.
Untrusted source builds and hostile tenants require a separate isolated-worker
design and are DEFERRED. No runtime, VPS size or deployment component is approved
by this document. Kubernetes/OpenStack have no demonstrated requirement here.

| Question | Controlling document |
| --- | --- |
| Exact current route/schema/status | [Foundation OpenAPI](../contracts/foundation-api.openapi.json) and [Core API](../CORE_API.md) |
| Current app binding, shares and v1 migration | [Resource authorization](../RESOURCE_AUTHORIZATION.md), migration 004 |
| Enrollment and application state | [Registration](../APPLICATION_REGISTRATION.md), migration 003 |
| Future capability wire contracts | [Capability v1](../CAPABILITY_EXTENSIONS_V1.md), [trust/execution](../CAPABILITY_TRUST_EXECUTION_V1.md), [runtime review](../CAPABILITY_RUNTIME_REVIEW_V1.md) |
| New target relationships and decisions | This bundle; [ADRs](ARCHITECTURE_DECISIONS.md) identify approval gates |
| Next implementation scope | One explicitly authorized [handoff slice](OPENCODE_IMPLEMENTATION_HANDOFF.md) |

Do not copy proposed hosting endpoints into the implemented OpenAPI. Add a
separate management contract only after review, then publish implemented status
with tests. Proposed permissions are not inferred from current roles. No service
may write another subsystem's private tables to simulate an integration.

## Delivery tradeoffs

Maintain Foundation contracts and complete a separate Layer-2 GUI independently
of hosting. Close Console trust/truthfulness gaps before expanding management UI.
Then approve project/environment metadata before privileged execution. Admission,
recovery and routing gates precede real hosted workloads. Optional shared services
and capabilities proceed only with independent cross-app acceptance evidence.
The [dependency DAG](IMPLEMENTATION_DEPENDENCIES.md) expresses prerequisites,
not dates or a promise to implement every candidate.

## Notes

The draft titled “Rosetta DX-OS — Đặc tả kiến trúc chung Tầng 1” was not located;
no claims are attributed to it. New architecture follows the explicit task input
and inspected code. No production code, contract, migration, dependency or runtime
configuration is changed by this consolidation.
