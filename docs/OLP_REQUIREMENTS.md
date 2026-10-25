# OLP PMNM 2026 — Competition Compliance

The [consolidated requirement matrix](architecture/OLP_REQUIREMENT_TRACEABILITY.md)
records the official pages read on 2026-10-26, baseline evidence, broader service
groups, four technical principles and unresolved submission risks. This file
remains the quick submission checklist; the organizer's pages remain authoritative.

## Official references

- Problem statement: https://vfossa.vn/tin-tuc/de-thi-phan-mem-nguon-mo-olp-2026-798.html
- Rules/scoring: https://vfossa.vn/tin-tuc/the-le-olp-phan-mem-nguon-mo-nam-2026-760.html

Verify the latest organizer announcements before submission. The references, not this summary, are authoritative.

## Product scope

- Layer 1: reusable, **headless** PaaS Core. Minimum capabilities: (1) Identity/SSO, (2) API Gateway, (3) structured data management, (4) unstructured data management, (5) workflow engine.
- Layer 2: at least **one functional GUI application** in H/P/D/I that uses the Core.
- Open-core means independently reusable services, not simply a single application's backend split into folders.
- Technology examples in the problem are **references, not required brands**.

## Source openness and submission

- Publish project source in an accessible Internet repository under an OSI-approved license, with compatible rights to distributed components.
- Maintain versioned source releases, reproducible source-build instructions, documented dependencies, README, change history, and issue tracking.
- The official problem's submission section gives **2026-12-06 17:00 Vietnam time**; verify later organizer notices before submitting.
- The official rules split scoring into 50 points for FOSS/project practices and 50 points for product quality. Review the detailed rows, including the archive-format clarification recorded in the matrix.

## Pre-submission review

- [ ] Confirm updated official rules/deadline.
- [ ] Public repository, license and third-party notices in place.
- [ ] A versioned release exists before the deadline.
- [ ] Clone/build/run on a clean environment without editing source to configure it.
- [ ] Required five Core capabilities work together.
- [ ] Layer 2 GUI uses Core in an end-to-end scenario.
- [ ] README, setup, architecture, dependency list, changelog, and issue tracker are usable.

**Note:** Exact scoring deductions and interpretations of license-header/source archive requirements should be checked directly against the official rules before final release.
