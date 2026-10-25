# Five-Core integration roadmap

The current Foundation acceptance history below remains useful. New platform work
is ordered by the [architecture dependency register](architecture/IMPLEMENTATION_DEPENDENCIES.md)
and [OpenCode slices](architecture/OPENCODE_IMPLEMENTATION_HANDOFF.md). Hosting and
Capability Runtime remain proposed and require separate approvals; the mandatory
Layer-2 product can proceed independently.

## Current boundary

The health foundation and five Core integrations are implemented: Keycloak,
Nginx, PostgreSQL/PostgREST, SeaweedFS and Flowable REST. HTTP contracts, tenant
denials and workflow idempotency are tested against real containers. Cross-core
tests interrupt/recreate dependencies and verify durable records, object bytes
and workflow state. Isolated PostgreSQL dump/restore verification covers
structured data, ownership/ACLs and tenant RLS. See [operations](OPERATIONS.md)
for the limits of this local recovery evidence.
`/health` remains
a process-liveness contract and must not silently become an aggregate readiness
check when services are added.

The five foundational capabilities and cross-core verification are implemented.
Application Authority, v2 resources/shares, Foundation OpenAPI and an optional
partially connected Console were added afterward. The [Capability v1 design](CAPABILITY_EXTENSIONS_V1.md)
remains design-only beyond registration/approvals. Future hosting and capability
implementation follow the separately approved architecture slices linked above.
The maintainer has approved original source under Apache-2.0 with attribution
2026 Rosetta Contributors and authorized public source publication to the
authenticated account's `Rosetta` repository on `main`. New integration
dependencies still require upstream license/edition review under
[the licensing policy](LICENSING.md). Production deployment remains unapproved.

## Integration order and acceptance evidence

Use existing open-source infrastructure, pinned by version and image digest;
implement only the adapters needed for the platform boundary. Record component
provenance, editions, dependencies and notices in `THIRD-PARTY.md` before use.
An OSS edition must actually provide the selected feature.

| Order | Capability and integration work | Minimum verification before committing |
| --- | --- | --- |
| 1 | **Identity / SSO:** integrate an upstream OIDC provider; configure clients, issuer, audiences, roles and authoritative tenant membership. Separate admin/bootstrap credentials from caller credentials. | Discovery and real token issuance/validation work; expired tokens, wrong issuer/audience and insufficient role are rejected. Two tenants cannot acquire each other's privileges. No email-only/demo login bypass. |
| 2 | **API Gateway:** integrate an upstream OSS gateway using the Identity contract. Publish versioned routes; configure authentication, bounded requests, upstream timeouts and consistent errors. Keep upstream services on private networks. | An authenticated call reaches the intended upstream; missing/invalid tokens fail closed; caller-supplied identity headers cannot impersonate another tenant; identity/upstream outages produce defined failures. |
| 3 | **Structured Data:** integrate a durable upstream database and a documented service boundary. Add versioned migrations, dedicated credentials and explicit tenant isolation; keep app schemas/business rules outside the reusable Core. | CRUD survives restart; tenant A cannot read/write tenant B's rows through API or direct service access; malformed inputs fail; migration and backup/restore procedures are tested against disposable data. |
| 4 | **Unstructured Data:** integrate an upstream object store with an authenticated API contract, tenant-scoped storage policies, bounded uploads and explicit download authorization. Keep root/storage admin credentials private. | Authorized upload/download/delete succeeds; cross-tenant object keys and guessed identifiers fail; size/type rules apply; object data persists across restart. Any signed URLs expire and remain object-scoped. |
| 5 | **Workflow Engine:** integrate an upstream headless engine with versioned workflow definitions, tenant-scoped execution/history, idempotency and defined retry behavior. Use only technical integration workflows as fixtures. | Authorized start/status/cancel works; retries do not duplicate side effects; restart preserves execution state; unauthorized definitions, executions and histories remain inaccessible. |
| 6 | **Cross-core verification:** run one technical fixture through Identity → Gateway → structured metadata/object storage → Workflow. Add dependency-aware readiness separately from `/health`. | The positive flow and two-tenant denial cases pass against real Compose services. Stop a dependency and assert readiness fails while process liveness remains accurate; restore it and verify recovery. |

## Contracts to approve before integration

- Identity: issuer, audience, subject and tenant claim semantics, role ownership,
  key rotation and token lifetimes. Tenant identity comes from verified claims,
  never an untrusted header alone.
- Service APIs: identifiers/versions, inputs, outputs, authorization rules,
  side effects and error behavior. Preserve the existing health contract.
- Data and workflows: ownership, migration/recovery procedure, persistence,
  idempotency and execution permissions. No direct access to another app's data.
- Operational readiness: list required dependencies and timeout behavior;
  never return a successful aggregate status for missing integrations.

These are implementation decisions, not additional organizer requirements.

## Repository, Compose and CI practices

Use one branch, `main`, with cohesive, verified Conventional Commits. Add upstream
configuration under `infra/` only when an integration is approved; keep reusable
source and technical integration tests separate. Do not create empty service
packages, SDKs or application scaffolding in advance.

Compose integrations should use explicit internal networks, persistent volumes
only where required and health-based dependency ordering. Credentials must be
provided locally/through deployment secrets, never working credentials committed
as defaults. Local `docker compose down` must not delete persistent volumes.
Destructive resets or migrations require explicit approval.

Extend CI to run service tests, validate configuration, start real dependencies,
exercise cross-core success/denial/failure cases, collect diagnostics on failure
and clean up ephemeral containers. Keep CI checks distinct from publishing and
production deployment. Verify CI per exact commit; the architecture
[evidence catalog](architecture/LAYER1_CORE_CATALOG.md) records the successful
baseline run and distinguishes it from local checks.

## SynapseDX reference review

Reviewed [vku-open-source-2026/SynapseDX at a731ad9](https://github.com/vku-open-source-2026/SynapseDX/tree/a731ad928f4a261cd65e531d427a0be4a8922b90):
the README layout, development/production Compose files, CI/CD workflows and
production guide. Useful patterns are separate infrastructure configuration,
health-based startup, live integration checks and documented deployment steps.
Its production configuration removes internal service ports; its CD workflow
publishes after CI. Rosetta currently has local execution and checks only.

This is an organizational reference. No SynapseDX source/configuration was
copied, and its license does not license Rosetta. Its application, SDK, AI and
other infrastructure scope is outside this implementation.

## Publication and deployment gates

Before creating/pushing a GitHub repository, approve licensing/header decisions,
confirm the authorized owner/name and authenticated account, inspect any remote
history and push verified commits to `main` without force. Do not publish an
image or deploy to production as a side effect of committing or pushing.
Keep `AGENTS.md` tracked; exclude private agent prompts, memory, logs and local
tool state. Before pushing, inspect `git status --short`, `git check-ignore -v`
and `git ls-files`. Untrack any indexed private files with `git rm --cached`
while preserving local copies. Removing a file from the index does not erase
prior Git history; never rewrite history without authorization.

Production deployment additionally needs an approved target, network/TLS/secrets
configuration, resource limits, backup/recovery and a verified rollback. Those
choices are not supplied by the current local Compose stack. No Layer 2 logic,
GUI, AI, SDKs, Kubernetes or OpenStack belongs in this work.
