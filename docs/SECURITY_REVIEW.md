# Layer 1 stabilization review

Started 2026-11-01 from `2cdcb6a6f9d80547e9b6effb585489f703158146`.
This review covers the local, loopback-only deployment. It does not establish
production readiness or permission to redistribute third-party binaries.

## Architecture and reliability

The 28 Core sources retain their feature-first modules, explicit public entrypoints
and downward dependencies. Foundation has no imports from Capability modules.
Bootstrap owns runtime construction; the router owns public dispatch; platform
helpers own authentication, transport and internal assertions. Private SQL authority
remains behind owner-controlled RPC roles, forced tenant RLS and protected audit.
No service, framework, database or public contract was added.

Confirmed gaps fixed in this program:

- Boundary checking missed side-effect imports and whitespace in dynamic imports.
  Regression fixtures now reject Foundation-to-runtime imports in these forms.
- A missing intermediate historical migration could escape checksum verification.
  The runner now verifies that both installed ledgers have local migration files,
  and rejects duplicate local versions before applying SQL. Files 001–017 remain
  byte-for-byte unchanged. Existing checksum, lock, drift and adoption controls stay.
- Listener startup errors now close optional workers through the existing close hook.

Static checking handles literal imports; it is a repository convention checker,
not a JavaScript sandbox. Computed imports and hostile source changes require review.
Schema fingerprints cover functions, owners, ACLs, RLS and policies; they do not
claim complete PostgreSQL physical-schema or extension integrity.

## Console dependency remediation

The original lock contained Vitest 3.2.7 and its vulnerable mocker/tinypool graph.
`npm audit --prefix console --json` reported three affected packages (two critical,
one moderate including inherited dependency severity). Reviewed advisories:
[Tinypool worker options](https://github.com/advisories/GHSA-5gmw-xhrv-c9v3),
[Tinypool run options](https://github.com/advisories/GHSA-85c8-ppgw-ccpr),
[Vitest mock registration](https://github.com/advisories/GHSA-qxg6-89mg-rqv8).

Impact assessment: these are development/test dependencies, absent from the static
Nginx Console runtime and the Core image. The repository runs trusted tests with
`vitest run`, exposes no Vitest server and accepts no remote worker options. This
limits deployment exposure but does not justify retaining vulnerable tooling.
Vitest 4.1.12 supports Node 24 and the existing Vite 6; it removes tinypool from this
graph and includes fixed mocker code. The upgrade changes no Foundation image,
application dependency, test API usage or configuration. All 28 Console tests and
the TypeScript/Vite build passed after the upgrade. The resulting npm audit returned
zero findings. No unsupported transitive override was used.

## Audit scope and remaining gates

Root Node runtime has no third-party npm dependencies. Console inventory uses the
lockfile and npm CycloneDX SBOM. Python pins are scanned separately using pip-audit
2.10.0 in an ignored local virtual environment. Docker Scout 1.24.0 scans the actual
local pinned Linux images; its CVE output is evidence of detected packages, not proof
of application reachability. Container findings and final verification are recorded
in the release evidence as the scans finish. No unscanned image is considered clean.

Authentication, ownership, independent approval, grant revocation, provider tickets,
per-step authorization and audit failure behavior remain enforced by the existing
negative/integration suites. Final fresh-install, recovery and exact-SHA CI evidence
must be consulted before treating this program as complete.

## Executed container and license audit — 2026-11-02

The [exact lockfile inventory](security/console-dependencies.json) records 246
Console package entries including optional platform variants, source URLs, integrity
digests and SPDX metadata. Licenses include MIT, ISC, MIT-0, Apache-2.0, BSD-2-Clause,
BSD-3-Clause, MPL-2.0 (Lightning CSS build tools) and CC-BY-4.0 (caniuse-lite build data).
No upstream source was modified. These build packages are fetched, not vendored or
included in the source TAR; the final static Console does not contain the compiler.
Later redistribution of builder layers/node_modules requires their upstream notices
and MPL source/CC attribution review. The Console build now fails if a selected
runtime package lacks its installed license text; those texts are served together in
`THIRD-PARTY-NOTICES.txt`. Type packages conservatively included by the lock are also
covered. Apache project headers, LICENSE and NOTICE remain unchanged.

`pip-audit 2.10.0 -r requirements-contracts.txt --no-deps --disable-pip` returned no
known vulnerabilities for the exact contract pins on Python 3.14. The conditional
typing-extensions pin for Python <3.13 was also scanned separately without its marker
and returned no findings. This is not an audit of all host Python
packages or the audit tool's own dependencies. Root Node has no npm dependency graph.

Docker Scout indexed all seven actual local runtime image families. The
[container package inventory](security/container-packages.json) contains 1,925 SPDX
metadata entries. `NOASSERTION`/missing license fields remain unresolved for binary
redistribution. The [full findings](security/container-vulnerabilities.tsv) record each
advisory/package/image, affected version/range, reported fix and source. Counts below
deduplicate advisory/package pairs per image; advisory exceptions remain visible.

| Pinned image family | Findings | Critical | High |
| --- | ---: | ---: | ---: |
| Core / Node Debian base | 91 | 5 | 23 |
| Gateway / Console Nginx Debian base | 323 | 14 | 104 |
| PostgreSQL | 149 | 4 | 44 |
| Keycloak | 40 | 1 | 14 |
| PostgREST | 0 | 0 | 0 |
| SeaweedFS | 51 | 10 | 28 |
| Flowable | 156 | 16 | 62 |

These are scanner findings, not confirmed remotely exploitable Rosetta defects.
Reachability assessment from the actual configuration/source:

- Core's critical entries concern Debian Perl, which Core does not invoke on API
  inputs. Runtime is nonroot/read-only; this narrows the observed attack path but does
  not remove vulnerable base packages. Fixes are listed as Debian `deb12u4` builds.
- Nginx/HTTP libraries are in the loopback-published Gateway/Console path; critical
  Nginx/TLS entries need upstream advisory/configuration analysis. Some entries report
  no fix. We cannot claim these are unreachable or safe for public ingress.
- PostgreSQL findings include the image's Go helper inventory; database SQL is on
  private networks. That distinction is not a blanket exemption for DB packages.
- Keycloak's critical SQLite entry is in its base metadata; Rosetta uses PostgreSQL.
  Keycloak itself is exposed through Gateway identity routes. Other library findings
  require individual review before deployment.
- SeaweedFS includes Go/network and OS utility findings. Its ports are private and
  Core derives paths; untrusted bytes still enter storage. Scanner-listed Go/curl/
  Brotli fixes need a rebuilt, reviewed upstream image.
- Flowable contains critical Tomcat/Spring/Security/Netty and base-library entries.
  REST is private and Core fixes definitions/provider origins, but the service still
  processes Core requests. Several fixes require newer upstream libraries/engine
  builds; replacing jars or swapping images without compatibility tests is unsafe.

**Release security gate: unresolved.** No production or final binary release is
cleared. Local source packaging/testing can proceed with these findings attached.
Foundation image changes require impact assessment and rerunning the full OIDC/data/
storage/Flowable/security/recovery matrix. This program does not silently replace
pinned engines or label unreviewed findings non-exploitable. PostgREST's zero findings
mean only that Scout detected none in its one indexed binary package.

Scout emitted Windows temporary-file cleanup warnings for some scans but produced
SARIF/SPDX reports; their metadata was inspected. Full SBOM generation with
`npm sbom --package-lock-only` failed on unresolved optional WASM package edges;
rerunning with `--omit=optional` succeeded. Refreshing only lock metadata with
`npm install --package-lock-only --ignore-scripts` filled six missing optional WASM
entries without changing selected application/framework versions. Full CycloneDX
generation then succeeded. The committed lock inventory retains all optional entries.

Reproduce advisory checks with `npm audit --prefix console --json`, an isolated
pip-audit environment, and `docker scout cves --format sarif` / `docker scout sbom
--format spdx` against the exact digests in `compose.yaml` and the Dockerfiles.
Never scan or upload a workspace directory containing `.env`; these scans target
lockfiles, pinned requirements and local container images only.
