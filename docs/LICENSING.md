# License and Third-Party Policy

## Blocking decisions

- **Project license is not selected in this starter kit.** A maintainer must choose an OSI-approved license and add the full text to the root `LICENSE` before distributing the project. Never invent or silently choose one.
- Follow the team's chosen SPDX and copyright header convention for original source files. Make sure its exact requirements match the official OLP assessment criteria.
- Preserve upstream copyright, license files, attribution and NOTICE obligations.

## Current local implementation authorization

The maintainer has explicitly authorized local Layer 1 foundation implementation,
testing and Git commits while the project license is pending. This permits the
current local work; it does not approve distribution or an open-source license.
Original source headers remain pending until the copyright holder and exact
SPDX/copyright convention are approved. Do not insert a guessed identifier.

Recommendation for maintainer review: **Apache-2.0**, an
[OSI-approved license](https://opensource.org/license/apache-2.0), with permissive
reuse terms and an explicit contributor patent grant. This is a recommendation,
not a license selection or a completed legal review. See the
[upstream license terms](https://www.apache.org/licenses/LICENSE-2.0).

Before any GitHub publication or image/package release, approve the license,
identify the copyright holder, add the complete root `LICENSE`, apply approved
source headers and review the third-party inventory. GitHub authentication and
an explicitly authorized repository owner/name are also required before push.

## Before adding any dependency or asset

Record its name, version/commit, upstream URL, SPDX license if known, role, whether it is redistributed/modified/hosted, and any compliance obligations in `THIRD_PARTY.md` (create it if missing).

- Check source code, SDKs, Docker images, datasets, models, fonts and generated/borrowed assets; a public repository or free price is not proof of an OSI-approved license.
- Do not assume a product's commercial features are included in the open-source edition.
- GPL/AGPL/MPL and mixed licenses need case-specific review. **Running software as a separate service is not an automatic exemption** from all obligations.
- Do not vendor, copy, modify or redistribute upstream code without checking the applicable license and release consequences.
- If provenance or redistribution rights cannot be verified: **do not add the item**; record the blocker.

## Release gate

- Root `LICENSE` exists and reflects an approved decision.
- Third-party inventory and required notices are complete.
- Source headers/SPDX policy is enforced.
- Dependencies are pinned where reproducibility requires it.
- Any unresolved license question blocks release.

This is an engineering checklist, not legal advice.
