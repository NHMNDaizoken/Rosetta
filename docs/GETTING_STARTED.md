# Start Rosetta locally

This is the application developer's entry point. You need Git, Node 24 and Docker
Desktop using Linux containers. No server, domain or public TLS is needed.
Windows PowerShell and Docker Desktop are exercised by the local release checks;
Ubuntu 24.04 is exercised by CI. Other host platforms are not verified here.

## Install, start, inspect and stop

Run these commands from the repository root in PowerShell or a shell:

```sh
git clone https://github.com/NHMNDaizoken/Rosetta.git
cd Rosetta
npm run setup
npm run doctor
npm run local:up
npm run healthcheck
```

Setup generates twelve independent 256-bit secrets from the committed environment
template. It refuses to overwrite an existing `.env`. Preserve that file and the
database volumes; editing a password does not rotate an existing database account
or Keycloak realm. On Windows, keep the repository on a private user account and
check its filesystem permissions; Unix mode 0600 is not a Windows ACL guarantee.

Before startup, doctor reports available ports and stopped services. After startup,
it reports Gateway and Console readiness. It prints configuration key names, never
their secret values. Optional Python/OpenSSL diagnostics concern integration tests,
not the ordinary installation. C4A/C4B should both report disabled.

`local:up` builds Core and Console, starts their dependencies, applies migrations
and waits up to 300 seconds. `healthcheck` reads `.env` and requires both process
liveness and configured Foundation readiness. Expected final probe output:

```text
Gateway liveness and configured Foundation readiness passed
```

Open [Rosetta Console](http://127.0.0.1:3000/#/getting-started). The API origin is
`http://127.0.0.1:8080`. The Console starts in synthetic PREVIEW mode; LIVE requires
a valid token and shows missing/rejected credentials explicitly. Its browser token
is memory-only. Never paste a confidential OAuth client secret into the Console.
The API Explorer lists Foundation operations; Capability administration uses its
separate documented HTTP contract, not invented Console controls.

```sh
npm run local:status
npm run local:down
```

Stopping preserves named database/object volumes. Do not use `down -v`, volume
pruning or migration adoption flags to fix startup errors. For process-only native
development (`npm start` without providers), use `node scripts/check-health.mjs`;
the full-stack `npm run healthcheck` deliberately also requires `/ready`.

## Operator tasks: issue and enroll application credentials

The generated `tenant-a`, `tenant-b` and `reader` clients are synthetic identity
fixtures. They prove Foundation authentication; they are **not** active enrolled
applications and cannot access app-private v2 resources. `core-writer` does not
confer application administration, enrollment or approval authority.

A trusted local operator must perform the existing reviewed flow:

1. Create a confidential Keycloak backend client and service account. Verify the
   enabled client, exact issuer, tenant attribute and administrator-owned tenant
   group membership by reading them back through authenticated administration.
2. Verify separate human owner and approver identities and their management
   clients. Enroll the owner and independent approver with only the permissions
   needed, using the SQL in [Application Registration](APPLICATION_REGISTRATION.md#operator-enrollment).
3. Enroll the exact OAuth client, owner and canonical HTTPS provider origin. Bind
   `resource_subject` to the verified service-account user ID using
   [resource enrollment](RESOURCE_AUTHORIZATION.md). Never infer it from a username
   or accept a tenant/owner override from an application.
4. The human owner POSTs `/v1/applications`. The separate approver creates a digest-
   and revision-bound application approval at `/v1/approvals`, then POSTs
   `/v1/applications/{appId}/approve` with that approval and exact `If-Match`.
   Follow the [complete API flow](APPLICATION_REGISTRATION.md#api-flow).
5. Hand the application developer its own client ID and secret through a private
   channel. Keep operator/database credentials out of the application. Record the
   operator change. No default administrator or self-service enrollment is added.

Use human authorization-code + PKCE for management and independent approval.
Backend client-credentials tokens authenticate only their enrolled service account.
Core verifies issuer, live token activity, tenant/group/roles and exact client/subject
binding server-side. Ownership and grants are rechecked by private SQL authority.

The existing `npm run test:applications` is an operator-only executable rehearsal:
it creates its own synthetic users/clients, performs real PKCE approval, runs the
record/object/workflow/share example and removes its own identity fixtures. Run it
only on a disposable development stack. It does not return reusable privileged
credentials or grant self-service enrollment to normal applications.

## Optional Capability demonstration

Install development-only validators and ensure host OpenSSL is available:

```sh
python -m pip install -r requirements-contracts.txt
npm run test:capabilities
npm run test:compositions
```

These are operator-run demonstrations/regression suites, not normal app setup.
Run them sequentially on a disposable local stack. They create synthetic authority,
independent humans, two private technical providers and a consumer. Real HTTP/OIDC,
PostgreSQL and Flowable prove registration, manifest publication, independent
approval, exact grants, discovery, invocation, ordered composition and revocation.
Private fixture Core instances opt in; the ordinary Gateway retains C4A/C4B disabled.
The suites retain synthetic SQL/audit evidence and clean their own identity/container
fixtures. They need operator fixture credentials; never run them on real user data.

For your own provider integration, read the ordered HTTP recipe in
[Capability Registry](CAPABILITY_REGISTRY.md), [Direct Trust](CAPABILITY_DIRECT_TRUST.md),
[guarded invocation](CAPABILITY_EXECUTION.md) and [bounded composition](CAPABILITY_COMPOSITION.md).
The [Capability OpenAPI](contracts/capability-api-v1.openapi.json) is authoritative
for exact request bodies, independent permissions, ETags and supported states.

## Troubleshooting

| Symptom | Next action |
| --- | --- |
| Docker Linux engine unavailable | Start Docker Desktop, select Linux containers, rerun doctor. |
| `.env already exists` | Keep it; compare key names with `.env.example`. Do not rerun setup over it. |
| Port occupied / wrong service | Run `local:status`; stop the conflicting project or choose distinct ports before a fresh install. |
| 401 | Check issuer, expiry, enabled OAuth client and credentials; never retry a write blindly. |
| 403 / `verified_client_required` | Ask the operator to verify enrollment, service-account subject and explicit permission. |
| 404 on app-private data or capability | Confirm current ownership/grants; concealed foreign resources also return 404. |
| 412 / 428 | Read the current resource and send its exact ETag as `If-Match`. |
| 409 idempotency conflict | Reuse the original request with its original key, or deliberately create new work with a new key. |
| 503 / not ready | Run doctor and `local:status`; inspect only the failing service's logs privately. |
| Migration checksum/drift refusal | Preserve data; follow [migration diagnostics](MIGRATIONS.md). Never edit applied SQL. |
| C4 endpoint 404 | Execution is opt-in and disabled by default; use private test fixtures or a reviewed operator configuration. |
| `auth_required` / `outcome_unknown` | Stop polling as active work; inspect the documented recovery limits. Do not resubmit external effects. |

Resolved Compose configuration and provider logs can contain secrets. Review them
locally before sharing. See [operations](OPERATIONS.md), [upgrade/release guide](RELEASE.md)
and [security review](SECURITY_REVIEW.md) for the remaining operational limits.
