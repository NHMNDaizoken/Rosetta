# Official requirements and Rosetta traceability

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

## Authority and classification

Read in full: [official problem, §§1–7](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html)
(published 2026-09-30), and [official rules and scoring](https://vfossa.vn/tin-tuc/the-le-olp-phan-mem-nguon-mo-nam-2026-760.html)
(published 2026-06-09). Section locators below identify supporting passages.
This is a concise trace index, not a substitute for the organizer's text.

Problem §3: headless Layer 1; Identity/SSO, Gateway, structured/unstructured data,
Workflow; at least one Layer-2 H/P/D/I GUI. Problem §4: four technical principles.
Problem §2: broader service taxonomy. The seven-row technology table in §4 is
illustrative, distinct from the seven Layer-1 groups in §2. Brand selection is free.
These classifications follow the [problem's own sections](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html).

## Product minimum: implementation trace

| ID / official locator | Requirement | Rosetta evidence/status | Remaining acceptance |
| --- | --- | --- | --- |
| M1 / problem §3 | Headless PaaS | VERIFIED Foundation API/providers; optional Console is a client. | Keep APIs operational without UI; no business rules in adapters. |
| M2 / problem §3 | Identity/SSO | VERIFIED bounded tests: Keycloak/Core. | Maintain PKCE/logout/denial regression; production identity controls separate. |
| M3 / problem §3 | API Gateway | VERIFIED bounded tests: Nginx/Core. | Internet deployment/TLS/admin-route exposure requires operational review. |
| M4 / problem §3 | Structured data | VERIFIED tenant/app RLS and API. | Preserve direct service denial and recovery coverage. |
| M5 / problem §3 | Unstructured data | VERIFIED bytes/ownership/version pointer behavior. | Coordinated full-store recovery and quarantine remain gaps. |
| M6 / problem §3 | Workflow | VERIFIED tenant lifecycle/ledger/history. | Avoid app-private payloads; no composition claim. |
| M7 / problem §3 | Layer-2 GUI | DEFERRED, no independent business product found. | Deliver separately; business user completes a real Core-backed scenario. Console/technical fixture is insufficient. |

## Seven broader Layer-1 groups: coverage, not seven installed products

English labels paraphrase the [problem §2 grouping](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html).
The right columns are Rosetta analysis and proposed tests, not additional official
minimum services.

| Reference group | Current coverage | Gaps / architecture placement |
| --- | --- | --- |
| Identity/security | Keycloak, token checks, authority. | MFA deployment, secrets, quarantine/signing: B/C/E candidates. No blanket complete-security claim. |
| Tenancy/edge/personalization | Nginx, tenant/app isolation. | PII service/global localization absent; Console translations do not establish reusable localization APIs. |
| Structured transactions | PostgreSQL/PostgREST, RLS. | Data history, analytical isolation, semantic reporting absent. |
| Files/records | SeaweedFS opaque objects. | Generic search, document lifecycle/template generation absent; domain records remain Layer 2. |
| Workflow/automation | Flowable checkpoint/ledger. | General jobs, script runtime, batch ingestion absent. |
| Operations/audit | CI, health, partial audit/restore. | Immutable audit, GitOps runtime, full DR/telemetry absent. |
| Communication/delivery | No shared service. | Messaging, notification/realtime candidates require contracts and consumers. |

## Four technical principles: explicit gaps

The [problem §4](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html)
requires attention to these design directions; they must not be dismissed as
optional merely because the minimum five capabilities work.

| ID / principle | Status | Rosetta response and evidence still needed |
| --- | --- | --- |
| T1 — Lifecycle/speed separation | PARTIALLY VERIFIED | Separate provider duties/history ledger exist. No OLTP→historical analytical flow/lakehouse demonstrated. Define bounded extraction/retention and noninterference evidence before claiming full alignment. |
| T2 — IT/OT convergence | UNVERIFIED | No context/sensor integration. Select a separate Layer-2 scenario/adapter contract and prove authorized event/context flow; no invented digital-twin claim. |
| T3 — Governed data flows | PARTIALLY VERIFIED | Authority metadata and workflow lineage fragments exist, not general data lineage/quality automation. Define provenance/quality and report-source trace tests. |
| T4 — Zero-trust/GitOps/quarantine | PARTIALLY VERIFIED | Live checks/RLS and CI exist. Quarantine, GitOps reconciliation and operational recovery not implemented. ADR 011 and safety slices address gaps; CI alone is not GitOps. |

These are compliance risks needing team/organizer review of expected demonstration
depth, not authority to add every reference technology. No rule mandates Rosetta
use APISIX, Vault, MinIO, Kubernetes, OpenStack or any chosen frontend framework.
Current provider selections remain unchanged.

## Source, release and presentation obligations

The following summarize [rules/scoring §§participation, schedule, criteria I–II](https://vfossa.vn/tin-tuc/the-le-olp-phan-mem-nguon-mo-nam-2026-760.html).

| ID / source locator | Obligation or scoring concern | Observed state / owner action |
| --- | --- | --- |
| R1 / mandatory gate | OSI license, openly accessible source. | Apache-2.0 LICENSE/NOTICE; public GitHub reachable. Complete bundled/transitive rights still need release audit. |
| R2 / I.1–I.2 | Used public VCS; file notices/license compatibility. | Commits/CI/SPDX present. Console lockfile/assets require complete review; syntax/header checks are narrower. |
| R3 / I.3 | Versioned release before submission; archive rules. | No tags/GitHub releases found at audit. Prepare source release only when separately authorized. |
| R4 / I.4–I.5 | Source build/configuration and dependency disclosure. | Foundation instructions/pins exist; Console image ignores lockfile and is not verified here. Clean environment reproducibility remains release gate. |
| R5 / I.6 | README, change history, issue tracking, usable docs. | README/issues/technical docs present; dedicated changelog absent. Review release-facing instructions. |
| R6 / II | Demonstration and product/community quality. | Foundation technical scenario exists; independent Layer-2 demonstration absent. |
| R7 / participation | University registration; ≤3 students/team, lecturer; ≤2 teams/school. | Team eligibility/registration UNVERIFIED; team coordinator owns evidence. |

Rules allocate 50 points to project practices and 50 to product presentation.
Their archive row explicitly includes ZIP among penalized examples; treat that
as a scoring instruction needing clarification, not a technical assertion that
ZIP is closed. A tar-based open source archive is the proposed conservative
release choice, subject to organizer confirmation. [Rules I.3](https://vfossa.vn/tin-tuc/the-le-olp-phan-mem-nguon-mo-nam-2026-760.html)
controls that review.

Problem §§5–6 specify email submission by 2026-12-06 17:00 Vietnam time,
team/supervisor/source details and rights declaration; a runnable final demo and
15-minute presentation. Internet trials are encouraged.
[Submission/presentation instructions](https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html)
remain authoritative. No email is sent or deployment authorized by this audit.

Rules schedule source review December 7–9, demonstration December 10 and awards
December 11. Their generic November problem-publication schedule differs from
the problem's September publication date; verify later announcements before
submission. [Official schedule](https://vfossa.vn/tin-tuc/the-le-olp-phan-mem-nguon-mo-nam-2026-760.html).

## Rosetta extensions and release risk

Groups A+ and B–F, application hosting, projects, Console and capability
composition are Rosetta product choices. They neither replace M7 nor convert
illustrative technology brands into required dependencies. No public VPS,
paid infrastructure, hosting feature parity or AI service is claimed.

Highest risks: missing Layer-2 product; incomplete T1–T4 demonstration; missing
versioned release/changelog; Console live/mock/auth/packaging gaps; incomplete
binary/license/security inventory; full recovery unproven. Hosting breadth can
consume the effort needed for the required demonstration. The roadmap therefore
keeps Layer-2 delivery independent of hosting and Capability Runtime.
