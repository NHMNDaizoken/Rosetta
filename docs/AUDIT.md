<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Protected audit boundary

> Reviewed: 2026-10-28 | Status: IMPLEMENTED, bounded threat model

Junctura appends authority and control-plane audit events in the same database
transaction as the mutation they describe. Migration 005 adds a restricted
tenant read contract, server-derived actor metadata, redaction and explicit role
separation around the existing `app_private.audit` table. There is no public
audit HTTP route.

## Threat model

Protected:

- Ordinary tenant users, readers/writers and enrolled application backends cannot
  read, append, update or delete another tenant's audit history.
- Application roles cannot forge tenant, actor, issuer, client, event ID, time,
  schema version or outcome through a direct insert or a generic data API.
- Sensitive authority changes fail closed if the audit append fails; the business
  mutation is rolled back with it.
- Secrets and arbitrary payloads are not stored in audit. Free-text reasons are
  best-effort redacted and bounded.

Trusted:

- PostgreSQL superusers, the database owner and a malicious host/operator can read
  or alter persisted rows. The [hash chain](#tamper-evident-hash-chain) makes later
  modification, deletion or reordering of sealed events *evident*; it cannot stop
  an administrator who rewrites the whole chain and its head consistently.
- `junctura_app_owner` and trusted owner functions are part of the write boundary.
  They must not accept caller-supplied actor, tenant, timestamp or event ID.
- Loss of the database, backups or volume is a recovery problem, not an audit
  integrity guarantee.

Deferred: independently controlled export/sink (anchoring the chain head outside
the database), external retention, legal hold and cross-store recovery. See
[ADR 012](architecture/ARCHITECTURE_DECISIONS.md#adr-012---protected-audit-boundary)
and the unresolved audit-integrity row in the same file.

## Storage and roles

`app_private.audit` is the only audit store. Migration 005 adds:

- `schema_version` (currently `1`), `actor_app_id`, `resource_type`, `outcome`
  and `reason_code`.
- A tenant-qualified actor foreign key to `app_private.applications`; `NULL` means
  no active enrolled application actor.
- `audit_tenant_time_idx` for tenant-scoped descending reads.

`junctura_audit_api` is `NOLOGIN` and `NOBYPASSRLS`. It has schema usage and execute
on `core.audit_query(jsonb)`, but no table privileges. `junctura_data` may assume
this role only through trusted database/PostgREST configuration. `junctura_api`,
`junctura_app_api`, `junctura_resource_api`, PUBLIC and ordinary callers have no
audit table privileges and cannot execute the query function.

`audit.read` is an explicit principal permission. It is not implied by
`core-reader`, `core-writer`, `applications.approve` or tenant membership.

## Write path

Direct Trust uses this same boundary for proposal, decision/denial, approval
consumption, activation and terminal revocation. Each required append and state
change share one transaction; append failure rolls back consumption and mutation.
Self-approval denials append a bounded `authorization.denied` event. Eligibility
is a read-only predicate; this is not universal HTTP access logging. See
[direct Trust](CAPABILITY_DIRECT_TRUST.md) for tested scope and recovery.

Existing owner functions insert directly into `app_private.audit`; new
control-plane domains may call `app_private.audit_append(...)` inside their own
transaction. The `BEFORE INSERT` guard:

1. Requires valid `request.jwt.claims` with `tenant_id`, `sub`, `iss` and
   `client_id`.
2. Rejects a row whose supplied tenant differs from the claims.
3. Validates the event domain, resource type, revision, outcome and reason code.
4. Derives `issuer`, `subject`, `management_client`, `actor_app_id`, schema
   version, event ID and timestamp in the database.
5. Redacts common bearer/JWT/secret patterns and truncates the free-text reason
   to 512 characters.

No audit column accepts a generic request body, token, password or arbitrary
JSON payload. A failed claim/authority/constraint check rejects the insert and
therefore the enclosing transaction.

## Internal read contract

`core.audit_query(jsonb)` is a `SECURITY DEFINER` function owned by
`junctura_app_owner`, callable only as `junctura_audit_api`. It accepts only
`since`, `until`, `limit` and `cursor`:

- `since`/`until` are timestamps; `since > until` is rejected.
- `limit` is an integer from 1 to 100; the default is 50.
- `cursor` is the opaque lowercase hex token returned as `nextCursor`.
- The tenant and reader identity come only from verified claims. A payload
  `tenantId`, event, resource or actor filter is rejected.

Success returns:

```json
{"status":200,"value":{"items":[{ "...": "..." }],"nextCursor":null}}
```

Items are ordered newest first and include event ID, time, tenant, schema version,
event, resource type/ID, revision, actor app ID, issuer, subject, management
client, outcome, reason code and redacted reason. Invalid input returns `400`;
missing claims or an unauthorized reader returns `403`.

This is an internal trusted-Core contract, not a Foundation OpenAPI operation.
Exposing a public audit route requires a separately reviewed contract, pagination
policy, error mapping and authorization review.

## Tamper-evident hash chain

Migration 018 seals each tenant's audit events into a SHA-256 hash chain.
`core.audit_verify(jsonb)` (same caller contract as `audit_query`: trusted Core
asserts `junctura_audit_api`, the verified principal needs `audit.read` in its own
tenant) runs under a per-tenant advisory lock and:

1. recomputes every sealed entry in `chain_seq` order. Entry `n` stores
   `entry_hash = sha256(["junctura-audit/1", n, prev_hash, tenant, event ID,
   time in microseconds, issuer, subject, client, event, resource type/ID,
   revision, outcome, reason code, reason, actor app, schema version])`, with
   `prev_hash` of entry 1 equal to 64 zeros;
2. compares the result with `app_private.audit_chain_heads`, so removing the
   newest entries is also detected;
3. only if the chain is intact, seals pending events in `(occurred_at, event_id)`
   order and advances the head. Nothing is ever sealed on top of a broken chain.

Ordinary appends are unchanged: they take no new lock and remain unsealed until the
next verification. The result reports `verified`, the number of intact `entries`,
`newlySealed`, `headHash` and `firstBreak` (`chainSeq`, `eventId`, and
`content_modified`, `chain_link_mismatch`, `missing_entry` or `head_mismatch`).
Hashing uses integer microseconds and canonical JSON, so session time zone and
date style do not change digests.

Core exposes it as `POST /v1/audit-events/verify` with body `{}` (Capability
OpenAPI `verifyAuditChain`); the Console Security screen has a **Verify integrity**
button. Integration suites delete synthetic audit rows during cleanup, which is
itself reported as a break: verify the chain on a stack that has not run them.

### Local demonstration

```sh
npm run audit:demo              # verify through Gateway -> Core -> database (expect intact)
npm run audit:demo -- tamper    # alter sealed event #2 directly in PostgreSQL
npm run audit:demo              # reports the break at #2: content_modified
npm run audit:demo -- restore   # undo the alteration; verification is intact again
npm run audit:demo -- token     # short-lived auditor token to paste into the Console
```

The helper creates a local `junctura-demo-auditor-<tenant>` identity with only
`audit.read` (run `npm run app:enroll` first so the demo management client exists).
It is for development stacks only.

### Data subject access log

Capability calls that declare a context (see
[CAPABILITY_EXECUTION](CAPABILITY_EXECUTION.md#purpose-and-data-subject)) add an
`execution.subject_accessed` event to the chain with the purpose as `reason_code` and a
SHA-256 of the data subject as `reason`. The subject-to-execution binding lives in
`execution_private.execution_contexts` (forced tenant RLS, owner-only). People read
their own entries with `GET /v1/me/data-access`; tampering with the sealed purpose is
detected by the chain verification.

## Failure, retention and rollback

- Audit append failure rolls back the enclosing authority mutation. Callers must
  treat `503`/technical audit failure as "not committed", not as a retryable
  success.
- Existing audit events are durable PostgreSQL rows. Keep them in coordinated
  backups together with authority tables, roles and migration history.
- No automatic retention purge or down migration is supplied. Retain events for
  the approved operational window; deleting them is a destructive operator action.
- Rolling back application code does not remove migration 005. Keep the audit
  table and roles; disable new callers if required rather than dropping evidence.

## Verification

```sh
npm test                      # includes the verification route unit tests
npm run test:audit            # includes sealing, modification, deletion and truncation
npm run test:recovery
npm run test:applications
npm run test:capabilities
```

`integration/audit.mjs` covers derived metadata, redaction, forged tenant/actor
attempts, direct-role denial, tenant/time pagination, concurrent appends,
transaction rollback on append failure and persistence across a database restart.
`integration/recovery.mjs` verifies the audit role, ACLs, tenant RLS and query
contract after `pg_dump`/`pg_restore`. The existing application suite covers the
authority rollback and share-audit cases.
