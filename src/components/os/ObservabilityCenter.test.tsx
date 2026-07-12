// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import ObservabilityCenter from "./ObservabilityCenter";

describe("ObservabilityCenter Component", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders correctly with tabs and default e2e section", () => {
    render(<ObservabilityCenter />);
    
    // Check main title with custom flexible matcher
    expect(screen.getByText((content) => content.includes("ACOS Observability & Validation Suite"))).toBeTruthy();
    
    // Check tabs
    expect(screen.getByText((content) => content.includes("End-to-End Tests"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Performance & LCP"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Error Recovery"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Security & Sanitization"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Readiness Report"))).toBeTruthy();
    
    // Click on End-to-End Tests to make its elements visible
    const e2eTab = screen.getByText((content) => content.includes("End-to-End Tests"));
    fireEvent.click(e2eTab);

    // Check simulation card triggers
    expect(screen.getByText((content) => content.includes("Automated E2E Simulation Center"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Execute Validation Suite"))).toBeTruthy();
  });

  it("executes simulated E2E test suites on button click", async () => {
    render(<ObservabilityCenter />);
    
    // Click on End-to-End Tests to make its elements visible
    const e2eTab = screen.getByText((content) => content.includes("End-to-End Tests"));
    fireEvent.click(e2eTab);

    const runBtn = screen.getByText((content) => content.includes("Execute Validation Suite"));
    expect(runBtn).toBeTruthy();
    
    // Trigger run
    fireEvent.click(runBtn);
    
    // Should transition to "Running Validation..."
    expect(screen.getByText((content) => content.includes("Running Validation..."))).toBeTruthy();
  });

  it("switches to Performance tab and displays live stats", async () => {
    render(<ObservabilityCenter />);
    
    const perfTab = screen.getByText((content) => content.includes("Performance & LCP"));
    fireEvent.click(perfTab);
    
    const metricTitle = await screen.findByText((content) => content.includes("Interactive Latency"));
    expect(metricTitle).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Estimated LCP"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("JS Heap Memory"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("Live Telemetry Observer"))).toBeTruthy();
  });

  it("switches to Error Recovery tab and simulates failures", async () => {
    render(<ObservabilityCenter />);
    
    const recoveryTab = screen.getByText((content) => content.includes("Error Recovery"));
    fireEvent.click(recoveryTab);
    
    const secTitle = await screen.findByText((content) => content.includes("Error Injection & Graceful Recovery Simulations"));
    expect(secTitle).toBeTruthy();
    
    const timeoutBtn = screen.getByText((content) => content.includes("AI Timeout Failure"));
    fireEvent.click(timeoutBtn);
    
    expect(screen.getByText((content) => content.includes("Recovery Lifecycle Logger"))).toBeTruthy();
  });

  it("switches to Readiness Report tab and renders ratings", async () => {
    render(<ObservabilityCenter />);
    
    const reportTab = screen.getByText((content) => content.includes("Readiness Report"));
    fireEvent.click(reportTab);
    
    const repHeader = await screen.findByText((content) => content.includes("Production Readiness Report"));
    expect(repHeader).toBeTruthy();
    expect(screen.getByText((content) => content.includes("OVERALL ARCH SCORE"))).toBeTruthy();
    expect(screen.getByText((content) => content.includes("UI Quality"))).toBeTruthy();
  });
});
