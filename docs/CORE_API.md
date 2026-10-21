# Layer 1 API contracts

All routes are reached through the local gateway at `PUBLIC_URL` (default
`http://127.0.0.1:8080`). Versioned Core routes use `/v1`. This stack is a local
foundation: HTTP is restricted to loopback, and no production deployment is
configured. Configure TLS, trusted proxies and secrets before any approved
deployment beyond the local environment.

## Identity and gateway

- `GET /health` and `HEAD /health`: existing process-liveness contract.
- `GET /ready`: dependency-aware readiness, `200` or `503`; separate from liveness.
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
existing file. `docker compose up --build --detach --wait --wait-timeout 180`
starts real services. `npm run test:integration` verifies discovery, real token
issuance, two tenant identities, spoofed-header denial and a complete PKCE
authorization-code/login/logout flow using the upstream provider.

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
