# Layer 1 engineering history

> Historical implementation checkpoint. The subsequent stabilization/release program and current open security gates are in [implementation status](LAYER1_IMPLEMENTATION_STATUS.md). This historical COMPLETE assessment applies only to its earlier bounded implementation scope.

Updated: 2026-11-01. This is an implementer's engineering handoff, not an
independent security review or production certification.

## Baseline and revision identity

The continuation began on authorized repository
`https://github.com/NHMNDaizoken/Rosetta`, branch `main`, at local and remote
`ff16a5e61d6405a25c1f7fdc3ade289732b21fbb`, with no working-tree changes.
This was the DeepSeek/OpenCode checkpoint supplied by the owner. GitHub REST
independently confirmed its [successful run](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41313291206).

Final implementation SHA: `64a68fab0f857609cad9c28323d07eddfcb020ac`.
Exact-SHA [Actions run](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41321880800)
completed successfully. Downloaded CI logs confirm the real C4B suite passed 29/29.
The exact remote main SHA was independently verified after push.
The final documentation revision is the commit containing this handoff; resolve
it with `git log -1 --format=%H -- docs/architecture/ENGINEERING_HISTORY.md`.
The final user handoff also supplies the exact final HEAD and its Actions URL.
A document cannot contain its own Git commit hash as literal content.

## Adopted structure and dependency rules

`src/server.mjs` binds/shuts down the application. `src/bootstrap/config.mjs`
validates configuration, `container.mjs` composes adapters and optional runtimes,
and `src/api.mjs` routes verified requests. `src/platform` contains HTTP, OIDC,
internal assertions and health infrastructure. Foundation features live in
`src/modules/applications`, `resources`, `data`, `objects` and `workflow`.
Capability features live in `src/modules/capability/{registry,trust,compatibility,execution,composition}`.

The existing boundary checker enforces 28 sources with no cycles. Platform
cannot import feature modules; Foundation cannot depend on Capability modules;
only the router/bootstrap may compose features. Cross-module imports use declared
entrypoints. Capability dependencies point downward from Composition through
Registry HTTP/C4A execution, Trust and pure schema/compatibility helpers. No new
service, framework, scheduler, dependency or Layer 2 module was introduced.

## Implemented Foundation and Capability features

The five headless Foundation capabilities remain Keycloak/OIDC SSO, Nginx
API gateway, PostgREST/PostgreSQL structured data, SeaweedFS unstructured objects
and Flowable workflows. Application Authority, v2 app ownership/read sharing,
protected Audit, C1 Registry, C2 direct grants/discovery and offline C3 remain
implemented. C4A guarded single invocation is preserved. C4B now has a real
verified multi-step path, and both execution paths remain disabled by default.
The Console is a management client, not the required Layer 2 GUI application.

## C4B architecture and lifecycle

The registry accepts only bounded linear plans with exact immutable capability
versions/digests, complete JSON bindings, 1-16 steps and a 100-60000 ms deadline.
C3 proves every input/adjacent/output edge and rejects incompatible or unproven
connections. A caller-bound enrolled app with explicitly assigned
`compositions.write` owns the plan. Validation uses exact ETags; publication
requires `compositions.publish` plus an independently approved, current exact
`composition-version` decision. No app credential implicitly receives management
or approval authority.

On execution, SQL serializes the consumer/subject/client idempotency key,
reserves the execution and exact step grant/provider/capability bindings, and
appends audit atomically. Core reserves an engine start before sending HTTP.
Flowable alone schedules the generated external-worker tasks and deadline timer.
For each step, the original OIDC lease and current C2 authority are rechecked,
a durable single-attempt ticket/operation is prepared, and guarded transport
connects only after durable dispatch intent. The provider authenticates with
its own OIDC identity and redeems its one-use input-bound ticket. Strict JSON
and output-schema checks precede durable output/digest recording. The next step
receives the entire previous output. SQL advances the index once; only confirmed
naturally completed Flowable history permits final `succeeded`.

The authoritative [transition matrix and reproduction guide](../CAPABILITY_COMPOSITION.md)
records accepted/running/auth_required/succeeded/failed/timed_out/outcome_unknown
behavior. Historical cancelled values are terminal, but public cancel/resume are
unsupported. Terminal outcomes cannot be overwritten by late responses. Failed
or uncertain work cannot dispatch subsequent steps. Live checks pin each step's
original reserved grant: a newly approved replacement does not revive a revoked
reservation.

## SQL migrations and security ownership

Migrations 001-012 were not edited. Forward corrections are:

| Migration | Purpose |
| --- | --- |
| 013 | Fix registration/validation/publication, assertion lease transport expectations, idempotency/version binding, per-step digests/operation IDs, durable dispatch, terminal guards, observation and engine-confirmed success |
| 014 | Fix ambiguous registry digest lookup and exact app-owner visibility |
| 015 | Fix reservation creation/retention timestamp binding, owning-consumer resolution and live approval authority |
| 016 | Include exact result version, tighten lifecycle permissions, recheck pinned capabilities at publication, opt into expanded Composition fingerprints |
| 017 | Recheck each exact reserved grant via C4A's existing pinned-grant resolver |

All five Composition tables retain forced tenant RLS and `rosetta_app_owner`
ownership. `rosetta_composition_api` is a restricted nonlogin RPC role with no
private schema/table access; generic CRUD roles cannot read or mutate authority.
No owner, ACL, existing record, audit history or persistent volume was removed.
Migrations were applied to the authorized development database through the
checksum-enforcing runner without adoption flags, and through fresh isolated
PostgreSQL installs. Version 16 first verifies the former fingerprint scope,
then records Composition functions/ownership/ACL/RLS in the expanded scope.

Migration 013's already-applied CRLF bytes are retained with an explicit Git
attribute; hashing still uses original file bytes. The runner strips CRLF
transaction delimiters before its single transaction. Pre-existing mixed line
endings in development migration 006 match its installed checksum and were left
unchanged. Never normalize applied bytes or silently replace checksums. See
[migration operations](../MIGRATIONS.md).

## Flowable correlation and credentials

The fixed process key/topic are `rosetta_c4b_composition` / `rosetta-c4b-step`.
Core checks deterministic definition bytes, exact process/definition/tenant,
`c4b:<tenant>:<execution UUID>` business key and execution/input/deadline variables.
Acquire is not tenant-filtered by the pinned engine; unrecognized/wrongly bound
jobs are locally quarantined with zero retries. The worker probe independently
verifies exclusive locks, wrong-owner rejection, expiry/reacquisition and
fail/complete responses.

When start/binding is uncertain, Core reloads SQL and queries runtime and
history. Only one correctly correlated process can be bound. Zero/multiple
matches or missing authoritative history never trigger another start. Deadline
cleanup uses the supported process DELETE operation and preserves engine/audit
evidence. Termination failure is observable as 503 and internal counters; later
status reads retry cleanup. Completion uncertainty is not swallowed as success.

Initiating bearer credentials and raw provider tickets stay in process memory;
SQL stores only bounded synthetic request/results, identities and ticket hashes.
Flowable receives execution/input-digest/deadline correlation, not credentials.
Core never substitutes its administrator/executor identity for the caller.
Restart drops leases; untouched work becomes auth_required when observed and
possible provider receipt becomes outcome_unknown. C4B replay cannot restore a
lease or resume work. Recovery is observation-driven and conservative, not HA.

## Real execution and negative evidence

`integration/compositions.mjs` passed 29 tests locally, with 186 observed schema
cases validated by the actual contract checker. The successful case uses real
Core HTTP, OIDC, C1 publication, independently approved C2 grants, C3 proof,
PostgreSQL and Flowable, with two separate TLS provider containers and an
enrolled consumer. Provider A transforms a value; Provider C receives the exact
whole output. Both execute once, both tickets redeem once, final output is
retrievable only by the authorized consumer, and SQL agrees with natural
Flowable process completion. No internal function fabricates successful work.

Negative cases cover malformed schema/references, unknown/stale/unpublished/
revoked pins, incompatible/indeterminate adjacent schemas, invalid input/output,
publication permission/approval/revision/immutability, wrong tenants/apps/subject
and token forgery, absent/discover-only/expired/revoked grants, suspended apps,
revocation between steps and replacement-grant substitution. Provider/workflow
cases cover wrong provider/step/digest/input/unknown invocation, expired/replayed
tickets, forged jobs, wrong tenant/process/definition, timeout/outage, redirect,
malformed/oversized/schema-incompatible responses. Denials that should precede
dispatch assert provider receipt counters did not advance. The shared network
suite separately proves real TLS, forbidden destinations, pinning, rebinding,
response limits and deadlines.

Recovery faults cross actual HTTP boundaries: before engine reservation/start,
lost start response, unavailable history, multiple real engine matches, actual
Core restart with/without possible provider receipt, uncertain worker completion,
termination outage, engine-owned BPMN deadline, late provider output and protected
audit failure. No ambiguous request is automatically retried. Isolated restore
compares five real execution outcome classes, every step, stable operation IDs,
ticket hashes/consumption, inputs/outputs and audit counts under own/foreign RLS;
it also checks schema ownership, restricted roles and ACLs. This does not claim
coordinated recovery of identity/object/workflow databases.

## Local regression and contract results

See [implementation status](LAYER1_IMPLEMENTATION_STATUS.md) for exact commands.
All requested existing commands were executed. Newly verified counts: unit 65,
migrations 9, execution ledger 4, Foundation integration 9, applications 13,
C4A capabilities 26, audit 7, recovery 1, Flowable worker 2, provider network 7,
C4B compositions 29 and Console 28. Console build, generated endpoint freshness,
packaged Console build/probe, source/license-header/boundary checks, Compose
configuration/build/wait and host health all passed. The fresh execution-ledger
run also checked 44 observed contract cases. Foundation and app HTTP observers
covered 128/247 responses and 26/31 successful operations respectively; C4A
validated 244 observed schema cases.

OpenAPI now maps eight implemented Composition registry operations and three
shared execution/ticket operations to real sources with accurate opt-in status,
requests, responses, OIDC, permissions and approval/state requirements. Unsupported
cancel/resume remain design-only. Static verification retains all Foundation
checks and tests missing/wrong Composition routes, methods, operation IDs,
source mappings and absent handler declarations. Actual successful Composition
HTTP bodies pass the schema validator. The undocumented registration alias was
removed instead of claiming an extra contract.

## CI, issues and readiness

GitHub CLI/MCP was unavailable. Read-only GitHub REST verified the initial CI
and Issue #1's actual acceptance scope. Authenticated Git/Git credential-helper
backed REST are the authorized push/issue/CI methods; credentials are never
printed or written to repository files. The implementation Actions run above passed all stages for its exact SHA.
[Issue #1](https://github.com/NHMNDaizoken/Rosetta/issues/1) was closed as completed
after comparing its actual acceptance criteria with the new checks; the
[evidence comment](https://github.com/NHMNDaizoken/Rosetta/issues/1#issuecomment-6560160245)
records migration 017, fresh 9/9 integrity tests, development drift verification
and preservation of historical bytes. No new issues were needed. The final
documentation-only commit is verified by the same workflow before the user handoff.

Current assessment: COMPLETE for the bounded authorized Layer 1 implementation
program. Local gates and exact implementation-SHA CI passed. C4B remains disabled by default and was enabled only in isolated test
Core fixtures. No general-use/HA/exactly-once or production-readiness claim is
made. Human delegation, arbitrary BPMN/URLs, general side effects, retries,
public cancel/resume, hosting, projects, AI agents and Layer 2 were not added.
No dependencies or license choices changed. Comprehensive dependency/license
and vulnerability audits were not run.

After final handoff-SHA CI, the bounded authorized Layer 1 program can transition
to selecting and implementing the required Layer 2 GUI application through Core
contracts. That next task still needs an application/use-case decision, synthetic
end-to-end scenario and explicit domain boundaries. Production hardening,
coordinated disaster recovery, release packaging and final competition rule/
submission checks remain separate work. No Layer 2 implementation began here.

## Overall Layer 1 program history

History through the verified implementation follows. The documentation-only
handoff commit follows this list; resolve its hash using the command above.

```text
c7b758c chore(repo): initialize foundation workspace and ignore rules
bbfb73b feat(core): add tested platform health API and local run instructions
b9f93a3 build(containers): verify health service with Compose and GitHub Actions
2437d3b docs(core): define integration contracts and SynapseDX reference practices
07d450a chore(license): apply approved Apache-2.0 license and contributor notices
0bbef3d feat(identity): integrate Keycloak SSO and authenticated Nginx gateway
193669c feat(data): integrate PostgREST with enforced tenant row security
c61089f feat(storage): add tenant-scoped persistent binary object API
72dd0df feat(workflow): integrate durable tenant-scoped Flowable executions
dfb45f7 chore(repo): exclude private agent context from publication
f5680ee fix(core): verify readiness and recovery across container recreation
5fa36d8 docs(core): document verified Layer 1 operations and recovery limits
3f2c0f1 docs(readme): explain Rosetta platform architecture and roadmap
155a5b1 docs(api): clarify authorization scope for versioned Core routes
5a732b7 docs(capabilities): specify v1 manifests, trust and Flowable composition
6eaf42e docs(capabilities): resolve runtime boundaries and verify Flowable worker API
df6827e feat(applications): add tenant-scoped registration and independent approvals
7db68cf feat(auth): isolate application records and objects
431bca4 docs(api): define foundation contracts and enforce conformance
7fdd7fc feat(console): implement Rosetta Console Layer-1 operational control plane
949dc3b docs(architecture): define Rosetta developer cloud and hosting model
3bd6a20 fix(console): make LIVE sessions truthful
41deda1 feat(console): package static console behind hardened nginx proxy
187e0fe docs(product): clarify Rosetta backend and roadmap
e4f67f0 refactor(core): separate readiness and internal token boundaries
ae45103 feat(console): add developer journey and truthful service status
360a7dd feat(capability): implement bounded compatibility resolver
e25da40 feat(audit): implement bounded protected audit boundary
6f410c3 feat(capability): add owned manifest registry
9168532 test(capability): verify registry isolation and recovery
9cfe714 feat(trust): add private direct-grant foundation and validate approval IDs
09a614c feat(trust): enforce independently approved direct grant lifecycle
f2f7842 feat(trust): authorize exact discovery and live invocation eligibility
62e221a feat(execution): add bounded payload and guarded provider transport
12f8a0e feat(execution): reserve durable authority and single-use provider tickets
e66e57b feat(c4a): guard single-capability dispatch through Flowable
81b584a refactor(core): adopt feature-first module layout with enforced boundaries
17d1788 fix(data): enforce migration checksums and detect installed schema drift
6be3f2f test(data): align migration assertions with verified checksum output
4880c90 feat(c4b): add bounded composition registry and plan validation
2e28078 feat(c4b): wire composition runtime, thread migration 012, fix permission set
ff16a5e fix(c4b): restore composition role, reuse parsed body and extend recovery roles
```

Implementation completion: `64a68fab0f857609cad9c28323d07eddfcb020ac` - `feat(c4b): verify guarded compositions and fail-closed recovery`.
