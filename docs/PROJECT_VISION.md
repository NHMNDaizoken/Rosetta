# Rosetta DX-OS project vision

Rosetta is an open-source, reusable, headless Layer-1 PaaS for independent Layer-2 products. Its direction is Capability-Driven DX-OS: products can use shared infrastructure, and may later publish or consume capabilities under explicit contracts and trust rules. Products can be written in different languages and retain their own interfaces, domain logic and development lifecycles.

The five foundational Cores are implemented in a local Docker Compose stack. The four capability Cores and Verifiable Capability Composition described below are proposals, not implemented services or approved API contracts. This document preserves the product concept; it does not authorize new implementation scope or add requirements to the organizer's official competition rules.

## Two ways to use the platform

An application can use Identity/SSO, the Gateway, structured records, opaque objects and workflows directly through public APIs. It does not need a capability registration to use those foundational services.

In the proposed capability-enabled path, an application also publishes explicitly described operations or consumes operations published by other authorized applications. A composition links those operations after platform checks. This path builds on the foundational Cores and their authorization boundaries.

HTTP APIs are the interoperability boundary. Future language-specific SDKs can improve usability, but must remain optional. The [extension contract](CAPABILITY_EXTENSIONS_V1.md) and [OpenAPI](contracts/capability-api-v1.openapi.json) specify the capability direction. [Application Registration](APPLICATION_REGISTRATION.md) is the first implemented control-plane subset; registry, resolver and composition remain proposed. A complete foundational OpenAPI contract and optional SDKs remain planned; current working APIs are described in [CORE_API.md](CORE_API.md).

## Ownership and architectural boundaries

Layer 1 owns generic platform mechanisms: identity, routing, tenant-scoped storage, durable workflow execution and the proposed capability/trust mechanisms. Layer 2 owns domain models, business decisions, user interfaces and the implementation of application capabilities. A platform schema validator can check a declared input; the application remains responsible for what that input means in its domain.

Layer-2 products must use documented APIs without depending on another product's private database. Publishing a capability does not publish its underlying data or grant authority to invoke it. An application must be able to remain a standalone consumer of foundational services without adopting composition.

Existing open-source providers supply infrastructure. Rosetta's public contracts should limit unnecessary coupling, while documenting provider-specific behavior. Changing an identity provider, storage backend or workflow engine can require migration and compatibility testing. No universal hot-swap guarantee is proposed.

## Foundational Cores

| Core | Platform responsibility | Current provider |
| --- | --- | --- |
| Identity / SSO | Authenticate principals and enforce verified tenant/role boundaries. | Keycloak and Core token introspection. |
| API Gateway | Route requests through an authenticated, bounded entry point. | Nginx OSS. |
| Structured Data | Persist tenant records with server-side isolation. | PostgreSQL + PostgREST and Core adapters. |
| Unstructured Data | Persist opaque objects with tenant-scoped access. | SeaweedFS OSS and Core adapters. |
| Workflow Engine | Maintain durable executions, tasks and history. | Flowable REST with PostgreSQL. |

Current verification covers the [foundation integration criteria](INTEGRATION_ROADMAP.md). It includes a technical record/object/workflow scenario, not a business workflow or a capability-composition runtime.

## Four proposed capability Cores

### Capability Registry Core

The registry would describe discoverable capabilities with a stable identifier, version, owning application, input/output contracts, authorization requirements and execution conditions. Discovery would respect visibility and trust scope. Registration, update, retirement and access policies need reviewed contracts.

A discoverable description is evidence about an operation's declared interface, not proof that its implementation is correct or that every caller may use it.

### Compatibility Resolver Core

The resolver would check supported connections between declared outputs and inputs, together with relevant permissions and workflow constraints. It should report what was checked, what failed and what remains unproven. Unsupported or ambiguous transformations must not be silently treated as compatible.

Schema compatibility alone cannot establish semantic equivalence. Two fields with the same type can represent different units or business concepts. The supported schema dialect, compatibility rules and any explicit transformations remain design decisions; no resolver or automatic adapter exists today.

### Composition & Execution Core

This Core would represent a plan connecting capabilities, validate its bindings and conditions, and coordinate an accepted plan through the Workflow Engine. It would supply platform-level orchestration; each application would continue to enforce its domain rules and service authorization.

Composition does not replace Flowable or another underlying engine. How plans map to versioned workflow definitions, how results are validated, and how timeouts, partial failure, cancellation and retries are handled need explicit contracts. The current workflow start ledger is a foundation mechanism, not an implementation of cross-application composition or exactly-once business effects.

### Cross-App Trust Core

This Core would define which principals/applications can publish, discover, invoke or delegate capabilities, for which tenants/resources and under which conditions. A caller's ability to discover an operation must not imply permission to invoke it. Delegation must not silently expand the original caller's authority.

Trust ownership, grants, revocation, credential propagation and audit visibility need a separate threat model and contract review. Current verified tenant claims and reader/writer roles do not provide this proposed trust/delegation model.

## Verifiable Capability Composition

The intended lifecycle is:

1. Publish versioned capability descriptions and their declared constraints.
2. Discover candidates within the caller's permitted trust scope.
3. Submit a proposed composition with explicit input/output bindings.
4. Run deterministic compatibility, permission and workflow-constraint checks.
5. Reject failed or unresolved requirements, or accept a validated plan for authorized execution through the Workflow Engine.
6. Revalidate actual inputs, execution conditions and current permissions at service boundaries. Check returned values and preserve authorized execution evidence for diagnosis.

"Verifiable" refers to defined checks with inspectable results. It is not a promise of formal proof for arbitrary programs, business correctness, provider availability or exactly-once external side effects. Preflight and runtime checks serve different purposes: a previously valid plan can fail after a permission revocation, schema change or dependency outage.

AI may eventually propose plans or help discover candidates. Any planner output must pass the same deterministic checks as a human-authored plan. The planner must not bypass Core authorization, expand a trust scope or directly acquire provider credentials. No AI integration is currently implemented or selected.

## Example and validation direction

The [README example](../README.md#illustrative-cross-application-use-case) describes an intake application and a review application. Their business operations belong to those applications; Rosetta would own the generic checks and orchestration. The example is illustrative and supplies no domain-specific code or commitments about a future demonstration product.

Before implementing extensions, review capability publication/versioning, supported schema compatibility, trust/delegation, workflow binding and failure semantics. A useful acceptance scenario would demonstrate both a valid connection and rejected incompatible inputs, unauthorized invocation, revoked permission, cross-tenant access and unsafe retry. Evidence must distinguish static validation from runtime enforcement and external side effects.

## Development and operational scope

The implemented scope is the five-Core Layer-1 foundation, with source tests, real-service integration checks and isolated structured-data restore verification. Future work includes OpenAPI, optional SDKs, the proposed capability Cores and independent Layer-2 products. Optional AI planning remains a separately reviewed integration. No GUI, registry or composition runtime is implemented here.

Docker Compose is the initial self-hosting strategy. A VPS and public domain are future operational choices; no Kubernetes or OpenStack work is planned in this scope. Public deployment needs an approved target, TLS, secret management, full-platform recovery and rollback verification. Current limits are documented in [OPERATIONS.md](OPERATIONS.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for current service boundaries and [INTEGRATION_ROADMAP.md](INTEGRATION_ROADMAP.md) for foundational acceptance criteria. The README's [development roadmap](../README.md#development-roadmap) connects that foundation to the proposed product direction.

The [Capability v1 design](CAPABILITY_EXTENSIONS_V1.md) now makes concrete proposed choices for the model above. Its [trust/execution rules](CAPABILITY_TRUST_EXECUTION_V1.md) and [acceptance gates](CAPABILITY_ACCEPTANCE_V1.md) require review before runtime work; their publication is not implementation approval.
