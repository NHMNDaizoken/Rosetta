# Architecture consolidation validation ledger

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

## Scope and evidence

This milestone changes public Markdown only. Production modules, migrations,
Compose/images/configuration, package manifests/lockfiles, existing Foundation/
Capability JSON contracts, licensing records and CI configuration remain unchanged.
No architecture target, infrastructure access, domain, build or application is
implemented/deployed. The named Vietnamese draft was not found in the inspected
public repository/supplied task and is not cited as reviewed material.

| Check executed during this audit | Result and boundary |
| --- | --- |
| `git status --short`, `git log`, `git show --stat`, `git ls-remote --heads origin main` | Clean starting main at the exact baseline; remote matched. Console commit included in review. |
| `npm run check` | Passed source syntax, SPDX/header and root license-file conventions. Does not audit all Console/transitive licenses. |
| `npm test` | 22 Core tests passed using local Node 24.13.1; no real-provider mutation suite. |
| `npm run check:contracts` | Official OpenAPI structure, refs/schemas/security/inventory passed for 44 operations. HTTPS official metaschema checked by existing tool. |
| `npm run test:contract-validator` | Deliberate regression controls passed. |
| `npm run console:test` | Five preview/UI tests passed. React act warnings remain; no live backend or accessibility conformance certification. |
| Local Markdown path and GitHub-style heading-anchor check | 180 local links/anchors passed across 19 changed/new Markdown files; fenced blocks balanced. |
| Expanded dependency register | 21 nodes/30 directed edges, topologically sorted without a cycle; every register ID represented. |
| MAP 07 dependency extraction | 19 coalesced nodes/28 directed edges, acyclic. IDs coalesce only as documented in dependency register. |
| Mermaid parse/render | All eight map blocks parsed and rendered to SVG; maximum flowchart size 19 nodes. Temporary visual QA of current topology, deployment sequence, DAG and reuse map; no generated image checked in. |
| `git diff --check` and documentation-only boundary check | No whitespace errors; protected production/configuration/contracts/license paths unchanged. |

Non-destructive validation uses existing Node/Python tools. Mermaid 11.12.3
([MIT package license](https://cdn.jsdelivr.net/npm/mermaid@11.12.3/LICENSE)) was
loaded into an ephemeral existing headless browser, not added to a package or
container. The already installed Playwright 1.62.1 package metadata reports
Apache-2.0; its existing Chromium headless binary was used. No package/browser
installation or dependency-manifest change was performed. Existing Python
validation licenses/pins remain in THIRD-PARTY/requirements-contracts.

## Rechecking the documentation

For local links: enumerate README, changed `docs/*.md` and `docs/architecture/*.md`;
resolve Markdown destinations relative to the referring file; ignore external
HTTPS/mailto links; validate target existence and normalized heading anchors.
For the DAG: parse the fenced `A -> B` data in IMPLEMENTATION_DEPENDENCIES and
repeatedly remove nodes with zero remaining incoming edges; an unremovable
nonempty set is a failure. The MAP 07 graph must also sort, and coalesced nodes
must not invent a dependency back into the Foundation.

For diagrams: extract each `mermaid` fence, call Mermaid `parse` then `render` in
an isolated browser, require eight valid SVG outputs without error markers, and
inspect text/arrow layout. Sequence config in the source enables wrapping. GitHub
may use another Mermaid version/theme; exact pixel layout there is not certified.
Temporary browser caches/screenshots stay outside the repository. No external
diagram generation service receives secrets, tokens, private source or runtime data.

## Historical evidence, not rerun locally

The exact-baseline [Foundation CI run](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40211156038)
was read through GitHub's API and reports success. Earlier
[Foundation milestone evidence](../FOUNDATION_OPENAPI.md#local-verification-evidence)
and [CI](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40203682323) describe
real provider, isolation, restart and partial restore tests. The catalog identifies
their scope. Current CI has no Console build/test step, so its green status does
not certify Console authentication, packaging, resources or visual behavior.

No `docker compose up/build/run`, migration, integration/worker/recovery suite,
VPS operation, new container launch or Console build was executed locally for
this architecture task. Those suites intentionally change/start/interrupt test
services and were excluded by the task. Source/config review and historical CI
are the appropriate bounded evidence here; a future implementation must rerun
affected acceptance suites with separate isolated test authorization.

An authorized documentation push may automatically trigger the repository's
unchanged Foundation workflow on GitHub's disposable runner. That external result
must be reported separately from local audit checks; it does not deploy production.

## A1 implementation evidence (2026-10-28)

This later change is not documentation-only. Starting from
`360a7dd741442a2e3dbfc0f10d45a1e387d3b697`, it adds migration 005, Compose
wiring, `integration/audit.mjs`, the audit recovery assertions, package/CI steps
and documentation.

| Check executed | Result and boundary |
| --- | --- |
| `docker compose run --rm data-migrate` (migration 005, applied then reapplied) | Passed transactionally and idempotently on the local stack. |
| `npm run check` | Passed source syntax, SPDX header and project license-file checks. |
| `npm run check:contracts` | 44 reviewed OpenAPI operations passed. |
| `npm test` | 34 Core unit tests passed. |
| `npm run test:integration` | Nine real-service Core tests passed, including restart/recovery. |
| `npm run test:applications` | 13 application/resource/example tests passed, including audit rollback. |
| `npm run test:recovery` | One isolated `pg_dump`/`pg_restore` test passed with audit role/ACL/RLS/query checks. |
| `npm run test:audit` | Seven audit-boundary tests passed, including role denial, redaction, pagination, concurrency, rollback and restart. |

The audit tests use the local Compose database and synthetic, self-cleaning
fixtures. They do not prove DBA tamper resistance, independent export/sink
durability, coordinated full-platform recovery or production retention. CI
execution must be reported from GitHub after the commit is pushed.

## Explicitly unverified or unresolved

No public production availability, live Console session/PKCE, complete WCAG,
full-platform DR/RPO/RTO, runtime hosting, hostile-tenant isolation, quota capacity,
image provenance audit, complete transitive binary/asset license inventory or
Capability Runtime is verified. Published vendor resource prerequisites in the
deployment comparison are not Rosetta benchmarks. The illustrative VPS envelope
is a planning assumption. All target ADRs/permissions/APIs remain proposals.

Official pages were read in full and cited by section in the traceability file.
Their calendar/archive ambiguities remain recorded; no submission/email/release
or organizer clarification is performed. No tags/GitHub releases were observed
at the baseline. The Layer-2 business GUI remains outstanding despite the Console.
