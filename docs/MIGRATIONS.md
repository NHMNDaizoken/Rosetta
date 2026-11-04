<!-- SPDX-FileCopyrightText: 2026 Junctura Contributors -->
<!-- SPDX-License-Identifier: Apache-2.0 -->

# Database migrations and schema integrity

The migration runner is `infra/postgres/migrate.sh`. Compose runs it as the
one-shot `data-migrate` service before `data` and `core` start. It is the only
supported way to apply migrations.

## Guarantees

- Every applied migration is recorded in `core.schema_migration_checksums`
  together with the SHA-256 of the exact file content.
- The checksum is inserted in the same transaction that applies the migration.
  `BEGIN;`/`COMMIT;` inside the file are stripped and the body runs under
  `psql --single-transaction`, so a failure leaves neither objects nor a
  checksum behind.
- Applied files are immutable. Editing one makes the runner refuse with
  `content differs from its recorded checksum`.
- A checksum present without the matching version row, or a version row without
  a checksum, is refused instead of guessed.
- The runner refuses a database whose `max(version)` is newer than the local
  migration set.
- `core.schema_migration_state` stores a fingerprint of installed function
  definitions, owners, ACLs, table RLS flags, column grants and policies. A
  mismatch is `installed schema drift` and stops the run before any new SQL.
- Two runners serialize through `flock` and a PostgreSQL advisory lock.

Existing migrations `001`-`012` and the tables they create are not modified by
this mechanism. The two bookkeeping tables are created by the runner itself.

## Normal operation

```sh
docker compose run --rm data-migrate
```

Expected output is `Migration N verified` for each applied version and
`Migrations current at version N`.

## Failure reference

| Message | Meaning | Action |
| --- | --- | --- |
| `applied-version integrity` / `duplicate local migration version` | A historical migration file is missing or version numbers collide. | Restore the exact matching migration set. Never remove ledger entries to make startup pass. |
| `content differs from its recorded checksum` | An applied file was edited or replaced. | Restore the original bytes. Never edit applied history; add a new migration. |
| `recorded as applied without a checksum` | Version-only history from an older runner. | Follow adoption below. |
| `installed schema drift detected` | Functions, owners, ACLs, RLS or policies differ from the recorded fingerprint. | Inspect the difference, restore the expected schema, or record a reviewed adoption. |
| `database schema is newer than this migration set` | The checkout is older than the database. | Deploy the matching runner; do not replay older authority SQL. |
| `could not acquire the database migration lock` | Another runner held the advisory lock for 120 s. | Confirm the other run finished; investigate a stuck session. |
| `checksum ... exists but the version is not applied` | Partial bookkeeping. | Stop and restore from backup; do not guess. |

## Operator adoption (version-only history)

A database created before checksum enforcement has version rows but no
checksums. Adoption records the checksum of the files that are actually
installed. It does not prove what was originally applied.

1. Take a verified backup (`pg_dump`) and keep the volume.
2. Run the runner without flags. It must stop at the first version-only entry.
3. Compare installed definitions, owners, ACLs and RLS with the expected
   migrations. `scripts/check-schema-drift.mjs` prints the fingerprint inputs
   and refuses to modify anything.
4. Only after that review, run:
   ```sh
   docker compose run --rm -e MIGRATION_ADOPT_EXISTING=1 data-migrate
   ```
5. Re-run without flags. The result must be `Migration N verified` for each
   version and no `Applying migration` line.

## Operator adoption (installed drift)

When the fingerprint differs but the schema is intentionally different (for
example a manually restored provider fix):

1. Capture the difference (`pg_dump --schema-only` or the drift report).
2. Record it in the change review and a new forward migration if it must persist.
3. If the difference is the reviewed baseline, run once with
   `MIGRATION_ADOPT_SCHEMA_DRIFT=1`; then re-run without flags.

Using either adoption flag is a production decision. It is not a way to make a
demo pass.

## Tests

`npm run test:migrations` starts a disposable, network-isolated PostgreSQL
container and proves:

- fresh install records every checksum in the applying transaction;
- repeat execution verifies without replaying;
- edited applied content fails closed;
- an interrupted migration leaves neither objects nor a checksum;
- concurrent runners converge;
- version-only history requires explicit adoption;
- installed drift is detected and only adopted after review;
- a database newer than the runner is refused.

`scripts/check-schema-drift.mjs` is the read-only diagnostic used by operators
and CI. It needs `DATABASE_SERVICE` (default `database`) and prints either
`schema matches the recorded fingerprint` or the expected/actual fingerprints.

## Audit hash chain (018)

Migration 018 adds nullable `chain_seq`, `prev_hash` and `entry_hash` columns to
`app_private.audit`, a forced-RLS `app_private.audit_chain_heads` table and
`core.audit_verify(jsonb)`. Existing events are not rewritten by the migration;
they are sealed by the first verification. See [AUDIT](AUDIT.md#tamper-evident-hash-chain).

## Trust graph (019)

Migration 019 only adds the read-only `core.trust_graph(jsonb)` function (no table or
column changes) and grants it to `junctura_trust_api`. See
[CAPABILITY_DIRECT_TRUST](CAPABILITY_DIRECT_TRUST.md#trust-graph-019).

## C4B forward corrections

Migrations 013-017 are additive corrections to 012, preserving existing records,
ownership, forced RLS and audit. The version-16 runner first verifies the old
fingerprint scope, then includes `composition_private` in the new fingerprint.
No adoption flag is needed for this transition. The drift test also proves
Composition RLS tampering is rejected. CRLF transaction delimiters are stripped
before execution, while checksums still hash the original file bytes; 013's
applied CRLF bytes are explicitly preserved by `.gitattributes`. Never normalize
an already-applied migration or replace its recorded checksum silently.

The inspected development checkout also contains pre-existing mixed line endings
in 006. Its original working-tree bytes match that database's checksum and were
left unchanged. A future replacement with Git-normalized bytes must fail the
checksum check; investigate/restore the recorded bytes rather than treating it as
permission to reapply authority SQL. Fresh installs hash their actual checkout.
