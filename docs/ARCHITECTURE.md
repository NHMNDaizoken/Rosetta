# Architecture Boundaries

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
filesystem. Nginx is the single loopback-published gateway and uses auth-request
against Core; Core also checks authorization at its own boundary. Keycloak
provides OIDC/SSO backed by a separate PostgreSQL database/role. Other Core
integrations are being added; no business application is implemented.

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

See [the integration roadmap](INTEGRATION_ROADMAP.md) for the ordered Core work,
contract decisions, acceptance checks and SynapseDX reference review.
