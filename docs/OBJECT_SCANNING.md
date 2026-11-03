<!--
SPDX-FileCopyrightText: 2026 Junctura Contributors
SPDX-License-Identifier: Apache-2.0
-->
# Object malware scanning

Junctura scans every publicly reachable object upload before bytes become
downloadable.

## Flow

`Client → Gateway → Core Upload API → Quarantine prefix → ClamAV INSTREAM → Clean publish → SeaweedFS`

1. The authenticated writer uploads `application/octet-stream` bytes (max 5 MiB).
2. Core stores the bytes under a non-published quarantine prefix.
3. Core scans the same in-memory bytes through ClamAV `clamd` over the internal
   `scanner` network using the INSTREAM protocol.
4. Only a clean verdict is published to the normal SeaweedFS object path.
5. Quarantine objects are deleted after success, rejection or interruption.
6. For `/v2/objects`, `object_commit` runs only after a clean verdict. Objects
   with `version = NULL` cannot be downloaded or shared.

## Fail-closed rules

| Condition | Result |
| --- | --- |
| Clean verdict | Publish; return object id/size |
| EICAR / malware FOUND | HTTP `422 malware_detected`; quarantine removed |
| ClamAV unavailable | HTTP `503 malware_scanner_unavailable`; nothing published |
| Scan timeout | HTTP `503 malware_scan_timeout`; nothing published |
| Oversized body | HTTP `413` before publish |
| Empty body | HTTP `400` |

Infected, pending, failed or unscanned objects are not downloadable. Resource
shares still require a committed clean version.

## Operations

- Image: `clamav/clamav-debian:1.5.4` pinned by digest in `compose.yaml`.
- Network: internal `scanner` only; port 3310 is not published to the host.
- Signatures persist on the `clamav-signatures` volume; FreshClam updates inside
  the container. Operators should monitor signature age in production.
- Resource limit: 2 GiB memory for the scanner service.
- Core readiness requires ClamAV to answer `PING` whenever object storage is
  configured.

## Limitations

- Scanning is synchronous on the upload path; large concurrency needs capacity
  planning.
- Signature freshness depends on FreshClam and network access from the scanner
  container.
- Quarantine prefixes are best-effort cleaned; operators may periodically purge
  orphaned `junctura-quarantine/` paths after incidents.
- This is not a substitute for endpoint AV on operator workstations.

## Tests

- Unit: `tests/malware-scan.test.mjs`
- Integration: `npm run test:malware-scan` (requires the local Compose stack)
