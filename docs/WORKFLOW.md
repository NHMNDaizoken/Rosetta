# Development and Release Workflow

## Before editing

1. Read `AGENTS.md`, relevant module docs and existing code; inspect current repo conventions.
2. Define the smallest change, impacted APIs/schemas, risks and expected tests.
3. Confirm new dependencies and license decisions before installation.

## While editing

- Keep Core and Apps separated; avoid unrelated refactoring, duplicate utilities, unnecessary abstractions and stray scratch files.
- Never commit `.env`, secrets, access tokens, private data, caches, dumps or generated binaries without explicit need.
- Use input validation, safe SQL queries, backend authorization, constrained upload handling and sensible timeouts.
- For retries with side effects, use an idempotency strategy; fail closed when permissions cannot be confirmed.
- Do not disable validation, tests or security scanning merely to obtain a green result.
- Document public API/contract changes and update tests as part of the code change.

## Completion report (mandatory)

Include:
- Files changed and why.
- Exact tests/build/lint commands run with results, plus checks you could not run.
- New dependencies, license impact and unresolved risks.
- Any required human approvals or migration/rollback steps.

## Release procedure

1. Run test, build, security and license checks on a clean checkout.
2. Confirm readable README, build instructions, `.env.example`, changelog, issue tracker, license and dependency inventory.
3. Tag a version and publish a source release in a format accepted by the organizer; verify the current rules.
4. Verify deployment and the Core-to-App end-to-end demo.

Do not claim a build or release is reproducible unless it has been tested.
