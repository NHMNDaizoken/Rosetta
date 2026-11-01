# Layer 1 implementation status

Updated: 2026-11-01 | Branch: main

This records implementation and verification, not new competition rules. The
continuation started with a clean tree at local and remote
`ff16a5e61d6405a25c1f7fdc3ade289732b21fbb`. Its successful
[Actions run](https://github.com/NHMNDaizoken/Rosetta/actions/runs/41313291206)
was independently confirmed through GitHub REST; it contained no real C4B suite.
Current exact-SHA CI evidence belongs in the
[engineering handoff](CODEX_LAYER1_REVIEW_HANDOFF.md).

## Implemented

- Five reusable headless Foundation capabilities: Identity/OIDC, gateway,
  PostgreSQL structured data, SeaweedFS objects and Flowable workflows.
- Application Authority, v2 ownership/read sharing, protected Audit, C1 Registry,
  C2 same-tenant direct grants/discovery and bounded offline C3.
- C4A guarded single invocation, opt-in and disabled by default.
- C4B registry, plan validation, deterministic BPMN compiler and runtime, opt-in
  and disabled by default. Real two-provider HTTP/OIDC/PostgreSQL/Flowable
  execution verifies output transfer, single-use tickets, result isolation and
  naturally completed engine history.
- C4B fail-closed recovery covers lost start responses, missing/multiple matches
  or history, lost credentials, uncertain provider/worker completion, deadlines,
  late output and observable termination failure. No C4B resume, blind restart
  or automatic redispatch. See the [state matrix and reproduction guide](../CAPABILITY_COMPOSITION.md).
- Migrations 001-012 are preserved. Additive 013-017 correct authority, exact
  approval/revision binding, per-step hashes, durable operation IDs, terminal
  immutability and exact reserved grants. Replacement grants cannot revive a
  reservation tied to a revoked grant.
- Checksums, concurrent-run serialization and drift checks remain enforced.
  Version 16 extends fingerprints to Composition functions, owners, ACLs and
  forced RLS after verifying the previous scope, without adoption flags.
- Feature-first `src/platform`, `src/bootstrap`, `src/modules/*` structure;
  28 sources, declared public entrypoints, downward dependencies and no cycles.

## Newly executed local verification

Shared-stack restart suites must run sequentially. Fresh isolated database and
Console checks can run independently. Final C4B/CI evidence is completed in the
handoff before declaring the milestone done.

| Command | Result |
| --- | --- |
| `npm run check` | pass; syntax, SPDX, license metadata and 28-source boundaries |
| `npm test` | 65 pass |
| `npm run test:migrations` | 9 pass; fresh install through 017, checksum/interruption/concurrency/adoption/drift controls |
| `npm run test:execution-ledger` | 4 pass |
| `npm run test:provider-network` | 7 pass |
| `npm run test:integration` | 9 pass; 128 responses, 26 covered operations |
| `npm run test:applications` | 13 pass; 247 responses, 31 covered operations |
| `npm run test:capabilities` | 26 pass; 244 observed schema cases |
| `npm run test:audit` | 7 pass |
| `npm run test:recovery` | 1 pass; Composition ownership/ACL/RLS included |
| `npm run test:flowable-worker` | 2 pass; lock ownership/expiry, fail/complete and zero retries |
| `npm run test:compositions` | 29 pass; 186 observed schema cases; real engine/provider, security, recovery and restore |
| `npm run check:contracts` | pass; Foundation 44 operations and Composition 11-operation route/source/status inventory |
| `npm run test:contract-validator` | pass; missing/wrong Composition routes, sources and handlers rejected |
| `npm run console:test` | 28 pass |
| `npm run console:build` | pass |
| `npm run console:check:endpoints` | pass; 44 operations current |
| `npm run test:console-container` | pass; packaged image build and contract probe |
| `docker compose config --quiet` | pass |
| `docker compose up --build --detach --wait --wait-timeout 240` | pass; local services healthy, initializers exited successfully |
| `npm run healthcheck` | pass |
| `npm run check:schema-drift` | pass; development database upgraded through 017 without adoption flags |

The default development gateway retained C4A/C4B disabled. No production deploy,
volume deletion, new dependency, license change, binary publication,
vulnerability audit or comprehensive license audit was performed.

## Limits and next work

C4B supports directly authorized same-tenant exact pure JSON capabilities. Human
delegation, general side effects, automatic retries, HA, public cancel/resume and
caller-supplied BPMN/provider URLs remain unsupported. Lost initiating authority
is never replaced by executor credentials. Restart recovery is observation-driven:
unobserved SQL labels may remain active until an authorized status read; engine
deadlines and absence of a worker lease still prevent dispatch. Missing/multiple
engine correlation requires investigation. Known step outputs may coexist with
an unknown overall outcome.

Development migration 006 has pre-existing mixed line endings matching its
installed checksum; it was not modified. Preserve the recorded bytes when
replacing a checkout. See [migration operations](../MIGRATIONS.md).

Layer 2 was not started. Exact-SHA CI must succeed before handing off this
bounded Layer 1 milestone for selection of the required Layer 2 GUI application.
Competition submission, a versioned source release, production readiness and
full-platform disaster recovery remain separate gates.
