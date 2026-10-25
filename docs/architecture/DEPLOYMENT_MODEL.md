# Proposed application hosting and deployment model

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`
> Status: PROPOSED. No hosting component, domain or VPS is installed/configured.

## Initial scope and options

Initial hosting accepts operator-reviewed, prebuilt OCI images by immutable
digest. It excludes arbitrary Git URLs, source builds, Dockerfiles, uploaded
Compose files, privileged containers, host networking/mounts, in-browser shells
and public unaudited tenant onboarding. CI may later build images in a separate
approved build environment; the hosting host pulls only admitted artifacts.

The table compares architectural fit, not feature parity. Vendor resource figures
are published prerequisites for those products, not measured Rosetta capacity.
License observations refer to the reviewed upstream branches on 2026-10-26; exact
version/image and transitive inventory must be reviewed before any integration.

| Option | Relevant model / resource evidence | License / operating and extension costs | Recommendation |
| --- | --- | --- | --- |
| Supabase self-hosting | Integrated BaaS and provider composition. [Official Docker guide](https://supabase.com/docs/guides/self-hosting/docker): minimum 4 GB/2 cores/40 GB SSD, recommended 8 GB+/4 cores+/80 GB+. | [Repository license](https://github.com/supabase/supabase/blob/master/LICENSE) Apache-2.0; individual bundled services retain their own terms. Another full BaaS duplicates current identity/storage/API ownership and adds migration/operations. | Learn service contracts and operations; do not replace working Foundation. Its whole-stack requirements do not size Rosetta. |
| Appwrite self-hosting | Integrated backend/project management. [Installation](https://appwrite.io/docs/advanced/self-hosting/installation): 2 cores, 4 GB RAM, 2 GB swap. | [Main license](https://github.com/appwrite/appwrite/blob/main/LICENSE) BSD-3-Clause; preserve attribution/disclaimer/nonendorsement and inspect dependencies. Adoption duplicates APIs/authority and creates migration cost. | Learn coherent project/service UX; no wholesale integration proposed. |
| Coolify | Existing image deployment/control model. [Requirements](https://coolify.io/docs/start-with-self-hosted): 2 cores/2 GB/10 GB, excluding hosted workloads; [digest image references](https://coolify.io/docs/applications/builds/docker-registries). | Reviewed [v4.x LICENSE](https://github.com/coollabsio/coolify/blob/v4.x/LICENSE) is Apache-2.0; do not assume older MIT descriptions apply. Separate privileged control, own metadata/proxy/upgrade/recovery surface. Rosetta permission/ID mapping and drift handling still required. | Candidate integration spike after ADR 005 approval, on isolated test node; no claim its API enforces Rosetta tenancy. |
| Dokku OSS | Single-server PaaS, nginx and runtime/plugin integration; [official installation](https://dokku.com/docs/getting-started/installation/) lists 1 GB minimum for Docker scheduler. | [OSS license](https://github.com/dokku/dokku/blob/master/LICENSE) MIT; plugins/images separate. Dokku Pro has separate terms and is excluded. Host/SSH commands need a constrained operator adapter; IDs and app config must not become caller shell fragments. | Lightweight integration candidate; compare digest admission, observed state, quota and rollback contracts before selection. |
| Narrow Rosetta controller over existing Engine | Existing operator Docker/Compose skills; no full BaaS replacement. Controller can limit artifact/options and use current authority. | Rosetta Apache-2.0 code; Engine/Compose and bundled images need own license inventory (Docker Desktop terms are separate). Small initial process, unmeasured RAM/CPU; reconciliation, route atomicity, recovery and security become Rosetta maintenance. | Proposed default for a bounded spike only, pending comparison acceptance. Do not build a general scheduler or raw Docker API proxy. |
| Compose + GitHub Actions only | Already used for Foundation development verification. [Compose startup conditions](https://docs.docker.com/compose/how-tos/startup-order/) support ordered readiness. | Existing pins/notices retained. CI is not an always-on desired-state controller; Compose files do not establish tenant authorization, safe input admission, domain claims or hostile isolation. | Keep for Foundation and disposable acceptance harness; insufficient alone as the public hosting product. |
| Defer hosting execution | External applications continue consuming Foundation; metadata and Layer-2 demo can progress independently. | No extra resident runtime/control cost; postpones operational risk but delays the hosting differentiator. | Choose if recovery, security budget or operator ownership cannot be proven. |

These are architectural inferences from the cited interfaces and current Rosetta
boundaries. No option was installed or benchmarked. Preserve license texts,
notices and required corresponding source on redistribution; network separation
does not waive obligations. Future adoption requires exact pin, edition proof,
SBOM/security review and recovery evidence. Firebase offers a useful
[project/app mental model](https://firebase.google.com/docs/projects/learn-more),
but Rosetta does not adopt Firebase's shared-project resource access semantics
or claim Firebase backend feature parity/self-hostability.

## Admission and runtime safety

The deployment API accepts typed intent, never a shell command. Authorization
uses live human/project/environment permissions plus the stored active app mapping.
Policy checks artifact digest and provenance, architecture, registry allowlist,
resource profile, environment entitlement, approved node, route and binding scope.
Digest pinning alone does not make an image trustworthy. Registry credentials stay
in a protected operational credential path.

A restricted controller/worker executes admitted intents under its own operational
identity. [Docker daemon access is privileged](https://docs.docker.com/engine/security/):
mount/host options can confer host control. No Console, Core, app or general public
management request receives the daemon socket, host credential or arbitrary daemon
operation. A socket proxy is not automatically sufficient policy enforcement.

Initial workload profile: nonroot image, dropped capabilities, no-new-privileges,
read-only root filesystem, bounded tmpfs, PID/CPU/memory limits, bounded logs, no
devices/host mounts/socket/host namespace. Image entrypoint is operator reviewed;
developer-controlled shell/command overrides are excluded. App ingress and egress
are individually allowed. Workloads do not join provider, identity-admin,
controller or backup networks; they call Foundation through its authorized API
route, never private PostgREST/filer/engine endpoints. Block metadata/link-local,
host/admin and private provider destinations. Egress to an approved Foundation
hostname is a deliberate narrow exception, not unrestricted RFC1918 access.

Ordinary shared-kernel containers and Docker network separation do not isolate
hostile tenants adequately. Public arbitrary code needs separately approved VMs
or isolated worker nodes, hardened kernels and node-level credentials/network
policy. Trusted-image hosting on one VPS accepts a shared-host/operator trust
boundary and resource contention; it carries no hostile-tenant or HA guarantee.

## F1–F6 contracts and ownership

| Module | Proposed management contract and owner | Explicit initial limits |
| --- | --- | --- |
| F1 projects/environments | Tenant-scoped private management store; membership, entitlement and app-attachment APIs with revision/audit. | No changes to v2 IDs; separate app/client per isolated environment. No automatic principal/client bootstrap. |
| F2 deployments/releases | Immutable artifact records, idempotent deployment intent, desired/observed generation, status/history, stop/update/rollback requests. | No automatic business DB migrations or arbitrary build hook. Replay cannot repeat unknown effects blindly. |
| F3 runtime | Private admitted-workload request and typed observation protocol; approved node identity, lease/fencing, resource reservation. | Single node first, one bounded rollout at a time; no autoscaling/HA/remote shell. Persistent volumes deferred initially. |
| F4 domains/routes | Verified hostname claims, certificate references, route revision and validated activation. Preserve platform API/OIDC host separately. | Platform-owned test subdomain first after infrastructure approval. Custom domains wait for challenge/renewal/takeover tests. |
| F5 bindings | Scoped binding-reference creation/rotation/revocation and private delivery receipt. Identity/service owners provide least-privilege credentials. | No values returned through management GET/Console. No frontend bundle injection of backend secrets. |
| F6 developer operations | Scoped observed deployment status, bounded sanitized logs, release history and resource measurements where collected. | No invented CPU/RAM numbers, global host logs, unsanitized env dump or public Docker exec. |

F5 requires protected key custody/delivery before a hosted backend can consume v2.
A first runtime proof may deploy an approved stateless health image with **no**
service credentials. Do not call that proof an integrated hosted BaaS application.
An integrated demo is a later gate requiring separate enrolled app credential,
binding ACL and rotation tests.

## Routing, health, updates and rollback

Platform API/Keycloak issuer hostname stays stable. Hosted application traffic uses
a separate hostname namespace and routing configuration. Do not let a tenant
override `/identity`, platform API paths, gateway admin endpoints or certificate
storage. Reuse Nginx knowledge and validated route machinery; do not give the
control API arbitrary Nginx configuration text.

Developer chooses an allowed health path within the workload, not a probe URL.
Controller constructs the destination from approved node/instance mapping. Health
probes must not become SSRF to a host, peer app or metadata service. Registry,
provider origin, webhooks/callbacks and domain challenges use separate destination
allowlists, canonicalization, DNS/IP revalidation, redirect denial and bounded
timeouts. Existing registration validates and matches an origin but does not
connect to it; future networking must add connection-level protection.

Proposed route sequence: prepare candidate route disabled; start bounded candidate;
wait for readiness/stability; validate routing config; activate atomically or retain
last-known-good; observe revision. Public traffic is not sent to an unready new
instance. Failed update retains healthy prior route. An initial constrained host
may reject rollout if it cannot reserve old+new capacity; no zero-downtime claim.

Rollback means a new authorized deployment intent targeting a previous immutable
artifact/config reference. It does not restore application DB contents or resurrect
revoked secrets, grants, app state or expired certificates. Schema/data compatibility
is the app owner's explicit responsibility; incompatible data migration needs its
own backup/approval and cannot be hidden in a container update.

## Failure contract

All target responses below are PROPOSED acceptance obligations. Existing Foundation
failure behavior is evidenced in the catalog, not by this proposed table.

| Failure | Required safe behavior and reconciliation |
| --- | --- |
| Control Plane unavailable | Reject new intent or show unavailable; existing supervisor/ingress keep healthy workloads. No permission/config mutation from stale UI. Foundation may fail separately if shared authority/identity DB is down. |
| App crash/unhealthy | Bounded supervised restart/backoff within admitted resources; observed degraded status; keep failure history; no restart storm or transfer of volume ownership. |
| Gateway failure | Public entry fails; private apps/providers can remain alive. Preserve last-known-good route/config; recover/validate ingress. No single-host availability guarantee. |
| Backend provider failure | Foundation returns defined bounded errors; apps handle them. Do not bypass authorization, route to private services or substitute mock success. |
| Half-finished deployment | Reconcile intent/generation with actual instance and route; retain old healthy revision when possible. Unknown start/route result is observed before retry. Audit records partial outcome. |
| VPS restart | Approved host supervision starts retained infrastructure/workloads; controller reconciles before creating duplicates. Existing Compose has no explicit restart policies and does not prove this target behavior. |
| App access revoked/suspended | Existing v2 blocks subsequent access under current contract. Proposed controller denies new starts/bindings, withdraws route/stops workload per approved policy and reports convergence. No assumption Keycloak clients or in-flight work are already disabled. |
| Persistent volume lost | Fail/degrade explicitly; never silently initialize empty storage as successful recovery. Restore only owner-matched consistent data; initial hosting avoids app persistent volumes. |
| Controller loses node contact | Mark observed state unknown; fence stale generation, stop scheduling competing mutation, retain last known route only under approved health policy. No automatic cross-node duplicate start with an unfenced volume/credential. |
| Audit/secret/registry unavailable | Reject sensitive admission/delivery or hold pending without effect. Healthy running apps may continue with already delivered credentials until explicitly revoked; document that limit. |
| TLS/domain verification fails | Keep pending or previous valid ownership; no claim/route activation. Renewal failure alerts and explicit expiration behavior; stale proof cannot enable tenant takeover. |
| Backup/key recovery fails | Do not invent clean state; restrict new control effects and reconcile revocation against recovered policy before reopening access. |

## Secrets, recovery and operational costs

Secret references are public metadata; values are delivered privately to the exact
admitted app/environment/instance, preferably read-only file mounts with a narrow
mode and lifetime. Environment variables may leak to host inspection/diagnostics;
the delivery choice needs ADR 007 approval. A running trusted app can read its own
credential. This design protects against peers/browsers, not malicious code already
authorized to use that credential or a compromised infrastructure operator.

Rotation uses versioned binding states and a defined overlap window, verifies the
new credential, updates delivery/restarts only if needed, then revokes old material.
Rollback must not undo revocation. Encryption keys/unseal/recovery material are
separate operator assets, not stored alongside ciphertext in an ordinary DB row.

Backups must cover all three PostgreSQL databases/roles, app authority/shares,
SeaweedFS filer metadata+chunks, artifact/config history, route/domain state,
binding policy, secret/key recovery material and application volumes if ever
admitted. Choose consistent snapshots or quiesced writes and encrypted off-host
retention. Reconcile desired versus observed runtime and stale credentials after
restore. Current isolated structured-data restore proves only its documented
scope; RPO/RTO values and full recovery remain UNVERIFIED.

An illustrative planning envelope is a 4-vCPU/8-GiB/80-GB-SSD Linux test VPS, **not**
a measured minimum, approved purchase or capacity promise. Measure existing
Foundation+OS/backup peaks first. Admission budget is host capacity minus measured
Foundation reserve, operational headroom, rollback overlap and safety margin.
Reject requests if CPU/memory/disk/IO/PID budgets cannot fit. Java heap settings
in Compose are not container memory limits. No current measurements establish
how many apps fit. Avoid on-host source builds and index/scanner stacks initially.
Filesystem quotas/log rotation/image retention need actual host-driver enforcement;
an ordinary Docker volume label is not a disk quota.

## Approval and demonstration gates

Before enabling hosting: approve ADRs 003–007/010, pin the selected runtime adapter,
prove constrained arguments/egress/quotas, durable audit, full rollback/failure
handling and operator recovery on disposable infrastructure. Then demonstrate two
separately registered apps, one external and one hosted, using the same v2 APIs:
their own writes succeed, private peer access fails, exact read sharing works,
suspension blocks future v2 calls, and an update/failed update retains correct
identity/data boundaries. Capability publication remains an independent later demo.

## Notes

See [MAP 06](ARCHITECTURE_MAPS.md#map-06-proposed-deployment-lifecycle),
[ADRs](ARCHITECTURE_DECISIONS.md) and the [handoff](OPENCODE_IMPLEMENTATION_HANDOFF.md).
No installation command in vendor documentation is authorization to run it here.
