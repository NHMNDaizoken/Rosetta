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

The original lock contained Vitest 3.2.6 and its vulnerable mocker/tinypool graph.
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
