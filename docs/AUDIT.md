# Protected audit boundary

> Reviewed: 2026-10-28 | Status: IMPLEMENTED, bounded threat model

Rosetta appends authority and control-plane audit events in the same database
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
  or alter persisted rows. This slice does not provide cryptographic tamper
  evidence against a privileged database administrator.
- `rosetta_app_owner` and trusted owner functions are part of the write boundary.
  They must not accept caller-supplied actor, tenant, timestamp or event ID.
- Loss of the database, backups or volume is a recovery problem, not an audit
  integrity guarantee.

Deferred: independently controlled export/sink, cryptographic sealing, external
retention, legal hold and cross-store recovery. See
[ADR 012](architecture/ARCHITECTURE_DECISIONS.md#adr-012---protected-audit-boundary)
and the unresolved audit-integrity row in the same file.

## Storage and roles

`app_private.audit` is the only audit store. Migration 005 adds:

- `schema_version` (currently `1`), `actor_app_id`, `resource_type`, `outcome`
  and `reason_code`.
- A tenant-qualified actor foreign key to `app_private.applications`; `NULL` means
  no active enrolled application actor.
- `audit_tenant_time_idx` for tenant-scoped descending reads.

`rosetta_audit_api` is `NOLOGIN` and `NOBYPASSRLS`. It has schema usage and execute
on `core.audit_query(jsonb)`, but no table privileges. `rosetta_data` may assume
this role only through trusted database/PostgREST configuration. `rosetta_api`,
`rosetta_app_api`, `rosetta_resource_api`, PUBLIC and ordinary callers have no
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
`rosetta_app_owner`, callable only as `rosetta_audit_api`. It accepts only
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
npm run test:audit
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
