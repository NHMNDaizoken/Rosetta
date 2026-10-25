// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import {
  HealthStatus,
  ReadyStatus,
  UserIdentity,
  Application,
  Approval,
  StructuredRecord,
  StoredObject,
  ResourceShare,
  WorkflowDefinition,
  WorkflowExecution,
  AuditSessionEvent,
} from "../types";
import {
  MOCK_IDENTITY,
  MOCK_APPLICATIONS,
  MOCK_APPROVALS,
  MOCK_WORKFLOW_DEFINITIONS,
  MOCK_WORKFLOW_EXECUTIONS,
  MOCK_STRUCTURED_RECORDS,
  MOCK_OBJECTS,
  MOCK_RESOURCE_SHARES,
  MOCK_AUDIT_EVENTS,
} from "./mockData";

export class ApiClient {
  private baseUrl: string;
  private token: string | null;
  private isLiveMode: boolean;
  private sessionApplications: Application[];
  private sessionApprovals: Approval[];
  private sessionExecutions: WorkflowExecution[];
  private sessionRecords: StructuredRecord[];
  private sessionShares: ResourceShare[];
  private sessionAuditLogs: AuditSessionEvent[];

  constructor() {
    this.baseUrl = localStorage.getItem("rosetta_gateway_url") || "/api";
    this.token = localStorage.getItem("rosetta_token") || null;
    this.isLiveMode = localStorage.getItem("rosetta_live_mode") === "true";
    this.sessionApplications = [...MOCK_APPLICATIONS];
    this.sessionApprovals = [...MOCK_APPROVALS];
    this.sessionExecutions = [...MOCK_WORKFLOW_EXECUTIONS];
    this.sessionRecords = [...MOCK_STRUCTURED_RECORDS];
    this.sessionShares = [...MOCK_RESOURCE_SHARES];
    this.sessionAuditLogs = [...MOCK_AUDIT_EVENTS];
  }

  public getLiveMode(): boolean {
    return this.isLiveMode;
  }

  public setLiveMode(live: boolean): void {
    this.isLiveMode = live;
    localStorage.setItem("rosetta_live_mode", live ? "true" : "false");
  }

  public getBaseUrl(): string {
    return this.baseUrl;
  }

  public setBaseUrl(url: string): void {
    this.baseUrl = url;
    localStorage.setItem("rosetta_gateway_url", url);
  }

  public getToken(): string | null {
    return this.token;
  }

  public setToken(token: string | null): void {
    this.token = token;
    if (token) {
      localStorage.setItem("rosetta_token", token);
    } else {
      localStorage.removeItem("rosetta_token");
    }
  }

  private logActivity(
    action: string,
    category: AuditSessionEvent["category"],
    details: string,
    status: AuditSessionEvent["status"] = "success"
  ): void {
    const event: AuditSessionEvent = {
      id: "evt-" + Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      action,
      category,
      subject: this.token ? "operator/session" : MOCK_IDENTITY.subject,
      tenantId: MOCK_IDENTITY.tenantId,
      status,
      details,
      requestId: "req-" + Math.random().toString(36).substring(2, 7),
    };
    this.sessionAuditLogs.unshift(event);
  }

  public getSessionActivity(): AuditSessionEvent[] {
    return this.sessionAuditLogs;
  }

  // Probe Core Process Health (/health)
  public async getHealth(): Promise<HealthStatus> {
    const start = performance.now();
    if (!this.isLiveMode) {
      return {
        service: "rosetta-core (preview)",
        status: "ok",
        timestamp: new Date().toISOString(),
        latencyMs: 4,
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        const data = await res.json();
        return {
          service: data.service ?? "rosetta-core",
          status: data.status === "ok" ? "ok" : "degraded",
          timestamp: new Date().toISOString(),
          latencyMs: latency,
        };
      }
      return { service: "rosetta-core", status: "degraded", latencyMs: latency };
    } catch {
      return { service: "rosetta-core", status: "error", latencyMs: Math.round(performance.now() - start) };
    }
  }

  // Probe Dependency Readiness (/ready)
  public async getReady(): Promise<ReadyStatus> {
    const start = performance.now();
    if (!this.isLiveMode) {
      return {
        status: "ready",
        timestamp: new Date().toISOString(),
        latencyMs: 12,
        dependencies: {
          identity: true,
          data: true,
          objects: true,
          workflow: true,
        },
      };
    }
    try {
      const res = await fetch(`${this.baseUrl}/ready`, {
        signal: AbortSignal.timeout(4000),
      });
      const latency = Math.round(performance.now() - start);
      if (res.ok) {
        return {
          status: "ready",
          timestamp: new Date().toISOString(),
          latencyMs: latency,
          dependencies: {
            identity: true,
            data: true,
            objects: true,
            workflow: true,
          },
        };
      }
      return { status: "not_ready", latencyMs: latency };
    } catch {
      return { status: "unknown", latencyMs: Math.round(performance.now() - start) };
    }
  }

  // Retrieve Authenticated Identity (/v1/identity)
  public async getIdentity(): Promise<UserIdentity> {
    if (!this.isLiveMode || !this.token) {
      return MOCK_IDENTITY;
    }
    try {
      const res = await fetch(`${this.baseUrl}/v1/identity`, {
        headers: { Authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        return await res.json();
      }
      return MOCK_IDENTITY;
    } catch {
      return MOCK_IDENTITY;
    }
  }

  // Applications
  public async getApplication(appId: string): Promise<Application | null> {
    if (!this.isLiveMode) {
      const found = this.sessionApplications.find((a) => a.appId === appId);
      return found ?? null;
    }
    try {
      const headers: Record<string, string> = {};
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const res = await fetch(`${this.baseUrl}/v1/applications/${encodeURIComponent(appId)}`, {
        headers,
        signal: AbortSignal.timeout(4000),
      });
      if (res.ok) {
        return await res.json();
      }
      return null;
    } catch {
      return null;
    }
  }

  public async getApplicationsList(): Promise<Application[]> {
    return this.sessionApplications;
  }

  public async registerApplication(payload: {
    displayName: string;
    oauthClientId: string;
    providerOrigin: string;
  }): Promise<Application> {
    if (!this.isLiveMode) {
      const appId = crypto.randomUUID();
      const newApp: Application = {
        appId,
        tenantId: MOCK_IDENTITY.tenantId,
        ownerSubject: MOCK_IDENTITY.subject,
        displayName: payload.displayName,
        oauthClientId: payload.oauthClientId,
        providerOrigin: payload.providerOrigin,
        state: "pending",
        revision: 1,
        digest: "sha256:" + Array.from(crypto.getRandomValues(new Uint8Array(32))).map((b) => b.toString(16).padStart(2, "0")).join(""),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.sessionApplications.unshift(newApp);
      this.logActivity("REGISTER_APPLICATION", "application", `Đã gửi đề xuất ứng dụng '${payload.displayName}' (${appId})`);
      return newApp;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/v1/applications`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      this.logActivity("REGISTER_APPLICATION_FAILED", "application", `Đăng ký thất bại: ${err.error}`, "error");
      throw new Error(err.error || "failed_to_register");
    }
    const app = await res.json();
    this.sessionApplications.unshift(app);
    this.logActivity("REGISTER_APPLICATION", "application", `Đã tạo ứng dụng '${payload.displayName}' qua API Gateway`);
    return app;
  }

  public async createApproval(payload: {
    resourceId: string;
    resourceDigest: string;
    resourceRevision: number;
    requesterSubject: string;
    requesterAppId: string;
    decision: "approve" | "deny";
    expiresAt: string;
  }): Promise<Approval> {
    if (!this.isLiveMode) {
      const approval: Approval = {
        approvalId: crypto.randomUUID(),
        resourceType: "application",
        resourceId: payload.resourceId,
        resourceDigest: payload.resourceDigest,
        resourceRevision: payload.resourceRevision,
        requesterSubject: payload.requesterSubject,
        requesterAppId: payload.requesterAppId,
        decision: payload.decision,
        expiresAt: payload.expiresAt,
        consumed: false,
        revoked: false,
        createdAt: new Date().toISOString(),
      };
      this.sessionApprovals.unshift(approval);
      this.logActivity("CREATE_APPROVAL", "approval", `Tạo quyết định ${payload.decision} cho app ${payload.resourceId}`);
      return approval;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/v1/approvals`, {
      method: "POST",
      headers,
      body: JSON.stringify({ resourceType: "application", ...payload }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "failed_to_create_approval");
    }
    const apprv = await res.json();
    this.sessionApprovals.unshift(apprv);
    this.logActivity("CREATE_APPROVAL", "approval", `Ký duyệt thành công approval ${apprv.approvalId}`);
    return apprv;
  }

  public async approveApplication(appId: string, approvalId: string, eTag?: string): Promise<void> {
    if (!this.isLiveMode) {
      const app = this.sessionApplications.find((a) => a.appId === appId);
      if (app) {
        app.state = "active";
        app.revision += 1;
        app.updatedAt = new Date().toISOString();
        app.lastApprovalId = approvalId;
      }
      const apprv = this.sessionApprovals.find((a) => a.approvalId === approvalId);
      if (apprv) {
        apprv.consumed = true;
        apprv.consumedAt = new Date().toISOString();
      }
      this.logActivity("APPROVE_APPLICATION", "application", `Kích hoạt ứng dụng ${appId} với approval ${approvalId}`);
      return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (eTag) headers["If-Match"] = eTag;
    const res = await fetch(`${this.baseUrl}/v1/applications/${encodeURIComponent(appId)}/approve`, {
      method: "POST",
      headers,
      body: JSON.stringify({ approvalId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "failed_to_approve");
    }
    this.logActivity("APPROVE_APPLICATION", "application", `Kích hoạt ứng dụng ${appId} thành công qua Gateway`);
  }

  public async transitionApplicationState(
    appId: string,
    action: "suspend" | "reactivate" | "revoke",
    reason: string,
    approvalId?: string,
    eTag?: string
  ): Promise<void> {
    if (!this.isLiveMode) {
      const app = this.sessionApplications.find((a) => a.appId === appId);
      if (app) {
        app.state = action === "suspend" ? "suspended" : action === "reactivate" ? "active" : "revoked";
        app.revision += 1;
        app.updatedAt = new Date().toISOString();
      }
      this.logActivity("TRANSITION_STATE", "application", `Chuyển trạng thái app ${appId} -> ${action}: ${reason}`);
      return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    if (eTag) headers["If-Match"] = eTag;
    const body: Record<string, string> = { action, reason };
    if (approvalId) body["approvalId"] = approvalId;
    const res = await fetch(`${this.baseUrl}/v1/applications/${encodeURIComponent(appId)}/state`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "state_transition_failed");
    }
    this.logActivity("TRANSITION_STATE", "application", `Chuyển trạng thái app ${appId} sang ${action}`);
  }

  // Workflows
  public async getWorkflowDefinitions(): Promise<WorkflowDefinition[]> {
    if (!this.isLiveMode) {
      return MOCK_WORKFLOW_DEFINITIONS;
    }
    try {
      const headers: Record<string, string> = {};
      if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
      const res = await fetch(`${this.baseUrl}/v1/workflows/definitions`, { headers });
      if (res.ok) {
        const data = await res.json();
        return data.items ?? [];
      }
      return MOCK_WORKFLOW_DEFINITIONS;
    } catch {
      return MOCK_WORKFLOW_DEFINITIONS;
    }
  }

  public async getWorkflowExecutions(): Promise<WorkflowExecution[]> {
    return this.sessionExecutions;
  }

  public async startWorkflowExecution(
    definitionId: string,
    input: Record<string, unknown> = {}
  ): Promise<WorkflowExecution> {
    const idempotencyKey = crypto.randomUUID();
    if (!this.isLiveMode) {
      const execution: WorkflowExecution = {
        id: crypto.randomUUID(),
        definitionId,
        status: "running",
        startTime: new Date().toISOString(),
        input,
        activeTaskId: "task_" + Math.random().toString(36).substring(2, 6),
        activeTaskName: "User Checkpoint Task",
      };
      this.sessionExecutions.unshift(execution);
      this.logActivity("START_WORKFLOW", "workflow", `Khởi chạy quy trình '${definitionId}' với Idempotency-Key ${idempotencyKey}`);
      return execution;
    }
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/v1/workflows/executions`, {
      method: "POST",
      headers,
      body: JSON.stringify({ definitionId, input }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "failed_to_start_workflow");
    }
    const data = await res.json();
    const exec: WorkflowExecution = {
      id: data.id,
      definitionId,
      status: data.status ?? "running",
      startTime: new Date().toISOString(),
      input,
      activeTaskId: "checkpoint_task",
      activeTaskName: "User Checkpoint",
    };
    this.sessionExecutions.unshift(exec);
    this.logActivity("START_WORKFLOW", "workflow", `Khởi chạy thành công execution ${data.id}`);
    return exec;
  }

  public async completeWorkflowTask(executionId: string): Promise<void> {
    if (!this.isLiveMode) {
      const exec = this.sessionExecutions.find((e) => e.id === executionId);
      if (exec) {
        exec.status = "completed";
        exec.endTime = new Date().toISOString();
        exec.activeTaskId = undefined;
      }
      this.logActivity("COMPLETE_TASK", "workflow", `Hoàn thành tác vụ quy trình ${executionId}`);
      return;
    }
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/v1/workflows/executions/${encodeURIComponent(executionId)}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({}),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "failed_to_complete_task");
    }
    const exec = this.sessionExecutions.find((e) => e.id === executionId);
    if (exec) {
      exec.status = "completed";
      exec.endTime = new Date().toISOString();
    }
    this.logActivity("COMPLETE_TASK", "workflow", `Đã hoàn thành tác vụ cho ${executionId}`);
  }

  public async cancelWorkflowExecution(executionId: string): Promise<void> {
    if (!this.isLiveMode) {
      const exec = this.sessionExecutions.find((e) => e.id === executionId);
      if (exec) {
        exec.status = "cancelled";
        exec.endTime = new Date().toISOString();
      }
      this.logActivity("CANCEL_WORKFLOW", "workflow", `Hủy bỏ thực thi quy trình ${executionId}`);
      return;
    }
    const headers: Record<string, string> = {};
    if (this.token) headers["Authorization"] = `Bearer ${this.token}`;
    const res = await fetch(`${this.baseUrl}/v1/workflows/executions/${encodeURIComponent(executionId)}`, {
      method: "DELETE",
      headers,
    });
    if (!res.ok && res.status !== 204) {
      const err = await res.json().catch(() => ({ error: "request_failed" }));
      throw new Error(err.error || "failed_to_cancel");
    }
    const exec = this.sessionExecutions.find((e) => e.id === executionId);
    if (exec) {
      exec.status = "cancelled";
      exec.endTime = new Date().toISOString();
    }
    this.logActivity("CANCEL_WORKFLOW", "workflow", `Đã hủy bỏ execution ${executionId}`);
  }

  // Structured Records (v2)
  public async getRecords(): Promise<StructuredRecord[]> {
    return this.sessionRecords;
  }

  public async createRecord(collection: string, data: Record<string, unknown>): Promise<StructuredRecord> {
    const newRecord: StructuredRecord = {
      id: crypto.randomUUID(),
      collection,
      data,
      createdAt: new Date().toISOString(),
      ownerAppId: MOCK_APPLICATIONS[0].appId,
      isShared: false,
    };
    this.sessionRecords.unshift(newRecord);
    this.logActivity("CREATE_RECORD", "resource", `Tạo bản ghi mới trong collection '${collection}' (${newRecord.id})`);
    return newRecord;
  }

  public async deleteRecord(id: string): Promise<void> {
    this.sessionRecords = this.sessionRecords.filter((r) => r.id !== id);
    this.logActivity("DELETE_RECORD", "resource", `Xóa bản ghi ${id}`);
  }

  // Objects (v2)
  public async getObjects(): Promise<StoredObject[]> {
    return MOCK_OBJECTS;
  }

  // Resource Shares (v2)
  public async getResourceShares(): Promise<ResourceShare[]> {
    return this.sessionShares;
  }

  public async createResourceShare(payload: {
    resourceType: "record" | "object";
    resourceId: string;
    granteeAppId: string;
    expiresAt: string;
  }): Promise<ResourceShare> {
    const share: ResourceShare = {
      shareId: crypto.randomUUID(),
      resourceType: payload.resourceType,
      resourceId: payload.resourceId,
      granteeAppId: payload.granteeAppId,
      action: "read",
      expiresAt: payload.expiresAt,
      createdAt: new Date().toISOString(),
    };
    this.sessionShares.unshift(share);
    this.logActivity("CREATE_RESOURCE_SHARE", "resource", `Cấp quyền chia sẻ chỉ đọc cho app ${payload.granteeAppId}`);
    return share;
  }

  public async revokeResourceShare(shareId: string): Promise<void> {
    this.sessionShares = this.sessionShares.filter((s) => s.shareId !== shareId);
    this.logActivity("REVOKE_RESOURCE_SHARE", "resource", `Thu hồi chia sẻ tài nguyên ${shareId}`);
  }
}

export const api = new ApiClient();
