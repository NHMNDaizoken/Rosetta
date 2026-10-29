# Capability execution — implementation status

C4A is the bounded, same-tenant, direct backend-subject execution path: one
consumer app invokes one exact published JSON capability with
`sideEffects.kind=none`, no delegation, no retries and no composition. C4B
(composition), hosting and Layer-2 applications remain out of scope.

## Status

- **Increment A — implemented, internal only.** Payload validation and the
  guarded provider-network client are source modules. There are no public
  execution routes in A; its scope adds no migration, dispatch worker or Flowable process.
- **Increment B — internal foundations.** Migration 010 adds private, forced-RLS
  reservations, immutable request/grant binding, one-attempt tickets, engine
  correlation and protected audit. Authentication leases remain in Core memory.
  These controls have isolated PostgreSQL tests; they are not a public runtime.
- **Increment C — not implemented.** The fixed Flowable execution process,
  external-job worker, ticket redemption endpoint, production dispatch and the
  two-application OIDC integration test do not exist yet.

Do not advertise or enable execution endpoints until the supervisor reviews
Increment A and the later increments pass their gates.

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
to provoke reliably from a container. Increment C still needs an isolated
container provider fixture; this host loopback server is not that fixture.

## Prerequisites and infrastructure risks

- **[Issue #1](https://github.com/NHMNDaizoken/Rosetta/issues/1) — migration
  runner has no content checksum.** Applied versions are skipped by number only,
  so editing an applied migration leaves a stale schema. Do not edit applied
  migrations; a fresh disposable run of 001–009 was verified independently and
  no 009 reapplication was performed.
- **[Issue #2](https://github.com/NHMNDaizoken/Rosetta/issues/2) — C1
  validation-report audit gap.** Migration 010 corrects the underlying C1 function
  while preserving the later approval/discovery wrappers. Report updates and
  their audit append now share a transaction; isolated failure tests roll both
  back. Publication itself already had its own audit lifecycle.
- A rolled-back synthetic SQL probe confirmed that C1 publish can return
  `200/published` with NULL `validation_status`, `validation_digest` and
  `validation_revision`. This publication-integrity prerequisite must be
  corrected by migration 010's NULL-safe report/digest/revision/policy guard and
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

Tickets have 256 bits of entropy, are stored as SHA-256 hashes, and expire within
30 seconds and every authority/deadline bound. The provider authenticates using
its independently enrolled service subject. Redemption rechecks the live
initiator lease and bound C2 grant, then consumes and audits in one transaction.
Wrong provider, input, proof, expired or replayed tickets expose no context.
Result bodies have a minimum 24-hour retention bound; there is no automatic
tombstone deletion or idempotency-key recycling.

`npm run test:execution-ledger` creates a fresh PostgreSQL container with no
network and tmpfs data, runs migrations 001–010, and tests C1 prerequisites,
reservation concurrency, isolation, replay, expiry, grant binding and audit
failures. Its claims simulate trusted Core assertions; real multi-tenant OIDC
and provider/Flowable dispatch remain Increment C gates.

## Limitations

- Duplicate JSON object keys are rejected by the existing strict wire parser
  before this module; `validatePayload` receives an already parsed value.
- Raw-byte execution handling, when added, must preserve the 64 KiB wire bound
  and the strict duplicate-key UTF-8 parser independently of value validation.
- No exactly-once claim is made for external provider effects.
- Capabilities requiring an invocation administrator approval are rejected;
  only `preconditions.approval=none` is supported by this bounded runtime.

The B development verification passed 58 host and 58 pinned-container unit
tests, four fresh PostgreSQL test groups with 39 contract observations, the
17-test real OIDC C1/C2 suite, seven protected-audit tests and isolated restore.
Versions 001–010 and all Core/private function definitions, owners and ACLs
match the fresh installation. Public provider execution remains unavailable.
