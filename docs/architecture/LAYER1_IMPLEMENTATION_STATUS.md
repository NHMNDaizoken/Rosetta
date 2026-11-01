# Layer 1 implementation status

Updated: 2026-11-02 | Branch: main | Program: local stabilization and release preparation

Starting local/remote SHA: `2cdcb6a6f9d80547e9b6effb585489f703158146`, clean tree.
Its [exact-SHA Actions](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41322854152)
was independently verified successful. Earlier implementation evidence is preserved
in the [historical engineering handoff](CODEX_LAYER1_REVIEW_HANDOFF.md).

## Current assessment

Five headless Foundation capabilities, Application Authority, private v2 resources,
protected Audit, C1/C2, offline C3 and opt-in bounded C4A/C4B are implemented.
Layer 2, hosting, production deployment, human delegation, arbitrary DAG/loops,
general side effects, retries, HA credentials and unsupported resume remain outside scope.
Both execution flags remain disabled on the normal Gateway.

Local functional verification passes. **The overall release security gate is open:**
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
- Public docs are being reconciled with current source; old ADR/checkpoint evidence
  stays historical. Source packaging and fresh archive/upgrade verification are next.

## Completed commits and exact-SHA CI

| Commit | Change | Evidence |
| --- | --- | --- |
| `5cde40db73f518188bdb38a6f9db492201d0d468` | Migration/import integrity and development dependency remediation | First CI exposed missing test scratch/mount support; corrected below |
| `d2ca17bc77700d990e66f324e31d711e9780cded` | Pinned-runtime test scratch/mount correction | [successful Actions](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41328619616) |
| `ad3109c85f8d09a88786d3ead82df90500165042` | Safe setup, doctor, local workflow and onboarding | [successful Actions](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41329621666) |

Every listed push was checked against remote main. The next SDK/Console source
increment is verified locally before commit; final source identity and CI will be
recorded at handoff. No final release/tag or public deployment has been created.

## Newly executed local verification

Shared-stack suites ran sequentially on the new isolated `rosetta-rc-test` Compose
project, Gateway 18080, Console 13000, with newly generated credentials and new
project-qualified volumes. No existing .env or real persistent volume was overwritten.

| Command/check | Result |
| --- | --- |
| `npm run check` | pass; syntax/SPDX, license metadata, 28-source boundaries |
| `npm test` | 77 pass in current workspace, including SDK/setup/doctor/archive guards |
| Pinned Node container unit suite | 75 pass before the two final doctor/archive unit additions; final CI repeats it |
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

An SDK fixture adapter initially combined duplicate case-insensitive Authorization
headers, producing 401 before dispatch. Correcting the adapter restored all 29 C4B
tests. A later observer-only change was verified with the positive/contract follow-up.
No Core authentication rule was relaxed. The first migration test rerun also caught
an error-message precedence regression; newer-schema diagnostics were restored
before the successful 10/10 run and commit.

## Remaining executable steps

1. Commit/push the reviewed SDK/Console/doc and audit inventory increment; verify CI.
2. Commit the versioned source packager, checksum/allowlist verification and release
   docs; repeat package generation and verify byte-identical results.
3. Install the extracted source candidate on a separate fresh Compose project;
   verify readiness, Console, authenticated call and retained-volume shutdown.
4. Verify baseline-to-candidate upgrade on disposable data, retaining configuration,
   migration checksums and sentinel data; then record exact final-SHA CI.
5. Keep the release security gate unresolved until image advisories and binary
   license/source obligations have been resolved. Do not publish or deploy.
