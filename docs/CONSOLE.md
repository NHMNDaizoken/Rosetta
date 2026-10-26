<!--
SPDX-FileCopyrightText: 2026 Rosetta Contributors
SPDX-License-Identifier: Apache-2.0
-->

# Rosetta Console — Layer-1 Operational Control Plane

> Audit qualification, 2026-10-26 at `7fdd7fc` on main: IMPLEMENTED management UI,
> PARTIALLY VERIFIED. Read the [source-based findings](architecture/LAYER1_CORE_CATALOG.md#console-evidence-and-contradictions)
> before interpreting the screen inventory as live functionality. There is no
> Console PKCE implementation, hosting API or protected server audit viewer.
> The later S0 session-truthfulness slice keeps bearer tokens in tab memory only,
> removes mock identity substitution in LIVE, and disables mock-only v2 writes in
> LIVE. These remain UI safeguards, not authentication or authorization
> guarantees.

**Rosetta Console** is the official operational control center for the **Rosetta DX-OS** Layer-1 headless PaaS platform.

*Tagline:* **One platform. Many applications. Connected capabilities.**

> **Architectural Boundary Notice:**
> The Admin Console is a **Layer-1 operational control plane**, designed for platform operators to monitor infrastructure health, govern application registration and inspect foundation contracts. It is **not** a Layer-2 business application and does **not** replace the competition's mandatory Layer-2 demonstration application. The five foundational Cores remain completely headless and operational without this UI.

---

## 1. Visual Identity & Design System

The Rosetta Console adheres to a restrained, premium SaaS infrastructure design system inspired by Linear, Stripe Dashboard, and Vercel:

- **Original Brandmark**: A custom geometric stone emblem with three layered, translating facets meeting at a central nexus, symbolizing Layer-1 Core, Layer-2 Applications, and Connected Capabilities.
- **Brand Palette**:
  - **Deep Stone Ink** (`#172F3D`): Primary text and dark structures.
  - **Rosetta Blue** (`#176B80`): Primary interactive brand color.
  - **Mediterranean Teal** (`#18877A`): Integration health, success, and active status.
  - **Warm Sandstone** (`#C58B62`): Heritage-inspired accent for governance and proposals.
  - **Soft Limestone** (`#F0F2EE`): Subtle surface fills and card dividers.
  - **App Background** (`#F7F8F6` light / `#0B161E` dark): High-contrast, eye-friendly layout.
- **Typography**: Inter for UI and section hierarchy; JetBrains Mono for technical identifiers, UUIDs, hashes, and API endpoints.
- **Bilingual Localization**: Native Vietnamese as default interface language with full, complete English translation (100% dictionary coverage, no mixed strings).
- **Accessibility**: Source includes focus/ARIA/reduced-motion patterns. Complete WCAG 2.2 AA conformance is UNVERIFIED in the architecture audit; component tests are not an accessibility certification.

---

## 2. Navigation & Screen Architecture

The unified application shell contains a persistent, collapsible sidebar, top navigation with breadcrumbs, tenant context badge, mode toggle, language switcher, and theme toggle:

```
Rosetta Console
├── Workspace
│   ├── Overview (Screen A) — Health, readiness, core summaries, quick actions
│   ├── Core Services (Screen B) — 5 foundational cores in-depth inspection
│   └── Applications (Screen C) — Application registration, two-person approvals, state
├── Platform Control
│   ├── Access & Resources v2 (Screen D) — v2 structured records, binary objects, shares
│   ├── Workflows (Screen E) — BPMN 2.0 definitions, executions, timeline, task completion
│   └── API Explorer (Screen F) — Foundation OpenAPI 3.1 explorer (44 operations)
├── Operations & Security
│   ├── Security & Activity (Screen G) — Defense-in-depth, audit boundaries, session tracker
│   └── Platform Settings — Gateway configuration, tokens, theme & language
└── Future Extensions
    └── Capabilities (Screen H) — Roadmap: Registry, Resolver, Trust, Composition
```

---

## 3. Screen Functionality & Feature Matrix

| Screen | Implemented Live UI Actions | Read-Only Views | Unavailable / Out-of-Scope APIs | Planned Roadmap |
| --- | --- | --- | --- | --- |
| **A. Overview** | Live/Preview mode switch, manual refresh, identity retry, quick action jumps | Process liveness (`/health`), dependency readiness (`/ready`), verified tenant ID and roles (`/v1/identity`); truthful missing/rejected/forbidden/unavailable/timeout states | Host CPU/RAM telemetry (omitted honestly; no fake metrics) | Platform-wide automated recovery |
| **B. Core Services** | Detailed inspection drawer for each of the 5 Cores | Provider technology, protocols, port boundaries, verified health status | Direct upstream admin ports (kept private in internal Docker network) | Automated core component failover |
| **C. Applications** | App proposal (`POST /v1/applications`), two-person approval (`POST /v1/approvals` + `/approve`), state transition (`/state`) | App lookup (`GET /v1/applications/{appId}`), ETag, revision, JCS SHA-256 digest | Global application directory listing (excluded in v1 to protect tenant isolation) | Dynamic capability grant allocation |
| **D. Resources** | Preview/session simulation only; v2 writes are disabled and rejected in LIVE | Mock/session record, object and share views; not a server listing | Live backend enrollment/delegation; unrestricted explorer and browser client secrets | Separately reviewed backend trust design for live v2 resource APIs |
| **E. Workflows** | Start execution with `Idempotency-Key` (`POST /v1/workflows/executions`), complete task (`/complete`), cancel (`DELETE`) | Installed BPMN definitions (`/v1/workflows/definitions`), execution state & history | Public BPMN XML upload / script deployment (operator-installed only) | Multi-step user task assignment |
| **F. API Explorer** | Search endpoints, tag filtering, copy cURL, copy TypeScript fetch | Request/response schemas, HTTP status codes, auth requirements for all 44 operations | Interactive API playground with privileged tokens (kept client-side safe) | Capability OpenAPI runtime testing |
| **G. Security** | Browser-generated session activity, labeled as diagnostics; uses the verified LIVE identity only | Architecture/audit guidance | No public protected audit API; actual private table is `app_private.audit` | Separate protected audit contract |
| **H. Capabilities** | Specification file references and architecture comparison | Architectural review of Registry, Resolver, Cross-App Trust, Composition | Active runtime APIs (clearly badged as "Planned / Design-Only") | Full Layer-2 Capability Runtime |

---

## 4. Security Architecture

1. **Authentication**: Console accepts a manually supplied bearer token and keeps it in tab memory only. Legacy persisted tokens are deleted on startup, and reloading clears the token. No Console PKCE exchange was found. Foundation's separate Keycloak PKCE fixture does not prove Console login.
2. **Credential boundary**: Do not enter backend service secrets or credentials intended for application-private v2 calls in a browser. Gateway destinations are restricted to the same origin or loopback hosts; the Console refuses to send `Authorization` to any other origin and removes invalid persisted gateway URLs.
3. **Server enforcement**: Core and PostgreSQL fail closed. In LIVE mode the Console uses only `/v1/identity` for tenant, subject, roles and permissions. Missing, rejected, forbidden, unavailable and timeout identities are shown distinctly; preview identity is never substituted.
4. **Two-Person Rule Confirmation**: Sensitive operations (application activation, suspension, permanent revocation, execution cancellation, share deletion) require explicit confirmation dialogs with accessible focus traps.
5. **Mode Transparency**: Switching PREVIEW → LIVE clears preview applications, approvals, executions, records, shares and session events. LIVE listings contain only data fetched or created in the current session; endpoints without a listing contract show an explicit notice, and mock-only v2 mutations fail instead of appearing successful. Preview is the only mode that displays mock data.

---

## 5. Missing Administrative Contracts & Recommendations

During our audit of the Foundation OpenAPI 3.1 specification, we identified the following missing administrative endpoints that would benefit future control plane releases:

1. **Administrative Application Directory (`GET /v1/admin/applications`)**:
   - *Current State:* `GET /v1/applications/{appId}` requires knowing the exact UUID.
   - *Recommendation:* Expose a tenant-scoped administrative listing endpoint restricted strictly to operators with the `admin` or `applications.approve` permission.
2. **Platform Audit Events (`GET /v1/admin/audit-events`)**:
   - *Current State:* Application/approval/share audit events are recorded internally in PostgreSQL table `app_private.audit`; this is not a platform-wide immutable audit service.
   - *Recommendation:* Expose a paginated, time-filtered endpoint returning audit events for verified administrators.
3. **Component Health Diagnostic (`GET /v1/admin/diagnostics`)**:
   - *Current State:* `/ready` returns a binary `ready` or `503 not_ready`.
   - *Recommendation:* Expose granular sub-component latency metrics for Identity, PostgREST, SeaweedFS, and Flowable to privileged operators.

---

## 6. Local Setup & Execution Instructions

### Method A: Local Development Server (Recommended)

From the project root:

```bash
# Install dependencies in console
npm --prefix console install

# Run the console dev server with hot reload
npm run console

# Run unit and component tests
npm run console:test

# Build the production bundle
npm run console:build
```

The Console will be accessible at: `http://localhost:3000/`.

### Method B: Docker Compose Optional Profile

The Console includes an optional Docker Compose profile so headless Core operation remains completely untouched:

```bash
# Start standard headless Core (Console does NOT run by default)
docker compose up -d

# Start headless Core PLUS the optional Rosetta Console
docker compose --profile console up --build -d
```

The Console will be accessible at `http://127.0.0.1:3000/` and proxies backend requests to the Nginx Gateway at `127.0.0.1:8080`.

---

## 7. Verification Summary

The S0 slice added API and component coverage for token non-persistence, gateway
origin checks, identity failure states, PREVIEW → LIVE state clearing, and
LIVE-mode rejection of mock-only operations. GitHub Actions now runs the Console
suite and production build after the root checks. The optional Docker profile and
full visual/accessibility QA were not rerun in S0; [current evidence and CI gaps](architecture/LAYER1_CORE_CATALOG.md)
take precedence when assessing live functionality.

- **Console Vitest Suite**: 21 tests passed (`npm run console:test`) — 8 API client tests and 13 UI integration tests.
- **Production Build**: Verified with TypeScript and Vite (`npm run console:build`).
- **Core Unit Tests**: 22 unit tests passed (`npm test`).
- **Repository Hygiene & SPDX**: Verified with `npm run check`.
- **OpenAPI Contract Validation**: 44 operations validated with `npm run check:contracts`.
