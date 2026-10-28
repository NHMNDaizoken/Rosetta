# Local deployment and recovery

This Compose stack is a single-host Layer 1 development/test environment. Only
the Nginx gateway binds a host port by default, on `127.0.0.1:8080`; the optional
Console profile also publishes loopback port 3000. No production deployment,
container registry publication or automatic release is configured.

## Start, check and stop

Use Node.js 24 and Docker with Linux containers. From the repository root:

```sh
npm run setup
npm run check
npm test
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 240
npm run healthcheck
docker compose exec -T core node scripts/check-health.mjs
npm run test:integration
npm run test:applications
npm run test:capabilities
npm run test:recovery
npm run test:audit
docker compose ps
docker compose down
```

Setup creates `.env` with random fixture credentials and refuses to overwrite
an existing file. Keep that file private. Do not print `docker compose config`
without `--quiet`: resolved configuration contains secrets. Do not copy working
credentials into examples, issues, logs or CI artifacts. Restrict local Docker
and `.env` access to trusted operators.

`/health` is process liveness; `/ready` checks configured dependencies. A healthy
process can return readiness `503` during an outage. Nginx resolves recreated
Core/Identity containers using Docker DNS without a manual proxy reload.
Readiness is a bounded dependency check, not a guarantee of transaction success.

The integration suite intentionally stops dependencies and restarts PostgreSQL,
recreates data/object/workflow/Core containers, and stops/starts Identity. It
checks denied access during outages and recovery with persistent state. Use a
local test stack without application traffic. Run integration, application,
restore and audit tests sequentially because they share the source database. The
audit suite restarts PostgreSQL to prove durable events and the read boundary;
run it after suites that rely on uninterrupted provider sessions.

## Persistent state and upgrades

`postgres-data` contains separate identity, data and workflow databases;
`object-data` contains SeaweedFS volume chunks, master state and LevelDB filer
metadata. Retain both named volumes. `docker compose down` stops/removes project
containers and networks while retaining volumes. Never use `down -v`, volume
pruning, or a destructive reset to apply a configuration change.

The data migrator applies versioned SQL transactionally, with an error stopping
startup. A repeated run is safe and does not drop stored records. Add a new
migration for later schema changes. Migration 005 preserves `app_private.audit`,
adds the protected audit metadata/read role and has no down migration; retain the
table, roles and events on rollback. Keycloak realm import initializes an empty
realm only; changes to its JSON do not migrate an existing realm. Flowable owns
its database schema initialization. Review each upstream migration before an
image upgrade, retain the old pins and take a consistent backup first. Reverting
an image is not proof its previous version can read a migrated database.

## Verified restore boundary

Migration 004 adds app records, resource ownership/shares and enrolled backend
subject bindings. See [resource authorization](RESOURCE_AUTHORIZATION.md) before
upgrading, configuring the legacy allowlist or rolling back. Keep v2 object bytes
and metadata together. Logical object deletion retains tombstones and bytes;
reclamation is an operator task, not an automatic cleanup of application data.
The isolated restore test also checks the resource role, same-tenant app RLS and
the audit role/ACL/tenant query. See [protected audit](AUDIT.md).

`npm run test:recovery` seeds its own UUID record, creates a temporary PostgreSQL
using the pinned image, and streams `pg_dump --format=custom` into `pg_restore`.
The target has no network or published ports and keeps its database in temporary
memory. The test preserves table ownership, ACLs and policies, then checks the
record is visible to tenant A and invisible to tenant B under `rosetta_api`.
It also checks that the audit role cannot write the audit table but can run the
tenant-scoped query after restore, and that tenant B cannot read tenant A's event.
It stops only its own temporary container and removes only its own source fixture.
It does not restore over the project database or remove project volumes.

This tests structured-data recovery, not a full platform backup. It does not
verify restoration of Keycloak sessions/keys, Flowable history, SeaweedFS
metadata/chunks, or consistency across all stores. An approved deployment needs
an access-controlled, encrypted backup destination, retention policy and tested
coordinated restore of all databases, roles, secrets and both object-store data
types. Quiesce writes or use an explicitly verified consistent snapshot strategy;
copying a live volume directory is not a demonstrated backup procedure.

## Deployment gate

Before any deployment beyond this local stack, approve the target and review
TLS, hostnames/proxies, secret storage/rotation, fixture account removal, resource
limits, vulnerability findings, complete binary license notices, backups and
rollback. Do not expose the private database, filer or engine interfaces.
No Layer-2 business GUI/workflow or application-specific schema is supplied here.
The optional Console is a management client with [audit limitations](architecture/LAYER1_CORE_CATALOG.md#console-evidence-and-contradictions).
Future application hosting is defined in the [proposed deployment model](architecture/DEPLOYMENT_MODEL.md),
not enabled by this local operations guide.
