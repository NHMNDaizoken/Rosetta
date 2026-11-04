# Layer 1 implementation status

Updated: 2026-11-02 | Branch: main | Program: local stabilization and release preparation

Starting local/remote SHA: `2cdcb6a6f9d80547e9b6effb585489f703158146`, clean tree.
Its [exact-SHA Actions](https://github.com/vku2-open-source-2026/junctura-dxos/actions/runs/41322854152)
was independently verified successful. Earlier implementation evidence is preserved
in the [historical engineering handoff](ENGINEERING_HISTORY.md).

## Current assessment

Five headless Foundation capabilities, Application Authority, private v2 resources,
protected Audit, C1/C2, offline C3 and opt-in bounded C4A/C4B are implemented.
Layer 2, hosting, production deployment, human delegation, arbitrary DAG/loops,
general side effects, retries, HA credentials and unsupported resume remain outside scope.
Both execution flags remain disabled on the normal Gateway.

Local functional implementation, setup, SDK and source packaging work is complete.
Overall program result: **PARTIAL / RELEASE SECURITY BLOCKED**, because the requested
security acceptance cannot be claimed. **The overall release security gate is open:**
container scans found unresolved critical/high advisories, and container SPDX license
metadata does not clear binary redistribution. See the [security review](../SECURITY_REVIEW.md)
and its exact-package inventories. This is not enterprise/production certification.

## Stabilization changes

- Migration runner rejects missing historical files and duplicate local versions;
  checksum/advisory-lock/drift/adoption controls remain. Historical 001–017 bytes
  are unchanged, with no new migration needed.
- Static module checks include side-effect imports and spaced dynamic imports;
  28 Core sources retain explicit public boundaries and no cycles. Listener startup
  errors close optional workers using the existing lifecycle hook.
- Development-only Vitest upgraded to 4.1.12 after Node 24/Vite 6 impact assessment;
  npm audit now reports zero findings. All 28 Console tests and its build pass.
- Setup uses the grouped environment template, exclusive creation and independent
  generated secrets. Doctor prints actionable configuration/tool/port/readiness
  checks without secret values. local:up/down/status include Console; healthcheck
  reads .env and checks full Foundation readiness.
- Dependency-free Node ESM SDK uses public APIs only, memory-held OAuth credentials,
  sanitized errors, bounded polling and no mutation retries. Real enrolled-app and
  two-provider Composition tests exercise it; source declarations are type-checked.
- Console onboarding now links exact current guides. Small theme-selector and mobile
  width fixes address defects seen in rendered QA; Preview/LIVE boundaries remain.
  Upstream runtime package license texts are preserved during static builds.
- Public docs reflect source status; historical ADR/checkpoint evidence is labelled.
  All 45 public Markdown files have resolving local file links. External URLs and
  heading anchors were not exhaustively checked.
- Version 0.1.0-rc.1 packages 237 allowlisted source files from Git with exact SHA,
  SHA-256 sidecar and source manifest. Repeated archives are byte-identical. A CI
  packaging check and Console npm advisory gate are enabled; no final publication.

## Completed commits and exact-SHA CI

| Commit | Change | Evidence |
| --- | --- | --- |
| `5cde40db73f518188bdb38a6f9db492201d0d468` | Migration/import integrity and development dependency remediation | First CI exposed missing test scratch/mount support; corrected below |
| `d2ca17bc77700d990e66f324e31d711e9780cded` | Pinned-runtime test scratch/mount correction | [successful Actions](https://github.com/vku2-open-source-2026/junctura-dxos/actions/runs/41328619616) |
| `ad3109c85f8d09a88786d3ead82df90500165042` | Safe setup, doctor, local workflow and onboarding | [successful Actions](https://github.com/vku2-open-source-2026/junctura-dxos/actions/runs/41329621666) |
| `69767f696c511b5c444f11785759aa875b9db3bf` | Public server SDK, rendered Console fixes, onboarding and audit inventories | [successful Actions](https://github.com/vku2-open-source-2026/junctura-dxos/actions/runs/41330694905) |
| `1aedc5f9b96754cde7b665b15addbb0068cde8b4` | Source packager, reproducibility checks, release docs and version | Tested extracted install and baseline upgrade below |
| `75c1bfd` | Exact static runtime-notice URL and container regression | Packaged Console test passes |
| `05886dfb27c08356e8712668f61bcfe2fb205407` | npm advisory CI gate; source candidate with notice fix | [source increment Actions](https://github.com/vku2-open-source-2026/junctura-dxos/actions/runs/41331705506); exact final handoff result is reported separately |

Pushed increment tips were checked against remote main; intermediate packaging/fix
commits travel together. This document's final evidence revision follows those
source commits. Resolve the final SHA with `git log -1 --format=%H --
docs/architecture/LAYER1_IMPLEMENTATION_STATUS.md`; the final user handoff records
the observed exact-SHA Actions result and archive hash. No final release/tag or
public deployment has been created. A successful CI run is functional evidence,
not clearance of the explicitly unresolved container security gate.

## Newly executed local verification

Shared-stack suites ran sequentially on the new isolated `junctura-rc-test` Compose
project, Gateway 18080, Console 13000, with newly generated credentials and new
project-qualified volumes. No existing .env or real persistent volume was overwritten.

| Command/check | Result |
| --- | --- |
| `npm run check` | pass; syntax/SPDX, license metadata, 28-source boundaries |
| `npm test` | 77 pass in current workspace, including SDK/setup/doctor/archive guards |
| Pinned Node container unit suite | 77 pass, using a test-only tmpfs and source mounts; production remains read-only |
| `npm run check:contracts` / `test:contract-validator` | pass; Foundation 44 operations and Composition route/source/state controls |
| `npm run test:migrations` | 10 pass, including missing historical file and duplicate-version refusal |
| `npm run check:schema-drift` | pass against isolated installed 001–017 |
| `npm run test:execution-ledger` | 4 pass; 44 observed schema cases |
| `npm run test:provider-network` | 7 pass; real TLS and transport limits |
| `npm run test:integration` | 9 pass; 126 responses, 26 successful operations |
| `npm run test:applications` | 13 pass, including enrolled SDK/CLI v2 access; 246 responses, 31 operations |
| `npm run test:capabilities` | 26 pass; 244 observed schema cases |
| `npm run test:compositions` | 29 pass; SDK two-provider success, security and conservative recovery |
| SDK positive Composition/contract follow-up | 2 pass after preserving the observer in the SDK transport adapter |
| `npm run test:flowable-worker` | 2 pass; lock reacquire, former owner denial and zero retries |
| `npm run test:audit` | 7 pass |
| `npm run test:recovery` | 1 pass; isolated structured-data/authority/audit restore |
| `npm run console:test` / `console:build` / `console:check:endpoints` | 28 pass / build pass / current 44-operation inventory |
| `npm run test:console-container` | pass; packaged proxy/hardening contract |
| `npm run test:sdk` / `test:setup` | 7 pass / 2 pass |
| SDK declaration TypeScript check | pass with existing Console TypeScript |
| Fresh Compose build/up/wait | pass; all Foundation services plus Console ready |
| Doctor + ready healthcheck + SDK identity | pass on the new isolated stack |
| Visual QA | English/Vietnamese onboarding, 430/1440 width, light and dark inspected; measured no horizontal page overflow at 430/1440 |
| npm / pip advisory scans | zero Console npm findings after remediation; Python pins and conditional typing-extensions separately return no known findings |
| Docker Scout CVE/SPDX | executed for seven runtime image families; unresolved findings recorded, not a clean audit |
| `npm run check:docs` | pass; 45 Markdown files, local file links |
| `npm run test:release` / `release:package` / `release:verify` | pass; guard test, repeated identical TAR bytes, checksum and 237-file source inventory |
| Extracted source installation | pass on new junctura-release-smoke and updated junctura-final-smoke volumes; build/start/readiness/SDK/schema/Console/notices verified |
| Baseline-to-candidate upgrade | pass; original identity subject, synthetic record, object bytes, running workflow, all 17 checksum rows and exact environment bytes preserved |
| Retained-volume shutdown | pass; documented local:down preserves named volumes |
| Known-local-secret check | 237 tracked files checked against 48 local credential values; none found (not a general secret-scanner claim) |

An SDK fixture adapter initially combined duplicate case-insensitive Authorization
headers, producing 401 before dispatch. Correcting the adapter restored all 29 C4B
tests. A later observer-only change was verified with the positive/contract follow-up.
No Core authentication rule was relaxed. The first migration test rerun also caught
an error-message precedence regression; newer-schema diagnostics were restored
before the successful 10/10 run and commit.

The local regression matrix totals 213 tests across unit, migration, provider,
execution-ledger, Foundation, application, Capability, Composition, worker, audit,
recovery and Console suites. Targeted SDK/setup/release reruns overlap that total.

## Extracted-install and upgrade evidence

Source `1aedc5f9b96754cde7b665b15addbb0068cde8b4` produced an identical repeated TAR
with SHA-256 `be6b46cb4c7cc99cfa4a01726ac0a2e1872ec8ec43781284b02d15b0a3d045fa`.
It was installed from extraction on new `junctura-release-smoke` volumes, ports
28080/23000. Setup, preflight doctor, local:up build/wait, healthcheck, SDK identity,
Console HTML navigation and schema verification passed. local:down retained volumes.
An updated archive from `05886df` with hash
`b71eb028bc8ef6beee7e027bf99baadd016c035fd335b94cef4ae24d2922079f` repeated the
fresh workflow on new `junctura-final-smoke` volumes, ports 28082/23002, and verified
the explicit upstream notice URL too. Generated credentials remain ignored/local.

Upgrade used a separately extracted **starting SHA** and new `junctura-upgrade-test`
volumes at 28081. Its synthetic identity, record, object and live workflow were
seeded before switching to candidate source with the same project and .env. After
container recreation, all values, all 17 complete checksum rows and .env SHA-256
matched the baseline. Readiness, doctor and schema checks passed; Console was added
at 23001. No checksum adoption, role bypass or historical SQL edit was needed.

The existing Windows checkout's migration 006 has preexisting mixed-line-ending
bytes that differ from its committed Git blob. Neither was rewritten. Fresh archive
and baseline archive upgrades use canonical Git bytes; existing installations must
retain their own applied files/checksums. [RELEASE](../RELEASE.md) records both hashes
and the stop condition rather than silently normalizing an installed migration.

## Remaining blockers and next executable work

1. Resolve the 810 deduplicated advisory/package/image findings (50 critical and
   275 high), starting with exposed Nginx/identity paths and Flowable/Go libraries.
   Assess upstream patch builds and compatibility before changing image pins;
   rerun the full security/integration/recovery matrix. No blanket non-exploitability
   conclusion or critical-advisory acceptance is asserted.
2. Complete binary notice/corresponding-source review for any later image or builder
   redistribution. Current source-only packaging retains references and notices;
   missing/NOASSERTION SPDX metadata is not a binary-license pass.
3. Owner approval is still required for any final tag/release/publication. Server,
   domain/TLS, real operator provisioning, monitoring/rotation and coordinated backup
   recovery remain a separately authorized production phase. Nothing was deployed.

Layer 1 can support **local Layer-2 prototyping against its public contracts**, with
the existing operator enrollment and security limits. This is not approval to expose
it publicly or use real sensitive data. A business app/use case is still an owner
decision; no Layer-2 code was added. If continuing this program, remediate the recorded
image/security gate before claiming the original definition of done.
