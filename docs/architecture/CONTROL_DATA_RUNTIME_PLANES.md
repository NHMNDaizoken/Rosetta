# Control, data, runtime, operations and capability planes

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`
> Existing boundaries are identified below; new modules/interfaces are PROPOSED.

## Responsibilities and placement

| Plane | Responsibility and authority | Current implementation | Proposed additions |
| --- | --- | --- | --- |
| Control | Authorize and persist management intent, policy, allocation and ownership metadata. | Core Application Authority, private PostgreSQL RPC/tables; Console calls selected public APIs. | Projects, environments, membership, deployments, quotas, approved nodes, route ownership, binding references and desired state. Initially logical modules in the existing management boundary; separate SQL roles/schema. |
| Backend/data | Serve reusable authenticated application operations. | Identity integration, structured records, objects, workflow and exact read shares. | Only separately approved Foundation extensions/shared services. Both hosted/external backends use the same public APIs. |
| Runtime | Execute approved artifacts and report actual instances. | No application-hosting controller/worker. Existing provider containers are operational infrastructure, not user deployments. | Narrow deployment controller and approved runtime worker on operator infrastructure. Worker handles only typed, scoped workload intents. |
| Operational | Operate hosts, backups, builds, security policy, telemetry and recovery. | Compose/CI/health tests and partial restore. Docker/SQL administrators are privileged. | Protected audit sink, backup policy, measured admission, image verification, host supervision, node enrollment and incident handling. |
| Capability | Optional discovery, directional compatibility, grants and orchestration overlay. | DESIGN ONLY beyond registration/approval subset. | Registry/Trust/Resolver/Composition reusing A+ and Flowable; no dependency from ordinary BaaS/hosting to this plane. |

Consoles are clients of the Control Plane. They may request an action and display
observed status; they never run Docker commands, hold infrastructure secrets or
declare their own effective permissions. Closing the browser must not cancel a
deployment or erase its authoritative history. Current session caches do not
satisfy these requirements.

## Proposed request and reconciliation contracts

Public management API validates a live human/operator context and a target
resource inside the authenticated tenant, checks explicit management permissions,
then commits desired state and an audit intent atomically. It returns an operation
identifier and revision, not a promise that a container already started. A proposed
appId in a management request is a target reference, never asserted caller identity.

That atomic boundary is a co-located protected local audit append through its
owner-controlled interface plus the management outbox in one database transaction.
An independent audit sink is exported separately under an approved retention/
backpressure policy; no distributed atomic commit or remote integrity is implied
by a local outbox acknowledgement. ADR 012 must decide when sink unavailability
blocks new admissions.

The controller consumes persisted intents using a lease plus fencing generation.
The simplest initial durable work queue can be a private SQL outbox owned by the
management subsystem. A public event bus is not a prerequisite. Concurrent
controllers or duplicate delivery must converge on one logical deployment by
deterministic scoped instance identity and observed generation; exactly-once
execution is not assumed.

Worker commands contain tenant/app/environment/deployment IDs, immutable image
digest, bounded approved resource profile, secret-reference IDs, allowed ports,
health policy and generation. Unknown fields, shell fragments, raw Compose/YAML,
arbitrary mounts/commands, networks or Docker options are rejected. Registry and
health destinations are operator-approved, not fetched because a caller supplied
a URL. Worker responses contain observations and sanitized reasons, not secrets.

Controller/worker and ingress-applier interfaces are private authenticated
management protocols. Same-host Unix transport is an initial option; remote nodes
require authenticated node identity, encrypted transport, enrollment/rotation,
replay protection and fenced credentials. Exact protocol remains an ADR 004/005
approval gate. Workers do not write control tables directly: they submit typed
observations through the owning control module. Each subsystem owns its schema.

## Proposed privilege matrix

All F-domain permissions below are PROPOSED and require persisted server-side
policy. The current three administrative permissions remain unchanged.

| Principal | Permitted purpose | Does not imply |
| --- | --- | --- |
| Platform operator | Enroll nodes, approve artifact sources/profiles, manage platform trust, recover infrastructure; audited break-glass procedures. | Routine application data access through v2 or an unaudited browser super-token. |
| Tenant administrator | Manage approved tenant-level allocations/membership within operator ceilings; current application approval only if explicitly enrolled. | Host root, global node access, cross-tenant scope or ownership of every application. |
| Project owner | Manage project membership/configuration inside delegated tenant entitlements. | App owner transfer, approval authority or reads of app-private data. |
| Developer | Submit approved release/deployment intent and inspect authorized logs/status for assigned environment. | Registry administrator, arbitrary Docker executor, production deploy without that environment's permission, or secret value readback. |
| Application backend | Use its own active registration and exact enrolled subject to call v2; validate its end users. | Management permissions, host privileges or another application's credentials. |
| End user | Use a Layer-2 product under its own domain authorization. | Direct confidential-client secret, tenant-wide writer token or access to control/runtime APIs. |

Management rights and data rights stay independent. Infrastructure operators can
technically access host/storage contents; the design must state and audit that
trusted boundary rather than claim protection against a malicious host root.

## Interface separation

| Interface | Exposure and authorization |
| --- | --- |
| Existing Foundation routes | Public Gateway; existing live identity and resource rules. No hosting bypass. |
| Proposed management routes | Separate versioned management contract/route prefix after approval; explicit server permissions and tenant scope. No arbitrary infrastructure RPC proxy. |
| Keycloak administration | Operator-controlled; current broad `/identity/` proxy must be reviewed before Internet exposure. Application registration does not provision/disable clients. |
| PostgREST/SQL/filer/Flowable | Private provider interfaces. No hosted workload joins these networks or gets their administrator credentials. |
| Controller/runtime/node channel | Restricted operational identity and transport; not exposed by the public API explorer or Console. |
| Hosted application ingress | Separate hostnames/routes, app health policy and certificates; independent of platform API hostname and Keycloak issuer. |
| Operational telemetry/backups | Restricted operational interfaces; app-scoped sanitized views only where separately authorized. |

Basic external applications remain usable while the future hosting control
modules are unavailable. Existing Foundation authorization itself still depends
on live Keycloak and, for v2, PostgreSQL authority; do not promise offline grants.
Healthy workloads should continue running during a Control Plane outage under
the chosen host supervisor, although calls into an unavailable Foundation fail
closed. Already materialized ingress must not require live Console calls.

## Management contracts required before implementation

The following is an indicative **PROPOSED** namespace/operation inventory, not
an implemented API or an approved final URL choice. Each slice must review a
separate management OpenAPI with bounded closed inputs, output schemas, errors,
authorization, concurrency and retry semantics before adding routes.

| Module | Contract surface to review | Mandatory boundary |
| --- | --- | --- |
| F1 | `/management/v1/projects`, project/environments, membership and app-attachment actions | Tenant derived from authenticated context; app IDs are checked targets. Exact project/environment permission, immutable IDs, ETag revisions and archive policy. |
| F2 | Release admission, deployment intents/status/history, stop/update/rollback actions | Digest/provenance/resource policy, scoped idempotency; accepted intent versus observed result. Request cannot choose operational identity or raw Docker options. |
| F3 | Private admitted-workload/observation protocol | Node authentication, fence/generation, typed profile, rejected unknown fields. No public `/docker/*` bridge or direct control-table writes. |
| F4 | Domain challenge/verify/release and route revision/status | Hostname uniqueness, current ownership proof, reserved-domain policy and observed activation; no user Nginx config. |
| F5 | Binding-reference create/get/rotate/revoke and private delivery receipt | Never return secret values through management read; exact tenant/app/environment ACL and credential version/lifetime. |
| F6 | Deployment status, bounded log cursor, measured utilization and authorized operational actions | App/environment-scoped redaction and retention; no host shell, broad provider diagnostics or invented measurements. |

Common proposed management responses distinguish accepted async intent (202)
from conflict (409), stale revision (412), missing revision (428), denied/hidden
resources and unavailable authority. Exact status/body/media contracts are approval
work, not changes to current Foundation responses. Sensitive mutations need an
audit intent before side effects. A retryable idempotency key must bind tenant,
actor, operation, target and canonical intent; changed content conflicts and a
lost acknowledgement is reconciled before another infrastructure action.

## Notes

[MAP 04](ARCHITECTURE_MAPS.md#map-04-control-data-runtime-and-operational-planes)
shows these interfaces. [Deployment failure behavior](DEPLOYMENT_MODEL.md#failure-contract)
and [ADRs 004–007](ARCHITECTURE_DECISIONS.md) control unresolved execution choices.
There is no second user database, Docker access from Core, or additional workflow
engine proposed by this separation.
