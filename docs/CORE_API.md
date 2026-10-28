# Layer 1 API contracts

The implemented machine-readable source is
[Foundation OpenAPI 3.1](contracts/foundation-api.openapi.json). See
[validation, boundaries and tested HTTP examples](FOUNDATION_OPENAPI.md).

All routes are reached through the local gateway at `PUBLIC_URL` (default
`http://127.0.0.1:8080`). Versioned Core routes use `/v1` and `/v2`. This stack is a local
foundation: HTTP is restricted to loopback, and no production deployment is
configured. Configure TLS, trusted proxies and secrets before any approved
deployment beyond the local environment.

Application-private records and objects use the implemented
[v2 resource contract](RESOURCE_AUTHORIZATION.md): authoritative backend client
bindings, owner-only writes, exact owner-approved read shares and live app-state
checks. V1 data/object routes below are a separate deprecated legacy namespace,
restricted to `LEGACY_RESOURCE_CLIENTS` (empty by default outside local Compose).
They never read v2 tables or bytes. Migrate existing data deliberately; do not
infer ownership or silently fall back to v1. Identity and workflow contracts stay
at v1, and workflow variables remain tenant-scoped.

## Identity and gateway

- `GET /health` and `HEAD /health`: existing process-liveness contract.
- `GET /ready`: dependency-aware readiness, `200` or `503`; separate from liveness.
  Checks OIDC discovery/issuer, an RLS-scoped data query, object filer metadata
  plus a registered storage volume, and the authenticated workflow engine.
  It does not prove every future operation or a complete disaster recovery.
- `GET /v1/identity`: authenticated `{subject, tenantId, roles}`.
- `/identity/realms/rosetta/.well-known/openid-configuration`: upstream Keycloak
  discovery. Use its standard OIDC authorization, token, refresh and logout APIs.

Gateway auth-request and Core independently introspect bearer tokens through
Keycloak's confidential `rosetta-core` client. Require active, unexpired tokens,
the configured issuer, audience `rosetta-core`, realm role `core-reader`, and
`tenant_id` matching an authoritative `tenant_memberships` group. Caller tenant
headers are ignored. Provider errors fail closed. No custom JWT verifier,
password database or email-only login is implemented.

The imported realm contains two local service-account tenants and a read-only
account, all using random secrets from ignored `.env`. `rosetta-local` is a public
authorization-code client requiring S256 PKCE, with exactly one loopback callback:
`http://127.0.0.1:9876/callback`. The technical `local-user` fixture belongs to
tenant A; its random password stays in `.env`. Registration is disabled. These
fixtures are not production account provisioning or business entities.

Group memberships and role grants are administrator-owned. A tenant attribute
alone never grants membership. Core returns only its supported reader/writer
roles. No caller may assign a tenant via a request payload/header.

Unknown routes return `404`; denied credentials return `401/403`. Gateway-level
denials can use Nginx's standard error representation; Core errors use JSON
`{error: code}`. Identity dependency failure returns `503`. The gateway enforces
request-size/time bounds and a per-source rate limit; upstream URLs are fixed
configuration, not caller input. Internal auth and service ports are unpublished.

## Running the local checks

`npm run setup` creates ignored random credentials and refuses to overwrite an
existing file. `docker compose up --build --detach --wait --wait-timeout 240`
starts real services. `npm run test:integration` verifies discovery, real token
issuance, two tenant identities, spoofed-header denial and a complete PKCE
authorization-code/login/logout flow using the upstream provider.
It also interrupts/recreates local dependencies and verifies recovery. Run only
against a local test stack, sequentially with `npm run test:recovery` and
`npm run test:audit`.

Keycloak imports the realm only into an empty database. Editing the JSON does
not migrate an existing realm. Use reviewed administrator changes for an
existing realm; never delete a data volume to apply a configuration edit.

## Structured data

| Route | Methods | Contract |
| --- | --- | --- |
| `/v1/data/{collection}` | GET | `{items: [...]}`, optional `limit` 1–100, default 100 |
| `/v1/data/{collection}` | POST | Body `{data: {...}}`; returns `201` with generated UUID |
| `/v1/data/{collection}/{id}` | GET, PATCH, DELETE | Read, replace `data`, or delete an owned record; `404` for an inaccessible ID |

Collections match `[a-z][a-z0-9_-]{0,62}`; IDs are UUIDs. JSON request bodies are
limited to 64 KiB, with `Content-Type: application/json`. Unknown fields and
query parameters are rejected. Writes require `core-writer`; all access requires
`core-reader`. Reads expose only ID, collection, JSON data and creation time.
This is generic structured storage; no app-specific schema/business rules exist.

Core issues a short-lived, tenant-scoped internal assertion for PostgREST with
audience `rosetta-data` and role `rosetta_api`. Caller tokens are never treated as
internal database credentials. PostgreSQL FORCE ROW LEVEL SECURITY enforces
tenant claims for reads and writes, including direct service-level queries.
The assertion secret stays inside Compose; there is no anonymous PostgREST role
or published database/data API port.

`data-migrate` applies `infra/postgres/001-data.sql` transactionally and idempotently
without dropping data. Existing migrations must not be edited after release;
add a new reviewed migration for schema changes. Named volumes survive
`docker compose down`. Never use `down -v` on persistent project data.

## Unstructured objects

| Route | Methods | Contract |
| --- | --- | --- |
| `/v1/objects` | POST | Upload bytes with a generated UUID; returns `201 {id,size}` |
| `/v1/objects/{uuid}` | PUT | Upload/replace at a caller-chosen UUID; `201` created or `200` replaced |
| `/v1/objects/{uuid}` | GET, DELETE | Read or delete an owned object; inaccessible/missing IDs return `404` |

Uploads require `application/octet-stream`, 1 byte–5 MiB, and `core-writer`.
Files are opaque bytes; original filenames, executable scripts and MIME-based
rendering are not part of the API. Downloads always use octet-stream,
`Content-Disposition: attachment`, `nosniff` and `no-store`. GET requires reader
permission; DELETE requires writer permission. Other query parameters, object
path formats and content types are rejected.

SeaweedFS filer/volume/master data and LevelDB filer metadata live in a named
volume. Core constructs the private storage path from verified tenant identity
and a validated UUID; a caller cannot provide a path or storage endpoint. Only
Core shares the private objects network with SeaweedFS; no filer/admin port is
published. The adapter is the authenticated object-service boundary.

Use PUT with a stable UUID and identical bytes for retryable writes. POST creates
a new identifier and is not automatically retried; an ambiguous POST timeout
must not be treated as proof no object was stored. No upstream call is blindly
retried. This is single-node local persistence, not a replicated storage cluster.

## Workflow engine

| Route | Methods | Contract |
| --- | --- | --- |
| `/v1/workflows/definitions` | GET | Up to 100 latest operator-installed definitions for the verified tenant: `{items:[{id,key,version,name}]}` |
| `/v1/workflows/executions` | POST | `{definitionId,input?:{...}}` plus a lowercase UUID `Idempotency-Key`; `201` created or `200` replayed |
| `/v1/workflows/executions/{id}` | GET | Durable `{id,definitionId,status,input}` from engine history |
| `/v1/workflows/executions/{id}/complete` | POST | Empty JSON object; completes an execution with exactly one active user task; repeat completion returns its completed state |
| `/v1/workflows/executions/{id}` | DELETE | Cancels a running execution; repeated cancellation returns `204`; a completed execution returns `409` |

Writes require `core-writer`, reads require `core-reader`. Definition ownership
is verified before starting. Every history/task lookup is scoped to the verified
tenant; foreign definition/execution IDs return `404`. Input is JSON with a
64 KiB request limit and maximum nesting depth of 32. Caller tenant fields and
unknown query/body fields are rejected. Internal engine URLs/credentials are
never returned. Status is `running`, `completed` or `cancelled`.

Flowable REST owns BPMN execution, tasks, variables and history in a separate
database/role. Its private REST boundary uses a random administrative credential;
only Core and the one-shot operator initializer share the engine network with
the database. No Flowable port is published. The initializer installs one
original technical checkpoint definition per local fixture tenant if missing.
The checkpoint is a start event, one user task and an end event; it has no
business rules or external side effects. Operator-reviewed BPMN versions can be
installed through the private engine interface; public callers cannot upload
BPMN, scripts or arbitrary network targets. Single-task completion is the current
adapter contract; more complex task interaction requires a separately reviewed
contract. Other installed definitions can still be started, observed and cancelled.

The SQL ledger has a unique `(tenant_id, key)` reservation under RLS. Exactly
one reservation owner may call engine start. Retries with different input or
definition return `409`; object-key order does not change input identity.
If the engine result was not recorded, Core reconciles by the tenant-scoped
business key in durable engine history and records the existing execution ID.
If no unique outcome is established, it returns `409 execution_pending_reconciliation`
and never starts another execution for that key. Operators must resolve a stuck
reservation after checking engine history and in-flight work; there is no blind
automatic retry, reservation expiry or ledger deletion. Keep definitions,
history and ledger for the supported retry window. This prevents duplicate
start calls; it is not a promise of exactly-once external business effects.

Flowable performs its upstream schema initialization in its own database on
first boot. Review migrations and backups before changing the pinned engine
version. Rosetta ledger changes use additive, versioned SQL migrations.

## Internal protected audit contract

Authority and control-plane mutations append `app_private.audit` rows in the same
transaction. Migration 005 derives actor/tenant metadata, validates event/outcome
and redacts free text; failure to append rolls back the mutation. The internal
`core.audit_query(jsonb)` function accepts only `since`, `until`, `limit` and
`cursor`, requires a principal with `audit.read`, and is executable only by
`rosetta_audit_api`; application roles cannot read or write the table directly.

This is not a Foundation route and has no public OpenAPI operation. Do not expose
it through PostgREST or `/v1`/`/v2` without a separately reviewed contract,
authorization mapping and pagination policy. See [AUDIT.md](AUDIT.md).

## Proposed capability APIs

The [Capability v1 specification](CAPABILITY_EXTENSIONS_V1.md), [trust/execution rules](CAPABILITY_TRUST_EXECUTION_V1.md) and [OpenAPI draft](contracts/capability-api-v1.openapi.json) describe the extension contracts. Application Registration and application-only approvals are the implemented subset below; a bounded offline compatibility resolver exists in `src/capability-compatibility.mjs`, while registry, resolver and execution endpoints remain future work. This OpenAPI is not a description of the working foundation routes above and does not change their public claims or permissions.

## Application Registration

POST /v1/applications, GET /v1/applications/{appId}, POST /v1/applications/{appId}/approve and POST /v1/applications/{appId}/state are implemented with tenant-scoped operator enrollment and explicit permissions. The /v1/approvals create/get/revoke subset supports application resources only. See the [runtime review](CAPABILITY_RUNTIME_REVIEW_V1.md), [operator instructions](APPLICATION_REGISTRATION.md) and [implemented Foundation OpenAPI](contracts/foundation-api.openapi.json) for the exact contract. These new routes return error plus requestId at Core; gateway denials retain their existing representation. No registry or capability execution endpoint is implemented.
