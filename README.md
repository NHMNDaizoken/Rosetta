# Rosetta DX-OS

Layer 1 foundation for a reusable, headless platform. The implementation currently
provides process health, Keycloak OIDC/SSO and an Nginx gateway with authentication
at both the gateway and Core boundary, plus PostgreSQL/PostgREST structured data
with row-level tenant isolation and SeaweedFS-backed binary object storage.
Flowable REST provides tenant-scoped workflow definitions, executions and history.
Process health does not represent integration readiness. See [API contracts](docs/CORE_API.md).

## Run with Docker Compose

Use Node.js 24 (target in `.node-version`), Docker Engine with Linux containers
and Compose v2.20 or newer. There are no npm dependencies or install step. A working
Docker daemon is required; the CLI alone cannot build or start containers.
Generate random local-only credentials first. `npm run setup` never overwrites an
existing `.env`. Do not fill `.env.example` with working credentials.

```sh
npm run setup
docker compose config --quiet
docker compose up --build --detach --wait --wait-timeout 240
docker compose exec -T core node scripts/check-health.mjs
npm run test:integration
npm run test:recovery
docker compose ps
docker compose down
```

The same health URL is available on the host. Compose reads `PORT` from the shell
or `.env` for the host mapping; the container always listens on port 8080. The
mapping binds only to `127.0.0.1`. The image runs as the upstream nonroot `node`
user; Compose drops Linux capabilities, prevents privilege escalation and uses a
read-only root filesystem for Core. No Docker socket is mounted. PostgreSQL and
SeaweedFS keep state in named volumes that survive `docker compose down`.
The Docker healthcheck runs the same JSON-validating probe as the native check.
Only Nginx publishes a host port. Keycloak and PostgreSQL remain on private
Compose networks; their administration endpoints are local development tools.

The build uses an official Node image pinned by version and multiarch digest.
Only source, runtime scripts, license/notice and third-party inventory enter the build context; `.env`
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

`test:integration` uses real services, two tenants and an OIDC PKCE login. It
stops/restarts dependencies and recreates containers, then checks persisted
records, object bytes and workflow state. Run it only on the local test stack.
Run `test:recovery` afterwards: it restores a structured-data dump into a
temporary isolated PostgreSQL and verifies tenant RLS. Run these suites
sequentially; they share the source database. See [operations](docs/OPERATIONS.md)
for persistence, recovery limits and safe local deployment steps.

To run the same tests in the built container runtime, mount `tests/` read-only at
`/app/tests` and run `node --test` through `docker compose run --rm --no-deps`.
CI performs this check on Linux in addition to the native test run.

For the standalone health process, stop Compose first and run `npm start`, then
`npm run healthcheck` in another terminal. This native mode has no configured
integrations. `HOST` defaults to loopback and `PORT` to 8080; stop with Ctrl+C.

## Structure and scope

- `src/`: health, authorization and thin data/object/workflow Core adapters.
- `tests/`: HTTP, identity, readiness and input-validation tests using `node:test`.
- `integration/`: real-service contracts, cross-core recovery and isolated restore.
- `infra/`: upstream configuration, additive SQL migrations and technical BPMN fixture.
- `scripts/`: local secret setup, source checks, health probe and workflow initializer.
- `docs/`: architecture, requirements, license policy and development workflow.
- `Dockerfile`, `compose.yaml`: local container build and execution.
- `.github/workflows/ci.yml`: source tests plus container build/start/probe/cleanup.

Current scope is Layer 1 foundation only. GUI, business applications, SDKs, AI,
Kubernetes and OpenStack are outside this implementation.

See the [five-Core integration roadmap](docs/INTEGRATION_ROADMAP.md) for acceptance
evidence, remaining deployment gates and the SynapseDX reference review.

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
Keep `AGENTS.md` public. `.gitignore` excludes named private agent context and
local tool directories; check exclusions and indexed files before every push.
