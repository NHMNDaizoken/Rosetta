// SPDX-FileCopyrightText: 2026 Rosetta Contributors
// SPDX-License-Identifier: Apache-2.0
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "../App";
import { api } from "../services/apiClient";

describe("Rosetta Console Application Tests", () => {
  it("renders the brand header and default overview screen", () => {
    render(<App />);
    expect(screen.getAllByText("Rosetta").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Console").length).toBeGreaterThan(0);
  });

  it("switches language from Vietnamese to English", () => {
    render(<App />);
    const langBtn = screen.getByLabelText("Toggle language");
    expect(langBtn).toBeInTheDocument();
    fireEvent.click(langBtn);
    expect(document.documentElement.lang).toBe("en");
    expect(screen.getAllByText("Platform Overview").length).toBeGreaterThan(0);
  });

  it("toggles light/dark theme", () => {
    render(<App />);
    const themeBtn = screen.getByLabelText("Toggle color theme");
    expect(themeBtn).toBeInTheDocument();
    fireEvent.click(themeBtn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("renders all five foundational core cards on Core Services screen", async () => {
    window.location.hash = "#/cores";
    render(<App />);
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
});
