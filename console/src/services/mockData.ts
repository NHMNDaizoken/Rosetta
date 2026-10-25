// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { Application, Approval, StructuredRecord, StoredObject, ResourceShare, WorkflowDefinition, WorkflowExecution, AuditSessionEvent, UserIdentity } from "../types";

export const MOCK_IDENTITY: UserIdentity = {
  subject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
  tenantId: "tenant-a",
  roles: ["core-reader", "core-writer", "admin"],
  clientId: "rosetta-local",
  issuer: "http://127.0.0.1:8080/identity/realms/rosetta",
};

export const MOCK_APPLICATIONS: Application[] = [
  {
    appId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    tenantId: "tenant-a",
    ownerSubject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
    displayName: "Rosetta Document Scanner Pro",
    oauthClientId: "tenant-a-scanner-client",
    providerOrigin: "https://scanner.provider.local",
    state: "active",
    revision: 2,
    digest: "sha256:4a8b79e2c4153fa82910d54b67e2a901ffca8531d0b3879a8e265c1a7029cb12",
    createdAt: "2026-10-24T08:30:00.000Z",
    updatedAt: "2026-10-24T09:15:00.000Z",
    lastApprovalId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
  },
  {
    appId: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b",
    tenantId: "tenant-a",
    ownerSubject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
    displayName: "Financial Ledger Sync Service",
    oauthClientId: "tenant-a-ledger-service",
    providerOrigin: "https://ledger.finance.internal",
    state: "pending",
    revision: 1,
    digest: "sha256:7b92f801a64e10c73295b3d90f235aa7ce94125f9b17da2a9834bb610f443890",
    createdAt: "2026-10-25T03:10:00.000Z",
    updatedAt: "2026-10-25T03:10:00.000Z",
  },
  {
    appId: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d",
    tenantId: "tenant-a",
    ownerSubject: "e3f4a5b6-c7d8-4e9f-0a1b-2c3d4e5f6a7b",
    displayName: "Legacy Analytics Ingest Engine",
    oauthClientId: "tenant-a-analytics-client",
    providerOrigin: "https://analytics.data.internal",
    state: "suspended",
    revision: 3,
    digest: "sha256:1049c81b53e878502cfa039b2e8a159f8162e783abdf15239a038ef7a1594830",
    createdAt: "2026-10-20T14:00:00.000Z",
    updatedAt: "2026-10-25T06:00:00.000Z",
    lastApprovalId: "f4e3d2c1-b0a9-4876-5432-1a2b3c4d5e6f",
  },
];

export const MOCK_APPROVALS: Approval[] = [
  {
    approvalId: "b1c2d3e4-f5a6-4b7c-8d9e-0f1a2b3c4d5e",
    resourceType: "application",
    resourceId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    resourceDigest: "sha256:4a8b79e2c4153fa82910d54b67e2a901ffca8531d0b3879a8e265c1a7029cb12",
    resourceRevision: 2,
    requesterSubject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
    requesterAppId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    decision: "approve",
    expiresAt: "2026-10-25T23:59:00.000Z",
    consumed: true,
    consumedAt: "2026-10-24T09:15:00.000Z",
    revoked: false,
    createdAt: "2026-10-24T09:05:00.000Z",
  },
];

export const MOCK_WORKFLOW_DEFINITIONS: WorkflowDefinition[] = [
  {
    id: "rosetta_checkpoint:1:7f4a2b10",
    key: "rosetta_checkpoint",
    version: 1,
    name: "Rosetta Technical Checkpoint Fixture",
    description: "Original technical checkpoint: start event -> user checkpoint task -> end event. Safe idempotency test.",
  },
  {
    id: "application_onboarding:1:8e5c3d21",
    key: "application_onboarding",
    version: 1,
    name: "Application Governance Verification Workflow",
    description: "Multi-party security verification process with SLA tracking and audit reconciliation.",
  },
];

export const MOCK_WORKFLOW_EXECUTIONS: WorkflowExecution[] = [
  {
    id: "f8e7d6c5-b4a3-4210-9876-543210abcdef",
    definitionId: "rosetta_checkpoint:1:7f4a2b10",
    definitionKey: "rosetta_checkpoint",
    status: "running",
    startTime: "2026-10-25T15:20:00.000Z",
    input: { technicalFixture: true, runId: "run_984" },
    activeTaskId: "task_01_checkpoint",
    activeTaskName: "User Checkpoint Task",
  },
  {
    id: "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e",
    definitionId: "rosetta_checkpoint:1:7f4a2b10",
    definitionKey: "rosetta_checkpoint",
    status: "completed",
    startTime: "2026-10-25T14:10:00.000Z",
    endTime: "2026-10-25T14:12:30.000Z",
    input: { technicalFixture: true, runId: "run_983" },
  },
];

export const MOCK_STRUCTURED_RECORDS: StructuredRecord[] = [
  {
    id: "0d8f7e6c-5b4a-4321-9876-abcdef012345",
    collection: "devices",
    data: {
      serialNumber: "DEV-ROSETTA-8821",
      model: "Edge Gateway X2",
      firmware: "v2.4.1",
      status: "active",
      location: "Building C, Server Room 4",
      lastHeartbeat: "2026-10-25T15:40:00Z"
    },
    createdAt: "2026-10-24T10:00:00.000Z",
    ownerAppId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    isShared: false,
  },
  {
    id: "1e9f8a7b-6c5d-4432-8765-fedcba543210",
    collection: "compliance_checks",
    data: {
      standard: "ISO/IEC 27001:2022",
      scope: "Layer-1 PaaS Access Control",
      result: "PASSED",
      assessor: "SecOps Lead",
      findingCount: 0
    },
    createdAt: "2026-10-25T08:00:00.000Z",
    ownerAppId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    isShared: true,
  },
];

export const MOCK_OBJECTS: StoredObject[] = [
  {
    id: "4b5c6d7e-8f9a-4012-b345-6789abcdef01",
    size: 24576,
    contentType: "application/octet-stream",
    createdAt: "2026-10-25T11:20:00.000Z",
    ownerAppId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    version: 1,
  },
  {
    id: "5c6d7e8f-9a0b-4123-c456-789abcdef012",
    size: 1048576,
    contentType: "application/octet-stream",
    createdAt: "2026-10-25T13:45:00.000Z",
    ownerAppId: "c3d4e5f6-7a8b-4c9d-0e1f-2a3b4c5d6e7f",
    version: 2,
  },
];

export const MOCK_RESOURCE_SHARES: ResourceShare[] = [
  {
    shareId: "7d8e9f0a-1b2c-4345-d678-9abcdef01234",
    resourceType: "record",
    resourceId: "1e9f8a7b-6c5d-4432-8765-fedcba543210",
    granteeAppId: "e9f0a1b2-c3d4-4e5f-6a7b-8c9d0e1f2a3b",
    action: "read",
    expiresAt: "2026-10-26T12:00:00.000Z",
    createdAt: "2026-10-25T08:05:00.000Z",
  },
];

export const MOCK_AUDIT_EVENTS: AuditSessionEvent[] = [
  {
    id: "evt-001",
    timestamp: "2026-10-25T15:35:10Z",
    action: "APPLICATION_PROPOSAL_REGISTERED",
    category: "application",
    subject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
    tenantId: "tenant-a",
    status: "success",
    details: "New app proposal 'Financial Ledger Sync Service' submitted. Digest sha256:7b92f801...",
    requestId: "req-984-a10f",
  },
  {
    id: "evt-002",
    timestamp: "2026-10-25T15:20:00Z",
    action: "WORKFLOW_EXECUTION_STARTED",
    category: "workflow",
    subject: "9f8c6e2b-45a1-42e7-9104-58bfa791e23a",
    tenantId: "tenant-a",
    status: "success",
    details: "Started execution for definition 'rosetta_checkpoint' with idempotency key reservation.",
    requestId: "req-983-b21e",
  },
  {
    id: "evt-003",
    timestamp: "2026-10-25T15:10:45Z",
    action: "READINESS_PROBE_SUCCEEDED",
    category: "system",
    subject: "internal/probe",
    tenantId: "tenant-a",
    status: "success",
    details: "All five core backends responded within SLA (OIDC, PostgREST RLS, SeaweedFS, Flowable).",
    requestId: "probe-882",
  },
];
