# DX-OS — AI Agent Instructions

These rules apply to every coding task in this repository. **Read the linked documents when relevant.** Official OLP rules take precedence over internal project conventions. Never invent competition requirements.

## Non-negotiable rules

1. **Competition scope:** Keep the Layer 1 PaaS headless and reusable. Deliver the five required capabilities (Identity/SSO, API Gateway, structured data, unstructured data, workflow) and at least one Layer 2 GUI application using the Core. See [`docs/OLP_REQUIREMENTS.md`](docs/OLP_REQUIREMENTS.md).
2. **Open-source compliance:** Do not select/change the project's license. Check the root `LICENSE` before adding code. Use the approved SPDX/copyright convention, preserve third-party notices, and record dependencies. **Stop and report a blocker if licensing is unresolved.** See [`docs/LICENSING.md`](docs/LICENSING.md).
3. **Architecture:** Keep domain/business logic out of the reusable Core. Apps integrate through documented APIs/contracts. Do not add a service, framework, or breaking API without justification and approval. See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
4. **Security:** Never commit credentials or real private data. Enforce authorization server-side, validate untrusted input, and isolate tenants. Never bypass security checks to make a demo pass.
5. **Repository hygiene:** Inspect existing code before editing; reuse established patterns. Avoid duplicate files, speculative features, unrelated refactors, generated clutter, and unused dependencies.
6. **Quality:** Add/update relevant tests and documentation; run available checks. Never claim a test, build, license audit, or deployment succeeded unless verified. See [`docs/WORKFLOW.md`](docs/WORKFLOW.md).
7. **Safe operations:** Do not force-push, rewrite Git history, delete data, run destructive migrations, or deploy to production without explicit approval.
8. **Honest handoff:** Report changed files, checks run, checks not run, remaining risks, and decisions requiring approval.

## Before each task

- Identify the affected Core/App boundaries and read the relevant docs.
- Keep the change minimal and reviewable; do not silently expand scope.
- If a requirement, license, API contract, or security decision is unclear, stop the affected action and ask instead of guessing.

## Reference documents

- [`docs/OLP_REQUIREMENTS.md`](docs/OLP_REQUIREMENTS.md) — competition requirements and submission checklist
- [`docs/LICENSING.md`](docs/LICENSING.md) — license, SPDX, dependency and asset rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — platform boundaries and service contracts
- [`docs/WORKFLOW.md`](docs/WORKFLOW.md) — coding, verification, release workflow

> Internal policies in these files are safeguards, **not** additional claims about the organizer's official rules.
