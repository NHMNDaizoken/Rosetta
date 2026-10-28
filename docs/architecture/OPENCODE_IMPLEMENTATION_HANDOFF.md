# OpenCode implementation handoff

> Reviewed: 2026-10-28 | Branch: main | Audit baseline: `360a7dd741442a2e3dbfc0f10d45a1e387d3b697`
> Status: PROPOSED backlog. A1 is implemented with bounded evidence; no other slice is authorized by publishing this file.

## How to use this handoff

The maintainer authorizes **one named slice at a time**, including its relevant
ADRs and new contract/security choices. Do not implement the whole backlog, create
phase branches, silently pick unresolved vendors or treat this document as blanket
production authorization. Start by rereading AGENTS, inspecting main/working tree,
and comparing current HEAD to the baseline above. Preserve concurrent work.

Use [catalog evidence](LAYER1_CORE_CATALOG.md), existing Foundation OpenAPI and
resource contracts. All APIs described below are proposed unless already present
in that OpenAPI. New management APIs need a separately reviewed OpenAPI contract
before implementation; do not insert placeholders into implemented Foundation.
Do not extend application-only `/v1/approvals` with new resource types implicitly.

## Definition of Done applying to every slice

- Objective and non-goals fit the named feature; accepted ADRs/contracts and
  unresolved blockers are recorded before affected code changes.
- Reuse existing auth, application authority, providers and Flowable; never infer
  management/data rights from UI state, project labels or broad reader/writer roles.
- Any new table has one subsystem owner, tenant-qualified references, least-privilege
  roles, versioned additive migration, recovery coverage and no silent v2 owner rewrite.
- Add exact success, denial, concurrent/retry and failure tests described below.
  Record actual commands/results; test data must be synthetic and self-cleaning.
- Existing source/unit/OpenAPI checks pass. Core-affecting work runs the real Core,
  app-isolation, worker and restore suites on an isolated authorized test stack,
  sequentially. Frontend work adds relevant Console checks; CI must actually run them.
- New package/image/model/font/plugin: pin version/digest, verify required OSS edition
  and upstream license, preserve notices and update THIRD-PARTY. Unresolved license
  blocks that integration. Existing root Apache-2.0 is not changed.
- Supply a reversible rollout, data retention/backup impact, compatibility/deprecation
  notes, and honest remaining limitations. A rollback never restores revoked rights.
- Conventional Commit on existing main, no secrets/private agent files/artifacts;
  push only verified work to authorized remote, never force-push. Production
  deployment/domain changes still require separate approval.
- Stop after the named slice and its report. Subsequent slices require their own
  authorization. No AI, SDK, second engine or unrelated business logic.

## S0 — Recommended FIRST: truthful Console sessions

**Objective/why:** make live identity, cached lists and resource controls truthful
before building further management features. This fixes demonstrated trust/UX
gaps using existing Foundation APIs, without any unimplemented service.

**Reuse/files:** `console/src/services/apiClient.ts`, mockData, relevant layout/settings,
Applications/Workflows/AccessResources screens, and Console tests. Existing server
handlers remain unchanged. Update Console documentation and add a scoped Console
test step to CI after dependency/lockfile review.

**Contract/database:** no new endpoint, migration, permissions or delegation. Manual
operator access token may remain a memory-only session input initially; remove the
old persisted token on migration/logout. Full PKCE/BFF integration is a separate
review, not implied by Foundation PKCE support. Do not store credentials in URL,
browser persistence, logs or frontend bundles. Restrict credential-bearing requests
to an approved same-origin/proxy target; validate any allowed gateway setting.

**Exact acceptance:** in LIVE mode, missing/401/403/503/fetch-timeout identity yields
unauthenticated/forbidden/unavailable respectively, with zero mock tenant/roles.
Switch PREVIEW→LIVE clears preview-derived app/execution/resource state. LIVE list
views contain only actually fetched/session-created live items and say when no
listing API exists. Mock-only v2 resource/share operations are disabled or visibly
preview-only in LIVE; no successful local mutation is presented as a server write.
Token is absent from local/session storage after input, logout and reload. Invalid
gateway origin never receives Authorization. Existing preview language/theme/UI
tests continue passing; add fetch-spy and failure-state tests, fix act warnings.

`GET /v1/identity` reports reader/writer roles, not administrative permissions.
Do not label a writer an app administrator or invent a permissions endpoint;
management actions still receive the server's authoritative authorization result.

**Negative/failure:** denied identity cannot enable administration; outage cannot
substitute cached demo permissions; no service secret or backend subject spoofing
to make browser v2 succeed. Local activity remains labelled session diagnostics.

**Docker/CI/license/rollback:** no image build/start or database needed for acceptance;
run source/contract/unit and Console tests with existing locked packages. Do not
install a new auth SDK by default. Roll back frontend code if needed, but never
restore persisted-token behavior as a security fallback.

**Dependencies/approval/stop:** BASE + K0, review ADR 004/008 and this session policy.
Explicit slice approval required. Stop after this frontend trust milestone/tests;
do not implement login infrastructure, hosting, project metadata or v2 delegation.
S0 is recommended; it was not implemented during architecture consolidation.

## S0B — Console packaging and executable contract examples

**Objective/why:** close the independently observed container/proxy/example gaps.
**Reuse/files:** Console Dockerfile, Vite config, lockfile, endpoint/example generator,
Foundation schemas, docs and CI. **Contracts/DB/security:** no Core endpoint/migration;
separate dev proxy from supported production serving/proxy, keep credentials on a
trusted route, remove unpinned global package installation. Use lockfile-consistent
builds after full asset/dependency notice review; do not silently select a new server.

**Acceptance:** approved disposable container serves UI and proxies only documented
paths to Gateway; no container-local 127.0.0.1 backend mistake; provider ports remain
private. Generated binary/form/JSON/approval/If-Match/204 examples validate against
the right operation and fixture; no generic invalid “execute me” snippet. Clean
locked build is reproducible and font/offline behavior declared. **Failures:** no
proxy open redirect/credential leak, malformed endpoint snippets rejected, no mock
success during proxy failure. **Docker/CI:** authorized disposable image build and
route smoke tests, not production; add Console build/tests to CI. **Rollback:** keep
prior assets/config but not insecure credential routing. **Dependencies/approval:**
S0, packaging/server/license choice approval; stop before new runtime APIs.

## P1 — Project/environment metadata only

**Objective/why:** create stable management namespaces before hosting actions.
**Reuse/files:** Core auth/context and authority interfaces, new small management
module/contract/tests, next unused migration in `infra/postgres`, docs and CI.
**API:** reviewed project/environment create/get/archive and revision preconditions,
with explicit tenant management enrollment. Names/path IDs are target references,
never caller authority. **DB:** new management-owned schema/roles, project/environment
FKs and audit intents; do not alter existing owner fields or grant all current
readers administrative access. No deployment/controller/secret functionality.

**Acceptance:** authorized owner creates project/environment; tenant B cannot
list/read/mutate A; forged tenant/owner/membership fields grant nothing; duplicate
names/IDs and stale revisions fail predictably; archive preserves history and
fails if forbidden dependencies exist. Restart/restore retains scope/ownership.
**Failures:** DB/identity/audit failure returns no falsely committed success;
concurrent archive/update cannot bypass state. **Docker/CI/license:** additive
migration apply/reapply and isolated restore with existing providers, full affected
Foundation regressions, no new package required. **Rollback:** disable new route,
retain new tables/IDs; no destructive down migration. **Dependencies/approval:**
K0, ADR 003 and management permission contract explicitly accepted; then stop at
metadata. This is the first hosting-domain slice, following S0 recommendation.

## P2 — Membership, app attachment and entitlements

**Objective/why:** bind existing applications to projects/environments without
transferring data rights. **Reuse/files:** P1 management module, Authority owner
interface, new management membership/mapping migration/contracts/tests.
**API/DB:** explicit membership actions, attach an existing app and capped entitlement
records; unique `(tenant, appId)` mapping initially. Attach requires valid project
permission plus explicit existing app ownership/authorized approval; neither
caller-supplied owner nor project membership suffices. Store references, not users.

**Acceptance:** same-tenant authorized attachment succeeds; cross-tenant reference,
second environment mapping, unauthorized developer, inactive app and forged role
are denied. Project owner still cannot read attached app's v2 data; separate dev/prod
registrations remain isolated. Concurrent attachment has one result. **Failure:**
authority outage fails closed; disabling membership blocks subsequent management.
**Docker/CI/license:** existing stack, migrations/RLS/restore and negative fixtures,
no new dependency. **Rollback:** retain mappings and IDs, disable attachment routes;
never remove app data. **Dependencies/approval:** P1 + ADR 003/008; decide detach/move
policy separately. Stop before binding secrets or deploying containers.

## A1 — Protected audit boundary — IMPLEMENTED (bounded)

**Delivered:** migration 005 extends the existing `app_private.audit` with derived
actor/tenant metadata, event/outcome/reason validation, redaction, an explicit
`audit.read` permission, `rosetta_audit_api`, internal tenant/time keyset query
`core.audit_query(jsonb)` and an owner-only `audit_append` helper. Existing
application/approval/share inserts remain transactional; append failure rolls the
mutation back. No public audit HTTP route or generic payload column exists.
See [AUDIT.md](../AUDIT.md).

**Verified:** `integration/audit.mjs` covers actor/tenant derivation, redaction,
forged claims/targets, role ACLs, direct update/delete denial, pagination/time
filters, concurrent appends, application rollback and database restart. The
isolated restore test checks audit role/ACL/RLS/query after `pg_dump`/`pg_restore`;
`npm run test:applications` and `test:integration` remain green. CI runs
`test:audit` after `test:recovery`.

**Threat model/non-goals:** application roles and ordinary tenant users are
untrusted; DBAs, database owners and a malicious host/operator remain trusted.
Independent export/sink, cryptographic sealing, WORM retention, legal hold,
complete access/deployment audit and key recovery are deferred. Do not claim
remote tamper evidence from a local PostgreSQL row or outbox.

**Next gate if extended:** reviewed export contract, sink/key/retention design,
unavailable-sink admission behavior, DBA/operator tamper tests and coordinated
restore. **Rollback:** keep audit rows/roles/migration; disable new callers or deny
sensitive changes rather than dropping evidence. **Dependencies/approval:** K0 +
ADR 012; this bounded slice is complete, no generic telemetry stack implied.

## O1 — Hosting admission and operational recovery proof

**Objective/why:** define measurable safety gates before privileged execution.
**Reuse/files:** current OPERATIONS, Compose pins, integration/recovery harness;
new operator policy/runbook and disposable failure tests after approval.
**API/DB:** no public API required; protected operator policy for image sources,
provenance, resource profiles, registry/egress rules, retained releases and
consistent backup inventory. **Security:** node/root operations are operator-only;
measure Foundation/OS/backup reserve, enforce actual disk/PID/CPU/memory limits.

**Acceptance:** malicious image/mount/socket/device/host-network/SSRF options
rejected before scheduling; accepted artifact bound to digest and reviewed
provenance. Verified backups cover identity, data/authority, workflow, filer/chunks,
keys and configuration, with a disposable coordinated restore and declared RPO/RTO
measurements. Prove no old revoked binding becomes active after restore. **Failure:**
disk full/key lost/partial backup cannot report successful recovery. **Docker/CI:**
separately approved disposable infrastructure tests, no production operations;
do not add unreviewed build images. **License:** complete selected images/tools and
artifact notice inventory. **Rollback:** retain snapshots, policy and audit;
restrict admission instead of deleting state. **Dependencies/approval:** K0,
ADR 005/010 and explicit infrastructure test authorization; stop before hosting enablement.

## D1 — Deployment intent, no real runtime

**Objective/why:** prove desired/observed semantics without infrastructure privilege.
**Reuse/files:** P2 control module, A1 audit, new deployment/artifact contract and
management schema/migration; fake typed runtime adapter in tests only.
**API/DB:** immutable admitted release; deployment create/get/status/stop/update/
rollback intent with idempotency and revision. Private outbox/lease/generation
store; no caller-controlled command, tag-only image or secret values.

**Acceptance:** replay same key/intent yields one logical deployment; changed
intent conflicts; stale revision/foreign tenant/project/unmapped inactive app
denied. Restart resumes persisted intent; competing lease fenced; failed fake
worker leaves observed failed/unknown, never false ready. Rollback creates a new
authorized intent with prior artifact but current policy. **Failure:** crash after
intent before ack and after simulated start before observation reconciles without
blind retry. **Docker/CI/license:** SQL/test harness only; no Docker socket or new
runtime dependency. **Rollback:** disable new API/consumer, retain intent history.
**Dependencies/approval:** P2+A1, ADR 004/010 and new management contract; stop at
fake-worker integration, no real container launch.

## R0 — Restricted runtime adapter spike

**Objective/why:** choose narrow Rosetta/OSS runtime integration using evidence.
**Reuse/files:** D1 typed adapter/outbox; new privileged worker process boundary,
disposable runtime harness and operational policy. **API/DB:** private authenticated
admitted-intent/observation protocol; worker never writes other private tables.
**Security:** approved node only, fenced identity, exact digest, hard resource/egress
profile and no host/provider/daemon access from workloads.

**Acceptance:** operator-approved stateless health image starts once; duplicate
delivery/restart discovers same generation; no unapproved mounts/socket/command/
registry/metadata/peer/provider access. Kill candidate/controller/node connection:
observed state converges safely; healthy workload survives control outage where
runtime supports supervision. Enforced memory/CPU/PID/log/disk limits measured.
**Failure:** ambiguous start inspected before retry; stale fenced controller cannot
mutate current deployment. **Docker/CI/license:** requires explicit disposable-node
approval, selected adapter pin/edition/transitives and teardown only owned fixtures.
No service credentials, persistent app volume, source build or production launch.
**Rollback:** stop only owned candidate, preserve prior generation/state/audit.
**Dependencies/approval:** D1+O1, ADR 004/005/010 vendor/protocol approval; stop after
runtime proof and recommendation, not integrated hosted BaaS.

## T1 — Platform-owned app ingress and TLS

**Objective/why:** route one admitted workload safely while preserving API/OIDC.
**Reuse/files:** existing Nginx patterns, D1/R0 observations and typed route applier;
separate approved ingress config/contract/certificate references and tests.
**API/DB/security:** route revision tied to exact tenant/app/deployment, operator-owned
test domain; no arbitrary proxy snippets or hostname override of platform APIs.
**Acceptance:** candidate route disabled until healthy; invalid config/unhealthy
candidate leaves old route; successful activation reports observed revision.
Token/header/Host cannot route into another tenant or provider admin path. TLS
renewal failure explicit; callback/probe SSRF and redirect blocked. **Failure:**
controller/gateway restart and lost activation ack reconcile last-known-good route.
**Docker/CI/license:** approved disposable domain/cert test harness; no real domain
purchase/configuration without separate authorization. Review certificate component
license/pin. **Rollback:** atomically restore prior healthy route, never stale app
authority. **Dependencies/approval:** R0 + ADR 006; stop before custom domains.

## T2 — Custom domains

**Objective/why:** safely admit tenant-owned hostnames. **Reuse/files:** T1 route/
certificate logic and management domain records/contract/migration.
**Authorization/security:** current domain proof plus tenant route permission;
global hostname uniqueness, platform-reserved-name rejection, bounded challenge
and DNS revalidation. **Acceptance:** valid owner succeeds; stale proof, rebinding,
IDN/case/normalization duplicate, platform hostname, wrong tenant and takeover after
detach fail. Certificate renew/revoke/expiry and route release retain evidence.
**Failures:** DNS/provider outage never grants ownership. **Docker/CI/license:**
isolated authoritative DNS/ACME fixtures after approval; no arbitrary real callbacks
or added package without license review. **Rollback:** disable new domain onboarding,
retain valid ownership/history/routes safely. **Dependencies/approval:** T1 + ADR 006
challenge/TTL/release choices; DEFERRED, stop at domain lifecycle tests.

## B1 — Environment service binding and credential lifecycle

**Objective/why:** let an admitted hosted backend consume Foundation securely.
**Reuse/files:** Keycloak/operator enrollment, P2 mapping, resource subject binding,
A1 audit; F5 reference metadata/private delivery adapter, migrations/tests/runbook.
**API/DB:** management stores only scoped references/version/state; exact app and
environment delivery authorization. No arbitrary client provisioning or plaintext
secret response; IdP remains identity owner.

**Acceptance:** admitted app gets its least-privilege credential privately and calls
v2 as itself; peer app/project member/browser cannot retrieve it. Rotate current
version, test new issuance, revoke old credential and verify documented token
effects. Subject rebind requires operator review. Stop/revocation cannot restore
old binding on rollback/restart/backup restore. No secret in logs/process arguments/
API/CI capture/frontend artifacts. **Failure:** secret backend or audit unavailable
prevents new delivery; already-running credential lifetime explicitly tested.
**Docker/CI/license:** approved disposable secret/IdP fixtures only; OpenBao or any
backend needs separate pin/license/key-recovery review. **Rollback:** retain history,
fail closed, never reactivate revoked version. **Dependencies/approval:** P2+A1+O1,
ADR 007/016; stop before integrated hosting demo or self-service OAuth lifecycle.

## H1 — Integrated hosted BaaS acceptance

**Objective/why:** prove hosted/external models share the same security semantics.
**Reuse/files:** existing Foundation example/integration assertions, R0/T1/B1,
original small technical health/backend image fixture and tests/docs. **Contracts/DB:**
no changes to v2 owner/tenant semantics; normal management/deployment/binding
records only. **Acceptance:** external App A and hosted App B each write/read own
record/object; private peer/foreign tenant access fails; forged ownership headers
fail; exact read share succeeds while writes fail. Suspend owner/grantee and test
subsequent v2 denial, deployment admission denial and approved stop/route convergence.
Update B preserves app identity; failed candidate keeps prior route; restart and
coordinated recovery preserve authority, data and revocation.

**Failures:** provider/control/gateway outages produce truthful status and bounded
errors; no private data in tenant workflow variables. **Docker/CI/license:** explicitly
approved disposable stack and original fixture image/license/SBOM, no public VPS.
**Rollback:** prior admitted release/current valid binding only; no data rollback.
**Dependencies/approval:** T1+B1+O1 and hosting enablement review; stop after this
technical acceptance, not a claim of hostile hosting or the separate business GUI.

## OPT — Select exactly one Foundation/shared extension

**Objective/why:** demonstrate a concrete cross-app need from the catalog, not add
all optional services. **Reuse/files:** owning object/data/workflow/authority adapter,
candidate contract, next migration only if needed and two consumer fixtures.
**Contract/DB/security:** use [catalog](LAYER1_CORE_CATALOG.md) and ADR 011–015 for
ownership, tenant/app policy and compatibility. A quarantine change, for example,
must version visibility/state semantics before changing current upload behavior.
**Acceptance:** execute that candidate's exact two-app demo plus denied owner/tenant,
revocation, timeout/retry, persistence and backup cases. **Docker/CI/license:** only
selected pinned OSS edition with notices/resource budget and isolated CI fixture;
mixed/unknown license blocks integration. **Rollback:** disable candidate processing
without exposing denied data or deleting existing resources; document queued work.
**Dependencies/approval:** K0 plus candidate-specific ADR/dependencies; DEFERRED.
Stop after that one candidate's acceptance and report.

## C1 — Registry publication

**Objective/why:** publish exact, owned capability versions independently of hosting.
**Reuse/files:** Application Authority, existing manifest schema/vectors/OpenAPI
design, separate Registry owner module/private migration and tests. **Contract/DB:**
approved restricted schema profile, immutable digests/versions, tenant visibility;
never store authority in generic records. **Acceptance:** active provider publishes
valid manifest; forged owner, unsupported keyword/external reference, changed digest,
duplicate version and foreign-tenant discovery denied. Retired/revoked state survives
restart; audit failure prevents publication. **Failures:** proof/size limits fail
closed, no provider HTTP call needed. **Docker/CI/license:** existing providers only
unless separately justified; validator dependency pinned/reviewed. **Rollback:**
retain immutable versions/revocations, disable publication. **Dependencies/approval:**
K0+A1, Capability acceptance gates and ADR 009; stop before trust/invocation.

## C2 — Cross-App Trust

**Objective/why:** permission to discover is not permission to invoke. **Reuse/files:**
C1 metadata, existing approval patterns and trust design; dedicated Trust owner
tables/contract/negative tests, not the resource-share table. **Acceptance:** exact
same-tenant caller/provider/version/permission grant succeeds; self-approval,
wildcards, cross-tenant, expired/revoked grant, inactive app and unauthorized
delegation denied. Recovery preserves revocation. **Failure:** unavailable identity/
authority/audit denies new grants/use. **Docker/CI/license:** existing identity/SQL
fixtures, no new identity database; dependency review as required. **Rollback:**
retain revoked/expired evidence and deny dispatch. **Dependencies/approval:** C1,
ADR 009/016 and separately approved grant/delegation contract; no provider calls
until later execution approval. Stop at trust-state acceptance.

## C3 — Bounded compatibility proof

**Objective/why:** deterministic structural proof with inspectable limits.
**Reuse/files:** existing manifest/profile, compatibility cases and runtime-review
algorithm; pure resolver module/tests. **Contract/DB:** no new DB/service required
for first offline proof; compatible/incompatible-with-witness/indeterminate result,
exact supported subset, no network schema resolution or implicit transformation.
**Acceptance:** run all supplied vectors, optional/extra property, empty array,
integer-to-number direction, bounds/precision, invalid Unicode/duplicate key and
budget exhaustion cases. Every incompatibility witness validates producer/fails
consumer; unsupported cases indeterminate. No business-semantic correctness claim.
**Failure:** bounded CPU/memory on adversarial schemas, deterministic limits.
**Docker/CI/license:** pure unit/fixture CI; stdlib first, new proof library only
after license/correctness review. **Rollback:** retain versioned proof results;
do not authorize plans with obsolete proof. **Dependencies/approval:** K0 and
Capability profile approval; independent of running C1/hosting. Stop at proof module.

## C4 — Composition and guarded execution

**Objective/why:** execute only approved capability plans through existing Flowable.
**Reuse/files:** C1/C2/C3, workflow ledger/history, existing worker probe and trust/
execution design. New private dispatcher/ticket/lease ownership modules only after
all existing Capability gates; no second workflow engine. **Contracts/DB:** exact
digests, bounded plan, live authorization, memory-only token leases, durable intent/
operation keys and unknown-outcome state. Raw tokens never enter engine variables.
**Acceptance:** existing Capability E01–E12/C01–C06/A01–A02 cases; denied tenant/
revocation/expired lease before dispatch, SSRF/rebinding/redirect denial, one guarded
provider effect under redelivery, non-idempotent ambiguity remains unknown. Prove
tenant-safe dispatch despite external-job acquire lacking tenant filtering;
lock-expiry timing remains a gate. **Docker/CI/license:** isolated pinned Flowable
and synthetic providers, approved worker packages only. **Rollback:** stop new
dispatch, reconcile in-flight outcomes; never blindly replay. **Dependencies/approval:**
C1+C2+C3+A1, ADR 009/010/016 and all Capability acceptance gates. Stop at bounded
composition, no AI planner/federation/arbitrary scripts.

## L2 — Independent business GUI demonstration

**Objective/why:** satisfy the separate product demonstration obligation.
**Reuse/files:** public Foundation API and tested backend example; independently
scoped Layer-2 package/contracts/domain tests, not new business logic in Core.
**Contract/DB/security:** application-specific entities/permissions remain in that
app; backend holds its exact enrolled credential and validates end users. No
browser writer secret; no private provider access. **Acceptance:** real human GUI
journey logs in, writes/retrieves authorized data/object, starts/inspects appropriate
workflow with no app-private payload leakage; second user/app/tenant denial;
restart persistence and understandable outage states. **Docker/CI/license:** separate
approved app build/test/license inventory; can run externally, no hosting/capability
dependency. **Rollback:** preserve app data and existing Foundation. **Dependencies/
approval:** BASE plus product/domain choice and GUI implementation approval;
DEFERRED in this task. Console or technical fixture does not replace it.

## REL — Competition source release and demonstration preparation

**Objective/why:** close release/source obligations before submission. **Reuse/files:**
README, source-build instructions, notices, change history/issues, CI and traceability.
**API/DB/security:** no new API or schema; remove real data/credentials from release
artifacts, preserve required source and upstream notices. **Acceptance:** clean
checkout configuration/build/run with documented open tools; five Core+L2 demo,
versioned source release, compatible dependency/asset inventory and recorded
organizer archive clarification. Rehearse presentation and failure recovery.
**Docker/CI/license:** full release-specific audit, not merely SPDX syntax checks;
approved isolated reproducibility exercise. **Rollback:** supersede release version,
never rewrite Git/tag history. **Dependencies/approval:** BASE+L2, official/team
registration confirmation; separate tag/release/public-demo authorization.
Stop after approved release/report; no implicit Internet deployment or email send.

## Final implementation report template

Report starting/ending HEAD, approved slice/ADRs, actual changed contracts/files,
migrations and ownership, negative/failure tests, exact local versus CI results,
new dependencies/notices, rollback/recovery limits, commit/push status and remaining
gates. If a required test/environment is unavailable, say so and stop at the slice's
defined boundary instead of inventing success or expanding scope.
