<!--
SPDX-FileCopyrightText: 2026 Rosetta Contributors
SPDX-License-Identifier: Apache-2.0
-->

# Rosetta Console — Layer-1 Operational Control Plane

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
- **Accessibility**: Meets WCAG 2.2 AA standards (4.5:1 text contrast minimum, visible focus rings, ARIA live regions for badges, focus traps in dialogs, and `prefers-reduced-motion` compliance).

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
| **A. Overview** | Live/Preview mode switch, manual refresh, quick action jumps | Process liveness (`/health`), dependency readiness (`/ready`), tenant ID, roles | Host CPU/RAM telemetry (omitted honestly; no fake metrics) | Platform-wide automated recovery |
| **B. Core Services** | Detailed inspection drawer for each of the 5 Cores | Provider technology, protocols, port boundaries, verified health status | Direct upstream admin ports (kept private in internal Docker network) | Automated core component failover |
| **C. Applications** | App proposal (`POST /v1/applications`), two-person approval (`POST /v1/approvals` + `/approve`), state transition (`/state`) | App lookup (`GET /v1/applications/{appId}`), ETag, revision, JCS SHA-256 digest | Global application directory listing (excluded in v1 to protect tenant isolation) | Dynamic capability grant allocation |
| **D. Resources** | Create record (`POST /v2/data/{col}`), upload object (`/v2/objects`), create share (`/v2/resource-shares`), revoke share | Record details JSON viewer, binary object metadata, active read shares list | Unrestricted global data explorer; public client credentials | On-behalf-of token exchange |
| **E. Workflows** | Start execution with `Idempotency-Key` (`POST /v1/workflows/executions`), complete task (`/complete`), cancel (`DELETE`) | Installed BPMN definitions (`/v1/workflows/definitions`), execution state & history | Public BPMN XML upload / script deployment (operator-installed only) | Multi-step user task assignment |
| **F. API Explorer** | Search endpoints, tag filtering, copy cURL, copy TypeScript fetch | Request/response schemas, HTTP status codes, auth requirements for all 44 operations | Interactive API playground with privileged tokens (kept client-side safe) | Capability OpenAPI runtime testing |
| **G. Security** | Session activity logger tracking all administrative mutations | Multi-tier defense-in-depth architecture, token introspection flow, audit guidance | Public unauthenticated audit event API (database table `app_private.audit_events`) | Centralized security scanner |
| **H. Capabilities** | Specification file references and architecture comparison | Architectural review of Registry, Resolver, Cross-App Trust, Composition | Active runtime APIs (clearly badged as "Planned / Design-Only") | Full Layer-2 Capability Runtime |

---

## 4. Security Architecture

1. **Authentication**: Integrated with Keycloak 26.8.1 OIDC using public client `rosetta-local` (S256 PKCE) or operator bearer token.
2. **No Secret Leaks**: Client secrets are never embedded in frontend JavaScript or stored in `localStorage`.
3. **Fail-Closed Boundary**: When permissions are absent or the caller is unenrolled, the console fails closed with an explicit permission notice.
4. **Two-Person Rule Confirmation**: Sensitive operations (application activation, suspension, permanent revocation, execution cancellation, share deletion) require explicit confirmation dialogs with accessible focus traps.
5. **Mode Transparency**: A persistent header badge clearly distinguishes **LIVE CONNECTED** mode (real requests to `http://127.0.0.1:8080`) from **PREVIEW MODE** (realistic mock data for demonstration and offline development).

---

## 5. Missing Administrative Contracts & Recommendations

During our audit of the Foundation OpenAPI 3.1 specification, we identified the following missing administrative endpoints that would benefit future control plane releases:

1. **Administrative Application Directory (`GET /v1/admin/applications`)**:
   - *Current State:* `GET /v1/applications/{appId}` requires knowing the exact UUID.
   - *Recommendation:* Expose a tenant-scoped administrative listing endpoint restricted strictly to operators with the `admin` or `applications.approve` permission.
2. **Platform Audit Events (`GET /v1/admin/audit-events`)**:
   - *Current State:* Audit events are recorded internally in PostgreSQL table `app_private.audit_events`.
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

- **Console Vitest Suite**: 5 unit & UI integration tests passed (`npm run console:test`).
- **Production Build**: Verified with TypeScript 5.7 and Vite 6.1 (`npm run console:build`).
- **Core Unit Tests**: 22 unit tests passed (`npm test`).
- **Repository Hygiene & SPDX**: Verified with `npm run check`.
- **OpenAPI Contract Validation**: 44 operations validated with `npm run check:contracts`.
- **Visual & Responsive QA**: Verified with browser automation across 1440px desktop, 1024px laptop, 768px tablet, and 390px mobile viewports.
