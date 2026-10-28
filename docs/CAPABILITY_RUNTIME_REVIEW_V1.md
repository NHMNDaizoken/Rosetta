# Capability runtime review and Application Registration v1

Current status: Application Registration, C1 Registry and bounded C2 direct grant
lifecycle are implemented. C3 is an offline bounded resolver; A1 Audit uses the
trusted-DBA model. Consumer discovery is pending increment C; human delegation and
C4 provider execution/composition remain unimplemented. See [Registry](CAPABILITY_REGISTRY.md)
and [direct Trust](CAPABILITY_DIRECT_TRUST.md), which supersede historical subset
limits below. Hosting remains proposed.

## Decisions before implementation

1. **Schema and compatibility.** Retain the closed JSON Schema 2020-12 profile in
   [the manifest draft](CAPABILITY_EXTENSIONS_V1.md#json-schema-profile). Validate
   node bounds and supported keywords before directional output-subset-input
   checking. Recursively compare type, interval, homogeneous items and closed object
   properties; integer may widen to number, never the reverse. Unknown keywords,
   missing immutable metadata or proof limits fail closed as indeterminate. The
   vectors in `contracts/examples/compatibility-cases.json` are the baseline.
   `src/capability-compatibility.mjs` implements the bounded offline proof; there is
   no resolver endpoint or registry integration. Full JSON Schema compatibility is excluded.
2. **Authentication leases.** Registration performs live OIDC introspection on every
   request and retains no token. Future execution leases are single-owner memory
   records, expiring at the earliest token/policy/deadline bound. Restart loses the
   lease and requires the original issuer/subject/client to authenticate again;
   Flowable must not substitute its administrator identity. Expiry cannot extend an
   execution deadline. HA credential recovery and unattended execution remain gated.
3. **Enrollment and SSRF.** Operator enrollment binds exact tenant, issuer, OAuth
   client, human owner and canonical HTTPS origin after verifying the client in the
   IdP and its control out of band. Enrollment is not self-service OAuth registration.
   Registration compares against that record and never contacts the origin, resolves
   DNS, follows redirects or accepts secrets. Future provider dispatch additionally
   requires an operator network allowlist, connect-time address pinning and checks
   against rebinding, loopback, link-local/metadata and private administration
   networks. Origin enrollment alone does not implement those network defenses.
4. **Retention and replay.** Application client identifiers and IDs are never reused,
   including revoked applications. POST registration has no automatic retry promise;
   duplicates return 409 and the operator/owner retrieves the existing known ID.
   Approval IDs are single-use, expire within ten minutes and bind proposal digest
   and revision. Future execution bodies have a minimum 24-hour replay window,
   followed by retained deduplication tombstones returning `result_expired`; no
   automatic tombstone purge or new dispatch. That future ledger is not implemented.
5. **Flowable.** Keep the pinned image and existing workflow contract unchanged.
   The separate private external-worker API is `/flowable-rest/external-job-api`,
   not `/flowable-rest/service`. The pinned 8.0.0 acquire request has `topic`,
   `workerId`, ISO-8601 `lockDuration`, `numberOfTasks`, `numberOfRetries` and optional
   `scopeType`. It has **no tenant filter**. Supplying `tenantId` does not isolate
   acquisition. The future worker must treat all acquired metadata as untrusted,
   match job/process/definition/tenant to a durable Core reservation before any
   provider call, and never expose engine credentials or acquisition publicly.
   An unknown job is quarantined/released without dispatch. Topic names are not
   authorization. Lock-expiry reset timing, failed-job rescheduling, crash recovery and BPMN timer/error
   behavior remain mandatory worker implementation gates; no worker is added here.

The five current adapters continue using their existing networks, stores and APIs.
Application authority uses the existing PostgreSQL/PostgREST integration, separated
from `core.records` by SQL roles, private tables and a narrowly granted RPC. No
additional service, framework, database driver or workflow engine is required.

## Restricted compatibility proof contract

The accepted profile remains the existing recursive grammar, not full JSON Schema.
Before proof, reject unsupported keywords, inconsistent bounds, undeclared required
keys, duplicate keys, invalid Unicode and excessive size/depth. Count at most 4096
schema nodes and 10000 recursive proof comparisons per request; witness generation
is capped at 100000 units (containers, scalars and string code points). Exhaustion
returns indeterminate and cannot authorize publication. The offline resolver
enforces these limits; publication authorization remains future work.

For validated producer P and consumer C:

1. Match types, allowing only integer-to-number widening. Compare inclusive numeric
   bounds or string length bounds directionally, with omitted length minima zero.
2. For arrays compare permitted length intervals. If P.maxItems is zero, there is
   no reachable element and no item-edge obligation; otherwise compare items.
3. For closed objects require every C-required key in P.required, every possible
   P property in C.properties, and recursively compare each possible property.
   A missing optional producer property cannot be assumed absent when proving
   compatibility. No projection, default injection or implicit transformation.
4. A successful structural proof returns compatible. A failed sufficient proof
   returns incompatible only with a concrete finite JSON witness that independently
   validates against P and fails C, within wire/numeric limits. Otherwise return
   indeterminate, including numeric representability/precision uncertainty. Never
   label a failed proof itself as a counterexample. Empty arrays and optional
   properties must be covered by these reachability/witness rules.

This conservative algorithm may reject a valid composition as indeterminate; it
must never claim safety by guessing. It proves structure only. Semantics, external
effects, live permissions and availability require runtime checks. The offline
resolver implements this contract; a general JSON Schema validator, registry
integration and execution-time enforcement are not included.

## Application authority and enrollment

The operator verifies each human subject through Keycloak administration (enabled
user, no service-account association), verifies tenant membership and the exact
management client used by its authenticated session, then provisions a private
principal record. Permissions are explicit tenant-scoped `applications.register`,
`applications.approve` and `trust.approve`, never inferred from reader/writer roles.
The operator separately enrolls a provider client/origin for that verified owner.
No principal or provider is enrolled automatically by migrations or startup.

Every application API call requires a current introspected token and exact
`issuer + subject + client_id + tenant` matching a live operator record. Missing
`client_id` fails closed; `azp` and headers are not substitutes. Human verification
is an operator responsibility at enrollment, not a claim inferred from a username.
Removing/disabling the principal immediately removes application API authority.
Existing GET `/v1/identity` keeps exactly its existing public representation.

Only an enrolled human with `applications.register` can create a pending application
for an enrolled client/origin owned by that subject. The server fixes tenant and
owner. Owners and independently authorized tenant administrators can read it.
A separate human with `applications.approve` AND `trust.approve` creates an
application-only decision through the existing draft `/v1/approvals` contract.
Other resource types remain unimplemented. Requester subject/app/digest/revision
must match stored application data. The same independent approver consumes the
approval with `/v1/applications/{appId}/approve` and exact If-Match. Reactivation
uses a new decision for the suspended revision. Suspend/revoke require
`applications.approve`; revocation is terminal. No ownership transfer API exists.

Application and approval mutations append a tenant audit event in the same SQL
transaction. API roles cannot edit enrollment, permissions or audit events. This
is an access-control guarantee, not cryptographic protection against database
operators. No capability/grant/delegation cascade exists yet because those stores
are not implemented; future integrations must add transactional revocation checks.

## Storage, migrations and rollback

Migration 003 is additive and transactional. Private authority tables have forced
RLS with tenant predicates; a nonlogin, non-bypass owner executes fixed SQL RPCs.
The generic `rosetta_api` role has no access to these tables or functions. Internal
Core assertions select a distinct `rosetta_app_api` role and include only verified
identity data. The private authenticator/signing key remain trusted Core credentials
and must never be issued to applications. Database superusers and Docker operators
are outside the end-user security boundary, as in the existing foundation.

Apply migrations with `docker compose run --rm data-migrate` before rebuilding Core.
No existing data is deleted. Repeat application is supported. Rollback is to the
previous Core image, retaining migration 003 and authority/audit records; do not
DROP tables or recycle identifiers. Revoke application permissions to disable
administration. Backups must include the private schema and recreate both nonlogin
roles before restore; restore tests verify tenant isolation and restricted ACLs.

## Flowable evidence and remaining execution gates

Run `node --test integration/flowable-worker.mjs` against the local stack. The
probe deploys an original, uniquely named technical BPMN fixture and cleans up only
its own deployment. It checks acquisition, lock ownership, failure acceptance,
completion and the absence of tenant-filtered acquisition. It is a contract test,
not a runtime worker. Failed probes are evidence of unresolved behavior, not proof
that a production external-worker contract is ready.

Upstream pinned sources:
[acquire/complete/fail controller](https://github.com/flowable/flowable-engine/blob/flowable-8.0.0/modules/flowable-external-job-rest/src/main/java/org/flowable/external/job/rest/service/api/acquire/ExternalWorkerAcquireJobResource.java),
[acquire request](https://github.com/flowable/flowable-engine/blob/flowable-8.0.0/modules/flowable-external-job-rest/src/main/java/org/flowable/external/job/rest/service/api/acquire/AcquireExternalWorkerJobRequest.java).
These were inspected as references; no upstream source was copied into Rosetta.

Registration is independent of external-worker scheduling and provider execution.
The remaining worker/SSRF/lease/idempotency gates block those future modules, not
this bounded control-plane registration implementation.
