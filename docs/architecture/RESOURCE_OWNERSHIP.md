# Resource ownership and conceptual entities

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

## Identifier invariants

Current v2 owner remains the immutable server-created registered application UUID
within its tenant. Its authoritative binding is verified issuer/client/subject
plus enabled enrollment and active application state, not a project label,
hostname, image, ownership header or deployment record. Existing public identity
stays `{subject, tenantId, roles}`. No new ID or role is added by these documents.

Proposed project/environment/deployment identifiers are new opaque UUID namespaces
in a management-owned schema. They never replace appId, resource ID, OAuth client
ID or capability URN. Every reference must use tenant-qualified foreign keys and
server authorization. An operator-selected target app ID is looked up and checked;
it is not trusted as the identity of the request.

## Entity register

Each proposed lifecycle below is a contract proposal, not a new database table.
Persistence includes recovery of both the entity and its authorization links.

| Entity / status | Owner and authoritative ID | Lifecycle / relationships | Scope and authorization | Persistence / recovery |
| --- | --- | --- | --- | --- |
| Tenant — IMPLEMENTED claim boundary; management UNVERIFIED | Keycloak membership/mappers supply verified `tenant_id` and memberships; canonical tenant string. No Rosetta tenant CRUD. | Membership/configuration managed by operator; no platform tenant deletion workflow. Contains existing apps/resources. | Verified issuer claims and tenant membership checked by Core; tenant is not caller header. | Identity DB/configuration and data tenant keys must agree after recovery. |
| User/principal — IMPLEMENTED | Keycloak `(issuer, subject)`; Rosetta management enrollment additionally keyed by tenant and management client. | IdP enabled/session state differs from Rosetta `principals.enabled`; memberships may change. | Live token checks, then explicit enrolled permissions for management. Service-account resource subject is distinct from human app owner. | Keycloak IDs, tenant mappings and private enrollment recovered together; never match by display name/email. |
| Registered application — VERIFIED within catalog evidence | A+ Authority `(tenant_id, app_id)`; unique `(tenant, issuer, oauth_client_id)`. | Pending → active by independent approval; active → suspended; suspended → active by fresh approval; nonterminal → revoked terminal under current transition rules. Owner transfer absent. | Migration 003 exact enrollment/owner/admin permissions and ETag/revision; data permission separate. | `app_private.applications`, enrollments, approvals and audit; retain IDs/tombstones on rollback. |
| Project — PROPOSED | F1 `(tenant_id, project_id)`; slug is display/routing metadata, not authority. | Active → archived; deletion deferred until resources/bindings retained or explicitly disposed. Contains environments and project memberships. | Tenant entitlement plus explicit project management permissions; project ownership does not transfer registered apps. | New private management tables and FK/ACL migrations; archive preserves audit and mapping. |
| Environment — PROPOSED | F1 `(tenant_id, environment_id)` under one project; scoped name such as staging. | Active → frozen → active; archived only with no active desired deployments. Own configuration and app mappings. | Explicit environment deploy/config/read-log permission; production rights separate. | Versioned configuration and references; restore before reconciling workloads. |
| Deployment — PROPOSED | F2 `(tenant_id, deployment_id)`, target environment + existing appId; monotonically increasing generation. | Requested → admitted → reconciling → ready; failed, degraded, stopped or superseded observations. Desired running/stopped differs from observed status; timeout may be unknown. | Live management authorization and active app checked at admission and before new side effects; route/binding scope validated. | Intent, idempotency reservation, observations, audit/outbox and last-known route revision. Reconcile; do not blindly replay. |
| Release/artifact — PROPOSED | F2 release UUID; exact OCI registry/repository/digest plus platform/architecture and provenance reference. | Proposed → operator-admitted → retired; immutable contents, no mutable-tag update in place. Many deployments may reference a release. | Operator-approved source/signer/policy; developer may choose only permitted admitted artifact. Digest is identity, not trust proof. | Preserve digest, scan/provenance evidence, source/license references and retrieval policy for rollback. |
| Runtime instance — PROPOSED | F3 node ID + fenced deployment generation + opaque instance ID. | Created → starting → healthy/unhealthy → exited/removed; unknown when node unavailable. | Worker/controller operational identity; no tenant-selected container ID/Docker options. | Observed runtime is not sole authority. Reconstruct only from management intent and node inspection; prevent duplicates after controller restart. |
| Domain/route — PROPOSED | F4 normalized hostname + route UUID/revision; uniqueness enforced across tenants. | Pending ownership verification → verified → provisioned → active; expiring/disabled/released states. | Verified domain proof and route permission; operator hostname/IP restrictions. No claim by first HTTP Host header. | Challenge evidence/expiry, certificate secret reference and last-known-good route; restore/renew independently. |
| Resource ownership — VERIFIED within catalog evidence | A/data `core.app_records` and A/object `app_private.resource_objects`; tenant + resource UUID; owner app immutable. | Records create/update/delete; objects reserve/upload/version-publication/logical tombstone. Exact read shares expire/revoke. | Server-resolved active owner; same-tenant share grants only reads; no admin inheritance, no environmental relabeling. | DB ownership/version pointers plus SeaweedFS immutable versions must be consistent; retain tombstones to prevent takeover. |
| Service binding — PROPOSED | F5 `(tenant_id, binding_id)` targeting exact environment/app and approved service. | Proposed → authorized → active(version) → rotating → revoked; failure prevents new delivery. | App owner or separately approved binding permission plus operator policy; project membership alone insufficient. Secret references only in public metadata. | Protected references and policy revisions; secret values/key custody recovered separately. Never revive revoked credentials from old backup without reconciliation. |
| Capability manifest — DESIGN ONLY | D Registry tenant + capability URN + exact version/digest, provider app UUID. | Draft/publication/retirement/revocation as existing Capability design; immutable published versions. | Explicit provider app authority, schema profile and publication checks; hosting does not imply publication. | Separate registry-owned state, not generic records or deployment labels. Refer to existing schemas. |
| Capability grant — DESIGN ONLY | D Trust server grant ID; caller/provider/version/permission bounds. | Approved → active → expired/revoked, with constrained delegation only under existing proposed trust rules. | Provider/trust authorization; discovery never grants invocation. Current resource shares are not capability grants. | Trust store and audit recovery must preserve revocation; no current runtime table. |
| Audit event — IMPLEMENTED bounded boundary / PROPOSED export domain | A+ `app_private.audit`: `(tenant_id,event_id)`; migration 005 adds actor app ID, resource type, outcome, reason code and schema version. | Append in authority mutation transaction; retention/export/integrity lifecycle DEFERRED. | Current API cannot edit audit. Internal `core.audit_query(jsonb)` is tenant-filtered and requires `audit.read`; no public route. | Existing DB audit recoverable with schema; independent tamper evidence, export and retention must be designed for the DBA/host threat model. |

## Proposed project/environment mapping

A project groups multiple applications and environments within exactly one tenant.
An environment may contain multiple registered applications. Initially a registered
app may bind to at most one `(project, environment)` pair, enforced by a unique
tenant/app mapping. The same logical product can have separate dev/prod app IDs,
OAuth clients and backend subjects. Those registrations may be linked for display,
but do not share private data or secrets by inheritance.

Existing external applications may remain unattached and keep working. Adopting
hosting requires an explicitly authorized, audited attachment of an existing app;
no migration rewrites ownership columns or creates an app from whichever client
calls first. Detaching/rebinding an app with resources, releases or grants requires
review and is deferred in the initial metadata slice. Project membership cannot
silently replace existing app ownership/enrollment.

Attachment also does not rewrite the registered `providerOrigin` or its exact
operator enrollment. Initially hosting can serve the existing enrolled hostname
after separate routing/TLS approval. A different provider origin needs a reviewed
Authority update/migration contract or a new registration with deliberate data/
grant migration; no such update API exists today. Routing metadata alone cannot
retarget future Capability calls or authorize private-table edits. Keycloak client
redirect URIs and client lifecycle remain separately owned by the identity operator.

Using one app ID for dev and prod would share the current v2 namespace. Adding an
environment field in JSON does not fix that. The initial target therefore requires
separate registrations for environment isolation. A future multi-environment app
identity model would need a new API version, ownership migration and denial tests;
it is not approved here (ADR 003).

## Data/configuration separation

Management schemas own projects, deployments, desired state, entitlements and
binding references. `core.app_records.data` is application content, never an
authorization store, deployment queue or secret vault. Keycloak owns clients and
human identities; F1 stores references, not shadow passwords/users. Flowable owns
engine state, while management owns deployment state; do not turn every container
restart into an ad hoc second workflow engine.

Cross-module operations call typed owner interfaces. New modules may read an
explicitly granted authority view/function, but may not directly update
`app_private.applications`/enrollments or Flowable/Keycloak tables. A single database
process does not remove logical ownership or least-privilege requirements.

## Current access and revocation invariants

The [current resource contract](../RESOURCE_AUTHORIZATION.md) is authoritative.
Shares are same-tenant, exact-resource reads, valid at most 24 hours; future owner
versions of the same live object remain readable under a valid share. Suspending
an owner blocks grantees; reactivation may restore unexpired shares. Revocation is
terminal, retains resources and does not disable Keycloak clients. Requests already
authorized/in flight may finish; there is no cancellation barrier.

Legacy v1 remains tenant-scoped and separately allowlisted. Hosting must not add
hosted apps to that allowlist automatically. App suspension also does not revoke
current tenant-scoped workflow rights, terminate public app HTTP traffic, stop
containers or rotate delivered secrets. Proposed hosting stop/route/binding policy
requires explicit controller integration and tests; no immediate cutoff promise.

## Notes

[MAP 05](ARCHITECTURE_MAPS.md#map-05-resource-ownership-and-trust)
illustrates the relationships. [ADR 003/008/010](ARCHITECTURE_DECISIONS.md)
and the handoff govern schema/API approval; no migrations are created here.
