# Capability registry

> Reviewed: 2026-10-28 | Status: IMPLEMENTED, C1 bounded slice

The C1 slice implements provider-owned capability drafts, manifest validation,
publication approval, immutable publication and terminal revocation. It does
not itself execute providers or create a public catalog. Bounded
[C2 direct Trust/discovery](CAPABILITY_DIRECT_TRUST.md) now extends its GET/list
visibility with exact grants. Human delegation and C4 invocation/composition are
unimplemented.

## Storage and roles

Migration `006-capability-registry.sql` adds `app_private.capability_versions`
and `app_private.capability_publication_approvals`. Both tables force RLS and
are not directly readable or writable by API roles. Core calls
`core.capability_command(text,jsonb)` through the dedicated
`rosetta_capability_api` role. Application approvals continue to use
`core.application_command`; `/v1/approvals` dispatches application requests
first and falls back to the capability command for `capability-version`
resources.

New principal permissions are `capabilities.write`, `capabilities.publish` and
`capabilities.approve`. `capabilities.publish` is treated as the tenant
administrator role for capability reads and mutations.

## HTTP surface

| Method | Path | Operation |
| --- | --- | --- |
| `GET` | `/v1/capabilities` | List versions visible to the caller |
| `POST` | `/v1/capabilities/{capabilityId}/versions` | Register an exact draft version |
| `GET` | `/v1/capabilities/{capabilityId}/versions/{version}` | Read one version |
| `PUT` | `/v1/capabilities/{capabilityId}/versions/{version}` | Replace a draft (`If-Match`) |
| `POST` | `/v1/capabilities/{capabilityId}/versions/{version}/validate` | Record a validation report (`If-Match`, `{}` body) |
| `POST` | `/v1/capabilities/{capabilityId}/versions/{version}/publish` | Consume an approval and publish (`If-Match`) |
| `POST` | `/v1/capabilities/{capabilityId}/versions/{version}/deprecate` | Deprecate a published version (`If-Match`) |
| `POST` | `/v1/capabilities/{capabilityId}/versions/{version}/revoke` | Terminal revocation (`If-Match`) |
| `POST` | `/v1/approvals` | Create application or capability approval |
| `GET` | `/v1/approvals/{approvalId}` | Read an approval |
| `POST` | `/v1/approvals/{approvalId}/revoke` | Revoke an approval (`If-Match`) |

Draft content changes increment the version revision and invalidate the prior
validation report and approval. Validation records a report bound to the exact
digest and revision without changing the content revision. Publication,
deprecation and revocation increment the revision. Published manifest content
is immutable; revoked versions are terminal.

## Manifest handling

`src/capability-manifest.mjs` rejects duplicate keys, invalid Unicode,
unsupported schema keywords, external references, unsafe numbers and unknown
manifest fields before hashing. Digests are RFC 8785 JCS over the complete
manifest using `sha256:` plus lowercase hex. Registration never calls the
provider.

## Authorization and approval

Registration requires `capabilities.write`, an active provider application and
an active enrollment. The manifest provider application ID must equal the
target application ID. Reads and mutations require the caller to own the
provider application or hold `capabilities.publish`.

Capability publication requires an approval by a different enrolled human with
`capabilities.approve`. The approval binds tenant, version, digest, revision,
requester, application and expiry (at most ten minutes). The provider owner,
the requester and the publishing caller cannot approve or consume their own
publication. A changed draft, expired approval, denied approval or reused
approval fails publication. Application approval behavior is unchanged.

## Audit

Registration, draft replacement, publication/deprecation/revocation and approval
changes append an audit event in the same transaction through
`app_private.audit_append`. Capability events use the internal `version_id` as
the audit resource ID because the audit table requires UUIDs; approvals use the
approval ID.

The existing C1 validation-report branch returns before its shared mutation audit
append (migration 006, source inspection). That preexisting coverage gap is not
changed by C2; publication and the new Trust lifecycle use protected transactional
appends. It requires a separately scoped correction before claiming complete
Registry mutation audit coverage.

## C2 integration

Migration 009 retains owner/`capabilities.publish` management visibility and all
C1 mutations. Consumer reads require the shared live Trust predicate for exact
`discover` authority; invoke-only grants supply no metadata visibility. Consumers
receive no private validation/approval/creator or OAuth data. Pagination filters
before limiting/counting and binds consumer cursors to tenant/app. Revoked,
expired, inactive or deprecated authority is rechecked on every request.
The original C1 management cursor format remains supported.

Migration 007 and the HTTP approval validator reject malformed capability
references before lookup with 400. Valid missing/foreign references stay 404;
application approvals and normal C1 lifecycle behavior remain intact. The known
malformed-reference failure reproduced as 503 on the starting checkpoint, then
passed the new HTTP/private-RPC negative tests after correction.

## Verification

```text
npm run check
npm test
npm run check:contracts
npm run test:contract-validator
npm run test:applications
npm run test:capabilities
```

`npm run test:capabilities` uses real Keycloak users and PKCE clients in two
tenants. It covers the full draft/validate/approve/publish/deprecate/revoke
path, duplicate versions, ETag and `If-Match` failures, self and stale
approvals, immutable publication, terminal revocation, cross-tenant
non-disclosure and registry role ACLs. Run integration suites sequentially.
