# Changelog

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
[the engineering handoff](docs/architecture/CODEX_LAYER1_REVIEW_HANDOFF.md) and Git.
