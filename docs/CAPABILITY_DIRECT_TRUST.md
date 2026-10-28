# Direct capability trust (C2)

Increment A supplies private persistence and input validation. Trust HTTP routes
and consumer discovery are not enabled yet. C1 Registry is implemented, C3 is a
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
| POST `/v1/trust/grants` | Provider owner, `trust.write` | Published exact digest, active apps/enrollments; new immutable pending proposal | Foreign/hidden target 404; atomic `grant.proposed` |
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

Apply through the development Compose migration service before rebuilding Core.
Keep both private schemas, role ownership/ACLs, Registry and Audit in coordinated
backups. Roll back code without dropping authority/history tables. No destructive
down migration or purge is provided. Grant lifecycle/discovery recovery proof for
C2 is pending.

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
