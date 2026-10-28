# Architecture Boundaries

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

## Consolidated architecture and changes

Start with the [architecture index](index.md) and
[platform definition](architecture/ROSETTA_PLATFORM_ARCHITECTURE.md).
This consolidation accounts for Application Authority, v2 ownership/sharing,
Foundation OpenAPI and the partially connected Console. It proposes external
and Rosetta-hosted application models while preserving optional Verifiable
Capability Composition. Hosting, projects, deployments and Capability Runtime
are not implemented or approved by this documentation.

The [catalog](architecture/LAYER1_CORE_CATALOG.md) owns implementation/evidence;
[ownership](architecture/RESOURCE_OWNERSHIP.md),
[planes](architecture/CONTROL_DATA_RUNTIME_PLANES.md) and
[deployment model](architecture/DEPLOYMENT_MODEL.md) own target responsibilities.
Use the [eight maps](architecture/ARCHITECTURE_MAPS.md),
[ADRs](architecture/ARCHITECTURE_DECISIONS.md),
[dependency DAG](architecture/IMPLEMENTATION_DEPENDENCIES.md) and
[one-slice handoff](architecture/OPENCODE_IMPLEMENTATION_HANDOFF.md).
Official interpretation is consolidated in [traceability](architecture/OLP_REQUIREMENT_TRACEABILITY.md).

## Layer 1 — Headless PaaS

Required Core capabilities: Identity/SSO; API Gateway; structured data; unstructured/object data; workflow engine. All must be reusable independently of a single demo application's business rules.

## Layer 2 — Applications

At least one user-facing GUI application must exercise Core APIs in a real end-to-end scenario. Technical vendor administration consoles do not substitute for this application.

## Platform contracts

- Apps access Core through documented APIs/SDKs, not direct access to another app's private database.
- Apply authentication/authorization **at the service boundary**, not only the UI.
- Isolate tenants/organizations and scope data access explicitly.
- Treat schemas, API versions, events and workflow definitions as versioned contracts. Assess affected clients before breaking changes.
- A new cross-app capability should declare identifier/version, inputs, outputs, permissions and side effects. Run-time validation is still required even if pre-flight checks pass.
- Favor proven open-source services and thin adapters over rewriting IAM, gateways, data stores or workflow engines.

## Scope discipline

Do not add AI runtimes, sandbox infrastructure, MCP/A2A, vector databases, or other services merely because they are fashionable. Each addition requires a user-facing use case, architecture rationale, license review, minimal test and owner approval.

The current product direction (Capability-Driven DX-OS) is **proposed**, not an excuse to treat unapproved features as requirements.

## Implemented foundation

`src/health.mjs` exposes a minimal process-health HTTP server;
`src/server.mjs` supplies environment configuration and shutdown handling.
`scripts/check-health.mjs` validates its JSON response for local/container probes.
`compose.yaml` runs this single process as a nonroot container with a read-only
filesystem for Core. Nginx is the single loopback-published gateway and uses auth-request
against Core; Core also checks authorization at its own boundary. Keycloak
provides OIDC/SSO backed by a separate PostgreSQL database/role. Other Core
integrations provide the five capabilities below; no business application is implemented.

Identity claims, endpoint versions and tenant authorization are described in
[CORE_API.md](CORE_API.md). The database is shared infrastructure with separate
database owners for identity, structured data and workflow; applications never
receive these credentials.

Structured data uses a private PostgREST service. Core mints a 30-second internal
assertion from the verified tenant identity; SQL RLS controls every record read
and write. The database authenticator and nonlogin API role have separate duties;
neither caller input nor an application chooses the database role or tenant.

Unstructured objects use SeaweedFS OSS behind the authenticated Core adapter.
The objects network contains only Core and SeaweedFS; a named volume stores both
chunks and filer metadata. All storage paths derive from verified tenant claims
and UUIDs. Files are returned as attachments. Stable-UUID PUT is the retryable
upload contract; POST creates a new object.

Flowable REST is the private BPMN engine. Core checks the tenant's definition
and execution ownership; an RLS-protected SQL ledger reserves idempotency keys
before starting work and reconciles ambiguous outcomes against engine history.
The one-shot initializer provisions only an original technical checkpoint
fixture. No Layer-2 business GUI/workflow, SDK or AI component is implemented.
The optional Rosetta Console is a management client with the limitations recorded
in the catalog; it is not a separate authorization server or hosting control API.

The current topology is maintained in
[MAP 02](architecture/ARCHITECTURE_MAPS.md#map-02-current-implemented-architecture),
including logical authority adapters and public/private boundaries.

Separate private networks isolate identity, data, objects and workflow backends;
Core joins the networks it integrates. The gateway publishes a loopback
port; the optional Console profile also publishes loopback port 3000.
Operator access to Docker/database/engine credentials is a trusted local
administrative boundary, not an end-user permission model.

See [the integration roadmap](INTEGRATION_ROADMAP.md) for the ordered Core work,
contract decisions, acceptance checks and SynapseDX reference review.

## Capability extension design boundary

[Capability extensions v1](CAPABILITY_EXTENSIONS_V1.md) specifies proposed registry, compatibility, trust and composition contracts. Application Registration and a pure offline compatibility resolver are implemented as bounded subsets; registry, trust, composition and resolver endpoints remain design-only. Application Registration uses one additive migration and no new service or network. The existing Flowable integration remains the sole workflow engine. Identity enrichment and new authority stores must preserve current public claims/responses and APIs; internal app bindings are not extra fields promised by GET /v1/identity.

## Application resource authorization

[V2 records and objects](RESOURCE_AUTHORIZATION.md) reuse the current adapters
and providers. PostgreSQL resolves an active application from verified tenant,
issuer, client and an operator-enrolled backend subject. A separate resource API
role and forced record RLS enforce ownership and exact read shares. Private
object metadata authorizes immutable SeaweedFS versions; legacy paths cannot
address these bytes. Application state and enrollment are checked on every
operation. Human requests go through a Layer-2 backend; no delegated identity or
browser writer credential is introduced. Additive migration 004 and the documented
legacy allowlist/migration contract precede rollout. Workflow isolation remains
tenant-scoped and is outside this milestone.

## Application Registration implementation

The [runtime review](CAPABILITY_RUNTIME_REVIEW_V1.md) adds tenant-scoped application registration and application-only approvals to the existing Core adapter. Private PostgreSQL authority tables and a separate RPC role isolate administration from generic CRUD records. The capability registry, resolver endpoint, delegation, provider execution and composition remain unimplemented; only the offline compatibility proof module exists. Existing five-Core contracts and GET /v1/identity stay unchanged.
