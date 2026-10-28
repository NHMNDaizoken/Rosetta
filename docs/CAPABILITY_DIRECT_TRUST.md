# Direct capability trust (C2)

Status (2026-10-29): bounded C2 direct grants, authorized discovery and the live
internal eligibility predicate are implemented. C1 Registry is implemented, C3 is a
bounded offline resolver, and A1 Audit is implemented with trusted DBAs. Human
delegation is deferred; C4 execution is unimplemented; hosting is proposed.

## Bounded contract

Use the existing `GrantCreate` representation with exactly one capability
reference (`capabilityId`, exact `version`, `manifestDigest`), one provider and
one different active same-tenant consumer. `delegationAllowed` and
`acceptDelegation` must both be false. Operations remain separate `discover`
and `invoke`; permissions are a nonempty subset of that manifest's declared
provider permissions. No authority increase edits an existing proposal.

Direct subjects use the existing operator-verified confidential backend
`resource_subject` enrollment described in [resource authorization](RESOURCE_AUTHORIZATION.md).
The subject must match the exact consumer enrollment. Unverified subjects,
human forwarding and client/subject rebinding through an HTTP body are denied.
This bounded model supplies direct application authority, not human delegation.
Current issuer, subject, client and tenant always come from live introspection.

Proposals require an enrolled human provider owner with explicit `trust.write`.
Separate enrolled human administrators require `trust.approve` to decide and
activate the exact proposal, using `/v1/approvals`; creators and provider owners
cannot approve themselves. Capability permissions remain independent. Approval
expiry is at most ten minutes and cannot exceed the grant expiry. Mutations
require the baseline writer role as well as explicit management authority.

| Operation | Required authority | State / concurrency | Concealment / audit |
| --- | --- | --- | --- |
| POST `/v1/trust/grants` | Provider owner, `trust.write` | Published exact digest, active apps/enrollments; new immutable pending proposal | Foreign/missing target 404, non-owner 403; atomic `grant.proposed` |
| GET `/v1/trust/grants/{grantId}` | Provider owner with `trust.write` or `trust.approve` administrator | Live tenant authority | Other resources 404; no public approval history |
| POST `/v1/approvals` (`grant`) | Independent human with `trust.approve` | Exact requester/provider/revision/digest, bounded expiry; decision recorded without activation | Hidden grant 404; atomic `approval.decided` |
| POST `.../{grantId}/activate` | The independent deciding administrator, `trust.approve` | Exact If-Match, locked pending grant, single approval consumption; live app/capability/subject checks | 428 missing ETag, 412 stale ETag, 409 stale approval; atomic consumption + activation audit |
| POST `.../{grantId}/revoke` | Provider owner with `trust.write` or `trust.approve` administrator | Exact If-Match; terminal reduction from pending/active/expired | Hidden grant 404; atomic `grant.revoked` |
| GET capability version/list | Existing C1 owner/admin or exact consumer backend with active `discover` grant | Filter before pagination; current server time, app/enrollment/manifest/subject checks | No hidden counts or drafts; invoke alone grants no discovery |

Expired pending/active grants have an effective `expired` state at read/check
time; persisted expiry is durable evidence and needs no scheduler. Revocation
retains history. Deprecated versions cannot authorize new discovery or future
invocation eligibility. Revocation/inactive apps block new use regardless of
unexpired grants. No positive authorization cache or provider dispatch is added.

## Storage and recovery

Migration 007 creates `trust_private.grants` and `trust_private.approvals`, owned
by nonlogin `rosetta_app_owner`, with forced tenant RLS, tenant-qualified foreign
keys and globally unique grant/approval IDs. Ordinary API roles have no schema
access or direct table writes. Resource shares and generic records are unrelated.
The migration extends authoritative principal permissions with `trust.write`;
no principal is assigned it automatically.

The same migration guards the C1 approval RPC before resource lookup. Malformed
references return 400; valid missing references remain concealed. The existing
C1 command is private behind the unchanged RPC, including the bare-ID alias.

Migration 008 adds the owner-controlled `core.trust_command` RPC and a dedicated
nonlogin `rosetta_trust_api` with no private schema/table access. It uses the
existing approval HTTP dispatcher and fixed approval semantics, with private
grant approval records; it does not add an approval workflow/service. The deciding
administrator activates and consumes its exact decision. Consumed approval
expiry is an activation deadline; grant expiry controls subsequent authority.
An approval's consumption and grant activation commit together with both audit
events. A partial unique index permits only one consumed approval per grant.

Run `docker compose run --rm data-migrate` before rebuilding Core. The migrator
now applies only pending numbered files: replaying older permission constraints
would otherwise remove/reject later Trust assignments. Run one migrator at a time.
For an explicit reapplication of 008, use `docker compose run --rm --entrypoint psql
data-migrate -h database -U rosetta_admin -d rosetta_data -v ON_ERROR_STOP=1
-f /migrations/008-trust-lifecycle.sql`.
Keep both private schemas, role ownership/ACLs, Registry and Audit in coordinated
backups. Roll back code without dropping authority/history tables. No destructive
down migration or purge is provided. The verification section below records
grant lifecycle/discovery and restored-decision evidence.

Migration 009 keeps C1 management mutations behind the existing private command
and adds filtered GET/list visibility. Owners with C1 read authority and
`capabilities.publish` administrators retain C1 history visibility. Consumers
receive only published manifest/version metadata, without creator identities,
private validation reports, approvals, OAuth configuration or credentials.
Authorization filters precede `LIMIT` and cursor creation; `nextCursor` counts
only visible rows. Consumer cursors bind tenant/app, while C1 management cursor
format remains compatible. Reusing a cursor never preserves a grant's authority.

## Internal eligibility and consistency

`evaluateCapabilityEligibility(request, config, reference)` in `src/trust.mjs`
accepts exactly `capabilityId`, `version`, `manifestDigest` and `operation`
(`discover` or `invoke`). It performs fresh OIDC introspection itself, then calls
the private `core.trust_eligibility(jsonb)` RPC. Only `rosetta_trust_api` may call
that RPC. The result contains only `{allowed, reason}`; reason codes are bounded
internal diagnostics, not a public enumeration API or transferable authority.

The same SQL predicate governs consumer discovery and eligibility. It checks
current issuer/subject/client/tenant binding, active apps/enrollments, exact
published version/digest, active unexpired direct grant, exact subject and
operation, consumed matching independent approval and current creator/approver
management authority. One grant must cover the complete manifest permission set;
partial grants are never unioned. `invoke` also requires the baseline writer
role. A subset proposal may be valid without authorizing a request requiring more.

Disabling an enrolled creator or approver, clearing/rebinding a consumer subject,
suspending/revoking either app, deprecating/revoking a capability, or expiring/
revoking a grant blocks subsequent checks. There is no positive authorization
cache. Reads use a current database statement snapshot; an in-flight authorized
read may finish across a concurrent change. Previously returned metadata cannot
be recalled. This predicate admits new use only, not continuation of an existing
C4 execution.

No HTTP invocation/eligibility endpoint, provider request, execution ticket,
queue, workflow start, human forwarding or unattended execution is added. C4
must independently recheck live authority immediately before dispatch/redemption,
enforce invocation-specific approvals and validate input/output/preconditions.
It still needs approved provider enrollment/network/SSRF controls, tickets,
credential leases, idempotency/unknown outcomes, tenant-safe Flowable workers and
recovery evidence. Accepted-execution deprecation semantics require the future
execution reservation context; a caller-supplied bypass is not permitted.

## Increment A local evidence

Starting checkpoint: `91685326a3fa12bf8517366b8ff5ac0921cfe135`. The malformed
`capabilityId@latest` regression reproduced HTTP 503 before the fix. Afterward,
malformed references return 400 at HTTP and private RPC boundaries, while valid
missing references and authorized foreign-tenant approvals return 404. Existing
application approvals and C1 publication still pass.

Local checks passed: `npm run check`, `npm test` (41), `npm run check:contracts`,
`npm run test:contract-validator`, `npm run test:capabilities` (5),
`npm run test:applications` (13), `npm run test:integration` (9),
`npm run test:audit` (7), `npm run test:flowable-worker` (1), and
`npm run test:recovery` (1). Migration 007 applied and reapplied. Restore checks
include Trust schema ownership, forced RLS and ordinary-role write denial.
These results do not establish C2 lifecycle/discovery completion. No dependencies
or license changes were introduced.

## Increment B verification

`npm run test:capabilities` includes real issuer-verified backend subjects and
independent PKCE human actors in two tenants. It covers explicit permissions,
non-owner denial, forged tokens, unsupported subjects, foreign consumers,
self-approval, exact digest/revision/requester binding, concurrent decisions and
single consumption, denied/revoked/expired/stale approvals, inactive targets,
audit-failure rollback and actual database/Core restart. The same suite validates
real successful Trust request/response bodies against the extension schemas.
Direct lifecycle is implemented; discovery and internal eligibility remain
increment C work in this historical B checkpoint. No provider dispatch, token
exchange or delegation exists.

Verified locally: source/SPDX checks, 41 unit tests, contract validation and
validator controls; 11 capability/Trust cases and 64 real Trust schema cases;
13 application/v2 isolation cases; 9 Core cases; 7 Audit cases; isolated restore
and the existing worker probe. Migration 008 reapplied successfully. These are
local results; GitHub Actions must be verified for each pushed increment.

## Verification and recovery commands

Final local results (2026-10-29): source/SPDX checks; 41 unit tests; both OpenAPI
structures, Capability schemas/examples and Foundation validator controls;
17 capability/Trust integration cases with 130 real schema cases; 13 application
cases; 9 Core cases; 7 Audit cases; isolated restore and the worker probe all
passed. Migration 009 applied/reapplied, and startup skipped already-applied
history without removing Trust permissions. Console checks were not rerun locally
for this Core slice; exact-commit CI runs its test/build/container checks.

Run sequentially against an isolated authorized stack:

```sh
npm run check
npm test
npm run check:contracts
npm run test:contract-validator
npm run test:capabilities
npm run test:applications
npm run test:integration
npm run test:audit
npm run test:recovery
npm run test:flowable-worker
```

The capability suite checks real OIDC identities in two tenants, separate
management actors, discover-only/invoke-only/both grants, complete permission
intersection, unauthorized versions/drafts, concealed metadata and pagination,
live authority changes, real elapsed expiry, terminal app/grant revocation,
concurrency, protected Audit rollback and dependency outages. It invokes the
existing isolated `pg_dump`/`pg_restore` harness while its actual OIDC grant
fixtures still exist. That restore checks active/revoked/expired decisions,
private ownership/ACLs, tenant RLS, consumed approval evidence and revocation audit.
The child runner must execute and report these checks; empty output is a failure.

Operator enrollment remains a trusted attestation mechanism, not a new identity
directory. Verify backend client/subject and tenant membership through the
existing IdP administration procedure, and maintain the private enabled records.
Core also validates the current consuming token on every request. Arbitrary
subjects and human delegation remain unsupported. No default account receives
Trust permissions, and a reader/writer/Console/resource share supplies none.

DBAs/database owners and host operators remain trusted. PostgreSQL restore is
not coordinated full-platform DR: Keycloak keys/sessions, Flowable history and
SeaweedFS bytes/metadata are not restored by this harness. No production rollout,
full binary license audit, penetration test or load benchmark is claimed. No
dependency or project license changed.

Remaining source-review finding: the preexisting C1 validation-report branch
returns before its shared audit append. C2's tested transactional mutations are
protected; complete Registry validation-report audit coverage needs a separate
correction. See [Registry audit](CAPABILITY_REGISTRY.md#audit).

## Changed-file map

- Persistence: `infra/postgres/007-direct-trust.sql`, `008-trust-lifecycle.sql`,
  `009-authorized-discovery.sql`, `migrate.sh`, and `compose.yaml`.
- Runtime: `src/trust.mjs`, `src/capabilities.mjs`, `src/applications.mjs` and
  `src/api.mjs`; the offline resolver and v2 Data/Object handlers are unchanged.
- Verification: `tests/trust.test.mjs`, `integration/capabilities.mjs`,
  `integration/recovery.mjs`, `integration/contract.mjs` and
  `scripts/check-contracts.py`.
- Contracts/docs: Capability OpenAPI, Registry/Trust/acceptance/runtime reviews,
  Core/Audit/operations documentation, README/product status and the architecture
  catalog, maps, ADRs, dependency register, index and implementation handoff.

Verified source checkpoints:

- A: `9cfe71488ed52c9378c203b9c435f96e3d732573` — [CI passed](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40726148042).
- B: `09a614cf9defea659d8ca70cdf806e792b3885f3` — [CI passed](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40730650339).
- Final C commit and matching CI outcome are reported in the implementation handoff;
  inspect the Actions run for the exact checked-out SHA rather than a branch badge.

GitHub MCP was unavailable during implementation; remote SHAs and CI/issue status
were verified through Git and GitHub's public API. No issues were open at the A/B
checkpoints; none were opened or closed by those increments.
