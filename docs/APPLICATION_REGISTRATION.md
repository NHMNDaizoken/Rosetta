# Application Registration operations

This is the implemented control-plane subset of the
[capability OpenAPI](contracts/capability-api-v1.openapi.json). Registry, resolver,
composition and provider invocation remain unimplemented. Existing Core APIs do
not change. Use a local/test stack; no production deployment is authorized.

## Apply and verify

```sh
npm run check
npm test
docker compose config --quiet
docker compose run --rm data-migrate
docker compose up --build --detach --wait --wait-timeout 240
npm run test:integration
npm run test:applications
npm run test:flowable-worker
npm run test:recovery
```

Run these integration suites **sequentially**: they exercise actual dependency
restarts. Migration 003 is transactional and repeatable. No new dependency/image
is introduced. Existing persistent volumes must be retained. Rollback uses the
previous Core image while retaining authority/audit tables; do not drop tables.

## Operator enrollment

For backend resource access, also follow [resource enrollment and migration](RESOURCE_AUTHORIZATION.md).
Migration 004 adds an optional `resource_subject`; existing enrollment remains
valid for registration but grants no v2 resource rights until the operator binds
the verified Keycloak service-account user ID. Registration/approval request and
response models stay unchanged. App suspension/revocation now also blocks v2
resources, including reads through shares; it still does not disable OAuth clients.

No app administrator is bootstrapped by default. A baseline reader/writer token
returns 403 at the application boundary. Only a trusted database/identity operator
can provision enrollment and human permissions. Do not expose PostgREST or SQL
credentials to applications. The default local realm fixture is not a production
provisioning process.

Before provisioning, verify using authenticated Keycloak administration:

- Exact realm issuer and client ID; client is enabled and controlled by the
  intended provider. Review TLS origin ownership and network destinations out of
  band. Register only canonical HTTPS origins with no path, query or credentials.
- Exact human user subject, enabled, with no `serviceAccountClientId`; current
  tenant attribute AND administrator-owned tenant group membership. Do not infer
  human status from username/email or a caller's token field.
- Exact enabled management client used for human authorization-code + PKCE login.
  Subject, tenant and `client_id` are checked again from live introspection at the
  Core boundary. Configure tenant attributes as administrator-managed in Keycloak's
  user profile before provisioning new users. The pinned Keycloak default profile
  discards undeclared attributes on admin user creation; do not assume a submitted
  attribute was saved. Read back both user and group records and test the actual
  session against GET /v1/identity before granting application permissions.
- Separate human approver, same tenant, with administration permissions. A provider
  service-account credential never substitutes for this enrollment.

Execute reviewed SQL through the trusted database administration channel, with
real verified values substituted. The placeholders below are deliberately not
working enrollment. Keep any private deployment configuration outside Git.

```sql
BEGIN;
INSERT INTO app_private.principals
  (tenant_id,issuer,subject,management_client,permissions)
VALUES
  ('VERIFIED_TENANT','EXACT_ISSUER','VERIFIED_OWNER_SUBJECT','VERIFIED_MANAGEMENT_CLIENT',
   ARRAY['applications.register']);
INSERT INTO app_private.principals
  (tenant_id,issuer,subject,management_client,permissions)
VALUES
  ('VERIFIED_TENANT','EXACT_ISSUER','DIFFERENT_HUMAN_SUBJECT','VERIFIED_MANAGEMENT_CLIENT',
   ARRAY['applications.approve','trust.approve']);
INSERT INTO app_private.enrollments
  (tenant_id,issuer,oauth_client_id,owner_subject,provider_origin)
VALUES
  ('VERIFIED_TENANT','EXACT_ISSUER','VERIFIED_PROVIDER_CLIENT','VERIFIED_OWNER_SUBJECT',
   'https://verified-provider.example.invalid');
COMMIT;
```

Review and record operator changes through the operator's audit/change process.
To revoke API administration immediately, set the corresponding principal's
`enabled=false`. Disable an enrollment to block new registration/activation.
Suspending/revoking an application does not disable its OAuth client or change
its existing generic Core record access. There are no capability grants yet.
Owner transfer is not exposed; do not directly edit active ownership records as
a substitute for a reviewed, audited ownership migration.

## API flow

1. Owner POST `/v1/applications` with only `displayName`, `oauthClientId`,
   `providerOrigin`. Core returns 201 pending, Location, ETag, server appId,
   tenant, owner, revision and proposal digest. Exact enrollment matching is
   mandatory. Duplicate client binding returns 409 even after revocation.
2. Independent administrator GET `/v1/applications/{appId}` and reviews the
   server digest/revision. POST `/v1/approvals` with `resourceType: application`,
   resourceId and requesterAppId both set to that appId, requesterSubject set to
   its stored owner, matching resourceDigest/resourceRevision, decision
   approve/deny and expiresAt (UTC Z, future, at most ten minutes away).
3. The same independent administrator POST
   `/v1/applications/{appId}/approve` with `{approvalId}` and exact If-Match.
   Activation checks enrollment and enabled owner again, consumes approval and
   records audit atomically. Denied, stale, expired, revoked or consumed decisions
   cannot activate. No automatic POST retry is promised.
4. Administrator POST `/v1/applications/{appId}/state` with `action` suspend,
   reactivate or revoke, and `reason`. Use exact If-Match each time. Reactivate
   additionally requires a new approvalId for that suspended revision. Other
   actions reject approvalId. Revocation is terminal; no physical delete endpoint.
5. GET `/v1/approvals/{approvalId}` is visible to its app owner/administrator.
   The deciding administrator may revoke an unconsumed approval with POST
   `/v1/approvals/{approvalId}/revoke`, reason and If-Match. This does not retroactively
   undo a consumed registration approval; suspend/revoke the application instead.

Owners/authorized admins see only their tenant's applications. Foreign resources
and unauthorized same-tenant ownership reads return 404. Unenrolled principals
return 403; invalid authentication returns 401. Missing/stale If-Match returns
428/412. Invalid state transitions return 409. Core errors include `error` and
`requestId`; gateway authentication errors preserve the existing representation.
No tenant, owner, permission or status overrides are accepted in request bodies.
Application request objects reject duplicates, unknown fields, nested objects,
invalid Unicode and bodies over 64 KiB. This flat request parser is intentionally
not a manifest/payload-schema validator.

Application proposal digest is RFC 8785 JCS for the defined object/string-only
domain, including owner and tenant; no general number canonicalizer is claimed.
State transitions change revision, not proposal contents. ETag is opaque to clients.
Persisted audit rows record successful mutations and approvals in their transaction,
without tokens or full payloads. There is no public audit API in this increment.

## Verification and remaining scope

`test:applications` provisions unique technical users/clients through Keycloak's
admin API, uses real authorization-code + PKCE, enrolls only those fixtures and
removes only its own fixtures. Test management clients use administrator-fixed
tenant claims plus verified group membership, avoiding changes to the existing
realm profile. The suite checks service-boundary denial, spoofing, duplicates,
independent approvals, concurrency, SQL ACL/RLS, lifecycle and actual database/Core
restart persistence. The isolated restore test covers the private schema as well.

Future modules must implement connect-time SSRF enforcement, external-worker
reservation/tenant binding, leases, replay tombstones and revocation propagation
before any provider invocation. See [the design review](CAPABILITY_RUNTIME_REVIEW_V1.md)
for the actual pinned Flowable API and remaining execution gates.
