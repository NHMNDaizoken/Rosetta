# Changelog

All notable changes to Junctura are recorded here. Versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0 — Layer 1 release (2026-11)

First public release of the Junctura Layer 1 platform for OLP'26.

- Product renamed from Rosetta to **Junctura DX-OS** (Latin for "joint"): README,
  documentation, Console branding, J monogram logo and copyright holder. Technical
  identifiers (`ROSETTA_*` settings, container, database and realm names) are unchanged
  so existing installations keep working; the SDK adds `createJuncturaClient` and
  `JuncturaError` aliases.

- Five headless Foundation services behind one Nginx gateway: Keycloak SSO,
  PostgreSQL/PostgREST with row-level security, SeaweedFS with ClamAV ingress
  scanning, Flowable workflows and OpenBao secrets.
- Capability Services: application registration, expiring resource shares,
  C1 Registry, C2 cross-app trust, C3 compatibility resolver, opt-in C4A
  invocation and C4B composition, and protected audit.
- Vietnamese README with requirement mapping, architecture diagram and team details;
  the full English reference moved to `docs/README_EN.md`.
- Internal engineering notes renamed to `ENGINEERING_HISTORY.md` and
  `IMPLEMENTATION_BACKLOG.md`.
- Packaging accepts final semantic versions; GitHub Release steps documented.
- Issue templates for bugs and tasks.
- `npm run backup` / `npm run restore`: checksummed backups of the identity, data and
  workflow databases and the object volume; restore verifies, takes a safety backup,
  recreates databases with original ACLs/RLS and restarts the stack.
- Gateway JSON access log with request IDs (paths only, no query strings or headers).
- Byte-frozen files (migrations, BPMN, OpenBao policies, published contracts) keep
  their original attribution so stored checksums remain valid.
- `npm run app:enroll -- <name>`: one-command local enrollment of a Layer-2 backend
  application with separated demo owner/approver and an ignored per-app env file.

**Known issues:** upstream container images carry unresolved advisories recorded in
[docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md). Production deployment is out of scope.

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
