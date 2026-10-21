# Rosetta DX-OS

Layer 1 foundation for a reusable, headless platform. The implementation currently
provides process health, Keycloak OIDC/SSO and an Nginx gateway with authentication
at both the gateway and Core boundary, plus PostgreSQL/PostgREST structured data
with row-level tenant isolation and SeaweedFS-backed binary object storage.
Workflow integration is being added.
Process health does not represent integration readiness. See [API contracts](docs/CORE_API.md).

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

## Run with Docker Compose

Use Docker Engine with Linux containers and Compose v2.20 or newer. A working
Docker daemon is required; the CLI alone cannot build or start containers.
Generate random local-only credentials first. `npm run setup` never overwrites an
existing `.env`. Do not fill `.env.example` with working credentials.

```sh
 npm run setup
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 180
docker compose exec -T core node scripts/check-health.mjs
npm run test:integration
docker compose ps
docker compose down
```

The same health URL is available on the host. Compose reads `PORT` from the shell
or `.env` for the host mapping; the container always listens on port 8080. The
mapping binds only to `127.0.0.1`. The image runs as the upstream nonroot `node`
user; Compose drops Linux capabilities, prevents privilege escalation and uses a
read-only root filesystem. No persistent data or host sockets are mounted.
The Docker healthcheck runs the same JSON-validating probe as the native check.
Only Nginx publishes a host port. Keycloak and PostgreSQL remain on private
Compose networks; their administration endpoints are local development tools.

The build uses an official Node image pinned by version and multiarch digest.
Only source, the probe, license/notice and third-party inventory enter the build context; `.env`
and `.git` are excluded. There are no package installation steps in the image.

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

To run the same tests in the built container runtime, mount `tests/` read-only at
`/app/tests` and run `node --test` through `docker compose run --rm --no-deps`.
CI performs this check on Linux in addition to the native test run.

## Structure and scope

- `src/`: Core process-health server; no application or business rules.
- `tests/`: HTTP contract and startup validation tests using `node:test`.
- `scripts/`: process-health probe shared by local checks and containers.
- `docs/`: architecture, requirements, license policy and development workflow.
- `Dockerfile`, `compose.yaml`: local container build and execution.
- `.github/workflows/ci.yml`: source tests plus container build/start/probe/cleanup.

Current scope is Layer 1 foundation only. GUI, business applications, SDKs, AI,
Kubernetes and OpenStack are outside this implementation.

See the [five-Core integration roadmap](docs/INTEGRATION_ROADMAP.md) for the next
Layer 1 work, contract decisions, acceptance evidence and SynapseDX reference
review. Integration and publication gates are documented explicitly.

## License and publication status

Original source is licensed under [Apache License 2.0](LICENSE), approved by the
maintainer on 2026-10-21. Attribution: Copyright 2026 Rosetta Contributors, subject
to contributors' actual rights and agreement. See [NOTICE](NOTICE),
[THIRD-PARTY.md](THIRD-PARTY.md) and [the licensing policy](docs/LICENSING.md).
External components keep their own terms. `private: true` prevents accidental
npm publication; no package/image publishing or production deployment is enabled.

## Git and GitHub

Use one branch, `main`, and meaningful Conventional Commits for cohesive, tested
changes. CI runs on pushes and pull requests, but does not publish images,
deploy, create PRs or merge changes. No remote is assumed or silently selected.
The authorized source repository is `NHMNDaizoken/Rosetta`, public, with `main` as
the default branch. Verify authentication and remote history before pushing
verified commits incrementally, without force-pushing.
