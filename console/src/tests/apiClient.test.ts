// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient, isApprovedBaseUrl } from "../services/apiClient";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApiClient session boundaries", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("does not restore or persist bearer tokens", () => {
    localStorage.setItem("rosetta_token", "legacy-secret");
    const client = new ApiClient();

    expect(client.getToken()).toBeNull();
    expect(localStorage.getItem("rosetta_token")).toBeNull();

    client.setToken("memory-secret");
    expect(client.getToken()).toBe("memory-secret");
    expect(localStorage.getItem("rosetta_token")).toBeNull();

    client.setToken(null);
    expect(client.getToken()).toBeNull();
    expect(localStorage.getItem("rosetta_token")).toBeNull();
  });

  it("rejects stored gateway origins that are neither same-origin nor loopback", () => {
    localStorage.setItem("rosetta_gateway_url", "https://evil.example");
    const client = new ApiClient();

    expect(client.getBaseUrl()).toBe("/api");
    expect(localStorage.getItem("rosetta_gateway_url")).toBeNull();
    expect(() => client.setBaseUrl("https://evil.example")).toThrow(
      "gateway_origin_not_approved"
    );
    expect(isApprovedBaseUrl("/api")).toBe(true);
    expect(isApprovedBaseUrl("http://127.0.0.1:8080")).toBe(true);
    expect(isApprovedBaseUrl("http://localhost:8080/")).toBe(true);
    expect(isApprovedBaseUrl("//evil.example")).toBe(false);
    expect(isApprovedBaseUrl("https://evil.example")).toBe(false);
  });

  it("never sends Authorization to an unapproved origin", async () => {
    const client = new ApiClient();
    client.setLiveMode(true);
    client.setToken("memory-secret");
    (client as unknown as { baseUrl: string }).baseUrl = "https://evil.example";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await client.getIdentity();

    expect(result.status).toBe("unavailable");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("distinguishes missing, rejected, forbidden, unavailable and timed-out identity", async () => {
    const missingToken = new ApiClient();
    missingToken.setLiveMode(true);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(missingToken.getIdentity()).resolves.toMatchObject({
      status: "missing",
    });
    expect(fetchMock).not.toHaveBeenCalled();

    const rejected = new ApiClient();
    rejected.setLiveMode(true);
    rejected.setToken("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401)));
    await expect(rejected.getIdentity()).resolves.toMatchObject({
      status: "rejected",
    });

    const forbidden = new ApiClient();
    forbidden.setLiveMode(true);
    forbidden.setToken("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(403)));
    await expect(forbidden.getIdentity()).resolves.toMatchObject({
      status: "forbidden",
    });

    const unavailable = new ApiClient();
    unavailable.setLiveMode(true);
    unavailable.setToken("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(503)));
    await expect(unavailable.getIdentity()).resolves.toMatchObject({
      status: "unavailable",
    });

    const timedOut = new ApiClient();
    timedOut.setLiveMode(true);
    timedOut.setToken("token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(
        Object.assign(new Error("timed out"), { name: "TimeoutError" })
      )
    );
    await expect(timedOut.getIdentity()).resolves.toMatchObject({
      status: "timeout",
    });
  });

  it("returns only validated live identity without mock substitution", async () => {
    const client = new ApiClient();
    client.setLiveMode(true);
    client.setToken("token");
    const identity = {
      subject: "operator-live",
      tenantId: "tenant-live",
      roles: ["core-reader"],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, identity)));

    await expect(client.getIdentity()).resolves.toEqual({
      status: "authenticated",
      identity,
    });

    const invalidClient = new ApiClient();
    invalidClient.setLiveMode(true);
    invalidClient.setToken("token");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { subject: "incomplete" }))
    );
    await expect(invalidClient.getIdentity()).resolves.toMatchObject({
      status: "unavailable",
      message: "invalid_identity_response",
    });
  });

  it("clears preview-derived session state when entering LIVE mode", async () => {
    const client = new ApiClient();
    client.setLiveMode(false);

    expect((await client.getApplicationsList()).length).toBeGreaterThan(0);
    expect((await client.getRecords()).length).toBeGreaterThan(0);
    expect((await client.getObjects()).length).toBeGreaterThan(0);
    expect((await client.getResourceShares()).length).toBeGreaterThan(0);
    expect((await client.getWorkflowExecutions()).length).toBeGreaterThan(0);
    expect(client.getSessionActivity().length).toBeGreaterThan(0);

    client.setLiveMode(true);

    await expect(client.getApplicationsList()).resolves.toEqual([]);
    await expect(client.getRecords()).resolves.toEqual([]);
    await expect(client.getObjects()).resolves.toEqual([]);
    await expect(client.getResourceShares()).resolves.toEqual([]);
    await expect(client.getWorkflowExecutions()).resolves.toEqual([]);
    expect(client.getSessionActivity()).toEqual([]);
  });

  it("rejects mock-only v2 mutations in LIVE mode", async () => {
    const client = new ApiClient();
    client.setLiveMode(true);

    await expect(client.createRecord("devices", { ok: true })).rejects.toThrow(
      "preview_only_operation"
    );
    await expect(client.deleteRecord("record-id")).rejects.toThrow(
      "preview_only_operation"
    );
    await expect(
      client.createResourceShare({
        resourceType: "record",
        resourceId: "record-id",
        granteeAppId: "app-id",
        expiresAt: new Date().toISOString(),
      })
    ).rejects.toThrow("preview_only_operation");
    await expect(client.revokeResourceShare("share-id")).rejects.toThrow(
      "preview_only_operation"
    );
  });

  it("does not fall back to mock workflow definitions after a live failure", async () => {
    const client = new ApiClient();
    client.setLiveMode(true);
    client.setToken("token");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500)));

    await expect(client.getWorkflowDefinitions()).rejects.toThrow(
      "workflow_definitions_unavailable"
    );
  });
});
