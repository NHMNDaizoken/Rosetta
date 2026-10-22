# Capability v1 acceptance and negative cases

Status: design/test specification only. Current runtime does not implement these cases. Read [manifest/lifecycle](CAPABILITY_EXTENSIONS_V1.md) and [trust/execution](CAPABILITY_TRUST_EXECUTION_V1.md), with the [OpenAPI draft](contracts/capability-api-v1.openapi.json). Structural contract validation in this task is not evidence that runtime authorization or composition works.

## Test layers and required evidence

1. Contract syntax: JSON parsing, JSON Schema 2020-12 metaschema validation, OpenAPI 3.1 validation, local reference resolution, positive fixtures, negative fixtures and example manifest digest integrity.
2. Semantic validation: relationship/ownership/namespace checks, bounded profile, directional compatibility vectors, version immutability, lifecycle and approval concurrency. No network fetch from a payload schema.
3. Authorization: real OIDC clients/users in at least two tenants; authoritative app/grant/delegation/approval state; positive and denied controls at Core and provider boundaries. Mocked identity alone is insufficient.
4. Engine/provider integration: the pinned Flowable OSS REST image, real locked external jobs, correlated technical providers with controllable effect receipts, crash/restart and forced timeout cases. No parallel scheduler in Core.
5. Existing Core regression: preserve current API/status/payload/role behavior and run the existing source, unit, integration and recovery suites.

Use synthetic technical echo/counter providers, not an application domain or GUI. Fixtures must include owners, a different administrator, permitted and forbidden consumers, a delegated human and foreign-tenant principals. Counter effects measure retry behavior only; they are test infrastructure, not a Core business feature.

## Negative and boundary matrix

| ID | Case | Required outcome |
| --- | --- | --- |
| M01 | Unknown manifest field such as `tenantId`, user-selected URL/headers or subject | 422; no draft authority/state change. |
| M02 | Provider UUID differs from capability/permission URN namespace or path ID/version | 422; never assign ownership from the body. |
| M03 | Valid manifest submitted by another provider owner | 404 for hidden resource or 403 for an otherwise visible unauthorized action; no registration. |
| M04 | `$ref` to network/file, union/format/pattern/default or any unsupported payload keyword | 422 unsupported profile; no resolver fetch. |
| M05 | Required property absent from properties; inverted bounds; unsafe integer; schema/value depth >32 | 422; no silent coercion or acceptance. |
| M06 | Duplicate JSON keys, invalid Unicode, NaN/infinity | 400 before hashing; no differing parser interpretations. |
| M07 | Body exceeds 64 KiB, including escaped JSON wire bytes | 413 before publication/dispatch; no partial side effect. |
| M08 | Timeout 0/10001, version range/latest/prerelease, more than 16 plan steps | 422. Structural fixtures cover representative cases. |
| M09 | Path traversal/encoded slash/query/fragment/absolute URL, redirect, DNS rebinding or denied destination | Registration validation denied or runtime 503 without connecting to forbidden networks. |
| O01 | Register a client already bound to another app, unproven client, inactive owner or service-account owner registration | Deny; no client takeover, secret exposure or automatic admin role. |
| O02 | Existing `core-writer` without separately assigned management authority | 403 on management operations. |
| O03 | Creator approves own app/version/grant/plan | 403, even if the creator also holds an admin assignment. |
| L01 | Publish before validation/approval; use another resource's approval | 409; no published version. |
| L02 | Mutate draft after validation/approval, race two PUTs or omit If-Match | Old validation unusable; 412 for stale ETag, 428 for missing ETag. |
| L03 | Change published path, permissions, timeout, description or schema in place | 409 immutable_version; require a new version. |
| L04 | Deprecate version pinned by an accepted run | Reject new starts/publications; accepted work may finish only while all current authority remains valid. |
| L05 | Revoke a version/app while a plan is queued/running | No further provider dispatch; in-flight effects recorded accurately. IDs cannot be recycled. |
| T01 | Discover without discover grant, invoke with discover-only grant, self-app invocation without a grant | Deny; discovery never grants execution. |
| T02 | Foreign-tenant app/capability/plan/execution/audit ID or cursor | 404 or empty filtered discovery; no foreign existence/count/context leak. |
| T03 | Spoof tenant/app/subject/permissions with headers or body | Headers confer no authority; unknown body keys rejected. |
| T04 | Bind unknown/ambiguous `client_id`, substitute `azp`, token from another issuer/audience, inactive/expired token | 401/403; no dispatch or inferred binding. |
| T05 | Source subject has permission but receiver app/subject grant does not; or permission subset is broadened | Delegation/invocation denied. No union of privileges. |
| T06 | Service account delegates a human, a delegate redelegates, wrong receiver redeems delegation, revoked/expired delegation | 403/404; no impersonation or multi-hop. |
| T07 | Approval expired/revoked/consumed by another run; input/digest/requester differs | 409/403; exact approval cannot be repurposed. |
| T08 | Revoke a grant between preflight and dispatch or between dispatch preparation and provider ticket redemption | Provider does not begin effects if revocation is observed at either enforcement point. No cache bypass. |
| C01 | Consumer requires a field only optionally produced; producer has possible extra fields | Incompatible; use a counterexample where possible. No field dropping/default injection. |
| C02 | Producer interval exceeds consumer interval; number feeds integer; array item type differs | Incompatible. Exact safe integer-to-number containment can pass. |
| C03 | Unsupported profile, unresolved digest, proof limit reached | Indeterminate/rejected; cannot publish as compatible. |
| C04 | Equal schema types but different units or business meaning | Structural compatibility does not certify semantics; provider/domain review still required. |
| C05 | Loop, forward reference, duplicate step ID, projection, script or arbitrary BPMN | 422; only reviewed whole-value linear binding is supported. |
| C06 | A manifest digest/version changes or is revoked after plan validation | No silent upgrade; invalidate/revalidate or block dispatch under lifecycle rules. |
| E01 | Start concurrent identical keys, then repeat with different input/target/delegation | One durable execution; 200 replay for identical authority/request, 409 for conflict. Recheck permissions before returning replay. |
| E02 | Crash after engine start but before saving engine ID | Reconcile unique tenant/business key; never start another engine process blindly. |
| E03 | Engine redelivers a locked job or lock expires during a provider call | Same operation key; no concurrent second mutation. Ambiguity becomes outcome_unknown if not provably deduplicated. |
| E04 | Identity, policy or durable audit-intent storage unavailable | 503 with zero provider dispatch. Healthy process liveness remains independent. |
| E05 | Core restarts or original token expires before a step | No token in Flowable/database/logs; auth_required then reauth within unchanged deadline, otherwise safe terminal/unknown outcome as appropriate. |
| E06 | Wrong principal/app attempts resume; delegated run resumed without original human proof | 403; fresh worker credentials do not replace caller authority. |
| E07 | Wrong provider, expired or reused ticket; ticket input hash/target differs | `{active:false}` or denied provider execution, no caller context/effect. Ticket consumption is atomic. |
| E08 | Non-idempotent provider commits but response is lost | outcome_unknown; effect count stays one; no automatic replay or compensation. |
| E09 | Certified idempotent provider receives job redelivery | Same key/input, at most one logical effect; unavailable result requires reconciliation. Retention must cover the advertised replay window. |
| E10 | Pure provider returns transient 503, invalid output or denied authorization | Bounded Flowable retries only for permitted transient failure; no retries for invalid output/authorization. |
| E11 | Cancellation/deadline races with a committed provider effect or late response | Do not report rollback/clean cancellation; preserve partial/unknown effect evidence. No later step dispatch. |
| E12 | Result body expired or dedup tombstone exists | 409 result_expired, not a fresh execution. |
| A01 | Audit reader is another tenant, app owner requests unrelated callers, provider error contains secrets | Deny/redact; no token, ticket or payload copied to audit/error responses. |
| A02 | Result persistence fails after provider effect | Durable reconciliation marker/unknown outcome; no unaudited blind retry. |
| I01 | Python/TypeScript serialize null vs absent, safe-number boundaries and encoded URN IDs | Identical wire meaning and digest test vectors; no string-ID normalization or coercion. |
| I02 | Unknown response field/error code, malformed cursor, automatic client retry of an unapproved POST | Tolerant response parsing, rejected cursor, no unsafe retry behavior. |

The [12 structural negative fixtures](contracts/examples/negative-cases.json) and [compatibility vectors](contracts/examples/compatibility-cases.json) are contract examples, not executed endpoint tests. Semantic/security/engine cases above remain implementation acceptance requirements. Record which layer actually ran in any handoff.

## Acceptance gates before implementation

- Maintainer reviews v1 limits: same-tenant only, closed schema profile, exact immutable versions/digests, fixed administrator approvals, one-hop delegation, 60-second maximum composition and memory-only authorization leases. Approval of this documentation task does not approve implementation or deployment.
- Security review resolves operator enrollment/bootstrap, tenant administrative assignments, OIDC client/subject verification, SSRF/TLS policy, ticket storage/redemption, restart behavior and audit retention. No current fixture account becomes a default administrator.
- Demonstrate the pinned Flowable OSS external-worker acquire/lock/fail/complete/tenant contract and review its exposure/security. Retain the existing engine and public workflow contracts. Do not select a new runtime framework, worker library or service through this document.
- Choose private registry/trust storage ownership, transactional reservation/outbox strategy, additive migrations and backup/restore evidence. No user-writable metadata table is an authorization database.
- Agree provider idempotency/receipt guarantees and the replay/tombstone retention window before enabling any mutating capability. No exactly-once external effect claim.
- Ship a complete extension contract bundle and cross-language conformance evidence before optional SDK work. No GUI/AI/SDK work is authorized here.

## Acceptance gates for a future implementation

All structural, semantic, ownership, denial, concurrency and recovery cases must pass against real services. At least two independent technical provider apps must demonstrate same-tenant composition and denied cross-tenant access. A run must show authorization changing after validation, an ambiguous mutation, restart without credential leakage, and engine-owned redelivery. Every effect must correlate to a stable invocation ID, engine job and protected audit evidence.

Run existing `npm run check`, `npm test`, `npm run test:integration` and `npm run test:recovery` on the preserved foundation, plus new contract/semantic/security/engine suites when implemented. Current extension routes must remain unavailable until approved runtime work adds them. Do not claim that validating JSON examples proves runtime enforcement.

## Reproducing contract-only validation

Use a development Python environment with `jsonschema` and `referencing`. This task used already installed tools, without changing package/runtime dependencies. From the repository root, run this Python block (for example through `python -` in a shell or an editor's Python runner):

```python
import json
from pathlib import Path
from jsonschema import Draft202012Validator, FormatChecker
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

root = Path('docs/contracts').resolve()
registry = Registry().with_resources(
    (file.as_uri(), Resource.from_contents(json.loads(file.read_text()),
                                         default_specification=DRAFT202012))
    for file in root.glob('*.json')
)

def validate(name, value, fragment=''):
    Draft202012Validator(
        {'$ref': (root / name).as_uri() + fragment}, registry=registry,
        format_checker=FormatChecker()).validate(value)

for name in ['capability-manifest-v1.schema.json', 'composition-v1.schema.json']:
    Draft202012Validator.check_schema(json.loads((root / name).read_text()))
for name in ['capability-manifest.json', 'capability-manifest-second.json']:
    validate('capability-manifest-v1.schema.json',
             json.loads((root / 'examples' / name).read_text()))
validate('composition-v1.schema.json',
         json.loads((root / 'examples/composition.json').read_text()))
for case in json.loads((root / 'examples/api-examples.json').read_text()).values():
    validate('capability-api-v1.openapi.json', case['value'],
             '#/components/schemas/' + case['schema'])
print('Positive contract examples validated; semantic/runtime gates remain pending')
```

Use the same validators to assert that each structural negative fixture raises `jsonschema.ValidationError`. Validate OpenAPI itself against the [official OpenAPI 3.1 schema](https://spec.openapis.org/oas/3.1/schema/2022-10-07), resolving only approved local contract files for example validation. The official schema may be fetched into memory for this check; payload manifests never gain permission to fetch references. Do not copy a remote schema into the project without recording its provenance/terms. Compatibility-vector witnesses must validate as producer outputs and fail the consumer schema where an incompatible witness is provided. General resolver/JCS conformance is a separate future implementation gate.

Contract-bundle validation in this task runs separately from the existing foundation CI. That workflow still verifies only the working foundation; it does not execute a future resolver, trust service or composition runtime. Adding automated extension-contract checks to CI is a subsequent reviewed workflow change, outside this documentation-only task.
