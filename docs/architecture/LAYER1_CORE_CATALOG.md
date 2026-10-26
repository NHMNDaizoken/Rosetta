# Layer-1 implementation and candidate catalog

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `3bd6a2026becbce9a44bac6a18f72d0fc4ecd209`

## Evidence conventions

Source review covers `src/`, migrations 001–004, Compose/provider configuration,
Core unit/integration tests, Console API client/screens and CI. Relative links
below navigate to actual files. VERIFIED uses the bounded evidence here; none
of these labels establishes a currently running public deployment.

| Evidence | Executed or inspected | Result/scope |
| --- | --- | --- |
| E1 | This audit: `npm run check` | Source syntax/SPDX/project license-file checks passed; not a transitive license audit. |
| E2 | This audit: `npm test` | 22 tests passed; local Node 24.13.1, ephemeral unit HTTP processes only. |
| E3 | This audit: `npm run check:contracts`; `npm run test:contract-validator` | 44-operation OpenAPI and regression controls passed. |
| E4 | This review: `npm run console:test`; `npm run console:build`; `npm run check:endpoints`; `npm run test:console-container` | 27 Console tests (8 API client, 13 UI, 6 OpenAPI example/inventory), the production bundle, the 44-operation endpoint freshness check and the packaged Nginx container contract test passed locally. No automated live-browser OIDC/visual/accessibility proof. |
| E5 | [Foundation CI for S0](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40257293982) | GitHub reports success for Foundation checks at `3bd6a2026becbce9a44bac6a18f72d0fc4ecd209`; includes the Console suite/build plus container, Core/app isolation, worker and restore steps. |
| E6 | [Previous Foundation CI](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40203682323), [local milestone ledger](../FOUNDATION_OPENAPI.md#local-verification-evidence) | Historical 2026-10-25 results at `431bca4`: 22 native/pinned units, nine Core, 13 app, one worker, one restore; 376 HTTP observations, all 44 successful operations. Not rerun here. |

This review executes unit, Console bundle and packaged-console contract checks
locally. It deliberately does not run the full service-interruption/restore/worker
suites or apply migrations. CI is external evidence, not a claim that every suite
passed locally on 2026-10-26. The current workflow installs, tests and builds the
Console and contract-tests its packaged image.

## Group A: five existing integrations

| Core / status | Actual responsibility and source | Public / private interfaces | Authoritative state and dependencies | Authentication/enforcement | Evidence and limits |
| --- | --- | --- | --- | --- | --- |
| Identity/SSO — VERIFIED within E2/E5/E6 | [auth.mjs](../../src/auth.mjs), [realm](../../infra/keycloak/realm.json), [Compose](../../compose.yaml) | Public OIDC discovery/auth/token/refresh/keys/userinfo/logout under `/identity/realms/rosetta`; `GET /v1/identity`. Private introspection and provider admin API. | Keycloak 26.8.1 owns principals, OAuth clients, sessions/keys in `rosetta_identity`; Core does not own a second identity DB. | Live introspection; active, issuer, audience `rosetta-core`, expiry, subject, tenant membership, reader role; private verified client context for app APIs. | Real PKCE/logout and outage cases in [core suite](../../integration/core.mjs). No production MFA enrollment, identity backup/rotation/HA proof. Realm uses local HTTP settings. |
| Gateway — VERIFIED within E5/E6 | [Nginx](../../infra/nginx/default.conf), [API dispatch](../../src/api.mjs) | Public health/readiness, OIDC, `/v1/*` and `/v2/*`; internal Nginx `/_authorize` calls Core `/internal/auth`. | Config owns routing; Nginx has no app data. Edge/identity networks and Docker DNS. | Gateway auth_request plus repeated Core authorization; 100 requests/s/IP with burst 50 for versioned APIs, 10 MiB body bound, timeouts. | Missing/spoofed tokens and outages exercised historically. Local HTTP only; no TLS/custom domains/WAF/quarantine. `/identity/` delegates broadly, including provider routes; public production exposure needs explicit admin-path review. |
| Structured data — VERIFIED within E2/E5/E6 | [data.mjs](../../src/data.mjs), [001](../../infra/postgres/001-data.sql), [004](../../infra/postgres/004-resource-authorization.sql) | `/v1/data/{collection}[/{id}]`, `/v2/data/{collection}[/{id}]`; private PostgREST `core.records`, `core.app_records`. | PostgreSQL 17 `rosetta_data`; PostgREST v16.5 is transport. Core controls short internal assertions and IDs. | Tenant forced RLS for v1; tenant/active app/exact sharing forced RLS for v2. API roles nonlogin/NOBYPASSRLS; column grants prevent ownership mutation. | Unit assertion tests, real API/direct SQL/PostgREST negative cases and isolated restore. GET limit 1–100 only; no cursor, general query language, record history, app environment namespace or measured capacity. JSON limit 64 KiB. |
| Object storage — VERIFIED within E2/E5/E6 | [objects.mjs](../../src/objects.mjs), [resources.mjs](../../src/resources.mjs), [filer](../../infra/seaweedfs/filer.toml), migration 004 | `/v1/objects[/{id}]`, `/v2/objects[/{id}]`; private filer 8888/master 9333; no app access to these ports. | SeaweedFS OSS 4.48 owns bytes/metadata on `object-data`; PostgreSQL owns v2 owner/current version/tombstone/shares. Legacy and v2 prefixes differ. | Server-generated tenant/app/UUID/version paths, SQL authorization before publication; recheck after read. Owner-only writes, exact read shares. | Historical byte round trip, foreign-app denial, state changes, restart and UUID-takeover tests. Upload 1 byte–5 MiB; opaque attachments. No malware check, physical erasure, old-version cleanup, quota or coordinated object restore proof. |
| Workflow — VERIFIED within E2/E5/E6 | [workflow.mjs](../../src/workflow.mjs), [client](../../src/workflow-client.mjs), [002 ledger](../../infra/postgres/002-workflow-requests.sql), [fixture](../../infra/flowable/checkpoint.bpmn20.xml) | Definitions GET; executions POST; execution GET/DELETE; complete POST. Private Flowable `/flowable-rest/service/*`, external-job API private. | Flowable OSS REST 8.0.0 owns runtime/tasks/history in `rosetta_workflow`; `core.workflow_requests` owns tenant/key/input hash/engine correlation. | Core reader/writer and tenant definition/history checks; private engine operator credential. No app-state binding on these routes. | Idempotency/reconciliation, input-depth, tenant denial, lifecycle and restart cases. One active task completion; operator-installed definitions, no public BPMN upload. Tenant-scoped, no private app payload guarantee or production capability worker. |

All providers use the pins in [Compose](../../compose.yaml). Identity/data/workflow
have separate DB owners in one PostgreSQL process: logical separation does not
remove the shared host/database failure domain. Only Core joins the objects
network; Gateway cannot contact the filer directly.

### Provider licenses

Existing provenance links, exact image digests and obligations remain in
[THIRD-PARTY.md](../../THIRD-PARTY.md#layer-1-infrastructure-review): Keycloak,
SeaweedFS and Flowable Apache-2.0; Nginx BSD-2-Clause; PostgreSQL PostgreSQL
license; PostgREST MIT. Rosetta remains Apache-2.0. These identify selected OSS
source editions, not every bundled OS/JVM/library license. Binary redistribution,
complete SBOM and vulnerability audits remain UNVERIFIED. No license/dependency
selection is changed by this document.

## Group A+: implemented platform control

| Component / status | Source, APIs and state | Authorization, integration and gaps |
| --- | --- | --- |
| Application Authority — VERIFIED within E2/E5/E6 | [applications.mjs](../../src/applications.mjs), [003](../../infra/postgres/003-applications.sql). Seven operations across application create/get/approve/state and approval create/get/revoke. Private `core.application_command` RPC. `app_private.principals`, `enrollments`, `applications`, `approvals`. | Exact verified tenant/issuer/subject/client matches operator enrollment. Explicit register/approve/trust permissions; independent approver, digest/revision/expiry checks, ETag preconditions. No public tenant/principal/client provisioning, listing or ownership transfer. Registration never contacts provider origins. |
| Resource authority and shares — VERIFIED within E2/E5/E6 | [resources.mjs](../../src/resources.mjs), migration 004: `resource_actor`, `resource_readable`, `resource_command`, private `resource_objects`, `resource_shares`. Public share POST/DELETE only. | Exact backend `resource_subject`, active app/enrollment, owner-only mutations, same-tenant exact read grant ≤24 hours. Ordinary admin authority does not grant v2 data access. No wildcard/write/reshare/delegation or share-list endpoint. |
| Durable authority audit — PARTIALLY VERIFIED | Actual table is `app_private.audit`, not `app_private.audit_events`. Migration 003 app/approval mutations and 004 share mutations append within the transaction. | Ordinary API roles cannot modify audit authority. Failed share audit rolls back grant in [app tests](../../integration/applications.mjs). No public audit API, cryptographic sealing, independent retention, complete access/deployment audit or DBA tamper resistance. |
| Contract governance — VERIFIED within E3/E5/E6 | [Foundation OpenAPI](../contracts/foundation-api.openapi.json), [validator](../../scripts/check-contracts.py), [HTTP observer](../../integration/contract.mjs). Static files/tooling, not a registry service. | 44 operations/30 paths; known successful requests and negative responses validated. Independent reviewed route matrix requires maintenance. Keycloak full vendor surface and all fault branches are not exhaustively modeled. Capability contract remains separate DESIGN ONLY. |
| Legacy v1 compatibility — VERIFIED within E2/E5/E6 | [resource contract](../RESOURCE_AUTHORIZATION.md#contract-and-migration-decision-before-implementation), `LEGACY_RESOURCE_CLIENTS`, `core.records`, separate object prefix. | Explicit operator allowlist; no automatic ownership adoption. App suspension does not remove legacy allowlist or disable Keycloak; operator actions are separate. v2 has no automatic fallback. |

## Console evidence and contradictions

Console is IMPLEMENTED, PARTIALLY VERIFIED management UI, not a new authority
service or Layer-2 business product. [App](../../console/src/App.tsx),
[API client](../../console/src/services/apiClient.ts), [tests](../../console/src/tests/App.test.tsx),
[Vite config](../../console/vite.config.ts) and [Dockerfile](../../console/Dockerfile)
are the evidence; the screen matrix in older documentation alone is insufficient.

| Finding | Actual behavior and consequence | Required next evidence |
| --- | --- | --- |
| Authentication | Manual bearer token is held in memory only; the legacy `rosetta_token` localStorage entry is removed at startup. No Console PKCE exchange/BFF session exists, so a page reload requires re-entering the token. Foundation PKCE tests do not prove Console login. | Preserve non-persistence; operator login/session design remains future work and needs explicit approval. |
| Live identity | LIVE mode shows explicit loading/unauthorized/unavailable states and never substitutes `MOCK_IDENTITY`; workflow definitions and resource lists fail closed instead of falling back to mocks. | Add automated live-browser OIDC proof without weakening the fail-closed states. |
| v2 resources | Record/object/share writes are disabled or labeled preview-only in LIVE mode; switching PREVIEW to LIVE clears preview stores. A browser cannot become an enrolled backend by supplying an app UUID. | Exercise a real enrolled app flow when a Layer-2 client exists; no delegation shortcut. |
| Application/workflow UI | Calls use existing application/workflow routes; live lists contain only data fetched or created in the session, and endpoints without a listing contract show an explicit notice. Mock stores are disjoint and cleared on mode change. | Test route/status/schema/ETag bodies against the real stack; no invented global listing. |
| Explorer | [Endpoint inventory](../../console/scripts/generate-endpoints.mjs) is generated from the OpenAPI contract (44 operations) and checked in CI. [Example generator](../../console/src/constants/openapiData.ts) emits operation-specific JSON/form/binary/query bodies, required `If-Match`/`Idempotency-Key` headers, bearer placement, browser-navigation and empty-response handling; examples are schema-validated in tests. | Keep the generated inventory current when the contract changes; no real credentials are embedded. |
| Session activity | Browser-generated events remain local diagnostic activity; the Security screen states that no protected server audit API exists and does not present the events as immutable server audit. | Add a server audit API only under a separate approved contract. |
| Optional container | Multi-stage build uses the Console lockfile with `npm ci`, then serves static assets from the pinned non-root Nginx runtime. The container is read-only, drops all capabilities and proxies a narrow `/api` allowlist to `gateway:8080` over Docker DNS. The contract test covers startup, static/SPA behavior, allowed/blocked routes, headers, credentials, upstream errors and timeout. | Repeat browser visual/accessibility QA and re-check pins on dependency changes. |
| Coverage and assets | 27 Console tests; Console install/test/build/endpoint check and packaged-container contract test run in Foundation CI. Google Fonts are fetched at runtime with a system-font offline fallback; no font assets are bundled. | Accessibility/live visual QA and full transitive license review remain separate work; this document does not certify them. |

Core still enforces authorization even if the Console displays a misleading
identity or success state. S0 and its packaging slice addressed the trust and
packaging gaps without adding Core APIs. Remaining Console work is live
browser/accessibility QA and an approved operator-login/session design.

## Groups B/C: optional catalog, not installed services

All entries below are PROPOSED. Priority is relative to a demonstrated consumer:
P1 is a prerequisite before hosting enablement or a known safety gap; P2 follows
that need; P3 is deferred until cross-app demand. Complexity S/M/L is an engineering
estimate, not measured effort or RAM. No candidate has executed acceptance evidence.

| Candidate / owner | Existing overlap and cross-app contract | Boundary, dependency, priority and acceptance | Upstream option / resource tradeoff |
| --- | --- | --- | --- |
| Quarantine — B/object Core | Two apps upload opaque files; scan a version hash before downloadable publication. Current objects are not scanned. | Private worker gets one version, no general filer/admin credential. Infected/unknown/scanner-down cannot be read; clean grant still respects shares. Requires approved compatibility/migration ADR 011; P1, L. Demo EICAR, timeout, replacement race. | [ClamAV](https://docs.clamav.net/) GPLv2; separate scanner with signature updates; distribution/source obligations and bundled notices reviewed before pinning. Signature memory/CPU adds material overhead; measure concurrency. |
| Object lifecycle — B/object Core | Current tombstones/immutable versions already provide deletion semantics, not cleanup. Two apps need quota/reclamation without exposure. | Conservative version-reference reconciliation, retention and protected audit; no reclamation before backup/share/race proof. P2, M/L. Interrupted upload/replacement remains inaccessible; referenced bytes survive cleanup. | Existing SeaweedFS + PostgreSQL; no new store. CPU/I/O scales with inventory; bounded batches. |
| Data history — B/data Core | Current records replace JSON, no revision history. Reusable temporal API for independent apps. | App/tenant RLS on historical versions and restore action; no undelete sharing bypass. ADR and additive tables required; P2, M. A's past values invisible to B; concurrent revision conflict. | Existing PostgreSQL; added storage/write amplification, retention cap needed. |
| Automation/jobs — B/workflow | Flowable history/ledger already exists; external-job REST is a tested provider contract, not a worker. | Technical scheduled tasks only; no untrusted scripts. Authorize tenant/app per job, constrain worker acquisition. Tenant filter absent in current worker probe. P2, L; crash/redelivery/wrong tenant/expired credential tests. | Existing Flowable. Separate worker only if justified; credential leases and tenant-safe dispatcher gated by Capability review. |
| OAuth credential lifecycle — B/identity integration | Existing operator enrollment/client issuance; no Rosetta self-service rotation. Reusable for hosted/external backends. | Audited operator IdP adapter, least privilege, no secret returns to browser; staged rotation updates exact subject binding safely. P1 for hosting, M/L. Old/new token behavior and rollback tests. | Existing Keycloak; credentials are not app registrations. No new identity DB. |
| Protected audit — C/E | Existing transaction audit reusable but incomplete. Restricted tenant/app-filtered query/export and remote integrity sink. | No user-writable generic records, no tokens/payload dumps; admission audit fail-closed for sensitive changes. ADR 012; P1 before hosting, L. DBA tamper/threat scope and storage failure tests. | Start existing PostgreSQL access control plus independently controlled sink; cryptographic design undecided. Additional retention/I/O, no immutable guarantee today. |
| Event/messaging — C | No reusable bus; workflow engine is not a broker. Two apps publish/consume namespaced technical events. | Tenant/app ACLs, outbox, replay/idempotent consumers, bounded retention/backpressure. P3, L. Cross-tenant topic denied; duplicate/lost ack handled. | [NATS server license](https://github.com/nats-io/nats-server/blob/main/LICENSE) Apache-2.0 candidate. Persistence/consumer volume determines overhead; no throughput benchmark. |
| Notification — C | No delivery service; Layer-2 selects business recipients/templates. Technical delivery requests/status reusable. | No arbitrary SMTP credentials/URLs; allowlisted channels, rate caps, tenant audit, idempotency. Requires proven two-app demand and optional event transport only if chosen. P3, M/L. Duplicate dispatch, wrong tenant, provider timeout. | Narrow adapter over operator-configured delivery transport; upstream/package choice DEFERRED with license gate. No provider purchased. |
| Search — C | Existing records/storage supply source, not a shared index. Start PostgreSQL full-text option before another engine. | Query-time tenant/app/share checks, deletion/revocation propagation; never expose raw shared index keys. P3, L. Revoke share and verify stale search hit/snippet denied. | PostgreSQL license, existing provider. [Meilisearch main](https://github.com/meilisearch/meilisearch/blob/main/LICENSE) is mixed MIT/BSL, so no blanket OSI claim or approved image. An OSS-only edition would need proof. Index memory/storage must be bounded. |
| Secrets — C, consumed by F5 | Existing local env variables are not a secrets lifecycle API. Bind references for two apps without exposing peer values. | Operator key custody, app/environment delivery ACLs, no frontend readback, version/rotation/recovery. P1 for hosting bindings, L; wrong app, stale lease, lost key restore tests. | [OpenBao](https://github.com/openbao/openbao/blob/main/LICENSE) MPL-2.0 candidate; covered-file/source availability obligations on distribution. Unseal/key backup operations and service RAM are additional costs; not selected. |
| Privacy/PII — C | Generic detection/redaction may be reusable; business/legal data classification belongs to each app. | Explicit purpose/locale, no silent destructive rewrite, raw-data access still authorized. P3, L; seeded sensitive text, false-negative/false-positive and tenant leakage tests. | [Presidio](https://github.com/microsoft/presidio/blob/main/LICENSE) MIT candidate; NLP models have separate licenses and potentially large memory. Pin/model review required. |

Each optional API requires a separate approved contract and two independent app
consumers before “shared” is considered demonstrated. The catalog does not approve
all candidates as processes, change current upload semantics, or add competition
minimums. New dependency versions/editions must enter THIRD-PARTY before use.

## Groups D/E/F status and gaps

Registry/Resolver/Trust/Composition are DESIGN ONLY in existing Capability files;
schemas and fixtures do not imply endpoints. Group E has source CI, health probes,
named volumes and structured restore evidence, but no complete DR, operational
telemetry stack, protected deployment audit or production GitOps. Group F has no
project/environment/deployment/domain/binding/controller implementation. Its
logical APIs, isolation and recovery requirements are in the deployment/ownership
documents and remain PROPOSED. The existing Console is a client of available
Foundation routes, not evidence that those Group F subsystems already exist.
