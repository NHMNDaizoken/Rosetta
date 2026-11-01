# Bounded Capability Composition (C4B)

Updated: 2026-11-01. C4B is implemented and opt-in. It uses the existing
Registry, direct Trust, C3 resolver, guarded C4A transport and Flowable engine.
It adds no scheduler, service, application business logic or dependency.

## Reproduce the real two-provider test

From a development checkout with Node 24, Docker, host OpenSSL and the pinned
Python validators installed:

```sh
npm run setup
python -m pip install -r requirements-contracts.txt
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 240
npm run test:compositions
```

The suite creates synthetic users and service accounts in two tenants. It
enrolls independent Provider A (`document.normalize`) and Provider C
(`document.validate`), and Consumer B. The capability URN suffixes are
`document-normalize` and `document-validate`, at version `1.0.0`. It publishes
through C1, independently approves each C2 invoke grant, creates/validates/
approves/publishes B's composition over HTTP and starts it over HTTP. The
private fixture Core uses actual OIDC, PostgREST/PostgreSQL and Flowable;
providers run as separate TLS containers and redeem their own tickets.
The success test checks transformed whole-value binding, one execution per
provider, single-use tickets, SQL state, result isolation and completed engine
history. The default gateway remains disabled for C4B throughout.

Fixtures create no persistent volumes and never remove existing volumes.
Synthetic authority/execution/audit records are retained as evidence; fixture
users/clients and private network/provider/Core containers are cleaned up.
Fault injection exists only in `integration/fixtures/capability-core.mjs`,
which the production image does not include. No test calls internal functions
to manufacture a successful composition execution.

## HTTP and authority

The [OpenAPI](contracts/capability-api-v1.openapi.json) defines eight registry
operations: create, add version, get, replace draft, validate, publish,
deprecate and revoke. They require OIDC and explicit tenant management
permissions. The creating enrolled backend needs `compositions.write`; this
permission is assigned explicitly by an operator, never inherited from app
registration or `core-writer`. Its verified resource binding owns the plan.
Validation and lifecycle writes require exact `If-Match`. Publication needs
`compositions.publish`, a current valid report and an independent, enabled
`compositions.approve` principal's exact unexpired approval. The app owner
and proposer cannot approve their plan. Approval create/get/revoke reuse
`/v1/approvals` with `resourceType=composition-version`.

The plan is limited to 1–16 sequential steps, exact versions/digests, complete
JSON value bindings and 100–60000 ms total deadline. SQL also requires room
for the sum of provider timeouts plus 300 ms per step. Unsupported C3 proofs,
including indeterminate results, cannot support publication. Published versions
are immutable. Only the owning consumer may execute the published plan.

`POST /v1/capability-executions` takes exactly `target` and `input`, with a UUID
`Idempotency-Key`. A composition target contains `kind=composition`,
`compositionId`, `version` and `compositionDigest`. A new durable reservation
returns 202; an identical currently authorized replay returns 200; a changed
request under the same key returns 409. Replay never starts another process
or restores a lost C4B lease. `GET /v1/capability-executions/{executionId}`
requires the original tenant, app, issuer, subject and client with current
invoke authority; output is exposed only after confirmed success.

Before every provider connection and ticket redemption, Core revalidates the
original OIDC credential and SQL checks live app/grant/version authority.
Provider origins come from operator enrollment and an exact operator allowlist.
The shared transport enforces TLS, pinned DNS/address policy, redirect denial,
size/deadline limits and strict JSON parsing. Providers use their own OIDC
credentials at `/v1/capability-authorizations/introspect`. Each ticket binds
the durable step's provider, capability/version/digest, input digest and
operation UUID; redemption is atomic and single-use. Later step input digests
bind the previous step's canonical output, not the original request input.

## Execution transition matrix

Only the private `rosetta_composition_api` RPC can request these mutations.
It has no direct table privileges. All five Composition tables use forced
tenant RLS under `rosetta_app_owner`; generic CRUD roles cannot access them.
Core alone signs internal assertions. Caller-controlled input cannot select
the database role, identity or lease proof.

| Operation | Allowed prior state | Result and required evidence |
| --- | --- | --- |
| reserve | no row | `accepted`; active owning consumer, all exact direct invoke grants, fixed input/request digests, serialized key and atomic audit |
| engine_reserve | `accepted`, no attempted start | Same state; live lease, definition ID and durable start-attempt marker before HTTP start |
| engine_bind | active, matching reserved definition | Same state; exact process correlation; no replacement of a bound process |
| prepare | `accepted`/`running` | `running`; exact current index, pending step with attempt 0, exact process/definition/capability, live lease/authority; atomic ticket, operation and audit |
| dispatch | `running` | Same state; current running step, issued ticket, no previous dispatch marker, live lease/authority; durable intent/audit before socket |
| redeem | `running` | Same state; exact provider/step/input, unused unexpired ticket, live initiating lease and authority; atomic consumption/audit |
| step_output | `running` | Current step succeeds and index advances by exactly one; consumed ticket, live lease/authority/deadline; validated output and canonical output digest; no terminal success yet |
| engine_completed | `running`, index equals count | `succeeded`; all steps succeeded and Core verified matching naturally completed Flowable history; final output/audit commit |
| step_fail | `accepted`/`running`/`auth_required` | `failed`, `timed_out`, `auth_required` or `outcome_unknown`; loss-only transition, never grants dispatch authority or resets an attempt |
| observe | active | Missing lease becomes `auth_required`; possibly dispatched unfinished step with lost lease/deadline becomes `outcome_unknown`; elapsed deadline without uncertain dispatch becomes `timed_out`; revoked live authority becomes `failed` |
| any forward mutation | terminal | Rejected; `succeeded`, `failed`, `timed_out`, `outcome_unknown` and any historical `cancelled` state cannot return to active or success |
| reauthorize / cancel / resume | any | Unsupported; no public C4B resume or cancel contract |

Failure blocks all later dispatch. Step rows preserve stable operation IDs,
attempts (at most one), ticket hashes/consumption and known outputs. Audit
failures roll back reservation, preparation/dispatch and output transactions.
Persistence uncertainty after provider receipt becomes `outcome_unknown`.
No distributed exactly-once guarantee is claimed.

## Engine correlation and recovery limits

Core generates deterministic BPMN with fixed process key
`rosetta_c4b_composition`, topic `rosetta-c4b-step` and generated step element
IDs. It verifies definition bytes, process/definition/tenant/business key,
execution ID, input digest and deadline variables. Jobs without an exact
reservation are quarantined with zero retries. Flowable's acquire endpoint
does not filter tenants; local correlation is mandatory. Engine lock ownership
is independently probed by `test:flowable-worker`.

The business key is `c4b:<tenant>:<execution UUID>`. When a start response or
binding is uncertain, Core reloads the durable start marker and queries both
runtime and history. Exactly one matching process with the correct tenant,
business key and definition may be bound. No match, multiple matches or
unavailable history leave the reservation unresolved; Core never repeats a
start blindly. Replays return the existing reservation. A restart drops all
in-memory entries and initiating credentials. Observing untouched work marks
it `auth_required` and terminates its correlated engine process where known;
observing potentially received work preserves `outcome_unknown`. There is no
authenticated C4B resume mechanism and no administrative-identity fallback.

The engine's interrupting BPMN deadline timer terminates queued processes
without Core. SQL and runtime independently forbid new work after the deadline.
Core also uses the supported process-instance DELETE operation for failure,
lost leases and expiry. A termination/reconciliation failure returns
`503 workflow_termination_unconfirmed`; counters expose engine/persistence
errors internally. Later status reads retry cleanup without changing the
durable outcome. Uncertain worker completion is never ignored or reported as
success; Core preserves an unknown outcome and blocks downstream steps.

Recovery is fail-closed and observation-driven after a restart, not an HA
scanner or automatic continuation service. Unobserved SQL rows may retain an
active label until a fresh authorized status read; the engine deadline still
applies and no worker lease exists to dispatch them. Missing/multiple engine
history requires operator investigation. The Core can retain known step
outputs while the overall result is unknown. Lost completion confirmation
may conservatively produce `outcome_unknown` even if Flowable later completes.

General side effects, human delegation, HA, automatic retries, arbitrary
provider URLs/BPMN and Layer 2 applications remain unsupported. C4B stays
disabled by default (`C4B_ENABLED` unset/false); enabling it outside isolated
testing is a separate operational decision. `C4B_PROVIDER_ORIGINS` is the
operator's JSON allowlist, never caller input.

## Migration and evidence ownership

Migration 012 is unchanged. Additive migrations 013–017 fix registry revision/
approval handling, exact ticket/step binding, durable dispatch and output
evidence, terminal transitions, success confirmation, result version and exact reserved-grant rechecks. Replacement grants cannot revive a reservation tied to a revoked grant.
Migration 013's already-applied CRLF bytes are explicitly preserved in Git;
the runner strips CRLF transaction delimiters while hashing original bytes.
Version 16 extends the recorded fingerprint to `composition_private` after
checking the earlier scope first; no drift-adoption flag is used for upgrade.
See [migration operations](MIGRATIONS.md).

`test:compositions` covers real execution, denial before dispatch, C3 proof
failure, publication/ETag authority, ticket binding/expiry/replay, independent
step revocation, engine correlation, duplicate starts, missing/multiple engine
evidence, lease loss, uncertain provider/completion outcomes, deadlines,
termination failure, transactional audit and isolated backup/restore of five
durable outcome classes. The restored database is offline, with ownership,
roles, ACLs, forced RLS, step/ticket/output identity and audit evidence compared.
This is engineering verification by the implementer, not an independent review
or a complete platform disaster-recovery certification.
