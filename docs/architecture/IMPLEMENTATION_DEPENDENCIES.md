# Implementation dependencies and feasibility

> Reviewed: 2026-10-28 | Branch: main | Audit baseline: `360a7dd741442a2e3dbfc0f10d45a1e387d3b697`
> Current status (2026-10-29): A1, C1, offline C3 and bounded C2 direct grants/discovery are implemented; broader backlog items require their own approval.

## Dependency register

Edges mean “must satisfy this prerequisite before enabling the dependent slice,”
not that software must run in the same process. IDs match the handoff and
[MAP 07](ARCHITECTURE_MAPS.md#map-07-dependency-and-implementation-dag).

| ID | Feature / status | Prerequisites | Feasibility and explicit stop |
| --- | --- | --- | --- |
| BASE | Current Foundation/A+ — VERIFIED bounded evidence | None | Preserve current source/contracts/providers. |
| K0 | Contract/architecture review — PROPOSED approval gate | BASE | This bundle supplies proposals; maintainer accepts only the next named slice. |
| S0 | Console truthful live mode / credential boundary — PROPOSED FIRST | BASE, K0 | Small/medium frontend/test scope; existing APIs only. Stop at live denial/mock separation, no new hosting/UI domain. |
| S0B | Console packaging and examples — PROPOSED | S0 | Separate locked-build/proxy/example verification after S0; no new Core API. |
| P1 | Project/environment metadata — PROPOSED | K0 | Medium: ADR 003, private schema/API/RLS; no controller or secrets needed. |
| P2 | Membership/app attachment/entitlements — PROPOSED | P1 | Medium/large: explicit management policy; no data-right inheritance. |
| O1 | Admission, backup and operational safety design/proof — PROPOSED | K0 | Large; measured host budgets, artifact policy, full recovery and failure harness. Deployment enablement gate, not a new public service. |
| A1 | Protected audit acceptance — IMPLEMENTED bounded evidence | K0 | Migration 005, [AUDIT.md](../AUDIT.md), `integration/audit.mjs`; application roles are untrusted, DBAs trusted. Independent export/integrity sink remains deferred. |
| B1 | Scoped binding/credential delivery — PROPOSED | P2, A1, O1 | Large; ADR 007 and IdP/secret recovery decisions. No frontend secret values. |
| D1 | Deployment intent and reconciliation metadata — PROPOSED | P2, A1 | Medium/large; durable state/outbox, fake typed worker tests before privilege. |
| R0 | Restricted runtime spike — PROPOSED | D1, O1 | Large security scope; approved disposable node and no service credential in health image. Prove quotas/egress/fencing, stop before production enablement. |
| T1 | Platform-owned app ingress — PROPOSED | R0 | Medium/large; separate API hostname, readiness gate, atomic routing/TLS/rollback. |
| T2 | Custom domain lifecycle — DEFERRED | T1 | Large operations: ownership proof, renewals, takeover/SSRF/release semantics. |
| H1 | Integrated hosted BaaS acceptance — PROPOSED | T1, B1, O1 | Two apps, common Foundation auth, failed update/restore/revocation evidence. No Capability dependency. |
| OPT | Selected B/C extension — DEFERRED | K0 | Per candidate additional prerequisites; no blanket approval or automatic new process. |
| C1 | Registry publication metadata — IMPLEMENTED, bounded | K0, A1 | Exact immutable manifests, authority and publication approval; see Registry evidence and remaining audit coverage qualification. |
| C2 | Direct Capability Trust / Discovery — IMPLEMENTED, bounded | C1, A1 | Exact backend-subject grants, independent approval, live discovery/eligibility, expiry/revocation and recovery; human delegation deferred, no provider dispatch. |
| C3 | Compatibility Resolver — OFFLINE MODULE | K0 | `src/capability-compatibility.mjs` and unit tests implement the bounded profile/witness proof; live resolution and registry integration remain future work. |
| C4 | Composition/Execution — DESIGN ONLY runtime | C1, C2, C3, A1 | Existing Flowable, tenant-safe dispatcher, SSRF, leases and provider idempotency gates; no second engine. |
| L2 | Separate Layer-2 GUI — DEFERRED implementation | BASE | Independent business product and end-to-end user journey; need not wait for hosting or capabilities. |
| REL | Competition source release/demo — DEFERRED | BASE, L2 | Eligibility/rule/release/license/clean-build/changelog gates; hosting is not a dependency. |

Complexity labels are planning judgments, not time promises. P1 metadata is lower
risk than runtime orchestration but still needs API/security approval. Integrating
Dokku/Coolify shifts runtime work into an adapter and external operations; it does
not remove Rosetta policy, provenance, recovery or identity mapping work.

## Canonical dependency edges

This machine-readable-in-Markdown edge list is the audit source for acyclicity.
MAP 07 coalesces S0/S0B into its Console node, P1/P2 into META and D1 into CONTROL for readability; the expanded
list preserves their implementation order.

```text
BASE -> K0
K0 -> S0
S0 -> S0B
K0 -> P1
P1 -> P2
K0 -> O1
K0 -> A1
P2 -> B1
A1 -> B1
O1 -> B1
P2 -> D1
A1 -> D1
D1 -> R0
O1 -> R0
R0 -> T1
T1 -> T2
T1 -> H1
B1 -> H1
O1 -> H1
K0 -> OPT
K0 -> C1
A1 -> C1
C1 -> C2
K0 -> C3
C1 -> C4
C2 -> C4
C3 -> C4
A1 -> C4
BASE -> L2
L2 -> REL
```

The list is data, not an ASCII architecture diagram. All maps are Mermaid.
No target dependency points back from hosting/Capability Runtime into BASE.
S0 hardening can proceed while P1/other ADRs are reviewed. P1 does not depend on
secret management or runtime. The C3 offline module already validates schema vectors without C1.
L2 and release compliance remain independently deliverable.

## Notes

[OpenCode handoff](OPENCODE_IMPLEMENTATION_HANDOFF.md) defines each working slice,
failure tests and approvals. If the final choice integrates an external deployment
component, replace R0's adapter implementation without silently changing its
acceptance contract or adding circular dependencies.
