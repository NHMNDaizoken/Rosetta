# Rosetta architecture and codebase context

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

Rosetta currently integrates five headless backend capabilities through a small
Node adapter, private providers and PostgreSQL authorization. An optional React
Console exists with partially connected management screens. The target product
adds operator-controlled application hosting and optional Verifiable Capability
Composition. Those target domains are proposals requiring approval.

## Changes since the previous architecture

This consolidation accounts for application authority, private resources, the
implemented Foundation OpenAPI and Console commit `7fdd7fc`. It adapts the loaded
Codebase Context Mapper skill to the requested architecture documents instead of
creating competing module, data and API inventories.

## Reading order and document ownership

| Document | Authoritative subject |
| --- | --- |
| [Product definition and status](PRODUCT.md) | Four product areas, status vocabulary, implemented-versus-planned catalog |
| [Developer and extension guide](DEVELOPING.md) | Module map, add-a-route checklist, tests and Console rules |
| [Platform architecture](architecture/ROSETTA_PLATFORM_ARCHITECTURE.md) | Product scope, statuses, AS-IS versus target, document precedence |
| [Core catalog](architecture/LAYER1_CORE_CATALOG.md) | Actual modules, provider ownership, routes, evidence and candidate services |
| [Planes](architecture/CONTROL_DATA_RUNTIME_PLANES.md) | Control, data, runtime, operational and capability boundaries |
| [Ownership](architecture/RESOURCE_OWNERSHIP.md) | Entities, identifiers, lifecycle, authority and namespace migration |
| [Eight editable maps](architecture/ARCHITECTURE_MAPS.md) | Context, AS-IS, target, planes, ownership, deployment, dependencies, reuse |
| [Deployment model](architecture/DEPLOYMENT_MODEL.md) | Options, trusted images, security, failure and recovery contracts |
| [Official traceability](architecture/OLP_REQUIREMENT_TRACEABILITY.md) | Competition categories, evidence and compliance gaps |
| [Decisions](architecture/ARCHITECTURE_DECISIONS.md) | Accepted baseline, proposals, deferred choices and approval evidence |
| [Dependencies](architecture/IMPLEMENTATION_DEPENDENCIES.md) | Acyclic backlog dependencies and independent work |
| [OpenCode handoff](architecture/OPENCODE_IMPLEMENTATION_HANDOFF.md) | Bounded implementation slices and stop conditions |
| [Validation ledger](architecture/VALIDATION.md) | Documentation checks, executed evidence, exclusions and reproducibility notes |
| [Architecture entry](ARCHITECTURE.md) | Repository boundary rules and navigation |
| [Foundation contract](FOUNDATION_OPENAPI.md) | Implemented public API; exact machine schemas remain in its linked OpenAPI |
| [Resource authorization](RESOURCE_AUTHORIZATION.md) | Current v1/v2 security, sharing and migration contract |
| [Capability design](CAPABILITY_EXTENSIONS_V1.md) | Future manifests, resolver, trust and composition contracts |
| [Operations](OPERATIONS.md), [licensing](LICENSING.md), [workflow](WORKFLOW.md) | Existing operational and contribution policies |

## Baseline counts

Tracked source inventory, excluding dependencies/generated output: 11 Core `.mjs`
modules (709 lines), six Core unit files (234 lines), five integration `.mjs` files
including the observer (984 lines), 41 Console TypeScript/TSX files (6,155 lines).
Foundation has 44 operations on 30 paths. These counts describe this baseline,
not code coverage or product completeness.

## Critical knowledge

1. A registered application UUID is the v2 resource owner; project/environment IDs
   must never replace it implicitly.
2. Keycloak authenticates; Rosetta authority decides application permissions.
3. Core reader/writer roles do not grant platform administration.
4. A project owner or deployment operator does not automatically read app data.
5. Current read shares are exact, same-tenant and read-only; capability grants differ.
6. Workflow variables/executions remain tenant-scoped, including for suspended apps
   whose Keycloak tokens still satisfy that separate contract.
7. Console preview/session state and browser activity logs are not server truth.
8. No hosting controller, projects, deployments or Capability Runtime exists.
9. Local Compose is not production HA or hostile-workload isolation.
10. The mandatory Layer-2 GUI remains outstanding; Console does not satisfy it.

## Notes

The named Vietnamese architecture draft was not found in the public repository
or supplied task material and was not reviewed. The explicit task decisions are
the proposal input. Official rules override internal policy; existing implemented
contracts override proposed namespace/API sketches until an approved migration.
