# Local source release candidates

Junctura's candidate is a versioned **source** distribution for the loopback local
installation. It does not bundle upstream images, Node modules, databases, credentials
or private test state. No public deployment, registry publication, release tag or
final GitHub Release is authorized by this workflow.

## Versioning and build

Use semantic `MAJOR.MINOR.PATCH-rc.N` versions in root `package.json` for candidates
and `MAJOR.MINOR.PATCH` for an owner-approved final version. `v0.1.0` is the Layer 1
competition release; see [Publishing a GitHub Release](#publishing-a-github-release). Versioning
does not change the existing `/v1` and `/v2` API contracts. Additive database versions
are independent; applied migrations are immutable. No downgrade migration is supplied.

From a reviewed, committed checkout with Git, Node 24 and `tar`:

```sh
npm run check
npm run check:docs
npm test
npm run release:package
npm run release:verify
```

Outputs under ignored `dist/releases/` are a TAR, SHA-256 sidecar and source manifest
with exact Git commit and file list. The same commit produces identical TAR bytes
across repeated builds: Git owns path ordering, timestamps, modes and contents.
Tracked modifications cause packaging to refuse. Untracked files are never included;
an explicit source allowlist rejects secrets and generated/private paths. Treat the
allowlist as a control against accidental inclusion, not a general secret detector.
Review every source change before publication. The archive format is an internal
candidate format; verify the organizer's current submission rules separately.

Core: `docker compose build core`. Console: `npm ci --prefix console` then
`npm run console:build`, or `docker compose --profile console build console`.
The Console build preserves upstream runtime license texts in
`THIRD-PARTY-NOTICES.txt`. Builder dependencies and third-party images retain their
own licenses; source distribution does not clear binary redistribution rights.

## Fresh isolated installation

Extract the source TAR into a new directory. Run the following there, not inside
your real development checkout. Choose unused ports and a unique project name:

```sh
npm run setup -- --port=28080 --console-port=23000 --project=junctura-release-smoke
npm run doctor
npm run local:up
npm run healthcheck
npm run example:sdk
npm run local:down
```

Open `http://127.0.0.1:23000/#/getting-started`. Setup writes the fresh directory's
`.env`, Compose creates new project-qualified volumes, and `local:down` retains
them. Never reuse another installation's project name with new credentials.
The SDK identity example uses only synthetic local fixture credentials. App-private
resources need separate operator enrollment and independent approval; see
[onboarding](GETTING_STARTED.md). `local:up` waits for Foundation and Console health.

For regression tests install `requirements-contracts.txt`, host OpenSSL and Console
dependencies. Run the commands in [DEVELOPING](DEVELOPING.md) sequentially whenever
they restart shared services. Do not run recovery/fault suites on a real data stack.

## Upgrade and rollback

1. Record the installed source SHA, Compose project name, configuration location,
   image digests and migration version. Schedule downtime; there is no HA promise.
2. Back up the data database with `pg_dump` and preserve global roles, ACLs, private
   authority/audit schemas, identity and workflow databases, and object bytes/filer
   metadata. Encrypt backups and keep credentials outside release archives.
3. Verify backups on isolated infrastructure before changing the installation.
   Automated restore tests cover structured data, authority, audit and execution
   evidence. They do not establish a coordinated whole-platform recovery point.
4. Keep the existing `.env`, project name and named volumes. Read the changelog and
   compare `.env.example` key names. Do not regenerate secrets or edit applied SQL.
5. Build the new Core/Console and run `docker compose run --rm data-migrate`. The
   runner verifies checksums, applied-version inventory, locks and schema drift.
   Stop on refusal; see [MIGRATIONS](MIGRATIONS.md). Do not adopt drift blindly.
6. Run `npm run local:up`, `npm run healthcheck`, `npm run doctor` and
   `npm run check:schema-drift`. Verify your enrolled application's read/write flow.

Important for existing worktrees: this Windows checkout has a preexisting mixed-line-
ending copy of migration 006 with SHA-256
`11d5b72c9033878aba93d3809c949b2e719622bbade78758411402e5da514603`.
The committed Git/archive bytes are
`0a6871b38662c7a5a528509ed5bd9fe30e1e95b922ccd1a0913ed6ab710951e6`.
They are semantically equivalent SQL but different immutable migration inputs.
Fresh Git/archive installs use the latter. Existing installations must retain their
original applied files and matching ledger checksums; do not normalize line endings,
rewrite checksum rows or blindly replace migration files from an archive. A checkout
upgrade that leaves the file untouched can retain its original bytes. If a source
archive differs from an installation's recorded bytes, stop and use the preserved
original migration set with a reviewed deployment configuration. No checksum adoption
or silent alternate-hash acceptance is introduced here.

For this candidate, migrations remain 001–017; upgrades change the runner and
developer tooling, not the authority schema. Older Core code may not understand a
future schema. Roll back only to a previously verified compatible code/image pair,
retaining the current data and all audit/history tables. Never replay historical
SQL, delete ledger entries or delete volumes to force a rollback.

## Candidate checklist and limits

- [ ] Source/archive verification, fresh installation and retained-volume restart pass.
- [ ] Foundation, application, Capability, Composition, migration, worker, audit and recovery suites pass.
- [ ] Console tests/build/proxy checks and SDK tests pass.
- [ ] Exact final SHA is on authorized `main`, with successful GitHub Actions.
- [ ] Dependency/advisory findings and license inventory reviewed for this artifact.
- [ ] Critical unresolved container findings cleared or explicitly resolved before wider distribution.
- [ ] Owner approves publication separately; no final release/tag is created automatically.

Consult [release evidence](architecture/LAYER1_IMPLEMENTATION_STATUS.md) and
[security findings](SECURITY_REVIEW.md); an unchecked item is not a passed gate.

| Capability | Local candidate | Production phase |
| --- | --- | --- |
| Five Foundation services / Console | Loopback, Compose, generated synthetic credentials | Server sizing, secure operator provisioning, TLS, ingress and rotation |
| C4A / C4B | Disabled by default; private real-provider demonstrations | Approved origins, real provider onboarding and operational policy |
| Backup/restore | Isolated SQL/authority/audit/execution evidence | Coordinated identity/data/objects/workflow recovery and off-host backups |
| Execution recovery | Conservative observation; lost leases may yield auth_required/outcome_unknown | HA, unattended credential recovery and resume remain unsupported |
| Packaging | Reproducible source TAR, checksums, source manifest | Third-party image remediation and binary notice/source obligations |
| Monitoring | Liveness/readiness, doctor and local status | Operator alerting, retention, incident response and capacity limits |

The owner must later provide a server target, private secret distribution, domain/TLS
decisions, backup destination and recovery objectives, monitoring ownership and a
maintenance/patch policy. Layer 2 remains a separate application project using public
Core contracts; the Console does not meet the business application requirement.

## Publishing a GitHub Release

The owner publishes a final version from a committed `main` checkout after CI passes:

```sh
npm run release:package
npm run release:verify
gzip -9 -k -n dist/releases/junctura-0.1.0.tar
git tag -a v0.1.0 -m "Junctura v0.1.0 - Layer 1 Foundation and Capability Services"
git push origin v0.1.0
```

On GitHub, create a release from tag `v0.1.0` and attach `junctura-0.1.0.tar.gz`,
`junctura-0.1.0.tar.sha256` and `junctura-0.1.0.manifest.json`. List unresolved
upstream image advisories from [SECURITY_REVIEW.md](SECURITY_REVIEW.md) under
**Known issues**; they are tracked, not hidden.
