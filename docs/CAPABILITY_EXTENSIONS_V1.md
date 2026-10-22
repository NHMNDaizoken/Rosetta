# Capability-Driven Layer-1 extensions v1

Implementation update: [runtime review and application subset](CAPABILITY_RUNTIME_REVIEW_V1.md) supersedes the original design-only status for Application Registration and application-only approvals. All other extension runtimes remain unimplemented.

Status: **design draft for review; no extension runtime is implemented**. MUST/SHOULD describe the proposed v1 contract, not current server behavior. This task authorizes specification only. Existing [Core APIs](CORE_API.md), claims, migrations, images and tests retain their behavior; every new endpoint below is unimplemented and MUST NOT be advertised as available. This design follows the [project vision](PROJECT_VISION.md) and [architecture boundaries](ARCHITECTURE.md).

## Contract artifacts and reading order

- This document: manifest, registration, ownership, lifecycle and compatibility.
- [Trust and execution](CAPABILITY_TRUST_EXECUTION_V1.md): caller context, delegation, approvals, Flowable binding, failure and audit rules, sequence diagrams.
- [Acceptance criteria](CAPABILITY_ACCEPTANCE_V1.md): negative cases, implementation gates and evidence requirements.
- [Manifest JSON Schema](contracts/capability-manifest-v1.schema.json), [composition JSON Schema](contracts/composition-v1.schema.json) and [OpenAPI draft](contracts/capability-api-v1.openapi.json).
- [Manifest example](contracts/examples/capability-manifest.json), [composition example](contracts/examples/composition.json), [API examples](contracts/examples/api-examples.json) and [structural negative cases](contracts/examples/negative-cases.json).

The JSON artifacts define structural wire validation. The prose adds mandatory relational, authorization, state and compatibility checks that JSON Schema cannot express. Passing a schema is not authorization or publication approval. No SDK, GUI, AI planner, business module, second workflow engine or deployment is part of this change.

## Proposed decisions and limits

| Decision | v1 rule | Reason and future boundary |
| --- | --- | --- |
| Tenant scope | Every app, version, grant, approval, plan, invocation and audit record belongs to exactly one verified tenant. Cross-tenant discovery/invocation/delegation is denied. | Avoid implicit federation; a future federation protocol requires separate review. |
| Identity | Reuse the existing OIDC issuer/audience and baseline `core-reader`/`core-writer` checks; add server-owned app/principal bindings and explicit platform permissions. | These bindings/permissions do not exist yet; neither a tenant header nor `core-writer` creates administrative authority. |
| Versions | Exact `major.minor.patch`, with no range, `latest`, prerelease or build suffix. Published manifests/plans are immutable and digest-pinned. | SemVer is a publisher label, not proof of compatibility. |
| Invocation | Synchronous JSON POST to a path on an operator-enrolled provider origin. Maximum provider attempt 10 seconds; Core accepts work asynchronously. | No caller-selected URL, redirects, callback, script, arbitrary headers or binary capability transport. Existing object APIs remain usable separately. |
| Composition | At most 16 ordered steps; whole input/output values only, no branches, loops, field expressions or implicit converters. | This is a bounded representation compiled to Flowable, not an independent scheduler. |
| Authorization continuity | Raw caller tokens remain only in a bounded Core memory lease, outside Flowable. Lost/expired leases require reauthentication. | Availability is deliberately limited; durable encrypted credential storage and unattended execution are separate design work. |
| Preconditions | Fixed platform predicates and separately enforced provider domain rules. | Do not execute application policy expressions in Core. |

Implementation approval must cover these choices, the trust threat model, provider enrollment, worker integration and credential-lease behavior before code is added. Registry schemas must not be stored in the existing user-writable generic `core.records` namespace as an authority shortcut.

## Capability Manifest v1

A manifest is an immutable, provider-owned description of one capability version. The server derives tenant and owner from authoritative registration; clients cannot submit `tenantId`, owner identities, grants or publication state in a manifest.

| Field | Required definition |
| --- | --- |
| `manifestVersion` | Literal `1.0`, identifying this document format. |
| `capabilityId` | `urn:rosetta:capability:{providerAppId}:{slug}`. Slug matches `[a-z][a-z0-9-]{0,62}`. Stable across versions and never recycled. |
| `providerAppId` | Server-issued lowercase UUID of an active application in the authenticated tenant. UUID segment in `capabilityId` MUST match it. Ownership is checked in the registry, not inferred from the string alone. |
| `version` | Exact SemVer triple of bounded nonnegative integers without leading zeroes. Uniqueness key is tenant + capability ID + version. |
| `title`, `description` | Bounded display metadata, never an authorization source. Descriptions do not authorize a planner or caller. |
| `inputSchema`, `outputSchema` | JSON Schema 2020-12 assertions restricted to the profile below. No external resolution or executable schema keywords. |
| `invocation` | `protocol: http-json`, `method: POST`, a relative `path` on the registered origin, and `mediaType: application/json`. Provider origin, credentials, URLs and headers are absent. |
| `requiredPermissions` | Explicit nonempty set of provider-owned permission URNs: `urn:rosetta:permission:{providerAppId}:{slug}`. All are required, not alternatives. |
| `sideEffects` | `kind: none`, `idempotent` or `non-idempotent`, plus a bounded factual description. `idempotency: provider-key` is required for idempotent effects; `none` otherwise. Registration does not prove provider compliance. |
| `timeoutMs` | Integer 100..10000, including provider connection/read time and authorization-ticket redemption. No timeout is extended by a retry. |
| `preconditions` | `approval: none` or `tenant-admin`, and platform predicates from `caller-active`, `provider-active`, `grant-active`, `same-tenant`. v1 requires all four. Providers enforce domain/resource predicates inside Layer 2. |

Top-level extension fields and unknown nested fields are rejected. Manifests, inputs and outputs are limited to 64 KiB UTF-8 JSON, maximum nesting depth 32, at most 64 object properties at each schema node and 1000 array entries. Duplicate JSON keys, nonfinite numbers, invalid Unicode and values outside the interoperable numeric profile are rejected before canonicalization. These size/depth/numeric rules require semantic validation beyond the structural schema.

`path` is a literal absolute path beginning `/`, using ASCII letters, digits, `_`, `-` and `/`. No `//`, dot segment, backslash, percent escape, query, fragment or template substitution is accepted. The server joins the path to the enrolled origin; it never follows redirects. Origin enrollment and every DNS resolution/connection must enforce the platform network allowlist, including protections against DNS rebinding, metadata access and reaching internal database/engine/admin networks. A tenant administrator cannot override the operator's network restrictions.

### JSON Schema profile

The machine-readable grammar intentionally accepts a subset of JSON Schema 2020-12:

| Type | Supported assertions |
| --- | --- |
| object | `type`, `properties`, `required`, `additionalProperties: false`; every required key must be declared. |
| array | `type`, one homogeneous `items` schema, `minItems`, `maxItems` (required, at most 1000). |
| string | `type`, `minLength`, required `maxLength` (at most 65536). |
| integer | `type`, required inclusive `minimum`/`maximum`, within -(2^53-1)..2^53-1. |
| number | `type`, required finite inclusive `minimum`/`maximum`; IEEE-754 binary64 interoperable JSON values. Use strings for exact decimals or larger integers. |
| boolean / null | `type` only. |

Payload property names use `[A-Za-z][A-Za-z0-9_]{0,63}`. Numeric schema bounds are limited to +/-1e100 for `number`; safe-integer bounds apply to `integer`. Version components are at most nine decimal digits. Invocation paths contain at least one nonempty segment and no trailing slash. `description` is allowed as an annotation on any node. Defaults, coercion, nullable type arrays, `format`, regex/pattern, enums, references, `$defs`, unions, conditionals and all unlisted keywords are outside v1 and rejected. The profile does not fetch schemas over a network. Payload schema nodes omit `$schema`; the dialect is fixed by the manifest contract. `minimum <= maximum`, consistent length/item bounds, unique required names and type-correct assertions are additional validation requirements. Empty object schemas are permitted; a boolean JSON Schema is not a payload-schema node in this profile.

This profile is a design choice for deterministic checking and consistent Python/TypeScript behavior. Full JSON Schema support is not implied. New assertion keywords require a versioned profile and resolver conformance tests, not silent acceptance.

### Hashes and immutability

A manifest digest is `sha256:` plus lowercase SHA-256 hex over RFC 8785 JCS bytes of the complete manifest, including annotations. Reject malformed I-JSON input before hashing; object key order is irrelevant, array order is retained. This is a proposed extension hash format. Existing workflow input hashing is unchanged and MUST NOT be relabeled as JCS.

Changes after publication, including invocation path, timeout, permissions, side effects or descriptions, require a new version. Replacing an app owner or revoking an app does not transfer an identifier to another provider. Capability version digests are retained as tombstones after revocation; a revoked version cannot be republished.

## Application registration and ownership

An operator first enrolls an OIDC client, its exact issuer, service-account subject (where relevant), permitted TLS provider origin and allowed network destinations. This does not change the current realm import or enable dynamic client registration. Credentials are provisioned privately; registration API requests never contain a client secret.

`POST /v1/applications` accepts `displayName`, `oauthClientId` and `providerOrigin`. The server records the authenticated creator's `(issuer, subject)` as proposed owner and tenant from verified claims, allocates `appId`, and returns `pending`. Creating requires the separately provisioned tenant permission `applications.register`. A service-account principal cannot create or approve application ownership. Platform permissions are server-owned tenant records; no new authority is inferred from current realm roles.

A different authorized tenant administrator approves registration after verifying enrollment, OAuth client control and ownership. Only then is the app `active`, with the registered owner membership. `(tenant, issuer, oauthClientId)` binds to exactly one app. Binding/rebinding cannot be requested by a manifest or ordinary invocation. App owners can submit versions for their app; they cannot approve their own publication, grant consumers access or alter issuer/tenant bindings. Owner replacement is an operator-mediated, audited administrative action requiring the old/new memberships to be reviewed; v1 has no self-service ownership transfer endpoint.

App states are `pending -> active -> suspended -> active`, or `pending/active/suspended -> revoked`. Reapproval of suspension requires a fresh administrative decision. Revocation is terminal. Suspension blocks publication and new/runtime dispatch; revocation also revokes dependent grants/delegations and capability versions. Audit/history remain tenant-access-controlled. Physical deletion, app ID recycling and automatic transfer are excluded.

## Capability lifecycle and approvals

| Action | Preconditions | Result |
| --- | --- | --- |
| Register | Active app, owner membership, `capabilities.write`, correct provider/permission namespace; absent version. | Draft version with revision/ETag. Drafts are owner/admin visible only. |
| Update draft | Same owner; matching `If-Match`; version not published. | New revision; previous validation/approval invalidated. |
| Validate | Structural grammar, bounds/IDs, ownership, origin enrollment and policy checks pass. | `valid` report tied to exact manifest digest/revision; no publication or execution authority. |
| Publish | Exact validated digest, fresh tenant-admin approval by someone other than proposer, active app and required permissions registered by admin. | Immutable `published` version and audit event. |
| Discover | Active app/caller, explicit `discover` grant for the exact version, current tenant and visibility checks. | Only authorized published versions. No broad public or cross-tenant catalog. |
| Version | New exact version under the same stable ID and provider owner. | New independent draft/approval/grants; no automatic grant inheritance or version substitution. |
| Deprecate | Owner/admin, published version and matching revision. | Excluded from new discovery/validation/start. Already accepted executions may finish until revocation, subject to runtime checks. |
| Revoke | Owner or tenant admin, reason and matching revision; no approval required to reduce authority. | Terminal tombstone; prevent new dispatch and block remaining steps even in already accepted plans. |

A publisher cannot choose an arbitrary lifecycle state in a manifest. Action endpoints implement transitions transactionally. Draft replacement uses PUT, not partial JSON Merge Patch. A write without `If-Match` where required returns `428`; stale ETag returns `412`. Publishing approval is scoped to tenant, action, resource, digest and revision, with expiry. Approval is consumed atomically with the approved mutation. A state change after approval returns `409 approval_stale`; it never silently approves a changed version.

Application registration, capability publication, composition publication and cross-app grant activation require a separate human tenant administrator's approval, excluding the proposer and the owning app's owner. Invocation approval is additionally required when a manifest requests `tenant-admin`, including for already trusted callers; it is bound to the exact plan/direct-invocation digest and JCS input digest. v1 offers no rule language for selecting approvers from business data. Business approvals remain provider application logic or application workflows, not a generic Core business policy.

## Compatibility rules

The question is directional: does every value allowed by producer output satisfy consumer input? Validation returns `compatible`, `incompatible` or `indeterminate`, with JSON Pointer locations and reason codes. Only `compatible` structural edges can pass composition publication. This status says nothing about current permissions; execution always reauthorizes.

- Types must match, except producer `integer` may feed consumer `number` if its numeric interval is contained. `number -> integer` is rejected. No string/number coercion or implicit nullability.
- Producer numeric, string-length and array-length intervals must be subsets of consumer intervals; absent lower length bounds mean zero. Compare arrays recursively at `items`.
- For objects, every consumer required property must be producer-required. Every possible producer property must be declared by the closed consumer. For each possible property, recursively compare schemas. Both schemas are closed; optional producer fields still count as possible fields.
- Do not drop extra properties, inject defaults, unwrap envelopes, extract a field or convert units automatically. Such changes require a separately reviewed explicit capability in Layer 2.
- Reject cycles, forward references and all non-whole-value bindings under this profile. A plan's declared input schema must be assignable to its first step input; every step output must be assignable to the next input; last output must fit the declared plan output.
- Missing metadata, unresolved immutable versions/digests, unsupported schema profile or proof-limit exhaustion produces `indeterminate`, never success. Invalid/unsupported new manifests are rejected before publication. A mismatch with a concrete counterexample produces `incompatible`.

Equal types do not prove units, consent, business meaning, privacy, availability or lack of side effects. Provider-declared postconditions are validated against actual outputs, not assumed from static checks. SemVer compatibility is assessed separately by directional checks; broader inputs and narrower outputs may preserve a consumer contract, but permission/effect/timeout changes require review even if schemas still fit.

## Standards and interpretation

Use [JSON Schema 2020-12](https://json-schema.org/draft/2020-12/json-schema-core) with the restricted profile above and [JCS RFC 8785](https://www.rfc-editor.org/rfc/rfc8785) for proposed digests. These references define syntax/canonicalization; ownership, trust, state and approval rules are Rosetta design decisions. No upstream schema/source text is copied, and no dependency or image is added by this specification.
