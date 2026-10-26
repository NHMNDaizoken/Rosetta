// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0

export type ScreenId =
  | "overview"
  | "cores"
  | "applications"
  | "resources"
  | "workflows"
  | "api-explorer"
  | "security"
  | "settings"
  | "capabilities";

export type Language = "vi" | "en";
export type Theme = "light" | "dark" | "system";

export interface HealthStatus {
  service: string;
  status: "ok" | "degraded" | "error" | "unknown";
  timestamp?: string;
  latencyMs?: number;
}

export interface ReadyStatus {
  status: "ready" | "not_ready" | "unknown";
  timestamp?: string;
  latencyMs?: number;
  dependencies?: {
    identity: boolean;
    data: boolean;
    objects: boolean;
    workflow: boolean;
  };
}

export interface UserIdentity {
  subject: string;
  tenantId: string;
  roles: string[];
  clientId?: string;
  issuer?: string;
}

export type IdentityStatus =
  | "preview"
  | "loading"
  | "authenticated"
  | "missing"
  | "rejected"
  | "forbidden"
  | "unavailable"
  | "timeout";

export interface IdentityState {
  status: IdentityStatus;
  identity?: UserIdentity;
  message?: string;
}

export interface CoreServiceInfo {
  id: string;
  name: string;
  shortName: string;
  provider: string;
  protocol: string;
  port: string;
  description: string;
  enDescription: string;
  statusRoute: string;
  limitations: string;
  health: "ready" | "operational" | "unavailable" | "unknown";
}

export type ApplicationState = "pending" | "active" | "suspended" | "revoked";

export interface Application {
  appId: string;
  tenantId: string;
  ownerSubject: string;
  displayName: string;
  oauthClientId: string;
  providerOrigin: string;
  state: ApplicationState;
  revision: number;
  digest: string;
  createdAt: string;
  updatedAt: string;
  lastApprovalId?: string;
}

export interface Approval {
  approvalId: string;
  resourceType: "application";
  resourceId: string;
  resourceDigest: string;
  resourceRevision: number;
  requesterSubject: string;
  requesterAppId: string;
  decision: "approve" | "deny";
  expiresAt: string;
  consumed: boolean;
  consumedAt?: string;
  revoked: boolean;
  revokeReason?: string;
  createdAt: string;
}

export interface StructuredRecord {
  id: string;
  collection: string;
  data: Record<string, unknown>;
  createdAt: string;
  ownerAppId?: string;
  isShared?: boolean;
}

export interface StoredObject {
  id: string;
  size: number;
  contentType: string;
  createdAt: string;
  ownerAppId?: string;
  version?: number;
}

export interface ResourceShare {
  shareId: string;
  resourceType: "record" | "object";
  resourceId: string;
  granteeAppId: string;
  action: "read";
  expiresAt: string;
  createdAt: string;
}

export interface WorkflowDefinition {
  id: string;
  key: string;
  version: number;
  name: string;
  description?: string;
}

export interface WorkflowExecution {
  id: string;
  definitionId: string;
  definitionKey?: string;
  status: "running" | "completed" | "cancelled";
  startTime: string;
  endTime?: string;
  input?: Record<string, unknown>;
  activeTaskId?: string;
  activeTaskName?: string;
}

export interface AuditSessionEvent {
  id: string;
  timestamp: string;
  action: string;
  category: "application" | "approval" | "workflow" | "resource" | "security" | "system";
  subject: string;
  tenantId: string;
  status: "success" | "denied" | "error";
  details: string;
  requestId?: string;
}
