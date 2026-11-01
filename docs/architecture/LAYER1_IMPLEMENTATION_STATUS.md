# Layer 1 implementation status

Updated: 2026-10-31 | Branch: main

This file records what is actually implemented, what was verified, and what is
still design-only. It is not a requirements document and it does not approve new
scope. Requirements live in [OLP_REQUIREMENTS.md](../OLP_REQUIREMENTS.md);
boundaries live in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Verification baseline

| Check | Command | Result |
| --- | --- | --- |
| Source, SPDX, boundaries | `npm run check` | pass |
| Unit/contract tests | `npm test` | 61 pass |
| OpenAPI + Foundation inventory | `npm run check:contracts` | pass |
| Provider transport | `npm run test:provider-network` | 7 pass |
| Private execution authority | `npm run test:execution-ledger` | 4 pass |
| Migration integrity | `npm run test:migrations` | 8 pass |
| Foundation integration | `npm run test:integration` | 9 pass |
| Application authority | `npm run test:applications` | 13 pass |
| C4A capability runtime | `npm run test:capabilities` | 26 pass |
| Flowable worker contract | `npm run test:flowable-worker` | 2 pass |
| Backup/restore | `npm run test:recovery` | 1 pass |
| Audit boundary | `npm run test:audit` | 7 pass |

## Implemented

- **Module layout** — feature-first `src/platform`, `src/bootstrap`,
  `src/modules/*`; enforced by `scripts/check-boundaries.mjs` (direction rules,
  public entrypoints, no cycles) inside `npm run check`.
- **Configuration/composition root** — `src/bootstrap/config.mjs` validates the
  environment; `src/bootstrap/container.mjs` builds the router and runtime once.
  `src/server.mjs` only binds the process.
- **Migration integrity (Issue #1)** — `infra/postgres/migrate.sh` records
  content checksums in the applying transaction, refuses edited applied files,
  version-only history, partial bookkeeping, newer databases and installed
  schema drift; two runners serialize through `flock` plus a PostgreSQL advisory
  lock. Adoption flags are operator-reviewed. See [MIGRATIONS.md](../MIGRATIONS.md).
- **Read-only drift diagnostic** — `npm run check:schema-drift` fingerprints
  function definitions, owners, ACLs, RLS flags, column grants and policies.
- **C1 registry, C2 direct trust, C4A single-capability execution** — unchanged
  behavior; all suites above remain green after the refactor.

## Design-only / not implemented

- **C4B bounded composition** — `docs/contracts/composition-v1.schema.json` and
  the composition paths in `docs/contracts/capability-api-v1.openapi.json` remain
  design artifacts. No `/v1/compositions` route, composition table, plan
  compiler or multi-step Flowable runtime exists.
- **Human delegation and resolver HTTP endpoints** — design-only.
- **Hosting, projects, deployments, AI runtime** — proposed, not implemented.
- **Layer 2 business application** — the Rosetta Console is a management client,
  not the required user-facing application.

## Known limits

- C4A and any future composition execution are opt-in; disabling them leaves the
  five foundation capabilities intact.
- Readiness is a dependency check, not a capacity or SLA claim.
- Migration adoption flags (`MIGRATION_ADOPT_EXISTING`,
  `MIGRATION_ADOPT_SCHEMA_DRIFT`) are production decisions, not test shortcuts.

## Next step

C4B composition is the only missing authorized capability slice. It needs a new
additive migration (`012`), a plan validator/compiler, a composition registry
route set, and a multi-step Flowable runtime with per-step reauthorization. It
must not modify migrations `001`-`011`, must not add a second scheduler, and must
stay opt-in.
