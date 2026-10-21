# Rosetta DX-OS

Layer 1 foundation for a reusable, headless platform. The implementation currently
provides one process-health HTTP API. The five Core integrations are planned;
they are not implemented or represented as healthy by this endpoint.

## Run locally

Use Node.js 24 (the target version is in `.node-version`). There are no npm
dependencies and no install step.

```sh
cp .env.example .env
npm start
```

PowerShell users can use `Copy-Item .env.example .env` instead of `cp`.
Visit `http://127.0.0.1:8080/health`. Set `HOST` and `PORT` in `.env` for native
execution. `HOST` defaults to loopback; `PORT` must be an integer from 1 to 65535.
Stop with Ctrl+C.

## API contract

| Request | Response |
| --- | --- |
| `GET /health` | `200`, `{"service":"rosetta-core","status":"ok"}` |
| `HEAD /health` | Same status and headers as GET, no body |
| Other methods on `/health` | `405`, `Allow: GET, HEAD`, JSON error |
| Unknown path | `404`, JSON error |

Query parameters do not change health behavior. Responses use JSON and
`Cache-Control: no-store`. Health is intentionally unauthenticated and exposes
no environment, credentials, tenant data or dependency diagnostics. It confirms
only that this HTTP process can respond; it is not Core integration readiness.

## Verify

```sh
npm run check
npm test
npm run healthcheck
```

The healthcheck requires a running server; set `PORT` in the calling shell when
using a nondefault port. Tests start an isolated server on an ephemeral port.
There is no transpilation/build step for the native JavaScript source.

## Structure and scope

- `src/`: Core process-health server; no application or business rules.
- `tests/`: HTTP contract and startup validation tests using `node:test`.
- `scripts/`: process-health probe shared by local checks and containers.
- `docs/`: architecture, requirements, license policy and development workflow.

Current scope is Layer 1 foundation only. GUI, business applications, SDKs, AI,
Kubernetes and OpenStack are outside this implementation.

## License and publication status

Project licensing is **pending maintainer approval**. No root `LICENSE` or source
SPDX identifier has been selected. `UNLICENSED` and `private: true` in
`package.json` prevent an accidental claim of an approved npm license/publication;
they do not select an open-source license or control GitHub visibility.

Local implementation and commits are authorized while this decision is pending.
Do not publish source, packages, container images or a public repository until
the project license, copyright holder and source-header convention are approved.
See [the licensing policy](docs/LICENSING.md).
