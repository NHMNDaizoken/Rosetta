# Architecture decision records

> Reviewed: 2026-10-28 | Branch: main | Audit baseline: `360a7dd741442a2e3dbfc0f10d45a1e387d3b697`

## Decision status and approval

“Accepted baseline” below records existing code/contracts and prior bounded
implementation; it does not approve new services. Every target is PROPOSED until
the maintainer explicitly approves its named contract/security scope. Deferred
choices remain gates, not permission to choose silently. Rejected alternatives
are rejected within this proposed architecture, not claims of universal inferiority.
Evidence may move an ADR to accepted in a later reviewed change.

## ADR 001 — Product positioning

- Accepted baseline: headless BaaS and implemented Application Authority.
- Proposed decision: self-hosted developer cloud with external and hosted apps,
  plus optional Verifiable Capability Composition.
- Deferred: product packaging, production support/SLOs and hosted workload scale.
- Rejected alternative: replacing Capability vision with hosting, or requiring
  composition before ordinary BaaS/hosting.
- Approval evidence: maintainer product-scope review; one external/hosted contract
  scenario and independent Layer-2 plan. No implementation approval implied.

## ADR 002 — Logical Layer-1 taxonomy

- Accepted baseline: five providers plus co-located authority/resource adapters.
- Proposed decision: groups A, A+, B, C, D, E, F as in the catalog; logical ownership
  precedes process/container count. F has six modules, not six mandatory services.
- Deferred: process extraction until privilege/workload/failure evidence justifies it.
- Rejected alternative: one microservice per catalog entry or another identity DB.
- Approval evidence: module contract/ownership/dependency review; provider reuse.

## ADR 003 — Application/project/environment identity

- Accepted baseline: v2 resources owned by existing tenant/app UUID; exact backend
  enrollment; no project namespace today.
- Proposed decision: new management UUIDs; optional project attachment, at most one
  environment per registration initially. Distinct app/client/subject per isolated
  environment; multiple apps can inhabit one environment.
- Deferred: move/detach/ownership transfer and multi-environment registration.
- Rejected alternative: rewrite owner IDs, infer owner from labels, or silently
  share all resources among project members.
- Approval evidence: schema/FK/unique constraints, explicit permissions, attachment
  migration and cross-app/cross-environment denial tests. Blocks P1/P2.

## ADR 004 — Control versus Runtime Plane

- Accepted baseline: Core has no daemon socket; Console is a client.
- Proposed decision: authenticated management API persists intent; separate narrowly
  privileged controller executes typed, fenced work and reports observations.
- Deferred: exact local/remote transport, lease ownership and multi-node topology.
- Rejected alternative: browser Docker control, arbitrary shell API, control-table
  writes from workers or always-on CI as a scheduler.
- Approval evidence: threat model, command grammar, durable outbox, controller crash,
  duplicate delivery and stale-generation tests. Blocks D1/R0.

## ADR 005 — Initial hosting model/runtime selection

- Accepted baseline: local Foundation Compose only; no application runtime.
- Proposed decision: trusted digest-pinned prebuilt images on one approved host;
  compare narrow controller, Dokku and Coolify with the same acceptance contract.
  Narrow controller is the proposed bounded-spike default, not selected production software.
- Deferred: final adapter selection; hostile workloads, source builds and multi-node
  scheduler. Untrusted hosting requires stronger VM/node isolation review.
- Rejected alternative: raw arbitrary Compose/Docker input, network-only hostile
  isolation, Kubernetes/OpenStack without a demonstrated need.
- Approval evidence: pinned license/edition inventory, quotas/egress/provenance,
  resource measurements, recovery and observed-state spike. Blocks R0/R1.

## ADR 006 — Ingress/custom domains/TLS

- Accepted baseline: Nginx loopback routes; stable configured Keycloak issuer; no TLS.
- Proposed decision: separate platform/app hostname spaces, ownership verification,
  restricted route applier and last-known-good revision. Candidate is not exposed
  until healthy; custom domains follow platform-owned test routing.
- Deferred: certificate component, challenge/renewal policy and exact route protocol.
- Rejected alternative: arbitrary proxy snippets, caller Host as proof, wildcard
  tenant takeover, or changing issuer on every release.
- Approval evidence: DNS challenge/expiry/rebinding/takeover, failed config, renewals,
  route rollback and provider-admin exposure review. Blocks T1/T2.

## ADR 007 — Secrets and service bindings

- Accepted baseline: operator-owned local env credentials and exact enrollment;
  no vault/binding API. Browser backends do not receive service-client secrets.
- Proposed decision: reference-only management metadata; scoped private delivery,
  versioned rotation and separate recovery-key custody. Reuse Keycloak lifecycle.
- Deferred: secret backend (OpenBao is a candidate), mount versus environment
  delivery and overlap/revocation policy.
- Rejected alternative: plaintext generic records, frontend credential injection,
  peer-readable mounts, or decrypt key beside ciphertext as the sole protection.
- Approval evidence: license/version review, wrong-scope denial, no response/log leak,
  rotation/restart/restore and operator recovery. Blocks B1/integrated hosting.

## ADR 008 — Cross-app access

- Accepted baseline: v2 immutable owners; exact same-tenant read-only shares, ≤24 h;
  owner-only mutations and inactive owner/consumer checks.
- Proposed decision: preserve that boundary for external and hosted consumers;
  management membership and hosting location confer no data rights.
- Deferred: new write grants, federation, ownership transfer and delegated end-user
  identity; each would need a separately reviewed contract/version strategy.
- Rejected alternative: project-wide writer credentials, peer private DB access or
  treating resource shares as capability grants.
- Approval evidence: existing isolation suites remain unchanged and passing; any
  extension supplies new negative contracts/migrations before runtime changes.

## ADR 009 — Capability independence

- Accepted baseline: Foundation/OpenAPI and Application Authority; C1 Registry,
  bounded C2 direct grants/discovery and internal live eligibility; C3 offline
  compatibility proof. A1 Audit uses the trusted-DBA model. C2 approval covers
  exact same-tenant backend subjects, separate discover/invoke operations and
  independent human approval, not human delegation or provider execution.
- Proposed decision: keep Registry/Trust/Resolver/Composition optional; reuse exact
  application authority and existing Flowable. Existing profile/version/digest/
  lease/trust limits remain the starting design, not overwritten by hosting.
- Deferred: human delegation, resolver HTTP endpoints, C4 invocation/composition,
  provider transport and all associated execution/worker/network/lease gates.
- Rejected alternative: publish proposed routes as current, second workflow engine,
  or mandatory Capability registration for deploying/using BaaS.
- Approval evidence: existing [acceptance gates](../CAPABILITY_ACCEPTANCE_V1.md),
  schema vectors, tenant-safe worker/SSRF/lease/dispatch evidence. No hosting prerequisite.
  The maintainer explicitly authorized the bounded direct C2 slice starting at
  `91685326a3fa12bf8517366b8ff5ac0921cfe135`; current evidence and remaining gates
  are in [direct Trust](../CAPABILITY_DIRECT_TRUST.md). Hosting remains proposed.

## ADR 010 — Deployment/recovery semantics

- Accepted baseline: Foundation named volumes, workflow reservation/reconciliation
  and partial structured restore; no full DR or workload restart policy proof.
- Proposed decision: desired state plus observed generation, durable idempotency,
  fenced controller, safe unknown outcomes, immutable rollback intent and protected
  audit. Existing workloads survive control outage where runtime supervision allows.
- Deferred: RPO/RTO, runtime persistence, automatic recovery/stop deadlines and HA.
- Rejected alternative: exactly-once claim, automatic data-schema rollback, treating
  empty replacement volume as recovery, or deleting state on failed rollout.
- Approval evidence: control/node/VPS crash, halfway route/start, disk loss, revocation,
  backup-key restore and retry reconciliation tests. Blocks hosting enablement.

## ADR 012 - Protected audit boundary

- Accepted baseline: `app_private.audit` is the single authority audit table;
  migrations 003/004 append within the mutating transaction, and ordinary API
  roles cannot modify it. Migration 005 adds server-derived actor/tenant metadata,
  event/outcome/reason validation, best-effort secret redaction, tenant/time
  keyset reads through `core.audit_query(jsonb)`, an explicit `audit.read`
  principal permission and a `rosetta_audit_api` role with no table write access.
  Audit append failure rolls back the authority mutation. Evidence:
  [AUDIT.md](../AUDIT.md), `integration/audit.mjs`, `integration/recovery.mjs` and
  the existing application rollback test.
- Bounded threat model: application callers and ordinary tenant users are
  untrusted; PostgreSQL superusers, the database owner and a malicious host or
  operator are trusted. No cryptographic tamper evidence is claimed against a
  privileged database administrator.
- Proposed/deferred: independently controlled export or integrity sink, remote
  retention/legal hold, cryptographic sealing, key recovery, WORM storage and
  complete access/deployment audit. Each requires a separately approved contract
  and operations proof.
- Rejected alternative: a browser/session activity log, generic app JSON, a
  mutable table exposed through PostgREST, or granting `audit.read` implicitly
  through reader/writer/approver roles.
- Approval evidence for any extension: threat model, DBA/operator tamper tests,
  redaction, unavailable-sink admission behavior, retention and independent
  restore. No public audit HTTP route is approved today.

## Preserved unresolved decisions

| ADR / topic | Accepted baseline | Proposed direction / deferred choice | Rejected shortcut | Evidence required |
| --- | --- | --- | --- | --- |
| 011 — Quarantine | Objects currently publish opaque bytes immediately. | Version-bound scan before visibility; scan engine/resource/migration semantics unresolved. | Quietly making current PUT asynchronous or treating a successful upload as clean. | Reviewed API compatibility; clean/infected/unknown/timeouts/races; rollback cannot expose unscanned versions. |
| 012 — Audit integrity (residual) | Atomic authority/share audit plus the bounded A1 tenant query, role separation, redaction and fail-closed admission; DBAs trusted. | Independent export/integrity sink, remote retention and cryptographic design deferred. | Treating the protected PostgreSQL boundary as DBA tamper evidence. | Independent sink/export, retention/key recovery, DBA/operator tamper and coordinated restore tests. |
| 013 — Messaging | No public bus. | Outbox then optional durable broker when two apps need it; transport unresolved. | “Exactly once” delivery without consumer idempotency. | ACL/replay/backpressure/dedup/recovery and version/license pin. |
| 014 — Search | No shared search; PostgreSQL available. | Prefer scoped PostgreSQL proof first; additional engine/edition deferred. | Raw index access or post-revocation snippets; blanket MIT claim for mixed-license Meilisearch. | Query-time authority and stale-index deletion/share revocation tests; capacity/license evidence. |
| 015 — Workflow app scope | Tenant-scoped execution/variables, reader/writer authorization. | Keep documented limitation; app-private workflows require new boundary/version/migration. | Assume resource suspension blocks current workflow routes. | Same-tenant isolation, history/task ownership, old execution migration and legacy compatibility review. |
| 016 — Revocation/in-flight | Later v2 requests blocked; in-flight may finish; Keycloak unaffected. | Define hosting withdrawal/stop/binding rotation convergence and report uncertainty; deadlines deferred. | Promise remote cancellation, client disablement or instant erasure from app state alone. | Race tests at admission/start/route/secret stages; stale controller cannot start revoked workload. |
| 017 — Legacy migration | Separate deprecated v1 namespace/allowlist; no inferred app owner. | Operator inventories/assigns/copies through v2; retirement date deferred. | Auto-allowlist hosted apps, first-caller ownership or deleting legacy data. | Owner approvals, checksum/reference mapping, denied fallback, rollback ingress policy and retained backups. |

## Review order

S0 can be reviewed without any new management API. Approve ADR 003 before P1/P2;
approve 004/005/010 and safety/audit contracts before runtime spikes. ADR 006 gates
ingress; ADR 007 gates integrated hosted BaaS. Optional candidates 011–015 and
Capability runtime require their own approvals. No unresolved choice blocks
maintaining the current Foundation or a separately scoped Layer-2 application.
