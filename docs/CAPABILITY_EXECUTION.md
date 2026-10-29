# Capability execution — implementation status

C4A is the bounded, same-tenant, direct backend-subject execution path: one
consumer app invokes one exact published JSON capability with
`sideEffects.kind=none`, no delegation, no retries and no composition. C4B
(composition), hosting and Layer-2 applications remain out of scope.

## Status

- **Increment A — implemented.** Shared bounded payload validation and the
  guarded provider-network client passed their internal security gate before B/C.
- **Increment B — implemented.** Migration 010 adds private, forced-RLS
  reservations, immutable request/grant binding, one-attempt tickets, engine
  correlation and protected audit. Authentication leases remain in Core memory.
  These controls have isolated PostgreSQL tests. Additive migration 011 preserves
  the ticket hash/expiry NULL pair when finishing before a ticket was issued.
- **Increment C — implemented, opt-in and disabled by default.** The fixed
  Flowable process, guarded worker, three bounded routes and isolated real-OIDC
  two-application provider fixture are implemented. No Layer-2 business logic is
  included. The normal development gateway retains execution disabled.

## Operator configuration and API

Apply migrations 001–011 before enabling C4A. Set `C4A_ENABLED=true` and
`C4A_PROVIDER_ORIGINS` to a JSON array of exact approved HTTPS origins, for example
`["https://provider.example.org"]`. Empty approval configuration or missing
authority/Flowable configuration fails startup. The production bootstrap accepts
no private-network exception or custom TLS trust setting. Provider origins still
come from operator-enrolled Application Authority; callers cannot supply URLs.

The [extension contract](contracts/capability-api-v1.openapi.json) describes:

- `POST /v1/capability-executions` with a UUID `Idempotency-Key` and exactly
  `{ "target": { "kind": "capability", "capability": { "capabilityId": "…",
  "version": "1.0.0", "manifestDigest": "sha256:…" } }, "input": … }`.
- `GET /v1/capability-executions/{executionId}`, restricted to the original
  initiator with current bound authority; engine internals and input stay private.
- `POST /v1/capability-authorizations/introspect`, called with the provider's own
  OIDC credential and `{ "ticket": "…", "invocationId": "…", "inputDigest": "…" }`.
  Invalid or replayed tickets return `active:false` without context.

Cancel, general resume, composition, delegation and invocation administrator
approvals remain unavailable. Invocation preconditions must specify approval
`none`; capability publication still requires its existing independent approval.
Creation and output use strict UTF-8/duplicate-key parsing and a 64 KiB wire bound.
The provider receives `{invocationId, capability, input}` and must redeem before
executing; success requires HTTP 200 and exactly `{output: …}` matching the manifest.

## Increment A controls

`src/capability-payload.mjs` validates execution input and provider output
against the restricted manifest schema profile. It walks depth, node count,
prototype, Unicode and finite-number bounds before stringifying, then enforces
the serialized-value byte budget and reuses `validateValue`. Schema keywords outside the
manifest profile are rejected rather than ignored.

`src/provider-network.mjs` is the only outbound provider transport:

- Exact approved HTTPS origins only; no caller URLs.
- Exact manifest path grammar, 256-character maximum, no percent-encoding,
  queries, fragments, traversal, empty segments or absolute URLs.
- Fixed protocol headers only: `Authorization: Bearer <opaque ticket>` and
  `Idempotency-Key: <stable operation UUID>`. Caller OIDC credentials and
  arbitrary headers are never forwarded. Redirects are rejected, never followed.
- DNS is resolved once, every answer is checked, and the socket connects to the
  first validated address with `servername` and `Host` retaining the approved
  hostname. A later resolver change cannot redirect the connection.
- Conservative destination policy: global IPv6 unicast only, with
  special-use, documentation and translation ranges denied. IPv4-mapped,
  compatible and translated forms also check the embedded IPv4 destination.
  Loopback, link-local, metadata and private IPv4 are denied.
- Test-only bypass is explicit, exact-origin plus exact-address configured, and
  still denies metadata aliases. Production defaults are unchanged.
- Resolution, TCP/TLS connection and the whole request share one deadline.
  Oversized requests/responses, non-JSON content, malformed UTF-8 and aborted
  responses fail closed.
- Node core `http`/`https` clients are used with `agent: false`; proxy
  environment variables are not consulted.

## Tests

- `npm test` — container-portable unit tests, including destination policy,
  metadata aliases, path/header-field validation, mixed DNS answers, resolver
  failure sanitization and stalled-resolution deadlines. It does not require
  OpenSSL.
- `npm run test:provider-network` — host-only real TLS transport tests. The
  suite generates ephemeral self-signed certificates with the host OpenSSL CLI;
  no key is committed and the Core image has no OpenSSL runtime dependency. The
  CI workflow runs this step on the host.

The loopback TLS fixture is confined to explicit test configuration because it
tests transport failures (redirects, truncation, handshake stalls) that are hard
to provoke reliably from a container. The separate C fixture uses an internal
Docker network, no published ports, exact synthetic origin/address exceptions
and an ephemeral TLS certificate. Its provider sees no Core backend credentials;
its separately enrolled OIDC token enters through stdin and remains in memory.
Core mounts only the public fixture certificate. Fixture controls and TLS keys
are never included in the production image.

## Prerequisites and infrastructure risks

- **[Issue #1](https://github.com/NHMNDaizoken/Rosetta/issues/1) — migration
  runner has no content checksum.** Applied versions are skipped by number only,
  so editing an applied migration leaves a stale schema. Do not edit applied
  migrations; a fresh disposable run of 001–009 was verified independently and
  no 009 reapplication was performed.
- **[Issue #2](https://github.com/NHMNDaizoken/Rosetta/issues/2) — C1
  validation-report audit gap — closed as fixed.** Migration 010 corrects the underlying C1 function
  while preserving the later approval/discovery wrappers. Report updates and
  their audit append now share a transaction; isolated failure tests roll both
  back. Publication itself already had its own audit lifecycle.
- A rolled-back synthetic SQL probe confirmed that C1 publish can return
  `200/published` with NULL `validation_status`, `validation_digest` and
  `validation_revision`. Migration 010 corrects this prerequisite with a
  NULL-safe report/digest/revision/policy guard and
  published-row constraint. Never-validated, invalid, indeterminate and missing
  metadata cases are tested in a fresh disposable database before rollout.

## Private execution authority

The execution ledger is separate from the legacy workflow ledger and generic
records. Its API role can call only the owner-controlled command; it cannot
read the private schema or append audit directly. Original initiating identity,
provider, capability digest, canonical input, idempotency key, deadline, original
grant, engine IDs, attempt and operation key are durable. The provider key is
the logical single-step invocation UUID. Raw OIDC credentials and opaque ticket
plaintext have no ledger, engine-variable or audit field.

The original grant stays bound even if another grant later becomes eligible.
Migration 010 adds an optional, Core-signed grant restriction to the existing C2
predicate; ordinary C2 calls retain their behavior. Candidate selection is capped
at 32 grants and fails closed. Leases expire by the earlier original credential
and execution deadline, which itself is bounded by the selected grant. Restart
loses the lease. Only the original principal can reauthenticate untouched work
within the original deadline; dispatched work is never blindly resumed.
A replay preserves the first live credential and its expiry, including concurrent
replays. If that lease is missing, private ledger checks permit a new lease only
for an untouched reservation, never after ticket preparation.

Tickets have 256 bits of entropy, are stored as SHA-256 hashes, and expire within
30 seconds and every authority/deadline bound. The provider authenticates using
its independently enrolled service subject. Redemption rechecks the live
initiator lease and bound C2 grant, then consumes and audits in one transaction.
Wrong provider, input, proof, expired or replayed tickets expose no context.
Result bodies have a minimum 24-hour retention bound; there is no automatic
tombstone deletion or idempotency-key recycling.

`npm run test:execution-ledger` creates a fresh PostgreSQL container with no
network and tmpfs data, runs migrations 001–011, and tests C1 prerequisites,
reservation concurrency, isolation, replay, expiry, grant binding and audit
failures, including retained idempotency tombstones after result expiry. Its
claims simulate trusted Core assertions; the capability integration suite uses
real multi-tenant Keycloak OIDC and actual provider/Flowable dispatch.

## Flowable and failure behavior

`infra/flowable/capability-single.bpmn20.xml` is the sole C4A orchestration
definition. Core verifies the exact deployed BPMN bytes, definition key and
tenant, then starts only that definition after reservation/audit commit. Engine
variables contain execution ID, input digest and deadline, never input or tokens.
The interrupting deadline timer ends the process independently of the worker.

Flowable's acquire endpoint has no tenant filter. The worker checks each acquired
job against the durable execution, tenant, business key, exact definition/process,
activity, topic and variables. Foreign or unreserved jobs are quarantined with
zero retries. Ambiguous engine starts are reconciled by unique business key;
there is no blind second start. The legacy workflow API cannot start or access
this private definition/process.

The fixed worker performs at most one provider attempt. A fresh lease/C2 check
and durable dispatch audit run after DNS validation immediately before socket
creation. Failed required audit writes prevent dispatch. Invalid output,
non-success responses and missing redemption cannot produce success. Possible
receipt followed by a lost response or result-persistence failure yields
`outcome_unknown`, with no output and no retry. No network call is repeated to
resolve ambiguity.

On Core process loss, credentials disappear. Authenticated status reads reconcile
untouched work to `auth_required`; possible prior dispatch becomes
`outcome_unknown`. The original initiator can replay the same body/key to
reauthenticate only untouched work within the original deadline. The existing
engine process is reused. An expired deadline forbids further dispatch even if
Flowable's asynchronous timer sweep has not yet run.

`npm run test:capabilities` includes the original C1/C2 scenarios and C4A real
TLS/OIDC success, four concurrent replays, unauthorized/cross-tenant access,
wrong-provider/input/replay redemption, forged jobs, malformed/oversized payloads,
provider outages, invalid outputs, required-audit faults, grant revocation before
dispatch/redemption, terminal app/capability revocation, real Core process loss,
Flowable deadlines and isolated backup/restore of real execution outcomes.
`npm run test:flowable-worker` independently verifies lock expiry/reacquisition,
rejection of the former worker and zero-retry dead-letter behavior.

## Limitations

- Duplicate JSON object keys are rejected by the existing strict wire parser
  before this module; `validatePayload` receives an already parsed value.
- No exactly-once claim is made for external provider effects.
- Capabilities requiring an invocation administrator approval are rejected;
  only `preconditions.approval=none` is supported by this bounded runtime.

- Authentication leases belong to one Core process. There is no multi-replica
  lease routing, unattended credential refresh, service-account substitution or
  promise of resumption after an engine job was already consumed/locked.
- A revoked initiator cannot read or finalize its records. Its queued engine work
  can end while the private row remains nonterminal; no privileged identity is
  substituted to repair that row. Operator reconciliation remains future work.
- Deadlines are at most the manifest timeout (maximum ten seconds) and original
  grant lifetime. Timers and result reconciliation are not hard real-time.
- Retention is at least 24 hours with no automatic purge. Operators need a
  separately designed retention policy that preserves idempotency tombstones.
- Providers must implement redemption honestly. Core cannot prove arbitrary
  external code obeyed it; only approved `sideEffects=none` capabilities are in scope.
- Migration checksums remain an open infrastructure defect (#1). Installed
  function definitions, owners and ACLs were compared against fresh installations
  before/after additive migrations; applied migrations were not edited.

## Verified development checkpoint — 2026-10-29

Starting source: `f2f78425161d072094190cce0fa01338485f4563`.
Increment A is `62e221ae453f05ddb3bdbebe4c1ceff4e59e7ba4`
([successful Actions](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40814292115));
Increment B is `12f8a0eb9d329d6c856f17d97e6ae953ee5849e9`
([successful Actions](https://github.com/NHMNDaizoken/Rosetta/actions/runs/40819000389)).
The final Increment C SHA and exact-SHA Actions result are reported in the handoff.
GitHub verification uses Git/GitHub REST; no GitHub MCP connector is installed.

| Command/check | Verified local result |
| --- | --- |
| `npm run check` | Source syntax, SPDX headers and project license files passed |
| `npm test` and pinned-container `node --test` | 61/61 each, including the reproduced lease-replay regression |
| `npm run test:provider-network` | 7/7 real TLS groups |
| `npm run test:execution-ledger` | 4/4 fresh 001–011 groups; 44 schema observations |
| `npm run check:contracts`, `npm run test:contract-validator` | Both passed |
| `docker compose build core` | Passed; only fixed BPMN added to the image allowlist |
| `npm run test:capabilities` | 26/26 real C1/C2/C4A groups; 243 schema observations |
| `npm run test:integration` | 9/9 Foundation groups |
| `npm run test:applications` | 13/13 application/resource groups |
| `npm run test:audit` | 7/7 protected-audit groups |
| `npm run test:recovery` | 1/1 isolated restore; additional live Trust/execution restore runs passed inside capability tests |
| `npm run test:flowable-worker` | 2/2; expired lock reacquired after 31.4 s, former owner denied and retries=0 dead-lettered |
| Installed schema comparison | Versions 001–011 and all Core/private function definitions, owners and ACLs match fresh installation |

The final local positive invocation was execution
`2ea74052-494e-4401-a7a9-9fa80af3b9ce`, Flowable process
`614f5cc6-d363-11f1-89ba-6280abd22172`, exact definition
`rosetta_c4a_single:1:0b735857-d357-11f1-be48-ae509bde13a8`.
The independently authenticated technical provider redeemed once, returned the
Unicode echo, counted one execution and the actual engine history recorded its end.
Fixtures and their records were then cleaned; this is test evidence, not a live demo URL.

Applied migration SHA-256 values (unchanged after application):

- 010: `be194a7989d4a2223c4ed1dd1bc850a3a0e7ada0acfaf82bd5a0aeb1d867e14b`
- 011: `e83a2023fd4b72fc24273a02b81f547a27abb4ab397b9332c2746392cc906692`

No production deployment or real volume deletion was performed. C4A remains
disabled on the ordinary development gateway. No new runtime dependency was
introduced; the development-only OpenSSL requirement was recorded in Increment A.
