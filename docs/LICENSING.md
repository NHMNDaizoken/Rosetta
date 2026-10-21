# License and third-party policy

## Approved project license

The maintainer approved Apache License 2.0 (SPDX: Apache-2.0) for original
Rosetta DX-OS source on 2026-10-21. Root LICENSE contains the official full text;
NOTICE contains project attribution. Initial attribution is 2026 Rosetta
Contributors, subject to contributors' actual rights and agreement.

Keep original Rosetta code under Apache-2.0 unless explicitly approved otherwise.
Do not overwrite upstream copyright or license notices. This approval permits
the authorized public GitHub repository and verified source pushes. It does
not authorize production deployment or package/container registry publication.

## Original source headers

Use these lines with the language's comment syntax in original JavaScript,
SQL, shell/PowerShell, Dockerfile and YAML source/configuration:

```text
SPDX-FileCopyrightText: 2026 Rosetta Contributors
SPDX-License-Identifier: Apache-2.0
```

JSON cannot contain comments: declare Apache-2.0 in package license metadata.
Root LICENSE and NOTICE cover other original repository files and documentation.
Do not copy third-party source or put Rosetta attribution on upstream files.

## Before integrating a component

Record name, exact version/commit/image digest, upstream URL, SPDX license,
role, distribution/hosting model and notice obligations in THIRD-PARTY.md.
Verify that the selected OSS edition actually provides the required feature.
Include dependencies, container base OS packages and assets in the review.
Public availability or zero price does not establish an open-source license.

Preserve upstream licenses and bundled notices in images. A component's source
license does not replace licenses of bundled libraries or OS packages. Separate
containers do not automatically remove license obligations. GPL/AGPL/MPL or mixed
licenses require review of the actual use and distribution model. Do not integrate
an item with unresolved provenance or rights; record the blocker.

## Publication and release checks

- LICENSE, NOTICE, source headers and THIRD-PARTY.md agree.
- Components are pinned and upstream notices remain intact.
- GitHub account and authorized repository are verified before push.
- No credentials or private data are tracked.
- Binary/package releases need a complete inventory and notice review of their
  own; source publication is not proof of a binary redistribution audit.
- Never claim a license or vulnerability audit passed unless it was run.

References: [official Apache terms](https://www.apache.org/licenses/LICENSE-2.0),
[OSI approval](https://opensource.org/license/apache-2.0). This records the
maintainer's decision and engineering policy; it is not legal advice.
