<!--
SPDX-FileCopyrightText: 2026 Junctura Contributors
SPDX-License-Identifier: Apache-2.0
-->
# Competition principle traceability

Maps common architecture principles discussed for the OLP/competition context to
**actual** Junctura components. Unimplemented items are deferred honestly. This
document does not invent Lakehouse, IoT gateway or OT infrastructure.

| Principle | Current Junctura mapping | Status |
| --- | --- | --- |
| Governance and authorization | Keycloak OIDC introspection, Core authorizer, PostgreSQL RLS, application enrollment, resource shares, capability grants | Implemented for Foundation and bounded C1/C2/C4A/C4B |
| Zero Trust | No trust of caller tenant/app headers; live token checks; private provider networks; fail-closed readiness | Partially implemented for local self-host; public TLS/WAF/device posture not claimed |
| GitOps and CI | GitHub Actions verifies source, licenses, containers and integration tests on `main` | CI implemented; continuous reconciliation/GitOps controllers are **deferred** |
| Data lifecycle | Versioned object pointers, tombstones, workflow history, structured-data restore test | Partial; coordinated full-store DR and object reclamation remain deferred |
| Malware scanning | ClamAV on internal `scanner` network; quarantine → scan → publish ([OBJECT_SCANNING.md](OBJECT_SCANNING.md)) | Implemented for object ingress |
| Secrets management | OpenBao KV for application secrets; bootstrap secrets outside Git ([SECRETS.md](SECRETS.md)) | Implemented for local Compose; production KMS/auto-unseal/HA deferred |
| IT/OT applicability | Junctura is an IT/backend PaaS for independent applications | OT/ICS gateways are **out of scope** until a concrete OT consumer and safety model exist |
| Data Lakehouse applicability | Structured JSON records + object bytes behind authorized APIs | No Lakehouse/catalog/query engine is implemented; would require a separate approved consumer demand |

## Deferred principles (no checklist claim)

| Principle | Why deferred | What would justify work |
| --- | --- | --- |
| GitOps reconciliation | CI proves commits; no desired-state controller | Hosting/control-plane slice with generation fencing |
| Production secret auto-unseal | Local file unseal is operator-attended | Approved KMS/HSM design and recovery drills |
| Lakehouse / analytical plane | Not required for Foundation BaaS scope | Two independent apps needing governed analytical sharing |
| OT / industrial protocol gateway | Different trust and safety domain | Explicit OT requirement with air-gap and safety review |

See also [OLP_REQUIREMENTS.md](OLP_REQUIREMENTS.md),
[architecture/OLP_REQUIREMENT_TRACEABILITY.md](architecture/OLP_REQUIREMENT_TRACEABILITY.md)
and [PRODUCT.md](PRODUCT.md).
