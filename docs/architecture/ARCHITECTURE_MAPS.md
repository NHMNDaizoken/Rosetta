# Editable architecture maps

> Reviewed: 2026-10-26 | Branch: main | Audit baseline: `7fdd7fc381bdd29d81d56fb08a764efff8c41582`

Legend: **VERIFIED** means the bounded source/test evidence in the
[catalog](LAYER1_CORE_CATALOG.md), not live production. In flowcharts, solid arrows represent
current integrations; dashed arrows and outlined PROPOSED/DESIGN ONLY nodes
represent future relationships. Sequence arrows describe proposed interactions;
participant labels and captions identify the current providers. CONTEXT identifies official conceptual layers,
not running components. PARTIALLY VERIFIED identifies Console/operations limits.
All eight diagrams are editable Mermaid; they do not authorize implementation.

Current update (2026-10-29): C1 Registry, bounded direct C2 Trust/discovery and
A1 Audit are implemented; C3 is offline. Human delegation and C4 execution are
unimplemented. See [direct Trust](../CAPABILITY_DIRECT_TRUST.md) for scope/evidence.

## MAP 01: Competition and product context

```mermaid
flowchart TB
  L3["CONTEXT: Layer 3<br/>industry products and business rules"]
  L2["CONTEXT: Layer 2 H-P-D-I<br/>required GUI product; DEFERRED"]
  L1["VERIFIED: Rosetta Layer 1<br/>five headless capabilities"]
  EX["PROPOSED product model A<br/>external application"]
  HO["PROPOSED product model B<br/>Rosetta-hosted application"]
  UI["PARTIALLY VERIFIED<br/>optional management Console"]
  CAP["PARTIAL Capability overlay<br/>C1/direct C2; offline C3; C4 future"]
  EXT["PROPOSED Rosetta extensions<br/>projects and hosting"]
  L3 -.->|business capabilities use| L2
  L2 -.->|required demo consumes APIs| L1
  EX -.->|same public APIs| L1
  HO -.->|same public APIs| L1
  HO -.->|execution managed by| EXT
  UI -->|selected existing management calls| L1
  UI -.->|future management calls| EXT
  CAP -.->|optional authorized composition| EX
  CAP -.->|optional authorized composition| HO
  L1 -.->|Foundation reused by| EXT
  classDef future fill:#fff8eb,stroke:#92734b,stroke-dasharray:5 5
  class EX,HO,CAP,EXT future
```

Official context is traced in [the requirement matrix](OLP_REQUIREMENT_TRACEABILITY.md).
Hosting and composition are Rosetta extensions. Console is not the required
business GUI. Business schemas/decisions remain in L2/L3 even when hosted by Rosetta.

## MAP 02: Current implemented architecture

```mermaid
flowchart TB
  TEST["VERIFIED test/API clients"] -->|loopback HTTP| NG["VERIFIED Nginx<br/>edge Gateway"]
  subgraph CORE["VERIFIED Core process"]
    RT["API router / auth"]
    AA["Application Authority adapter"]
    RA["Resource authorization adapter"]
    CR["C1 Registry / direct C2 Trust"]
    DA["Record adapter"]
    OA["Object adapter"]
    WA["Workflow adapter"]
  end
  subgraph ID["Private identity network"]
    KC["VERIFIED Keycloak"]
  end
  subgraph DN["Private data network"]
    PR["VERIFIED PostgREST"]
  end
  subgraph ON["Private objects network"]
    SW["VERIFIED SeaweedFS<br/>owns bytes and filer metadata"]
  end
  subgraph WN["Private workflow network"]
    FL["VERIFIED Flowable<br/>owns tasks and history"]
  end
  PG["VERIFIED PostgreSQL / postgres-data<br/>identity DB; data DB; workflow DB<br/>separate owners, shared process"]
  NG -->|OIDC passthrough| KC
  NG -->|auth_request and versioned APIs| RT
  RT -->|live introspection| KC
  RT -->|management dispatch| AA
  RT -->|capability and grant dispatch| CR
  CR -->|private Registry/Trust RPC and Audit| PR
  RT -->|record dispatch| DA
  RT -->|object dispatch| OA
  RT -->|workflow dispatch| WA
  DA -->|v2 assertions and ownership| RA
  OA -->|v2 metadata authorization| RA
  RA -->|resource RPC and RLS| PR
  AA -->|private authority RPC| PR
  DA -->|records and tenant RLS| PR
  OA -->|generated version paths| SW
  WA -->|tenant ledger| PR
  WA -->|tenant checked REST| FL
  KC -->|rosetta_identity| PG
  PR -->|rosetta_data and private authority| PG
  FL -->|rosetta_workflow| PG
```

The PostgreSQL container joins identity/data/workflow networks; it is one shared
failure domain. SeaweedFS persists to `object-data`. The optional Console profile
is not included as a verified runtime integration here: only selected calls and
preview tests are established. Private provider ports are not published; broad
Keycloak passthrough still needs an Internet-exposure review.

## MAP 03: Target logical Core taxonomy

```mermaid
flowchart TB
  A["VERIFIED A<br/>Identity; Gateway; Data; Objects; Workflow"]
  AP["VERIFIED A+<br/>Authority; ownership; read sharing; contracts"]
  B["PROPOSED B<br/>quarantine; cleanup; history; workers; credential lifecycle"]
  C["PARTIAL C<br/>A1 audit implemented; other candidates proposed"]
  D["PARTIAL D<br/>C1/direct C2 implemented; offline C3; C4 future"]
  E["PARTIALLY VERIFIED E<br/>CI and health; PROPOSED production operations"]
  F["PROPOSED F<br/>projects; deployments; runtime; routing; bindings; diagnostics"]
  UI["PARTIALLY VERIFIED Console<br/>management client"]
  L2["DEFERRED separate Layer-2 product"]
  AP -->|reuses existing providers| A
  B -.->|extends logical responsibilities| A
  C -.->|reuses authority and APIs| AP
  D -.->|authority and Flowable reuse| AP
  D -.->|existing engine| A
  F -.->|same app/resource identity| AP
  F -.->|applications consume| A
  F -.->|scoped bindings where needed| C
  E -.->|operates and recovers| F
  E -->|existing checks| A
  UI -->|existing selected routes| AP
  UI -.->|future control API| F
  L2 -.->|public APIs; optional hosting| A
  classDef future fill:#fff8eb,stroke:#92734b,stroke-dasharray:5 5
  class B,C,D,F,L2 future
```

Group C is a candidate catalog; F does not depend on every C service. A narrow
secret/binding and protected-audit contract may be needed before hosting enablement.
Group letters and F modules are not container counts or new competition minimums.

## MAP 04: Control, data, runtime and operational planes

```mermaid
flowchart TB
  CON["PARTIALLY VERIFIED<br/>Rosetta Admin Console"]
  DEV["PROPOSED Developer Console"]
  MG["PROPOSED Platform Management API<br/>intent and policy, no daemon access"]
  AA["VERIFIED Application Authority"]
  CT["PROPOSED private Deployment Controller<br/>typed work; lease and fencing"]
  WK["PROPOSED approved Runtime Worker<br/>privileged infrastructure boundary"]
  APP["PROPOSED trusted hosted app"]
  EXT["PROPOSED external app"]
  API["VERIFIED API Gateway"]
  ING["PROPOSED app ingress<br/>separate hostname and route revision"]
  DATA["VERIFIED Foundation BaaS"]
  OPS["PROPOSED operational systems<br/>audit; backup; telemetry; image policy"]
  CAP["PARTIAL Capability overlay<br/>C1/direct C2 implemented; C4 future"]
  CON -->|selected existing APIs| AA
  CON -.->|authorized management intent| MG
  DEV -.->|authorized management intent| MG
  MG -.->|checks app state and permissions| AA
  CT -.->|leases persisted intent; reports observations| MG
  CT -.->|authenticated admitted workload| WK
  WK -.->|supervises within limits| APP
  CT -.->|restricted route revision| ING
  ING -.->|healthy application traffic| APP
  APP -.->|same authenticated APIs| API
  EXT -.->|same authenticated APIs| API
  API -->|existing routed services| DATA
  OPS -.->|operates privileged worker| WK
  OPS -.->|protected intent and outcomes| MG
  CAP -.->|optional authority and execution| DATA
  classDef future fill:#fff8eb,stroke:#92734b,stroke-dasharray:5 5
  class DEV,MG,CT,WK,APP,EXT,ING,OPS,CAP future
```

Control/data/worker interfaces are distinct even on one VPS. Consoles never
connect to WK, Docker sockets or provider credentials. Capability overlay is not
on the ordinary BaaS/hosting request path. Operational host access remains trusted.

## MAP 05: Resource ownership and trust

```mermaid
flowchart TB
  ID["VERIFIED Keycloak<br/>issuer; subject; client; tenant membership"]
  AUTH["VERIFIED Rosetta Authority<br/>enrollment and active app lookup"]
  A["VERIFIED registered App A UUID"]
  B["VERIFIED registered App B UUID"]
  REC["VERIFIED private records / objects<br/>tenant + owner app UUID"]
  SHARE["VERIFIED exact read share<br/>owner authorized; expiry and revoke"]
  LEG["VERIFIED separate v1 namespace<br/>operator client allowlist"]
  WF["VERIFIED workflow namespace<br/>tenant reader/writer; no app isolation"]
  PROJ["PROPOSED tenant project<br/>explicit project management permissions"]
  ENV["PROPOSED environment<br/>app mapping; no owner rewrite"]
  HOST["PROPOSED hosting permission<br/>deployment and route intent"]
  SEC["PROPOSED service binding<br/>exact app/environment secret delivery"]
  TRUST["IMPLEMENTED direct grant<br/>discover / future invoke eligibility"]
  AUDIT["A1 bounded audit IMPLEMENTED<br/>export/integrity PROPOSED"]
  ID -->|verified context only| AUTH
  AUTH -->|resolves backend subject| A
  AUTH -->|resolves backend subject| B
  A -->|owner-only writes via Core and SQL| REC
  A -->|explicit exact-resource authorization| SHARE
  SHARE -->|B can only read while both active| B
  SHARE -->|SQL checks resource and current state| REC
  ID -->|separate allowlist required| LEG
  ID -->|tenant membership and baseline roles| WF
  AUTH -.->|authority reused by management| PROJ
  PROJ -.->|contains; does not grant data rights| ENV
  ENV -.->|explicit app attachment| A
  ENV -.->|separate permission evaluated| HOST
  ENV -.->|approved binding target| SEC
  SEC -.->|private delivery to exact backend| A
  AUTH -->|active app prerequisite| TRUST
  HOST -.->|sensitive change evidence| AUDIT
  TRUST -->|atomic trust evidence| AUDIT
  classDef future fill:#fff8eb,stroke:#92734b,stroke-dasharray:5 5
  class PROJ,ENV,HOST,SEC future
```

Project/deployment rights never imply v2 reads. Domain authorization belongs in
the Layer-2 backend; a browser does not become App A by submitting its UUID.
Resource shares and Capability grants have separate contracts and authorities.

## MAP 06: Proposed deployment lifecycle

Every hosting step below is PROPOSED; the Authority participant reuses existing
registration truth. There is no running deployment feature represented here.

```mermaid
%%{init: {"sequence": {"wrap": true, "actorMargin": 30, "width": 120}}}%%
sequenceDiagram
  actor D as Developer PROPOSED
  participant UI as Console PARTIAL
  participant CP as Control PROPOSED
  participant AA as Authority VERIFIED
  participant AU as Audit A1 bounded
  participant C as Controller PROPOSED
  participant W as Worker PROPOSED
  participant I as Ingress PROPOSED
  D->>UI: Select project/environment and admitted artifact digest
  UI->>CP: Deployment intent with revision/idempotency key
  CP->>AA: Check tenant, active app mapping and current authority
  AA-->>CP: Authoritative application state
  CP->>CP: Check deploy permission, entitlement and artifact/resource policy
  CP->>AU: Append protected local event through owner interface in transaction
  CP->>CP: Commit deployment intent, local audit and outbox atomically
  CP-->>UI: Accepted operation ID, desired generation
  C->>CP: Lease and fence admitted work
  C->>AA: Recheck active application before side effect
  C->>W: Start exact digest with bounded profile and approved references
  W-->>C: Instance identity and observed generation
  C->>I: Prepare disabled candidate route, preserve previous revision
  C->>W: Evaluate bounded readiness on approved workload path
  alt Candidate healthy and authority still valid
    W-->>C: Ready observation
    C->>I: Validate and activate route revision
    I-->>C: Observed active revision
    C->>CP: Ready status and audited outcome
    CP-->>UI: Authorized deployment status
  else Unhealthy, denied, partial failure or unknown result
    C->>W: Inspect/reconcile generation, do not blindly start again
    C->>I: Retain last-known-good route or keep candidate disabled
    C->>CP: Failed/unknown observation and partial-outcome audit
  end
  opt Update or rollback explicitly authorized
    D->>CP: New intent for immutable release/config, no implicit data rollback
    CP->>CP: Revalidate permissions, capacity, revocation and references
  end
```

The controller may itself be unavailable; ongoing healthy workloads must not
depend on browser or per-request controller availability. [Failure table](DEPLOYMENT_MODEL.md#failure-contract)
defines the remaining target obligations.

## MAP 07: Dependency and implementation DAG

```mermaid
flowchart TB
  BASE["VERIFIED current Foundation A/A+"]
  K0["PROPOSED K0 contract approval"]
  S0["PROPOSED FIRST S0<br/>Console trust; S0B packaging follows separately"]
  META["PROPOSED P1 then P2<br/>project/environment metadata and policy"]
  CONTROL["PROPOSED D1<br/>hosting intent and reconciliation"]
  SAFE["PROPOSED O1<br/>admission and recovery proof"]
  AUDIT["A1 IMPLEMENTED<br/>bounded protected audit"]
  SECRET["PROPOSED B1<br/>scoped bindings"]
  RUN["PROPOSED R0<br/>restricted runtime integration"]
  TLS["PROPOSED T1<br/>app ingress and TLS"]
  DOMAIN["DEFERRED T2<br/>custom domains"]
  HOST["PROPOSED H1<br/>integrated hosted BaaS"]
  OPT["DEFERRED OPT<br/>selected shared extension"]
  REG["IMPLEMENTED C1 Registry"]
  TRUST["IMPLEMENTED direct C2 Trust<br/>human delegation deferred"]
  RES["OFFLINE C3 Resolver"]
  COMP["DESIGN ONLY C4 Composition"]
  L2["DEFERRED L2 business GUI"]
  REL["DEFERRED REL source release/demo"]
  BASE -.->|review against baseline| K0
  K0 -.->|review| S0
  K0 -.->|identity| META
  K0 -.->|safety| SAFE
  K0 -.->|audit| AUDIT
  META -.->|explicit membership and app mapping| CONTROL
  AUDIT -.->|durable intent| CONTROL
  META -.->|scope| SECRET
  AUDIT -.->|delivery evidence| SECRET
  SAFE -.->|key recovery| SECRET
  CONTROL -.->|typed work| RUN
  SAFE -.->|node approval and budgets| RUN
  RUN -.->|healthy candidate| TLS
  TLS -.->|ownership lifecycle| DOMAIN
  TLS -.->|routed application| HOST
  SECRET -.->|backend credential delivery| HOST
  SAFE -.->|failure and restore acceptance| HOST
  K0 -.->|choice| OPT
  K0 -.->|contract| REG
  AUDIT -->|publication evidence| REG
  REG -->|exact capability authority| TRUST
  K0 -.->|profile| RES
  REG -.->|immutable metadata| COMP
  TRUST -.->|live permission| COMP
  RES -.->|bounded proof| COMP
  AUDIT -.->|execution evidence| COMP
  BASE -.->|independent public API consumer| L2
  L2 -.->|required product demonstration| REL
  classDef future fill:#fff8eb,stroke:#92734b,stroke-dasharray:5 5
  class K0,S0,META,CONTROL,SAFE,SECRET,RUN,TLS,DOMAIN,HOST,OPT,COMP,L2,REL future
```

This is an acyclic prerequisite graph, not a progress chart. Metadata needs no
controller; Resolver profile tests need no hosting/registry runtime; Layer-2
delivery need not wait for hosting, optional shared services or Capability Runtime.
The [expanded edge register](IMPLEMENTATION_DEPENDENCIES.md#canonical-dependency-edges)
is the implementation ordering reference.

## MAP 08: Cross-application reuse vision

```mermaid
%%{init: {"sequence": {"wrap": true, "actorMargin": 30, "width": 120}}}%%
sequenceDiagram
  participant A as App A PROPOSED
  participant B as App B PROPOSED
  participant F as BaaS VERIFIED
  participant H as Hosting PROPOSED
  participant R as Registry C1 IMPLEMENTED
  participant T as Direct Trust C2 IMPLEMENTED
  participant V as Resolver OFFLINE
  participant C as Composition DESIGN ONLY
  participant W as Flowable VERIFIED
  Note over A,W: PROPOSED reuse scenario, existing providers do not imply implemented capability steps
  A->>F: Use own private records and objects through Foundation APIs
  B->>F: Use separate private resources through the same APIs
  opt App A chooses Rosetta hosting
    H->>A: Run admitted image under existing app identity
  end
  opt App B independently chooses Rosetta hosting
    H->>B: Run admitted image under separate app identity
  end
  A->>R: Publish immutable versioned capability manifest
  B->>R: Discover versions visible to this tenant and application
  B->>T: Request exact invocation permission
  T->>T: Validate provider approval and bounded caller scope
  T-->>B: Authorized grant or explicit denial
  B->>C: Submit plan with exact contracts and bindings
  C->>R: Load immutable contract digests
  C->>V: Validate supported directional compatibility
  V-->>C: Compatible, incompatible or indeterminate
  C->>T: Recheck live trust before execution
  C->>W: Coordinate approved plan through existing engine
  W-->>C: Private external job to guarded dispatcher
  C->>A: Guarded provider invocation after live checks
  A-->>C: Provider-enforced result
  C-->>B: Authorized result and execution evidence
```

Foundation/Flowable, C1 publication and bounded direct C2 grants/discovery are
current integrations. The complete sequence above remains a future composition
scenario: resolver HTTP routes, provider dispatch and C4 coordination do not
exist. The compatibility module is offline only. Application business decisions remain in
A/B. Hosting changes execution location; BaaS supplies reusable infrastructure;
Capability Composition supplies optional authorized reuse.
