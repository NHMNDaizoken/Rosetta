// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { api } from "../services/apiClient";
import { vi as viStrings } from "../locales/vi";

interface GatewayMockOptions {
  identityStatus?: number;
  identityBody?: unknown;
  identityError?: "timeout" | "network";
}

function mockGateway(options: GatewayMockOptions = {}) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/v1/identity")) {
      if (options.identityError === "timeout") {
        return Promise.reject(
          Object.assign(new Error("timed out"), { name: "TimeoutError" })
        );
      }
      if (options.identityError === "network") {
        return Promise.reject(new Error("network unavailable"));
      }
      return Promise.resolve(
        new Response(
          options.identityBody === undefined
            ? null
            : JSON.stringify(options.identityBody),
          {
            status: options.identityStatus ?? 200,
            headers: { "Content-Type": "application/json" },
          }
        )
      );
    }
    if (url.includes("/health")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ service: "rosetta-core", status: "ok" }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      );
    }
    return Promise.resolve(new Response(null, { status: 200 }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderOverview() {
  render(<App />);
  await screen.findByText("Tổng quan trạng thái Rosetta DX-OS");
  await screen.findByText("200 OK");
}

describe("Rosetta Console Application Tests", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
    api.setLiveMode(true);
    api.setLiveMode(false);
    api.setToken(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("renders the brand header and default overview screen", async () => {
    await renderOverview();
    expect(screen.getAllByText("Rosetta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Console").length).toBeGreaterThan(0);
  });

  it("switches language from Vietnamese to English", async () => {
    await renderOverview();
    fireEvent.click(screen.getByLabelText("Toggle language"));
    expect(document.documentElement.lang).toBe("en");
    await screen.findByText("Platform Overview");
  });

  it("toggles light/dark theme", async () => {
    await renderOverview();
    fireEvent.click(screen.getByLabelText("Toggle color theme"));
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders all five foundational core cards on Core Services screen", async () => {
    window.history.replaceState(null, "", "/#/cores");
    render(<App />);
    await screen.findByText("Năm dịch vụ lõi nền tảng");
    expect(screen.getAllByText(/Identity/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/API Gateway/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Structured Data/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Object Storage/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Workflow Engine/i).length).toBeGreaterThan(0);
  });

  it("api client returns valid health and readiness in preview mode", async () => {
    api.setLiveMode(false);
    const health = await api.getHealth();
    expect(health.status).toBe("ok");
    const ready = await api.getReady();
    expect(ready.status).toBe("ready");
  });

  it("shows a missing-token LIVE state without substituting preview identity", async () => {
    api.setLiveMode(true);
    mockGateway();
    render(<App />);
    await screen.findByText("200 OK");
    await screen.findAllByText(viStrings.identity.missing);
    expect(screen.queryByText("tenant-a")).not.toBeInTheDocument();
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument();
  });

  it.each([
    ["rejected", { identityStatus: 401 }, viStrings.identity.rejected],
    ["forbidden", { identityStatus: 403 }, viStrings.identity.forbidden],
    ["unavailable", { identityStatus: 503 }, "Dịch vụ định danh không khả dụng"],
    ["timed out", { identityError: "timeout" as const }, "Yêu cầu định danh quá thời gian"],
    ["network error", { identityError: "network" as const }, "Dịch vụ định danh không khả dụng"],
  ])("renders an explicit %s identity state in LIVE mode", async (_name, options, label) => {
    api.setLiveMode(true);
    api.setToken("operator-token");
    mockGateway(options);
    render(<App />);
    await screen.findByText("200 OK");
    await screen.findAllByText(label);
    expect(screen.queryByText("tenant-a")).not.toBeInTheDocument();
  });

  it("shows the verified live tenant instead of preview data", async () => {
    api.setLiveMode(true);
    api.setToken("operator-token");
    mockGateway({
      identityBody: {
        subject: "operator-live",
        tenantId: "tenant-live",
        roles: ["core-reader"],
      },
    });
    render(<App />);
    await screen.findAllByText("tenant-live");
    expect(screen.queryByText("tenant-a")).not.toBeInTheDocument();
  });

  it("clears preview-derived application state when switching to LIVE", async () => {
    window.history.replaceState(null, "", "/#/applications");
    mockGateway();
    render(<App />);
    await screen.findByText("Rosetta Document Scanner Pro");

    fireEvent.click(
      screen.getByRole("button", { name: /CHẾ ĐỘ MÔ PHỎNG/i })
    );

    await screen.findByText(
      /Chế độ LIVE: Foundation API không cung cấp endpoint liệt kê toàn bộ ứng dụng/
    );
    expect(
      screen.queryByText("Rosetta Document Scanner Pro")
    ).not.toBeInTheDocument();
    await screen.findAllByText(viStrings.identity.missing);
  });
});
