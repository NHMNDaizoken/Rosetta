<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Changelog

All notable changes to Junctura are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## Unreleased

- **Internal capability providers:** C4A/C4B can call Layer 2 services that run next
  to the platform. Exact `https://*.internal` origins only, private (RFC 1918 / ULA)
  addresses only, TLS verified solely against the operator's provider CA; all other
  invocation controls unchanged. Configured with `C4A_INTERNAL_PROVIDER_ORIGINS`,
  `C4B_INTERNAL_PROVIDER_ORIGINS` and `PROVIDER_CA_FILE`, plus `compose.providers.yaml`.
- `npm run provider:pki -- <name>...`: dependency-free local provider CA and server
  certificates (ECDSA P-256) in the Git-ignored `.junctura/pki`.
- TLS verification failures such as an unknown issuer are reported as `tls_error`.

## 0.1.0 — Layer 1 release (2026-11-04)

First public release of the Junctura DX-OS Layer 1 platform for OLP'26: a headless
core that lets independent applications share data and capabilities with explicit,
expiring, revocable and audited permission.

### Platform
- Five headless Foundation services behind one Nginx gateway: Keycloak SSO,
  PostgreSQL/PostgREST with row-level security, SeaweedFS with ClamAV ingress
  scanning, Flowable workflows and OpenBao secrets.
- Capability Services: application registration with independent approval, expiring
  resource shares, C1 Registry, C2 cross-app trust, C3 compatibility resolver,
  opt-in C4A invocation and C4B composition, and protected audit.
- **Tamper-evident audit** (migration 018): per-tenant SHA-256 hash chain over the
  protected audit log and `POST /v1/audit-events/verify` (requires `audit.read`).
  Detects modified, deleted, reordered and truncated sealed events; never seals over
  a broken chain.
- **Trust graph** (migration 019): read-only `GET /v1/trust/graph` returns the tenant's
  applications and direct grants with effective state and expiry (administrators see
  the tenant, writers only providers they own).
- Gateway JSON access log with request IDs (paths only, no query strings or headers).

### Console
- **Capability sharing** screen with an interactive trust graph: state filters,
  expiring-soon hints and one-click revocation with a required reason.
- **Verify integrity** card on the Security screen for the audit hash chain.
- Capability screens now reflect the implemented C1–C4B modules instead of the old
  "planned" roadmap; Console, SDK and platform share version 0.1.0.

### Operations and developer experience
- `npm run app:enroll -- <name>`: one-command local enrollment of a Layer-2 backend
  application with separated demo owner/approver and an ignored per-app env file.
- `npm run backup` / `npm run restore`: checksummed backups of the identity, data and
  workflow databases and the object volume; restore verifies, takes a safety backup,
  recreates databases with original ACLs/RLS and restarts the stack.
- Local demos through the real Gateway: `npm run trust:demo` (four sample apps, three
  published capabilities, active, expiring, pending and revoked grants; `-- token`
  prints an approver token for the Console) and `npm run audit:demo` (verify, tamper,
  restore). Shared demo identity helpers live in `scripts/lib/demo-stack.mjs`.
- Packaging accepts final semantic versions and writes a reproducible `.tar.gz` with
  its own SHA-256 sidecar; `release:verify` checks both. GitHub Release steps documented.
- Issue templates for bugs and tasks.
- Every tracked file that can hold a comment now carries an inline SPDX header
  (Markdown, HTML, SVG, TypeScript config, ignore files); `npm run check` enforces it and
  REUSE.toml covers only comment-hostile files. README explains the license and its terms.

### Project
- **Renamed from Rosetta to Junctura DX-OS** (Latin for "joint") before the first
  release, everywhere: code, SDK (`createJuncturaClient`), settings (`JUNCTURA_*`),
  database names and roles (`junctura_*`), Keycloak realm `junctura`, capability URNs
  (`urn:junctura:`), Compose project `junctura`, Console branding and J monogram logo.
  Pre-release local installations are recreated on the next `npm run local:up`
  (new Compose project and volumes; old `rosetta` volumes are left untouched).
  Migration checksums, contract digests and fixtures were regenerated for the new names.
- Vietnamese product README with architecture, security model, quick start and API
  overview; the full English reference is `docs/README_EN.md`, and
  `docs/OLP_REQUIREMENTS.md` maps the contest requirements.
- Internal engineering notes renamed to `ENGINEERING_HISTORY.md` and
  `IMPLEMENTATION_BACKLOG.md`.

### Known issues
- Upstream container images carry unresolved advisories recorded in
  [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md).
- Loopback-only local installation; production deployment, TLS termination and HA are
  out of scope for this release. Human delegation is not implemented.

## 0.1.0-rc.1 — local candidate preparation (2026-11-02)

- Preserve the implemented five Foundation services and opt-in bounded C1–C4B.
- Reject missing historical migration files and duplicate versions before applying SQL;
  preserve migration bytes 001–017 and existing checksum/lock/drift controls.
- Check side-effect module imports and close workers on listener startup errors.
- Upgrade development-only Vitest to 4.1.12 after Node/Vite compatibility assessment.
- Generate grouped local configuration, provide doctor and start/stop/status commands,
  and require configured Foundation readiness in the host healthcheck.
- Add a dependency-free server-side Node ESM client and executable synthetic example.
- Improve operator/developer onboarding and Console links; preserve upstream UI notices.
- Prepare allowlisted source archives, exact source manifests, checksums and release guides.
- Record dependency/container scan findings honestly; production and final publication
  remain deferred. See docs/SECURITY_REVIEW.md and implementation status for open gates.

Earlier implementation history and exact verification checkpoints remain in
[the engineering history](docs/architecture/ENGINEERING_HISTORY.md) and Git.
